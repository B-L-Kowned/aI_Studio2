import { Router } from 'express';
import { createReadStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getDb } from '../db/index.js';
import { clearStale } from '../lib/stale.js';
import { speakLocal, localFile, voicesDir, applyPronunciations, SPEED_RANGE, LOCAL } from '../lib/local-voice.js';
import { invalidateTakes } from '../lib/segments.js';
import { joinWavs } from '../lib/audio-join.js';
import { narrationVoice, scriptTiming } from '../lib/script-timing.js';
import { visualsFor, updateVisualRow, approveVisuals } from '../lib/visuals.js';
import { receiveUpload, acceptFinishedVideo, acceptRecording, transcribeInBackground, transcriptionFor } from '../lib/media.js';
import { ok, fail, route } from '../utils/respond.js';

export { narrationVoice };

const router = Router();
router.get(
  '/:id/script-timing',
  route(async (req, res) => {
    const t = scriptTiming(Number(req.params.id));
    return t ? ok(res, t) : fail(res, 404, 'NOT_FOUND', 'Production not found');
  })
);

/**
 * Narration speed for this video. Changing it changes what every local take
 * sounds like, so existing takes go stale and must be heard again.
 */
router.patch(
  '/:id/voice-speed',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
    const speed = Number(req.body?.speed);
    if (!Number.isFinite(speed) || speed < SPEED_RANGE[0] || speed > SPEED_RANGE[1]) {
      return fail(res, 400, 'BAD_SPEED', `Speed must be between ${SPEED_RANGE[0]}× and ${SPEED_RANGE[1]}×`);
    }
    const rounded = Math.round(speed * 100) / 100;
    db.prepare('UPDATE productions SET voice_speed = ? WHERE id = ?').run(rounded, id);
    let staled = 0;
    for (const s of db.prepare(
      `SELECT DISTINCT s.id FROM segments s JOIN takes t ON t.segment_id = s.id
         WHERE s.production_id = ? AND t.local_path IS NOT NULL AND t.stale = 0`
    ).all(id)) { invalidateTakes(s.id, `Voice speed changed to ${rounded}×`); staled++; }
    return ok(res, { speed: rounded, takesStaled: staled },
      `Narration speed ${rounded}×${staled ? ` — ${staled} take${staled === 1 ? '' : 's'} to hear again` : ''}`);
  })
);

/** "The words are still right": clear a script's stale flag after a plan change. */
router.post(
  '/:id/script/:versionId/keep',
  route(async (req, res) => {
    const v = getDb().prepare('SELECT * FROM script_versions WHERE id = ? AND production_id = ?')
      .get(Number(req.params.versionId), Number(req.params.id));
    if (!v) return fail(res, 404, 'NOT_FOUND', 'Script version not found');
    clearStale('script_versions', v.id);
    return ok(res, { id: v.id }, `Kept script v${v.version} — marked current`);
  })
);

// One cache for every line heard, keyed by voice + speed + the words as SPOKEN
// (after your pronunciations): Hear, the full read and the warm-up share it, so
// a line is made once, not per click — and a pronunciation fix is heard at once.
const cacheKey = (voice, speed, text) =>
  createHash('sha1').update(`${voice.id}|${speed ?? ''}|${applyPronunciations(text)}`).digest('hex').slice(0, 16);
const cacheRel = (key) => `samples/listen/cache/${key}.wav`;

/** The quickest audio for a line: its approved take, else a cached read, else nothing yet. */
function readyAudio(db, id, line, voice, speed) {
  const take = db.prepare(
    `SELECT t.* FROM segments s JOIN takes t ON t.segment_id = s.id
      WHERE s.production_id = ? AND s.text = ? AND t.local_path IS NOT NULL AND t.stale = 0 AND t.text = s.text
      ORDER BY t.heard DESC, t.version DESC LIMIT 1`
  ).get(id, line.text);
  if (take && localFile(take.local_path)) return { url: `/api/takes/${take.id}/audio`, duration: take.duration, from: 'take' };
  const key = cacheKey(voice, speed, line.text);
  if (localFile(cacheRel(key))) return { url: `/api/productions/${id}/script/${line.script_version_id}/listen/${line.id}?k=${key}`, duration: null, from: 'cache' };
  return null;
}

