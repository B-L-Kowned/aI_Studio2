import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb } from '../db/index.js';
import { localFile, voicesDir } from './local-voice.js';
import { joinWavs, GAP_SECONDS } from './audio-join.js';

const run = promisify(execFile);

/**
 * Each voiced line of a production with its approved audio, if it has one.
 * Approved = the newest take, heard, current, of these exact words, on disk.
 * The editor kit and the HeyGen render read the same answer, so the render is
 * lip-synced to exactly the audio the kit hands the editor.
 */
export function approvedLines(productionId) {
  const db = getDb();
  const latestTake = db.prepare('SELECT * FROM takes WHERE segment_id = ? ORDER BY version DESC LIMIT 1');
  return db.prepare('SELECT id, speaker, text FROM segments WHERE production_id = ? ORDER BY position').all(productionId)
    .filter((l) => l.text.trim())
    .map((l, i) => {
      const t = latestTake.get(l.id);
      const file = t && t.heard && !t.stale && t.text === l.text && t.local_path ? localFile(t.local_path) : null;
      return { segmentId: l.id, n: i + 1, speaker: l.speaker, text: l.text, file, duration: file ? t.duration : null };
    });
}

/**
 * Consecutive lines by one speaker, each run joined into one wav — one HeyGen
 * scene apiece. Every run but the last carries the between-line pause at its
 * end, so the scenes laid end to end match the full read to the frame.
 */
export async function audioRuns(productionId, lines) {
  const runs = [];
  for (const l of lines) {
    const last = runs[runs.length - 1];
    if (last && last.speaker === l.speaker) { last.lines.push(l); last.text += ` ${l.text}`; }
    else runs.push({ speaker: l.speaker, lines: [l], text: l.text });
  }
  const dir = join(voicesDir(), 'samples', 'heygen');
  for (const [i, r] of runs.entries()) {
    const joined = join(dir, `${productionId}-run${i + 1}.wav`);
    await joinWavs(r.lines.map((l) => l.file), joined, dir, `${productionId}-run${i + 1}.txt`);
    if (i < runs.length - 1) {
      const padded = join(dir, `${productionId}-run${i + 1}-padded.wav`);
      await run('ffmpeg', ['-v', 'error', '-y', '-i', joined, '-af', `apad=pad_dur=${GAP_SECONDS}`, padded]);
      r.file = padded;
    } else {
      r.file = joined;
    }
  }
  return runs;
}
