import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../db/index.js';
import { storageRoot } from './exporter.js';
import { folderFor } from './storage.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const VOICE_DIR = join(here, '..', '..', 'voice');
const PYTHON = process.env.VOICE_PYTHON || join(VOICE_DIR, '.venv', 'bin', 'python');
const pad = (n) => String(n).padStart(2, '0');

/** Where this video's takes live: Company / Track / Video / Takes. */
export function takesDir(productionId) {
  const shape = folderFor(productionId);
  const dir = join(storageRoot(), ...(shape ? shape.parts : [`production-${productionId}`]), 'Takes');
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout) || null;
}

/**
 * Every take becomes an H.264/AAC mp4. A browser records webm with no duration
 * in its header, phones record HEVC .mov; one format means the editor, the
 * kit and the export never meet a file they cannot seek.
 */
async function ingest(src, dest) {
  await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', dest],
  { timeout: 30 * 60 * 1000 });
  rmSync(src, { force: true });
  return duration(dest);
}

const nextVersion = (segmentId) =>
  (getDb().prepare('SELECT MAX(version) m FROM line_takes WHERE segment_id = ?').get(segmentId).m ?? 0) + 1;

/** The newest take of a line is the one used, until you choose another. */
function choose(db, segmentId, takeId) {
  db.prepare('UPDATE line_takes SET chosen = (id = ?) WHERE segment_id = ?').run(takeId, segmentId);
}

/** One recorded or uploaded take of one line. */
export async function addTake(productionId, segmentId, tmp, source = 'teleprompter') {
  const db = getDb();
  const seg = db.prepare('SELECT * FROM segments WHERE id = ? AND production_id = ?').get(segmentId, productionId);
  if (!seg) { rmSync(tmp, { force: true }); throw Object.assign(new Error('No such line.'), { code: 'NOT_FOUND' }); }
  const version = nextVersion(segmentId);
  const file = join(takesDir(productionId), `line ${pad(seg.position + 1)} take ${version}.mp4`);
  const secs = await ingest(tmp, file);
  const id = db.prepare(
    `INSERT INTO line_takes (production_id, segment_id, version, source, path, in_point, out_point, duration, text)
     VALUES (?,?,?,?,?,0,?,?,?)`
  ).run(productionId, segmentId, version, source, file, secs, secs, seg.text).lastInsertRowid;
  choose(db, segmentId, id);
  return takeView(db.prepare('SELECT * FROM line_takes WHERE id = ?').get(id));
}

export const takeView = (t) => t && ({
  id: t.id, segmentId: t.segment_id, version: t.version, source: t.source,
  inPoint: t.in_point, outPoint: t.out_point ?? t.duration, duration: t.duration,
  text: t.text, said: t.said, chosen: !!t.chosen, createdAt: t.created_at,
  url: `/api/productions/${t.production_id}/line-takes/${t.id}/video`,
  missing: !existsSync(t.path),
});

/** Each line of the script with its takes, newest first. */
export function linesWithTakes(productionId) {
  const db = getDb();
  const takes = db.prepare('SELECT * FROM line_takes WHERE production_id = ? ORDER BY version DESC').all(productionId);
  const audio = db.prepare('SELECT id, heard, stale, text FROM takes WHERE segment_id = ? ORDER BY version DESC LIMIT 1');
  const lines = db.prepare('SELECT id, position, speaker, text FROM segments WHERE production_id = ? ORDER BY position').all(productionId)
    .map((s) => {
      const a = audio.get(s.id);
      return {
        segmentId: s.id, n: s.position + 1, text: s.text,
        // Your approved AI read of the line, to hear the pace before you record it.
        guideAudio: a && a.heard && !a.stale && a.text === s.text ? `/api/takes/${a.id}/audio` : null,
        takes: takes.filter((t) => t.segment_id === s.id).map(takeView)
          .map((t) => ({ ...t, outdated: t.text !== s.text })),
      };
    });
  const orphans = takes.filter((t) => t.segment_id == null).map(takeView);
  return { lines, orphans };
}

export function updateTake(productionId, takeId, { chosen, inPoint, outPoint }) {
  const db = getDb();
  const t = db.prepare('SELECT * FROM line_takes WHERE id = ? AND production_id = ?').get(takeId, productionId);
  if (!t) throw Object.assign(new Error('No such take.'), { code: 'NOT_FOUND' });
  if (chosen === true && t.segment_id) choose(db, t.segment_id, t.id);
  if (inPoint !== undefined || outPoint !== undefined) {
    const i = inPoint !== undefined ? Number(inPoint) : t.in_point;
    const o = outPoint !== undefined ? Number(outPoint) : (t.out_point ?? t.duration);
    if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o <= i || (t.duration && o > t.duration + 0.05)) {
      throw Object.assign(new Error('The in point must come before the out point, inside the take.'), { code: 'BAD_RANGE' });
    }
    db.prepare('UPDATE line_takes SET in_point = ?, out_point = ? WHERE id = ?').run(i, o, t.id);
  }
  return takeView(db.prepare('SELECT * FROM line_takes WHERE id = ?').get(t.id));
}

/**
 * Discard a take. The row goes; the file moves to Takes/Discarded rather than
 * being deleted, and a file other takes still point into (a split recording)
 * is left where it is.
 */
