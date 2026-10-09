import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDb } from '../db/index.js';
import { checkKey } from './key-check.js';
import { canReadLive } from './providers/mode.js';
import { defaultDbPath } from '../db/index.js';

// BYO provider keys are encrypted at rest with AES-256-GCM. The key material
// lives in a 0600 file beside the database.
//
// SEAM FOR DESKTOP: under Electron this whole module should delegate to
// safeStorage.encryptString / decryptString, which is backed by the OS keychain
// (Keychain on macOS, DPAPI on Windows, libsecret on Linux). The table shape and
// the public functions below do not change when that swap happens.
const ALG = 'aes-256-gcm';

function keyPath() {
  return join(dirname(defaultDbPath()), 'credentials.key');
}

function masterKey() {
  const path = keyPath();
  if (existsSync(path)) return Buffer.from(readFileSync(path, 'utf8'), 'hex');

  const key = crypto.randomBytes(32);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key.toString('hex'), { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}

// Mirrors lib/connections.js — every connection stores its key the same way.
const PROVIDERS = new Set([
  'openai', 'anthropic', 'groq', 'xai', 'elevenlabs', 'heygen',
  // OAuth tokens, stored the same encrypted way as everything else.
  'heygen_mcp', 'heygen_mcp_refresh',
  // Signing in with AuthenTech (desktop OAuth); the access token stays in memory.
  'authentech_refresh',
]);

export function isProvider(p) {
  return PROVIDERS.has(p);
}

/** Never returns the secret. Callers get a masked hint only. */
export function saveCredential(provider, secret, verified = false) {
  if (!isProvider(provider)) throw new Error(`Unknown provider: ${provider}`);
  const value = String(secret ?? '').trim();
  if (value.length < 8) throw new Error('Key looks too short to be valid');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const hint = `${value.slice(0, 3)}…${value.slice(-4)}`;

  getDb()
    .prepare(
      `INSERT INTO credentials (provider, ciphertext, iv, tag, hint, verified)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
         hint = excluded.hint, verified = excluded.verified`
    )
    .run(provider, ciphertext.toString('hex'), iv.toString('hex'), tag.toString('hex'), hint, verified ? 1 : 0);

  return { provider, hint, verified };
}

function decrypt(row) {
  const decipher = crypto.createDecipheriv(ALG, masterKey(), Buffer.from(row.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(row.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

const warned = new Set();

/**
 * Backend-only. Never route this through an HTTP response.
 *
 * A row that cannot be decrypted — credentials.key replaced, or a database
 * restored without it — reads as NOT CONNECTED. It used to throw, and because
 * the workspace asks every connection whether it is live, one unreadable row
 * took the whole app down with "Unsupported state or unable to authenticate
 * data". The row is kept so reconnecting simply overwrites it.
 */
export function readCredential(provider) {
  const row = getDb().prepare('SELECT * FROM credentials WHERE provider = ?').get(provider);
  if (!row) return null;
  try {
    return decrypt(row);
  } catch {
    if (!warned.has(provider)) {
      warned.add(provider);
      console.warn(`[warn] stored ${provider} credential cannot be decrypted with ${keyPath()} — treating it as not connected. Reconnect to replace it.`);
    }
    return null;
  }
}

export function listCredentials() {
  return getDb()
    .prepare('SELECT * FROM credentials ORDER BY provider')
    .all()
    .map((r) => ({
      provider: r.provider, hint: r.hint, verified: !!r.verified,
      unreadable: readCredential(r.provider) === null,
    }));
}

export function deleteCredential(provider) {
  getDb().prepare('DELETE FROM credentials WHERE provider = ?').run(provider);
}

/**
 * Ask the service whether the key works. Replaces a prefix check, which passed
 * a typo of the right shape and rejected a valid key of the wrong shape.
 *
 * Returns the three-state verdict from lib/key-check.js. `unknown` means the
 * service could not be reached — the key is kept, not condemned.
 */
export async function testCredential(provider, secret) {
  if (!isProvider(provider)) {
    return { ok: false, verdict: 'refused', message: `Unknown provider: ${provider}` };
  }
  if (!String(secret ?? '').trim()) {
    return { ok: false, verdict: 'refused', message: 'No key was given.' };
  }

  // "Fixtures" promises that nothing leaves this machine, and a key check is a
  // network call like any other. Honour the promise: store the key, say plainly
  // that it was not checked, and let Live read verify it.
  if (!canReadLive()) {
    return {
      ok: true,
      verdict: 'unknown',
      message: 'Saved but not checked — provider mode is "Fixtures", so nothing was sent. Switch to Live read to verify it.',
    };
  }

  const { verdict, detail } = await checkKey(provider, secret);
  return { ok: verdict !== 'refused', verdict, message: detail };
}
