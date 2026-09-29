import { Router } from 'express';
import {
  listConnections, connect, disconnect, recheck, connectionById, ROLE_LABEL,
} from '../lib/connections.js';
import { syncProvider, getProvider } from '../lib/providers/index.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

router.get(
  '/connections',
  route(async (_req, res) => ok(res, { roles: ROLE_LABEL, items: listConnections() }))
);

router.post(
  '/connections/:id',
  route(async (req, res) => {
    const c = connectionById(req.params.id);
    if (!c) return fail(res, 404, 'NOT_FOUND', 'Unknown connection');

    let result;
    try {
      result = await connect(req.params.id, req.body?.key);
    } catch (err) {
      return fail(res, err.code === 'BAD_KEY' ? 400 : 404, err.code ?? 'ERROR', err.message);
    }

    // A generation provider is only useful once its catalogue is local, so the
    // connect that verified the key also pulls it. A sync failure must not undo
    // a key that the service just accepted.
    let sync = null;
    let syncError = null;
    if (getProvider(req.params.id) && result.verdict === 'ok') {
      try {
        sync = await syncProvider(req.params.id);
      } catch (err) {
        syncError = err.message;
      }
    }

    return ok(
      res,
      { items: listConnections(), verdict: result.verdict, sync, syncError },
      syncError ? `${result.message} Catalogue sync failed: ${syncError}` : result.message
    );
  })
);

router.post(
  '/connections/:id/recheck',
  route(async (req, res) => {
    if (!connectionById(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'Unknown connection');
    try {
      const result = await recheck(req.params.id);
      return ok(res, { items: listConnections(), verdict: result.verdict }, result.message);
    } catch (err) {
      return fail(res, 409, err.code ?? 'ERROR', err.message);
    }
  })
);

router.delete(
  '/connections/:id',
  route(async (req, res) => {
    if (!connectionById(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'Unknown connection');
    disconnect(req.params.id);
    return ok(res, { items: listConnections() }, `${req.params.id} disconnected`);
  })
);

export default router;
