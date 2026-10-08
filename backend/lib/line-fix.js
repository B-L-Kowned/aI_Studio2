import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../db/index.js';
import { speakLocal, localFile, voicesDir, setPronunciation, LOCAL } from './local-voice.js';
import { presenterCasting } from './casting.js';
import { invalidateTakes } from './segments.js';
import { durationOf } from './audio-join.js';
import { wordsFor, sentencesOf } from './line-words.js';
import { enqueue } from './voice-batch.js';

/**
 * Fix one line's voice without remaking the video around it.
 *
 * A fix is the smallest piece that still blends: the SENTENCE holding the word
 * you clicked, remade and cut back in at the pauses either side of it, level-
 * matched, with the original silences kept. A single word cannot be remade on
 * its own — a new reading of one word never matches the pitch and pace of the
 * words around it — and a sentence that runs straight into the next with no
 * pause has nowhere clean to cut, so then the whole line is remade instead.
 *
 * Several readings are made, and you choose by ear. Choosing one is hearing it,
 * so the new take arrives approved; the old one is kept to go back to.
 */
const run = promisify(execFile);
const RATE = 24000;
const MIN_GAP = 0.08;            // a pause shorter than this is not a pause
const MARGIN = 0.02;             // how far into a pause a cut sits from the word
export const DELIVERY = { calmer: 0.35, natural: undefined, energy: 0.8 };
// One reading first — you hear it in ~10s instead of waiting ~40s for three.
// "Another reading" makes the next one only when it is wanted.
const VARIANTS = { sentence: 1, line: 1 };
const MAX_READINGS = 5;

const jobs = new Map();          // segmentId → job
const err = (message, code) => Object.assign(new Error(message), { code });
const r2 = (n) => Math.round(n * 100) / 100;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = (term) => new RegExp(`(?<![\\w-])${escape(term)}(?![\\w-])`, 'i');

function context(segmentId) {
  const db = getDb();
  const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
  if (!seg) throw err('Line not found', 'NOT_FOUND');
  const take = db.prepare('SELECT * FROM takes WHERE segment_id = ? ORDER BY version DESC LIMIT 1').get(segmentId);
  const file = take?.local_path && !take.stale ? localFile(take.local_path) : null;
  if (!file) throw err('This line has no voice yet — make it first, then fix it.', 'NO_TAKE');
  const cast = seg.presenter_id ? presenterCasting(seg.presenter_id) : null;
  if (cast?.voice?.provider !== LOCAL) throw err('Only lines in your own voice can be fixed here.', 'NOT_LOCAL');
  const speed = db.prepare('SELECT voice_speed FROM productions WHERE id = ?').get(seg.production_id)?.voice_speed ?? undefined;
  return { seg, take, file, voice: cast.voice, speed };
}

/** Where in the take a sentence sits, and whether there is a pause on each side to cut in. */
function spanOf(words, index, duration) {
  const own = words.filter((w) => w.s === index);
  if (!own.length) return null;
  const prev = words.filter((w) => w.s < index).pop();
  const next = words.find((w) => w.s > index);
  const start = own[0].start; const end = own[own.length - 1].end;
  const gapBefore = prev ? start - prev.end : start;
  const gapAfter = next ? next.start - end : duration - end;
  if ((prev && gapBefore < MIN_GAP) || (next && gapAfter < MIN_GAP)) return null;
  return {
    cutA: prev ? prev.end + MARGIN : 0,
    cutB: next ? next.start - MARGIN : duration,
    padBefore: prev ? gapBefore - MARGIN : Math.max(0.05, start),
    padAfter: next ? gapAfter - MARGIN : Math.max(0.15, gapAfter),
    start, end, hasPrev: !!prev, hasNext: !!next, duration,
  };
}

