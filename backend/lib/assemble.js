import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../db/index.js';
import { storageRoot } from './exporter.js';
import { folderFor } from './storage.js';
import { voicesDir } from './local-voice.js';
import { madeBy } from './made-by.js';
import { editSettings, keptSpans, PYTHON, MEDIA_TOOLS } from './cleanup.js';
import { recordFinal } from './media.js';
import { importLocalVideo } from './video-library.js';
import { visualsFor } from './visuals.js';

const run = promisify(execFile);
const SIZE = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };
const FPS = 30;
const FILLER = /^(u+m+|u+h+m*|e+r+m*|a+h+|h+m+|m+h*m+)[.,!?…]*$/i;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const f3 = (n) => n.toFixed(3);

async function measure(file, cache) {
  if (!cache.has(file)) {
    const { stdout } = await run(PYTHON, [MEDIA_TOOLS, 'frames', file], { timeout: 5 * 60 * 1000 });
    cache.set(file, JSON.parse(stdout));
  }
  return cache.get(file);
}

/**
 * Crop to the output's shape around your face — a third of the way down, as a
 * camera operator would frame you — then scale, and lift the exposure toward
 * a mid grey when the footage is dark or bright.
 */
function videoChain(info, settings, W, H) {
  const A = W / H;
  const { width: w, height: h } = info;
  let cw; let ch;
  if (w / h > A) { ch = even(h); cw = even(h * A); } else { cw = even(w); ch = even(w / A); }
  const face = settings.reframe === 'face' ? info.face : null;
  const cx = Math.round(clamp(face ? face.x * w - cw / 2 : (w - cw) / 2, 0, w - cw));
  const cy = Math.round(clamp(face ? face.y * h - ch * 0.35 : (h - ch) / 2, 0, h - ch));
  const parts = [`crop=${cw}:${ch}:${cx}:${cy}`, `scale=${W}:${H}`, `fps=${FPS}`, 'setsar=1', 'format=yuv420p'];
  if (settings.look === 'auto' && info.luma) {
    const gamma = clamp(Math.log(0.47) / Math.log(clamp(info.luma / 255, 0.05, 0.95)), 0.8, 1.5);
    parts.push(`eq=gamma=${gamma.toFixed(3)}:saturation=1.08:contrast=1.03`);
  }
  return parts.join(',');
}

// Screen recordings are fitted, not cropped: cutting the edge off a screen
// loses the very thing being shown.
const fitChain = (W, H) => `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x1f2230,fps=${FPS},setsar=1,format=yuv420p`;

const AUDIO_CLEAN = 'highpass=f=80,afftdn=nf=-25,loudnorm=I=-14:TP=-1.5:LRA=11';

/** Group words into caption chunks: at most five words, 2.4 s, or a sentence. */
function chunk(words) {
  const out = []; let cur = [];
  const flush = () => { if (cur.length) out.push({ text: cur.map((w) => w.word).join(' '), start: cur[0].start, end: cur[cur.length - 1].end }); cur = []; };
  for (const w of words) {
    if (cur.length && (cur.length >= 5 || w.end - cur[0].start > 2.4)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.word)) flush();
  }
  flush();
  return out;
}

/** Spread a line's words across the time it plays, by length. */
function spread(text, start, end) {
  const words = String(text).replace(/\[CONFIRM:[^\]]*\]/gi, ' ').split(/\s+/).filter(Boolean);
  const total = words.reduce((n, w) => n + w.length + 1, 0) || 1;
  let at = start;
  return words.map((w) => { const d = ((w.length + 1) / total) * (end - start); const r = { word: w, start: at, end: at + d }; at += d; return r; });
}

/** Burn caption images onto a finished file: one overlay track, built from timed PNGs. */
async function burnCaptions(src, dest, chunks, W, H, dir) {
  const spec = join(dir, 'draw.json');
  writeFileSync(spec, JSON.stringify({ width: W, height: H, dir: join(dir, 'caps'), captions: chunks.map((c) => c.text) }));
  await run(PYTHON, [MEDIA_TOOLS, 'draw', spec], { timeout: 10 * 60 * 1000 });
  const list = []; let at = 0;
  const img = (name, d) => { if (d > 0.01) list.push(`file '${join(dir, 'caps', name)}'`, `duration ${f3(d)}`); };
  chunks.forEach((c, i) => {
    img('blank.png', c.start - at);
    const end = Math.max(c.end, c.start + 0.6);
    img(`cap_${String(i).padStart(4, '0')}.png`, end - Math.max(c.start, at));
    at = Math.max(at, end);
  });
  img('blank.png', 1);
  list.push(`file '${join(dir, 'caps', 'blank.png')}'`); // the concat demuxer drops the last duration otherwise
  writeFileSync(join(dir, 'caps.txt'), list.join('\n'));
  await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-f', 'concat', '-safe', '0', '-i', join(dir, 'caps.txt'),
    '-filter_complex', '[1:v]format=rgba[c];[0:v][c]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v]',
    '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', '-movflags', '+faststart', dest],
  { timeout: 60 * 60 * 1000 });
}