// Lines being made ahead of time, so Hear is instant by the time you click it.
// One worker, because the voice service makes one line at a time (about 20-35 s
// each on this Mac). A line you click jumps the queue; it is never made twice.
const warmQueue = [];          // keys waiting, in order
const pending = new Map();     // key -> { voice, speed, text, promise, resolve, reject }
let warming = false;

function ensureCached(voice, speed, text, { front = false } = {}) {
  const key = cacheKey(voice, speed, text);
  if (localFile(cacheRel(key))) return Promise.resolve(key);
  let job = pending.get(key);
  if (!job) {
    job = { voice, speed, text };
    job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
    job.promise.catch(() => {}); // a warm-up nobody waits on must not crash the process
    pending.set(key, job);
    warmQueue.push(key);
  }
  if (front) {
    const i = warmQueue.indexOf(key);
    if (i > 0) { warmQueue.splice(i, 1); warmQueue.unshift(key); }
  }
  warmNext();
  return job.promise;
}

async function warmNext() {
  if (warming) return;
  warming = true;
  try {
    while (warmQueue.length) {
      const key = warmQueue.shift();
      const job = pending.get(key);
      if (!job) continue;
      try {
        if (!localFile(cacheRel(key))) await speakLocal(job.voice.id, job.text, cacheRel(key), { speed: job.speed });
        job.resolve(key);
      } catch (err) { job.reject(err); } finally { pending.delete(key); }
    }
  } finally { warming = false; }
}

/** Hear one line of a draft in the local voice, at this video's speed. Free; nothing is approved. */
router.post(
  '/:id/script/:versionId/listen/:lineId',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const line = db.prepare(
      `SELECT ss.* FROM script_segments ss JOIN script_versions v ON v.id = ss.script_version_id
        WHERE ss.id = ? AND v.id = ? AND v.production_id = ?`
    ).get(Number(req.params.lineId), Number(req.params.versionId), id);
    if (!line) return fail(res, 404, 'NOT_FOUND', 'Script line not found');
    if (/\[CONFIRM/i.test(line.text)) return fail(res, 409, 'UNCONFIRMED', 'Resolve the [CONFIRM: …] in this line first.');
    const voice = narrationVoice();
    if (!voice) return fail(res, 409, 'NO_VOICE', 'Create a local voice in Settings → Your voice first.');
    const speed = db.prepare('SELECT voice_speed FROM productions WHERE id = ?').get(id)?.voice_speed ?? undefined;
    const ready = readyAudio(db, id, line, voice, speed);
    if (ready) return ok(res, ready, 'Ready — nothing spent');
    try {
      const key = await ensureCached(voice, speed, line.text, { front: true });
      return ok(res, { url: `/api/productions/${id}/script/${line.script_version_id}/listen/${line.id}?k=${key}`, duration: null, from: 'made' },
        'Made in your voice — nothing spent');
    } catch (err) {
      return fail(res, err.code === 'VOICE_OFFLINE' ? 503 : 502, err.code ?? 'VOICE_FAILED', err.message);
    }
  })
);

router.get(
  '/:id/script/:versionId/listen/:lineId',
  route(async (req, res) => {
    const key = String(req.query.k ?? '');
    const file = /^[0-9a-f]{16}$/.test(key)
      ? localFile(cacheRel(key))
      : localFile(`samples/listen/${Number(req.params.versionId)}-${Number(req.params.lineId)}.wav`);
    if (!file) return fail(res, 404, 'NOT_FOUND', 'Not generated yet');
    res.type('audio/wav');
    return createReadStream(file).pipe(res);
  })
);

