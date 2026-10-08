import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
// The pause between lines in a joined read — the full read and the editor's wav share it.
export const GAP_SECONDS = 0.35;

/**
 * Join wav files end to end with a short pause between them, as one mono 24 kHz
 * wav. `workDir` holds the gap file and the ffmpeg list; returns the duration.
 */
export async function joinWavs(parts, out, workDir, listName) {
  mkdirSync(workDir, { recursive: true });
  // The concat demuxer reads every file as the first one's format: a 16-bit gap
  // between 32-bit float lines plays at half length. Make the gap match.
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'csv=p=0', parts[0]]);
  const [codec, rate, channels] = stdout.trim().split(',');
  const gap = join(workDir, `gap-${codec}-${rate}-${channels}.wav`);
  if (!existsSync(gap)) {
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anullsrc=r=${rate}:cl=${channels === '1' ? 'mono' : 'stereo'}`,
      '-t', String(GAP_SECONDS), '-c:a', codec, gap]);
  }
  const list = join(workDir, listName);
  writeFileSync(list, parts.flatMap((p, i) => (i ? [gap, p] : [p])).map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '24000', '-ac', '1', out]);
  return durationOf(out);
}

export async function durationOf(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout) || null;
}
