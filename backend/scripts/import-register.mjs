#!/usr/bin/env node
// Build the production slate from the video register workbook.
//
//   node scripts/import-register.mjs --xlsx register.xlsx [--csv companies.csv]
//        [--api http://localhost:3433/api] [--remove-superseded] [--dry-run]
//
// One production per register Video ID ("V14-02 — Goalzie: primary workflow
// demo"), under its company's track. Re-running updates in place, keyed on the
// Video ID. The register's statuses, links and owner travel as brief fields so
// the app shows what the register says; the prompt export leaves them out.
//
// --remove-superseded deletes the earlier generic slate (" — Product demo",
// " — Company outreach", "… investor pitch") — only productions with no script.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const API = opt('api', 'http://localhost:3433/api');
const XLSX = opt('xlsx');
const CSV = opt('csv');
const DRY = args.includes('--dry-run');
const REMOVE_SUPERSEDED = args.includes('--remove-superseded');
if (!XLSX) {
  console.error('usage: import-register.mjs --xlsx <file> [--csv <companies.csv>] [--api <base>] [--remove-superseded] [--dry-run]');
  process.exit(2);
}

// --- Minimal xlsx reader: cells are placed by their reference, because an
// empty cell is simply absent and counting siblings shifts every column after it.
const unzip = (part) => {
  try { return execFileSync('unzip', ['-p', XLSX, part], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); }
  catch { return ''; }
};
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
const shared = [...unzip('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function readSheets() {
  const wb = unzip('xl/workbook.xml');
  const rels = unzip('xl/_rels/workbook.xml.rels');
  const target = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    /Id="([^"]+)"/.exec(m[0])[1], /Target="([^"]+)"/.exec(m[0])[1],
  ]));
  const out = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/name="([^"]+)"/.exec(m[0])[1]);
    const rid = /r:id="([^"]+)"/.exec(m[0])[1];
    const xml = unzip(`xl/${target[rid].replace(/^\/?xl\//, '')}`);
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        if (!ref) continue;
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const body = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        cells[colIndex(ref)] = type === 's' ? shared[Number(v)] ?? ''
          : type === 'inlineStr' ? texts(body) : v != null ? decode(v) : '';
      }
      rows.push(Array.from(cells, (x) => (x ?? '').trim()));
    }
    const [head = [], ...body] = rows;
    out[name] = body.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
  }
  return out;
}

const sheets = readSheets();
const register = sheets['Video Register'] ?? [];
const audit = sheets['Company Audit'] ?? [];
// Control assertion: a workbook that parsed to nothing must not "succeed".
if (register.length === 0) throw new Error(`No rows in the "Video Register" sheet of ${XLSX}`);
for (const col of ['Video ID', 'Workstream', 'Brand / track', 'Proposed title']) {
  if (!(col in register[0])) throw new Error(`Video Register is missing the "${col}" column`);
}

const csvRows = CSV ? parseCsv(readFileSync(CSV, 'utf8')) : [];
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(Boolean)) rows.push(row); row = []; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...b] = rows;
  return b.map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] ?? '').trim()])));
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9]/g, '');
const ALIAS = {
  getliberated: 'Liberated',
  fixologycityoperations: 'Fixology',
  bialkownedecosystem: 'Bialkowned',
};
const VERTICALS = new Set(['charity', 'commercial', 'community', 'innovations', 'international', 'investments', 'moretime']);
// Brands the register names that the company list did not include.
const NEW_COMPANIES = {
  domuslogicerp: { name: 'DomusLogic ERP', domain: 'erp.domuslogic.com', group: 'Commercial' },
  bialkownederp: { name: 'Bialkowned ERP', domain: 'erp.bialkowned.com', group: 'Commercial' },
  luxeinternation: { name: 'LuxeInternation', domain: 'intl.bialkowned.com', group: 'International' },
  artificialcontent: { name: 'Artificial Content', domain: null, group: 'Editions' },
  aistudio: { name: 'AI Studio', domain: null, group: 'Editions' },
};

