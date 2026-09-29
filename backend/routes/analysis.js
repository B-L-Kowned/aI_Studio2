import { Router } from 'express';
import { access } from 'node:fs/promises';
import { getDb } from '../db/index.js';
import { analyse, transcriber } from '../lib/video-analysis.js';
import { ok, fail, route } from '../utils/respond.js';

// Analysing a video you already have. Everything measured here is measured
// LOCALLY with ffmpeg — no upload, no key, no model download.

const router = Router();

router.get(
  '/:id/analysis',
  route(async (req, res) => {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM sources WHERE production_id = ? AND kind = 'video' ORDER BY id")
      .all(Number(req.params.id));

    return ok(res, {
      transcriber: await transcriber(),
      sources: rows.map((r) => ({
        id: r.id, name: r.name, detail: r.detail,
        filePath: r.file_path, analysedAt: r.analysed_at,
        analysis: r.analysis ? JSON.parse(r.analysis) : null,
      })),
    });
  })
);

/**
 * Measure an imported video.
 *
 * The path is typed rather than picked: a browser file input reports a name,
 * never a location, and this build reads the file in place rather than copying
 * a second multi-gigabyte copy of it into the app.
 */
router.post(
  '/:id/analysis',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const file = String(req.body?.file ?? '').trim();
    if (!file) return fail(res, 400, 'NO_FILE', 'Give the path of the video to analyse.');
    if (!file.startsWith('/')) {
      return fail(res, 400, 'NOT_ABSOLUTE', 'Use a full path, starting with /.');
    }
    try {
      await access(file);
    } catch {
      return fail(res, 404, 'NOT_FOUND', `There is no file at ${file}.`);
    }

    let result;
    try {
      result = await analyse(file);
    } catch (err) {
      return fail(res, 422, err.code ?? 'ANALYSIS_FAILED',
        `ffmpeg could not read that file: ${err.message}`);
    }

    const existing = db
      .prepare("SELECT id FROM sources WHERE production_id = ? AND kind = 'video' ORDER BY id LIMIT 1")
      .get(id);

    const detail = [
      result.facts.video ? `${result.facts.video.width}×${result.facts.video.height}` : 'no video',
      result.facts.duration ? `${Math.round(result.facts.duration)}s` : null,
      `${result.cuts.length} shot${result.cuts.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ');

    if (existing) {
      db.prepare(
        "UPDATE sources SET name = ?, detail = ?, file_path = ?, analysis = ?, analysed_at = datetime('now') WHERE id = ?"
      ).run(result.facts.name, detail, file, JSON.stringify(result), existing.id);
    } else {
      db.prepare(
        `INSERT INTO sources (production_id, name, detail, kind, file_path, analysis, analysed_at)
         VALUES (?,?,?,'video',?,?,datetime('now'))`
      ).run(id, result.facts.name, detail, file, JSON.stringify(result));
    }

    return ok(res, result,
      `Measured ${result.facts.name}: ${detail}`
      + (result.transcriber ? '' : ' — no local transcriber, so no transcript'));
  })
);

/**
 * Adopt the measured shot structure as this production's outline.
 *
 * Separate from measuring on purpose: measuring is safe to repeat, and this
 * REPLACES a plan you may have written by hand.
 */
router.post(
  '/:id/analysis/adopt-outline',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const src = db
      .prepare("SELECT * FROM sources WHERE production_id = ? AND kind = 'video' AND analysis IS NOT NULL ORDER BY id LIMIT 1")
      .get(id);
    if (!src) return fail(res, 409, 'NOT_ANALYSED', 'Measure the video first.');

    const { outline, facts } = JSON.parse(src.analysis);
    if (!outline.length) {
      return fail(res, 422, 'NO_STRUCTURE',
        'The measurement found no shot structure to turn into an outline.');
    }

    db.transaction(() => {
      db.prepare('DELETE FROM outline_sections WHERE production_id = ?').run(id);
      const ins = db.prepare(
        `INSERT INTO outline_sections (production_id, position, title, runtime, participants, purpose)
         VALUES (?,?,?,?,?,?)`
      );
      outline.forEach((s) => ins.run(id, s.position, s.title, s.runtime, '',
        `Measured from the source video at ${s.startsAt}`));
      // The plan now describes the imported video, so the target follows it.
      const total = Math.round(facts.duration ?? 0);
      db.prepare('UPDATE productions SET target_runtime = ?, outline_approved = 0 WHERE id = ?')
        .run(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`, id);
    })();

    return ok(res, { sections: outline.length },
      `Outline replaced with ${outline.length} section${outline.length === 1 ? '' : 's'} measured from the video`);
  })
);

export default router;
