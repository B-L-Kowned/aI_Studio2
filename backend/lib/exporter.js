import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { getDb } from '../db/index.js';
import { folderFor } from './storage.js';

// An export used to be a row in a table. It said "ready" and there was no file
// anywhere — you could publish it, and the thing published was the row.
//
// An export is now a FILE: the rendered video fetched to local storage, with the
// edit decisions applied if ffmpeg can apply them. Everything downstream reads
// the file, so "ready" means the bytes exist.

/** Where exports land. The seeded default is a fixture path that may not exist. */
export function storageRoot() {
  const w = getDb().prepare('SELECT storage_path FROM workspace WHERE id = 1').get();
  const configured = (w?.storage_path ?? '').trim();
  // A path nobody can write to is worse than no path: it fails at the moment
  // you have a finished video and nowhere to put it.
  if (configured && !configured.startsWith('/Users/pat/')) return resolve(configured);
  return join(homedir(), 'Movies', 'AI Video Studio');
}

export const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';

export async function hasFfmpeg() {
  try {
    await run(ffmpegPath(), ['-version']);
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', no);
    p.on('exit', (code) => (code === 0 ? ok(err) : no(
      Object.assign(new Error(err.trim().split('\n').slice(-3).join(' ') || `${cmd} exited ${code}`),
        { code: 'FFMPEG_FAILED' })
    )));
  });
}

const exists = (p) => access(p).then(() => true, () => false);

/** Fetch the rendered video to disk. Streams, so a long video is not buffered. */
export async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw Object.assign(
      new Error(`The provider returned ${res.status} for the rendered video.`),
      { code: 'DOWNLOAD_FAILED' }
    );
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const { size } = await stat(dest);
  if (size === 0) {
    await unlink(dest).catch(() => {});
    throw Object.assign(new Error('The downloaded video was empty.'), { code: 'EMPTY_DOWNLOAD' });
  }
  return size;
}