// ---------------------------------------------------------------- the two paths
/** You on camera: the chosen take of each line, minus its cuts, in order. */
async function selfPlan(productionId, settings, preview) {
  const db = getDb();
  const lines = db.prepare('SELECT id, position, text FROM segments WHERE production_id = ? ORDER BY position').all(productionId);
  const pieces = []; const missing = [];
  for (const l of lines) {
    const t = db.prepare('SELECT * FROM line_takes WHERE segment_id = ? AND chosen = 1').get(l.id);
    if (!t || !existsSync(t.path)) { missing.push(l.position + 1); continue; }
    const take = { inPoint: t.in_point, outPoint: t.out_point ?? t.duration, cuts: JSON.parse(t.cuts ?? '[]') };
    const words = JSON.parse(t.words ?? 'null');
    for (const [a, b] of keptSpans(take, settings)) pieces.push({ file: t.path, a, b, words, line: l });
  }
  if (!pieces.length) throw Object.assign(new Error('Record the lines first — there is nothing to put together yet.'), { code: 'NO_TAKES' });
  if (missing.length && !preview) {
    throw Object.assign(new Error(`Line${missing.length === 1 ? '' : 's'} ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no take yet.`), { code: 'MISSING_TAKES' });
  }
  return { pieces, missing };
}

async function selfBuild(productionId, settings, preview, dir, out) {
  const [W0, H0] = SIZE[settings.aspect];
  const [W, H] = preview ? [even(W0 / 3), even(H0 / 3)] : [W0, H0];
  const { pieces, missing } = await selfPlan(productionId, settings, preview);
  const cache = new Map();
  const files = [...new Set(pieces.map((p) => p.file))];
  for (const f of files) await measure(f, cache);

  const graph = [];
  pieces.forEach((p, k) => {
    const i = files.indexOf(p.file);
    const len = p.b - p.a;
    graph.push(`[${i}:v]trim=start=${f3(p.a)}:end=${f3(p.b)},setpts=PTS-STARTPTS,${videoChain(cache.get(p.file), settings, W, H)}[v${k}]`);
    graph.push(`[${i}:a]atrim=start=${f3(p.a)}:end=${f3(p.b)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,`
      + `afade=t=in:d=0.02,afade=t=out:st=${f3(Math.max(0, len - 0.02))}:d=0.02[a${k}]`);
  });
  graph.push(`${pieces.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${pieces.length}:v=1:a=1[v][araw]`);
  graph.push(`[araw]${settings.cleanAudio ? AUDIO_CLEAN : 'anull'}[a]`);
  const body = join(dir, 'body.mp4');
  await run('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', graph.join(';'),
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'medium', '-crf', preview ? '28' : '19',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', body], { timeout: 2 * 60 * 60 * 1000 });

  // Cutaways: where the shot list has a screen recording for a section, it
  // fills the frame for that stretch while your voice carries on.
  let at = 0; const lineSpan = new Map();
  for (const p of pieces) {
    const span = lineSpan.get(p.line.id) ?? { start: at, end: at };
    span.end = at + (p.b - p.a);
    lineSpan.set(p.line.id, span);
    at += p.b - p.a;
  }
  const cut = await cutaways(productionId, pieces, lineSpan, W, H, preview, body, dir);

  // Captions: the words heard, moved onto the new timeline; fillers dropped.
  let chunks = [];
  if (settings.captions) {
    const timeline = []; let at = 0;
    for (const p of pieces) {
      const words = p.words
        ? p.words.filter((w) => w.start >= p.a - 0.05 && w.end <= p.b + 0.05 && !FILLER.test(w.word))
          .map((w) => ({ word: w.word, start: at + Math.max(0, w.start - p.a), end: at + Math.min(p.b, w.end) - p.a }))
        : [];
      timeline.push(...words);
      at += p.b - p.a;
    }
    // Takes not listened to yet: their line's text, spread over the piece.
    if (!timeline.length) {
      let t = 0;
      for (const p of pieces) { timeline.push(...spread(p.line.text, t, t + (p.b - p.a))); t += p.b - p.a; }
    }
    chunks = chunk(timeline);
  }
  if (chunks.length) await burnCaptions(cut.file, out, chunks, W, H, dir);
  else await run('/bin/mv', [cut.file, out]);
  return { pieces: pieces.length, missing, captions: chunks.length, cutaways: cut.count };
}

/**
 * Lay each section's screen recording over the part of the assembled video
 * where that section's lines play. Sections are matched to lines the way the
 * shot list places them (same lines, same order).
 */
async function cutaways(productionId, pieces, lineSpan, W, H, preview, body, dir) {
  const db = getDb();
  const rows = visualsFor(productionId).rows.filter((r) => r.shotType === 'screen' && r.recording);
  if (!rows.length) return { file: body, count: 0 };
  const textOf = new Map(pieces.map((p) => [p.line.text, p.line.id]));
  const overlays = [];
  for (const r of rows) {
    const spans = r.lines.map((l) => lineSpan.get(textOf.get(l.text))).filter(Boolean);
    const file = db.prepare('SELECT local_path FROM assets WHERE id = ?').get(r.recording.id)?.local_path;
    if (!spans.length || !file || !existsSync(file)) continue;
    overlays.push({ file, start: Math.min(...spans.map((x) => x.start)), end: Math.max(...spans.map((x) => x.end)) });
  }
  if (!overlays.length) return { file: body, count: 0 };
  const graph = []; let last = '0:v';
  overlays.forEach((o, k) => {
    const len = o.end - o.start;
    graph.push(`[${k + 1}:v]trim=duration=${f3(len)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${f3(len)},trim=duration=${f3(len)},`
      + `${fitChain(W, H)},setpts=PTS+${f3(o.start)}/TB[c${k}]`);
    graph.push(`[${last}][c${k}]overlay=0:0:eof_action=pass:enable='between(t,${f3(o.start)},${f3(o.end)})'[o${k}]`);
    last = `o${k}`;
  });
  const file = join(dir, 'cutaways.mp4');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', body, ...overlays.flatMap((o) => ['-i', o.file]), '-filter_complex', graph.join(';'),
    '-map', `[${last}]`, '-map', '0:a', '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'medium', '-crf', preview ? '28' : '19',
    '-c:a', 'copy', '-movflags', '+faststart', file], { timeout: 2 * 60 * 60 * 1000 });
  return { file, count: overlays.length };
}

