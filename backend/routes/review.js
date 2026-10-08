import { Router } from 'express';
import { getDb } from '../db/index.js';
import { madeBy } from '../lib/made-by.js';
import { ok, fail, route } from '../utils/respond.js';
import { visualsFor, updateVisualRow } from '../lib/visuals.js';
import { segmentsFor } from '../lib/segments.js';

/**
 * The register's two queues of reading work, across every video at once:
 * drafts with nothing left to check (they only need your yes), and the open
 * [CONFIRM: …] checks inside drafts (each needs an answer). Only drafts are
 * here — an approved script is not edited, it is replaced by a new draft.
 */
const router = Router();
const REGISTER_ID = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — (.*)$/;
const CONFIRM = /\[CONFIRM:\s*([^\]]*)\]/gi;
const PRIORITY = { P1: 0, P2: 1, P3: 2 };

// Release order, as the register lists it.
const order = (v) => {
  const m = /^([A-Z])(\d+)(?:-(\d+))?$/.exec(v);
  return m ? `${'VOTLAI'.indexOf(m[1])}${m[2].padStart(3, '0')}${(m[3] ?? '0').padStart(2, '0')}` : `9${v}`;
};

function drafts() {
  const db = getDb();
  const field = db.prepare('SELECT value FROM brief_fields WHERE production_id = ? AND label = ?');
  const rows = db.prepare(
    `SELECT p.id, p.title, p.target_runtime, co.name AS company, v.id AS version_id, v.version
       FROM productions p
       JOIN script_versions v ON v.id = (SELECT id FROM script_versions WHERE production_id = p.id AND status = 'proposed' ORDER BY id DESC LIMIT 1)
       LEFT JOIN campaigns c ON c.id = p.campaign_id
       LEFT JOIN companies co ON co.id = c.company_id
      WHERE NOT EXISTS (SELECT 1 FROM script_versions a WHERE a.production_id = p.id AND a.status = 'accepted')
        AND NOT EXISTS (SELECT 1 FROM brief_fields b WHERE b.production_id = p.id AND b.label = 'Completed asset' AND b.value != '')`
  ).all().filter((r) => REGISTER_ID.test(r.title));
  const lines = db.prepare('SELECT id, speaker, text FROM script_segments WHERE script_version_id = ? ORDER BY position');
  return rows.map((r) => {
    const [, videoId, name] = REGISTER_ID.exec(r.title);
    const ls = lines.all(r.version_id).filter((l) => l.text.trim());
    return {
      productionId: r.id, videoId, name, company: r.company, versionId: r.version_id, version: r.version,
      priority: field.get(r.id, 'Priority')?.value || null, format: field.get(r.id, 'Format')?.value || null,
      // What the script is for, to judge it against while reading.
      brief: Object.fromEntries(['Audience', 'Goal', 'CTA', 'Website'].map((k) => [k.toLowerCase(), field.get(r.id, k)?.value || null])),
      madeBy: madeBy(r.id), target: r.target_runtime,
      lines: ls.map((l) => ({ id: l.id, speaker: l.speaker, text: l.text, checks: [...l.text.matchAll(CONFIRM)].map((m) => m[1].trim()) })),
    };
  }).sort((a, b) => order(a.videoId).localeCompare(order(b.videoId)));
}

/**
 * Voices made but not yet approved, across the register: each video's lines
 * with their current take, to listen through and approve in one pass.
 */
