// Does this key actually work?
//
// Ported from artificial_funny `desktop/app/services/key_check.py` (identical on
// main and all three worktree branches). Same probes, same headers, same three
// verdicts — so every connection in this app behaves the way that one does.
//
//     ok       the service accepted it
//     refused  the service rejected it — wrong, revoked, or for another product
//     unknown  we could not reach the service. NOT a verdict on the key.
//
// The third case matters. Treating "no network" as "bad key" would discard
// working keys on a train; treating it as "fine" would call a typo connected.
//
// Every probe is a READ that costs nothing — a model list or an account lookup.
// Nothing here may spend credits: a check that bills you for checking is worse
// than no check.

/** Short enough not to hold the interface, long enough for a cold TLS handshake. */
const TIMEOUT_MS = 12_000;

/**
 * provider -> { method, url, headers }. All free, all read-only.
 * The first five are taken verbatim from key_check.py.
 */
const PROBES = {
  anthropic: {
    method: 'GET',
    url: 'https://api.anthropic.com/v1/models',
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
  },
  openai: {
    method: 'GET',
    url: 'https://api.openai.com/v1/models',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  groq: {
    method: 'GET',
    url: 'https://api.groq.com/openai/v1/models',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  elevenlabs: {
    method: 'GET',
    url: 'https://api.elevenlabs.io/v1/user',
    headers: (k) => ({ 'xi-api-key': k }),
  },
  // Remaining quota, not a generation. Reading the balance is free; making
  // anything is not, and a key check must never be the thing that spends it.
  heygen: {
    method: 'GET',
    url: 'https://api.heygen.com/v2/user/remaining_quota',
    headers: (k) => ({ 'X-Api-Key': k }),
  },
  // Not in key_check.py — this product's onboarding offers Grok, so it needs a
  // probe. Same shape as the other OpenAI-compatible endpoints.
  xai: {
    method: 'GET',
    url: 'https://api.x.ai/v1/models',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  // The site's own documented check: 200 means valid, 401 means not. Nothing is
  // uploaded and nothing is published by asking.
  artificial_funny: {
    method: 'GET',
    url: `${(process.env.ARTIFICIAL_FUNNY_API || 'https://artificialfunny.com/api').replace(/\/+$/, '')}/auth/validate`,
    headers: (k) => ({ 'X-API-Key': k }),
  },
};

/** What each service is called when we have to name it in a sentence. */
const NAMES = {
  anthropic: 'Claude',
  openai: 'ChatGPT',
  groq: 'Groq',
  elevenlabs: 'ElevenLabs',
  heygen: 'HeyGen',
  xai: 'Grok',
  artificial_funny: 'artificialfunny.com',
};

export function isCheckable(provider) {
  return Object.hasOwn(PROBES, provider);
}

export function providerName(provider) {
  return NAMES[provider] ?? provider;
}

export function checkableProviders() {
  return Object.keys(PROBES);
}

/**
 * Ask the service whether this key is good. Never throws.
 * @returns {Promise<{verdict:'ok'|'refused'|'unknown', detail:string}>}
 */
export async function checkKey(provider, key) {
  const probe = PROBES[provider];
  const name = providerName(provider);
  const value = String(key ?? '').trim();

  if (!value) return { verdict: 'refused', detail: 'No key was given.' };
  if (!probe) {
    // A provider with no probe is not a failure — it is one we cannot ask.
    return { verdict: 'unknown', detail: 'This key is saved but cannot be checked here.' };
  }

  let res;
  try {
    res = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers(value),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return {
      verdict: 'unknown',
      detail: `Saved, but ${name} could not be reached to check it. It will be used as soon as it works.`,
    };
  }

  if (res.status < 300) return { verdict: 'ok', detail: `${name} accepted this key.` };

  if (res.status === 401 || res.status === 403) {
    return {
      verdict: 'refused',
      detail: `${name} rejected this key. Check you copied all of it, and that it is a ${name} key rather than another service's.`,
    };
  }

  // Rate limited means the key was READ and understood. It is not a rejection.
  if (res.status === 429) {
    return { verdict: 'ok', detail: `${name} accepted this key (it is rate-limiting us right now).` };
  }

  return {
    verdict: 'unknown',
    detail: `Saved, but ${name} answered unexpectedly (HTTP ${res.status}), so this key could not be confirmed.`,
  };
}
