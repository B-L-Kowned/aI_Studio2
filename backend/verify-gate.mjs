// The hard gate: nothing renders unheard.
//
// Self-sufficient by design. This lived in a scratch file pointed at the dev
// server, and every assertion it made depended on how the app had last been
// used by hand: once a line had been approved in the UI, "gate starts closed"
// failed for a reason that was not a regression. It runs against the throwaway
// database that run-verify.mjs creates, in Fixtures mode, and builds everything
// it needs — sync, casting, script — rather than hoping it is already there.

const BASE = process.env.VERIFY_BASE;
if (!BASE) {
  console.error('Run through:  npm run verify');
  process.exit(2);
}

let pass = 0;
let fail = 0;

const call = async (m, p, b) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { 'Content-Type': 'application/json' },
    body: b ? JSON.stringify(b) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const check = (l, c, d = '') => {
  if (c) { pass++; console.log(`  ok   ${l}`); }
  else { fail++; console.log(`  FAIL ${l} ${d}`); }
};
const S = (s) => console.log(`\n=== ${s} ===`);

// ------------------------------------------------------------------ set-up
await call('POST', '/workspace/provider-mode', { mode: 'fixtures' });
await call('POST', '/workspace/license', { key: 'BOTH-A1B2-C3D4' });
await call('POST', '/workspace/storage', { provider: 'local', path: '/tmp/verify' });
await call('POST', '/workspace/complete-onboarding');
// Fixtures sync gives the account a catalogue to cast from.
await call('POST', '/providers/heygen/sync');

const prods = (await call('GET', '/productions')).body.data;
const p = prods.find((x) => x.counts.scenes > 0) ?? prods[0];
const pid = p.id;
console.log(`production: ${p.title} (#${pid})`);

await call('POST', `/productions/${pid}/outline/approve`);
await call('POST', `/productions/${pid}/scenes/approve`);
let r = await call('POST', `/productions/${pid}/segments/build`);
if (r.status === 409) {
  await call('POST', `/productions/${pid}/script/generate`);
  const sc = (await call('GET', `/productions/${pid}/script`)).body.data;
  await call('POST', `/productions/${pid}/script/${sc.latest.id}/accept`);
  r = await call('POST', `/productions/${pid}/segments/build`);
}
check('segments build from the accepted script',
  r.status === 200 && r.body.data.segments.length > 0, `${r.status} ${r.body.message}`);
const segs = r.body.data.segments;
console.log(`       ${segs.length} segments`);

S('The hard gate: nothing renders unheard');
const gate = r.body.data.gate;
check('gate starts closed', gate.ready === false, JSON.stringify(gate).slice(0, 90));
check('gate names what is blocking',
  gate.blocked.length > 0 && !!gate.blocked[0].reason, JSON.stringify(gate.blocked[0]));
console.log(`       first blocker: #${gate.blocked[0]?.position + 1} → ${gate.blocked[0]?.reason}`);

// Pick a segment that is ACTUALLY blocked, so the assertion measures the gate
// rather than whatever state the first segment happens to be in.
const seg = segs.find((x) => x.blockedBy) ?? segs[0];
r = await call('POST', `/productions/${pid}/segments/${seg.id}/render`);
check('a single segment refuses to render', r.status === 409, `${r.status} ${r.body.message}`);
check('and says why in words',
  /unheard|audition|presenter|avatar/i.test(r.body.message ?? ''),
  `blockedBy=${seg.blockedBy}: ${r.body.message}`);

r = await call('POST', `/productions/${pid}/render`, { confirmPaid: true });
check('the WHOLE production render is gated too',
  r.status === 409 && /unheard|not ready/i.test(r.body.message ?? ''),
  `${r.status} ${(r.body.message ?? '').slice(0, 90)}`);

