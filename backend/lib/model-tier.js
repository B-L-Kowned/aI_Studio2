import { getDb } from '../db/index.js';
import { ollamaStatus, ollamaBaseUrl } from './llm-runtime.js';

/**
 * Which local model the studio writes with. A customer downloads the app to
 * their own machine, so the default is small: the light model handles checks,
 * suggestions and line fixes in 2 GB. The full model rewrites whole scripts
 * better and is an optional 9 GB download, offered, never required.
 */
export const TIERS = {
  light: {
    label: 'Light',
    size: '2 GB',
    models: ['llama3.2:3b', 'llama3.2:latest', 'qwen2.5:3b'],
    good: 'Suggestions, answers, line fixes, post copy. Runs on any recent Mac.',
  },
  full: {
    label: 'Full',
    size: '9 GB',
    // The coder 14B stays with what the draft says; the general 14B invented claims.
    models: ['qwen2.5-coder:14b', 'qwen2.5:14b', 'qwen2.5:14b-instruct', 'qwen2.5:7b', 'llama3.1:8b'],
    good: 'Whole-script rewrites that keep to length and your facts. Best with 16 GB of memory or more.',
  },
};
const PULL = { light: 'llama3.2:3b', full: 'qwen2.5-coder:14b' };

export function chosenTier() {
  const t = getDb().prepare('SELECT llm_tier FROM workspace WHERE id = 1').get()?.llm_tier;
  return t === 'light' || t === 'full' ? t : 'auto';
}

export function setTier(tier) {
  if (!['auto', 'light', 'full'].includes(tier)) {
    throw Object.assign(new Error('Choose auto, light or full.'), { code: 'BAD_TIER' });
  }
  getDb().prepare('UPDATE workspace SET llm_tier = ? WHERE id = 1').run(tier === 'auto' ? null : tier);
}

const has = (installed, m) => installed.includes(m) || installed.includes(`${m}:latest`);

/** The models to try, best first, for the chosen tier. Auto prefers full when it is installed. */
export function tierOrder(tier = chosenTier()) {
  if (tier === 'light') return [...TIERS.light.models, ...TIERS.full.models];
  if (tier === 'full') return [...TIERS.full.models, ...TIERS.light.models];
  return [...TIERS.full.models, ...TIERS.light.models];
}

// One download at a time, its progress kept for the settings page to poll.
let pulling = null;

export async function tierState() {
  const status = await ollamaStatus();
  const installed = status.models ?? [];
  const tier = chosenTier();
  const inUse = status.connected ? tierOrder(tier).find((m) => has(installed, m)) ?? null : null;
  return {
    ollama: status.connected,
    tier,
    inUse,
    inUseTier: inUse ? (TIERS.full.models.includes(inUse) ? 'full' : 'light') : null,
    tiers: Object.entries(TIERS).map(([id, t]) => ({
      id, label: t.label, size: t.size, good: t.good, model: PULL[id],
      installed: t.models.some((m) => has(installed, m)),
    })),
    pulling,
  };
}

/** Download a tier's model through Ollama, in the background. */
export async function pullTier(tier) {
  if (!PULL[tier]) throw Object.assign(new Error('Choose light or full.'), { code: 'BAD_TIER' });
  if (pulling && !pulling.done) throw Object.assign(new Error(`Already downloading ${pulling.model}.`), { code: 'BUSY' });
  const status = await ollamaStatus();
  if (!status.connected) throw Object.assign(new Error('Ollama is not running on this Mac. Open the Ollama app, then try again.'), { code: 'LLM_OFFLINE' });
  const model = PULL[tier];
  pulling = { tier, model, percent: 0, status: 'starting', done: false, error: null };
  const base = ollamaBaseUrl();
  (async () => {
    try {
      const res = await fetch(`${base}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
      if (!res.ok || !res.body) throw new Error(`Ollama refused the download (${res.status}).`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.error) throw new Error(ev.error);
          pulling.status = ev.status ?? pulling.status;
          if (ev.total) pulling.percent = Math.round(((ev.completed ?? 0) / ev.total) * 100);
        }
      }
      Object.assign(pulling, { done: true, percent: 100, status: 'installed' });
    } catch (err) {
      Object.assign(pulling, { done: true, error: err.message });
    }
  })();
  return pulling;
}
