import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { ffmpegPath } from './exporter.js';

// Analysing a video you already have.
//
// Everything here runs LOCALLY with ffmpeg. Nothing is uploaded, no key is
// needed, and no model is downloaded: shot boundaries, silence, loudness and
// the container's own facts are measurable without one. Transcription needs a
// model and is treated as an enhancement — if none is installed, the analysis
// says so rather than returning an empty transcript that reads like silence.

const ffprobe = () => process.env.FFPROBE_PATH || 'ffprobe';

function run(cmd, args, { wantStderr = false } = {}) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', no);
    p.on('exit', (code) =>
      code === 0
        ? ok(wantStderr ? err : out)
        : no(Object.assign(
            new Error(err.trim().split('\n').slice(-2).join(' ') || `${cmd} exited ${code}`),
            { code: 'FFMPEG_FAILED' }
          )));
  });
}

/** The container's own facts. No guessing, no model, no network. */
export async function probe(file) {
  const raw = await run(ffprobe(), [
    '-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', file,
  ]);
  const json = JSON.parse(raw);
  const video = json.streams.find((s) => s.codec_type === 'video');
  const audio = json.streams.find((s) => s.codec_type === 'audio');
  const [num, den] = String(video?.r_frame_rate ?? '0/1').split('/').map(Number);

  return {
    file,
    name: basename(file),
    duration: Number(json.format?.duration) || null,
    bytes: Number(json.format?.size) || null,
    bitrate: Number(json.format?.bit_rate) || null,
    container: json.format?.format_name ?? null,
    video: video && {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      fps: den ? Number((num / den).toFixed(3)) : null,
    },
    // No audio stream is a finding, not a missing field: a silent source
    // cannot be transcribed and cannot carry a voice.
    audio: audio
      ? { codec: audio.codec_name, channels: audio.channels, sampleRate: Number(audio.sample_rate) }
      : null,
  };
}

/**
 * Shot boundaries, from ffmpeg's own scene score.
 *
 * This is what turns an imported video into an outline: each shot is a section
 * with a real runtime, measured rather than assumed.
 */
export async function shots(file, { threshold = 0.4 } = {}) {
  const err = await run(ffmpegPath(), [
    '-i', file,
    '-filter:v', `select='gt(scene,${threshold})',showinfo`,
    '-f', 'null', '-',
  ], { wantStderr: true });

  const cuts = [...err.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
  return cuts.filter((t, i, a) => i === 0 || t - a[i - 1] > 0.5); // ignore flicker
}

/** Silence, which is where the filler and the dead air are. */
export async function silences(file, { noiseDb = -30, minSeconds = 0.6 } = {}) {
  const err = await run(ffmpegPath(), [
    '-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSeconds}`,
    '-f', 'null', '-',
  ], { wantStderr: true });

  const starts = [...err.matchAll(/silence_start: ([0-9.-]+)/g)].map((m) => Number(m[1]));
  const ends = [...err.matchAll(/silence_end: ([0-9.-]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? null }))
    .filter((r) => r.end != null)
    .map((r) => ({ ...r, seconds: Number((r.end - r.start).toFixed(2)) }));
}

/** Programme loudness, the number broadcasters and platforms actually check. */
export async function loudness(file) {
  try {
    const err = await run(ffmpegPath(), [
      '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-',
    ], { wantStderr: true });
    const summary = err.slice(err.lastIndexOf('Summary'));
    const grab = (label) => {
      const m = summary.match(new RegExp(`${label}:\\s*(-?[0-9.]+)`));
      return m ? Number(m[1]) : null;
    };
    return { integratedLufs: grab('I'), loudnessRange: grab('LRA'), truePeakDb: grab('Peak') };
  } catch {
    return { integratedLufs: null, loudnessRange: null, truePeakDb: null };
  }
}

// ------------------------------------------------------------ transcription

/**
 * Which local transcriber, if any, this machine has.
 *
 * Returned honestly: `null` means no transcript is possible without installing
 * something, and the caller must say that rather than shipping an empty one.
 */
export async function transcriber() {
  const candidates = [
    { id: 'whisper-cli', cmd: 'whisper-cli', args: ['--help'] },
    { id: 'whisper-cpp', cmd: 'whisper-cpp', args: ['--help'] },
    { id: 'whisper', cmd: 'whisper', args: ['--help'] },
  ];
  for (const c of candidates) {
    try {
      await run(c.cmd, c.args);
      return c.id;
    } catch { /* next */ }
  }
  try {
    await run('python3', ['-c', 'import faster_whisper']);
    return 'faster-whisper';
  } catch { /* none */ }
  return null;
}

/** 16kHz mono wav — what every local model wants, and much smaller than the source. */
export async function extractAudio(file, dest) {
  await run(ffmpegPath(), ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', dest]);
  const { size } = await stat(dest);
  return size;
}

// ------------------------------------------------------------------ report

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Turn measured shot boundaries into outline sections.
 *
 * Adjacent shots are merged until a section is long enough to be worth naming —
 * a 40-shot music-video cut would otherwise produce 40 "sections" of a second
 * each, which is data, not a plan.
 */
export function outlineFromShots(cuts, duration, { minSeconds = 20 } = {}) {
  if (!duration) return [];
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < duration), duration];
  const sections = [];
  let start = bounds[0];

  for (let i = 1; i < bounds.length; i++) {
    const end = bounds[i];
    if (end - start >= minSeconds || i === bounds.length - 1) {
      // Never emit a zero-length tail: fold it into the previous section.
      if (end - start < 1 && sections.length) {
        sections[sections.length - 1].seconds += end - start;
      } else {
        sections.push({ start, seconds: end - start });
      }
      start = end;
    }
  }

  return sections.map((s, i) => ({
    position: i,
    title: i === 0 ? 'Open' : i === sections.length - 1 ? 'Close' : `Section ${i + 1}`,
    startsAt: clock(s.start),
    runtime: clock(s.seconds),
    seconds: Number(s.seconds.toFixed(2)),
  }));
}