/** Which sentence a fix touches, or null when it has to be the whole line. */
function targetSentence({ kind, text, newText, term, sentence }) {
  const before = sentencesOf(text);
  if (before.length < 2) return null;
  if (kind === 'words') {
    const after = sentencesOf(newText);
    if (after.length !== before.length) return null;
    const changed = before.map((s, i) => (s !== after[i] ? i : -1)).filter((i) => i >= 0);
    return changed.length === 1 ? changed[0] : null;
  }
  if (kind === 'pronounce') {
    const hits = before.map((s, i) => (termRe(term).test(s) ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : null;
  }
  return Number.isInteger(sentence) && sentence >= 0 && sentence < before.length ? sentence : null;
}

async function meanVolume(file, from, to) {
  const args = ['-v', 'info', '-nostats'];
  if (from != null) args.push('-ss', String(from), '-to', String(to));
  args.push('-i', file, '-af', 'volumedetect', '-f', 'null', '-');
  const { stderr } = await run('ffmpeg', args);
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  return m ? Number(m[1]) : null;
}

const FMT = `aformat=sample_fmts=fltp:sample_rates=${RATE}:channel_layouts=mono`;
// Trim the new reading's own lead-in and tail: the original's pauses are kept instead.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,'
  + 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse';

/** Cut a new reading of one sentence into the take, at the pauses around it. */
async function splice(orig, raw, span, out) {
  const level = await Promise.all([meanVolume(orig, span.start, span.end), meanVolume(raw)]);
  const gain = level[0] != null && level[1] != null ? Math.max(-6, Math.min(6, level[0] - level[1])) : 0;
  const parts = []; const filters = [];
  if (span.cutA > 0) {
    filters.push(`[0:a]atrim=0:${span.cutA.toFixed(3)},asetpts=N/SR/TB,${FMT},areverse,afade=t=in:d=0.012,areverse[a]`);
    parts.push('[a]');
  }
  filters.push(`aevalsrc=0:d=${Math.max(0.01, span.padBefore).toFixed(3)}:s=${RATE}:c=mono,${FMT}[p1]`);
  parts.push('[p1]');
  filters.push(`[1:a]${FMT},${TRIM},volume=${gain.toFixed(2)}dB,afade=t=in:d=0.012,areverse,afade=t=in:d=0.02,areverse[v]`);
  parts.push('[v]');
  filters.push(`aevalsrc=0:d=${Math.max(0.01, span.padAfter).toFixed(3)}:s=${RATE}:c=mono,${FMT}[p2]`);
  parts.push('[p2]');
  if (span.hasNext) {
    filters.push(`[0:a]atrim=start=${span.cutB.toFixed(3)},asetpts=N/SR/TB,${FMT},afade=t=in:d=0.012[c]`);
    parts.push('[c]');
  }
  filters.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1[out]`);
  await run('ffmpeg', ['-v', 'error', '-y', '-i', orig, '-i', raw, '-filter_complex', filters.join(';'),
    '-map', '[out]', '-c:a', 'pcm_s16le', '-ar', String(RATE), '-ac', '1', out]);
  // Where the new reading sits in the result, to play it with a second either side.
  const total = (await durationOf(out)) ?? 0;
  const from = span.cutA + span.padBefore;
  const to = total - span.padAfter - (span.hasNext ? span.duration - span.cutB : 0);
  return { from: r2(from), to: r2(Math.max(from, to)), total: r2(total), gain: r2(gain) };
}

const view = (job) => job && {
  id: job.id, segmentId: job.segmentId, state: job.state, kind: job.kind, scope: job.scope,
  sentence: job.sentence, sentenceText: job.sentenceText, newText: job.newText, note: job.note,
  total: job.total, error: job.error ?? null, others: job.others ?? null,
  baseTakeId: job.baseTakeId,
  // The take as it is, and where the sentence sits in it, to compare against.
  base: { url: `/api/takes/${job.baseTakeId}/audio`, from: job.origFrom ?? 0, to: job.origTo ?? null },
  variants: job.variants.map((v) => ({
    n: v.n, url: `/api/line-fix/${job.segmentId}/audio/${v.n}?j=${job.id}`, duration: v.duration, from: v.from, to: v.to,
  })),
};

export const fixJob = (segmentId) => view(jobs.get(Number(segmentId)));
export function variantFile(segmentId, n, jobId) {
  const job = jobs.get(Number(segmentId));
  if (!job || job.id !== String(jobId)) return null;
  const v = job.variants.find((x) => x.n === Number(n));
  return v ? localFile(v.rel) : null;
}

/**
 * Start fixing a line. `kind` is one of:
 *   pronounce { term, sayAs } — saved to your pronunciations, used everywhere
 *   words     { text }        — the line's new wording
 *   delivery  { delivery, sentence? } — calmer / natural / energy
 *   retry     { sentence? }   — new readings of the same words
 */
export async function startFix(segmentId, body = {}) {
  const id = Number(segmentId);
  if (jobs.get(id)?.state === 'running') throw err('This line is already being fixed.', 'BUSY');
  const { seg, take, file, voice, speed } = context(id);
  const kind = String(body.kind ?? '');
  if (!['pronounce', 'words', 'delivery', 'retry'].includes(kind)) throw err('Unknown fix.', 'BAD_FIX');

  let newText = seg.text;
  let note;
  let term;
  if (kind === 'pronounce') {
    term = String(body.term ?? '').trim();
    if (!term || !termRe(term).test(seg.text)) throw err(`"${term}" is not in this line.`, 'BAD_TERM');
    const p = setPronunciation({ term, sayAs: body.sayAs, checked: true });
    note = `"${p.term}" said as "${p.sayAs}"`;
  } else if (kind === 'words') {
    newText = String(body.text ?? '').replace(/\s+/g, ' ').trim();
    if (!newText) throw err('The line cannot be empty.', 'EMPTY');
    if (/\[CONFIRM/i.test(newText)) throw err('Resolve the [CONFIRM: …] first.', 'UNCONFIRMED');
    if (newText === seg.text) throw err('The words have not changed.', 'UNCHANGED');
    note = 'Reworded';
  } else if (kind === 'delivery') {
    if (!(body.delivery in DELIVERY)) throw err('Unknown delivery.', 'BAD_FIX');
    note = { calmer: 'Calmer reading', natural: 'Natural reading', energy: 'More energy' }[body.delivery];
  } else note = 'New reading';

  const sentence = targetSentence({ kind, text: seg.text, newText, term, sentence: Number(body.sentence) });
  const words = sentence == null ? null : (await wordsFor(file, seg.text)).words;
  const duration = await durationOf(file);
  const span = sentence == null ? null : spanOf(words, sentence, duration);
  const scope = span ? 'sentence' : 'line';
  const say = scope === 'sentence' ? sentencesOf(newText)[sentence] : newText;

  const job = {
    id: Date.now().toString(36), segmentId: id, productionId: seg.production_id, state: 'running', kind, scope,
    sentence: scope === 'sentence' ? sentence : null, sentenceText: scope === 'sentence' ? say : null,
    newText, note, term, baseTakeId: take.id, total: VARIANTS[scope], variants: [],
    origFrom: span?.start ?? 0, origTo: span?.end ?? null,
  };
  if (kind === 'pronounce') job.others = othersSaying(term, id);
  jobs.set(id, job);

  // What a reading needs, kept on the job so "Another reading" makes one more the same way.
  job.gen = { dir: `takes/${seg.production_id}/fix`, voiceId: voice.id, say, span, file, scope, speed,
    exaggeration: kind === 'delivery' ? DELIVERY[body.delivery] : undefined };
  readings(job, job.total);
  return view(job);
}

/** Make `count` more readings for a job, one after another, in the background. */
function readings(job, count) {
  const g = job.gen;
  job.state = 'running';
  (async () => {
    mkdirSync(join(voicesDir(), g.dir), { recursive: true });
    for (let k = 0; k < count; k++) {
      // Chosen or closed: stop making readings nobody will hear.
      if (job.cancelled) break;
      const n = job.variants.length + 1;
      const raw = `${g.dir}/${job.segmentId}-${job.id}-${n}-raw.wav`;
      const out = `${g.dir}/${job.segmentId}-${job.id}-${n}.wav`;
      const opts = { speed: g.speed, seed: Math.floor(Math.random() * 2 ** 31), exaggeration: g.exaggeration };
      if (g.scope === 'line') {
        const spoken = await speakLocal(g.voiceId, g.say, out, opts);
        job.variants.push({ n, rel: out, duration: r2(spoken.duration), from: 0, to: r2(spoken.duration) });
      } else {
        await speakLocal(g.voiceId, g.say, raw, opts);
        const at = await splice(g.file, localFile(raw), g.span, join(voicesDir(), out));
        rmSync(localFile(raw), { force: true });
        job.variants.push({ n, rel: out, duration: at.total, from: at.from, to: at.to });
      }
    }
    job.state = 'done';
  })().catch((e) => { job.state = job.variants.length ? 'done' : 'failed'; job.error = e.message; });
}

/** One more reading of the same fix. */
export function anotherReading(segmentId) {
  const job = jobs.get(Number(segmentId));
  if (!job?.gen) throw err('Start a fix first.', 'NOT_FOUND');
  if (job.state === 'running') throw err('A reading is already being made.', 'BUSY');
  if (job.variants.length >= MAX_READINGS) throw err(`That is ${MAX_READINGS} readings — pick one, or try something else.`, 'LIMIT');
  job.total = job.variants.length + 1;
  readings(job, 1);
  return view(job);
}

/** Use one of the readings: it becomes the line's take, approved, and the old one is kept. */
export function applyFix(segmentId, n) {
  const id = Number(segmentId);
  const job = jobs.get(id);
  const v = job?.variants.find((x) => x.n === Number(n));
  if (!v) throw err('That reading is not available any more — fix the line again.', 'NOT_FOUND');
  const db = getDb();
  const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(id);
  const base = db.prepare('SELECT * FROM takes WHERE id = ?').get(job.baseTakeId);
  const latest = db.prepare('SELECT * FROM takes WHERE segment_id = ? ORDER BY version DESC LIMIT 1').get(id);
  if (!seg || latest?.id !== base?.id) throw err('The line changed while it was being fixed — fix it again.', 'STALE');

  return db.transaction(() => {
    if (job.newText !== seg.text) setLineText(seg, job.newText);
    retire(id, `Replaced by a fix: ${job.note}`);
    const version = (db.prepare('SELECT MAX(version) m FROM takes WHERE segment_id = ?').get(id).m ?? 0) + 1;
    const takeId = db.prepare(
      `INSERT INTO takes (segment_id, version, text, voice_asset_id, duration, local_path, heard, origin_take_id, fix_note)
       VALUES (?,?,?,?,?,?,1,?,?)`
    ).run(id, version, job.newText, base.voice_asset_id, v.duration, v.rel, base.id, job.note).lastInsertRowid;
    db.prepare('UPDATE takes SET audio_url = ? WHERE id = ?').run(`/api/takes/${takeId}/audio`, takeId);
    staleRenders(id, `The voice changed: ${job.note}`);
    job.cancelled = true;
    jobs.delete(id);
    return { takeId, note: job.note, others: job.others ?? null };
  })();
}

/** Put the take a fix replaced back, words and all. */
export function revertFix(segmentId) {
  const id = Number(segmentId);
  const db = getDb();
  const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(id);
  const latest = db.prepare('SELECT * FROM takes WHERE segment_id = ? ORDER BY version DESC LIMIT 1').get(id);
  const origin = latest?.origin_take_id ? db.prepare('SELECT * FROM takes WHERE id = ?').get(latest.origin_take_id) : null;
  if (!seg || !origin) throw err('This line has no fix to undo.', 'NOT_FOUND');
  return db.transaction(() => {
    if (origin.text !== seg.text) setLineText(seg, origin.text);
    retire(id, 'Fix undone');
    const version = latest.version + 1;
    const takeId = db.prepare(
      `INSERT INTO takes (segment_id, version, text, voice_asset_id, duration, local_path, heard, origin_take_id, fix_note)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(id, version, origin.text, origin.voice_asset_id, origin.duration, origin.local_path, origin.heard ? 1 : 0,
      origin.origin_take_id, origin.fix_note).lastInsertRowid;
    db.prepare('UPDATE takes SET audio_url = ? WHERE id = ?').run(`/api/takes/${takeId}/audio`, takeId);
    staleRenders(id, 'The voice changed: fix undone');
    return { takeId };
  })();
}