function voicesToApprove() {
  const db = getDb();
  const field = db.prepare('SELECT value FROM brief_fields WHERE production_id = ? AND label = ?');
  const rows = db.prepare(
    `SELECT DISTINCT p.id, p.title, co.name AS company FROM productions p
       JOIN segments s ON s.production_id = p.id
       JOIN takes t ON t.segment_id = s.id AND t.local_path IS NOT NULL AND t.stale = 0 AND t.heard = 0
       LEFT JOIN campaigns c ON c.id = p.campaign_id LEFT JOIN companies co ON co.id = c.company_id
      -- A finished video's voice is history, not work.
      WHERE NOT EXISTS (SELECT 1 FROM brief_fields b WHERE b.production_id = p.id AND b.label = 'Completed asset' AND b.value != '')`
  ).all().filter((r) => REGISTER_ID.test(r.title));
  return rows.map((r) => {
    const [, videoId, name] = REGISTER_ID.exec(r.title);
    const lines = segmentsFor(r.id).map((sg) => ({
      segmentId: sg.id, text: sg.text, heard: sg.heard, takeId: sg.take?.id ?? null,
      audioUrl: sg.take && !sg.needsAudition ? sg.take.audioUrl : null, duration: sg.take?.duration ?? null,
    }));
    return { productionId: r.id, videoId, name, company: r.company, priority: field.get(r.id, 'Priority')?.value || null, madeBy: madeBy(r.id), lines };
  }).filter((v) => v.lines.some((l) => l.audioUrl && !l.heard))
    .sort((a, b) => order(a.videoId).localeCompare(order(b.videoId)));
}

router.get('/review', route(async (req, res) => {
  const all = drafts();
  const voices = voicesToApprove();
  const ready = all.filter((d) => d.lines.length && d.lines.every((l) => !l.checks.length));
  const withChecks = all.filter((d) => d.lines.some((l) => l.checks.length));
  const byPriority = (a, b) => (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9);
  const sort = req.query.sort === 'priority' ? (list) => [...list].sort(byPriority) : (list) => list;
  return ok(res, {
    ready: sort(ready),
    checks: sort(withChecks).map((d) => ({ ...d, lines: d.lines.filter((l) => l.checks.length) })),
    voices: sort(voices),
    totals: { voices: voices.length, ready: ready.length, videosWithChecks: withChecks.length, checks: withChecks.reduce((n, d) => n + d.lines.reduce((m, l) => m + l.checks.length, 0), 0) },
  });
}));

/** Take back an approval made by mistake: the script is a draft again. */
router.post('/review/reopen', route(async (req, res) => {
  const db = getDb();
  const v = db.prepare("SELECT * FROM script_versions WHERE id = ? AND production_id = ? AND status = 'accepted'")
    .get(Number(req.body?.versionId), Number(req.body?.productionId));
  if (!v) return fail(res, 404, 'NOT_FOUND', 'No approved script to take back');
  db.prepare("UPDATE script_versions SET status = 'proposed' WHERE id = ?").run(v.id);
  return ok(res, { productionId: v.production_id }, 'Approval taken back — it is a draft again');
}));

/**
 * A check that is really an instruction for the screen recording ("where the
 * role is shown") leaves the script and becomes a note on the shot that
 * covers its line, where it will be read when that screen is recorded.
 */
router.post('/review/note', route(async (req, res) => {
  const db = getDb();
  const productionId = Number(req.body?.productionId);
  const line = db.prepare(
    `SELECT ss.*, v.status FROM script_segments ss JOIN script_versions v ON v.id = ss.script_version_id
      WHERE ss.id = ? AND v.production_id = ?`
  ).get(Number(req.body?.lineId), productionId);
  if (!line) return fail(res, 404, 'NOT_FOUND', 'Script line not found');
  if (line.status !== 'proposed') return fail(res, 409, 'SCRIPT_LOCKED', 'Only a draft can be changed');
  const checks = [...line.text.matchAll(CONFIRM)].map((m) => m[1].trim().replace(/\.$/, ''));
  if (!checks.length) return fail(res, 409, 'NO_CHECK', 'This line has no check');
  const row = visualsFor(productionId).rows.find((r) => r.lines.some((l) => l.id === line.id));
  if (row) {
    const note = checks.map((c) => `Show: ${c}`).join('\n');
    updateVisualRow(productionId, row.id, { detail: row.detail ? `${row.detail}\n${note}` : note });
  }
  const text = line.text.replace(/\[CONFIRM:[^\]]*\]\s*/gi, '').replace(/\s{2,}/g, ' ').trim();
  db.prepare('UPDATE script_segments SET text = ? WHERE id = ?').run(text, line.id);
  return ok(res, { section: row?.title ?? null }, row ? `Moved to the shot list — "${row.title}"` : 'Check removed (no shot list section found for this line)');
}));

export default router;