export function discardTake(productionId, takeId) {
  const db = getDb();
  const t = db.prepare('SELECT * FROM line_takes WHERE id = ? AND production_id = ?').get(takeId, productionId);
  if (!t) throw Object.assign(new Error('No such take.'), { code: 'NOT_FOUND' });
  db.prepare('DELETE FROM line_takes WHERE id = ?').run(t.id);
  const shared = db.prepare('SELECT 1 FROM line_takes WHERE path = ?').get(t.path);
  if (!shared && existsSync(t.path)) {
    const bin = join(dirname(t.path), 'Discarded');
    mkdirSync(bin, { recursive: true });
    renameSync(t.path, join(bin, basename(t.path)));
  }
  if (t.chosen && t.segment_id) {
    const next = db.prepare('SELECT id FROM line_takes WHERE segment_id = ? ORDER BY version DESC LIMIT 1').get(t.segment_id);
    if (next) choose(db, t.segment_id, next.id);
  }
}

export function takeFile(productionId, takeId) {
  return getDb().prepare('SELECT path FROM line_takes WHERE id = ? AND production_id = ?').get(takeId, productionId)?.path ?? null;
}

// ------------------------------------------------- a whole recording, split into lines
const norm = (w) => String(w).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');

/**
 * Match the script's words to the words spoken, and give each line the span
 * where it was said. A longest-common-subsequence alignment, walked back from
 * the end so a line said twice matches its LAST reading — the retake after a
 * stumble is the one you meant to keep.
 */
export function alignLines(lines, words) {
  const script = [];
  lines.forEach((l, li) => String(l.text).replace(/\[CONFIRM:[^\]]*\]/gi, ' ').split(/\s+/).map(norm).filter(Boolean)
    .forEach((w) => script.push({ w, li })));
  const spoken = words.map((w) => ({ ...w, n: norm(w.word) })).filter((w) => w.n);
  const n = script.length; const m = spoken.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = script[i].w === spoken[j].n ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Forward walk that skips spoken words while skipping still keeps the best
  // score, so each match lands as late as it can.
  const hits = lines.map(() => []);
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (script[i].w === spoken[j].n && dp[i][j] === dp[i + 1][j + 1] + 1 && dp[i][j + 1] !== dp[i][j]) {
      hits[script[i].li].push(spoken[j]); i++; j++;
    } else if (dp[i][j + 1] === dp[i][j]) j++;
    else i++;
  }
  return lines.map((l, li) => {
    const total = script.filter((s) => s.li === li).length;
    const h = hits[li];
    if (!total || h.length / total < 0.5) return { segmentId: l.segmentId, found: false, matched: h.length, total };
    return {
      segmentId: l.segmentId, found: true, matched: h.length, total,
      start: Math.max(0, h[0].start - 0.15), end: h[h.length - 1].end + 0.25,
      said: spoken.filter((w) => w.start >= h[0].start && w.end <= h[h.length - 1].end).map((w) => w.word).join(' '),
    };
  });
}

const splits = new Map(); // productionId → job
export const splitJob = (productionId) => splits.get(productionId) ?? null;

/** A recording of the whole script (or part of it), made elsewhere: file it, transcribe, split into line takes. */
export function splitRecording(productionId, tmp, name) {
  if (splits.get(productionId)?.state === 'running') {
    rmSync(tmp, { force: true });
    throw Object.assign(new Error('A recording for this video is still being split.'), { code: 'BUSY' });
  }
  const job = { state: 'running', step: 'Converting the recording', startedAt: Date.now(), name };
  splits.set(productionId, job);
  (async () => {
    try {
      const db = getDb();
      const count = db.prepare("SELECT COUNT(DISTINCT path) n FROM line_takes WHERE production_id = ? AND source = 'split'").get(productionId).n;
      const file = join(takesDir(productionId), `full recording ${count + 1}.mp4`);
      const secs = await ingest(tmp, file);
      job.step = 'Finding each line in what you said (about 40 seconds a minute)';
      if (!existsSync(PYTHON)) throw new Error('The voice environment is not set up (see voice/README.md).');
      const { stdout } = await run(PYTHON, [join(VOICE_DIR, 'transcribe.py'), file, '--json', '--words'],
        { maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60 * 1000 });
      const words = JSON.parse(stdout).segments.flatMap((s) => s.words ?? []);
      const lines = db.prepare('SELECT id AS segmentId, text, position FROM segments WHERE production_id = ? ORDER BY position').all(productionId);
      const found = alignLines(lines, words);
      const insert = db.prepare(
        `INSERT INTO line_takes (production_id, segment_id, version, source, path, in_point, out_point, duration, text, said)
         VALUES (?,?,?,'split',?,?,?,?,?,?)`
      );
      let made = 0;
      for (const f of found.filter((x) => x.found)) {
        const line = lines.find((l) => l.segmentId === f.segmentId);
        const id = insert.run(productionId, f.segmentId, nextVersion(f.segmentId), file,
          f.start, Math.min(f.end, secs ?? f.end), secs, line.text, f.said).lastInsertRowid;
        choose(db, f.segmentId, id);
        made++;
      }
      Object.assign(job, { state: 'done', step: null, lines: lines.length, found: made,
        missing: found.filter((x) => !x.found).map((x) => lines.find((l) => l.segmentId === x.segmentId).position + 1) });
    } catch (err) {
      rmSync(tmp, { force: true });
      Object.assign(job, { state: 'failed', step: null, error: err.message });
    }
  })();
  return job;
}
