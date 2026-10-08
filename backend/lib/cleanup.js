import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../db/index.js';
import { trackPath } from './music.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const VOICE_DIR = join(here, '..', '..', 'voice');
export const PYTHON = process.env.VOICE_PYTHON || join(VOICE_DIR, '.venv', 'bin', 'python');
export const MEDIA_TOOLS = join(VOICE_DIR, 'media_tools.py');

// Only sounds that are never words. "So", "like" and "you know" can be
// meant, so they are left for you to cut by hand.
const FILLER = /^(u+m+|u+h+m*|e+r+m*|a+h+|h+m+|m+h*m+)[.,!?…]*$/i;
const GAP = 0.7;        // a pause longer than this is shortened…
const KEEP_PAUSE = 0.35; // …to about this
const HEAD = 0.15;      // breathing room kept before the first word
const TAIL = 0.3;       // and after the last

export const DEFAULT_SETTINGS = {
  removeFillers: true, tightenGaps: true, trimEnds: true,
  cleanAudio: true, look: 'auto', aspect: '16:9', reframe: 'face', captions: false,
  // Other shapes made by the same export — 9:16 for Shorts, Reels and TikTok.
  alsoExport: [],
  // A track from the shared Music folder, ducked under your voice.
  music: null, musicLevel: 'medium',
};

export function editSettings(productionId) {
  const raw = getDb().prepare('SELECT edit_settings FROM productions WHERE id = ?').get(productionId)?.edit_settings;
  try { return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) }; } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveEditSettings(productionId, patch) {
  const allowed = {
    removeFillers: 'boolean', tightenGaps: 'boolean', trimEnds: 'boolean', cleanAudio: 'boolean', captions: 'boolean',
    look: ['auto', 'off'], aspect: ['16:9', '9:16', '1:1'], reframe: ['face', 'center'], musicLevel: ['low', 'medium', 'high'],
  };
  const next = editSettings(productionId);
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k === 'music') {
      if (v !== null && !trackPath(v)) throw Object.assign(new Error(`There is no track called "${v}" in the Music folder.`), { code: 'BAD_SETTING' });
      next.music = v;
      continue;
    }
    if (k === 'alsoExport') {
      if (!Array.isArray(v) || v.some((a) => !['16:9', '9:16', '1:1'].includes(a))) {
        throw Object.assign(new Error('alsoExport takes a list of 16:9, 9:16 and 1:1.'), { code: 'BAD_SETTING' });
      }
      next.alsoExport = [...new Set(v)];
      continue;
    }
    const rule = allowed[k];
    if (!rule) continue;
    if (rule === 'boolean' ? typeof v !== 'boolean' : !rule.includes(v)) {
      throw Object.assign(new Error(`${k} cannot be ${JSON.stringify(v)}.`), { code: 'BAD_SETTING' });
    }
    next[k] = v;
  }
  getDb().prepare('UPDATE productions SET edit_settings = ? WHERE id = ?').run(JSON.stringify(next), productionId);
  return next;
}

/**
 * The cuts a take's words suggest, inside its in/out span: filler sounds,
 * pauses longer than GAP (shortened, not removed), and the dead air before the
 * first word and after the last. Each is { start, end, kind, label, on }.
 */
export function proposeCuts(words, inPoint, outPoint) {
  const inside = words.filter((w) => w.end > inPoint && w.start < outPoint);
  const fillers = inside.filter((w) => FILLER.test(w.word));
  const spoken = inside.filter((w) => !FILLER.test(w.word));
  const cuts = [];
  // Whisper times a short "uh" tightly — the sound runs past its edges — so a
  // filler cut reaches into the quiet on either side, stopping short of the
  // neighbouring words.
  for (const f of fillers) {
    const before = spoken.filter((w) => w.end <= f.start + 0.01).pop();
    const after = spoken.find((w) => w.start >= f.end - 0.01);
    const start = Math.max(inPoint, before ? before.end + 0.06 : f.start - 0.25, f.start - 0.3);
    const end = Math.min(outPoint, after ? after.start - 0.06 : f.end + 0.3, f.end + 0.35);
    cuts.push({ start: Math.min(start, f.start), end: Math.max(end, f.end), kind: 'filler', label: f.word.replace(/[.,!?…]/g, '').toLowerCase() });
  }
  for (let i = 1; i < spoken.length; i++) {
    const gap = spoken[i].start - spoken[i - 1].end;
    if (gap > GAP) {
      cuts.push({ start: spoken[i - 1].end + KEEP_PAUSE / 2, end: spoken[i].start - KEEP_PAUSE / 2, kind: 'gap', label: `${gap.toFixed(1)}s pause` });
    }
  }
  if (spoken.length) {
    const head = spoken[0].start - HEAD;
    const tail = spoken[spoken.length - 1].end + TAIL;
    if (head - inPoint > 0.15) cuts.push({ start: inPoint, end: head, kind: 'head', label: `${(head - inPoint).toFixed(1)}s before you start` });
    if (outPoint - tail > 0.15) cuts.push({ start: tail, end: outPoint, kind: 'tail', label: `${(outPoint - tail).toFixed(1)}s after you finish` });
  }
  return cuts.sort((a, b) => a.start - b.start).map((c) => ({ ...c, start: +c.start.toFixed(3), end: +c.end.toFixed(3), on: true }));
}

