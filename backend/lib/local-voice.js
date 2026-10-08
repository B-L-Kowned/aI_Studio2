import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { getDb, defaultDbPath } from '../db/index.js';

const run = promisify(execFile);

/**
 * Your own voice, synthesised on this machine (voice/server.py, Chatterbox).
 *
 * A local voice is a provider asset like any HeyGen voice — provider 'local',
 * kind 'voice' — so a presenter is cast with it the same way. What differs is
 * that an audition costs nothing in every mode, and that the audio it makes IS
 * the shipping audio: the take you approve is the file the video uses.
 */
export const LOCAL = 'local';
const SERVICE = process.env.VOICE_URL || 'http://127.0.0.1:3533';
if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(SERVICE)) {
  throw new Error(`VOICE_URL must be a loopback address, got ${SERVICE}`);
}
// One line of script; the service refuses longer text, and so do we, first.
const MAX_CHARS = 1200;
// Delivery the owner chose as standard: clone B, "normal" (2026-10-06).
export const DEFAULT_DELIVERY = { exaggeration: 0.5, cfgWeight: 0.5 };

export function voicesDir() {
  const dir = resolve(process.env.VOICE_ROOT || join(dirname(defaultDbPath()), 'voices'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** A path the service may read or write: inside the voices folder, always. */
function inside(path) {
  const root = voicesDir();
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw Object.assign(new Error('Path is outside the voices folder'), { code: 'BAD_PATH' });
  }
  return abs;
}

export async function serviceStatus() {
  try {
    const res = await fetch(`${SERVICE}/health`, { signal: AbortSignal.timeout(2000) });
    const h = await res.json();
    return { reachable: true, loaded: !!h.loaded, device: h.device, busy: !!h.busy, error: h.error ?? null };
  } catch {
    return { reachable: false, loaded: false, device: null, busy: false, error: 'The local voice service is not running.' };
  }
}

async function durationOf(file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file]);
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

const settingsOf = (row) => {
  let raw = {};
  try { raw = JSON.parse(row.raw || '{}'); } catch { /* keep defaults */ }
  return {
    exaggeration: Number(raw.exaggeration ?? DEFAULT_DELIVERY.exaggeration),
    cfgWeight: Number(raw.cfgWeight ?? DEFAULT_DELIVERY.cfgWeight),
    reference: raw.reference,
    referenceSeconds: raw.referenceSeconds ?? null,
    // 1 = the clone's natural pace; applied after synthesis, pitch kept.
    speed: Number(raw.speed ?? 1),
    // The clone's natural pace, measured from everything it has said at 1×.
    paceWords: Number(raw.paceWords ?? 0),
    paceSeconds: Number(raw.paceSeconds ?? 0),
    naturalWpm: raw.paceSeconds >= 10 ? Math.round((raw.paceWords / raw.paceSeconds) * 60) : null,
  };
};
export const SPEED_RANGE = [0.75, 1.25];

export function listLocalVoices() {
  return getDb()
    .prepare("SELECT * FROM provider_assets WHERE provider = ? AND kind = 'voice' ORDER BY name")
    .all(LOCAL)
    .map((r) => ({ id: r.id, remoteId: r.remote_id, name: r.name, provider: LOCAL, ...settingsOf(r) }));
}

/**
 * Make a voice from a recording of the person. 5–60 seconds of clean speech;
 * the file is normalised to 24 kHz mono WAV, which is what the model reads.
 */
export async function createLocalVoice({ name, audio, exaggeration, cfgWeight }) {
  const clean = String(name ?? '').trim().slice(0, 80);
  if (!clean) throw Object.assign(new Error('A voice needs a name.'), { code: 'EMPTY' });
  if (!Buffer.isBuffer(audio) || audio.length < 20_000) {
    throw Object.assign(new Error('That recording is too small to be 5 seconds of speech.'), { code: 'TOO_SHORT' });
  }
  const db = getDb();
  let slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voice';
  if (db.prepare('SELECT 1 FROM provider_assets WHERE provider = ? AND remote_id = ?').get(LOCAL, slug)) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }
  const dir = inside(slug);
  mkdirSync(dir, { recursive: true });
  const upload = join(dir, 'upload.bin');
  const reference = join(dir, 'reference.wav');
  writeFileSync(upload, audio);
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', upload, '-ac', '1', '-ar', '24000', reference]);
  } catch {
    rmSync(dir, { recursive: true, force: true });
    throw Object.assign(new Error('That file could not be read as audio.'), { code: 'BAD_AUDIO' });
  } finally {
    rmSync(upload, { force: true });
  }
  const seconds = await durationOf(reference);
  if (!seconds || seconds < 5 || seconds > 60) {
    rmSync(dir, { recursive: true, force: true });
    throw Object.assign(
      new Error(`The recording is ${seconds ? seconds.toFixed(1) : 'an unknown number of'} seconds; use 5–60 seconds of clear speech.`),
      { code: 'BAD_LENGTH' }
    );
  }
  const settings = {
    reference: relative(voicesDir(), reference),
    referenceSeconds: Math.round(seconds * 10) / 10,
    exaggeration: clamp(exaggeration, 0.25, 1.5, DEFAULT_DELIVERY.exaggeration),
    cfgWeight: clamp(cfgWeight, 0, 1, DEFAULT_DELIVERY.cfgWeight),
  };
  const id = db.prepare(
    `INSERT INTO provider_assets (provider, kind, remote_id, name, raw, owned) VALUES (?, 'voice', ?, ?, ?, 1)`
  ).run(LOCAL, slug, clean, JSON.stringify(settings)).lastInsertRowid;
  return listLocalVoices().find((v) => v.id === id);
}

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function updateLocalVoice(id, { name, exaggeration, cfgWeight, speed }) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM provider_assets WHERE id = ? AND provider = ? AND kind = 'voice'").get(id, LOCAL);
  if (!row) throw Object.assign(new Error('No such local voice.'), { code: 'NOT_FOUND' });
  const s = settingsOf(row);
  const next = {
    reference: s.reference, referenceSeconds: s.referenceSeconds,
    paceWords: s.paceWords, paceSeconds: s.paceSeconds,
    speed: speed === undefined ? s.speed : clamp(speed, ...SPEED_RANGE, s.speed),
    exaggeration: exaggeration === undefined ? s.exaggeration : clamp(exaggeration, 0.25, 1.5, s.exaggeration),
    cfgWeight: cfgWeight === undefined ? s.cfgWeight : clamp(cfgWeight, 0, 1, s.cfgWeight),
  };
  db.prepare('UPDATE provider_assets SET name = ?, raw = ? WHERE id = ?')
    .run(name !== undefined && String(name).trim() ? String(name).trim().slice(0, 80) : row.name, JSON.stringify(next), id);
  return listLocalVoices().find((v) => v.id === id);
}

