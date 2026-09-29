import crypto from 'node:crypto';
import { getDb } from '../../db/index.js';
import { saveCredential, readCredential } from '../credentials.js';

// HeyGen over remote MCP — OAuth, no API key.
//
// WHY THIS EXISTS, from artificial_funny/desktop/CLAUDE.md:
//
//   Remote MCP  generation spends the credits already in the user's HeyGen WEB
//               plan, and reaches the avatars, outfits and cloned voices that
//               account already owns.
//   API key     billed against a SEPARATE pay-as-you-go balance. A Creator/Pro
//               web subscription funds NONE of it, and there have been no free
//               API credits since Feb 2026.
//
// So for anyone already paying for HeyGen, the API key charges a second time for
// capacity they own. MCP is the default path; the key is the fallback for
// un-watermarked or high-volume work.
//
// Ported from `app/services/heygen_mcp.py`, verified against the live server
// 2026-09-20: dynamic client registration returns 201 with
// token_endpoint_auth_method "none", so a shipped build carries no secret.

export const MCP_RESOURCE = 'https://mcp.heygen.com/mcp/v1';
export const MCP_ENDPOINT = 'https://mcp.heygen.com/mcp/v1/';
const PROTECTED_RESOURCE_METADATA =
  'https://mcp.heygen.com/.well-known/oauth-protected-resource/mcp/v1';
const MCP_PROTOCOL_VERSION = '2025-06-18';

/** Refresh this far ahead of expiry, so a long render never starts on a dying token. */
const REFRESH_MARGIN_MS = 15 * 60 * 1000;

// Cloudflare rejects a default client agent with a 403 that looks exactly like an
// auth failure. Send a real one.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const TIMEOUT_MS = 60_000;

export class McpError extends Error {}
export class NotConnected extends McpError {}

let metadataCache = null;

