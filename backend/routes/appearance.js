import { Router } from 'express';
import { getDb } from '../db/index.js';
import { listDefaults, setDefault, applyDefault, importLooks } from '../lib/appearance.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
const STATUS = { NOT_FOUND: 404, NO_DEFAULT: 409, EMPTY: 400, NO_LOOK: 400, WRONG_LOOK: 400, BAD_APPEARANCE: 400 };
const bad = (res, err) => fail(res, STATUS[err.code] ?? 400, err.code ?? 'ERROR', err.message);

router.get('/appearance-defaults', route(async (_req, res) => ok(res, listDefaults())));

/** Save the look a kind of video starts from. scope: 'all' or 'template:<id>'. */
router.put(
  '/appearance-defaults/:scope',
  route(async (req, res) => {
    const presenterId = Number(req.body?.presenterId);
    if (!presenterId) return fail(res, 400, 'PRESENTER_REQUIRED', 'Choose the performer this default is for.');
    try { return ok(res, setDefault(req.params.scope, presenterId, req.body ?? {}), 'Default look saved'); }
    catch (err) { return bad(res, err); }
  })
);

/** Create DRAFT proofs from a default for every video in scope that has none. Never approves. */
router.post(
  '/appearance-defaults/:scope/apply',
  route(async (req, res) => {
    try {
      const r = applyDefault(req.params.scope);
      return ok(res, r, `${r.created} video${r.created === 1 ? '' : 's'} given a draft look to approve (${r.inScope} in scope)`);
    } catch (err) { return bad(res, err); }
  })
);

/** Looks pulled from the provider for one avatar group (see scripts/import-looks.mjs). */
router.post(
  '/looks/import',
  route(async (req, res) => {
    try {
      const n = importLooks(req.body?.provider || 'heygen', req.body?.looks);
      return ok(res, { imported: n }, `${n} look${n === 1 ? '' : 's'} recorded`);
    } catch (err) { return bad(res, err); }
  })
);

/**
 * Remove someone from the consent list. The owner cannot be removed: every
 * personal presenter performs as them. A presenter linked to the removed
 * person keeps working; only the link is cleared.
 */
router.delete(
  '/people/:id',
  route(async (req, res) => {
    const db = getDb();
    const person = db.prepare('SELECT * FROM people WHERE id = ?').get(Number(req.params.id));
    if (!person) return fail(res, 404, 'NOT_FOUND', 'Person not found');
    if (/owner/i.test(person.role)) return fail(res, 409, 'OWNER', 'The workspace owner cannot be removed.');
    db.prepare('DELETE FROM people WHERE id = ?').run(person.id);
    return ok(res, { id: person.id }, `${person.name} removed`);
  })
);

export default router;
