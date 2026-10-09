import { Router } from 'express';
import { schedule, setDueDate, placeInOrder } from '../lib/schedule.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

/** What is blocked on you, what is moving, what is due, what has stalled. */
router.get(
  '/schedule',
  route(async (req, res) =>
    ok(res, schedule({
      idleDays: Number(req.query.idleDays) || undefined,
      dueSoonDays: Number(req.query.dueSoonDays) || undefined,
      weekStart: req.query.weekStart || null,
      mode: req.query.mode || null,
    }))
  )
);

router.post(
  '/productions/:id/due',
  route(async (req, res) => {
    try {
      const due = req.body?.dueAt ? String(req.body.dueAt) : null;
      const r = setDueDate(Number(req.params.id), due);
      return ok(res, r, due ? `Due ${due}` : 'Deadline cleared');
    } catch (err) {
      return fail(res, err.code === 'NOT_FOUND' ? 404 : 400, err.code ?? 'ERROR', err.message);
    }
  })
);

/** The shared production order: put productions at a slot, at the end, or take them out. */
router.post(
  '/schedule/order',
  route(async (req, res) => {
    try {
      const at = req.body?.at === undefined ? 'end' : req.body.at;
      const r = placeInOrder(req.body?.ids, at);
      return ok(res, r, at === null ? 'Taken out of the order' : 'Order updated');
    } catch (err) {
      return fail(res, err.code === 'NOT_FOUND' ? 404 : 400, err.code ?? 'ERROR', err.message);
    }
  })
);

export default router;
