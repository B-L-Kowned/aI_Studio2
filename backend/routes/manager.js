import { Router } from 'express';
import { manager, setDeadlines } from '../lib/manager.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

router.get('/manager', route(async (_req, res) => ok(res, manager())));

router.put('/manager/deadlines', route(async (req, res) => {
  try { setDeadlines(req.body ?? {}); return ok(res, manager(), 'Deadlines saved'); }
  catch (err) { return fail(res, err.code === 'BAD_DATE' ? 400 : 500, err.code ?? 'ERROR', err.message); }
}));

export default router;
