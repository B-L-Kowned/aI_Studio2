import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rmSync } from 'node:fs';
import { getDb } from '../db/index.js';
import { authFetch, authentechBase, authentechClientId, isSignedIn } from './authentech.js';
import { buildPackage } from './twin-package.js';

/**
 * Twin shares recorded on AuthenTech, per its contract (WP-6/7):
 *
 *   1. draft      POST /api/v1/twin-shares/drafts   (owner's token)
 *   2. confirm    the owner confirms on AuthenTech's own screen (confirm_url)
 *   3. return     302 to this Mac with share_id + an ES256 assertion
 *   4. accept     the recipient accepts at /api/oauth/share/accept?share=…
 *   5. verify     GET /api/v1/twin-shares/{id} (owner or recipient only)
 *   6. events     GET /api/v1/events?after=…  (accepted / revoked)
 *
 * The app never records consent itself: AuthenTech does, on its screen.
 * Withdrawal also happens on AuthenTech; the app hears it through events.
 */

const run = promisify(execFile);
const bad = (message, code = 'BAD_REQUEST') => Object.assign(new Error(message), { code });
const PATHS = {
  drafts: '/api/v1/twin-shares/drafts',
  share: (id) => `/api/v1/twin-shares/${encodeURIComponent(id)}`,
  received: '/api/v1/grants/received',
  events: '/api/v1/events',
  jwks: '/api/oauth/jwks',
  accept: (id) => `/api/oauth/share/accept?share=${encodeURIComponent(id)}`,
};

const pendingShares = new Map(); // state → { grantId, expiresAt }

/** What the share covers, as AuthenTech's draft wants it: every source file fingerprinted. */
async function assetsFor(g) {
  const scopes = JSON.parse(g.scopes);
  if (g.mode === 'render') {
    // Reference only: nothing changes hands, so nothing is fingerprinted.
    const p = getDb().prepare('SELECT * FROM presenters WHERE id = ?').get(g.presenter_id);
    const look = p?.avatar_asset_id ? getDb().prepare('SELECT * FROM provider_assets WHERE id = ?').get(p.avatar_asset_id) : null;
    return [
      ...(scopes.includes('appearance') && look ? [{ renderer: look.provider, id: look.remote_id, kind: 'appearance', name: look.name }] : []),
      ...(scopes.includes('personality') ? [{ renderer: 'studio', id: `persona-${g.presenter_id}`, kind: 'personality', name: 'Personality' }] : []),
    ];
  }
  // Source mode: the exact files in the package the recipient receives.
  const pkg = await buildPackage(g.presenter_id, { grantId: g.id });
  try {
    const { stdout } = await run('unzip', ['-p', pkg.file, 'twin.json']);
    const card = JSON.parse(stdout);
    const assets = card.files.map((f) => ({
      renderer: 'studio-package', id: f.path, kind: f.kind === 'appearance' ? 'wardrobe' : f.kind, sha256: f.sha256, name: f.name,
    }));
    if (scopes.includes('personality')) {
      const sum = crypto.createHash('sha256').update(JSON.stringify(card.personality)).digest('hex');
      assets.push({ renderer: 'studio-package', id: 'twin.json#personality', kind: 'personality', sha256: sum, name: 'Personality' });
    }
    return assets;
  } finally { rmSync(pkg.file, { force: true }); }
}

