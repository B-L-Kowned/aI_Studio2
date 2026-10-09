import { Router } from 'express';
import { getDb } from '../db/index.js';
import { capabilitiesFor, allowedModes, templatesFor } from '../lib/capabilities.js';
import { validateLicense } from '../lib/license.js';
import {
  saveCredential, listCredentials, testCredential,
} from '../lib/credentials.js';
import { publishTargets, publishChannels, setupCards, editorTools, startSources } from '../data/fixtures.js';
import { llmState, setRouting, isLlmProvider } from '../lib/llm.js';
import { ollamaStatus } from '../lib/llm-runtime.js';
import { programState } from '../lib/programs.js';
import { modeSummary, setProviderMode } from '../lib/providers/mode.js';
import { ok, fail, route } from '../utils/respond.js';
import { budgetState, setBudget } from '../lib/budget.js';
import { storageRoot } from '../lib/exporter.js';
import { tierState, setTier, pullTier } from '../lib/model-tier.js';
import { components } from '../lib/components.js';

const router = Router();

export function workspaceState() {
  const db = getDb();
  const w = db.prepare('SELECT * FROM workspace WHERE id = 1').get();
  const connections = db.prepare('SELECT * FROM publishing_connections').all();
  return {
    entitlement: w.entitlement,
    activeMode: w.active_mode,
    allowedModes: allowedModes(w.entitlement),
    capabilities: capabilitiesFor(w.entitlement),
    templates: templatesFor(w.entitlement),
    licenseHint: w.license_key_hint,
    storageProvider: w.storage_provider,
    // Where exports really land: the seeded placeholder path is never shown as if it were used.
    storagePath: storageRoot(),
    llmProvider: w.llm_provider,
    onboarded: !!w.onboarded_at,
    onboardedAt: w.onboarded_at,
    credentials: listCredentials(),
    // The programs this licence grants, and what follows from them:
    // presenter tabs, what a creation is called, where to land.
    program: programState(w.entitlement, !!w.onboarded_at),
    llm: llmState(),
    providerMode: modeSummary(),
    connections: connections.map((c) => ({ platform: c.platform, status: c.status })),
  };
}

router.get('/workspace', route(async (_req, res) => ok(res, workspaceState())));

// Local model reachability is a live probe and therefore separate from the
// synchronous workspace snapshot. It calls loopback only and never sends a
// prompt or incurs provider usage.
router.get(
  '/workspace/llm/status',
  route(async (_req, res) => ok(res, { ollama: await ollamaStatus() }))
);

/** What this computer has for each job, and the one step that fixes what is missing. */
router.get('/workspace/components', route(async (_req, res) => ok(res, await components())));

// Which local model writes: light (2 GB, default) or full (9 GB, optional).
router.get('/workspace/llm/tier', route(async (_req, res) => ok(res, await tierState())));
router.put('/workspace/llm/tier', route(async (req, res) => {
  try { setTier(req.body?.tier); } catch (err) { return fail(res, 400, err.code, err.message); }
  return ok(res, await tierState(), 'Saved');
}));
router.post('/workspace/llm/tier/download', route(async (req, res) => {
  try { await pullTier(req.body?.tier); } catch (err) { return fail(res, err.code === 'BUSY' ? 409 : err.code === 'LLM_OFFLINE' ? 503 : 400, err.code, err.message); }
  return ok(res, await tierState(), 'Download started');
}));

// The customer's own HeyGen spending limit: what is spent this month, against it.
router.get('/workspace/budget', route(async (_req, res) => ok(res, budgetState())));
router.put('/workspace/budget', route(async (req, res) => {
  try { return ok(res, setBudget(req.body ?? {}), 'Monthly limit saved'); }
  catch (err) { return fail(res, 400, err.code ?? 'BAD_BUDGET', err.message); }
}));

// --- Onboarding step 1: license -------------------------------------------
router.post(
  '/workspace/license',
  route(async (req, res) => {
    const result = validateLicense(req.body?.key);
    if (!result.valid) return fail(res, 400, result.error, result.message);

    getDb()
      .prepare('UPDATE workspace SET entitlement = ?, license_key_hint = ?, active_mode = ? WHERE id = 1')
      .run(result.entitlement, result.hint, result.entitlement);

    return ok(res, workspaceState(), `License validated — ${result.entitlement} unlocked`);
  })
);

// --- Onboarding step 2: storage -------------------------------------------
router.post(
  '/workspace/storage',
  route(async (req, res) => {
    const { provider, path } = req.body ?? {};
    if (!['local', 'google_drive', 'dropbox'].includes(provider)) {
      return fail(res, 400, 'BAD_PROVIDER', 'Storage provider must be local, google_drive or dropbox');
    }
    if (provider === 'local' && !String(path ?? '').trim()) {
      return fail(res, 400, 'PATH_REQUIRED', 'Local storage needs a project root path');
    }
    getDb()
      .prepare('UPDATE workspace SET storage_provider = ?, storage_path = ? WHERE id = 1')
      .run(provider, String(path ?? '').trim());
    return ok(res, workspaceState(), 'Storage location saved');
  })
);

