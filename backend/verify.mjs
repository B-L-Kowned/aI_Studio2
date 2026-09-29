// run-verify.mjs points this at a throwaway database; the default is the dev
// server, where a run reports leftover state rather than regressions.
import { TEMPLATES } from './data/templates.js';

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:3433/api';
let pass = 0, fail = 0;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

function check(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${detail}`); }
}

const section = (s) => console.log(`\n=== ${s} ===`);

// These assertions describe Fixtures behaviour. Pointing the suite at a server
// whose database you actually use CHANGES that setting — a run against the dev
// server left the app in Fixtures, so the next render silently became a
// simulation. run-verify.mjs gives the suite its own database and its own port.
if (!process.env.VERIFY_BASE) {
  console.error(
    'Refusing to run against the development server: this suite writes settings\n'
    + 'and asserts a factory-fresh install. Use:  npm run verify'
  );
  process.exit(2);
}
await call('POST', '/workspace/provider-mode', { mode: 'fixtures' });

// ---------------------------------------------------------------- Gate 1/2
section('Gate 2: first run is un-onboarded');
let w = (await call('GET', '/workspace')).body.data;
check('starts un-onboarded', w.onboarded === false, `got ${w.onboarded}`);
check('no entitlement yet', w.entitlement === 'none', `got ${w.entitlement}`);
check('no capabilities without a license', w.capabilities.length === 0, `got ${w.capabilities.length}`);

section('Provider starts clean on a fresh install');
{
  const pr = (await call('GET', '/providers')).body.data;
  check('heygen registered', pr[0]?.id === 'heygen');
  check('starts disconnected', pr[0]?.status === 'disconnected', pr[0]?.status);
  check('no assets before sync', Object.keys(pr[0]?.assets ?? {}).length === 0, JSON.stringify(pr[0]?.assets));
}

section('Gate 2: onboarding cannot be skipped');
let r = await call('POST', '/workspace/complete-onboarding');
check('blocked without license', r.status === 400 && r.body.error === 'NO_LICENSE', JSON.stringify(r.body));

section('Gate 1: license validation + entitlement');
r = await call('POST', '/workspace/license', { key: 'NOPE' });
check('rejects a bad key', r.status === 400 && r.body.error === 'INVALID_KEY');

r = await call('POST', '/workspace/license', { key: 'COMEDY-A1B2-C3D4' });
check('accepts a comedy key', r.status === 200 && r.body.data.entitlement === 'comedy');
check('comedy gets comedy caps', r.body.data.capabilities.includes('character.create'));
check('comedy does NOT get longform', !r.body.data.capabilities.includes('plan.longform'));
check('comedy templates only', r.body.data.templates.every((t) => t.mode === 'comedy'),
  JSON.stringify(r.body.data.templates.map((t) => t.mode)));
check('comedy cannot switch to content', r.body.data.allowedModes.join() === 'comedy');

r = await call('POST', '/workspace/mode', { mode: 'content' });
check('mode switch refused when unlicensed', r.status === 403 && r.body.error === 'NOT_LICENSED');

section('Gate 1: upgrade entitlement without reinstall');
r = await call('POST', '/workspace/license', { key: 'BOTH-9Z8Y-7X6W' });
check('upgrade to both', r.body.data.entitlement === 'both');
check('both gets comedy AND content caps',
  r.body.data.capabilities.includes('character.create') && r.body.data.capabilities.includes('plan.longform'));
// Against the real catalogue, not a number typed here. `=== 6` broke the whole
// suite the first time a template was added, which teaches you to edit the
// number rather than ask whether the invariant still holds. The invariant is
// "both sees everything", checked against a non-empty list so it cannot pass
// by both sides being zero.
check('the template catalogue is not empty', TEMPLATES.length > 0, `${TEMPLATES.length}`);
check('both sees all templates', r.body.data.templates.length === TEMPLATES.length,
  `got ${r.body.data.templates.length} of ${TEMPLATES.length}`);
check('every template says what it is for',
  TEMPLATES.every((x) => x.purpose && x.mode && x.runtime && x.outline?.length),
  `${TEMPLATES.filter((x) => !(x.purpose && x.mode && x.runtime && x.outline?.length)).length} incomplete`);
check('both may switch modes', r.body.data.allowedModes.length === 3);

section('Gate 2: storage + AI credentials');
r = await call('POST', '/workspace/storage', { provider: 'local' });
check('local storage needs a path', r.status === 400 && r.body.error === 'PATH_REQUIRED');
r = await call('POST', '/workspace/storage', { provider: 'local', path: '/Users/pat/AIVideo' });
check('storage saved', r.body.data.storageProvider === 'local');

// Shape is no longer the judge — the vendor is. In fixtures mode nothing is
// sent, so a key is stored and honestly reported as unchecked.
r = await call('POST', '/workspace/ai/test', { provider: 'openai', key: 'any-shape-at-all-1234567890' });
check('fixtures mode does not judge a key by its shape', r.status === 200, `${r.status} ${r.body.message}`);
check('and says it was not checked', /not checked/i.test(r.body.message ?? ''), r.body.message);
check('verdict is unknown, not a pass or a fail', r.body.data?.verdict === 'unknown', JSON.stringify(r.body.data));
r = await call('POST', '/workspace/ai', { provider: 'openai', key: 'sk-test1234567890abcdefghij' });
check('BYO key accepted', r.status === 200 && r.body.data.llmProvider === 'openai');
const creds = r.body.data.credentials;
check('credential stored masked', creds[0]?.hint?.includes('…'), JSON.stringify(creds));
check('raw key never returned', !JSON.stringify(r.body).includes('1234567890abcdefghij'));

r = await call('POST', '/workspace/connections', { platform: 'YouTube', status: 'connected' });
check('YouTube connected', r.body.data.connections.some((c) => c.platform === 'YouTube' && c.status === 'connected'));

r = await call('POST', '/workspace/complete-onboarding');
check('onboarding completes', r.status === 200 && r.body.data.onboarded === true);

// ------------------------------------------------------------------ Plan
section('Planning + Gate 7 ordering');
let p = (await call('GET', '/productions/current')).body.data;
const pid = p.id;
check('production loads', !!pid);
check('7 outline sections', p.outline.length === 7, `got ${p.outline.length}`);
check('brief has 8 fields', p.brief.length === 8);

r = await call('POST', `/productions/${pid}/script/generate`);
check('script blocked before outline approval', r.status === 409 && r.body.error === 'OUTLINE_NOT_APPROVED');

r = await call('GET', `/productions/${pid}/producer`);
check('producer separates decisions', Array.isArray(r.body.data.decisionsNeeded));
check('producer reports known facts', r.body.data.known.length > 0);

section('Brief is writable (was read-only)');
const targetField = p.brief.find((b) => b.label === 'Audience');
r = await call('PATCH', `/productions/${pid}/brief/${targetField.id}`, { value: 'Ops leaders' });
check('brief field saved', r.status === 200 &&
  r.body.data.brief.find((b) => b.label === 'Audience').value === 'Ops leaders');

section('Outline: rebalance + validation');
r = await call('PATCH', `/productions/${pid}/outline/${p.outline[0].id}`, { runtime: 'banana' });
check('rejects bad runtime', r.status === 400 && r.body.error === 'BAD_RUNTIME');

await call('PATCH', `/productions/${pid}/outline/${p.outline[0].id}`, { runtime: '3:00' });
r = await call('POST', `/productions/${pid}/outline/rebalance`);
const total = r.body.data.outline.reduce((n, s) => {
  const [m, sec] = s.runtime.split(':').map(Number); return n + m * 60 + sec;
}, 0);
check('rebalance hits target exactly', total === 1200, `got ${total}s`);

r = await call('POST', `/productions/${pid}/outline`, { title: 'Sponsor Read', runtime: '0:30' });
check('+ Section works', r.body.data.outline.length === 8);
const added = r.body.data.outline.find((s) => s.title === 'Sponsor Read');
r = await call('DELETE', `/productions/${pid}/outline/${added.id}`);
check('section removable', r.body.data.outline.length === 7);

section('Scenes');
r = await call('POST', `/productions/${pid}/scenes/develop`);
check('develop blocked before approval', r.status === 409 && r.body.error === 'OUTLINE_NOT_APPROVED');
await call('POST', `/productions/${pid}/outline/approve`);
r = await call('POST', `/productions/${pid}/scenes/develop`);
check('scenes developed after approval', r.body.data.scenes.length > 5, `got ${r.body.data.scenes.length}`);
await call('POST', `/productions/${pid}/scenes/approve`);

// ---------------------------------------------------------------- Script
section('Gate 7: script downstream of approved plan');
r = await call('POST', `/productions/${pid}/script/generate`);
check('script generates', r.status === 200 && r.body.data.latest.version === 1);
const segCount = r.body.data.latest.segments.length;
check('script has segments', segCount > 0, `got ${segCount}`);
const v1 = r.body.data.latest.id;

r = await call('POST', `/productions/${pid}/script/generate`);
check('regenerating makes v2, keeps v1', r.body.data.versions.length === 2);

r = await call('POST', `/productions/${pid}/render`);
check('render blocked with no accepted script', r.status === 409 && r.body.error === 'NO_ACCEPTED_SCRIPT');

const v2 = (await call('GET', `/productions/${pid}/script`)).body.data.latest.id;
r = await call('POST', `/productions/${pid}/script/${v2}/accept`);
check('script accepted', r.body.data.latest.status === 'accepted');

// ------------------------------------------------------------ Stale rule
section('Stale propagation (upstream never overwrites downstream)');
const cur = (await call('GET', `/productions/${pid}`)).body.data;
r = await call('PATCH', `/productions/${pid}/outline/${cur.outline[1].id}`, { runtime: '2:00' });
check('plan edit marks script stale', r.body.data.stale.script?.count > 0, JSON.stringify(r.body.data.stale));
check('stale carries a reason', !!r.body.data.stale.script?.reason);
const scriptAfter = (await call('GET', `/productions/${pid}/script`)).body.data;
check('stale script is NOT deleted', scriptAfter.versions.length === 2);
check('accepted status preserved', scriptAfter.latest.status === 'accepted');
check('segments preserved', scriptAfter.latest.segments.length === segCount);

// ---------------------------------------------------------------- Render
section('Gate 8: render, non-destructive edit, export');
r = await call('POST', `/productions/${pid}/render`);
check('render queued', r.status === 200 && r.body.data.latest.status === 'queued');
check('cost estimate present', r.body.data.latest.costEstimate > 0, `got ${r.body.data.latest.costEstimate}`);
check('marked dry run', r.body.data.dryRun === true);
const renderId = r.body.data.latest.id;

r = await call('POST', `/productions/${pid}/render/${renderId}/edit`, { kind: 'Trim / Cut' });
check('edit blocked while incomplete', r.status === 409 && r.body.error === 'RENDER_INCOMPLETE');

console.log('  … waiting for render to complete (2s queue + 6s processing)');
await new Promise((res) => setTimeout(res, 9500));
r = await call('GET', `/productions/${pid}/render`);
check('render completes on its own', r.body.data.latest.status === 'complete', r.body.data.latest.status);
check('progress reached 100', r.body.data.latest.progress === 100);

r = await call('POST', `/productions/${pid}/render/${renderId}/edit`, { kind: 'Nonsense Tool' });
check('rejects unknown edit tool', r.status === 400);
r = await call('POST', `/productions/${pid}/render/${renderId}/edit`, { kind: 'Remove Silence', target: 'scene 5.2' });
check('edit decision recorded', r.body.data.latest.editDecisions.length === 1);
check('render row survives the edit', r.body.data.latest.status === 'complete');
check('edit marks export stale', !!r.body.data.affected.export || r.body.data.exports.some((e) => e.stale));

r = await call('POST', `/productions/${pid}/export`);
check('export created', r.status === 200 && r.body.data.exports.length >= 1,
  `${r.status} ${r.body.message}`);
// An export is a file. This is the assertion that would have caught "ready"
// meaning nothing but a row.
const madeExport = r.body.data?.export;
check('the export is a real file with bytes', (madeExport?.bytes ?? 0) > 0,
  JSON.stringify(madeExport ?? {}).slice(0, 120));
check('Fixtures says its stand-in is a stand-in', madeExport?.simulated === true,
  String(madeExport?.simulated));

// --------------------------------------------------------------- Publish
section('Gate 9: Prepare Only always available');
r = await call('GET', `/productions/${pid}/publications`);
check('seven channels', r.body.data.targets.length === 7, `got ${r.body.data.targets.length}`);
const af = r.body.data.targets.find((t) => t.platform === 'Artificial Funny');
check('artificialfunny.com present', !!af);
check('af is an owned channel', af?.kind === 'owned', af?.kind);
check('af carries its domain', af?.domain === 'artificialfunny.com', af?.domain);
check('af listed first', r.body.data.targets[0].platform === 'Artificial Funny');
check('YouTube shows connected', r.body.data.targets.find((t) => t.platform === 'YouTube').connected === true);
check('TikTok shows disconnected', r.body.data.targets.find((t) => t.platform === 'TikTok').connected === false);

r = await call('POST', `/productions/${pid}/publications/TikTok`, { mode: 'publish' });
check('unconnected publish degrades to prepare', r.body.data.degraded === true, JSON.stringify(r.body));
r = await call('POST', `/productions/${pid}/publications/YouTube`, { mode: 'schedule' });
check('connected schedule succeeds', r.body.data.degraded === false);

// artificialfunny.com is a REAL upload now, so a row in a table saying
// "connected" cannot make it one. Flipping that row used to be enough to get
// status "published" out of this endpoint while nothing had been uploaded
// anywhere — the assertion below used to encode exactly that lie.
r = await call('POST', '/workspace/connections', { platform: 'Artificial Funny', status: 'connected' });
check('owned channel connectable', r.status === 200);

r = await call('POST', `/productions/${pid}/publications/${encodeURIComponent('Artificial Funny')}`, { mode: 'publish' });
check('publishing with no API key does NOT claim success',
  r.body.data?.degraded === true && !r.body.data?.postId,
  JSON.stringify(r.body).slice(0, 120));
check('and says the connection is missing',
  /not connected/i.test(r.body.message ?? ''), r.body.message);

r = await call('GET', `/productions/${pid}/publications`);
const ownedTarget = r.body.data.targets.find((t) => t.platform === 'Artificial Funny');
check('status degrades to prepared, never published',
  ownedTarget.status === 'prepared', ownedTarget.status);
check('and no post url is invented', !ownedTarget.postUrl, String(ownedTarget.postUrl));

r = await call('POST', `/productions/${pid}/publications/YouTube`, { mode: 'prepare' });
check('prepare still works for everything', r.status === 200, r.body.message);

// ------------------------------------------------------- HeyGen provider
section('HeyGen interface: PULL then PUSH');
check('endpoints still flagged unverified', (await call('GET', '/providers')).body.data[0]?.endpointsVerified === false);

r = await call('POST', '/providers/heygen/sync');
check('PULL sync succeeds', r.status === 200, JSON.stringify(r.body).slice(0, 120));
check('pulled avatars', r.body.data.sync.pulled.avatar > 0);
check('pulled voices', r.body.data.sync.pulled.voice > 0);
check('quota recorded', r.body.data.sync.quota.remaining > 0);

// The asset endpoint is a SEARCH now, not a dump: it answers with the rows it
// is returning, how many matched, and whether it cut the list short. Returning
// a bare array meant a caller could not tell a complete answer from a truncated
// one — which is how a 9,967-row catalogue got shipped to a dropdown.
r = await call('GET', '/providers/heygen/assets?kind=avatar');
check('avatars queryable locally', r.body.data.items.length > 0 && r.body.data.items[0].kind === 'avatar',
  JSON.stringify(r.body.data).slice(0, 100));
check('and the search says how much it is holding back',
  typeof r.body.data.total === 'number' && typeof r.body.data.truncated === 'boolean',
  JSON.stringify({ total: r.body.data.total, truncated: r.body.data.truncated }));

r = await call('GET', '/providers/heygen/assets?kind=avatar&q=zzzznothing');
check('a search that matches nothing says so, rather than falling back to everything',
  r.body.data.items.length === 0 && r.body.data.matched === 0,
  JSON.stringify(r.body.data).slice(0, 80));

r = await call('POST', '/providers/heygen/sync');
check('re-sync does not duplicate', r.body.data.providers[0].assets.avatar === 4,
  String(r.body.data.providers[0].assets.avatar));

r = await call('POST', `/productions/${pid}/render`);
check('PUSH created a provider job', !!r.body.data.push?.jobId, JSON.stringify(r.body.data.push));
check('push has a remote id', !!r.body.data.push?.remoteId);
check('push marked dry run', r.body.data.push?.dryRun === true);
check('job attached to render', r.body.data.latest.providerJobs.length === 1);
const heygenJob = r.body.data.push.jobId;

console.log('  … polling the provider job back');
await new Promise((res) => setTimeout(res, 9500));
r = await call('GET', `/provider-jobs/${heygenJob}`);
check('PULL job reaches completed', r.body.data.status === 'completed', r.body.data.status);
check('job returns a video url', !!r.body.data.videoUrl);
check('dry run spent no credits', r.body.data.creditsUsed === 0, String(r.body.data.creditsUsed));

r = await call('GET', '/provider-jobs');
check('job list persisted', r.body.data.length >= 1);

// ------------------------------------------------------------- People
section('Gate 5: collaborator invite + consent + revoke');
r = await call('POST', '/people/invite', { name: 'Dana', role: 'Guest' });
check('invite creates a pending person', r.body.data.person.status === 'pending');
check('invite url issued', !!r.body.data.inviteUrl);
const danaId = r.body.data.person.id;
r = await call('POST', `/people/${danaId}/consent`, { scope: 'series' });
check('consent approves', r.body.data.status === 'approved' && r.body.data.consentScope === 'This series');
r = await call('POST', `/people/${danaId}/revoke`);
check('consent revocable', r.body.data.status === 'pending');

// --------------------------------------------------- multiple productions
section('Multiple productions');
r = await call('GET', '/productions');
const beforeCount = r.body.data.length;
check('list endpoint exists', Array.isArray(r.body.data) && beforeCount >= 1);

const camps = (await call('GET', '/campaigns')).body.data;
const comedyCamp = camps.find((c) => c.mode === 'comedy');

r = await call('POST', '/productions', {
  sourceType: 'template', templateId: 'sketch-3p',
  title: 'Second Production', campaignId: comedyCamp.id,
});
check('creates from a template', r.status === 200, JSON.stringify(r.body).slice(0, 140));
const p2 = r.body.data.id;
check('new production is separate', p2 !== pid);
check('template seeded the outline', r.body.data.outline.length === 4, String(r.body.data.outline.length));
check('template set the runtime', r.body.data.targetRuntime === '4:00', r.body.data.targetRuntime);
check('template seeded the brief', r.body.data.brief.some((b) => b.label === 'Template'));
check('breadcrumb names the campaign', r.body.data.breadcrumb.startsWith(comedyCamp.name));

r = await call('GET', '/productions');
check('list grew by one', r.body.data.length === beforeCount + 1);

r = await call('GET', '/productions/current');
check('new production becomes current', r.body.data.id === p2);

r = await call('POST', `/productions/${pid}/open`);
check('can switch back', r.body.data.id === pid);
r = await call('GET', '/productions/current');
check('switch persisted', r.body.data.id === pid, String(r.body.data.id));

// Editing one must not disturb the other.
const p2Before = (await call('GET', `/productions/${p2}`)).body.data.outline[0].runtime;
await call('PATCH', `/productions/${pid}/outline/${(await call('GET', `/productions/${pid}`)).body.data.outline[0].id}`, { runtime: '1:11' });
r = await call('GET', `/productions/${p2}`);
check('productions are isolated', r.body.data.outline[0].runtime === p2Before, r.body.data.outline[0].runtime);
check('other production not marked stale', Object.keys(r.body.data.stale).length === 0);

r = await call('POST', '/productions', { sourceType: 'idea' });
check('creates from a blank idea', r.status === 200 && r.body.data.outline.length === 3);

r = await call('POST', '/productions', { sourceType: 'nonsense' });
check('rejects unknown sourceType', r.status === 400 && r.body.error === 'BAD_SOURCE');
r = await call('POST', '/productions', { sourceType: 'template', templateId: 'no-such-template' });
check('rejects unknown template', r.status === 404 && r.body.error === 'NO_TEMPLATE');

await call('POST', '/workspace/license', { key: 'CONTENT-E5F6-G7H8' });
r = await call('POST', '/productions', { sourceType: 'template', templateId: 'sketch-3p' });
check('refuses an unlicensed template', r.status === 403 && r.body.error === 'NOT_LICENSED', JSON.stringify(r.body));
await call('POST', '/workspace/license', { key: 'BOTH-9Z8Y-7X6W' });

section('Error shape');
r = await call('GET', '/nope');
check('404 shape', r.status === 404 && r.body.data === null && !!r.body.error);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