export function discardFix(segmentId) {
  const job = jobs.get(Number(segmentId));
  if (job) job.cancelled = true;
  jobs.delete(Number(segmentId));
}

/**
 * Change one line of an approved script in place. The script stays approved —
 * you just heard and chose the new wording — and the production line moves with
 * it, so a rebuild does not undo the fix.
 */
function setLineText(seg, text) {
  const db = getDb();
  const accepted = db.prepare("SELECT id FROM script_versions WHERE production_id = ? AND status = 'accepted' ORDER BY version DESC").get(seg.production_id);
  if (accepted) {
    const line = db.prepare('SELECT id FROM script_segments WHERE script_version_id = ? ORDER BY position LIMIT 1 OFFSET ?').get(accepted.id, seg.position);
    if (line) db.prepare('UPDATE script_segments SET text = ? WHERE id = ?').run(text, line.id);
  }
  db.prepare("UPDATE segments SET text = ?, updated_at = datetime('now') WHERE id = ?").run(text, seg.id);
}

// Superseded, not disapproved: the take keeps whether it was heard, so undoing
// a fix brings back an approved line approved.
function retire(segmentId, reason) {
  getDb().prepare('UPDATE takes SET stale = 1, stale_reason = ? WHERE segment_id = ? AND stale = 0').run(reason, segmentId);
}