function templateFor(id) {
  if (/^V\d+-01$/.test(id) || /^L\d+$/.test(id) || /^A0[13]$/.test(id)) return 'company-overview';
  if (/^V\d+-02$/.test(id) || /^A0[24]$/.test(id)) return 'workflow-demo';
  if (/^O\d+$/.test(id)) return 'opportunity-outreach';
  if (/^T\d+$/.test(id)) return 'role-walkthrough';
  if (/^I\d+$/.test(id)) return 'investor-briefing';
  return null;
}
const TRACK = {
  'company-overview': ['Go to market', 'gtm'], 'workflow-demo': ['Go to market', 'gtm'],
  'opportunity-outreach': ['Outreach', 'recruiting'], 'role-walkthrough': ['Training', 'training'],
  'investor-briefing': ['Investor briefings', 'investor'],
};
// The middle of the register's range, in the template's own shape.
const RUNTIME = { '35–60 sec': '0:50', '45–60 sec': '0:55', '90–180 sec': '2:15', '2–4 min': '3:00', '60–120 sec': '1:30' };

async function call(method, path, body) {
  if (DRY && method !== 'GET') return { data: { id: -1 }, message: 'dry' };
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error}: ${json.message}`);
  return json;
}

const health = (await call('GET', '/health')).data;
console.log(`API ${API} · mode ${health.mode}${DRY ? ' · DRY RUN' : ''} · ${register.length} register rows`);

const companies = (await call('GET', '/companies?includeRetired=true')).data.companies;
const campaigns = (await call('GET', '/campaigns')).data;
const productions = (await call('GET', '/productions')).data;
const counts = { companies: 0, campaigns: 0, created: 0, updated: 0, unchanged: 0, removed: 0 };

async function companyFor(brand) {
  let key = norm(brand);
  if (ALIAS[key]) key = norm(ALIAS[key]);
  if (VERTICALS.has(key)) key = 'bialkowned';
  let hit = companies.find((c) => norm(c.name) === key);
  if (hit) return hit;
  const spec = NEW_COMPANIES[key];
  if (!spec) throw new Error(`No company for register brand "${brand}" — add it to the company list or the alias table`);
  const { data } = await call('POST', '/companies', spec);
  counts.companies++;
  hit = { ...spec, id: data.id, tracks: [] };
  companies.push(hit);
  return hit;
}

const audienceSet = new Set();
async function trackFor(company, template, audience) {
  const [label, purpose] = TRACK[template];
  const name = `${company.name} — ${label}`;
  let hit = campaigns.find((c) => c.name === name)
    // The earlier import spelled some company names differently in track names.
    ?? campaigns.find((c) => c.companyId === company.id && c.name.endsWith(`— ${label}`));
  if (!hit) {
    const { data } = await call('POST', '/campaigns', { name, mode: 'content', description: label });
    hit = { id: data.id, name, companyId: company.id };
    campaigns.push(hit);
    counts.campaigns++;
  }
  // The register's audience replaces whatever the track held before (the first
  // import copied ERP fields, some of which were revenue projections). The first
  // row of a track this run sets it; later rows keep their own in the brief.
  const first = !audienceSet.has(hit.id);
  audienceSet.add(hit.id);
  await call('PATCH', `/campaigns/${hit.id}/track`, {
    companyId: company.id, purpose, ...(first && audience ? { audience } : {}),
  });
  return hit.id;
}

const auditFor = (brand) => audit.find((a) => norm(a.Company) === norm(ALIAS[norm(brand)] ?? brand));
const csvFor = (company) => csvRows.find((r) => norm(r.name) === norm(company.name) || (company.domain && norm(r.domain) === norm(company.domain)));

const seen = [];
for (const row of register) {
  const id = row['Video ID'];
  const template = templateFor(id);
  if (!template) { console.warn(`  skipped ${id} — no template for this ID shape`); continue; }
  const company = await companyFor(row['Brand / track']);
  const campaignId = await trackFor(company, template, row.Audience);
  const title = `${id} — ${row['Proposed title']}`;

  let p = productions.find((x) => x.title.startsWith(`${id} — `));
  if (!p) {
    const { data } = await call('POST', '/productions', { sourceType: 'template', templateId: template, title, campaignId });
    p = { id: data.id, title, campaignId };
    productions.push(p);
    counts.created++;
  } else if (p.title !== title || p.campaignId !== campaignId) {
    await call('PATCH', `/productions/${p.id}`, { title, campaignId });
    counts.updated++;
  }
  seen.push(id);

  const a = auditFor(row['Brand / track']);
  const c = csvFor(company);
  const dep = row['Dependencies / verification'] ?? '';
  const issue = a?.['Source issue / prerequisite'] ?? '';
  const verify = [dep, issue && !dep.includes(issue) ? issue : ''].filter(Boolean).join(' · ');
  const brief = {
    'Register ID': id,
    Audience: row.Audience,
    Goal: row['Purpose / must show'],
    CTA: row['Proposed CTA'],
    Format: row['Production format'],
    'Target runtime': RUNTIME[row['Target duration']] ?? '',
    'Register duration': row['Target duration'],
    Priority: row.Priority,
    Company: company.name,
    Website: company.domain ? `https://${company.domain.toLowerCase()}` : '',
    Tagline: c?.tagline ?? '',
    'Source summary': c?.one_liner ?? '',
    'Proposed demonstration': /-02$|^A0[24]$|^T/.test(id) ? a?.['Proposed demonstration'] ?? '' : '',
    'Verify first': verify,
    'Status: overall': row['Overall status'],
    'Status: script': row['Script status'],
    'Status: MP3': row['MP3 status'],
    'Status: appearance': row['Appearance status'],
    'Status: final video': row['Final video status'],
    'Status: published': row['Published status'],
    'Existing asset': row['Existing video / app ID'],
    'Script link': row['Script link'],
    'Audio link': row['Audio / proof link'],
    'Final link': row['Final / published link'],
    'Owner / next action': row['Owner / next action'],
  };
  let changed = false;
  for (const [label, value] of Object.entries(brief)) {
    if (!value) continue;
    const r = await call('POST', `/productions/${p.id}/brief`, { label, value: String(value).slice(0, 500) });
    if (r.message !== 'Brief unchanged') changed = true;
  }
  // The register's runtime can differ from the template's; spread the outline to fit.
  await call('POST', `/productions/${p.id}/outline/rebalance`);
  if (!changed) counts.unchanged++;
  process.stdout.write('.');
}
process.stdout.write('\n');

