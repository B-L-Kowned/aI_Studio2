import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDb, defaultDbPath } from '../db/index.js';

const run = promisify(execFile);

/**
 * Read the script aloud, locally, for nothing.
 *
 * The audition is a HeyGen call: it uses the voice that will actually ship,
 * which is the point of it, and it spends the plan. That makes it the wrong
 * tool for the question you ask FIRST — does this scan, is it the right
 * length, does that line trip. You should be able to hear the words before
 * committing anything to a provider.
 *
 * So: macOS `say`, which is local, instant and free. It is deliberately NOT
 * the shipping voice, and it deliberately CANNOT satisfy the render gate — a
 * stand-in approving a sound the video never makes is the one thing the gate
 * exists to prevent. This answers "are the words right"; the audition answers
 * "is the delivery right". Two questions, two tools.
 */

const MEDIA_DIR = join(dirname(defaultDbPath()), 'readthrough');

/** The system voice to read with. Not a character choice — a legibility one. */
const DEFAULT_VOICE = 'Alex';

export function readthroughDir() {
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });
  return MEDIA_DIR;
}

async function durationOf(file) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/**
 * Read one production's script. Returns per-line timings and one audio file of
 * the whole thing, because pacing is a property of the sequence, not the line.
 */
export async function readThrough(productionId, { voice = DEFAULT_VOICE, rate = 175 } = {}) {
  const db = getDb();
  const prod = db.prepare('SELECT id, title, target_runtime FROM productions WHERE id = ?').get(productionId);
  if (!prod) throw Object.assign(new Error('Production not found'), { code: 'NOT_FOUND' });

  const segs = db
    .prepare('SELECT id, position, speaker, text FROM segments WHERE production_id = ? ORDER BY position')
    .all(productionId);
  if (!segs.length) {
    throw Object.assign(
      new Error('No segments yet — accept a script and build segments first.'),
      { code: 'NO_SEGMENTS' }
    );
  }

  const dir = readthroughDir();
  // One directory per production, rebuilt each time: a read-through is a
  // snapshot of the current words, and a stale one is worse than none.
  const outDir = join(dir, String(productionId));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const lines = [];
  const parts = [];
  for (const s of segs) {
    const text = String(s.text ?? '').trim();
    if (!text) { lines.push({ id: s.id, position: s.position, speaker: s.speaker, seconds: 0, empty: true }); continue; }
    const aiff = join(outDir, `${String(s.position).padStart(3, '0')}.aiff`);
    // No --data-format: on this macOS it is rejected for .aiff and leaves a
    // ZERO-BYTE file behind rather than failing loudly, which would have read
    // as a successful read-through of silence.
    await run('say', ['-v', voice, '-r', String(rate), '-o', aiff, text]);
    if (!existsSync(aiff) || statSync(aiff).size === 0) {
      throw Object.assign(
        new Error(`Local speech produced no audio for line ${s.position + 1}.`),
        { code: 'SAY_EMPTY' }
      );
    }
    const seconds = await durationOf(aiff);
    lines.push({ id: s.id, position: s.position, speaker: s.speaker, seconds, empty: false });
    parts.push(aiff);
  }

  // Stitch, so you can listen to the whole thing in one go.
  let full = null;
  if (parts.length) {
    const listFile = join(outDir, 'parts.txt');
    writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
    full = join(outDir, 'readthrough.m4a');
    try {
      await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'aac', '-b:a', '96k', full]);
    } catch { full = null; }
  }

  const spoken = lines.reduce((a, l) => a + (l.seconds ?? 0), 0);
  return {
    productionId,
    title: prod.title,
    voice,
    rate,
    lines,
    spokenSeconds: Math.round(spoken),
    targetRuntime: prod.target_runtime,
    // The number that actually decides whether the plan is realistic, said out
    // loud rather than estimated from a word count.
    audio: full && existsSync(full) ? `/api/productions/${productionId}/readthrough/audio` : null,
    file: full && existsSync(full) ? full : null,
  };
}
