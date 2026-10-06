#!/usr/bin/env node
// Record one HeyGen avatar group's looks, so Appearance can offer them.
//
//   node scripts/import-looks.mjs --json looks.json [--api http://localhost:3433/api]
//
// looks.json is the `items` array from HeyGen's list-avatar-looks for the
// group (id, name, avatar_type, group_id, preview_image_url,
// preferred_orientation). Preview URLs are signed and expire; re-run to refresh.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, f = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? f : args[i + 1]; };
const API = opt('api', 'http://localhost:3433/api');
const file = opt('json');
if (!file) { console.error('usage: import-looks.mjs --json <looks.json> [--api <base>]'); process.exit(2); }

const raw = JSON.parse(readFileSync(file, 'utf8'));
const looks = Array.isArray(raw) ? raw : raw.items;
if (!Array.isArray(looks) || !looks.length) throw new Error(`${file} holds no looks`);
const groups = [...new Set(looks.map((l) => l.group_id))];
if (groups.length !== 1) throw new Error(`Expected one avatar group, found ${groups.length}`);

const res = await fetch(`${API}/looks/import`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ provider: 'heygen', looks }),
});
const body = await res.json();
if (!res.ok) throw new Error(`${res.status} ${body.error}: ${body.message}`);
console.log(`${body.message} · group ${groups[0]} · ${looks.length} in file`);