function staleRenders(segmentId, reason) {
  getDb().prepare('UPDATE segment_renders SET stale = 1, stale_reason = ? WHERE segment_id = ? AND stale = 0').run(reason, segmentId);
}

/** Other lines, in other videos, whose voice still says a term the old way. */
export function othersSaying(term, exceptSegmentId) {
  const re = termRe(term);
  const rows = getDb().prepare(
    `SELECT s.id, s.production_id, s.text, p.title FROM segments s
       JOIN productions p ON p.id = s.production_id
       JOIN takes t ON t.id = (SELECT id FROM takes WHERE segment_id = s.id ORDER BY version DESC LIMIT 1)
      WHERE t.local_path IS NOT NULL AND t.stale = 0 AND s.id != ?`
  ).all(Number(exceptSegmentId) || 0).filter((r) => re.test(r.text));
  const videos = [...new Map(rows.map((r) => [r.production_id, { productionId: r.production_id, title: r.title }])).values()];
  return { term, lines: rows.length, segmentIds: rows.map((r) => r.id), videos };
}

/** Remake every other line that says the term, in the background voice queue. */
export function remakeOthers(term, exceptSegmentId) {
  const o = othersSaying(term, exceptSegmentId);
  for (const id of o.segmentIds) invalidateTakes(id, `"${term}" is now said differently`);
  const queued = enqueue(o.videos.map((v) => v.productionId));
  return { lines: o.lines, videos: o.videos.length, queued };
}
