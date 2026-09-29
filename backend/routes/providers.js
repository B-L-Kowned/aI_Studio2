import { Router } from 'express';
import { getDb } from '../db/index.js';
import { saveCredential, deleteCredential } from '../lib/credentials.js';
import {
  listProviders, syncProvider, localAssets, getProvider, pollJob, serializeJob,
} from '../lib/providers/index.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

router.get('/providers', route(async (_req, res) => ok(res, listProviders())));

router.get(
  '/providers/:id',
  route(async (req, res) => {
    const found = listProviders().find((p) => p.id === req.params.id);
    return found ? ok(res, found) : fail(res, 404, 'NOT_FOUND', 'Unknown provider');
  })
);

// Connect: test the key, store it encrypted, then immediately pull.
router.post(
  '/providers/:id/connect',
  route(async (req, res) => {
    const provider = getProvider(req.params.id);
    if (!provider) return fail(res, 404, 'NOT_FOUND', 'Unknown provider');

    const key = req.body?.key;
    const test = await provider.testConnection(key);
    if (!test.ok) return fail(res, 400, 'BAD_KEY', test.message);

    const saved = saveCredential(req.params.id, key, true);
    getDb()
      .prepare(
        `INSERT INTO provider_accounts (provider, status, hint)
         VALUES (?, 'connected', ?)
         ON CONFLICT(provider) DO UPDATE SET status = 'connected', hint = excluded.hint, last_error = NULL`
      )
      .run(req.params.id, saved.hint);

    let sync = null;
    try {
      sync = await syncProvider(req.params.id);
    } catch (err) {
      return ok(res, { providers: listProviders(), syncError: err.message },
        `${provider.meta.label} connected, but the first sync failed: ${err.message}`);
    }
    return ok(res, { providers: listProviders(), sync }, `${provider.meta.label} connected and synced`);
  })
);

router.post(
  '/providers/:id/disconnect',
  route(async (req, res) => {
    if (!getProvider(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'Unknown provider');
    deleteCredential(req.params.id);
    getDb()
      .prepare("UPDATE provider_accounts SET status = 'disconnected', quota_remaining = NULL WHERE provider = ?")
      .run(req.params.id);
    return ok(res, listProviders(), 'Disconnected');
  })
);

// PULL on demand.
router.post(
  '/providers/:id/sync',
  route(async (req, res) => {
    if (!getProvider(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'Unknown provider');
    try {
      const sync = await syncProvider(req.params.id);
      return ok(res, { providers: listProviders(), sync },
        `Pulled ${Object.entries(sync.pulled).map(([k, n]) => `${n} ${k}s`).join(', ')}`);
    } catch (err) {
      return fail(res, 502, err.code ?? 'SYNC_FAILED', err.message);
    }
  })
);

router.get(
  '/providers/:id/assets',
  route(async (req, res) => {
    if (!getProvider(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'Unknown provider');

    // Searched, not shipped. The whole catalogue is ten thousand rows; a picker
    // wants the handful that match what you typed.
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const all = localAssets(req.params.id, req.query.kind);
    const owned = all.filter((a) => a.owned);
    // Yours first — but an account with nothing of its own gets the catalogue
    // rather than an empty picker. "Show only yours" is useless advice when you
    // have none yet, which is exactly the state a new install is in.
    const matched = q
      ? all.filter((a) => a.name.toLowerCase().includes(q))
      : (owned.length ? owned : all);

    return ok(res, {
      items: matched.slice(0, limit),
      matched: matched.length,
      total: all.length,
      // Said plainly, so a short list never reads as the whole answer.
      truncated: matched.length > limit,
      owned: owned.length,
      // Whether this list is your roster or the whole catalogue.
      scope: q ? 'search' : (owned.length ? 'owned' : 'all'),
    });
  })
);

// Jobs pushed to a provider, and the poll that pulls their state back.
router.get(
  '/provider-jobs',
  route(async (_req, res) =>
    ok(res, getDb().prepare('SELECT * FROM provider_jobs ORDER BY id DESC LIMIT 50').all().map(serializeJob))
  )
);

router.get(
  '/provider-jobs/:jobId',
  route(async (req, res) => {
    const job = await pollJob(Number(req.params.jobId));
    return job ? ok(res, job) : fail(res, 404, 'NOT_FOUND', 'Job not found');
  })
);

export default router;