// ------------------------------------------------------------ pronunciation
const pron = (r) => ({ id: r.id, term: r.term, sayAs: r.say_as, note: r.note, checked: !!r.checked });

export function listPronunciations() {
  return getDb().prepare('SELECT * FROM pronunciations ORDER BY term COLLATE NOCASE').all().map(pron);
}

/** Add or change how a term is said. Keyed on the term, case-insensitively. */
export function setPronunciation({ term, sayAs, note, checked }) {
  const t = String(term ?? '').trim().slice(0, 80);
  const say = String(sayAs ?? '').trim().slice(0, 120);
  if (!t || !say) throw Object.assign(new Error('A pronunciation needs the term and how to say it.'), { code: 'EMPTY' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM pronunciations WHERE term = ?').get(t);
  if (existing) {
    // Changing how it is said un-checks it: the old approval was of a different sound.
    const changed = existing.say_as !== say;
    db.prepare('UPDATE pronunciations SET say_as = ?, note = ?, checked = ? WHERE id = ?').run(
      say, note === undefined ? existing.note : String(note).slice(0, 200),
      checked === undefined ? (changed ? 0 : existing.checked) : checked ? 1 : 0, existing.id);
    return pron(db.prepare('SELECT * FROM pronunciations WHERE id = ?').get(existing.id));
  }
  const id = db.prepare('INSERT INTO pronunciations (term, say_as, note, checked) VALUES (?,?,?,?)')
    .run(t, say, String(note ?? '').slice(0, 200), checked ? 1 : 0).lastInsertRowid;
  return pron(db.prepare('SELECT * FROM pronunciations WHERE id = ?').get(id));
}

export function deletePronunciation(id) {
  const r = getDb().prepare('DELETE FROM pronunciations WHERE id = ?').run(id);
  if (!r.changes) throw Object.assign(new Error('No such pronunciation.'), { code: 'NOT_FOUND' });
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Rewrite the text that is SPOKEN. Whole words only, longest term first, so
 * "DomusLogic ERP" can be its own entry without "DomusLogic" eating it. A term
 * inside a domain (domuslogic.com) is still a word on both sides of the dot.
 */
export function applyPronunciations(text) {
  let out = String(text);
  const rows = getDb().prepare('SELECT term, say_as FROM pronunciations').all()
    .sort((a, b) => b.term.length - a.term.length);
  for (const r of rows) {
    out = out.replace(new RegExp(`(?<![\\w-])${escape(r.term)}(?![\\w-])`, 'gi'), r.say_as);
  }
  return out;
}

/**
 * Speak one line in a local voice. `out` is relative to the voices folder.
 * Throws rather than returning an empty file: a take with no sound in it
 * would otherwise look exactly like one with sound.
 */
/** Add one utterance at natural pace to the voice's measured words-per-minute. */
function recordPace(row, words, seconds) {
  if (!words || !seconds) return;
  let raw = {};
  try { raw = JSON.parse(row.raw || '{}'); } catch { /* start fresh */ }
  raw.paceWords = Number(raw.paceWords ?? 0) + words;
  raw.paceSeconds = Math.round((Number(raw.paceSeconds ?? 0) + seconds) * 100) / 100;
  getDb().prepare('UPDATE provider_assets SET raw = ? WHERE id = ?').run(JSON.stringify(raw), row.id);
}

/** Change tempo without changing pitch. ffmpeg's atempo takes 0.5–2 per stage. */
async function retime(file, speed) {
  if (!speed || Math.abs(speed - 1) < 0.005) return;
  const tmp = `${file}.tempo.wav`;
  await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-filter:a', `atempo=${speed.toFixed(3)}`, tmp]);
  rmSync(file, { force: true });
  await run('mv', [tmp, file]);
}

// `seed` asks for a different reading of the same words; `exaggeration`
// overrides the voice's own delivery for one line (calmer / more energy).
export async function speakLocal(voiceAssetId, text, out, { speed, seed, exaggeration } = {}) {
  const row = getDb().prepare("SELECT * FROM provider_assets WHERE id = ? AND provider = ?").get(voiceAssetId, LOCAL);
  if (!row) throw Object.assign(new Error('No such local voice.'), { code: 'NOT_FOUND' });
  const line = String(text ?? '').trim();
  if (!line) throw Object.assign(new Error('Nothing to say — the line is empty.'), { code: 'EMPTY' });
  if (line.length > MAX_CHARS) {
    throw Object.assign(new Error(`This line is ${line.length} characters; split it under ${MAX_CHARS}.`), { code: 'TOO_LONG' });
  }
  const s = settingsOf(row);
  const target = inside(out);
  let res;
  try {
    res = await fetch(`${SERVICE}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: applyPronunciations(line), reference: inside(s.reference), out: target,
        exaggeration: exaggeration === undefined ? s.exaggeration : clamp(exaggeration, 0.25, 1.5, s.exaggeration),
        cfg_weight: s.cfgWeight,
        ...(seed === undefined ? {} : { seed: Math.floor(Number(seed)) || 0 }),
      }),
      // A long line on a busy service queues behind the one before it.
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch {
    throw Object.assign(new Error('The local voice service is not running — start it with pm2 (ai-video-voice).'),
      { code: 'VOICE_OFFLINE' });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Local voice failed: ${body.error ?? res.status}`), { code: 'VOICE_FAILED' });
  if (!existsSync(target) || statSync(target).size < 1000) {
    throw Object.assign(new Error('Local voice produced no audio.'), { code: 'VOICE_FAILED' });
  }
  // Measure the natural pace before any retiming: that is the clone's own speed.
  recordPace(row, line.split(/\s+/).filter(Boolean).length, body.duration);
  const tempo = clamp(speed ?? s.speed, ...SPEED_RANGE, 1);
  await retime(target, tempo);
  return { file: target, duration: await durationOf(target) ?? body.duration, secondsTaken: body.seconds_taken, speed: tempo };
}

/** Resolve a stored take path for streaming, refusing anything outside the folder. */
export function localFile(path) {
  try { const abs = inside(path); return existsSync(abs) ? abs : null; } catch { return null; }
}
