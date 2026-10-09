import crypto from 'node:crypto';
import { saveCredential, readCredential, deleteCredential } from './credentials.js';

/**
 * Signing in with AuthenTech, from a desktop install.
 *
 * Everything the studio does works signed out. An AuthenTech account adds one
 * thing: sharing a twin with someone, or receiving theirs, with consent that
 * either side can prove and revoke. So sign-in is offered where sharing is,
 * never demanded at launch.
 *
 * The flow is OAuth authorization code + PKCE with a loopback redirect: the
 * browser comes back to this Mac's own API, so no client secret ships inside
 * the app. The refresh token is kept encrypted like every other key; the
 * access token lives in memory only.
 *
 * The paths below are as AuthenTech confirmed them on 2026-10-08 (WP-6 for
 * OAuth, WP-7 for /v1; neither is live yet). Profiles come with a pairwise
 * subject id per client, and email only through userinfo under `email`. Until AUTHENTECH_CLIENT_ID is set the
 * studio reports "not available yet" instead of sending anyone to a page that
 * does not exist.
 */
const BASE = () => String(process.env.AUTHENTECH_URL || 'https://theauthentech.app').replace(/\/$/, '');
const CLIENT_ID = () => process.env.AUTHENTECH_CLIENT_ID || '';
const PATHS = {
  authorize: '/api/oauth/authorize',
  token: '/api/oauth/token',
  revoke: '/api/oauth/revoke',
  userinfo: '/api/oauth/userinfo',
  signup: '/register',
};
// v1 client scopes are read-only: a share is started by the owner on
// AuthenTech's own screens, so the app asks only to receive.
const SCOPES = 'openid profile email twin:receive';

export const authentechReady = () => !!CLIENT_ID();

const bad = (message, code = 'BAD_REQUEST') => Object.assign(new Error(message), { code });
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// One sign-in in flight at a time; it expires so an abandoned tab cannot be replayed.
let pending = null;
let session = null; // { accessToken, expiresAt, profile }

function loopbackOnly(redirectUri) {
  const u = new URL(redirectUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
    throw bad('Sign-in must come back to this computer.', 'BAD_REDIRECT');
  }
  return redirectUri;
}

/** The AuthenTech page to open in the browser, for signing in or creating an account. */
export function startSignIn({ redirectUri, createAccount = false }) {
  if (!authentechReady()) throw bad('Sign-in with AuthenTech is not available yet.', 'NOT_CONFIGURED');
  const verifier = b64url(crypto.randomBytes(32));
  const state = b64url(crypto.randomBytes(16));
  pending = { verifier, state, redirectUri: loopbackOnly(redirectUri), expiresAt: Date.now() + 10 * 60 * 1000 };
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID(),
    redirect_uri: pending.redirectUri,
    scope: SCOPES,
    state,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    ...(createAccount ? { prompt: 'create' } : {}),
  });
  return `${BASE()}${PATHS.authorize}?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(`${BASE()}${PATHS.token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID(), ...params }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw bad(body.error_description || body.error || `AuthenTech refused the sign-in (${res.status}).`, 'SIGN_IN_FAILED');
  if (body.refresh_token) saveCredential('authentech_refresh', body.refresh_token, true);
  session = { accessToken: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 900) * 1000, profile: null };
  return session;
}

/** The browser's return with a code: exchange it, once, for tokens. */
export async function finishSignIn({ code, state }) {
  const p = pending;
  pending = null;
  if (!p || p.expiresAt < Date.now()) throw bad('That sign-in took too long. Start it again from the studio.', 'EXPIRED');
  const a = Buffer.from(String(state ?? '')); const b = Buffer.from(p.state);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad('That sign-in did not start here.', 'BAD_STATE');
  if (!code) throw bad('AuthenTech did not return a code.', 'NO_CODE');
  await tokenRequest({ grant_type: 'authorization_code', code: String(code), redirect_uri: p.redirectUri, code_verifier: p.verifier });
  return accountState();
}

async function accessToken() {
  if (session && session.expiresAt - 30000 > Date.now()) return session.accessToken;
  const refresh = readCredential('authentech_refresh');
  if (!refresh) return null;
  try { return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh })).accessToken; }
  catch { return null; }
}

export async function accountState() {
  const ready = authentechReady();
  // canShare turns on when AuthenTech's representative asset grant exists (WP-5/6);
  // the share itself then opens on AuthenTech with the card's references prefilled.
  const base = { available: ready, canShare: false, createAccountUrl: `${BASE()}${PATHS.signup}`, signedIn: false, profile: null };
  if (!ready) return base;
  const token = await accessToken().catch(() => null);
  if (!token) return base;
  if (!session.profile) {
    try {
      const res = await fetch(`${BASE()}${PATHS.userinfo}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      const me = await res.json().catch(() => null);
      const p = me?.data ?? me;
      if (res.ok && p) session.profile = { name: p.name ?? p.preferred_username ?? null, email: p.email ?? null };
    } catch { /* offline: still signed in */ }
  }
  return { ...base, signedIn: true, profile: session.profile };
}

/** Sign out here and end the session at AuthenTech too, so the refresh token is dead everywhere. */
export async function signOut() {
  const refresh = readCredential('authentech_refresh');
  session = null;
  pending = null;
  deleteCredential('authentech_refresh');
  if (refresh && authentechReady()) {
    await fetch(`${BASE()}${PATHS.revoke}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID(), token: refresh, token_type_hint: 'refresh_token' }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  }
}