/** Make the script's lines ahead of time, in the background, so Hear plays at once. */
router.post(
  '/:id/script/:versionId/warm',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const voice = narrationVoice();
    if (!voice) return ok(res, { queued: 0 });
    const speed = db.prepare('SELECT voice_speed FROM productions WHERE id = ?').get(id)?.voice_speed ?? undefined;
    const lines = db.prepare(
      `SELECT ss.* FROM script_segments ss JOIN script_versions v ON v.id = ss.script_version_id
        WHERE v.id = ? AND v.production_id = ? ORDER BY ss.position`
    ).all(Number(req.params.versionId), id).filter((l) => l.text.trim() && !/\[CONFIRM/i.test(l.text));
    let queued = 0;
    for (const l of lines) {
      if (readyAudio(db, id, l, voice, speed)) continue;
      ensureCached(voice, speed, l.text);
      queued++;
    }
    return ok(res, { queued });
  })
);

// ------------------------------------------------------------- the whole script, end to end
// Synthesis runs at ~2× real time, so a full read is built in the background and
// polled. Each line is cached by voice + speed + text: re-hearing after one edit
// regenerates one line, not the script.
const fullReads = new Map(); // versionId → job

async function buildFullRead(job, voice, speed, lines) {
  const dir = join(voicesDir(), 'samples', 'listen', 'cache');
  mkdirSync(dir, { recursive: true });
  const parts = [];
  for (const l of lines) {
    const rel = cacheRel(cacheKey(voice, speed, l.text));
    if (!localFile(rel)) await speakLocal(voice.id, l.text, rel, { speed });
    parts.push(join(voicesDir(), rel));
    job.done++;
  }
  const out = join(voicesDir(), 'samples', 'listen', `${job.versionId}-all.wav`);
  const duration = await joinWavs(parts, out, dir, `${job.versionId}-all.txt`);
  Object.assign(job, { state: 'done', duration, builtAt: Date.now() });
}

const fullReadView = (id, job) => job && {
  state: job.state, done: job.done, total: job.total, skipped: job.skipped, duration: job.duration ?? null, error: job.error ?? null,
  url: job.state === 'done' ? `/api/productions/${id}/script/${job.versionId}/listen-all/audio?t=${job.builtAt}` : null,
};

router.post(
  '/:id/script/:versionId/listen-all',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const versionId = Number(req.params.versionId);
    if (!db.prepare('SELECT 1 FROM script_versions WHERE id = ? AND production_id = ?').get(versionId, id)) {
      return fail(res, 404, 'NOT_FOUND', 'Script version not found');
    }
    if (fullReads.get(versionId)?.state === 'running') return ok(res, fullReadView(id, fullReads.get(versionId)));
    const voice = narrationVoice();
    if (!voice) return fail(res, 409, 'NO_VOICE', 'Create a local voice in Settings → Your voice first.');
    const all = db.prepare('SELECT * FROM script_segments WHERE script_version_id = ? ORDER BY position').all(versionId)
      .filter((l) => l.text.trim());
    const lines = all.filter((l) => !/\[CONFIRM/i.test(l.text));
    if (!lines.length) return fail(res, 409, 'UNCONFIRMED', 'Every line has an open [CONFIRM: …] check — resolve them first.');
    const speed = db.prepare('SELECT voice_speed FROM productions WHERE id = ?').get(id)?.voice_speed ?? undefined;
    const job = { versionId, state: 'running', done: 0, total: lines.length, skipped: all.length - lines.length };
    fullReads.set(versionId, job);
    buildFullRead(job, voice, speed, lines).catch((err) => Object.assign(job, { state: 'failed', error: err.message }));
    return ok(res, fullReadView(id, job), 'Preparing the full read');
  })
);

router.get(
  '/:id/script/:versionId/listen-all',
  route(async (req, res) => ok(res, fullReadView(Number(req.params.id), fullReads.get(Number(req.params.versionId))) ?? null))
);

