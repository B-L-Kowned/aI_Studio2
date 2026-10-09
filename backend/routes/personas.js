import { Router } from 'express';
import { getDb } from '../db/index.js';
import { looksFor } from '../lib/appearance.js';
import { personaLooks, setPersona, personaFor, setVideoPersona, useForOf } from '../lib/personas.js';
import { WORKSTREAMS } from './register.js';
import { twinCard, importCard, readCard, needsFor } from '../lib/twin-card.js';
import express from 'express';
import { rmSync } from 'node:fs';
import { buildPackage, importPackage, makeTwinVoice, buildTwinLook, photoToHeyGenLook } from '../lib/twin-package.js';
import * as mcp from '../lib/providers/heygen-mcp.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
const failWith = (res, err) => fail(res, err.code === 'NOT_FOUND' ? 404 : 400, err.code ?? 'BAD_REQUEST', err.message);

/** A persona's looks and pace, and every look it could wear. */
router.get('/presenters/:id/persona', route(async (req, res) => {
  const id = Number(req.params.id);
  const p = getDb().prepare('SELECT * FROM presenters WHERE id = ?').get(id);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'No such persona');
  const companies = getDb().prepare('SELECT name FROM companies WHERE is_active = 1 ORDER BY name').all().map((r) => r.name);
  return ok(res, { looks: personaLooks(id), wearable: looksFor(id), speed: p.speed ?? null, useFor: useForOf(p), workstreams: WORKSTREAMS, companies });
}));
router.put('/presenters/:id/persona', route(async (req, res) => {
  try { return ok(res, setPersona(Number(req.params.id), req.body ?? {}), 'Saved'); }
  catch (err) { return failWith(res, err); }
}));

/** Which persona presents a video. */
router.get('/productions/:id/persona', route(async (req, res) => ok(res, personaFor(Number(req.params.id)))));
router.put('/productions/:id/persona', route(async (req, res) => {
  try { return ok(res, setVideoPersona(Number(req.params.id), req.body?.personaId ?? null), 'Persona set'); }
  catch (err) { return failWith(res, err); }
}));

/** A persona as a twin card: what can travel, never the samples. */
router.get('/presenters/:id/twin-card', route(async (req, res) => {
  try {
    const owner = getDb().prepare("SELECT name FROM people WHERE role LIKE '%owner%' ORDER BY id LIMIT 1").get()?.name ?? null;
    return ok(res, twinCard(Number(req.params.id), { ownerName: owner, grantId: req.query.grant ? Number(req.query.grant) : null }));
  } catch (err) { return failWith(res, err); }
}));
/** Look at a shared card before adding it: what it brings and what is still needed. */
router.post('/twin-cards/preview', route(async (req, res) => {
  try { const c = readCard(req.body?.card); return ok(res, { ...c, needs: needsFor(c) }); }
  catch (err) { return failWith(res, err); }
}));
router.post('/twin-cards/import', route(async (req, res) => {
  try { return ok(res, importCard(req.body?.card), 'Twin added'); }
  catch (err) { return failWith(res, err); }
}));

const ownerName = () => getDb().prepare("SELECT name FROM people WHERE role LIKE '%owner%' ORDER BY id LIMIT 1").get()?.name ?? null;

/** The twin package for a share: card + look pictures + voice sample, fingerprinted. */
router.get('/presenters/:id/twin-package', route(async (req, res) => {
  try {
    const pkg = await buildPackage(Number(req.params.id), { ownerName: ownerName(), grantId: req.query.grant ? Number(req.query.grant) : null });
    return res.download(pkg.file, pkg.name, () => rmSync(pkg.file, { force: true }));
  } catch (err) { return failWith(res, err); }
}));

/** Open a package someone sent you (the raw file as the body). */
router.post('/twin-packages/import', express.raw({ type: ['application/octet-stream', 'application/zip'], limit: '60mb' }), route(async (req, res) => {
  try { return ok(res, await importPackage(req.body), 'Twin added'); }
  catch (err) { return fail(res, err.code === 'TAMPERED' ? 409 : 400, err.code ?? 'BAD_PACKAGE', err.message); }
}));

router.post('/presenters/:id/twin/voice', route(async (req, res) => {
  try { return ok(res, await makeTwinVoice(Number(req.params.id)), 'Their voice is ready on this Mac'); }
  catch (err) { return failWith(res, err); }
}));

router.post('/presenters/:id/twin/look', route(async (req, res) => {
  try { return ok(res, await buildTwinLook(Number(req.params.id), { confirm: req.body?.confirm === true }), 'Building their look in your HeyGen'); }
  catch (err) { return fail(res, { CONFIRMATION_REQUIRED: 402, NOT_CONNECTED: 409 }[err.code] ?? 400, err.code ?? 'ERROR', err.message); }
}));

/**
 * Add a look to one of your personas from a photo of you (a phone photo, or an
 * image made from one). It goes into that persona's own HeyGen identity, so
 * the face stays yours; it appears in Outfits once HeyGen has made it.
 */
router.post('/presenters/:id/looks/from-photo', express.raw({ type: ['image/*'], limit: '25mb' }), route(async (req, res) => {
  if (req.query.confirm !== '1') return fail(res, 402, 'CONFIRMATION_REQUIRED', 'Making a look in HeyGen uses your account. Confirm to continue.');
  if (!mcp.isConnected()) return fail(res, 409, 'NOT_CONNECTED', 'Sign in to HeyGen first (Settings → HeyGen account).');
  const db = getDb();
  const p = db.prepare('SELECT * FROM presenters WHERE id = ?').get(Number(req.params.id));
  if (!p || p.kind !== 'personal') return fail(res, 400, 'NOT_YOURS', 'Looks from a photo are for your own personas.');
  if (!Buffer.isBuffer(req.body) || req.body.length < 10_000) return fail(res, 400, 'EMPTY', 'That picture is too small to make a look from.');
  const group = p.avatar_asset_id ? db.prepare('SELECT group_id FROM provider_assets WHERE id = ?').get(p.avatar_asset_id)?.group_id : null;
  const type = String(req.headers['content-type'] ?? 'image/jpeg').split(';')[0];
  const name = `${p.name} — ${String(req.query.name ?? 'new look').slice(0, 60)}`;
  try {
    const r = await photoToHeyGenLook({ bytes: req.body, contentType: type, filename: `look.${type.split('/')[1] ?? 'jpg'}`, name, avatarGroupId: group });
    return ok(res, { name, ...r }, 'HeyGen is making the look — it appears in Outfits after the next sync');
  } catch (err) { return fail(res, 502, err.code ?? 'HEYGEN_ERROR', err.message); }
}));

export default router;
