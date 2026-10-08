#!/usr/bin/env node
// Write a ChatGPT prompt pack for productions, one file per video.
//
//   node scripts/export-prompts.mjs --out "<folder>" [--api http://localhost:3433/api]
//        [--match "Product demo"]   only titles containing this text
//        [--speaker Pat]            the name every script line must start with
//
// <folder>/prompts/<Video ID>.md   paste into ChatGPT
// <folder>/ALL-PROMPTS.md      the same, in one file
// <folder>/scripts/            save each answer here as <Video ID>.txt
// <folder>/verify-first.csv     what a person must confirm before scripting
//
// Then: node scripts/import-scripts.mjs --dir "<folder>/scripts"
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const API = opt('api', 'http://localhost:3433/api');
const OUT = opt('out');
const MATCH = opt('match');
const SPEAKER = opt('speaker', 'Pat');
if (!OUT) {
  console.error('usage: export-prompts.mjs --out <folder> [--api <base>] [--match <text>] [--speaker <name>]');
  process.exit(2);
}

async function get(path) {
  const res = await fetch(`${API}${path}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${json.error}: ${json.message}`);
  return json.data;
}

const seconds = (rt) => {
  const [m, s] = String(rt).split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};
// Measured conversational pace for a presenter reading to camera.
const WORDS_PER_MINUTE = 150;

// What ChatGPT needs is the company and the job, not the production plumbing
// ("Primary output: 16:9 master") or the register's tracking columns.
const PRODUCTION_ONLY = new Set([
  'template', 'type', 'audience', 'goal', 'format', 'primary output', 'clip extraction',
  'target runtime', 'register id', 'register duration', 'priority', 'verify first', 'cta',
  'existing asset', 'script link', 'audio link', 'final link', 'owner / next action',
  'completed asset', 'completed confirmed',
]);
const isTracking = (label) => PRODUCTION_ONLY.has(label.toLowerCase()) || /^status:/i.test(label);
const REGISTER_ID = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — /;

const all = await get('/productions');
const list = all
  .filter((p) => REGISTER_ID.test(p.title))
  .filter((p) => !MATCH || p.title.toLowerCase().includes(MATCH.toLowerCase()))
  .sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
// Control assertion: an empty pack must not look like a finished one.
if (list.length === 0) throw new Error('No register productions matched — nothing written');

mkdirSync(join(OUT, 'prompts'), { recursive: true });
mkdirSync(join(OUT, 'scripts'), { recursive: true });

const prompts = [];
const skipped = [];
const checklist = [['Video ID', 'Title', 'Priority', 'Verify before scripting', 'Resolved? (yes/no)', 'Notes']];

for (const summary of list) {
  const p = await get(`/productions/${summary.id}`);
  const id = REGISTER_ID.exec(p.title)[1];
  const field = (label) => p.brief.find((b) => b.label === label)?.value ?? '';
  // Already made, or a script already exists (e.g. from the working pack): nothing to write.
  if (field('Completed asset')) { skipped.push(`${id} (${field('Completed asset')})`); continue; }
  if ((await get(`/productions/${summary.id}/script`)).versions.length) { skipped.push(`${id} (has a script)`); continue; }
  // Facts drawn from the owner's own documents, one sheet per Video ID.
  const sourceFile = join(OUT, 'sources', `${id}.md`);
  const sourceSheet = existsSync(sourceFile) ? readFileSync(sourceFile, 'utf8').trim() : '';
  const runtime = seconds(p.targetRuntime);
  const words = Math.round((runtime / 60) * WORDS_PER_MINUTE);
  const facts = p.brief.filter((b) => b.value && !isTracking(b.label));
  const sections = p.outline.map((s, i) =>
    `${i + 1}. ${s.title} — about ${s.runtime} (~${Math.round((seconds(s.runtime) / 60) * WORDS_PER_MINUTE)} words)`);
  const format = field('Format');
  const voiceOver = /screen recording|diagram|graphics|visuals \+ voice/i.test(format) && !/avatar/i.test(format);
  const verify = field('Verify first');
  if (verify) checklist.push([id, p.title.replace(REGISTER_ID, ''), field('Priority'), verify, '', '']);

  const text = `# ${p.title}

You are writing ${voiceOver ? 'the voice-over' : 'the script'} for a short video. ${SPEAKER} Bialko, the founder, ${voiceOver
    ? `narrates it over ${/diagram/i.test(format) ? 'a diagram' : /graphics/i.test(format) ? 'restrained graphics' : 'a screen recording of the product'} (his cloned voice reads it word for word; he is not on camera)`
    : 'presents it to camera himself (his avatar and cloned voice read it word for word)'}.

## The video
- Production format: ${format}
- Length: ${p.targetRuntime} — about ${words} spoken words in total. Stay within 10% of that.
- Audience: ${field('Audience')}
- Purpose / must show: ${field('Goal')}
- Call to action: ${field('CTA')}

## Structure — follow these sections in order
${sections.join('\n')}

## What we know (use it; do not invent beyond it)
${facts.map((f) => `- **${f.label}:** ${f.value}`).join('\n') || '- (nothing beyond the purpose above)'}
${sourceSheet ? `\n## Source material from our own documents (use these facts; numbers listed as needing confirmation must be written as [CONFIRM: …])\n${sourceSheet.replace(/^# .*\n?/, '')}\n` : ''}${verify ? `\n## Not yet verified — do not state as fact\n${verify}\nWhere the script needs one of these facts, write it as [CONFIRM: …] so a person checks it before recording.\n` : ''}
## Rules
- First person, as ${SPEAKER}. Plain, confident, spoken English — short sentences, no buzzwords, no hype, no alliteration.
- ${voiceOver ? 'Narrate what the viewer is watching step by step ("Here I set the goal…"); never describe buttons or screens you were not told exist — say what the step achieves instead.' : 'Talk to one person, directly.'}
- Never state a number, price, customer, result or credential that is not listed above.
- End on the call to action, said once, clearly.

## Output format — exactly this, nothing else
Every line starts with \`${SPEAKER}: \`, one to three sentences per line, ${runtime > 150 ? '12–24' : runtime > 75 ? '8–16' : '4–8'} lines in total. No headings, no stage directions, no markdown, no quotes around lines. Example:

${SPEAKER}: First thing I say.
${SPEAKER}: Next thing I say.

Save the answer as: scripts/${id}.txt
`;
  writeFileSync(join(OUT, 'prompts', `${id}.md`), text);
  prompts.push(text);
}

writeFileSync(join(OUT, 'ALL-PROMPTS.md'), prompts.join('\n\n---\n\n'));
const csv = checklist.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
writeFileSync(join(OUT, 'verify-first.csv'), `${csv}\n`);
if (!existsSync(join(OUT, 'scripts', 'README.txt'))) {
  writeFileSync(join(OUT, 'scripts', 'README.txt'),
    `Save each ChatGPT answer here as <Video ID>.txt (e.g. V14-02.txt) — the name is printed at the bottom of its prompt.\nThen load them all: node scripts/import-scripts.mjs --dir "${join(OUT, 'scripts')}"\n`);
}

console.log(`${prompts.length} prompts written to ${OUT}/prompts${skipped.length ? ` · ${skipped.length} already made, skipped: ${skipped.map((x) => x.split(' ')[0]).join(', ')}` : ''}`);
console.log(`${checklist.length - 1} videos with facts to verify in ${OUT}/verify-first.csv`);
