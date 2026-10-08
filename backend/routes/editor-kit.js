import { Router } from 'express';
import { createReadStream, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, constants } from 'node:fs';
import { join, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { getDb } from '../db/index.js';
import { voicesDir } from '../lib/local-voice.js';
import { joinWavs, GAP_SECONDS } from '../lib/audio-join.js';
import { approvedLines } from '../lib/approved-audio.js';
import { madeBy } from '../lib/made-by.js';
import { visualsFor } from '../lib/visuals.js';
import { storageRoot, download, placeholder } from '../lib/exporter.js';
import { folderFor } from '../lib/storage.js';
import { narrationVoice } from './script-tools.js';
import { ok, fail, route } from '../utils/respond.js';

/**
 * Everything an editor needs to finish a video, whichever way it is made:
 * the approved audio (each line, and the whole read), the script as text and
 * subtitles, the screen recordings with a shot list saying where each goes,
 * and — for a HeyGen video — the render and each line's clip cut from it.
 *
 * One clock runs through all of it: the full read is the approved takes with
 * a fixed pause between them, the HeyGen render is lip-synced to those same
 * takes, so the subtitles, the shot list and the timeline all land on it.
 * Until every line is approved, times are estimated at your voice's pace.
 */
const router = Router();
const run = promisify(execFile);
const PLANNING_WPM = 150;
const FPS = 25;
const CONFIRM = /\[CONFIRM:[^\]]*\]/gi;
const clean = (t) => String(t).replace(CONFIRM, ' ').replace(/\s+/g, ' ').trim();
const wordCount = (t) => clean(t).split(' ').filter(Boolean).length;
const pad = (n) => String(n).padStart(2, '0');
const safe = (s) => String(s ?? '').replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);

