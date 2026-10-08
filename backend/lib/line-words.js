import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { durationOf } from './audio-join.js';

const run = promisify(execFile);
const VOICE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'voice');
const PYTHON = process.env.VOICE_PYTHON || join(VOICE_DIR, '.venv', 'bin', 'python');
// Small is plenty for a ten-second line whose words are already known, and
// several times quicker to load than the medium model used for transcripts.
const ALIGN_MODEL = process.env.ALIGN_MODEL || 'small';

const norm = (w) => String(w).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');

/** The line as the screen shows it: words with their punctuation, each tagged with its sentence. */
export function tokens(text) {
  const out = [];
  let sentence = 0;
  for (const w of String(text).replace(/\[CONFIRM:[^\]]*\]/gi, ' ').split(/\s+/).filter(Boolean)) {
    out.push({ w, s: sentence });
    if (/[.!?]["”’)]?$/.test(w)) sentence++;
  }
  // A line that ends without a full stop does not open an empty sentence.
  return out;
}

/** The line's sentences, in order, as text. */
export function sentencesOf(text) {
  const t = tokens(text);
  const n = t.length ? t[t.length - 1].s + 1 : 0;
  return Array.from({ length: n }, (_, i) => t.filter((x) => x.s === i).map((x) => x.w).join(' '));
}

/** Spread the words over the clip by length: right enough to follow along until Whisper answers. */
function estimate(toks, duration) {
  const lead = Math.min(0.15, duration * 0.05);
  const span = Math.max(0.1, duration - lead * 2);
  const weight = toks.map((t) => Math.max(2, t.w.length) + (/[,;:]$/.test(t.w) ? 3 : /[.!?]$/.test(t.w) ? 6 : 0));
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  let at = lead;
  return toks.map((t, i) => {
    const len = (weight[i] / total) * span;
    const out = { ...t, start: round(at), end: round(at + len * 0.85) };
    at += len;
    return out;
  });
}
const round = (n) => Math.round(n * 100) / 100;

/**
 * Match the spoken words (Whisper's) to the script's, longest common
 * subsequence. A respelled name ("Wee-SPIN-tah") will not match its script
 * spelling, so unmatched words take the time between their matched neighbours.
 */
function align(toks, spoken, duration) {
  const a = toks.map((t) => norm(t.w));
  const b = spoken.map((w) => norm(w.word));
  const n = a.length; const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const hit = new Array(n).fill(null);
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (a[i] && a[i] === b[j]) { hit[i] = spoken[j]; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const out = toks.map((t, k) => (hit[k] ? { ...t, start: hit[k].start, end: hit[k].end } : { ...t }));
  // Fill each run of unmatched words evenly between the matched words around it.
  for (let k = 0; k < n; k++) {
    if (out[k].start != null) continue;
    let e = k; while (e < n && out[e].start == null) e++;
    const from = k ? out[k - 1].end : (spoken[0]?.start ?? 0);
    const to = e < n ? out[e].start : (spoken[m - 1]?.end ?? duration);
    const step = Math.max(0.02, (to - from) / (e - k));
    for (let x = k; x < e; x++) out[x] = { ...out[x], start: round(from + step * (x - k)), end: round(from + step * (x - k + 1) - 0.02) };
    k = e - 1;
  }
  return out;
}

/**
 * Each word of a line with when it is said in its audio. Whisper runs once per
 * file and text, on this Mac; the answer is kept beside the audio.
 */
export async function wordsFor(file, text) {
  const toks = tokens(text);
  const duration = (await durationOf(file)) ?? 0;
  const key = createHash('sha1').update(text).digest('hex').slice(0, 12);
  const cache = `${file}.words.json`;
  if (existsSync(cache)) {
    try {
      const c = JSON.parse(readFileSync(cache, 'utf8'));
      if (c.key === key) return { words: c.words, duration, source: 'whisper' };
    } catch { /* remake it */ }
  }
  if (!existsSync(PYTHON)) return { words: estimate(toks, duration), duration, source: 'estimate' };
  try {
    const { stdout } = await run(PYTHON, [join(VOICE_DIR, 'transcribe.py'), file, '--json', '--words', '--model', ALIGN_MODEL],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    const spoken = JSON.parse(stdout).segments.flatMap((s) => s.words ?? []);
    if (!spoken.length) throw new Error('no words');
    const words = align(toks, spoken, duration);
    writeFileSync(cache, JSON.stringify({ key, words }));
    return { words, duration, source: 'whisper' };
  } catch {
    return { words: estimate(toks, duration), duration, source: 'estimate' };
  }
}
