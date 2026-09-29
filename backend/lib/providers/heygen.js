import { readCredential } from '../credentials.js';
import { canReadLive, canGenerateLive, providerMode } from './mode.js';
import { checkKey } from '../key-check.js';
export { buildGeneratePayload, splitText, MAX_INPUT_CHARS } from './heygen-payload.js';

// HeyGen adapter — the only file in the app that knows HeyGen exists.
//
// ENDPOINT MAP. Paths marked verified were taken from the working client in
// artificial_funny (`desktop/app/services/heygen_client.py` and
// `key_check.py`), which is byte-identical across main and all three worktree
// branches and drives real renders today. `/v2/templates` is NOT in that client
// and remains a guess.
//
// The quota path was the one this file got wrong: it guessed /v1/, and the real
// endpoint is /v2/user/remaining_quota. That is the call a key check depends on,
// so the check would have failed against every valid key.
const BASE = process.env.HEYGEN_API_BASE || 'https://api.heygen.com';

export const ENDPOINTS = {
  avatars:     { method: 'GET',  path: '/v2/avatars',              verified: true },
  voices:      { method: 'GET',  path: '/v2/voices',               verified: true },
  quota:       { method: 'GET',  path: '/v2/user/remaining_quota', verified: true },
  generate:    { method: 'POST', path: '/v2/video/generate',       verified: true },
  videoStatus: { method: 'GET',  path: '/v1/video_status.get',     verified: true },
  // Not present in the reference client — still unconfirmed.
  // Still unverified, and now unused when signed in over MCP: `list_templates`
  // there is a live, checked call. This stays only for the key-only path, and
  // stays flagged because nobody has ever seen it answer.
  templates:   { method: 'GET',  path: '/v2/templates',            verified: false },
};

class ProviderError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code ?? 'PROVIDER_ERROR';
  }
}

async function callHeyGen(endpoint, { query, body } = {}) {
  const key = readCredential('heygen');
  if (!key) throw new ProviderError('HeyGen is not connected', { code: 'NOT_CONNECTED' });

  const url = new URL(BASE + endpoint.path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: endpoint.method,
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': key },
    body: endpoint.method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });

  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

  if (!res.ok) {
    throw new ProviderError(parsed?.message || parsed?.error || `HeyGen ${res.status}`, {
      status: res.status,
      code: res.status === 401 ? 'BAD_KEY' : 'PROVIDER_ERROR',
    });
  }
  // HeyGen wraps most successful payloads in { data: ... }.
  return parsed?.data ?? parsed;
}

// ---------------------------------------------------------------- fixtures --
// Deterministic stand-ins shaped like the real responses, so every code path
// downstream is exercised identically in dry run and live.
const FIXTURE_AVATARS = [
  { avatar_id: 'fx_avatar_pat',       avatar_name: 'Pat (Studio)',    gender: 'unknown', preview_image_url: null },
  { avatar_id: 'fx_avatar_christine', avatar_name: 'Christine (Guest)', gender: 'unknown', preview_image_url: null },
  { avatar_id: 'fx_avatar_narrator',  avatar_name: 'Narrator',        gender: 'unknown', preview_image_url: null },
  { avatar_id: 'fx_avatar_desk',      avatar_name: 'Desk Presenter',  gender: 'unknown', preview_image_url: null },
];

const FIXTURE_VOICES = [
  { voice_id: 'fx_voice_pat',   name: 'Pat Natural',    language: 'English', gender: 'unknown' },
  { voice_id: 'fx_voice_warm',  name: 'Warm Narrator',  language: 'English', gender: 'unknown' },
  { voice_id: 'fx_voice_bright',name: 'Bright Host',    language: 'English', gender: 'unknown' },
];

const FIXTURE_TEMPLATES = [
  { template_id: 'fx_tpl_podcast', name: 'Two-Person Podcast' },
  { template_id: 'fx_tpl_talking', name: 'Talking Head 16:9' },
];

// ------------------------------------------------------------------- PULL --
export async function listAvatars() {
  if (!canReadLive()) return FIXTURE_AVATARS;
  const data = await callHeyGen(ENDPOINTS.avatars);
  return data.avatars ?? data ?? [];
}

export async function listVoices() {
  if (!canReadLive()) return FIXTURE_VOICES;
  const data = await callHeyGen(ENDPOINTS.voices);
  return data.voices ?? data ?? [];
}

