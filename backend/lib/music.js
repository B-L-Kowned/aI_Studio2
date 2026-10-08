import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { storageRoot } from './exporter.js';

/**
 * Background music: one shared folder of tracks you supply (royalty-free —
 * the app cannot know a track's licence, so it only plays what you put here),
 * any of which a video can sit on, ducked under your voice.
 */
const run = promisify(execFile);
const TYPES = { 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
  'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac' };
const EXT = new Set(Object.values(TYPES));
const MAX = 200 * 1024 ** 2;
export const LEVELS = { low: 0.1, medium: 0.16, high: 0.24 };

export function musicDir() {
  const dir = join(storageRoot(), 'Music');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function listTracks() {
  const dir = musicDir();
  const files = readdirSync(dir).filter((f) => EXT.has(extname(f).toLowerCase()) && !f.startsWith('.'));
  const out = [];
  for (const f of files.sort((a, b) => a.localeCompare(b))) {
    const path = join(dir, f);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).catch(() => ({ stdout: '' }));
    out.push({ name: f, seconds: Number(stdout) || null, bytes: statSync(path).size });
  }
  return out;
}

export const trackPath = (name) => {
  const path = join(musicDir(), basename(String(name ?? '')));
  return name && EXT.has(extname(path).toLowerCase()) && existsSync(path) ? path : null;
};

/** A track uploaded as the raw request body, filed in the Music folder under its own name. */
export async function receiveTrack(req, name) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) throw Object.assign(new Error('Upload an audio file (mp3, wav, m4a or aac).'), { code: 'BAD_TYPE' });
  if (Number(req.headers['content-length'] ?? 0) > MAX) throw Object.assign(new Error('That track is larger than 200 MB.'), { code: 'TOO_LARGE' });
  const safe = (String(name || 'track').replace(/[/\\:*?"<>|]/g, '-').replace(/\.[a-z0-9]+$/i, '').trim().slice(0, 100) || 'track') + ext;
  const dest = join(musicDir(), safe);
  try { await pipeline(req, createWriteStream(dest)); } catch {
    rmSync(dest, { force: true });
    throw Object.assign(new Error('The upload was interrupted.'), { code: 'UPLOAD_FAILED' });
  }
  if (!statSync(dest).size) { rmSync(dest, { force: true }); throw Object.assign(new Error('The upload was empty.'), { code: 'EMPTY' }); }
  return safe;
}

/**
 * Lay a track under a finished file's voice: looped to length, ducked by the
 * voice (sidechain), faded in and out, then brought back to broadcast loudness.
 * The picture is copied untouched.
 */
export async function addMusic(src, dest, track, level = 'medium', { normalize = true } = {}) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]);
  const total = Number(stdout) || 0;
  const vol = LEVELS[level] ?? LEVELS.medium;
  const fadeOut = Math.max(0, total - 2.5).toFixed(3);
  const graph = [
    `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},afade=t=in:d=1.5,afade=t=out:st=${fadeOut}:d=2.5[mus]`,
    '[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice][key]',
    // Firm enough to sit about 15 dB under speech (measured: -37 dB to -53 dB), slow enough on release not to
    // pump back up between words.
    '[mus][key]sidechaincompress=threshold=0.008:ratio=20:attack=10:release=900:knee=4[duck]',
    `[voice][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0${normalize ? ',loudnorm=I=-14:TP=-1.5:LRA=11' : ''}[a]`,
  ];
  await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-stream_loop', '-1', '-i', track, '-filter_complex', graph.join(';'),
    '-map', '0:v', '-map', '[a]', '-t', total.toFixed(3), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', dest],
  { timeout: 60 * 60 * 1000 });
}
