import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDb, defaultDbPath } from '../db/index.js';

/**
 * HeyGen's preview images are signed links that expire after about a week, so
 * a picture stored as a link goes blank on its own — every avatar in the
 * catalogue showed a 403 a few days after sync. The picture is kept on this Mac
 * the first time it is seen while the link still works, and served from here.
 */
// A voice's preview is a sound clip; an avatar's is a picture.
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));

const dir = () => {
  const d = join(dirname(defaultDbPath()), 'previews');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
};

/** A signed link's own expiry, so a dead one is not fetched. */
export function linkExpired(url) {
  const m = /[?&]Expires=(\d+)/.exec(String(url ?? ''));
  return m ? Number(m[1]) * 1000 < Date.now() + 60_000 : false;
}

/** What the page loads for an asset's picture: always this app, never the expiring link. */
export const previewSrc = (row) => (row?.preview_url || cachedFile(row?.id) ? `/api/provider-assets/${row.id}/preview` : null);

export function cachedFile(id) {
  if (!id) return null;
  for (const ext of Object.values(EXT)) {
    const f = join(dir(), `${id}.${ext}`);
    if (existsSync(f)) return { file: f, type: TYPE[ext] };
  }
  return null;
}

const sourceOf = (id) => { try { return JSON.parse(readFileSync(join(dir(), `${id}.json`), 'utf8')).url; } catch { return null; } };

/** Keep one asset's picture. Returns the cached file, or null when the link is dead. */
export async function cachePreview(row) {
  const have = cachedFile(row.id);
  if (have && sourceOf(row.id) === row.preview_url) return have;
  if (!row.preview_url || linkExpired(row.preview_url)) return have;
  try {
    const res = await fetch(row.preview_url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return have;
    const type = String(res.headers.get('content-type') ?? '').split(';')[0].trim();
    const ext = EXT[type] ?? 'jpg';
    const file = join(dir(), `${row.id}.${ext}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    writeFileSync(join(dir(), `${row.id}.json`), JSON.stringify({ url: row.preview_url, at: new Date().toISOString() }));
    return { file, type: TYPE[ext] };
  } catch { return have; }
}

let running = false;
/**
 * Keep the pictures of everything that is yours — owned avatars and the looks
 * cast on presenters — in the background. Stock looks are fetched when shown.
 */
export async function cacheOwnedPreviews() {
  if (running) return { skipped: true };
  running = true;
  let kept = 0;
  try {
    const rows = getDb().prepare(
      `SELECT * FROM provider_assets WHERE preview_url IS NOT NULL AND (owned = 1
         OR id IN (SELECT avatar_asset_id FROM presenters WHERE avatar_asset_id IS NOT NULL)
         OR id IN (SELECT avatar_asset_id FROM appearance_proofs WHERE avatar_asset_id IS NOT NULL))`
    ).all();
    const queue = [...rows];
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) { if (await cachePreview(queue.shift())) kept++; }
    }));
    return { kept, of: rows.length };
  } finally { running = false; }
}
