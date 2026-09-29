import { getDb } from '../../db/index.js';

// Reading a provider's catalogue and spending its credits are different risks,
// so they get different switches. A single DRY_RUN flag forced you to arm paid
// generation just to see your own avatars.
//
//   fixtures   nothing leaves the machine. Deterministic stand-ins everywhere.
//   live_read  real GET calls (avatars, voices, templates, quota, key checks).
//              Generation is still simulated, so no credits can be spent.
//   live       generation is real too, and a paid render needs confirmation.
//
// The mode is stored in the workspace so it can be changed from Settings — an
// env edit plus a restart is the wrong answer to "how do I connect?". The env
// still provides the initial value, and DRY_RUN is honoured for older configs.

export const MODES = ['fixtures', 'live_read', 'live'];

function envMode() {
  const explicit = (process.env.PROVIDER_MODE || '').trim().toLowerCase();
  if (MODES.includes(explicit)) return explicit;
  return process.env.DRY_RUN === 'false' ? 'live' : 'fixtures';
}

export function providerMode() {
  try {
    const row = getDb().prepare('SELECT provider_mode FROM workspace WHERE id = 1').get();
    if (row?.provider_mode && MODES.includes(row.provider_mode)) return row.provider_mode;
  } catch {
    // Database not open yet (module load, migrations) — fall back to the env.
  }
  return envMode();
}

export function setProviderMode(mode) {
  if (!MODES.includes(mode)) {
    throw Object.assign(new Error(`Mode must be one of ${MODES.join(', ')}`), { code: 'BAD_MODE' });
  }
  getDb().prepare('UPDATE workspace SET provider_mode = ? WHERE id = 1').run(mode);
  return modeSummary();
}

/** May we make read-only calls to the provider? */
export const canReadLive = () => providerMode() !== 'fixtures';

/** May we ask the provider to generate something that costs money? */
export const canGenerateLive = () => providerMode() === 'live';

/** What the UI calls "dry run": no paid generation is possible. */
export const isDryRun = () => !canGenerateLive();

export const MODE_INFO = {
  fixtures: {
    label: 'Fixtures',
    detail: 'Nothing leaves this machine. Deterministic stand-ins for every provider call.',
    spend: 'none',
  },
  live_read: {
    label: 'Test',
    // Not free, and it must not claim to be. Renders go through HeyGen's own
    // test mode and are watermarked but free; AUDITIONS are real synthesis on
    // your plan and cost credits. That is the point of the voice gate — a
    // stand-in voice approves a sound the video never makes — but a mode that
    // says "spend: none" while the credit balance falls is lying to you.
    detail: "Real calls to your account. Renders use HeyGen's own test mode — "
      + 'watermarked and free. Auditions are real speech and cost credits.',
    spend: 'metered',
  },
  live: {
    label: 'Live',
    detail: 'Renders without the watermark. This spends your HeyGen credits.',
    spend: 'billable',
  },
};

export function modeSummary() {
  const mode = providerMode();
  return {
    mode,
    modes: MODES.map((m) => ({ id: m, ...MODE_INFO[m] })),
    dryRun: isDryRun(),
    readsLive: canReadLive(),
    generatesLive: canGenerateLive(),
    envDefault: envMode(),
    ...MODE_INFO[mode],
  };
}
