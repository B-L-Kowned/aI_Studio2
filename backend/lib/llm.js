import { getDb } from '../db/index.js';
import { listCredentials } from './credentials.js';

// Planning capabilities that can each be routed to a different model. The
// deterministic engine is always available and needs no key, so it is the
// fallback for anything unrouted. It is deliberately not called an LLM: the
// old label implied a local model existed when the code was only templates.
export const LLM_CAPABILITIES = [
  { key: 'plan',    label: 'Planning',      detail: 'Brief, outline and scene structure', active: false },
  { key: 'clarify', label: 'Clarification', detail: 'Producer questions and assessments', active: false },
  { key: 'script',  label: 'Scripting',     detail: 'Dialogue generation from an approved plan', active: true },
];

export const LLM_PROVIDERS = [
  { id: 'included',  label: 'Built-in deterministic', needsKey: false, kind: 'deterministic', cost: 'none' },
  { id: 'ollama',    label: 'Local Ollama', needsKey: false, kind: 'local', cost: 'local' },
  { id: 'openai',    label: 'ChatGPT (OpenAI)', needsKey: true, kind: 'cloud', cost: 'provider' },
  { id: 'anthropic', label: 'Claude (Anthropic)', needsKey: true, kind: 'cloud', cost: 'provider' },
  { id: 'xai',       label: 'Grok (xAI)', needsKey: true, kind: 'cloud', cost: 'provider' },
  { id: 'groq',      label: 'Groq', needsKey: true, kind: 'cloud', cost: 'provider' },
];

export function isLlmProvider(id) {
  return LLM_PROVIDERS.some((p) => p.id === id);
}

/** Providers that can be selected: built-in/local, plus cloud providers with a stored key. */
export function availableProviders() {
  const withKeys = new Set(listCredentials().filter((c) => !c.unreadable).map((c) => c.provider));
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
      new Error(`${provider} is not available — add its key before routing work to it`),
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
    providers: availableProviders().map(({ id, label, hasKey, needsKey, kind, cost }) => (
      { id, label, hasKey, needsKey, kind, cost }
    )),
    all: LLM_PROVIDERS.map(({ id, label, needsKey, kind, cost }) => ({ id, label, needsKey, kind, cost })),
    routing: getRouting(),
  };
}