/** The kit's lines with their place on the clock, and the sections they fall in. */
export function kitFor(id) {
  const db = getDb();
  const p = db.prepare('SELECT id, title, voice_speed FROM productions WHERE id = ?').get(id);
  if (!p) return null;
  const stem = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — /.exec(p.title)?.[1] ?? `production-${p.id}`;

  let lines = approvedLines(id);
  let source = 'segments';
  if (!lines.length) {
    // No segments yet: the newest script, unvoiced.
    const v = db.prepare(
      "SELECT id FROM script_versions WHERE production_id = ? AND status != 'rejected' ORDER BY status = 'accepted' DESC, id DESC LIMIT 1"
    ).get(id);
    lines = v ? db.prepare('SELECT speaker, text FROM script_segments WHERE script_version_id = ? ORDER BY position').all(v.id)
      .filter((l) => l.text.trim()).map((l, i) => ({ n: i + 1, speaker: l.speaker, text: l.text, file: null, duration: null })) : [];
    source = v ? 'script' : 'none';
  }
  const voice = narrationVoice();
  const wpm = (voice?.naturalWpm ?? PLANNING_WPM) * (p.voice_speed ?? voice?.speed ?? 1);
  const allApproved = lines.length > 0 && lines.every((l) => l.file);

  let at = 0;
  for (const l of lines) {
    l.start = at;
    l.length = allApproved ? l.duration : (wordCount(l.text) / wpm) * 60;
    at += l.length + (allApproved ? GAP_SECONDS : 0);
  }
  const total = lines.length ? lines[lines.length - 1].start + lines[lines.length - 1].length : 0;

  // Sections from the shot list. Its lines are the same script in the same
  // order; when the counts disagree, place by share of the words instead.
  const rows = visualsFor(id).rows;
  const counts = rows.map((r) => r.lines.length);
  const sectionOf = [];
  if (counts.reduce((a, b) => a + b, 0) === lines.length) {
    counts.forEach((c, si) => { for (let k = 0; k < c; k++) sectionOf.push(si); });
  } else if (rows.length) {
    const planned = rows.reduce((n, r) => n + (r.seconds || 1), 0);
    const words = lines.reduce((n, l) => n + wordCount(l.text), 0) || 1;
    let w = 0; let acc = 0; const bounds = rows.map((r) => (acc += (r.seconds || 1) / planned));
    for (const l of lines) {
      const mid = (w + wordCount(l.text) / 2) / words;
      sectionOf.push(Math.max(0, bounds.findIndex((b) => mid <= b + 1e-9)));
      w += wordCount(l.text);
    }
  }
  const sections = rows.map((r, si) => {
    const mine = lines.filter((_, li) => sectionOf[li] === si);
    const start = mine.length ? mine[0].start : null;
    const end = mine.length ? mine[mine.length - 1].start + mine[mine.length - 1].length : null;
    const rec = r.recording && db.prepare('SELECT local_path, name FROM assets WHERE id = ?').get(r.recording.id);
    return {
      n: si + 1, title: r.title, shotType: r.shotType, onscreenText: r.onscreenText, detail: r.detail,
      start, end, recording: rec?.local_path && existsSync(rec.local_path) ? { path: rec.local_path, name: rec.name } : null,
    };
  });
  // A section with no lines starts where the one before it ended.
  sections.forEach((s, i) => { if (s.start == null) s.start = s.end = i ? sections[i - 1].end ?? 0 : 0; });

  const r = db.prepare("SELECT * FROM render_versions WHERE production_id = ? AND status = 'complete' ORDER BY version DESC LIMIT 1").get(id);
  const render = r ? { version: r.version, url: r.video_url, local: r.local_path && existsSync(r.local_path) ? r.local_path : null,
    standIn: !r.video_url || /^file:\/\/fixtures\//.test(r.video_url) } : null;

  return { p, stem, source, lines, wpm, allApproved, total, sections, render, madeBy: madeBy(id) };
}

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`;
};
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const srtOf = (kit) => kit.lines.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.start + l.length)}\n${clean(l.text)}\n`).join('\n');
const textOf = (kit) => `${kit.lines.map((l) => clean(l.text)).join('\n\n')}\n`;
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const recordingName = (s) => `${pad(s.n)} ${safe(s.title)}${extname(s.recording.path)}`;
function shotListOf(kit) {
  const head = ['Section', 'Title', 'Starts', 'Ends', 'Shot', 'On-screen text', 'Notes', 'Recording'];
  const rows = kit.sections.map((s) => [s.n, s.title, clock(s.start), clock(s.end), s.shotType, s.onscreenText, s.detail,
    s.recording ? `recordings/${recordingName(s)}` : '']);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------- files
const cacheDir = (kit) => join(voicesDir(), 'samples', 'editor-kit', String(kit.p.id));

export async function fullReadFile(kit) {
  return fullRead(kit);
}

async function fullRead(kit) {
  const dir = cacheDir(kit);
  const out = join(dir, 'full.wav');
  await joinWavs(kit.lines.map((l) => l.file), out, dir, 'full.txt');
  return out;
}

/** The finished render on disk: downloaded from HeyGen, or in Fixtures a stand-in carrying the real audio. */
export async function renderFile(kit) {
  const dir = cacheDir(kit);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `render-v${kit.render.version}${kit.render.standIn ? '-stand-in' : ''}.mp4`);
  if (kit.render.local) return kit.render.local;
  if (existsSync(out)) return out;
  if (!kit.render.standIn) {
    await download(kit.render.url, out);
    return out;
  }
  // Colour bars over the approved full read: obviously not a render, but the
  // right length with the right sound, so the timeline can be checked by ear.
  if (!kit.allApproved) { await placeholder(out, Math.max(1, Math.round(kit.total))); return out; }
  const audio = await fullRead(kit);
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `smptebars=size=1920x1080:rate=${FPS}`, '-i', audio,
    '-t', kit.total.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out]);
  return out;
}