/** Your voice over screen recordings: the full read, with each section's recording (or a title card) on screen. */
async function voiceBuild(productionId, settings, preview, dir, out) {
  const { kitFor, fullReadFile } = await import('../routes/editor-kit.js');
  const kit = kitFor(productionId);
  if (!kit?.allApproved) throw Object.assign(new Error('Approve the audio for every line in Voice first — the video is cut to it.'), { code: 'NOT_APPROVED' });
  const [W0, H0] = SIZE[settings.aspect];
  const [W, H] = preview ? [even(W0 / 3), even(H0 / 3)] : [W0, H0];
  const audio = await fullReadFile(kit);
  const sections = kit.sections.length ? kit.sections : [{ n: 1, title: kit.p.title, start: 0, onscreenText: '' }];
  const spans = sections.map((s, i) => ({ s, start: i ? s.start : 0, end: sections[i + 1]?.start ?? kit.total }));

  const cards = spans.filter((x) => !x.s.recording).map((x) => ({ name: `card${x.s.n}`, title: x.s.title, text: x.s.onscreenText || '' }));
  if (cards.length) {
    writeFileSync(join(dir, 'cards.json'), JSON.stringify({ width: W, height: H, dir: join(dir, 'cards'), cards }));
    await run(PYTHON, [MEDIA_TOOLS, 'draw', join(dir, 'cards.json')]);
  }
  const inputs = []; const graph = [];
  spans.forEach((x, k) => {
    const len = Math.max(0.1, x.end - x.start);
    if (x.s.recording) {
      inputs.push('-i', x.s.recording.path);
      graph.push(`[${k}:v]trim=duration=${f3(len)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${f3(len)},trim=duration=${f3(len)},${fitChain(W, H)}[v${k}]`);
    } else {
      inputs.push('-loop', '1', '-t', f3(len), '-i', join(dir, 'cards', `card${x.s.n}.png`));
      graph.push(`[${k}:v]scale=${W}:${H},fps=${FPS},setsar=1,format=yuv420p,trim=duration=${f3(len)}[v${k}]`);
    }
  });
  const a = spans.length;
  graph.push(`${spans.map((_, k) => `[v${k}]`).join('')}concat=n=${spans.length}:v=1:a=0[v]`);
  graph.push(`[${a}:a]aresample=48000,aformat=channel_layouts=stereo${settings.cleanAudio ? ',loudnorm=I=-14:TP=-1.5:LRA=11' : ''}[a]`);
  const body = join(dir, 'body.mp4');
  await run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-i', audio, '-filter_complex', graph.join(';'),
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'medium', '-crf', preview ? '28' : '19',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', body], { timeout: 2 * 60 * 60 * 1000 });

  const chunks = settings.captions ? chunk(kit.lines.flatMap((l) => spread(l.text, l.start, l.start + l.length))) : [];
  if (chunks.length) await burnCaptions(body, out, chunks, W, H, dir);
  else await run('/bin/mv', [body, out]);
  return { pieces: spans.length, missing: [], captions: chunks.length };
}

