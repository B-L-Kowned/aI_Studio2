import { getDb } from '../db/index.js';
import { listCredentials } from './credentials.js';

// Planning capabilities that can each be routed to a different model. The
// included model is always available and needs no key, so it is the fallback
// for anything unrouted.
export const LLM_CAPABILITIES = [
  { key: 'plan',    label: 'Planning',      detail: 'Brief, outline and scene structure' },
  { key: 'clarify', label: 'Clarification', detail: 'Producer questions and assessments' },
  { key: 'script',  label: 'Scripting',     detail: 'Dialogue generation from an approved plan' },
];

export const LLM_PROVIDERS = [
  { id: 'included',  label: 'Included LLM', needsKey: false },
  { id: 'openai',    label: 'ChatGPT (OpenAI)', needsKey: true },
  { id: 'anthropic', label: 'Claude (Anthropic)', needsKey: true },
  { id: 'xai',       label: 'Grok (xAI)', needsKey: true },
  { id: 'groq',      label: 'Groq', needsKey: true },
];

export function isLlmProvider(id) {
  return LLM_PROVIDERS.some((p) => p.id === id);
}

/** Providers that can actually be used right now: included, plus any with a stored key. */
export function availableProviders() {
  const withKeys = new Set(listCredentials().map((c) => c.provider));
  return LLM_PROVIDERS
    .filter((p) => !p.needsKey || withKeys.has(p.id))
    .map((p) => ({ ...p, hasKey: withKeys.has(p.id) }));
}

export function getRouting() {
  const db = getDb();
  const rows = db.prepare('SELECT capability, provider FROM llm_routing').all();
  const stored = Object.fromEntries(rows.map((r) => [r.capability, r.provider]));
  const fallback = db.prepare('SELECT llm_provider FROM workspace WHERE id = 1').get()?.llm_provider ?? 'included';
  const usable = new Set(availableProviders().map((p) => p.id));

  // A provider whose key was removed must not keep silently routing work.
  return Object.fromEntries(
    LLM_CAPABILITIES.map((c) => {
      const chosen = stored[c.key] ?? fallback;
      return [c.key, usable.has(chosen) ? chosen : 'included'];
    })
  );
}

export function setRouting(capability, provider) {
  if (!LLM_CAPABILITIES.some((c) => c.key === capability)) {
    throw Object.assign(new Error(`Unknown capability: ${capability}`), { code: 'BAD_CAPABILITY' });
  }
  if (!availableProviders().some((p) => p.id === provider)) {
    throw Object.assign(
      new Error(`${provider} has no stored key — add one before routing work to it`),
      { code: 'NO_KEY' }
    );
  }
  getDb()
    .prepare(
      `INSERT INTO llm_routing (capability, provider) VALUES (?,?)
       ON CONFLICT(capability) DO UPDATE SET provider = excluded.provider`
    )
    .run(capability, provider);
  return getRouting();
}

/** What the API reports, and what a future capability request would consult. */
export function llmState() {
  return {
    capabilities: LLM_CAPABILITIES,
    providers: availableProviders().map(({ id, label, hasKey, needsKey }) => ({ id, label, hasKey, needsKey })),
    all: LLM_PROVIDERS.map(({ id, label, needsKey }) => ({ id, label, needsKey })),
    routing: getRouting(),
  };
}