/** The spans of a take that play, after the cuts that are on and allowed by the settings. */
export function keptSpans(take, settings) {
  const allowed = { filler: settings.removeFillers, gap: settings.tightenGaps, head: settings.trimEnds, tail: settings.trimEnds };
  const cuts = (take.cuts ?? []).filter((c) => c.on && allowed[c.kind]).sort((a, b) => a.start - b.start);
  const spans = [];
  let at = take.inPoint;
  for (const c of cuts) {
    if (c.start > at) spans.push([at, Math.min(c.start, take.outPoint)]);
    at = Math.max(at, c.end);
  }
  if (at < take.outPoint) spans.push([at, take.outPoint]);
  return spans.filter(([a, b]) => b - a > 0.08);
}

const jobs = new Map();
export const analysisJob = (productionId) => jobs.get(productionId) ?? null;

/** Listen to every chosen take (or the ones given) and propose its cuts. */
export function analyzeTakes(productionId, takeIds) {
  if (jobs.get(productionId)?.state === 'running') return jobs.get(productionId);
  const db = getDb();
  const takes = (takeIds?.length
    ? db.prepare(`SELECT * FROM line_takes WHERE production_id = ? AND id IN (${takeIds.map(() => '?').join(',')})`).all(productionId, ...takeIds)
    : db.prepare('SELECT * FROM line_takes WHERE production_id = ? AND chosen = 1').all(productionId));
  const job = { state: 'running', total: takes.length, startedAt: Date.now() };
  jobs.set(productionId, job);
  (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-analyze-'));
    try {
      if (!takes.length) throw new Error('No takes to listen to yet.');
      const spec = join(dir, 'takes.json');
      writeFileSync(spec, JSON.stringify(takes.map((t) => ({
        id: t.id, file: t.path, start: t.in_point, end: t.out_point ?? t.duration,
      }))));
      const { stdout } = await run(PYTHON, [MEDIA_TOOLS, 'analyze', spec], { maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60 * 1000 });
      const save = db.prepare('UPDATE line_takes SET words = ?, cuts = ? WHERE id = ?');
      let fillers = 0; let saved = 0;
      for (const r of JSON.parse(stdout)) {
        const t = takes.find((x) => x.id === r.id);
        const cuts = proposeCuts(r.words, t.in_point, t.out_point ?? t.duration);
        fillers += cuts.filter((c) => c.kind === 'filler').length;
        saved += cuts.reduce((n, c) => n + (c.end - c.start), 0);
        save.run(JSON.stringify(r.words), JSON.stringify(cuts), r.id);
      }
      Object.assign(job, { state: 'done', fillers, seconds: +saved.toFixed(1) });
    } catch (err) {
      Object.assign(job, { state: 'failed', error: err.message });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  return job;
}

export function toggleCut(productionId, takeId, index, on) {
  const db = getDb();
  const t = db.prepare('SELECT cuts FROM line_takes WHERE id = ? AND production_id = ?').get(takeId, productionId);
  if (!t) throw Object.assign(new Error('No such take.'), { code: 'NOT_FOUND' });
  const cuts = JSON.parse(t.cuts ?? '[]');
  if (!cuts[index]) throw Object.assign(new Error('No such cut.'), { code: 'NOT_FOUND' });
  cuts[index].on = !!on;
  db.prepare('UPDATE line_takes SET cuts = ? WHERE id = ?').run(JSON.stringify(cuts), takeId);
  return cuts;
}