/**
 * The sound of your recording, cleaned up exactly as the export would be —
 * cuts applied, clean audio on — for an avatar to be re-performed to it.
 */
export async function cleanRecordingAudio(productionId) {
  const dir = mkdtempSync(join(tmpdir(), 'studio-recording-audio-'));
  try {
    const settings = { ...editSettings(productionId), captions: false };
    const body = join(dir, 'body.mp4');
    // The small, fast build: only its sound is kept, and that is full quality.
    const { missing } = await selfBuild(productionId, settings, true, dir, body);
    if (missing.length) {
      throw Object.assign(new Error(`Line${missing.length === 1 ? '' : 's'} ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no take yet.`), { code: 'MISSING_TAKES' });
    }
    const out = join(voicesDir(), 'samples', 'heygen', `${productionId}-from-recording.wav`);
    mkdirSync(join(out, '..'), { recursive: true });
    await run('ffmpeg', ['-v', 'error', '-y', '-i', body, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]);
    return { file: out, seconds: Number(stdout) || 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ jobs
const jobs = new Map();
export const assembleJob = (productionId) => jobs.get(productionId) ?? null;
export const previewFile = (productionId) => join(voicesDir(), 'samples', 'edit', String(productionId), 'preview.mp4');

/**
 * Put the video together, in the background. A preview is a third of the
 * size and fast; an export is full size, filed in the video's folder, and
 * recorded as the finished video — which marks it done and lets it publish.
 */
export function assemble(productionId, { preview = true } = {}) {
  if (jobs.get(productionId)?.state === 'running') return jobs.get(productionId);
  const made = madeBy(productionId);
  if (made === 'heygen') {
    throw Object.assign(new Error('A HeyGen video is put together by its render — export it from the render below.'), { code: 'HEYGEN' });
  }
  const job = { state: 'running', preview, startedAt: Date.now() };
  jobs.set(productionId, job);
  (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-assemble-'));
    try {
      const settings = editSettings(productionId);
      let out;
      if (preview) {
        out = previewFile(productionId);
        mkdirSync(join(out, '..'), { recursive: true });
      } else {
        const db = getDb();
        const stem = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — /.exec(db.prepare('SELECT title FROM productions WHERE id = ?').get(productionId)?.title ?? '')?.[1] ?? `production-${productionId}`;
        const shape = folderFor(productionId);
        const folder = join(storageRoot(), ...(shape ? shape.parts : [`production-${productionId}`]));
        mkdirSync(folder, { recursive: true });
        const v = (db.prepare('SELECT MAX(version) m FROM exports WHERE production_id = ?').get(productionId).m ?? 0) + 1;
        job.name = `${stem} final v${v}`;
        out = join(folder, `${job.name}.mp4`);
      }
      const built = made === 'voice'
        ? await voiceBuild(productionId, settings, preview, dir, out)
        : await selfBuild(productionId, settings, preview, dir, out);
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]);
      Object.assign(job, built, { duration: Number(stdout) || null, bytes: statSync(out).size, finishedAt: Date.now() });
      if (!preview) {
        // The same edit in the other shapes asked for, filed beside it.
        job.extras = [];
        for (const aspect of settings.alsoExport.filter((a) => a !== settings.aspect)) {
          job.step = `Exporting ${aspect} as well…`;
          const extraName = `${job.name} ${aspect.replace(':', 'x')}`;
          const extra = join(out, '..', `${extraName}.mp4`);
          const sub = mkdtempSync(join(tmpdir(), 'studio-assemble-'));
          try {
            const build = made === 'voice' ? voiceBuild : selfBuild;
            await build(productionId, { ...settings, aspect }, false, sub, extra);
            await importLocalVideo({ path: extra, productionId, name: extraName });
            job.extras.push(extraName);
          } finally { rmSync(sub, { recursive: true, force: true }); }
        }
        job.step = null;
        const cuts = getDb().prepare('SELECT cuts FROM line_takes WHERE production_id = ? AND chosen = 1').all(productionId)
          .reduce((n, t) => n + JSON.parse(t.cuts ?? '[]').filter((c) => c.on).length, 0);
        const r = await recordFinal(productionId, out, job.name, { editsApplied: cuts, note: 'exported in the app' });
        job.exportVersion = r.exportVersion;
      }
      job.state = 'done';
    } catch (err) {
      Object.assign(job, { state: 'failed', error: err.message.split('\n').slice(-3).join(' ') });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  return job;
}
