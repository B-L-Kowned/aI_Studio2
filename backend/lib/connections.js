import { getDb } from '../db/index.js';
import { listCredentials, saveCredential, deleteCredential, testCredential } from './credentials.js';
import { providerName, isCheckable } from './key-check.js';
import { mcpStatus } from './providers/heygen-mcp.js';

// One registry, one connect path. Planning models, the voice vendor and the
// video vendor were each reached a different way; they are all the same thing —
// a key, verified against its own service, stored encrypted, with a status you
// can read. Roles differ, the mechanism does not.
//
// `verified` on a row means a service said yes. A key stored while offline, or
// while provider mode is Fixtures, is kept with verified = 0 and reported as
// unchecked rather than as working.

export const CONNECTIONS = [
  { id: 'openai',     role: 'llm',   label: 'ChatGPT',    vendor: 'OpenAI',
    detail: 'Connected cloud model for script generation' },
  { id: 'anthropic',  role: 'llm',   label: 'Claude',     vendor: 'Anthropic',
    detail: 'Connected cloud model for script generation' },
  { id: 'groq',       role: 'llm',   label: 'Groq',       vendor: 'Groq',
    detail: 'Fast connected model for script generation' },
  { id: 'xai',        role: 'llm',   label: 'Grok',       vendor: 'xAI',
    detail: 'Connected cloud model for script generation' },
  { id: 'elevenlabs', role: 'voice', label: 'ElevenLabs', vendor: 'ElevenLabs',
    detail: 'Voice synthesis for drafts and finals' },
  { id: 'heygen',     role: 'video', label: 'HeyGen',     vendor: 'HeyGen',
    detail: 'Avatars, voices and video generation' },
  // Publishing is a connection like any other, checked the same way. It used to
  // be a row in a fixtures table that said "connected" and reached nothing.
  { id: 'artificial_funny', role: 'publish', label: 'Artificial Funny',
    vendor: 'artificialfunny.com', detail: 'Publish finished videos to your own site' },
];

export const ROLE_LABEL = {
  llm: 'Planning models',
  voice: 'Voice',
  video: 'Video generation',
  publish: 'Publishing',
};

export function isConnection(id) {
  return CONNECTIONS.some((c) => c.id === id);
}

export function connectionById(id) {
  return CONNECTIONS.find((c) => c.id === id) ?? null;
}

/** Every connection with its stored state. Never includes a secret. */
export function listConnections() {
  // An unreadable key is not a connection; it is reported so the page can say
  // "reconnect" instead of showing a connection that fails on first use.
  const all = listCredentials();
  const unreadable = new Set(all.filter((c) => c.unreadable).map((c) => c.provider));
  const stored = Object.fromEntries(all.filter((c) => !c.unreadable).map((c) => [c.provider, c]));
  const db = getDb();

  // HeyGen has two ways in. Reading only `credentials` meant an OAuth sign-in
  // was invisible here while the HeyGen page showed it connected.
  const mcp = mcpStatus();

  return CONNECTIONS.map((c) => {
    const cred = stored[c.id];
    const viaMcp = c.id === 'heygen' && mcp.connected;
    // Generation providers also keep quota and sync state of their own.
    const acct = db.prepare('SELECT * FROM provider_accounts WHERE provider = ?').get(c.id);
    const assets = db
      .prepare('SELECT kind, COUNT(*) n FROM provider_assets WHERE provider = ? GROUP BY kind')
      .all(c.id);

    return {
      ...c,
      connected: !!cred || viaMcp,
      unreadable: unreadable.has(c.id),
      verified: !!cred?.verified || viaMcp,
      hint: viaMcp ? 'signed in' : cred?.hint ?? null,
      // `pocket` reported ONE of the two, MCP winning, so a stored API key was
      // invisible the moment you were also signed in. Either path may stand on
      // its own: MCP covers normal Live production; the optional key adds a
      // free watermarked Test-render path and can be a Live fallback. The
      // router reads them independently, so the report must too.
      pocket: c.id === 'heygen' ? (viaMcp ? 'mcp' : cred ? 'key' : 'none') : null,
      pockets: c.id === 'heygen'
        ? {
            mcp: { connected: viaMcp, hint: viaMcp ? 'signed in' : null },
            key: {
              connected: !!cred,
              verified: !!cred?.verified,
              hint: cred?.hint ?? null,
            },
          }
        : null,
      checkable: isCheckable(c.id),
      name: providerName(c.id),
      quotaRemaining: acct?.quota_remaining ?? null,
      lastSyncAt: acct?.last_sync_at ?? null,
      lastError: acct?.last_error ?? null,
      assets: Object.fromEntries(assets.map((a) => [a.kind, a.n])),
      // A stored-but-unverified key is the state people misread as working.
      status: viaMcp ? 'connected' : !cred ? 'disconnected' : cred.verified ? 'connected' : 'unchecked',
    };
  });
}

/**
 * Save a key for any connection, the same way for all of them:
 * verify against the owning service, store encrypted, report the verdict.
 */
export async function connect(id, key) {
  if (!isConnection(id)) {
    throw Object.assign(new Error(`Unknown connection: ${id}`), { code: 'UNKNOWN' });
  }
  const test = await testCredential(id, key);
  if (!test.ok) throw Object.assign(new Error(test.message), { code: 'BAD_KEY' });

  try {
    saveCredential(id, key, test.verdict === 'ok');
  } catch (err) {
    throw Object.assign(err, { code: 'BAD_KEY' });
  }
  return { verdict: test.verdict, message: test.message };
}

export function disconnect(id) {
  if (!isConnection(id)) {
    throw Object.assign(new Error(`Unknown connection: ${id}`), { code: 'UNKNOWN' });
  }
  deleteCredential(id);
  getDb()
    .prepare("UPDATE provider_accounts SET status = 'disconnected', quota_remaining = NULL WHERE provider = ?")
    .run(id);
}

/** Re-check a stored key without changing it. */
export async function recheck(id) {
  const { readCredential } = await import('./credentials.js');
  const key = readCredential(id);
  if (!key) throw Object.assign(new Error('Nothing stored for this connection'), { code: 'NOT_CONNECTED' });

  const test = await testCredential(id, key);
  getDb()
    .prepare('UPDATE credentials SET verified = ? WHERE provider = ?')
    .run(test.verdict === 'ok' ? 1 : 0, id);
  return { verdict: test.verdict, message: test.message };
}