/** Follow MCP's discovery chain to the authorization server's metadata. */
export async function discover() {
  if (metadataCache) return metadataCache;
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };

  const pr = await fetch(PROTECTED_RESOURCE_METADATA, {
    headers, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!pr.ok) throw new McpError(`HeyGen discovery failed (${pr.status})`);
  const servers = (await pr.json()).authorization_servers ?? [];
  if (!servers.length) throw new McpError('HeyGen advertised no authorization server.');

  const meta = await fetch(`${servers[0]}/.well-known/oauth-authorization-server`, {
    headers, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!meta.ok) throw new McpError(`HeyGen OAuth metadata failed (${meta.status})`);
  const data = await meta.json();

  for (const required of ['authorization_endpoint', 'token_endpoint']) {
    if (!data[required]) throw new McpError(`HeyGen's OAuth metadata is missing ${required}.`);
  }
  metadataCache = data;
  return data;
}

// ── connection row ──────────────────────────────────────────────────────────
function row() {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO provider_accounts (provider, status) VALUES ('heygen_mcp', 'disconnected')`
  ).run();
  return db.prepare("SELECT * FROM provider_accounts WHERE provider = 'heygen_mcp'").get();
}

function setRow(fields) {
  const db = getDb();
  const keys = Object.keys(fields);
  db.prepare(
    `UPDATE provider_accounts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE provider = 'heygen_mcp'`
  ).run(...keys.map((k) => fields[k]));
}

/**
 * Register this install as a public native OAuth client.
 * The client is tied to its redirect_uri and the backend may bind a different
 * port next run, so this re-registers per connect rather than trusting a stored id.
 */
async function registerClient(redirectUri) {
  const meta = await discover();
  if (!meta.registration_endpoint) {
    throw new McpError(
      'HeyGen no longer offers dynamic client registration; the API-key path is the remaining option.'
    );
  }

  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      client_name: 'AI Video Studio',
      application_type: 'native',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'openid profile email',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (res.status !== 200 && res.status !== 201) {
    throw new McpError(`HeyGen refused client registration (${res.status})`);
  }
  const clientId = (await res.json()).client_id;
  if (!clientId) throw new McpError('HeyGen registered a client but returned no client_id.');

  setRow({ hint: clientId });
  return clientId;
}

// ── the authorization dance ─────────────────────────────────────────────────
const pending = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;
const b64url = (buf) => buf.toString('base64url');

/** Returns the URL to open in the system browser. */
export async function beginAuthorization(redirectUri) {
  const meta = await discover();
  setRow({ last_error: null });
  const clientId = await registerClient(redirectUri);

  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(24));

  pending.set(state, { verifier, redirectUri, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL_MS) pending.delete(k);

  const url = new URL(meta.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP_RESOURCE,
  })) url.searchParams.set(k, v);

  // HeyGen overrides client_name, so the consent screen reads "HeyGen MCP
  // Default" rather than this product's name. Expected, not a misconfiguration.
  return { url: url.toString(), state, consentNameIsOverridden: true };
}

export async function completeAuthorization(code, state) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p) throw new McpError("That sign-in didn't match a request this app started. Start again.");
  if (Date.now() - p.at > PENDING_TTL_MS) throw new McpError('That sign-in took too long. Start again.');

  const clientId = row()?.hint;
  if (!clientId) throw new McpError('No registered client; start the connection again.');

  const meta = await discover();
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: p.redirectUri,
      client_id: clientId,
      code_verifier: p.verifier,
      resource: MCP_RESOURCE,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new McpError(`HeyGen refused the sign-in (${res.status})`);
  storeTokens(await res.json());
}

function storeTokens(tok) {
  if (!tok.access_token) throw new McpError('HeyGen returned no access token.');
  // Tokens are secrets; they go through the same encrypted store as every key.
  saveCredential('heygen_mcp', tok.access_token, true);
  if (tok.refresh_token) saveCredential('heygen_mcp_refresh', tok.refresh_token, true);
  setRow({
    status: 'connected',
    quota_checked_at: null,
    last_sync_at: new Date().toISOString(),
    last_error: null,
    quota_remaining: null,
  });
  getDb()
    .prepare("UPDATE provider_accounts SET quota_checked_at = ? WHERE provider = 'heygen_mcp'")
    .run(String(Date.now() + (tok.expires_in ?? 3600) * 1000));
}

async function accessToken() {
  const r = row();
  if (!r || r.status !== 'connected') throw new NotConnected('HeyGen is not connected over MCP.');

  const expiresAt = Number(r.quota_checked_at ?? 0);
  if (expiresAt && expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    const refreshed = await refresh();
    if (refreshed) return refreshed;
  }
  const token = readCredential('heygen_mcp');
  if (!token) throw new NotConnected('The saved HeyGen sign-in could not be read. Connect again.');
  return token;
}

async function refresh() {
  const refreshTok = readCredential('heygen_mcp_refresh');
  const clientId = row()?.hint;
  if (!refreshTok || !clientId) return null;

  const meta = await discover();
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTok,
      client_id: clientId,
      resource: MCP_RESOURCE,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    setRow({ last_error: `Sign-in could not be refreshed (${res.status}). Connect again.` });
    return null;
  }
  const tok = await res.json();
  storeTokens(tok);
  return tok.access_token;
}

// ── JSON-RPC over streamable HTTP ───────────────────────────────────────────
/** Streamable HTTP may answer as SSE; take the first data: frame. */
function parseBody(text) {
  let body = text;
  const stripped = text.trimStart();
  if (stripped.startsWith('event:') || stripped.startsWith('data:')) {
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) { body = line.slice(5).trim(); break; }
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new McpError(`HeyGen sent a response that isn't JSON: ${body.slice(0, 200)}`);
  }
}

async function rpc(headers, method, params, id) {
  const payload = { jsonrpc: '2.0', id, method };
  if (params !== undefined) payload.params = params;

  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST', headers, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new NotConnected('HeyGen rejected the connection. Connect again.');
  if (res.status >= 400) throw new McpError(`HeyGen MCP error ${res.status}`);

  const body = parseBody(await res.text());
  if (body.error) {
    throw new McpError(`${body.error.message ?? 'unknown error'} (code ${body.error.code})`);
  }
  return body.result ?? {};
}

async function mcpHeaders() {
  return {
    Authorization: `Bearer ${await accessToken()}`,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    'User-Agent': USER_AGENT,
  };
}

/**
 * Invoke one MCP tool. Every call re-runs `initialize` because the connection is
 * stateless HTTP and the handshake is one cheap round trip; caching a session
 * would trade that for "session expired" bugs that only appear under load.
 */
export async function callTool(name, args = {}) {
  const headers = await mcpHeaders();
  await rpc(headers, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'ai-video-studio', version: '1.0' },
  }, 1);

  const result = await rpc(headers, 'tools/call', { name, arguments: args }, 2);

  if (result.isError) {
    const text = (result.content ?? [])
      .filter((p) => p.type === 'text').map((p) => p.text).join(' ').trim();
    throw new McpError(text || `HeyGen rejected ${name}.`);
  }
  if (result.structuredContent) return result.structuredContent;

  const decoded = [];
  for (const part of result.content ?? []) {
    if (part.type !== 'text') continue;
    try { decoded.push(JSON.parse(part.text)); } catch { decoded.push(part.text); }
  }
  if (!decoded.length) return null;
  return decoded.length === 1 ? decoded[0] : decoded;
}