router.get(
  '/:id/script/:versionId/listen-all/audio',
  route(async (req, res) => {
    const file = localFile(`samples/listen/${Number(req.params.versionId)}-all.wav`);
    if (!file) return fail(res, 404, 'NOT_FOUND', 'Not generated yet');
    res.type('audio/wav');
    return createReadStream(file).pipe(res);
  })
);

// ------------------------------------------------------------- visuals
const visualStatus = { NOT_FOUND: 404, BAD_SHOT: 400, EMPTY: 409, INCOMPLETE: 409 };
const exists = (id) => getDb().prepare('SELECT 1 FROM productions WHERE id = ?').get(id);

router.get('/:id/visuals', route(async (req, res) => {
  const id = Number(req.params.id);
  return exists(id) ? ok(res, visualsFor(id)) : fail(res, 404, 'NOT_FOUND', 'Production not found');
}));

router.patch('/:id/visuals/:rowId', route(async (req, res) => {
  try { return ok(res, updateVisualRow(Number(req.params.id), Number(req.params.rowId), req.body ?? {}), 'Shot updated'); }
  catch (err) { return fail(res, visualStatus[err.code] ?? 400, err.code ?? 'ERROR', err.message); }
}));

router.post('/:id/visuals/approve', route(async (req, res) => {
  try { return ok(res, approveVisuals(Number(req.params.id)), 'Visuals approved'); }
  catch (err) { return fail(res, visualStatus[err.code] ?? 400, err.code ?? 'ERROR', err.message); }
}));

// --------------------------------------------------------------- uploads
// The file is the raw request body (a browser file input posts it as-is);
// its name travels in X-File-Name. Nothing is buffered in memory.
const fileName = (req) => {
  try { return decodeURIComponent(String(req.headers['x-file-name'] ?? '')).replace(/\.[a-z0-9]+$/i, '').slice(0, 160); }
  catch { return ''; }
};
const uploadStatus = { BAD_TYPE: 415, TOO_LARGE: 413, EMPTY: 400, UPLOAD_FAILED: 400, NOT_FOUND: 404, BAD_VIDEO: 400 };

router.post('/:id/media/final', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!exists(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  try {
    const tmp = await receiveUpload(req);
    const r = await acceptFinishedVideo(id, tmp, fileName(req) || undefined);
    return ok(res, r, `Saved "${r.name}" — transcribing its words now`);
  } catch (err) { return fail(res, uploadStatus[err.code] ?? 500, err.code ?? 'ERROR', err.message); }
}));

router.post('/:id/media/recording/:sceneId', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!exists(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  try {
    const tmp = await receiveUpload(req);
    const r = await acceptRecording(id, Number(req.params.sceneId), tmp, fileName(req) || undefined);
    return ok(res, { recording: r, visuals: visualsFor(id) }, `Recording saved for this section`);
  } catch (err) { return fail(res, uploadStatus[err.code] ?? 500, err.code ?? 'ERROR', err.message); }
}));

/** Where the transcription of this production's finished video stands. */
router.get('/:id/transcription', route(async (req, res) => {
  const id = Number(req.params.id);
  const job = transcriptionFor(id);
  const stored = getDb().prepare("SELECT value FROM brief_fields WHERE production_id = ? AND label = 'Transcript'").get(id)?.value ?? null;
  return ok(res, { state: job?.state ?? (stored?.startsWith('Done') ? 'done' : stored?.startsWith('Failed') ? 'failed' : null), detail: stored });
}));

/** Transcribe (again) the finished video already stored for this production. */
router.post('/:id/transcription', route(async (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const a = db.prepare("SELECT * FROM assets WHERE production_id = ? AND local_path IS NOT NULL AND kind = 'video' ORDER BY id DESC LIMIT 1").get(id);
  if (!a) return fail(res, 404, 'NOT_FOUND', 'Upload the finished video first');
  transcribeInBackground(id, a.local_path, a.name);
  return ok(res, { state: 'running' }, 'Transcribing the finished video');
}));

export { LOCAL };
export default router;
