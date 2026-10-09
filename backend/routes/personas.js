import { Router } from 'express';
import { getDb } from '../db/index.js';
import { looksFor } from '../lib/appearance.js';
import { personaLooks, setPersona, personaFor, setVideoPersona, useForOf } from '../lib/personas.js';
import { WORKSTREAMS } from './register.js';
import { twinCard, importCard, readCard, needsFor } from '../lib/twin-card.js';
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

export default router;
