import { readCredential } from './credentials.js';

const JSON_ONLY = 'Return one valid JSON object only. Do not use markdown or add commentary.';
const CLOUD_TIMEOUT_MS = 120_000;
const LOCAL_TIMEOUT_MS = 300_000;

export const LLM_MODELS = {
  openai: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  groq: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  xai: process.env.XAI_MODEL || 'grok-4.6',
  ollama: process.env.OLLAMA_MODEL || 'llama3.1:8b',
};

const OPENAI_COMPATIBLE = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: LLM_MODELS.groq,
    tokenField: 'max_completion_tokens',
  },
  xai: {
    url: 'https://api.x.ai/v1/chat/completions',
    model: LLM_MODELS.xai,
    tokenField: 'max_tokens',
  },
};

export class LlmRuntimeError extends Error {
  constructor(code, message, { provider = null, model = null, status = null } = {}) {
    super(message);
    this.name = 'LlmRuntimeError';
    this.code = code;
    this.provider = provider;
    this.model = model;
    this.status = status;
  }
}

/**
 * Parse constrained output without ever putting the model's reply into an
 * exception. Generated copy may contain private customer information; a parse
 * failure must not turn it into server-log content.
 */
export function parseStructured(text, { provider = 'unknown', model = 'unknown' } = {}) {
  const value = String(text ?? '');
  const candidates = [value];

  const jsonFence = value.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence?.[1]) candidates.push(jsonFence[1].trim());
  const fence = value.match(/```\s*([\s\S]*?)```/);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(value.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      throw new LlmRuntimeError(
        'STRUCTURED_OUTPUT_INVALID',
        `${provider}/${model} returned JSON, but not a JSON object.`,
        { provider, model }
      );
    } catch (err) {
      if (err instanceof LlmRuntimeError) throw err;
    }
  }

  throw new LlmRuntimeError(
    'STRUCTURED_OUTPUT_INVALID',
    `${provider}/${model} did not return valid structured output. Try again or choose another model.`,
    { provider, model }
  );
}

function ollamaBaseUrl() {
  const value = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  let url;
  try { url = new URL(value); } catch {
    throw new LlmRuntimeError('BAD_LOCAL_URL', 'OLLAMA_BASE_URL is not a valid URL.', { provider: 'ollama' });
  }
  // This provider is explicitly the on-device path. Refusing remote hosts keeps
  // a configuration typo from becoming an SSRF path or sending prompts away.
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    throw new LlmRuntimeError(
      'BAD_LOCAL_URL',
      'Local Ollama must use localhost, 127.0.0.1 or ::1.',
      { provider: 'ollama' }
    );
  }
  return value.replace(/\/+$/, '');
}

async function readJson(res, provider, model) {
  if (!res.ok) {
    const auth = res.status === 401 || res.status === 403
      ? ' Check the saved connection and its model permissions.' : '';
    throw new LlmRuntimeError(
      'PROVIDER_HTTP',
      `${provider}/${model} generation failed (HTTP ${res.status}).${auth}`,
      { provider, model, status: res.status }
    );
  }
  try { return await res.json(); } catch {
    throw new LlmRuntimeError(
      'PROVIDER_RESPONSE_INVALID',
      `${provider}/${model} returned a response the studio could not read.`,
      { provider, model, status: res.status }
    );
  }
}

async function request(url, init, { provider, model, timeout, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    if (err instanceof LlmRuntimeError) throw err;
    throw new LlmRuntimeError(
      'PROVIDER_UNREACHABLE',
      `${provider}/${model} could not be reached.`,
      { provider, model }
    );
  }
  return readJson(res, provider, model);
}

async function openAi({ prompt, systemPrompt, maxTokens, fetchImpl, readKey }) {
  const provider = 'openai';
  const model = LLM_MODELS.openai;
  const key = readKey(provider);
  if (!key) throw new LlmRuntimeError('NO_KEY', 'OpenAI has no saved API key.', { provider, model });

  const data = await request('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions: `${systemPrompt || 'You are a helpful assistant.'}\n\n${JSON_ONLY}`,
      input: prompt,
      max_output_tokens: maxTokens,
      text: { format: { type: 'json_object' } },
      store: false,
    }),
  }, { provider, model, timeout: CLOUD_TIMEOUT_MS, fetchImpl });

  const text = typeof data?.output_text === 'string'
    ? data.output_text
    : data?.output?.flatMap((item) => item?.content ?? [])
      .find((part) => part?.type === 'output_text')?.text;
  if (typeof text !== 'string') {
    throw new LlmRuntimeError('PROVIDER_RESPONSE_INVALID', `${provider}/${model} returned no text.`, {
      provider, model,
    });
  }
  return { data: parseStructured(text, { provider, model }), provider, model };
}