/** Each line's clip, cut from the render on the shared clock. */
async function lineClips(kit, render, dir) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const l of kit.lines) {
    const file = join(dir, `${kit.stem} line ${pad(l.n)}.mp4`);
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', l.start.toFixed(3), '-i', render, '-t', l.length.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
    out.push(file);
  }
  return out;
}

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  const v = j.streams?.find((s) => s.codec_type === 'video');
  const a = j.streams?.find((s) => s.codec_type === 'audio');
  // Kept as the rational ffprobe gives (30000/1001), so a frame is exact.
  const [num, den = 1] = String(v?.r_frame_rate ?? '25/1').split('/').map(Number);
  return { duration: Number(j.format?.duration) || 0, video: v && { width: v.width, height: v.height, rate: `${num}/${den}`, frame: `${den}/${num}s` },
    audio: a && { rate: Number(a.sample_rate), channels: a.channels } };
}

// ------------------------------------------------------------- FCPXML timeline
// Times on the sequence are whole frames at 25 fps; asset durations are exact.
const frames = (s) => `${Math.max(0, Math.round(s * FPS))}/${FPS}s`;
const exact = (s) => `${Math.round(s * 1000)}/1000s`;
const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function timelineOf(kit, media) {
  const formats = new Map([['1920x1080@25/1', { id: 'r1', w: 1920, h: 1080, frame: `1/${FPS}s` }]]);
  const assets = [];
  const asset = async (file, name) => {
    const m = await probe(file);
    let fmt = null;
    if (m.video) {
      const key = `${m.video.width}x${m.video.height}@${m.video.rate}`;
      if (!formats.has(key)) formats.set(key, { id: `r${formats.size + 1}`, w: m.video.width, h: m.video.height, frame: m.video.frame });
      fmt = formats.get(key).id;
    }
    const a = { id: `a${assets.length + 1}`, name, file, m, fmt };
    assets.push(a);
    return a;
  };

  const audio = await asset(media.fullRead, `${kit.stem} full read`);
  const render = media.render ? await asset(media.render, `${kit.stem} HeyGen render`) : null;
  const recs = [];
  for (const s of kit.sections) {
    if (!media.recordings[s.n]) continue;
    recs.push({ s, a: await asset(media.recordings[s.n], `${pad(s.n)} ${s.title}`) });
  }
  const total = Math.max(kit.total, render?.m.duration ?? 0);

  const clip = (a, { lane, offset, duration }) =>
    `<asset-clip ref="${a.id}" name="${xml(a.name)}"${lane != null ? ` lane="${lane}"` : ''} offset="${frames(offset)}" start="0s" duration="${frames(duration)}"${a.fmt ? ` format="${a.fmt}"` : ''} tcFormat="NDF"/>`;
  const connected = [
    ...(render ? [] : [clip(audio, { lane: -1, offset: 0, duration: audio.m.duration })]),
    ...recs.map(({ s, a }, i) => {
      const next = recs[i + 1]?.s.start;
      // Up to the next recording's section, so clips on one lane never overlap.
      const room = next != null && next > s.start ? next - s.start : a.m.duration;
      return clip(a, { lane: 1, offset: s.start, duration: Math.min(a.m.duration, room) });
    }),
  ].map((c) => `            ${c}`).join('\n');

  const primary = render
    ? `<asset-clip ref="${render.id}" name="${xml(render.name)}" offset="0s" start="0s" duration="${frames(render.m.duration)}" format="${render.fmt}" tcFormat="NDF">\n${connected}\n          </asset-clip>`
    : `<gap name="Gap" offset="0s" start="0s" duration="${frames(total)}">\n${connected}\n          </gap>`;

  const formatXml = [...formats.values()].map((f) =>
    `    <format id="${f.id}" frameDuration="${f.frame}" width="${f.w}" height="${f.h}"/>`).join('\n');
  const assetXml = assets.map((a) => [
    `    <asset id="${a.id}" name="${xml(a.name)}" start="0s" duration="${exact(a.m.duration)}"`,
    ` hasVideo="${a.m.video ? 1 : 0}"${a.fmt ? ` format="${a.fmt}"` : ''}`,
    ` hasAudio="${a.m.audio ? 1 : 0}"${a.m.audio ? ` audioSources="1" audioChannels="${a.m.audio.channels}" audioRate="${a.m.audio.rate}"` : ''}>`,
    `\n      <media-rep kind="original-media" src="${xml(pathToFileURL(a.file).href)}"/>\n    </asset>`,
  ].join('')).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
${formatXml}
${assetXml}
  </resources>
  <library>
    <event name="AI Video Studio">
      <project name="${xml(kit.p.title)}">
        <sequence format="r1" duration="${frames(total)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
          ${primary}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

// ---------------------------------------------------------------- the folder
export const kitFolder = (productionId) => {
  const shape = folderFor(productionId);
  return join(storageRoot(), ...(shape ? shape.parts : [`production-${productionId}`]), 'Editor kit');
};
const kitDir = (kit) => kitFolder(kit.p.id);

// A clone on APFS: instant and takes no space until either copy changes.
const place = (from, to) => copyFileSync(from, to, constants.COPYFILE_FICLONE);

async function writeFolder(kit) {
  const dir = kitDir(kit);
  mkdirSync(join(dir, 'lines'), { recursive: true });
  const written = [];
  const put = (name, data) => { writeFileSync(join(dir, name), data); written.push(name); };
  put(`${kit.stem} script.txt`, textOf(kit));
  put(`${kit.stem}.srt`, srtOf(kit));
  put(`${kit.stem} shot list.csv`, shotListOf(kit));

  const media = { fullRead: null, render: null, recordings: {} };
  for (const l of kit.lines.filter((x) => x.file)) {
    const name = `lines/${kit.stem} line ${pad(l.n)}.wav`;
    place(l.file, join(dir, name)); written.push(name);
  }
  if (kit.allApproved) {
    media.fullRead = join(dir, `${kit.stem} full read.wav`);
    place(await fullRead(kit), media.fullRead); written.push(`${kit.stem} full read.wav`);
  }
  const withRec = kit.sections.filter((s) => s.recording);
  if (withRec.length) mkdirSync(join(dir, 'recordings'), { recursive: true });
  for (const s of withRec) {
    const name = `recordings/${recordingName(s)}`;
    place(s.recording.path, join(dir, name)); written.push(name);
    media.recordings[s.n] = join(dir, name);
  }
  if (kit.madeBy === 'heygen' && kit.render) {
    media.render = join(dir, `${kit.stem} render${kit.render.standIn ? ' (stand-in)' : ''}.mp4`);
    place(await renderFile(kit), media.render); written.push(media.render.slice(dir.length + 1));
    if (kit.allApproved) {
      const clips = await lineClips(kit, media.render, join(dir, 'clips'));
      written.push(...clips.map((c) => c.slice(dir.length + 1)));
    }
  }
  if (media.fullRead) put(`${kit.stem} timeline.fcpxml`, await timelineOf(kit, media));
  return { path: dir, files: written };
}

// ------------------------------------------------------------------ routes
const attach = (res, name, type) => {
  res.type(type);
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
};
const load = (req, res) => {
  const kit = kitFor(Number(req.params.id));
  if (!kit) fail(res, 404, 'NOT_FOUND', 'Production not found');
  return kit;
};

router.get('/:id/editor-kit', route(async (req, res) => {
  const kit = load(req, res); if (!kit) return undefined;
  const dir = kitDir(kit);
  return ok(res, {
    stem: kit.stem, madeBy: kit.madeBy, source: kit.source,
    lines: kit.lines.length, approved: kit.lines.filter((l) => l.file).length, allApproved: kit.allApproved,
    timedTo: kit.allApproved ? 'audio' : 'estimate', wpm: Math.round(kit.wpm), seconds: kit.total,
    sections: kit.sections.length, recordings: kit.sections.filter((s) => s.recording).length,
    render: kit.render && { version: kit.render.version, standIn: kit.render.standIn },
    folder: existsSync(dir) ? dir : null,
  });
}));

router.get('/:id/editor-kit/script.txt', route(async (req, res) => {
  const kit = load(req, res); if (!kit) return undefined;
  if (!kit.lines.length) return fail(res, 404, 'NO_SCRIPT', 'No script yet');
  attach(res, `${kit.stem} script.txt`, 'text/plain; charset=utf-8');
  return res.send(textOf(kit));
}));

router.get('/:id/editor-kit/script.srt', route(async (req, res) => {
  const kit = load(req, res); if (!kit) return undefined;
  if (!kit.lines.length) return fail(res, 404, 'NO_SCRIPT', 'No script yet');
  attach(res, `${kit.stem}.srt`, 'application/x-subrip; charset=utf-8');
  return res.send(srtOf(kit));
}));

router.get('/:id/editor-kit/shot-list.csv', route(async (req, res) => {
  const kit = load(req, res); if (!kit) return undefined;
  attach(res, `${kit.stem} shot list.csv`, 'text/csv; charset=utf-8');
  return res.send(shotListOf(kit));
}));

router.get('/:id/editor-kit/full-read.wav', route(async (req, res) => {
  const kit = load(req, res); if (!kit) return undefined;
  if (!kit.allApproved) return fail(res, 409, 'NOT_APPROVED', 'Approve the audio for every line first');
  const out = await fullRead(kit);
  attach(res, `${kit.stem} full read.wav`, 'audio/wav');
  return createReadStream(out).pipe(res);
}));

router.get('/:id/editor-kit/render.mp4', route(async (req, res) => {
  const kit = load(req, res); if (!kit) return undefined;
  if (!kit.render) return fail(res, 404, 'NO_RENDER', 'No finished render yet');
  const out = await renderFile(kit);
  attach(res, `${kit.stem} render${kit.render.standIn ? ' (stand-in)' : ''}.mp4`, 'video/mp4');
  return createReadStream(out).pipe(res);
}));

router.get('/:id/editor-kit/lines.zip', route(async (req, res) => {
  const kit = load(req, res); if (!kit) return undefined;
  const approved = kit.lines.filter((l) => l.file);
  if (!approved.length) return fail(res, 409, 'NOT_APPROVED', 'No line has approved audio yet');
  attach(res, `${kit.stem} lines.zip`, 'application/zip');
  return res.send(storeZip(approved.map((l) => ({ name: `${kit.stem} line ${pad(l.n)}.wav`, data: readFileSync(l.file) }))));
}));

/** Write the whole kit, and the timeline that points at it, into the video's folder. */
router.post('/:id/editor-kit/folder', route(async (req, res) => {
  const kit = load(req, res); if (!kit) return undefined;
  if (!kit.lines.length) return fail(res, 409, 'NO_SCRIPT', 'No script yet');
  try {
    const r = await writeFolder(kit);
    return ok(res, r, `Editor kit saved — ${r.files.length} files`);
  } catch (err) {
    return fail(res, 500, err.code ?? 'KIT_FAILED', `The kit could not be written: ${err.message}`);
  }
}));

/** Open the kit folder on this computer. The path is the server's own, never the page's. */
router.post('/:id/editor-kit/reveal', route(async (req, res) => {
  const kit = load(req, res); if (!kit) return undefined;
  const dir = kitDir(kit);
  if (!existsSync(dir)) return fail(res, 404, 'NO_FOLDER', 'Save the kit to its folder first');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  await run(opener, [dir]).catch(() => {}); // explorer exits 1 on success
  return ok(res, { path: dir }, 'Opened the kit folder');
}));

// ------------------------------------------------------------ a stored (uncompressed) zip
// Wav barely compresses, and this keeps the download free of a dependency.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function storeZip(files) {
  const locals = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(f.data.length, 18); head.writeUInt32LE(f.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(f.data.length, 20); dir.writeUInt32LE(f.data.length, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    locals.push(head, name, f.data);
    central.push(dir, name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

export default router;
