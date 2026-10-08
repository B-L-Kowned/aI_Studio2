import { Router } from 'express';
import { enqueue, cancel, batchState } from '../lib/voice-batch.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

router.get('/voice-batch', route(async (_req, res) => ok(res, batchState())));

router.post('/voice-batch', route(async (req, res) => {
  const ids = Array.isArray(req.body?.productionIds) ? req.body.productionIds.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return fail(res, 400, 'NO_VIDEOS', 'Choose the videos to make the voice for.');
  const added = enqueue(ids);
  return ok(res, batchState(), `${added} video${added === 1 ? '' : 's'} queued for your voice`);
}));

router.post('/voice-batch/cancel', route(async (_req, res) => {
  const n = cancel();
  return ok(res, batchState(), n ? `Stopped — ${n} video${n === 1 ? '' : 's'} taken off the queue` : 'Nothing was queued');
}));

export default router;