/** What this account's server actually exposes. Costs nothing. */
export async function listTools() {
  const headers = await mcpHeaders();
  await rpc(headers, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'ai-video-studio', version: '1.0' },
  }, 1);
  const result = await rpc(headers, 'tools/list', {}, 2);
  return result.tools ?? [];
}

export function isConnected() {
  const r = row();
  return !!r && r.status === 'connected' && !!readCredential('heygen_mcp');
}

export function disconnect() {
  const db = getDb();
  db.prepare("DELETE FROM credentials WHERE provider IN ('heygen_mcp','heygen_mcp_refresh')").run();
  setRow({ status: 'disconnected', last_error: null, quota_remaining: null });
}

export function mcpStatus() {
  const r = row();
  return {
    connected: isConnected(),
    clientId: r?.hint ?? null,
    lastError: r?.last_error ?? null,
    expiresAt: r?.quota_checked_at ? Number(r.quota_checked_at) : null,
  };
}

// ── the tools this account's server exposes ─────────────────────────────────
// Names and argument shapes match artificial_funny's `heygen_mcp.py`, which is
// what the live server answers to.

/** Plan, billing model and remaining credits. Read-only; costs nothing. */
export async function account() {
  return callTool('get_current_user');
}

/**
 * Premium credits left, or null when the shape does not say.
 * null rather than 0 on purpose: a wrong 0 reads as "out of credits" and would
 * block work that is actually affordable.
 */
export function creditsRemaining(acct) {
  const remaining = acct?.subscription?.credits?.premium_credits?.remaining;
  if (typeof remaining === 'number') return Math.trunc(remaining);
  const wallet = acct?.wallet ?? {};
  for (const key of ['balance', 'remaining', 'credits']) {
    if (typeof wallet[key] === 'number') return Math.trunc(wallet[key]);
  }
  return null;
}

/**
 * Voices usable for audio-only synthesis.
 * `engine: starfish` is not a preference — create_speech accepts nothing else,
 * so an unfiltered list offers voices that fail only after the user has picked one.
 */
export async function voices({ priv = false, language, gender, limit = 50, token } = {}) {
  const args = { engine: 'starfish', type: priv ? 'private' : 'public', limit };
  if (language) args.language = language;
  if (gender) args.gender = gender;
  if (token) args.token = token;
  return callTool('list_voices', args);
}

/**
 * Audio-only speech in the voice that will actually ship — the voice gate.
 * COSTS CREDITS. Pauses are SSML break tags in SECONDS; milliseconds are rejected.
 */
export async function synthesize(text, voiceId, { ssml = false, speed = 1.0, locale } = {}) {
  if (!String(text ?? '').trim()) throw new McpError('Nothing to say — the line is empty.');
  if (text.length > 5000) {
    throw new McpError(`That line is ${text.length} characters; HeyGen's limit is 5000. Split it across takes.`);
  }
  if (!(speed >= 0.5 && speed <= 2.0)) {
    throw new McpError(`Speed must be between 0.5 and 2.0 (got ${speed}).`);
  }
  const args = { text, voiceId, inputType: ssml ? 'ssml' : 'text', speed };
  if (locale) args.locale = locale;
  return callTool('create_speech', args);
}

/** Videos already in this HeyGen account. */
export async function listVideos(limit = 20) {
  const raw = await callTool('list_videos', { limit: Math.max(1, Math.min(limit, 100)) });
  const items = Array.isArray(raw) ? raw : raw?.items ?? [];
  return items
    .filter((v) => v && typeof v === 'object' && v.id)
    .map((v) => ({
      id: String(v.id),
      title: String(v.title || 'Untitled'),
      status: String(v.status || 'unknown'),
      createdAt: typeof v.created_at === 'number' ? v.created_at : null,
      thumbnailUrl: v.thumbnail_url ?? null,
      videoUrl: v.video_url ?? null,
      duration: v.duration ?? null,
    }));
}

export async function getVideo(videoId) {
  return callTool('get_video', { video_id: videoId });
}

/** HeyGen caps a page at 50; larger is rejected outright. */
const PAGE = 50;

