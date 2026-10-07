import { Router } from 'express';
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../db/index.js';
import { localFile, voicesDir } from '../lib/local-voice.js';
import { joinWavs, GAP_SECONDS } from '../lib/audio-join.js';
import { narrationVoice } from './script-tools.js';
import { ok, fail, route } from '../utils/respond.js';

/**
 * What an editor needs to cut a video you recorded yourself: the approved
 * audio (each line, and the whole read in one wav), and the script as plain
 * text and as subtitles. The SRT is timed to that wav when every line has an
 * approved take; until then it is an estimate at your voice's pace.
 */
const router = Router();
const PLANNING_WPM = 150;
const CONFIRM = /\[CONFIRM:[^\]]*\]/gi;
const clean = (t) => String(t).replace(CONFIRM, ' ').replace(/\s+/g, ' ').trim();
const wordCount = (t) => clean(t).split(' ').filter(Boolean).length;

/** The lines that will be spoken: the voiced segments, else the newest script. */
function kitFor(id) {
  const db = getDb();
  const p = db.prepare('SELECT id, title, voice_speed FROM productions WHERE id = ?').get(id);
  if (!p) return null;
  const stem = (/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — /.exec(p.title)?.[1] ?? `production-${p.id}`);
  let lines = db.prepare('SELECT id, speaker, text FROM segments WHERE production_id = ? ORDER BY position').all(id)
    .filter((l) => l.text.trim());
  let source = 'segments';
  if (!lines.length) {
    const v = db.prepare(
      "SELECT id FROM script_versions WHERE production_id = ? AND status != 'rejected' ORDER BY status = 'accepted' DESC, id DESC LIMIT 1"
    ).get(id);
    lines = v ? db.prepare('SELECT id, speaker, text FROM script_segments WHERE script_version_id = ? ORDER BY position').all(v.id)
      .filter((l) => l.text.trim()) : [];
    source = v ? 'script' : 'none';
  }
  const latestTake = db.prepare('SELECT * FROM takes WHERE segment_id = ? ORDER BY version DESC LIMIT 1');
  const withAudio = lines.map((l, i) => {
    // Approved = the newest take, heard, current, and of these exact words.
    const t = source === 'segments' ? latestTake.get(l.id) : null;
    const file = t && t.heard && !t.stale && t.text === l.text && t.local_path ? localFile(t.local_path) : null;
    return { n: i + 1, text: l.text, file, duration: file ? t.duration : null };
  });
  const voice = narrationVoice();
  const wpm = (voice?.naturalWpm ?? PLANNING_WPM) * (p.voice_speed ?? voice?.speed ?? 1);
  return { p, stem, source, lines: withAudio, wpm, allApproved: withAudio.length > 0 && withAudio.every((l) => l.file) };
}

const pad = (n) => String(n).padStart(2, '0');
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`;
};

function srtOf(kit) {
  let at = 0;
  return kit.lines.map((l, i) => {
    const len = kit.allApproved ? l.duration : (wordCount(l.text) / kit.wpm) * 60;
    const cue = `${i + 1}\n${srtTime(at)} --> ${srtTime(at + len)}\n${clean(l.text)}\n`;
    at += len + (kit.allApproved ? GAP_SECONDS : 0);
    return cue;
  }).join('\n');
}

const attach = (res, name, type) => {
  res.type(type);
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
};

router.get('/:id/editor-kit', route(async (req, res) => {
  const kit = kitFor(Number(req.params.id));
  if (!kit) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  const approved = kit.lines.filter((l) => l.file);
  return ok(res, {
    stem: kit.stem, source: kit.source, lines: kit.lines.length, approved: approved.length,
    allApproved: kit.allApproved, srtTimedTo: kit.allApproved ? 'audio' : 'estimate', wpm: Math.round(kit.wpm),
    audioSeconds: kit.allApproved ? approved.reduce((n, l) => n + (l.duration ?? 0), 0) + GAP_SECONDS * (approved.length - 1) : null,
  });
}));

router.get('/:id/editor-kit/script.txt', route(async (req, res) => {
  const kit = kitFor(Number(req.params.id));
  if (!kit) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  if (!kit.lines.length) return fail(res, 404, 'NO_SCRIPT', 'No script yet');
  attach(res, `${kit.stem} script.txt`, 'text/plain; charset=utf-8');
  return res.send(`${kit.lines.map((l) => clean(l.text)).join('\n\n')}\n`);
}));

router.get('/:id/editor-kit/script.srt', route(async (req, res) => {
  const kit = kitFor(Number(req.params.id));
  if (!kit) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  if (!kit.lines.length) return fail(res, 404, 'NO_SCRIPT', 'No script yet');
  attach(res, `${kit.stem}.srt`, 'application/x-subrip; charset=utf-8');
  return res.send(srtOf(kit));
}));

router.get('/:id/editor-kit/full-read.wav', route(async (req, res) => {
  const kit = kitFor(Number(req.params.id));
  if (!kit) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  if (!kit.allApproved) return fail(res, 409, 'NOT_APPROVED', 'Approve the audio for every line first');
  const dir = join(voicesDir(), 'samples', 'editor-kit');
  const out = join(dir, `${kit.p.id}-full.wav`);
  await joinWavs(kit.lines.map((l) => l.file), out, dir, `${kit.p.id}-full.txt`);
  attach(res, `${kit.stem} full read.wav`, 'audio/wav');
  return createReadStream(out).pipe(res);
}));

router.get('/:id/editor-kit/lines.zip', route(async (req, res) => {
  const kit = kitFor(Number(req.params.id));
  if (!kit) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  const approved = kit.lines.filter((l) => l.file);
  if (!approved.length) return fail(res, 409, 'NOT_APPROVED', 'No line has approved audio yet');
  attach(res, `${kit.stem} lines.zip`, 'application/zip');
  return res.send(storeZip(approved.map((l) => ({ name: `${kit.stem} line ${pad(l.n)}.wav`, data: readFileSync(l.file) }))));
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