/** Plain-language findings, each one traceable to a measurement. */
export function findings({ facts, cuts, quiet, loud }) {
  const out = [];
  const d = facts.duration ?? 0;

  if (!facts.audio) {
    out.push({ level: 'warn', text: 'This file has no audio track, so it cannot be transcribed or re-voiced.' });
  }
  if (facts.video && facts.video.height && facts.video.height < 720) {
    out.push({ level: 'warn', text: `Source is ${facts.video.width}×${facts.video.height} — below 720p, so a re-render will look better than the original.` });
  }
  if (d) {
    const perMin = cuts.length / (d / 60);
    out.push({
      level: 'info',
      text: `${cuts.length} shot change${cuts.length === 1 ? '' : 's'} over ${clock(d)} (${perMin.toFixed(1)} per minute).`,
    });
  }
  const quietSeconds = quiet.reduce((n, s) => n + s.seconds, 0);
  if (d && quietSeconds > 0) {
    const pct = (quietSeconds / d) * 100;
    out.push({
      level: pct > 15 ? 'warn' : 'info',
      text: `${clock(quietSeconds)} of silence in ${quiet.length} stretch${quiet.length === 1 ? '' : 'es'} (${pct.toFixed(0)}% of the runtime).`,
    });
  }
  if (loud.integratedLufs != null) {
    const target = -14; // what most platforms normalise to
    const off = loud.integratedLufs - target;
    out.push({
      level: Math.abs(off) > 3 ? 'warn' : 'info',
      text: `Integrated loudness ${loud.integratedLufs} LUFS`
        + (Math.abs(off) > 3
          ? ` — ${off > 0 ? 'louder' : 'quieter'} than the -14 LUFS platforms normalise to, by ${Math.abs(off).toFixed(1)} dB.`
          : ' — within range of the -14 LUFS platforms normalise to.'),
    });
  }
  return out;
}

/** The whole local analysis. Slow enough to be worth reporting progress on. */
export async function analyse(file, { onStep } = {}) {
  const step = (s) => onStep?.(s);

  step('reading the container');
  const facts = await probe(file);

  step('finding shot changes');
  const cuts = await shots(file);

  step('measuring silence');
  const quiet = facts.audio ? await silences(file) : [];

  step('measuring loudness');
  const loud = facts.audio ? await loudness(file) : { integratedLufs: null };

  const tx = await transcriber();

  return {
    facts,
    cuts,
    silences: quiet,
    loudness: loud,
    outline: outlineFromShots(cuts, facts.duration),
    findings: findings({ facts, cuts, quiet, loud }),
    transcript: null,
    transcriber: tx,
    // Said plainly, because an empty transcript and a silent video look the
    // same in a UI that does not distinguish them.
    transcriptNote: tx
      ? `A local transcriber (${tx}) is installed — transcription can be run.`
      : 'No local transcriber is installed, so there is no transcript. '
        + 'Install whisper.cpp or faster-whisper to get one; nothing is uploaded either way.',
  };
}