// --- Onboarding step 3: planning AI ---------------------------------------
router.post(
  '/workspace/ai',
  route(async (req, res) => {
    const { provider, key } = req.body ?? {};
    if (!['included', 'openai', 'anthropic', 'xai'].includes(provider)) {
      return fail(res, 400, 'BAD_PROVIDER', 'Unknown planning AI provider');
    }

    if (provider !== 'included') {
      const test = await testCredential(provider, key);
      if (!test.ok) return fail(res, 400, 'BAD_KEY', test.message);
      // verdict 'unknown' still stores the key — the service was unreachable,
      // which says nothing about whether the key is good.
      try { saveCredential(provider, key, test.verdict === 'ok'); }
      catch (err) { return fail(res, 400, 'BAD_KEY', err.message); }
    }

    getDb().prepare('UPDATE workspace SET llm_provider = ? WHERE id = 1').run(provider);
    return ok(res, workspaceState(), 'Planning AI saved');
  })
);

router.post(
  '/workspace/ai/test',
  route(async (req, res) => {
    const { provider, key } = req.body ?? {};
    const test = await testCredential(provider, key);
    return test.ok ? ok(res, test, test.message) : fail(res, 400, 'BAD_KEY', test.message);
  })
);




// --- Which model fulfils which planning capability -------------------------
router.post(
  '/workspace/llm/routing',
  route(async (req, res) => {
    const { capability, provider } = req.body ?? {};
    if (!isLlmProvider(provider)) return fail(res, 400, 'BAD_PROVIDER', `Unknown provider: ${provider}`);
    try {
      setRouting(capability, provider);
    } catch (err) {
      return fail(res, err.code === 'NO_KEY' ? 409 : 400, err.code ?? 'BAD_ROUTING', err.message);
    }
    return ok(res, workspaceState(), `${capability} now routed to ${provider}`);
  })
);

// --- How far provider calls may go ----------------------------------------
router.post(
  '/workspace/provider-mode',
  route(async (req, res) => {
    const { mode, confirmBilling } = req.body ?? {};
    // Switching into fixtures or live_read needs no confirmation: renders in
    // live_read are HeyGen's free test renders. Auditions DO spend in live_read,
    // but each one asks for confirmation itself (lib/segments.js). Arming real
    // generation is a money decision and needs saying out loud.
    if (mode === 'live' && confirmBilling !== true) {
      return fail(res, 402, 'CONFIRM_BILLING',
        'Live mode permits real, billable generation. Confirm to enable it.');
    }
    try {
      setProviderMode(mode);
    } catch (err) {
      return fail(res, 400, err.code ?? 'BAD_MODE', err.message);
    }
    return ok(res, workspaceState(), `Provider mode: ${mode}`);
  })
);

// --- Onboarding step 4: publishing connections ----------------------------
router.post(
  '/workspace/connections',
  route(async (req, res) => {
    const { platform, status } = req.body ?? {};
    if (!publishTargets.includes(platform)) return fail(res, 400, 'BAD_PLATFORM', 'Unknown platform');
    const next = status === 'connected' ? 'connected' : 'disconnected';
    getDb()
      .prepare(
        `INSERT INTO publishing_connections (platform, status, connected_at)
         VALUES (?,?,?)
         ON CONFLICT(platform) DO UPDATE SET status = excluded.status, connected_at = excluded.connected_at`
      )
      .run(platform, next, next === 'connected' ? new Date().toISOString() : null);
    return ok(res, workspaceState(), `${platform} ${next}`);
  })
);

// --- Onboarding step 5: finish --------------------------------------------
router.post(
  '/workspace/complete-onboarding',
  route(async (_req, res) => {
    const db = getDb();
    const w = db.prepare('SELECT * FROM workspace WHERE id = 1').get();
    if (w.entitlement === 'none') {
      return fail(res, 400, 'NO_LICENSE', 'A valid license is required before finishing setup');
    }
    if (!w.storage_provider) {
      return fail(res, 400, 'NO_STORAGE', 'Choose a storage location before finishing setup');
    }
    db.prepare("UPDATE workspace SET onboarded_at = datetime('now') WHERE id = 1").run();
    return ok(res, workspaceState(), 'Setup complete');
  })
);

router.post(
  '/workspace/reset-onboarding',
  route(async (_req, res) => {
    getDb().prepare('UPDATE workspace SET onboarded_at = NULL WHERE id = 1').run();
    return ok(res, workspaceState(), 'Onboarding reset');
  })
);

// Switching active context within an entitlement (only 'both' has a choice).
router.post(
  '/workspace/mode',
  route(async (req, res) => {
    const db = getDb();
    const w = db.prepare('SELECT entitlement FROM workspace WHERE id = 1').get();
    const allowed = allowedModes(w.entitlement);
    if (!allowed.includes(req.body?.mode)) {
      return fail(res, 403, 'NOT_LICENSED', `Your license does not include ${req.body?.mode}`);
    }
    db.prepare('UPDATE workspace SET active_mode = ? WHERE id = 1').run(req.body.mode);
    return ok(res, workspaceState(), `Active mode: ${req.body.mode}`);
  })
);

// --- Static-ish metadata ---------------------------------------------------
router.get('/publish-targets', route(async (_req, res) => ok(res, publishChannels)));
router.get('/editor-tools', route(async (_req, res) => ok(res, editorTools)));
router.get('/setup', route(async (_req, res) => ok(res, { cards: setupCards })));
router.get(
  '/start-sources',
  route(async (_req, res) => {
    const caps = workspaceState().capabilities;
    return ok(
      res,
      startSources.map((s) => ({ ...s, locked: !!s.capability && !caps.includes(s.capability) }))
    );
  })
);

export default router;
