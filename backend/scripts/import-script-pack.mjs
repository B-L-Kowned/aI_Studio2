#!/usr/bin/env node
// Load the Video Script Working Pack (Bialkowned_Video_Script_Text.json) into
// the slate, by video_id.
//
//   node scripts/import-script-pack.mjs --json <pack.json> [--api http://localhost:3433/api]
//        [--speaker Pat] [--dry-run]
//
// Every script lands as a PROPOSED version: the pack says "drafted is not
// approved", so each one waits for your accept in Script, where it can still be
// edited. The pack's status, source, review notes and visual plan travel as
// brief fields. IDs the register does not have (GTM masters, the SRC role
// walkthroughs, O22–O28, V01-03, V33-03) become productions of their own,
// marked "Script pack only". Re-running skips scripts already loaded verbatim.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const API = opt('api', 'http://localhost:3433/api');
const JSON_PATH = opt('json');
const SPEAKER = opt('speaker', 'Pat');
const DRY = args.includes('--dry-run');
if (!JSON_PATH) {
  console.error('usage: import-script-pack.mjs --json <pack.json> [--api <base>] [--speaker <name>] [--dry-run]');
  process.exit(2);
}

const pack = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
if (!Array.isArray(pack) || pack.length === 0) throw new Error(`${JSON_PATH} holds no scripts`);
for (const k of ['video_id', 'title', 'spoken_script', 'script_status']) {
  if (!(k in pack[0])) throw new Error(`Pack entries are missing "${k}"`);
}

// Existing role narration that IS a register walkthrough: same brand, same role.
const SAME_AS = {
  'SRC-FIX-ADMIN': 'T01', 'SRC-FIX-CITYMANAGER': 'T02', 'SRC-FIX-ADVISOR': 'T03', 'SRC-FIX-APPRENTICE': 'T04',
  'SRC-FF-ADMIN': 'T09', 'SRC-FF-MENTOR': 'T10', 'SRC-FF-MENTEE': 'T11',
};
// Where a pack-only ID lives: company, track label, purpose, template.
function homeFor(e) {
  const id = e.video_id;
  if (id.startsWith('GTM-')) return { company: 'Bialkowned', track: 'GTM masters', purpose: 'gtm', template: 'company-overview' };
  if (id.startsWith('SRC-NS-')) return { company: 'Northstar Fractional Services', track: 'Training', purpose: 'training', template: 'role-walkthrough' };
  if (id.startsWith('SRC-DL-')) return { company: 'DomusLogic ERP', track: 'Training', purpose: 'training', template: 'role-walkthrough' };
  if (/^O\d+$/.test(id)) return { company: 'Bialkowned', track: 'Outreach', purpose: 'recruiting', template: 'opportunity-outreach' };
  if (/^V\d+-\d+$/.test(id)) return { company: e.brand, track: 'Go to market', purpose: 'gtm', template: 'company-overview' };
  throw new Error(`No home for pack ID ${id}`);
}

/**
 * One line per one-or-two sentences, so a line is short enough to audition,
 * approve and re-take on its own. Sentence ends only — never mid-sentence.
 */
