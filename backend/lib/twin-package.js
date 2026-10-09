import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { getDb, defaultDbPath } from '../db/index.js';
import { twinCard, importCard } from './twin-card.js';
import { cachedFile, cachePreview } from './preview-cache.js';
import { createLocalVoice } from './local-voice.js';
import * as mcp from './providers/heygen-mcp.js';

const run = promisify(execFile);
const bad = (message, code = 'BAD_REQUEST') => Object.assign(new Error(message), { code });
const sha256 = (file) => crypto.createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * A twin package: everything needed to rebuild a twin on someone else's
 * account, in one file you send yourself. The card (personality, delivery,
 * outfits, consent and end date) plus the source it is rebuilt from: a picture
 * of each shared look, and the voice sample. Every file carries its sha256, so
 * consent is bound to exactly these files.
 *
 * Nothing in it is a renderer asset id the recipient could use — HeyGen looks
 * belong to the account that made them. The recipient's app rebuilds the look
 * from the picture in THEIR HeyGen, and the voice on THEIR Mac.
 */
export const PACKAGE_EXT = '.twin';
const twinsDir = () => { const d = join(dirname(defaultDbPath()), 'twins'); mkdirSync(d, { recursive: true }); return d; };

function voiceSampleOf(presenterId) {
  const p = getDb().prepare('SELECT voice_asset_id FROM presenters WHERE id = ?').get(presenterId);
  const v = p?.voice_asset_id ? getDb().prepare('SELECT * FROM provider_assets WHERE id = ?').get(p.voice_asset_id) : null;
  if (!v || v.provider !== 'local') return null;
  const file = join(dirname(defaultDbPath()), 'voices', v.remote_id, 'reference.wav');
  return existsSync(file) ? file : null;
}