async function openAiCompatible(provider, {
  prompt, systemPrompt, maxTokens, temperature, fetchImpl, readKey,
}) {
  const config = OPENAI_COMPATIBLE[provider];
  const key = readKey(provider);
  if (!key) {
    throw new LlmRuntimeError('NO_KEY', `${provider} has no saved API key.`, {
      provider, model: config.model,
    });
  }

  const data = await request(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: `${systemPrompt || 'You are a helpful assistant.'}\n\n${JSON_ONLY}` },
        { role: 'user', content: prompt },
      ],
      [config.tokenField]: maxTokens,
      temperature,
      response_format: { type: 'json_object' },
    }),
  }, { provider, model: config.model, timeout: CLOUD_TIMEOUT_MS, fetchImpl });

  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new LlmRuntimeError(
      'PROVIDER_RESPONSE_INVALID',
      `${provider}/${config.model} returned no text.`,
      { provider, model: config.model }
    );
  }
  return { data: parseStructured(text, { provider, model: config.model }), provider, model: config.model };
}

async function anthropic({ prompt, systemPrompt, maxTokens, temperature, fetchImpl, readKey }) {
  const provider = 'anthropic';
  const model = LLM_MODELS.anthropic;
  const key = readKey(provider);
  if (!key) throw new LlmRuntimeError('NO_KEY', 'Anthropic has no saved API key.', { provider, model });

  const data = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: `${systemPrompt || 'You are a helpful assistant.'}\n\n${JSON_ONLY}`,
      messages: [{ role: 'user', content: prompt }],
    }),
  }, { provider, model, timeout: CLOUD_TIMEOUT_MS, fetchImpl });

  const text = data?.content?.find((part) => part?.type === 'text')?.text;
  if (typeof text !== 'string') {
    throw new LlmRuntimeError('PROVIDER_RESPONSE_INVALID', `${provider}/${model} returned no text.`, {
      provider, model,
    });
  }
  return { data: parseStructured(text, { provider, model }), provider, model };
}

async function ollama({ prompt, systemPrompt, maxTokens, temperature, fetchImpl, model: chosen }) {
  const provider = 'ollama';
  const model = chosen || LLM_MODELS.ollama;
  const data = await request(`${ollamaBaseUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      system: `${systemPrompt || 'You are a helpful assistant.'}\n\n${JSON_ONLY}`,
      stream: false,
      format: 'json',
      // Ollama's default window is 4096 tokens; a long script with its brief
      // overflowed it silently, and the model saw only part of the draft.
      options: { temperature, num_predict: maxTokens, num_ctx: 8192 },
      // Ollama keeps a model loaded for 5 minutes after use. A 14B writing
      // model is ~9.5 GB; left beside the voice model it pushed that to swap.
      // One minute still spans the back-to-back calls of a section-by-section
      // rewrite or a batch, then the memory goes back.
      keep_alive: '1m',
    }),
  }, { provider, model, timeout: LOCAL_TIMEOUT_MS, fetchImpl });

  if (typeof data?.response !== 'string') {
    throw new LlmRuntimeError('PROVIDER_RESPONSE_INVALID', `${provider}/${model} returned no text.`, {
      provider, model,
    });
  }
  return { data: parseStructured(data.response, { provider, model }), provider, model };
}

export async function generateStructured(provider, {
  prompt,
  systemPrompt = '',
  maxTokens = 8192,
  temperature = 0.35,
  fetchImpl = globalThis.fetch,
  readKey = readCredential,
  model = null, // local only: which installed Ollama model to use
} = {}) {
  if (!String(prompt ?? '').trim()) {
    throw new LlmRuntimeError('EMPTY_PROMPT', 'The model prompt is empty.', { provider });
  }
  if (provider === 'anthropic') {
    return anthropic({ prompt, systemPrompt, maxTokens, temperature, fetchImpl, readKey });
  }
  if (provider === 'ollama') {
    return ollama({ prompt, systemPrompt, maxTokens, temperature, fetchImpl, model });
  }
  if (provider === 'openai') {
    return openAi({ prompt, systemPrompt, maxTokens, fetchImpl, readKey });
  }
  if (Object.hasOwn(OPENAI_COMPATIBLE, provider)) {
    return openAiCompatible(provider, {
      prompt, systemPrompt, maxTokens, temperature, fetchImpl, readKey,
    });
  }
  throw new LlmRuntimeError('BAD_PROVIDER', `No execution adapter exists for ${provider}.`, { provider });
}

export async function ollamaStatus({ fetchImpl = globalThis.fetch } = {}) {
  const model = LLM_MODELS.ollama;
  let baseUrl;
  try { baseUrl = ollamaBaseUrl(); } catch (err) {
    return { provider: 'ollama', connected: false, model, models: [], issue: err.message };
  }

  try {
    const res = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1800) });
    const body = await readJson(res, 'ollama', model);
    const models = Array.isArray(body?.models)
      ? body.models.map((item) => item?.name).filter(Boolean)
      : [];
    const installed = models.includes(model) || models.some((name) => name.split(':')[0] === model.split(':')[0]);
    return {
      provider: 'ollama', connected: true, model, models, installed,
      issue: installed ? null : `Ollama is running, but ${model} is not installed.`,
    };
  } catch (err) {
    return {
      provider: 'ollama', connected: false, model, models: [], installed: false,
      issue: err instanceof LlmRuntimeError
        ? err.message
        : 'Ollama is not running on this machine. Start it before routing work locally.',
    };
  }
}
