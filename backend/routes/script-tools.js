import { Router } from 'express';
import { createReadStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getDb } from '../db/index.js';
import { clearStale } from '../lib/stale.js';
import { resolveSpeaker, presenterCasting } from '../lib/casting.js';
import { listLocalVoices, speakLocal, localFile, voicesDir, SPEED_RANGE, LOCAL } from '../lib/local-voice.js';
import { invalidateTakes } from '../lib/segments.js';
import { joinWavs } from '../lib/audio-join.js';
import { visualsFor, updateVisualRow, approveVisuals } from '../lib/visuals.js';
import { receiveUpload, acceptFinishedVideo, acceptRecording, transcribeInBackground, transcriptionFor } from '../lib/media.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
// What a planned script was timed at, used only until the voice has been measured.
const PLANNING_WPM = 150;
const secs = (rt) => { const [m, s] = String(rt ?? '0:00').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

/** The local voice this production's narration is spoken in (the voice cast on "Pat"). */
export function narrationVoice() {
  const p = resolveSpeaker('Pat');
  const v = p ? presenterCasting(p.id)?.voice : null;
  const voices = listLocalVoices();
  return voices.find((x) => x.id === v?.id) ?? voices[0] ?? null;
}

/** Everything the Script screen needs to judge length: pace, speed, target, section budgets. */
router.get(
  '/:id/script-timing',
  route(async (req, res) => {
    const db = getDb();
    const p = db.prepare('SELECT * FROM productions WHERE id = ?').get(Number(req.params.id));
    if (!p) return fail(res, 404, 'NOT_FOUND', 'Production not found');
    const voice = narrationVoice();
    const natural = voice?.naturalWpm ?? null;
    const speed = p.voice_speed ?? voice?.speed ?? 1;
    const sections = db.prepare('SELECT title, runtime FROM outline_sections WHERE production_id = ? ORDER BY position').all(p.id)
      .map((s) => ({ title: s.title, runtime: s.runtime, seconds: secs(s.runtime) }));
    return ok(res, {
      voice: voice && { id: voice.id, name: voice.name, naturalWpm: natural, measuredSeconds: voice.paceSeconds },
      naturalWpm: natural ?? PLANNING_WPM,
      measured: natural != null,
      speed, speedRange: SPEED_RANGE,
      wpm: Math.round((natural ?? PLANNING_WPM) * speed),
      targetSeconds: secs(p.target_runtime),
      sections,
    });
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
    const rel = `samples/listen/${line.script_version_id}-${line.id}.wav`;
    try {
      const r = await speakLocal(voice.id, line.text, rel, { speed });
      return ok(res, { url: `/api/productions/${id}/script/${line.script_version_id}/listen/${line.id}?t=${Date.now()}`, duration: r.duration },
        `${r.duration?.toFixed?.(1) ?? '?'}s at ${r.speed}× — nothing spent`);
    } catch (err) {
      return fail(res, err.code === 'VOICE_OFFLINE' ? 503 : 502, err.code ?? 'VOICE_FAILED', err.message);
    }
  })
);

router.get(
  '/:id/script/:versionId/listen/:lineId',
  route(async (req, res) => {
    const file = localFile(`samples/listen/${Number(req.params.versionId)}-${Number(req.params.lineId)}.wav`);
    if (!file) return fail(res, 404, 'NOT_FOUND', 'Not generated yet');
    res.type('audio/wav');
    return createReadStream(file).pipe(res);
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
    const key = createHash('sha1').update(`${voice.id}|${speed ?? ''}|${l.text}`).digest('hex').slice(0, 16);
    const rel = `samples/listen/cache/${key}.wav`;
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
