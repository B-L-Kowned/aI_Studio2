// Series planning and local video analysis.
//
// Both were entitled-but-unimplemented for a long time: `plan.series` was sold
// and did nothing, and "Analyze & build outline" was a button with no handler.
// These assertions exist so neither can quietly return to that state.

import { extractWebsiteEvidence, researchWebsite } from './lib/web-research.js';
import { generateScript } from './lib/script-generator.js';

const BASE = process.env.VERIFY_BASE;
if (!BASE) { console.error('Run through:  npm run verify'); process.exit(2); }

let pass = 0, fail = 0;
const call = async (m, p, b) => {
  const r = await fetch(BASE + p, {
    method: m, headers: { 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const check = (l, c, d = '') => { c ? (pass++, console.log(`  ok   ${l}`)) : (fail++, console.log(`  FAIL ${l} ${d}`)); };
const S = (s) => console.log(`\n=== ${s} ===`);

await call('POST', '/workspace/provider-mode', { mode: 'fixtures' });
let r;

S('Website evidence and approval records are durable');
const html = `<!doctype html><html><head><title>Acme — Better Widgets</title>
  <meta name="description" content="Acme helps teams ship dependable widgets."></head>
  <body><h1>Dependable widgets</h1><p>Built for teams that need a clear, repeatable process from brief to launch.</p></body></html>`;
const extracted = extractWebsiteEvidence(html, new URL('https://acme.example/'));
check('website facts come from the page',
  extracted.title === 'Acme — Better Widgets' && extracted.headings[0] === 'Dependable widgets',
  JSON.stringify(extracted));
const researched = await researchWebsite('acme.example', {
  resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
  fetchImpl: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
});
check('a bare hostname is normalised and produces a brief proposal',
  researched.url === 'https://acme.example/' && researched.suggestedBrief.Brand === 'Acme',
  JSON.stringify(researched.suggestedBrief));
const evidenceScript = generateScript(
  [{ id: 1, title: 'Open', participants: 'Narrator', purpose: 'Introduce the offer' }],
  'Acme launch', {}, { purpose: 'promotion' }, researched.suggestedBrief
);
check('approved website evidence reaches the script and closing CTA',
  evidenceScript.some((line) => line.text.includes('Acme helps teams'))
    && evidenceScript.some((line) => line.text === 'Visit acme.example'),
  JSON.stringify(evidenceScript));

const workflowPid = (await call('GET', '/productions/current')).body.data.id;
r = await call('POST', `/productions/${workflowPid}/research`, { url: 'http://127.0.0.1/private' });
check('private-network research is blocked', r.status === 400 && r.body.error === 'PRIVATE_URL',
  `${r.status} ${r.body.error}`);
let workflow = (await call('GET', `/productions/${workflowPid}/workflow`)).body.data;
const failedResearch = workflow.research.find((item) => item.status === 'failed');
check('a failed attempt is visible instead of disappearing', !!failedResearch);
r = await call('DELETE', `/productions/${workflowPid}/research/${failedResearch.id}`);
check('an unreviewed failed source can be removed', r.status === 200 && r.body.data.research.length === 0,
  `${r.status} ${r.body.message}`);
check('the production lock returns every gate at once',
  Array.isArray(r.body.data.lock.gates) && r.body.data.lock.gates.some((gate) => gate.key === 'appearance'));

const proofable = (await call('GET', '/presenters/castable')).body.data.find((p) => p.kind !== 'avatar');
if (!proofable) {
  console.log('  ..   no castable personal/character performer, skipping proof mutation');
} else {
  r = await call('POST', `/productions/${workflowPid}/appearance`, {
    presenterId: proofable.id,
    label: 'Vertical ad look',
    imageUrl: 'https://example.com/proof.jpg',
    outfit: 'Black crew neck',
    background: 'Warm neutral studio',
    framing: '9:16 waist-up',
  });
  const proof = r.body.data.appearances[0];
  check('appearance saves as a draft', r.status === 200 && proof.status === 'draft', r.body.message);
  r = await call('PATCH', `/productions/${workflowPid}/appearance/${proof.id}`, { status: 'approved' });
  check('a complete appearance proof can be approved',
    r.status === 200 && r.body.data.appearances[0].status === 'approved', r.body.message);
}

S('Series planning is licensed, then real');
// A comedy-only licence does not include plan.series.
await call('POST', '/workspace/license', { key: 'COMEDY-A1B2-C3D4' });
r = await call('POST', '/series', { name: 'Nope', count: 2 });
check('refused without the licence', r.status === 402 && r.body.error === 'NOT_LICENSED',
  `${r.status} ${r.body.error}`);

await call('POST', '/workspace/license', { key: 'BOTH-9Z8Y-7X6W' });
r = await call('POST', '/series/preview', { premise: 'Ops', count: 3, numbering: 'lesson' });
check('preview proposes titles', r.body.data?.episodes?.length === 3, JSON.stringify(r.body).slice(0, 90));
check('and marks them as placeholders', r.body.data.episodes.every((e) => e.placeholder));
check('preview writes nothing',
  !(await call('GET', '/campaigns')).body.data.some((c) => c.name === 'Ops'));

r = await call('POST', '/series', {
  name: 'Verify Season', premise: 'testing',
  episodes: ['First thing', 'Second thing', 'Third thing'],
});
check('series creates every episode', r.status === 200 && r.body.data.episodes.length === 3,
  `${r.status} ${r.body.message}`);
check('titles given by hand are not placeholders', r.body.data.placeholders === 0);
const positions = r.body.data.episodes.map((e) => e.number);
check('episodes are numbered in order', positions.join() === '1,2,3', positions.join());

// The series IS a campaign with ordered productions — one hierarchy, which is
// why Training can read it without knowing series exist.
const courses = (await call('GET', '/training/courses')).body.data;
const course = courses.find((c) => c.title === 'Verify Season');
check('the series appears as an ordered course', !!course && course.ordered === true,
  JSON.stringify(course?.ordered));
check('with its lessons in the order given',
  course.lessons.map((l) => l.title).join() === 'First thing,Second thing,Third thing',
  course.lessons.map((l) => l.title).join());

r = await call('POST', '/series', { name: 'Verify Season', count: 2 });
check('a duplicate series name is refused, not silently merged',
  r.status === 400 && r.body.error === 'DUPLICATE_CAMPAIGN', `${r.status} ${r.body.error}`);

r = await call('POST', '/series', { name: 'Too big', count: 999 });
check('an absurd episode count is refused', r.status === 400, `${r.status} ${r.body.error}`);

S('Video analysis measures a real file');
const pid = (await call('GET', '/productions/current')).body.data.id;

r = await call('POST', `/productions/${pid}/analysis`, { file: 'relative/path.mp4' });
check('a relative path is refused', r.status === 400 && r.body.error === 'NOT_ABSOLUTE', r.body.error);

r = await call('POST', `/productions/${pid}/analysis`, { file: '/definitely/not/here.mp4' });
check('a missing file says so', r.status === 404 && r.body.error === 'NOT_FOUND', r.body.error);

// Make a file to measure, so the suite never depends on one lying around.
const { execFileSync } = await import('node:child_process');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const clip = join(tmpdir(), `verify-clip-${Date.now()}.mp4`);
let haveFfmpeg = true;
try {
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', clip,
  ], { stdio: 'ignore' });
} catch { haveFfmpeg = false; }

if (!haveFfmpeg) {
  console.log('  ..   ffmpeg unavailable, skipping the measurement itself');
} else {
  r = await call('POST', `/productions/${pid}/analysis`, { file: clip });
  check('measurement succeeds', r.status === 200, `${r.status} ${r.body.message}`);
  const a = r.body.data;
  check('reads the real resolution', a.facts.video.width === 320 && a.facts.video.height === 240,
    `${a.facts.video?.width}x${a.facts.video?.height}`);
  check('reads the real duration', Math.round(a.facts.duration) === 3, String(a.facts.duration));
  check('finds the audio stream', a.facts.audio?.codec === 'aac', JSON.stringify(a.facts.audio));
  check('produces findings, not an empty report', a.findings.length > 0);
  // The honest half: no transcript is not the same as an empty one.
  check('says plainly whether a transcript is possible',
    a.transcript === null && /transcriber/i.test(a.transcriptNote), a.transcriptNote);

  r = await call('GET', `/productions/${pid}/analysis`);
  check('the measurement is stored with the production',
    r.body.data.sources.some((s) => s.analysis && s.filePath === clip));

  const before = (await call('GET', `/productions/${pid}`)).body.data.outline.length;
  r = await call('POST', `/productions/${pid}/analysis/adopt-outline`);
  check('the measured structure can become the outline', r.status === 200, r.body.message);
  const after = (await call('GET', `/productions/${pid}`)).body.data;
  check('the outline really changed',
    after.outline.length !== before || String(after.outline[0].purpose ?? '').includes('Measured'),
    `${before} → ${after.outline.length}`);
  check('adopting resets approval, because the plan is new', after.outlineApproved === false,
    String(after.outlineApproved));

  const { unlink } = await import('node:fs/promises');
  await unlink(clip).catch(() => {});
}

S('The roster comes across whole');
// 163 characters and 4 personas existed in the previous build while this one
// shipped three invented placeholders. The survey is read-only, so it is safe
// to assert against even when the old checkout is not present.
r = await call('GET', '/roster/survey');
check('the survey reads without importing', r.status === 200, String(r.status));
const sv = r.body.data;
if (!sv.characters.found && !sv.personas.found) {
  console.log('  ..   previous build not on this machine, skipping the import');
} else {
  check('it finds the character list', sv.characters.available > 100, String(sv.characters.available));
  check('it finds the personas', sv.personas.available >= 4, String(sv.personas.available));

  r = await call('POST', '/roster/import', {});
  check('import succeeds', r.status === 200, r.body.message);
  const first = r.body.data.counts;
  check('characters land', first.charactersAdded > 100, String(first.charactersAdded));
  check('personas land', first.personasAdded >= 4, String(first.personasAdded));

  // Running it twice must not give you two of everything.
  r = await call('POST', '/roster/import', {});
  const second = r.body.data.counts;
  check('a second import updates rather than duplicates',
    second.charactersAdded === 0 && second.personasAdded === 0,
    JSON.stringify(second));

  const roster = (await call('GET', '/presenters')).body.data;
  const you = roster.tabs.find((t) => t.id === 'personal');
  const withPersona = you.presenters.filter((p) => p.persona?.voice);
  check('personas carry the voice that steers the script', withPersona.length >= 4,
    String(withPersona.length));
  check('and the guardrails come with them',
    withPersona.some((p) => p.persona.neverClaim),
    'no neverClaim found');
}

S('The parking lot holds ideas, not productions');
r = await call('POST', '/ideas', { text: 'A short on why ERP rollouts blame users', heat: 'hot' });
check('an idea parks with one sentence', r.status === 200, r.body.message);
const ideaId = r.body.data.idea.id;
check('and it is hot because it was asked to be', r.body.data.idea.heat === 'hot');

// The whole point: parking something must not put work into the schedule.
const before = (await call('GET', '/schedule')).body.data;
check('a parked idea is NOT a production',
  !before.needsYou.some((n) => /ERP rollouts blame users/.test(n.title)),
  'the idea leaked into the schedule');
check('but the schedule knows the lot has something in it',
  before.ideas.total >= 1, JSON.stringify(before.ideas));

r = await call('PATCH', `/ideas/${ideaId}`, { heat: 'low' });
check('heat can cool', r.body.data.idea.heat === 'low', r.body.data.idea.heat);

r = await call('PATCH', `/ideas/${ideaId}`, { archived: true });
check('archiving keeps it', !!r.body.data.idea.archivedAt);
r = await call('GET', '/ideas');
check('and takes it out of the open list', !r.body.data.ideas.some((i) => i.id === ideaId));
r = await call('GET', '/ideas?includeArchived=true');
check('but it is still there when asked for', r.body.data.ideas.some((i) => i.id === ideaId));

await call('PATCH', `/ideas/${ideaId}`, { archived: false });
const somePid = (await call('GET', '/productions/current')).body.data.id;
r = await call('POST', `/ideas/${ideaId}/promoted`, { productionId: somePid });
check('an idea can grow into a production', r.status === 200, r.body.message);
check('and the lot remembers that it did', !!r.body.data.idea.promotedTo);

r = await call('POST', `/ideas/${ideaId}/promoted`, { productionId: somePid });
check('it cannot be promoted twice',
  r.status === 409 && r.body.error === 'ALREADY_PROMOTED', `${r.status} ${r.body.error}`);

r = await call('POST', '/ideas', { text: '   ' });
check('an empty idea is refused', r.status === 400 && r.body.error === 'EMPTY', r.body.error);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
