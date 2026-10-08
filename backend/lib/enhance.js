import { getDb } from '../db/index.js';
import { generateStructured, ollamaStatus, LlmRuntimeError } from './llm-runtime.js';
import { scriptTiming } from './script-timing.js';

/*
 * Two kinds of help with a script, kept apart on purpose:
 *
 *  - Checks: plain rules that run instantly and never guess — length against
 *    the section budgets, filler, hype words, repeats, the website. Most have a
 *    one-click fix that is a mechanical edit.
 *  - Enhance: the local model rewrites. It runs on this Mac (Ollama), costs
 *    nothing, and its output is held to the same checks: a length the app
 *    counts itself (the model's own account of its length is not trusted), every
 *    open [CONFIRM] kept, and any number or web address it introduced flagged.
 *    The result is a new draft version, never an approval.
 */

const CONFIRM_RE = /\[CONFIRM:[^\]]*\]/gi;
const wordsOf = (t) => String(t ?? '').replace(CONFIRM_RE, ' ').split(/\s+/).filter(Boolean).length;
const confirmsOf = (t) => String(t ?? '').match(CONFIRM_RE) ?? [];

// Model preference for writing, best first. A model tuned for code still
// writes clean prose; the 8B one ignores length targets (measured 2026-10-08).
// Measured on three real drafts (2026-10-08): the general 14B writes fresher
// prose but invented pricing claims ("you only pay for the sessions that help
// you"); the coder 14B stays with what the draft says and hits length better.
// Inventing is the worse failure, so it goes first.
const WRITING_MODELS = ['qwen2.5-coder:14b', 'qwen2.5:14b', 'qwen2.5:14b-instruct', 'qwen2.5:7b', 'llama3.1:8b'];

export async function writingModel(preferred = null) {
  const status = await ollamaStatus();
  if (!status.connected) {
    throw Object.assign(new Error('Ollama is not running on this Mac. Open the Ollama app, then try again.'), { code: 'LLM_OFFLINE' });
  }
  const installed = status.models ?? [];
  if (preferred && (installed.includes(preferred) || installed.includes(`${preferred}:latest`))) return preferred;
  const wanted = process.env.ENHANCE_MODEL ? [process.env.ENHANCE_MODEL, ...WRITING_MODELS] : WRITING_MODELS;
  const model = wanted.find((m) => installed.includes(m) || installed.includes(`${m}:latest`));
  if (!model) {
    throw Object.assign(new Error(`No writing model is installed. Run: ollama pull ${WRITING_MODELS[0]}`), { code: 'NO_MODEL' });
  }
  return model;
}

// ------------------------------------------------------------------ checks

// Only stock phrases are removed automatically. Single words like "actually"
// often carry the meaning ("work that has actually begun" is not "work that has
// begun"), so they are pointed out, never cut.
const FILLER = [
  [/\bin order to\b/gi, 'to'],
  [/\b(?:at the end of the day|that being said|needless to say|it is important to note that|it's important to note that|it goes without saying that),?\s*/gi, ''],
];
const SOFT_FILLER = /\b(basically|literally)\b/gi;
const HYPE = /\b(revolutionary|revolutioni[sz]e|game[- ]chang(?:ing|er)|seamless(?:ly)?|unlock(?:s|ing)?|empower(?:s|ing|ment)?|cutting[- ]edge|leverag(?:e|es|ing)|synerg(?:y|ies)|world[- ]class|best[- ]in[- ]class|next[- ]level|supercharg(?:e|es|ing)|transformative|unparalleled|groundbreaking|state[- ]of[- ]the[- ]art|effortless(?:ly)?|journey|compelling|take control|dynamic|thriving|real impact|every step of the way)\b/gi;
// Short and function words start alike all the time ("where we work") without
// anyone hearing alliteration; only content words count.
const STOP = new Set(['what', 'when', 'where', 'which', 'while', 'who', 'whom', 'whose', 'with', 'within', 'will', 'would',
  'that', 'this', 'than', 'then', 'they', 'them', 'their', 'there', 'these', 'those', 'should', 'shall', 'could', 'can',
  'from', 'have', 'has', 'had', 'been', 'being', 'were', 'your', 'yours', 'some', 'such', 'more', 'most', 'many', 'much',
  'into', 'onto', 'over', 'also', 'only', 'just', 'like', 'make', 'made', 'does', 'done']);
const DOMAIN_RE = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|app|org|net|io|biz|me|co|ai|us|info))\b/gi;

const capitalise = (t) => t.replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
const tidy = (t) => capitalise(String(t)
  .replace(/\s{2,}/g, ' ')
  .replace(/\s+([,.!?;:])/g, '$1')
  .replace(/,\s*,/g, ',')
  .trim());