export async function listTemplates() {
  if (!canReadLive()) return FIXTURE_TEMPLATES;
  const data = await callHeyGen(ENDPOINTS.templates);
  return data.templates ?? data ?? [];
}

export async function remainingQuota() {
  if (!canReadLive()) return { remaining: 1000, note: 'fixture quota (dry run)' };
  const data = await callHeyGen(ENDPOINTS.quota);
  return { remaining: data.remaining_quota ?? data.remaining ?? null, raw: data };
}

/** Normalises whatever the provider returns into our provider_assets shape. */
export function normalizeAsset(kind, raw) {
  switch (kind) {
    case 'avatar':
      return {
        remote_id: raw.avatar_id ?? raw.id,
        name: raw.avatar_name ?? raw.name ?? 'Untitled avatar',
        preview_url: raw.preview_image_url ?? raw.preview_url ?? null,
        gender: raw.gender ?? null,
        language: null,
      };
    case 'voice':
      return {
        remote_id: raw.voice_id ?? raw.id,
        name: raw.name ?? raw.voice_name ?? 'Untitled voice',
        preview_url: raw.preview_audio ?? null,
        gender: raw.gender ?? null,
        language: raw.language ?? null,
      };
    default:
      return {
        remote_id: raw.template_id ?? raw.id,
        name: raw.name ?? 'Untitled template',
        preview_url: raw.thumbnail_image_url ?? null,
        gender: null,
        language: null,
      };
  }
}

// ------------------------------------------------------------------- PUSH --
// buildGeneratePayload lives in heygen-payload.js, ported from the working
// client: sentence-boundary splitting at 4500 chars, avatar or talking-photo
// character, optional background, and HeyGen's own `test` flag.

export async function generateVideo(payload) {
  // Fixtures makes no call at all. Otherwise the call is REAL — what decides
  // whether it costs anything is payload.test, which is HeyGen's own free
  // watermarked mode, not something simulated on our side.
  if (!canReadLive()) {
    return {
      video_id: `fx_video_${Date.now().toString(36)}`,
      dry_run: true,
      test: true,
      note: `No call made (mode: ${providerMode()}) — nothing left this machine.`,
    };
  }

  const data = await callHeyGen(ENDPOINTS.generate, { body: payload });
  return {
    video_id: data.video_id ?? data.id,
    test: payload.test === true,
    note: payload.test === true
      ? 'Generated in HeyGen test mode — watermarked, no credits spent.'
      : 'Live render — this spends HeyGen credits.',
  };
}

export async function videoStatus(remoteId, elapsedSeconds = 0) {
  // A simulated job has no remote counterpart, so its status stays simulated.
  if (!canReadLive() || String(remoteId).startsWith('fx_')) {
    // Mirrors the real state machine so the polling UI is genuinely exercised.
    const pct = Math.min(100, Math.round((elapsedSeconds / 8) * 100));
    return {
      status: pct >= 100 ? 'completed' : pct > 0 ? 'processing' : 'pending',
      progress: pct,
      video_url: pct >= 100 ? `file://fixtures/${remoteId}.mp4` : null,
      thumbnail_url: null,
      duration: pct >= 100 ? 53.4 : null,
      credits_used: 0,
    };
  }
  const data = await callHeyGen(ENDPOINTS.videoStatus, { query: { video_id: remoteId } });
  return {
    status: data.status,
    progress: data.status === 'completed' ? 100 : data.progress ?? 0,
    video_url: data.video_url ?? null,
    thumbnail_url: data.thumbnail_url ?? null,
    duration: data.duration ?? null,
    credits_used: data.credits_used ?? null,
  };
}

/**
 * Connection test. Delegates to the shared probe so every vendor is checked the
 * same way, and so "could not reach the service" is never reported as a bad key.
 */
export async function testConnection(key) {
  if (!canReadLive()) {
    return {
      ok: true,
      verdict: 'unknown',
      unverified: true,
      message: 'Stored but NOT checked — provider mode is "fixtures". Switch to Live read to verify it against HeyGen.',
    };
  }
  const { verdict, detail } = await checkKey('heygen', key);
  // `unknown` keeps the key: the service could not be reached, which is not a
  // verdict on the key itself.
  return { ok: verdict !== 'refused', verdict, message: detail };
}

export const meta = {
  id: 'heygen',
  label: 'HeyGen',
  capabilities: ['generate_scene', 'draft_avatar', 'render', 'draft_voice'],
  endpoints: ENDPOINTS,
};
