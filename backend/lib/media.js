import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { getDb } from '../db/index.js';
import { importLocalVideo } from './video-library.js';
import { importScript } from './sources.js';
import { storageRoot } from './exporter.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const VOICE_DIR = resolve(here, '..', '..', 'voice');
const PYTHON = process.env.VOICE_PYTHON || join(VOICE_DIR, '.venv', 'bin', 'python');
const TYPES = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v', 'video/webm': '.webm' };
export const MAX_UPLOAD = 4 * 1024 ** 3;

// Transcriptions in progress, by production. Lost on restart, which only means
// the button offers to transcribe again; the stored state lives in the brief.
const jobs = new Map();
export const transcriptionFor = (productionId) => jobs.get(productionId) ?? null;

export const brief = (productionId, label, value) => {
  const db = getDb();
  const row = db.prepare('SELECT id FROM brief_fields WHERE production_id = ? AND label = ?').get(productionId, label);
  if (row) db.prepare('UPDATE brief_fields SET value = ? WHERE id = ?').run(String(value).slice(0, 500), row.id);
  else {
    const pos = db.prepare('SELECT COALESCE(MAX(position), 0) n FROM brief_fields WHERE production_id = ?').get(productionId).n;
    db.prepare('INSERT INTO brief_fields (production_id, label, value, position) VALUES (?,?,?,?)')
      .run(productionId, label, String(value).slice(0, 500), pos + 1);
  }
};

/** Stream an upload to a temporary file under the storage root. */
export async function receiveUpload(req) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) throw Object.assign(new Error('Upload a video file (mp4, mov, m4v or webm).'), { code: 'BAD_TYPE' });
  const length = Number(req.headers['content-length'] ?? 0);
  if (length > MAX_UPLOAD) throw Object.assign(new Error('That file is larger than 4 GB.'), { code: 'TOO_LARGE' });
  const dir = join(storageRoot(), '.uploads');
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  try {
    await pipeline(req, createWriteStream(tmp));
  } catch (err) {
    rmSync(tmp, { force: true });
    throw Object.assign(new Error('The upload was interrupted.'), { code: 'UPLOAD_FAILED' });
  }
  if (!statSync(tmp).size) { rmSync(tmp, { force: true }); throw Object.assign(new Error('The upload was empty.'), { code: 'EMPTY' }); }
  return tmp;
}

/** Split a transcript into one-or-two-sentence lines for the script editor. */
function toLines(text) {
  const sentences = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).filter(Boolean);
  const out = []; let cur = ''; let n = 0;
  for (const s of sentences) {
    if (cur && (n >= 2 || cur.length + s.length > 260)) { out.push(cur); cur = s; n = 1; }
    else { cur = cur ? `${cur} ${s}` : s; n++; }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Recover the words of a finished video and make them its accepted script —
 * "as published". Any draft waiting for approval is set aside (kept, rejected):
 * the video that exists is the version of record.
 */
export function transcribeInBackground(productionId, file, name) {
  if (jobs.get(productionId)?.state === 'running') return jobs.get(productionId);
  const job = { state: 'running', startedAt: Date.now(), file: name };
  jobs.set(productionId, job);
  brief(productionId, 'Transcript', 'Transcribing the finished video…');
  (async () => {
    try {
      if (!existsSync(PYTHON)) throw new Error('The voice environment is not set up (see voice/README.md).');
      const { stdout } = await run(PYTHON, [join(VOICE_DIR, 'transcribe.py'), file, '--json'],
        { maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60 * 1000 });
      const result = JSON.parse(stdout);
      const text = result.segments.map((s) => s.text).join(' ').trim();
      if (!text) throw new Error('No speech was found in the video.');
      const db = getDb();
      for (const v of db.prepare("SELECT id FROM script_versions WHERE production_id = ? AND status = 'proposed'").all(productionId)) {
        db.prepare("UPDATE script_versions SET status = 'rejected' WHERE id = ?").run(v.id);
      }
      importScript(productionId, toLines(text).map((l) => `Pat: ${l}`).join('\n'), { status: 'accepted' });
      const words = text.split(/\s+/).length;
      brief(productionId, 'Script status', 'Transcribed from the finished video — the words as published; check names and URLs by ear');
      brief(productionId, 'Script source', `Transcript (Whisper, on this Mac) of ${name}`);
      brief(productionId, 'Script length', `${words} words · ${Math.floor(result.duration / 60)}:${String(Math.round(result.duration % 60)).padStart(2, '0')} as published`);
      brief(productionId, 'Transcript', `Done — ${words} words in ${Math.round(result.seconds_taken)}s`);
      Object.assign(job, { state: 'done', words, seconds: result.seconds_taken });
    } catch (err) {
      brief(productionId, 'Transcript', `Failed — ${err.message}`.slice(0, 300));
      Object.assign(job, { state: 'failed', error: err.message });
    }
  })();
  return job;
}

/**
 * The finished video, on record: in the library, marked done in the brief, and
 * an export row — Publish prepares packages from exports, and until this an
 * export could only come from a HeyGen render, so a video you recorded or
 * uploaded could never be published.
 */
export async function recordFinal(productionId, file, name, { editsApplied = 0, note = null } = {}) {
  const db = getDb();
  const r = await importLocalVideo({ path: file, productionId, name });
  if (!db.prepare("SELECT value FROM brief_fields WHERE production_id = ? AND label = 'Completed asset'").get(productionId)?.value) {
    brief(productionId, 'Completed asset', r.name);
  }
  brief(productionId, 'Completed confirmed', `Finished video ${note ?? 'saved'} ${new Date().toISOString().slice(0, 10)}`);
  brief(productionId, 'Final file', r.path);
  const version = (db.prepare('SELECT MAX(version) m FROM exports WHERE production_id = ?').get(productionId).m ?? 0) + 1;
  db.prepare(
    `INSERT INTO exports (production_id, render_version_id, version, status, file_path, bytes, duration_seconds, edits_applied, note)
     VALUES (?, NULL, ?, 'ready', ?, ?, ?, ?, ?)`
  ).run(productionId, version, r.path, r.bytes, r.duration, editsApplied, note);
  return { ...r, exportVersion: version };
}

/** A finished video uploaded for a production: file it, mark the video done, recover its words. */
export async function acceptFinishedVideo(productionId, tmp, name) {
  // A video already on record (its HeyGen entry) keeps its name, so the upload
  // lands on that record instead of creating a second one for the same video.
  const known = getDb().prepare("SELECT value FROM brief_fields WHERE production_id = ? AND label = 'Completed asset'").get(productionId)?.value;
  const recordName = known ? known.replace(/\s*\([^)]*\)\s*$/, '').trim() : null;
  const r = await recordFinal(productionId, tmp, recordName || name, { note: 'uploaded' });
  rmSync(tmp, { force: true });
  return { ...r, transcription: transcribeInBackground(productionId, r.path, r.name) };
}

/** A screen capture for one section of the shot list. */
export async function acceptRecording(productionId, sceneId, tmp, name) {
  const db = getDb();
  const scene = db.prepare('SELECT * FROM scenes WHERE id = ? AND production_id = ?').get(sceneId, productionId);
  if (!scene) { rmSync(tmp, { force: true }); throw Object.assign(new Error('No such section.'), { code: 'NOT_FOUND' }); }
  const r = await importLocalVideo({ path: tmp, productionId, name: name || `Recording — ${scene.title}` });
  rmSync(tmp, { force: true });
  db.prepare('UPDATE scenes SET captured = 1, recording_asset_id = ? WHERE id = ?').run(r.id, scene.id);
  return r;
}

export { extname };