const domainOf = (url) => {
  try { return new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
};
const sentencesOf = (t) => String(t).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

function briefOf(productionId) {
  return Object.fromEntries(getDb().prepare('SELECT label, value FROM brief_fields WHERE production_id = ? ORDER BY position')
    .all(productionId).map((b) => [b.label, b.value]));
}

/** Lines placed into sections by where they fall in the running time — as the Script screen shows them. */
function placeLines(lines, sections) {
  const planned = sections.reduce((n, s) => n + s.seconds, 0);
  const total = lines.reduce((n, l) => n + wordsOf(l.text), 0);
  if (!sections.length || !planned) return [{ title: null, seconds: 0, lines }];
  const bounds = []; let acc = 0;
  for (const s of sections) { acc += s.seconds / planned; bounds.push(acc); }
  const out = sections.map((s) => ({ ...s, lines: [] }));
  let start = 0;
  for (const l of lines) {
    const w = wordsOf(l.text);
    const mid = total ? (start + w / 2) / total : 0;
    out[Math.min(bounds.findIndex((b) => mid <= b + 1e-9), out.length - 1)].lines.push(l);
    start += w;
  }
  return out;
}

/** The plain checks for a production's latest script. Nothing here calls a model. */
export function reviewScript(productionId) {
  const db = getDb();
  const version = db.prepare('SELECT * FROM script_versions WHERE production_id = ? ORDER BY version DESC LIMIT 1').get(productionId);
  if (!version) return null;
  const lines = db.prepare('SELECT id, speaker, text FROM script_segments WHERE script_version_id = ? ORDER BY position').all(version.id);
  const timing = scriptTiming(productionId);
  const brief = briefOf(productionId);
  const published = !!brief['Completed asset'];
  const wpm = timing.wpm;
  const toWords = (s) => Math.round((s * wpm) / 60);
  const words = lines.reduce((n, l) => n + wordsOf(l.text), 0);
  const targetWords = toWords(timing.targetSeconds);
  const sections = placeLines(lines, timing.sections).map((g) => ({
    title: g.title, seconds: g.seconds, targetWords: toWords(g.seconds),
    words: g.lines.reduce((n, l) => n + wordsOf(l.text), 0),
  }));

  const issues = [];
  const add = (issue) => issues.push({ id: `${issue.kind}-${issue.lineId ?? 'all'}-${issues.length}`, ...issue });

  // A finished video is what it is: only the facts about it matter, not its shape.
  if (!published && targetWords) {
    const off = words - targetWords;
    if (Math.abs(off) > targetWords * 0.1) {
      add({ kind: 'length', severity: 'warn', lineId: null,
        message: off < 0 ? `Short by about ${-off} words for ${timing.targetSeconds}s — Fit to time can fill it from the brief.`
          : `Long by about ${off} words for ${timing.targetSeconds}s — Fit to time can tighten it.` });
    }
  }

  const seen = new Map();
  for (const l of lines) {
    let fixed = l.text;
    for (const [re, sub] of FILLER) fixed = fixed.replace(re, sub);
    fixed = tidy(fixed);
    if (fixed !== l.text && wordsOf(fixed) < wordsOf(l.text)) {
      add({ kind: 'filler', severity: 'fix', lineId: l.id, message: 'Filler words that add length, not meaning.', fix: { lineId: l.id, text: fixed } });
    } else if (fixed !== l.text) {
      add({ kind: 'tidy', severity: 'fix', lineId: l.id, message: 'Spacing or punctuation.', fix: { lineId: l.id, text: fixed } });
    }
    const soft = [...new Set((l.text.match(SOFT_FILLER) ?? []).map((w) => w.toLowerCase()))];
    if (soft.length) add({ kind: 'filler-word', severity: 'warn', lineId: l.id, message: `Filler: ${soft.join(', ')} — cut it if it adds nothing.` });
    const hype = [...new Set((l.text.match(HYPE) ?? []).map((w) => w.toLowerCase()))];
    if (hype.length) add({ kind: 'hype', severity: 'warn', lineId: l.id, message: `Sounds like marketing: ${hype.join(', ')}. Improve line can reword it.` });
    if (wordsOf(l.text) > 40) add({ kind: 'long-line', severity: 'warn', lineId: l.id, message: `${wordsOf(l.text)} words in one line — hard to say in one breath.` });

    // Three or more words in a row starting alike reads as a slogan.
    const ws = l.text.replace(CONFIRM_RE, ' ').split(/\s+/).map((w) => w.replace(/[^a-z]/gi, '').toLowerCase());
    for (let i = 0; i + 2 < ws.length; i++) {
      const run = ws.slice(i, i + 3);
      const c = run[0][0];
      if (c && !/[aeiou]/.test(c) && run.every((w) => w.length >= 4 && !STOP.has(w) && w[0] === c)) {
        add({ kind: 'alliteration', severity: 'warn', lineId: l.id, message: `Alliteration: "${ws.slice(i, i + 3).join(' ')}".` });
        break;
      }
    }

    // A sentence already said earlier in the script.
    const kept = [];
    for (const s of sentencesOf(l.text)) {
      const k = norm(s);
      if (k.split(' ').length >= 5 && seen.has(k)) continue;
      kept.push(s);
      if (k) seen.set(k, l.id);
    }
    if (kept.length && kept.length < sentencesOf(l.text).length) {
      add({ kind: 'repeat', severity: 'fix', lineId: l.id, message: 'Repeats a sentence said earlier.', fix: { lineId: l.id, text: kept.join(' ') } });
    }
  }

  const site = brief.Website ? domainOf(brief.Website) : null;
  if (site && !published) {
    const all = lines.map((l) => l.text).join(' ');
    const said = [...all.matchAll(DOMAIN_RE)].map((m) => m[1].toLowerCase());
    if (!said.includes(site)) {
      add({ kind: 'website', severity: 'warn', lineId: lines.at(-1)?.id ?? null, message: `The script never says the website (${site}).` });
    }
  }

  return {
    versionId: version.id, status: version.status, editable: version.status === 'proposed', published,
    words, targetWords, targetSeconds: timing.targetSeconds, wpm, sections,
    issues, canEnhance: version.status === 'proposed' && !published,
  };
}

/** Apply rule fixes to a draft. Only mechanical edits, only on a draft. */
export function applyFixes(productionId, issueIds) {
  const review = reviewScript(productionId);
  if (!review) throw Object.assign(new Error('No script yet.'), { code: 'NOT_FOUND' });
  if (!review.editable) throw Object.assign(new Error('Only a draft can be changed; approved scripts are fixed line by line.'), { code: 'NOT_DRAFT' });
  const chosen = review.issues.filter((i) => i.fix && (!issueIds?.length || issueIds.includes(i.id)));
  // One fix per line per pass: a second rule's fix was computed on the old text.
  const byLine = new Map();
  for (const i of chosen) if (!byLine.has(i.fix.lineId)) byLine.set(i.fix.lineId, i.fix.text);
  const upd = getDb().prepare('UPDATE script_segments SET text = ? WHERE id = ? AND script_version_id = ?');
  for (const [lineId, text] of byLine) upd.run(text, lineId, review.versionId);
  return { applied: byLine.size };
}

// ------------------------------------------------------------------ enhance

const SYSTEM = [
  'You edit narration scripts for short company videos. Pat, the founder, speaks every line to camera.',
  'Write for the ear: short sentences, plain words, confident and warm. One idea per sentence.',
  'Never invent facts. Names, numbers, prices, dates, programs, outcomes and web addresses must come from FACTS or DRAFT.',
  'If a line needs a fact you do not have, write [CONFIRM: what is needed] instead of guessing.',
  'Keep every existing [CONFIRM: ...] marker exactly as written.',
  'Keep every condition and caveat in the draft ("depends on", "where available", "subject to"): they are facts too.',
  'No hype or cliché (revolutionary, seamless, unlock, empower, game-changing, cutting-edge, journey, compelling, unique, take control, dynamic, thriving, real impact). No alliteration. No rhetorical lists of three.',
].join(' ');

const MODES = {
  fit: 'Bring each section to its word target (within 10%). To add length, explain what is already in FACTS and DRAFT more concretely: who it is for, the situation they are in, what happens when they use it, what to do next. Do not pad with filler.',
  tighten: 'Cut to the word targets. Remove filler and repetition first. Keep every fact and the call to action.',
  polish: 'Keep the length (within 5%) and every fact. Improve how it sounds spoken: rhythm, plain words, clear transitions between sections.',
};

const jobs = new Map(); // productionId → job
export const enhanceJob = (productionId) => {
  const j = jobs.get(productionId);
  return j ? { state: j.state, mode: j.mode, model: j.model, attempt: j.attempt, section: j.section ?? 0, total: j.total ?? 0, error: j.error ?? null, result: j.result ?? null } : null;
};

// Brief fields that are instructions to the producer ("Confirm intended
// learner…", "One verified signup…") are not facts; a model given them writes
// them into the script as if they were. Only fields that state something go in.
const INSTRUCTION_RE = /^(confirm|verify|one verified|one audience|match the|tbd|to be confirmed|check)\b/i;
function factsOf(brief) {
  const keep = ['Company', 'Audience', 'Goal', 'CTA', 'Website', 'Source summary', 'Visual plan', 'Format'];
  return keep.filter((k) => brief[k] && !INSTRUCTION_RE.test(brief[k].trim())).map((k) => `${k}: ${brief[k]}`).join('\n');
}

// A sentence that limits a promise. Losing one turns an honest script into an
// overclaim, and a model will happily "simplify" it away — so it is checked.
// Not "may" or "might": those mostly describe the viewer ("you might be…").
const CAVEAT_RE = /\b(depend(?:s|ing)? on|subject to|eligib\w*|availab\w*|varies|vary by|limited to|where offered|not guaranteed)\b/i;
const caveatsOf = (text) => sentencesOf(String(text).replace(/\n/g, ' ')).filter((x) => CAVEAT_RE.test(x));
const contentWords = (t) => norm(t).split(' ').filter((w) => w.length >= 4 && !STOP.has(w));
// Promises a model reaches for that the brief rarely makes. Present in the
// rewrite but not in the sources, they are sent back.
const CLAIM_RE = /\b(affordabl\w*|cheap\w*|only pay|pay only|free\b|no cost|save[sd]?\b|savings|guarantee\w*|proven|ensures?|best\b|fastest|easiest|personali[sz]ed|tailored|accessible)/gi;
function unsupportedClaims(text, source) {
  const src = source.toLowerCase();
  return [...new Set((String(text).match(CLAIM_RE) ?? []).map((w) => w.toLowerCase()))].filter((w) => !src.includes(w));
}
const CTA_RE = /\b(visit|sign up|book a|schedule a|reach out|get started|if you(?:'|’)re ready|explore [A-Z]\w+(?:\s+(?:at|today|now))?\s*[.!]?$)/im;

/** Share of a's content words that also appear in b. */
function overlap(a, b) {
  const w = contentWords(a); const have = new Set(contentWords(b));
  return w.length ? w.filter((x) => have.has(x)).length / w.length : 0;
}
/** Caveats from `draft` whose content is mostly missing from `text`. */
function lostCaveats(draft, text) {
  const have = new Set(contentWords(text));
  return caveatsOf(draft).filter((c) => {
    const w = contentWords(c);
    return w.length && w.filter((x) => have.has(x)).length / w.length < 0.6;
  });
}

/** Numbers and web addresses in `text` that appear nowhere in `source`. */
function introduced(text, source) {
  const src = source.toLowerCase();
  const nums = [...new Set(String(text).match(/\b\d[\d,.%$]*\b/g) ?? [])].filter((n) => !src.includes(n.toLowerCase()));
  const doms = [...new Set([...String(text).matchAll(DOMAIN_RE)].map((m) => m[1].toLowerCase()))].filter((d) => !src.includes(d));
  return [...nums.map((n) => `number "${n}"`), ...doms.map((d) => `web address "${d}"`)];
}

const SECTION_TASK = {
  fit: (n) => `Write this section in about ${n} words. To add length, say more concretely what FACTS and the draft already say — who it is for, the situation they are in, what happens when they use it, what to do next. No filler.`,
  tighten: (n) => `Cut this section to about ${n} words. Remove filler and repetition first; every fact stays.`,
  polish: (n) => `Keep this section at about ${n} words and every fact; make it easier to say aloud.`,
};

/**
 * One section at a time, each held to its own word count. Asked for the whole
 * script at once, a 14B model returned only the first section about half the
 * time (measured 2026-10-08), and the length drifted by whole sections.
 */
async function runEnhance(job, productionId, mode) {
  const db = getDb();
  const version = db.prepare('SELECT * FROM script_versions WHERE production_id = ? ORDER BY version DESC LIMIT 1').get(productionId);
  const lines = db.prepare('SELECT speaker, text FROM script_segments WHERE script_version_id = ? ORDER BY position').all(version.id);
  const review = reviewScript(productionId);
  const brief = briefOf(productionId);
  const title = db.prepare('SELECT title FROM productions WHERE id = ?').get(productionId).title;
  const draft = lines.map((l) => l.text).join('\n');
  const facts = factsOf(brief);
  const source = `${facts}\n${draft}\n${title}`;
  const wpm = review.wpm;

  const placed = placeLines(lines, scriptTiming(productionId).sections);
  const groups = placed[0]?.title == null
    ? [{ title: 'Script', seconds: review.targetSeconds, lines }]
    : placed;
  const targetOf = (g) => (mode === 'polish' || !g.seconds
    ? Math.max(8, g.lines.reduce((n, l) => n + wordsOf(l.text), 0))
    : Math.max(8, Math.round((g.seconds * wpm) / 60)));

  job.total = groups.length;
  const written = [];
  for (const [gi, g] of groups.entries()) {
    job.section = gi + 1;
    const own = g.lines.map((l) => l.text).join('\n');
    const confirms = [...new Set(confirmsOf(own))];
    const want = targetOf(g);
    const last = gi === groups.length - 1;
    const site = brief.Website ? domainOf(brief.Website) : null;
    const before = written.flatMap((w) => w.lines);
    const tolerance = want < 30 ? 0.25 : 0.15;
    const prompt = [
      `VIDEO: ${title}`,
      `SECTION ${gi + 1} of ${groups.length}: ${g.title}`,
      SECTION_TASK[mode](want),
      `FACTS (the only facts you may use besides the draft):\n${facts || '(none)'}`,
      `THE WHOLE DRAFT, for context:\n${draft}`,
      written.length ? `ALREADY WRITTEN (sections before this one — do not repeat them):\n${written.flatMap((w) => w.lines).join('\n')}` : '',
      `THIS SECTION NOW${own ? '' : ' (empty — write it from FACTS and the draft)'}:\n${own || '(nothing yet)'}`,
      confirms.length ? `KEEP THESE MARKERS EXACTLY: ${confirms.join(' ')}` : '',
      last ? `This is the last section: end with the call to action${site ? ` and the website (${site})` : ''}, once.`
        : 'Do not mention the website or a call to action here — only the last section does that.',
      'Say each idea once: nothing from ALREADY WRITTEN again.',
      'Return JSON: {"lines":["<one or two sentences>", "..."]}',
    ].filter(Boolean).join('\n\n');

    let best = null; let feedback = '';
    for (job.attempt = 1; job.attempt <= 3; job.attempt++) {
      const out = await generateStructured('ollama', {
        model: job.model, systemPrompt: SYSTEM, temperature: 0.45, maxTokens: 900,
        prompt: feedback ? `${prompt}\n\nYOUR LAST VERSION WAS REJECTED: ${feedback} Write it again.` : prompt,
      });
      const got = (Array.isArray(out.data?.lines) ? out.data.lines : []).map((x) => tidy(String(x ?? ''))).filter(Boolean);
      const text = got.join('\n');
      const n = wordsOf(text);
      const lost = confirms.filter((c) => !text.includes(c));
      const caveats = lostCaveats(own, text);
      const problems = [];
      if (!got.length) problems.push('it had no lines.');
      if (Math.abs(n - want) > want * tolerance) problems.push(`it has ${n} words; it must have ${Math.round(want * (1 - tolerance))}–${Math.round(want * (1 + tolerance))}.`);
      if (lost.length) problems.push(`it dropped these markers: ${lost.join(' ')}.`);
      if (caveats.length) problems.push(`it dropped or softened these conditions, which must stay: ${caveats.map((c) => `"${c}"`).join(' ')}.`);
      const mentionsSite = site && text.toLowerCase().includes(site);
      if (!last && (mentionsSite || got.some((x) => CTA_RE.test(x)))) problems.push('it mentions the website or a call to action, which belongs only in the last section.');
      if (last && site && draft.toLowerCase().includes(site) && !mentionsSite) problems.push(`it must end with the website, ${site}.`);
      const repeats = got.filter((x, k) => contentWords(x).length >= 5
        && (before.some((y) => overlap(x, y) >= 0.6) || got.slice(0, k).some((y) => overlap(x, y) >= 0.6)));
      const claims = unsupportedClaims(text, source);
      if (claims.length) problems.push(`it promises things nothing in FACTS or the draft says (${claims.join(', ')}) — remove them.`);
      if (repeats.length) problems.push(`it repeats what an earlier section said: ${repeats.map((r) => `"${r}"`).join(' ')}.`);
      const score = Math.abs(n - want) / want + lost.length + caveats.length + repeats.length * 0.5 + claims.length + (problems.some((x) => x.includes('last section')) ? 0.5 : 0);
      if (got.length && (!best || score < best.score)) best = { lines: got, words: n, lost, caveats, claims, score };
      if (!problems.length) break;
      feedback = problems.join(' ');
    }
    if (!best) throw Object.assign(new Error(`The model returned nothing for "${g.title}". Nothing was changed — try again.`), { code: 'BAD_OUTPUT' });
    written.push({ title: g.title, ...best, want });
  }

  const words = written.reduce((n, w) => n + w.words, 0);
  const target = written.reduce((n, w) => n + w.want, 0);
  // Still far off after every retry: report it rather than leave a draft to undo.
  if (Math.abs(words - target) > target * 0.25) {
    throw Object.assign(new Error(`The model could not reach the length (${words} words against ${target}). Nothing was changed — try again, or write the short sections by hand.`), { code: 'BAD_OUTPUT' });
  }

  // Lines into the shot-list rows of the same section, so Visuals lines up.
  const scenes = db.prepare('SELECT id, title FROM scenes WHERE production_id = ? ORDER BY position').all(productionId);
  const sceneFor = (t) => scenes.find((s) => norm(s.title) === norm(t))?.id ?? null;
  const speaker = lines[0]?.speaker || 'Pat';
  const flat = written.flatMap((w) => w.lines.map((text) => ({ text, scene: sceneFor(w.title) })));
  const all = flat.map((l) => l.text).join(' ');

  const created = db.transaction(() => {
    const next = (db.prepare('SELECT MAX(version) m FROM script_versions WHERE production_id = ?').get(productionId).m ?? 0) + 1;
    const vid = db.prepare('INSERT INTO script_versions (production_id, version, status, generator_provider, generator_model) VALUES (?,?,?,?,?)')
      .run(productionId, next, 'proposed', 'ollama', job.model).lastInsertRowid;
    const ins = db.prepare('INSERT INTO script_segments (script_version_id, scene_id, position, speaker, text) VALUES (?,?,?,?,?)');
    flat.forEach((l, i) => ins.run(vid, l.scene, i, speaker, l.text));
    return { versionId: vid, version: next };
  })();

  job.result = {
    ...created, from: version.version, words, before: review.words, target,
    flags: [...introduced(all, source).map((x) => `New ${x} — not in the brief or draft; check it.`),
      ...written.flatMap((w) => w.lost.map((c) => `Dropped ${c} — add it back or answer it.`)),
      ...written.flatMap((w) => w.caveats.map((c) => `Lost a condition: "${c}" — put it back before approving.`)),
      ...[...new Set(written.flatMap((w) => w.claims))].map((c) => `Promises "${c}" — nothing in the brief or draft says so; check it.`)],
  };
  job.state = 'done';
}

export async function startEnhance(productionId, mode, { model: preferred = null } = {}) {
  if (!MODES[mode]) throw Object.assign(new Error(`mode must be one of ${Object.keys(MODES).join(', ')}`), { code: 'BAD_MODE' });
  if (jobs.get(productionId)?.state === 'running') return enhanceJob(productionId);
  const review = reviewScript(productionId);
  if (!review) throw Object.assign(new Error('No script yet.'), { code: 'NOT_FOUND' });
  if (!review.canEnhance) {
    throw Object.assign(new Error(review.published ? 'This video is finished; its script is what was said.' : 'Enhance works on a draft. Approved lines are fixed one at a time.'), { code: 'NOT_DRAFT' });
  }
  const model = await writingModel(preferred);
  const job = { state: 'running', mode, model, attempt: 0, startedAt: Date.now() };
  jobs.set(productionId, job);
  runEnhance(job, productionId, mode).catch((err) => {
    job.state = 'failed';
    job.error = err instanceof LlmRuntimeError || err.code ? err.message : 'Enhance failed.';
  });
  return enhanceJob(productionId);
}

/** Take back an Enhance: the version it made goes, the one before is current again. */
export function undoEnhance(productionId, versionId) {
  const db = getDb();
  const v = db.prepare('SELECT * FROM script_versions WHERE id = ? AND production_id = ?').get(versionId, productionId);
  const latest = db.prepare('SELECT id FROM script_versions WHERE production_id = ? ORDER BY version DESC LIMIT 1').get(productionId);
  if (!v || v.generator_provider !== 'ollama' || v.status !== 'proposed' || latest?.id !== v.id) {
    throw Object.assign(new Error('Only the newest Enhance draft, not yet approved, can be undone.'), { code: 'CANNOT_UNDO' });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM script_segments WHERE script_version_id = ?').run(v.id);
    db.prepare('DELETE FROM script_versions WHERE id = ?').run(v.id);
  })();
  if (jobs.get(productionId)?.result?.versionId === v.id) jobs.delete(productionId);
  return { removed: v.version };
}

/** One line, reworded. Returned for you to use or not; nothing is saved. */
export async function improveLine(productionId, lineId, goal = 'speak') {
  const db = getDb();
  const line = db.prepare(`SELECT ss.*, v.status FROM script_segments ss JOIN script_versions v ON v.id = ss.script_version_id
    WHERE ss.id = ? AND v.production_id = ?`).get(lineId, productionId);
  if (!line) throw Object.assign(new Error('Script line not found.'), { code: 'NOT_FOUND' });
  const around = db.prepare('SELECT text FROM script_segments WHERE script_version_id = ? AND position BETWEEN ? AND ? ORDER BY position')
    .all(line.script_version_id, line.position - 1, line.position + 1).map((r) => r.text);
  const brief = briefOf(productionId);
  const n = wordsOf(line.text);
  const aim = { speak: `about ${n} words`, shorter: `about ${Math.max(4, Math.round(n * 0.7))} words`, longer: `about ${Math.round(n * 1.4)} words` }[goal];
  if (!aim) throw Object.assign(new Error('goal must be speak, shorter or longer'), { code: 'BAD_GOAL' });
  const model = await writingModel();
  const confirms = confirmsOf(line.text);
  const out = await generateStructured('ollama', {
    model, systemPrompt: SYSTEM, temperature: 0.5, maxTokens: 400,
    prompt: [
      `Rewrite ONE line of a narration script so it sounds natural spoken aloud, ${aim}.`,
      goal === 'longer' ? 'Add length only by explaining what the line already says, using FACTS.' : '',
      confirms.length ? `Keep these markers exactly: ${confirms.join(' ')}` : '',
      `FACTS:\n${factsOf(brief) || '(none)'}`,
      `CONTEXT (the lines around it):\n${around.join('\n')}`,
      `LINE TO REWRITE:\n${line.text}`,
      'Return JSON: {"text":"<the rewritten line>"}',
    ].filter(Boolean).join('\n\n'),
  });
  const text = tidy(String(out.data?.text ?? ''));
  if (!text) throw Object.assign(new Error('The model returned nothing. Try again.'), { code: 'BAD_OUTPUT' });
  const lost = confirms.filter((c) => !text.includes(c));
  return {
    lineId, text, words: wordsOf(text), before: n, model,
    flags: [...introduced(text, `${factsOf(brief)}\n${around.join('\n')}`).map((x) => `New ${x} — check it.`),
      ...lost.map((c) => `Dropped ${c}.`),
      ...lostCaveats(line.text, text).map((c) => `Lost a condition: "${c}".`)],
  };
}

// ------------------------------------------------------------------ answering a check

/**
 * Suggest an answer to a [CONFIRM] check — only from what the company has
 * already said. The evidence is found by plain word matching first; the model
 * may only use those numbered sentences, must cite the ones it used, and may
 * say "not answerable". With no evidence, the model is not asked at all.
 */
export async function suggestAnswer(productionId, lineId) {
  const { corpusFor, relevant } = await import('./evidence.js');
  const db = getDb();
  const line = db.prepare(`SELECT ss.*, v.status FROM script_segments ss JOIN script_versions v ON v.id = ss.script_version_id
    WHERE ss.id = ? AND v.production_id = ?`).get(lineId, productionId);
  if (!line) throw Object.assign(new Error('Script line not found.'), { code: 'NOT_FOUND' });
  const checks = confirmsOf(line.text);
  if (!checks.length) throw Object.assign(new Error('This line has no check.'), { code: 'NO_CHECK' });
  const question = checks.map((c) => c.replace(/^\[CONFIRM:\s*/i, '').replace(/\]$/, '')).join('; ');
  const { items, searched } = await corpusFor(productionId);
  const evidence = relevant(items, question, line.text.replace(CONFIRM_RE, ' '));
  if (!evidence.length) return { lineId, found: false, question, searched };

  const model = await writingModel();
  const out = await generateStructured('ollama', {
    model, systemPrompt: SYSTEM, temperature: 0.2, maxTokens: 500,
    prompt: [
      'A line in a narration script has an open check. Decide whether the EVIDENCE answers it.',
      `CHECK: ${question}`,
      `LINE: ${line.text}`,
      `EVIDENCE (numbered; the only thing you may rely on):\n${evidence.map((e, i) => `${i + 1}. ${e.text}`).join('\n')}`,
      'If the evidence clearly answers the check, rewrite the line with the answer and without the [CONFIRM] marker, changing as little as possible.',
      'If it does not clearly answer it, say so. Do not guess, and do not combine evidence into a claim none of it makes.',
      'Return JSON: {"answered": true|false, "text": "<the rewritten line, or empty>", "uses": [<numbers of the evidence used>], "why": "<one short sentence>"}',
    ].join('\n\n'),
  });
  const d = out.data ?? {};
  const uses = (Array.isArray(d.uses) ? d.uses : []).map(Number).filter((n) => n >= 1 && n <= evidence.length);
  const text = tidy(String(d.text ?? '').replace(CONFIRM_RE, ' '));
  const quoted = uses.map((n) => evidence[n - 1]);
  if (!d.answered || !text || !uses.length) {
    return { lineId, found: false, question, searched, why: String(d.why ?? '') || 'The evidence does not clearly answer it.', nearest: evidence.slice(0, 2) };
  }
  // Anything new in the line must be in the sentences it cites.
  const flags = introduced(text, `${line.text}\n${quoted.map((q) => q.text).join('\n')}`).map((x) => `New ${x} — not in the quoted evidence; check it.`);
  return { lineId, found: true, question, text, quotes: quoted, why: String(d.why ?? ''), model, flags };
}

// ------------------------------------------------------------------ post copy

/** A title and description from the script, held to it: nothing promised it does not say. */
export async function enhanceCopy(productionId) {
  const { postCopy } = await import('./post-copy.js');
  const copy = postCopy(productionId);
  if (!copy) throw Object.assign(new Error('Production not found.'), { code: 'NOT_FOUND' });
  if (!copy.script.trim()) throw Object.assign(new Error('There is no script to write from yet.'), { code: 'NOT_DRAFT' });
  const brief = briefOf(productionId);
  const site = brief.Website ? domainOf(brief.Website) : null;
  const source = `${copy.script}\n${factsOf(brief)}`;
  const model = await writingModel();
  let feedback = ''; let best = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const out = await generateStructured('ollama', {
      model, systemPrompt: SYSTEM, temperature: 0.4, maxTokens: 700,
      prompt: [
        'Write the YouTube title and description for this video, from its script.',
        'Title: at most 65 characters, plain and specific — say what the viewer gets. No clickbait, no emoji, no all caps.',
        `Description: 2 short paragraphs (under 90 words) saying who it is for and what it covers, then the line "Learn more: https://${site ?? 'the website'}".`,
        'Use only what the SCRIPT and FACTS say.',
        `FACTS:\n${factsOf(brief) || '(none)'}`,
        `SCRIPT:\n${copy.script.replace(CONFIRM_RE, ' ')}`,
        feedback ? `YOUR LAST VERSION WAS REJECTED: ${feedback}` : '',
        'Return JSON: {"title":"...","description":"..."}',
      ].filter(Boolean).join('\n\n'),
    });
    const title = tidy(String(out.data?.title ?? '')).replace(/^["']|["']$/g, '');
    let description = String(out.data?.description ?? '').replace(/[ \t]+/g, ' ').trim();
    if (site && !description.toLowerCase().includes(site)) description = `${description}\n\nLearn more: https://${site}`;
    const claims = unsupportedClaims(`${title} ${description}`, source);
    const problems = [];
    if (!title || !description) problems.push('a field was empty.');
    if (title.length > 70) problems.push(`the title is ${title.length} characters; it must be at most 65.`);
    const dw = description.split(/\s+/).length;
    if (dw < 35) problems.push(`the description has ${dw} words; write two paragraphs, 45 to 90 words.`);
    if (claims.length) problems.push(`it promises things the script does not say (${claims.join(', ')}).`);
    const score = problems.length;
    if (title && description && (!best || score < best.score)) best = { title, description, claims, score };
    if (!problems.length) break;
    feedback = problems.join(' ');
  }
  if (!best) throw Object.assign(new Error('The model returned nothing usable. Try again.'), { code: 'BAD_OUTPUT' });
  return {
    title: best.title, description: best.description, model,
    flags: [...introduced(`${best.title} ${best.description}`, source).map((x) => `New ${x} — not in the script; check it.`),
      ...best.claims.map((c) => `Promises "${c}" — the script does not say so.`)],
  };
}

// ------------------------------------------------------------------ visuals

/** What is shown and the on-screen text for each section, from its own lines. A suggestion per row. */
export async function suggestVisuals(productionId) {
  const { visualsFor } = await import('./visuals.js');
  const v = visualsFor(productionId);
  const rows = v.rows.filter((r) => r.lines.length);
  if (!rows.length) throw Object.assign(new Error('There are no script lines to plan visuals from yet.'), { code: 'NOT_DRAFT' });
  const brief = briefOf(productionId);
  const site = brief.Website ? domainOf(brief.Website) : null;
  const label = Object.fromEntries(v.shots.map((s) => [s.id, s.label]));
  const model = await writingModel();
  const out = await generateStructured('ollama', {
    model, systemPrompt: SYSTEM, temperature: 0.4, maxTokens: 1200,
    prompt: [
      'Plan what is on screen for each section of a short video while its lines are spoken.',
      'For each section give: "detail" — one sentence saying exactly what to show (which screen, which part of it, or which image), and',
      '"onscreen" — the on-screen text: at most 6 words, a plain label of the point being made, never a full sentence, never a slogan.',
      'Use only what the lines say. The last section\'s on-screen text should be the website if there is one.',
      'The on-screen text states the POINT of the lines, not the section name. Examples:',
      '  lines "you should have one local person who knows who to call and stays involved until it\'s done" → "One local contact, start to finish"',
      '  lines "students and families work through admissions planning: strategy, essays, interviews" → "Strategy · essays · interviews"',
      'The detail says what to show for this shot type: for "You on camera", where to cut away and to what; for a screen recording, which screen and what to point at.',
      site ? `WEBSITE: ${site}` : '',
      `SECTIONS:\n${rows.map((r) => `#${r.ref} ${r.title} [${label[r.shotType] ?? r.shotType}]\n${r.lines.map((l) => l.text.replace(CONFIRM_RE, ' ')).join(' ')}`).join('\n\n')}`,
      'Return JSON: {"rows":[{"ref":<number>,"detail":"...","onscreen":"..."}]}',
    ].filter(Boolean).join('\n\n'),
  });
  const byRef = new Map((Array.isArray(out.data?.rows) ? out.data.rows : []).map((r) => [Number(r?.ref), r]));
  return {
    model,
    rows: rows.map((r, i) => {
      const s = byRef.get(Number(r.ref)) ?? {};
      let onscreen = tidy(String(s.onscreen ?? '')).replace(/[.!]$/, '');
      // Plain rules over the model: short, and the website at the end.
      if (onscreen.split(/\s+/).length > 8) onscreen = onscreen.split(/\s+/).slice(0, 6).join(' ');
      // Text that only repeats the section's name says nothing the edit does not.
      if (overlap(onscreen, r.title) >= 0.6) onscreen = '';
      if (i === rows.length - 1 && site && !onscreen.toLowerCase().includes(site)) onscreen = site;
      const detail = tidy(String(s.detail ?? ''));
      const source = r.lines.map((l) => l.text).join(' ');
      return { id: r.id, ref: r.ref, title: r.title, detail, onscreen,
        flags: unsupportedClaims(`${detail} ${onscreen}`, `${source} ${factsOf(brief)}`).map((c) => `"${c}" is not in these lines.`) };
    }).filter((r) => r.detail || r.onscreen),
  };
}

// ------------------------------------------------------------------ brief

const BRIEF_ASK = {
  Audience: 'Who is this product or program for? Name the people, in the company\'s own terms.',
  Goal: 'What should a viewer understand or do after this video? One sentence, from what the company offers.',
};

/**
 * Brief fields that are empty or still an instruction ("Confirm intended
 * learner…"): the CTA by plain rule from the website; Audience and Goal only
 * from quotable company material, with the quote.
 */
export async function suggestBrief(productionId) {
  const { corpusFor, relevant } = await import('./evidence.js');
  const brief = briefOf(productionId);
  const needs = (k) => !brief[k] || INSTRUCTION_RE.test(String(brief[k]).trim());
  const out = [];
  const site = brief.Website ? domainOf(brief.Website) : null;
  if (needs('CTA') && site) out.push({ label: 'CTA', value: `Visit ${site}`, why: 'From the website on the brief.' });

  const asks = Object.keys(BRIEF_ASK).filter(needs);
  if (asks.length) {
    const { items, searched } = await corpusFor(productionId);
    const title = getDb().prepare('SELECT title FROM productions WHERE id = ?').get(productionId).title;
    const model = items.length ? await writingModel() : null;
    for (const label of asks) {
      const evidence = relevant(items, `${BRIEF_ASK[label]} ${title}`, title, 5);
      if (!evidence.length) { out.push({ label, value: null, why: `Nothing found in ${searched.join(', ')}.` }); continue; }
      const r = await generateStructured('ollama', {
        model, systemPrompt: SYSTEM, temperature: 0.2, maxTokens: 300,
        prompt: [
          `Fill one field of a video brief: ${label}. ${BRIEF_ASK[label]}`,
          `VIDEO: ${title}`,
          `EVIDENCE (numbered; the only thing you may rely on):\n${evidence.map((e, i) => `${i + 1}. ${e.text}`).join('\n')}`,
          'If the evidence does not say, answer with an empty value. At most 25 words.',
          'Return JSON: {"value":"...","uses":[<numbers>]}',
        ].join('\n\n'),
      });
      const value = tidy(String(r.data?.value ?? ''));
      const uses = (Array.isArray(r.data?.uses) ? r.data.uses : []).map(Number).filter((n) => n >= 1 && n <= evidence.length);
      if (!value || !uses.length) { out.push({ label, value: null, why: 'The company material does not say clearly.' }); continue; }
      out.push({ label, value, quotes: uses.map((n) => evidence[n - 1]), model });
    }
  }
  return { fields: out };
}

// ------------------------------------------------------------------ batch

// One video at a time — the model uses the whole GPU. Kept in memory: a
// restart stops the batch, and each video it finished is already a draft.
const batch = { items: [], running: false, stop: false };
export const enhanceBatch = () => ({
  running: batch.running,
  items: batch.items.map(({ productionId, title, state, error, words, target, version }) => ({ productionId, title, state, error, words, target, version })),
});

/** Drafts whose length is off for their target — what Fit to time is for. */
export function thinDrafts(ids = null) {
  const db = getDb();
  const all = ids ?? db.prepare("SELECT DISTINCT production_id id FROM script_versions WHERE status = 'proposed'").all().map((r) => r.id);
  return all.filter((id) => {
    const r = reviewScript(id);
    return r?.canEnhance && r.targetWords && Math.abs(r.words - r.targetWords) > r.targetWords * 0.1;
  });
}

export function queueEnhance(ids) {
  const db = getDb();
  const queued = new Set(batch.items.filter((i) => i.state === 'queued' || i.state === 'running').map((i) => i.productionId));
  for (const id of thinDrafts(ids)) {
    if (queued.has(id)) continue;
    const title = db.prepare('SELECT title FROM productions WHERE id = ?').get(id)?.title ?? `#${id}`;
    batch.items.push({ productionId: id, title, state: 'queued' });
  }
  if (!batch.running) runBatch().catch(() => { batch.running = false; });
  return enhanceBatch();
}

export function stopEnhanceBatch() {
  batch.stop = true;
  for (const i of batch.items) if (i.state === 'queued') i.state = 'cancelled';
  return enhanceBatch();
}

async function runBatch() {
  batch.running = true; batch.stop = false;
  let model;
  try { model = await writingModel(); } catch (err) {
    for (const i of batch.items) if (i.state === 'queued') Object.assign(i, { state: 'failed', error: err.message });
    batch.running = false; return;
  }
  for (const item of batch.items) {
    if (batch.stop) break;
    if (item.state !== 'queued') continue;
    // A draft someone changed since it was queued may no longer need it.
    if (!thinDrafts([item.productionId]).length) { item.state = 'skipped'; continue; }
    item.state = 'running';
    const job = { state: 'running', mode: 'fit', model, attempt: 0, startedAt: Date.now() };
    jobs.set(item.productionId, job);
    try {
      await runEnhance(job, item.productionId, 'fit');
      Object.assign(item, { state: 'done', words: job.result.words, target: job.result.target, version: job.result.version });
    } catch (err) {
      Object.assign(job, { state: 'failed', error: err.message });
      Object.assign(item, { state: 'failed', error: err.message });
    }
  }
  batch.running = false;
}