S('Casting is a decision about a speaker');
// Cast a presenter to fixture assets so there is something castable at all.
// `data` is {items, total, ...} since the payload was paginated — it is not
// an array. Reading `.find` off it threw, which ABORTED this suite at check
// 6 of 22 and printed no total, so the run still read as green.
const assets = (await call('GET', '/providers/heygen/assets')).body.data.items ?? [];
check('the asset catalogue came back as a list', Array.isArray(assets) && assets.length > 0,
  `got ${typeof assets} length=${assets?.length}`);
const avatar = assets.find((a) => a.kind === 'avatar');
const voice = assets.find((a) => a.kind === 'voice');
const roster = (await call('GET', '/presenters')).body.data;
const pres = roster.tabs.flatMap((t) => t.presenters)[0];
check('there is a presenter to cast', !!pres && !!avatar && !!voice,
  `presenter=${!!pres} avatar=${!!avatar} voice=${!!voice}`);

r = await call('PATCH', `/presenters/${pres.id}/casting`,
  { avatarAssetId: avatar.id, voiceAssetId: voice.id });
check('presenter casts to a real avatar and voice', r.status === 200, r.body.message);

const cast = (await call('GET', '/presenters/castable')).body.data;
check('and then appears as castable', cast.length > 0, `${cast.length}`);

// Script speakers ("Narrator") rarely match presenter names, so a segment must
// be assignable directly — the name match is a convenience, not the mechanism.
r = await call('PATCH', `/productions/${pid}/segments/${seg.id}`,
  { presenterId: cast[0].id, applyToSpeaker: true });
check('casting one line casts every line by that speaker', r.status === 200, r.body.message);
const sameSpeaker = r.body.data.segments.filter((s) => s.speaker === seg.speaker);
check('every line by that speaker now has the presenter',
  sameSpeaker.every((s) => s.presenter?.id === cast[0].id),
  `${sameSpeaker.filter((s) => s.presenter).length}/${sameSpeaker.length}`);
const speakerRow = r.body.data.speakers.find((s) => s.speaker === seg.speaker);
check('and the casting is no longer reported as mixed', speakerRow?.mixed === false,
  JSON.stringify(speakerRow?.mixed));

const assigned = r.body.data.segments.find((s) => s.id === seg.id);
check('blocker moves on from "presenter"', assigned.blockedBy !== 'presenter', String(assigned.blockedBy));
console.log(`       now blocked by: ${assigned.blockedBy}`);

S('A take cannot be waved through');
r = await call('POST', `/productions/${pid}/segments/${seg.id}/audition`);
check('audition creates a take', r.status === 200, `${r.status} ${r.body.message}`);
const take = r.body.data.take;
console.log(`       synthesised: ${r.body.data.synthesised}`);
const h = await call('POST', `/productions/${pid}/segments/${seg.id}/heard`, { takeId: take.id });
if (r.body.data.synthesised) {
  check('a real audition can be approved', h.status === 200 && h.body.data.take.heard === true);
} else {
  // Fixtures synthesises nothing, so the gate stays shut rather than being
  // waved through on a take nobody could have heard.
  check('a take with no audio CANNOT be marked heard',
    h.status === 409 && h.body.error === 'NO_AUDIO', `${h.status} ${h.body.message}`);
}

S('Editing a line revokes its approval');
r = await call('PATCH', `/productions/${pid}/segments/${seg.id}`, { text: 'Completely different words now.' });
check('edit invalidates the take', r.status === 200, `${r.status} ${r.body.message}`);
const after = r.body.data.segments.find((s) => s.id === seg.id);
check('segment is unheard again', after.heard === false, String(after.heard));
check('and the text no longer matches the take', after.textMatchesTake === false);
check('it needs a new audition, stale take or not', after.needsAudition === true);
check('it is blocked once more', !!after.blockedBy, String(after.blockedBy));

S('Rebuilding does not discard valid approvals');
r = await call('POST', `/productions/${pid}/segments/build`);
check('rebuild is idempotent', r.status === 200 && r.body.data.segments.length === segs.length,
  `${r.body.data.segments.length} vs ${segs.length}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