/** Start recording one of your shares on AuthenTech; returns the page to open. */
export async function startShare(grantId, redirectUri) {
  if (!(await isSignedIn())) throw bad('Sign in with AuthenTech first.', 'NOT_SIGNED_IN');
  const g = getDb().prepare('SELECT * FROM grants WHERE id = ?').get(grantId);
  if (!g || g.direction !== 'out') throw bad('Only your own shares can be confirmed.', 'NOT_YOURS');
  if (g.status !== 'active') throw bad('This share has ended.', 'ENDED');
  if (!g.email) throw bad('AuthenTech sends the share to an email address — add theirs first.', 'NO_EMAIL');
  const days = g.ends_at ? Math.max(1, Math.round((Date.parse(g.ends_at) - Date.now()) / 86400000)) : 0;
  const draft = await authFetch('POST', PATHS.drafts, {
    recipient_email: g.email, scopes: JSON.parse(g.scopes), mode: g.mode,
    expires_in_days: days, assets: await assetsFor(g),
    label: `${getDb().prepare('SELECT name FROM presenters WHERE id = ?').get(g.presenter_id)?.name ?? 'Twin'} → ${g.counterpart}`,
  });
  if (!draft?.confirm_url) throw bad('AuthenTech did not return a confirm page.', 'NO_DRAFT');
  const state = crypto.randomBytes(16).toString('base64url');
  pendingShares.set(state, { grantId, expiresAt: Date.now() + 30 * 60 * 1000 });
  const url = new URL(draft.confirm_url);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

// ES256 assertion, checked against AuthenTech's published keys.
let jwksCache = { at: 0, keys: [] };
async function keyFor(kid) {
  if (Date.now() - jwksCache.at > 10 * 60 * 1000 || !jwksCache.keys.some((k) => k.kid === kid)) {
    const res = await fetch(`${authentechBase()}${PATHS.jwks}`, { signal: AbortSignal.timeout(10_000) });
    const body = await res.json();
    jwksCache = { at: Date.now(), keys: body.keys ?? body.data?.keys ?? [] };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid) ?? (jwksCache.keys.length === 1 ? jwksCache.keys[0] : null);
  if (!jwk) throw bad('AuthenTech’s signing key was not found.', 'BAD_ASSERTION');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

export async function verifyAssertion(jws, { shareId } = {}) {
  const [h, p, sig] = String(jws ?? '').split('.');
  if (!h || !p || !sig) throw bad('That is not a signed assertion.', 'BAD_ASSERTION');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  if (header.alg !== 'ES256' || header.typ !== 'authentech-twin-share+jwt') throw bad('Unexpected assertion type.', 'BAD_ASSERTION');
  const okSig = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: await keyFor(header.kid), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  if (!okSig) throw bad('The assertion’s signature does not check out.', 'BAD_ASSERTION');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (claims.aud !== authentechClientId()) throw bad('The assertion was issued to a different app.', 'BAD_ASSERTION');
  if (!claims.exp || claims.exp * 1000 < Date.now() - 30_000) throw bad('The assertion has expired — confirm again.', 'BAD_ASSERTION');
  if (shareId && claims.share_id !== shareId) throw bad('The assertion is for a different share.', 'BAD_ASSERTION');
  return claims;
}

/** AuthenTech sent the owner back: record the share id and its proof on the grant. */
export async function finishShare({ share_id: shareId, assertion, state, error }) {
  const p = pendingShares.get(String(state ?? ''));
  pendingShares.delete(String(state ?? ''));
  if (!p || p.expiresAt < Date.now()) throw bad('That confirmation did not start here, or took too long.', 'BAD_STATE');
  if (error) return { declined: true, grantId: p.grantId };
  const claims = await verifyAssertion(assertion, { shareId });
  getDb().prepare('UPDATE grants SET authentech_share_id = ?, authentech_assertion = ?, verified = 1 WHERE id = ?')
    .run(shareId, assertion, p.grantId);
  return { grantId: p.grantId, shareId, acceptUrl: `${authentechBase()}${PATHS.accept(shareId)}`, claims };
}

/** Is the share an imported card claims still live? Asked of AuthenTech, never taken from the card. */
export async function checkShare(shareId) {
  const s = await authFetch('GET', PATHS.share(shareId));
  return { status: s?.status ?? 'unknown', expiresAt: s?.expires_at ?? null, from: s?.from ?? null };
}

export async function receivedShares() {
  const r = await authFetch('GET', PATHS.received);
  return r?.shares ?? [];
}

/** Bring withdrawals and acceptances in from AuthenTech. Safe to call often. */
export async function pollEvents() {
  if (!(await isSignedIn())) return { polled: false };
  const db = getDb();
  let cursor = db.prepare('SELECT authentech_cursor FROM workspace WHERE id = 1').get()?.authentech_cursor ?? '';
  let handled = 0;
  for (let page = 0; page < 20; page++) {
    const r = await authFetch('GET', `${PATHS.events}${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`);
    // { events: [{ seq, type, subject, data: { share_id }, created_at }], next_cursor }
    const events = r?.events ?? [];
    for (const e of events) {
      const id = e.data?.share_id;
      if (!id) continue;
      if (e.type === 'twin_share.revoked') {
        db.prepare("UPDATE grants SET status = 'withdrawn', ended_at = datetime('now'), ended_by = CASE direction WHEN 'out' THEN 'borrower' ELSE 'owner' END WHERE authentech_share_id = ? AND status IN ('active','pending')").run(id);
      }
      if (e.type === 'twin_share.accepted') db.prepare('UPDATE grants SET accepted_at = datetime(\'now\') WHERE authentech_share_id = ?').run(id);
      handled++;
    }
    const next = r?.next_cursor;
    if (next == null || String(next) === String(cursor) || !events.length) { if (next != null) cursor = String(next); break; }
    cursor = String(next);
  }
  db.prepare('UPDATE workspace SET authentech_cursor = ? WHERE id = 1').run(cursor);
  return { polled: true, handled };
}
