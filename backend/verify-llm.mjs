import {
  generateStructured, ollamaStatus, parseStructured, LlmRuntimeError,
} from './lib/llm-runtime.js';
import { buildLlmScriptRequest, segmentsFromLlmScript } from './lib/script-generator.js';

let pass = 0, fail = 0;
const check = (label, condition, detail = '') => {
  if (condition) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail}`); }
};

console.log('\n=== Real local/cloud LLM execution contract ===');

check('direct structured output parses', parseStructured('{"ok":true}').ok === true);
check('fenced structured output is salvaged',
  parseStructured('```json\n{"ok":true}\n```').ok === true);

const privateReply = 'customer-private-line-do-not-log';
let safeError = null;
try { parseStructured(privateReply, { provider: 'ollama', model: 'test' }); }
catch (err) { safeError = err; }
check('malformed output gets a typed error', safeError instanceof LlmRuntimeError);
check('structured errors never contain customer output', !safeError?.message.includes(privateReply));

let ollamaPayload = null;
const local = await generateStructured('ollama', {
  prompt: 'write JSON',
  systemPrompt: 'test',
  fetchImpl: async (_url, init) => {
    ollamaPayload = JSON.parse(init.body);
    return new Response(JSON.stringify({ response: '{"scenes":[]}' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  },
});
check('Ollama generation uses constrained JSON', ollamaPayload?.format === 'json');
check('Ollama response is parsed', Array.isArray(local.data.scenes));

const status = await ollamaStatus({
  fetchImpl: async () => new Response(JSON.stringify({
    models: [{ name: 'llama3.1:8b' }, { name: 'qwen3:8b' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }),
});
check('local status reports installed models', status.connected && status.models.length === 2);
check('configured local model is confirmed', status.installed === true, JSON.stringify(status));

const cloudCalls = [];
const cloudFetch = async (url, init) => {
  const body = JSON.parse(init.body);
  cloudCalls.push({ url, body, headers: init.headers });
  const payload = url.includes('anthropic.com')
    ? { content: [{ type: 'text', text: '{"ready":true}' }] }
    : url.includes('api.openai.com')
      ? { output: [{ content: [{ type: 'output_text', text: '{"ready":true}' }] }] }
      : { choices: [{ message: { content: '{"ready":true}' } }] };
  return new Response(JSON.stringify(payload), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};
for (const provider of ['openai', 'anthropic', 'groq', 'xai']) {
  const result = await generateStructured(provider, {
    prompt: 'Return ready.', systemPrompt: 'Test.', maxTokens: 32,
    fetchImpl: cloudFetch, readKey: () => 'test-key-never-sent',
  });
  check(`${provider} adapter parses its provider response`, result.data.ready === true);
}
check('OpenAI uses the current Responses API with storage disabled',
  cloudCalls[0].url.endsWith('/v1/responses')
    && cloudCalls[0].body.store === false
    && cloudCalls[0].body.text?.format?.type === 'json_object');
check('Anthropic uses its native Messages API',
  cloudCalls[1].url.endsWith('/v1/messages') && cloudCalls[1].headers['x-api-key'] === 'test-key-never-sent');
check('Groq and xAI use their own OpenAI-compatible origins',
  cloudCalls[2].url.includes('api.groq.com') && cloudCalls[3].url.includes('api.x.ai'));

const scenes = [
  { id: 11, ref: '1.1', title: 'Hook', runtime: '0:05', participants: 'Pat', purpose: 'Hook' },
  { id: 12, ref: '2.1', title: 'CTA', runtime: '0:05', participants: 'Pat + Chris', purpose: 'Close' },
];
const request = buildLlmScriptRequest(scenes, 'Demo', { Pat: { voice: 'direct' } }, null, {
  Audience: 'Operators', CTA: 'Try it today',
});
check('script prompt carries the approved brief as data',
  request.prompt.includes('Try it today') && request.prompt.includes('allowed_speakers'));

const segments = segmentsFromLlmScript({ scenes: [
  { scene_ref: '1.1', lines: [{ speaker: 'pat', text: 'Here is the point.' }] },
  { scene_ref: '2.1', lines: [{ speaker: 'Chris', text: 'Try it today.' }] },
] }, scenes);
check('model scenes become ordered studio segments',
  segments.length === 2 && segments[0].speaker === 'Pat' && segments[1].scene_id === 12);

let rejected = null;
try {
  segmentsFromLlmScript({ scenes: [
    { scene_ref: '1.1', lines: [{ speaker: 'Unapproved Person', text: 'No.' }] },
    { scene_ref: '2.1', lines: [{ speaker: 'Pat', text: 'Okay.' }] },
  ] }, scenes);
} catch (err) { rejected = err; }
check('unapproved speakers are rejected', rejected?.code === 'BAD_SCRIPT_SHAPE');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