function toLines(text) {
  // A sentence ends at . ! ? followed by a space and a capital or digit — so
  // "$1.5M" and "U.S. market" stay whole.
  const sentences = String(text).replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?][”"’)]?)\s+(?=[A-Z0-9“"‘(])/).map((s) => s.trim()).filter(Boolean);
  const lines = [];
  let cur = '';
  let n = 0;
  for (const s of sentences) {
    if (cur && (n >= 2 || cur.length + s.length > 260)) { lines.push(cur); cur = s; n = 1; }
    else { cur = cur ? `${cur} ${s}` : s; n++; }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => `${SPEAKER}: ${l}`);
}
const mmss = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function call(method, path, body) {
  if (DRY && method !== 'GET') return { data: { id: -1, version: 0 }, message: 'dry' };
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error}: ${json.message}`);
  return json;
}

const health = (await call('GET', '/health')).data;
console.log(`API ${API} · mode ${health.mode}${DRY ? ' · DRY RUN' : ''} · ${pack.length} scripts in pack`);
const productions = (await call('GET', '/productions')).data;
const companies = (await call('GET', '/companies')).data.companies;
const campaigns = (await call('GET', '/campaigns')).data;
const byId = (id) => productions.find((p) => p.title.startsWith(`${id} — `));
const counts = { loaded: 0, same: 0, created: 0, mapped: 0, longest: 0 };
const notes = [];

for (const e of pack) {
  const target = SAME_AS[e.video_id] ?? e.video_id;
  let p = byId(target);
  if (SAME_AS[e.video_id]) counts.mapped++;

  if (!p) {
    const home = homeFor(e);
    const company = companies.find((c) => norm(c.name) === norm(home.company));
    if (!company) throw new Error(`${e.video_id}: no company "${home.company}"`);
    const trackName = `${company.name} — ${home.track}`;
    let track = campaigns.find((c) => c.name === trackName);
    if (!track) {
      const { data } = await call('POST', '/campaigns', { name: trackName, mode: 'content', description: home.track });
      track = { id: data.id, name: trackName };
      campaigns.push(track);
      await call('PATCH', `/campaigns/${track.id}/track`, { companyId: company.id, purpose: home.purpose });
    }
    const title = `${e.video_id} — ${e.title}`;
    const { data } = await call('POST', '/productions', { sourceType: 'template', templateId: home.template, title, campaignId: track.id });
    p = { id: data.id, title };
    productions.push(p);
    counts.created++;
    await call('POST', `/productions/${p.id}/brief`, { label: 'Script pack only', value: 'Not a register row — added from the Video Script Working Pack' });
    // Its runtime is the script's own, since no register range exists for it.
    const secs = Number(e.estimated_voice_seconds_at_150_wpm) || Math.round((Number(e.word_count) || 0) / 2.5);
    if (secs) {
      await call('POST', `/productions/${p.id}/brief`, { label: 'Target runtime', value: mmss(secs) });
      await call('POST', `/productions/${p.id}/outline/rebalance`);
    }
  }

  const lines = toLines(e.spoken_script);
  counts.longest = Math.max(counts.longest, ...lines.map((l) => l.length));
  const text = lines.join('\n');
  const brief = {
    'Script status': e.script_status,
    'Script source': e.source,
    'Script review notes': e.review_notes,
    'Visual plan': e.visual_plan,
    'Script length': `${e.word_count} words · about ${mmss(Number(e.estimated_voice_seconds_at_150_wpm) || 0)} at 150 wpm`,
    ...(SAME_AS[e.video_id] ? { 'Script pack ID': e.video_id } : {}),
  };
  for (const [label, value] of Object.entries(brief)) {
    if (value) await call('POST', `/productions/${p.id}/brief`, { label, value: String(value).slice(0, 500) });
  }

  // Already loaded verbatim (latest version, whatever its status)? Leave it.
  const latest = DRY || p.id === -1 ? null : (await call('GET', `/productions/${p.id}/script`)).data.latest;
  const current = latest?.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
  if (current === text) { counts.same++; continue; }
  if (latest && latest.status === 'accepted') notes.push(`${target}: has an accepted script; the pack text was added as a new proposal beside it`);
  await call('POST', `/productions/${p.id}/script/import`, { text, status: 'proposed' });
  counts.loaded++;
  process.stdout.write('.');
}
process.stdout.write('\n');

console.log(`${counts.loaded} loaded as proposals · ${counts.same} already current · ${counts.created} new productions for pack-only IDs · ${counts.mapped} SRC walkthroughs mapped onto T rows · longest line ${counts.longest} chars`);
for (const n of notes) console.log(`  note: ${n}`);
if (!DRY) {
  // Read back: every pack ID must now have a production with a script.
  const after = (await call('GET', '/productions')).data;
  const missing = [];
  for (const e of pack) {
    const p = after.find((x) => x.title.startsWith(`${SAME_AS[e.video_id] ?? e.video_id} — `));
    const v = p && (await call('GET', `/productions/${p.id}/script`)).data.versions.length;
    if (!v) missing.push(e.video_id);
  }
  console.log(`on server: ${pack.length - missing.length} of ${pack.length} pack scripts present`);
  if (missing.length) { console.error('MISSING:', missing.join(', ')); process.exit(1); }
}