const seconds = (t) => {
  if (t == null) return null;
  const parts = String(t).split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

// The tools whose target is a span of the timeline, named as the editor names
// them. Matching on a lowercase 'trim' quietly skipped every real decision,
// because nothing in this app ever writes that word.
const TIME_RANGE_TOOLS = new Set(['Trim / Cut', 'Create Short Clip']);

/**
 * Turn the edit decision list into ffmpeg work.
 *
 * Only decisions this build can actually perform are applied. A decision it
 * cannot perform is REPORTED, not silently dropped — an export that quietly
 * ignores half the edit list is the same lie as a render that never happened.
 */
export function planEdits(decisions) {
  const applied = [];
  const skipped = [];
  for (const d of decisions) {
    // A decision's `target` is free text; a trim writes it as "0:05-0:12".
    const [a, b] = String(d.target ?? '').split(/\s*[-–]\s*/);
    const from = seconds(a);
    const to = seconds(b);
    const isRange = TIME_RANGE_TOOLS.has(d.kind);
    if (isRange && from != null && to != null && to > from) {
      applied.push({ kind: d.kind, from, to, note: d.note });
    } else {
      skipped.push({
        kind: d.kind,
        target: d.target ?? '',
        why: isRange
          ? `"${d.target}" is not a time range like 0:05-0:12`
          : 'not something this build can apply to the file',
      });
    }
  }
  return { applied, skipped };
}

async function applyTrims(input, output, trims) {
  // Keep only the kept ranges, re-encoded so the cuts land on exact frames.
  // Stream copy would snap each cut to the nearest keyframe, which is a
  // different edit from the one that was asked for.
  const filter = trims
    .map((t, i) =>
      `[0:v]trim=start=${t.from}:end=${t.to},setpts=PTS-STARTPTS[v${i}];` +
      `[0:a]atrim=start=${t.from}:end=${t.to},asetpts=PTS-STARTPTS[a${i}];`)
    .join('') +
    trims.map((_, i) => `[v${i}][a${i}]`).join('') +
    `concat=n=${trims.length}:v=1:a=1[v][a]`;

  await run(ffmpegPath(), [
    '-y', '-i', input,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-movflags', '+faststart',
    output,
  ]);
}

/**
 * A stand-in clip for Fixtures mode: colour bars and a tone, labelled on screen.
 * It is a real mp4 — the point is that everything downstream handles a real file
 * — while being impossible to confuse with a rendered take.
 */
export async function placeholder(dest, secs = 10) {
  // No drawtext: it needs libfreetype, and this machine's ffmpeg is built
  // without it — an export that depends on an optional filter fails on the
  // machine that lacks it, which is exactly where a stand-in is needed most.
  // SMPTE bars and a 440Hz tone are unmistakable without any text.
  await run(ffmpegPath(), [
    '-y',
    '-f', 'lavfi', '-i', `smptebars=size=1280x720:rate=30:duration=${secs}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
    dest,
  ]);
  const { size } = await stat(dest);
  return size;
}

export async function probeDuration(file) {
  try {
    const out = await new Promise((ok, no) => {
      const p = spawn(process.env.FFPROBE_PATH || 'ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', file,
      ]);
      let s = '';
      p.stdout.on('data', (d) => { s += d; });
      p.on('error', no);
      p.on('exit', (c) => (c === 0 ? ok(s) : no(new Error('ffprobe failed'))));
    });
    const n = Number(String(out).trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Produce the export file for a render.
 *
 * Returns what actually happened, including edits it could not perform, so the
 * caller can say so rather than implying a clean export.
 */
export async function buildExport({ productionId, render, decisions, slug, version }) {
  // A simulated render has no video to fetch. Refusing outright would make the
  // whole downstream half of the app unusable offline, so Fixtures produces a
  // REAL file that is obviously a stand-in — colour bars and a tone. The file
  // exists, has bytes and a duration, and could never be mistaken for a take.
  const simulated = !render?.video_url || String(render.remote_id ?? '').startsWith('fx_');
  if (simulated && !render?.video_url && !(await hasFfmpeg())) {
    throw Object.assign(
      new Error('This render has no video, and ffmpeg is not installed to stand one in.'),
      { code: 'NO_VIDEO' }
    );
  }

  // Company / Track / Production. A flat folder of video files is unusable at
  // fifty companies, and the layering already existed — it just was not
  // reaching the filesystem.
  const shape = folderFor(productionId);
  const dir = join(storageRoot(), ...(shape ? shape.parts : [slug || `production-${productionId}`]));
  await mkdir(dir, { recursive: true });

  const source = join(dir, `v${version}-source.mp4`);
  const final = join(dir, `v${version}.mp4`);

  const bytes = render?.video_url
    ? await download(render.video_url, source)
    : await placeholder(source, seconds(render?.duration) ?? 10);
  const { applied, skipped } = planEdits(decisions ?? []);

  let editsApplied = 0;
  let note = null;

  if (applied.length && (await hasFfmpeg())) {
    try {
      await applyTrims(source, final, applied);
      editsApplied = applied.length;
      await unlink(source).catch(() => {});
    } catch (err) {
      // A failed edit must not produce a file that looks edited.
      note = `Edits could not be applied (${err.message}); exported the untouched render instead.`;
      await unlink(final).catch(() => {});
    }
  } else if (applied.length) {
    note = 'ffmpeg is not installed, so the edit list was not applied.';
  }

  if (!(await exists(final))) {
    // No edits, or edits failed: the source IS the export.
    await run('/bin/mv', [source, final]).catch(async () => {
      const { copyFile } = await import('node:fs/promises');
      await copyFile(source, final);
      await unlink(source).catch(() => {});
    });
  }

  const { size } = await stat(final);
  return {
    path: final,
    bytes: size,
    sourceBytes: bytes,
    simulated: !render?.video_url,
    duration: await probeDuration(final),
    editsApplied,
    editsSkipped: skipped,
    note,
  };
}