/**
 * Walk every page rather than silently keeping only the first 50.
 *
 * The guard used to be 20 pages, which is exactly 1000 rows — and a sync that
 * reported "1000 avatars, 1000 voices" looked like a result rather than like a
 * ceiling. The previous build held 1266 avatars, so 266 of them were being
 * dropped by a loop that stopped counting and said nothing.
 *
 * It now stops only when the provider stops handing out a token, and if it ever
 * does hit the ceiling it says so instead of returning a quietly short list.
 */
const MAX_PAGES = 200;

async function paged(tool, args, pick) {
  const out = [];
  const seen = new Set();
  let token = null;
  let pages = 0;

  for (; pages < MAX_PAGES; pages++) {
    const raw = await callTool(tool, { ...args, limit: PAGE, ...(token ? { token } : {}) });
    const items = Array.isArray(raw) ? raw : raw?.looks ?? raw?.voices ?? raw?.items ?? raw?.data ?? [];
    for (const item of items.filter(Boolean).map(pick)) {
      // A provider that repeats a page would otherwise loop forever or double
      // the catalogue; identity is the id, so dedupe on it.
      if (item.id && !seen.has(item.id)) { seen.add(item.id); out.push(item); }
    }
    token = raw?.token ?? raw?.next_token ?? raw?.nextToken ?? null;
    if (!token || !items.length) break;
  }

  if (pages >= MAX_PAGES) {
    throw new McpError(
      `${tool} did not stop paginating after ${MAX_PAGES} pages (${out.length} rows). `
      + 'Refusing to report a truncated catalogue as a complete one.'
    );
  }
  return out;
}

/**
 * The avatar looks this account can render with.
 *
 * A "look" is an outfit/pose of an avatar group, and the LOOK id is what
 * create_video_from_studio wants — listing groups would give ids the renderer
 * rejects.
 */
/**
 * `ownership` is the whole game here.
 *
 *   private  the avatars THIS account owns — yours, ~25 of them, and the ones
 *            whose names match your personas
 *   public   HeyGen's stock catalogue — 9,967 looks, which is not a thing to
 *            mirror into a local database or put in a dropdown
 *
 * Syncing everything took nearly eight minutes and produced a picker nobody
 * could use. Yours are what a roster is made of; stock is something you search.
 */
export async function avatarLooks({ ownership } = {}) {
  const rows = await paged('list_avatar_looks', ownership ? { ownership } : {}, (a) => ({
    id: a.look_id ?? a.id ?? a.avatar_id,
    name: a.name ?? a.look_name ?? a.avatar_name ?? 'Untitled look',
    preview: a.preview_image_url ?? a.image_url ?? a.thumbnail_url ?? null,
    gender: a.gender ?? null,
  }));
  return rows.map((a) => ({
    avatar_id: a.id, avatar_name: a.name,
    preview_image_url: a.preview, gender: a.gender,
  }));
}

/** Voices for rendering. Unfiltered by engine — starfish is create_speech's limit. */
export async function allVoices({ ownership } = {}) {
  const rows = await paged('list_voices', ownership ? { type: ownership } : {}, (v) => ({
    id: v.voice_id ?? v.id,
    name: v.name ?? v.voice_name ?? 'Untitled voice',
    language: v.language ?? null,
    gender: v.gender ?? null,
  }));
  return rows.map((v) => ({ voice_id: v.id, name: v.name, language: v.language, gender: v.gender }));
}

/**
 * Your own voices and everyone else's, in one pass, each marked.
 *
 * A cloned voice is the one you actually want to cast; it is also the one that
 * gets lost when 2,943 stock voices are poured into the same list unlabelled.
 */
export async function voicesByOwnership() {
  const mine = await allVoices({ ownership: 'private' }).catch(() => []);
  const mineIds = new Set(mine.map((v) => v.voice_id));
  const everything = await allVoices();
  return everything.map((v) => ({ ...v, owned: mineIds.has(v.voice_id) }));
}

/**
 * Templates this account holds.
 *
 * `/v2/templates` on the API key was carried as UNVERIFIED for the whole build —
 * it is not in the reference client, and with no key stored it could never be
 * checked. The MCP server exposes `list_templates`, which IS verified: called
 * live it answers, and answers 0 because this account has no templates. An
 * empty list from a working call is a fact; an unverified endpoint is not.
 */
export async function templates() {
  const rows = await paged('list_templates', {}, (t) => ({
    id: t.template_id ?? t.id,
    name: t.name ?? t.title ?? 'Untitled template',
  }));
  return rows.map((t) => ({ template_id: t.id, name: t.name }));
}
