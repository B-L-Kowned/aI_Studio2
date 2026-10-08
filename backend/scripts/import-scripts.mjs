#!/usr/bin/env node
// Load scripts written elsewhere (ChatGPT) into their productions.
//
//   node scripts/import-scripts.mjs --dir "<folder>/scripts" [--api http://localhost:3433/api]
//        [--speaker Pat] [--dry-run]
//
// Each <Video ID>.txt (or <slug>.txt) goes to that production. A file is refused,
// not half-loaded, when a line does not start with "<speaker>: " or when a
// Scripts land as PROPOSALS (pass --accept to load them approved). A [CONFIRM: …]
// marker is allowed in a proposal — it is shown for you to resolve — and refused
// with --accept, because accepted text goes on to be read aloud verbatim.
// Re-running skips files whose text already matches the latest version.
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const API = opt('api', 'http://localhost:3433/api');
const DIR = opt('dir');
const SPEAKER = opt('speaker', 'Pat');
const DRY = args.includes('--dry-run');
const ACCEPT = args.includes('--accept');
if (!DIR) {
  console.error('usage: import-scripts.mjs --dir <folder> [--api <base>] [--speaker <name>] [--dry-run]');
  process.exit(2);
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.error}: ${json.message}`);
  return json;
}

const seconds = (rt) => {
  const [m, s] = String(rt).split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};
const WORDS_PER_MINUTE = 150;
const prefix = `${SPEAKER}:`;

const files = readdirSync(DIR).filter((f) => f.endsWith('.txt') && f !== 'README.txt').sort();
// Control assertion: a folder with nothing in it must not report "all loaded".
if (files.length === 0) {
  console.error(`No <slug>.txt files in ${DIR} — nothing to import.`);
  process.exit(1);
}

const productions = (await call('GET', '/productions')).data;
const bySlug = new Map(productions.map((p) => [p.slug, p]));
// Register videos are saved by their Video ID: V14-02.txt.
const byId = new Map(productions.flatMap((p) => {
  const m = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — /.exec(p.title);
  return m ? [[m[1].toUpperCase(), p]] : [];
}));
const result = { imported: [], unchanged: [], refused: [], unmatched: [] };

for (const file of files) {
  const slug = basename(file, '.txt');
  const p = byId.get(slug.toUpperCase()) ?? bySlug.get(slug);
  if (!p) { result.unmatched.push(file); continue; }

  // ChatGPT sometimes wraps its answer in a code fence; that is not script.
  const lines = readFileSync(join(DIR, file), 'utf8')
    .split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^```/.test(l));
  const problems = [];
  const stray = lines.filter((l) => !l.startsWith(prefix));
  if (stray.length) problems.push(`${stray.length} line(s) not starting "${prefix}" — first: "${stray[0].slice(0, 60)}"`);
  const confirms = lines.filter((l) => /\[CONFIRM/i.test(l)).length;
  if (ACCEPT && confirms) problems.push('still contains [CONFIRM: …] — resolve it first');
  if (lines.length === 0) problems.push('empty');
  if (problems.length) { result.refused.push(`${file}: ${problems.join('; ')}`); continue; }

  const text = lines.join('\n');
  const words = lines.join(' ').replace(new RegExp(`${prefix}\\s*`, 'g'), '').split(/\s+/).filter(Boolean).length;
  const target = Math.round((seconds(p.targetRuntime) / 60) * WORDS_PER_MINUTE);
  const drift = target ? Math.round(((words - target) / target) * 100) : 0;
  const note = `${confirms ? `${confirms} line(s) to confirm · ` : ''}${lines.length} lines · ${words} words vs ~${target}${Math.abs(drift) > 20 ? ` (${drift > 0 ? '+' : ''}${drift}% — check length)` : ''}`;

  const latest = (await call('GET', `/productions/${p.id}/script`)).data.latest;
  const current = latest?.segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
  if (current === text) { result.unchanged.push(`${file}: ${note}`); continue; }

  if (!DRY) await call('POST', `/productions/${p.id}/script/import`, { text, status: ACCEPT ? 'accepted' : 'proposed' });
  result.imported.push(`${file}: ${note}`);
}

const show = (label, list) => {
  if (!list.length) return;
  console.log(`\n${label} (${list.length})`);
  for (const l of list) console.log(`  ${l}`);
};
show(DRY ? 'would import' : 'imported', result.imported);
show('already current', result.unchanged);
show('REFUSED — fix and re-run', result.refused);
show('no production with that Video ID or slug', result.unmatched);
console.log(`\n${files.length} files read · ${result.imported.length} ${DRY ? 'to import' : 'imported'} · ${result.refused.length + result.unmatched.length} need attention`);
if (result.refused.length || result.unmatched.length) process.exit(1);
