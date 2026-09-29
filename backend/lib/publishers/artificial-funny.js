import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { readCredential } from '../credentials.js';

/**
 * artificialfunny.com — the real publishing client.
 *
 * The contract is the one that site's own `routes/publishing.py` documents, and
 * it is deliberately NOT the internal {data,error,message} envelope:
 *
 *   GET  /auth/validate    → 200 { valid: true }, or 401
 *   POST /videos/publish   → 201 { post_id, post_url }
 *
 * Auth is a long-lived per-user API key in `X-API-Key`. The site mounts the
 * router at both /v1 and /api; nginx proxies /api, so that is what we call.
 */
export const PLATFORM = 'Artificial Funny';
export const PROVIDER = 'artificial_funny';

const BASE = (process.env.ARTIFICIAL_FUNNY_API || 'https://artificialfunny.com/api').replace(/\/+$/, '');
const MAX_BYTES = 500 * 1024 * 1024; // the site's own cap; fail here, not after the upload

function headers(key) {
  return { 'X-API-Key': key };
}

/** Is the stored key accepted? Three verdicts, never "probably". */
export async function checkKey(key) {
  if (!key) return { verdict: 'missing', detail: 'No API key stored for artificialfunny.com.' };
  try {
    const res = await fetch(`${BASE}/auth/validate`, { headers: headers(key) });
    if (res.status === 401 || res.status === 403) {
      return { verdict: 'refused', detail: 'artificialfunny.com rejected this key.' };
    }
    if (res.ok) return { verdict: 'ok', detail: 'Key accepted.' };
    return { verdict: 'unknown', detail: `The site answered ${res.status}; that is not a verdict on the key.` };
  } catch (err) {
    // A network failure says nothing about the key, and must not be recorded
    // as though it did.
    return { verdict: 'unknown', detail: `Could not reach artificialfunny.com: ${err.message}` };
  }
}

export async function isConnected() {
  return !!readCredential(PROVIDER);
}

/**
 * Upload a finished export. Returns the post id and its public URL — a real
 * link you can open, rather than a row that says "published".
 */
export async function publish({ file, caption = '', hashtags = [], accountId = 'default' }) {
  const key = readCredential(PROVIDER);
  if (!key) {
    throw Object.assign(
      new Error('artificialfunny.com is not connected — add its API key in Settings → Connections.'),
      { code: 'NOT_CONNECTED' }
    );
  }

  const { size } = await stat(file);
  if (size === 0) {
    throw Object.assign(new Error('The export file is empty.'), { code: 'EMPTY_FILE' });
  }
  if (size > MAX_BYTES) {
    throw Object.assign(
      new Error(`The export is ${(size / 1024 / 1024).toFixed(0)}MB; the site accepts up to 500MB.`),
      { code: 'TOO_LARGE' }
    );
  }

  const form = new FormData();
  form.append('video', new Blob([await readFile(file)], { type: 'video/mp4' }), basename(file));
  form.append('caption', caption);
  form.append('hashtags', Array.isArray(hashtags) ? hashtags.join(',') : String(hashtags ?? ''));
  form.append('account_id', accountId);

  let res;
  try {
    res = await fetch(`${BASE}/videos/publish`, { method: 'POST', headers: headers(key), body: form });
  } catch (err) {
    throw Object.assign(
      new Error(`Could not reach artificialfunny.com: ${err.message}`),
      { code: 'UNREACHABLE' }
    );
  }

  const body = await res.json().catch(() => ({}));
  if (res.status !== 201) {
    throw Object.assign(
      new Error(body.detail || `artificialfunny.com answered ${res.status}.`),
      { code: res.status === 401 ? 'REFUSED' : 'PUBLISH_FAILED' }
    );
  }
  if (!body.post_id) {
    throw Object.assign(
      new Error('The site accepted the upload but returned no post id.'),
      { code: 'NO_POST_ID' }
    );
  }
  return { postId: body.post_id, postUrl: body.post_url ?? null, bytes: size };
}
