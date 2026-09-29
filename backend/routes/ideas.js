import { Router } from 'express';
import {
  listIdeas, addIdea, updateIdea, deleteIdea, markPromoted, ideaCounts,
} from '../lib/ideas.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
const bad = (res, err) =>
  fail(res, { NOT_FOUND: 404, ALREADY_PROMOTED: 409 }[err.code] ?? 400, err.code ?? 'ERROR', err.message);

router.get(
  '/ideas',
  route(async (req, res) =>
    ok(res, {
      ideas: listIdeas({ includeArchived: req.query.includeArchived === 'true' }),
      counts: ideaCounts(),
    })
  )
);

router.post(
  '/ideas',
  route(async (req, res) => {
    try {
      const idea = addIdea(req.body ?? {});
      return ok(res, { idea, counts: ideaCounts() }, 'Parked');
    } catch (err) { return bad(res, err); }
  })
);

router.patch(
  '/ideas/:id',
  route(async (req, res) => {
    try {
      const idea = updateIdea(Number(req.params.id), req.body ?? {});
      return ok(res, { idea, counts: ideaCounts() }, 'Updated');
    } catch (err) { return bad(res, err); }
  })
);

router.delete(
  '/ideas/:id',
  route(async (req, res) => {
    try {
      deleteIdea(Number(req.params.id));
      return ok(res, { counts: ideaCounts() }, 'Removed from the lot');
    } catch (err) { return bad(res, err); }
  })
);

/** The idea grew up. Called by the client once the production exists. */
router.post(
  '/ideas/:id/promoted',
  route(async (req, res) => {
    const productionId = Number(req.body?.productionId);
    if (!productionId) return fail(res, 400, 'NO_PRODUCTION', 'Which production did it become?');
    try {
      const idea = markPromoted(Number(req.params.id), productionId);
      return ok(res, { idea, counts: ideaCounts() }, 'Promoted out of the parking lot');
    } catch (err) { return bad(res, err); }
  })
);

export default router;
