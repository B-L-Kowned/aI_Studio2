import { Router } from 'express';
import { schedule, setDueDate } from '../lib/schedule.js';
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

export default router;