// --- The generic slate this register replaces --------------------------------
if (REMOVE_SUPERSEDED) {
  const superseded = productions.filter((p) => / — (product demo|company outreach)$|investor pitch$/i.test(p.title));
  for (const p of superseded) {
    const script = (await call('GET', `/productions/${p.id}/script`)).data;
    if (script.versions.length) { console.log(`  kept ${p.title} — it has a script`); continue; }
    await call('DELETE', `/productions/${p.id}`);
    counts.removed++;
  }
  const empty = (await call('GET', '/campaigns')).data.filter((c) => c.productions === 0 && /— Investor outreach$/.test(c.name));
  for (const c of empty) if (!DRY) await call('DELETE', `/campaigns/${c.id}`);
}

// --- Read back from the server, never from our own list ---------------------
if (DRY) {
  console.log(`dry run: ${seen.length} register videos planned — nothing written or read back`);
  process.exit(0);
}
const after = (await call('GET', '/productions')).data;
const missing = seen.filter((id) => !after.some((p) => p.title.startsWith(`${id} — `)));
console.log(`companies +${counts.companies} · tracks +${counts.campaigns} · productions +${counts.created}, ${counts.updated} moved/renamed, ${counts.unchanged} unchanged · ${counts.removed} superseded removed`);
console.log(`register on server: ${seen.length - missing.length} of ${seen.length} videos present`);
if (missing.length) { console.error('MISSING:', missing.join(', ')); process.exit(1); }