/** Build the package for one of your personas and a share. Returns the file's path. */
export async function buildPackage(presenterId, { ownerName, grantId } = {}) {
  const card = twinCard(presenterId, { ownerName, grantId });
  const scopes = card.consent.scopes?.length ? card.consent.scopes : ['appearance', 'voice', 'personality'];
  const work = mkdtempSync(join(tmpdir(), 'twin-'));
  const files = [];
  try {
    if (scopes.includes('appearance')) {
      mkdirSync(join(work, 'looks'), { recursive: true });
      const db = getDb();
      for (const [i, w] of card.wardrobe.entries()) {
        const row = db.prepare("SELECT * FROM provider_assets WHERE kind = 'avatar' AND remote_id = ?").get(w.id);
        const hit = row ? (cachedFile(row.id) ?? await cachePreview(row)) : null;
        if (!hit) continue; // no picture to send: the look is listed, not shipped
        const name = `looks/${String(i + 1).padStart(2, '0')}${extname(hit.file) || '.jpg'}`;
        copyFileSync(hit.file, join(work, name));
        files.push({ path: name, kind: 'appearance', name: w.name, default: !!w.default, sha256: sha256(join(work, name)) });
      }
    }
    const sample = scopes.includes('voice') ? voiceSampleOf(presenterId) : null;
    if (sample) {
      mkdirSync(join(work, 'voice'), { recursive: true });
      copyFileSync(sample, join(work, 'voice', 'sample.wav'));
      files.push({ path: 'voice/sample.wav', kind: 'voice', name: card.voice?.name ?? 'Voice sample', sha256: sha256(join(work, 'voice', 'sample.wav')) });
    }
    if (!scopes.includes('personality')) card.personality = { voice: '', signatureOpening: '', signOff: '', neverClaim: '' };
    if (!scopes.includes('appearance')) card.wardrobe = [];
    if (!scopes.includes('voice')) card.voice = null;
    writeFileSync(join(work, 'twin.json'), JSON.stringify({ ...card, files }, null, 2));
    const out = join(tmpdir(), `${card.name.replace(/[^\w-]+/g, '-').toLowerCase()}-${Date.now()}${PACKAGE_EXT}`);
    await run('zip', ['-q', '-r', '-X', out, '.'], { cwd: work });
    return { file: out, name: `${card.name}${PACKAGE_EXT}`, files: files.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Open a package someone sent: unpack it, check every file against its
 * fingerprint, and add the twin (with its end date) as a presenter. Nothing
 * is built yet — the look and voice are made from the files when you choose.
 */
export async function importPackage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) throw bad('That file is empty.', 'EMPTY');
  if (buffer.subarray(0, 2).toString() !== 'PK') throw bad('That is not a twin package.', 'BAD_PACKAGE');
  const tmp = mkdtempSync(join(tmpdir(), 'twin-in-'));
  const dest = join(twinsDir(), crypto.randomUUID());
  try {
    writeFileSync(join(tmp, 'in.zip'), buffer);
    // Paths are listed first: anything absolute or climbing out is refused.
    const { stdout } = await run('unzip', ['-Z1', join(tmp, 'in.zip')]);
    const names = stdout.split('\n').filter(Boolean);
    if (names.some((n) => n.startsWith('/') || n.split('/').includes('..'))) throw bad('That package has unsafe paths.', 'BAD_PACKAGE');
    if (!names.includes('twin.json')) throw bad('That package has no twin card.', 'BAD_PACKAGE');
    mkdirSync(dest, { recursive: true });
    await run('unzip', ['-q', '-o', join(tmp, 'in.zip'), '-d', dest]);
    const card = JSON.parse(readFileSync(join(dest, 'twin.json'), 'utf8'));
    const files = (Array.isArray(card.files) ? card.files : []).filter((f) => typeof f?.path === 'string' && names.includes(f.path));
    for (const f of files) {
      if (sha256(join(dest, f.path)) !== f.sha256) throw bad(`${f.path} does not match its fingerprint — the package was changed after it was shared.`, 'TAMPERED');
    }
    const result = importCard(card);
    const db = getDb();
    const src = JSON.parse(db.prepare('SELECT twin_source FROM presenters WHERE id = ?').get(result.presenterId).twin_source ?? '{}');
    src.dir = dest;
    src.files = files.map((f) => ({ ...f, abs: join(dest, f.path) }));
    db.prepare('UPDATE presenters SET twin_source = ? WHERE id = ?').run(JSON.stringify(src), result.presenterId);
    return { ...result, looks: files.filter((f) => f.kind === 'appearance').length, voice: files.some((f) => f.kind === 'voice') };
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw err instanceof SyntaxError ? bad('The twin card inside is unreadable.', 'BAD_PACKAGE') : err;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function sourceOf(presenterId) {
  const p = getDb().prepare('SELECT * FROM presenters WHERE id = ?').get(presenterId);
  if (!p?.twin_source) throw bad('This presenter did not come from a twin package.', 'NOT_TWIN');
  return { p, src: JSON.parse(p.twin_source) };
}

/** Their voice, made on this Mac from the sample in the package — free. */
export async function makeTwinVoice(presenterId) {
  const { p, src } = sourceOf(presenterId);
  const f = (src.files ?? []).find((x) => x.kind === 'voice');
  if (!f || !existsSync(f.abs)) throw bad('The package has no voice sample.', 'NO_VOICE');
  const voice = await createLocalVoice({ name: `${p.name} (shared)`, audio: readFileSync(f.abs) });
  getDb().prepare('UPDATE presenters SET voice_asset_id = ? WHERE id = ?').run(voice.id, presenterId);
  return voice;
}

/**
 * Their look, built in YOUR HeyGen from the picture in the package: uploaded,
 * then made into a photo avatar. It is your account and your credits, so it
 * runs only when confirmed. HeyGen may ask the person to confirm their consent.
 */
export async function buildTwinLook(presenterId, { confirm = false } = {}) {
  if (confirm !== true) throw bad('Building a look in HeyGen uses your account. Confirm to continue.', 'CONFIRMATION_REQUIRED');
  if (!mcp.isConnected()) throw bad('Sign in to HeyGen first (Settings → HeyGen account).', 'NOT_CONNECTED');
  const { p, src } = sourceOf(presenterId);
  const looks = (src.files ?? []).filter((x) => x.kind === 'appearance');
  const f = looks.find((x) => x.default) ?? looks[0];
  if (!f || !existsSync(f.abs)) throw bad('The package has no picture to build a look from.', 'NO_LOOK');
  const ext = extname(f.abs).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const bytes = readFileSync(f.abs);
  const up = await mcp.callTool('create_asset_upload', { filename: basename(f.abs), contentType, sizeBytes: bytes.length, checksumSha256: f.sha256 });
  const assetId = up?.asset_id ?? up?.id;
  const url = up?.upload_url ?? up?.url;
  if (!assetId || !url) throw bad('HeyGen did not return an upload address.', 'HEYGEN_UPLOAD');
  const put = await fetch(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': contentType }, signal: AbortSignal.timeout(60_000) });
  if (!put.ok) throw bad(`HeyGen refused the picture (${put.status}).`, 'HEYGEN_UPLOAD');
  await mcp.callTool('complete_asset_upload', { assetId, checksumSha256: f.sha256 });
  const made = await mcp.callTool('create_photo_avatar', { name: `${p.name} — ${f.name ?? 'shared look'}`, file: { type: 'asset_id', asset_id: assetId } });
  src.heygen = { assetId, avatar: made, at: new Date().toISOString() };
  getDb().prepare('UPDATE presenters SET twin_source = ? WHERE id = ?').run(JSON.stringify(src), presenterId);
  return { started: true, heygen: made };
}

