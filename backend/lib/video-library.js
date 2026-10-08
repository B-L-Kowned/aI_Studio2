import { getDb } from '../db/index.js';
import * as mcp from './providers/heygen-mcp.js';

// Your finished videos, in the Library where finished videos live.
//
// They used to be reachable only from Settings → HeyGen account, one "Import to
// Library" click at a time — and the import stored the NAME and threw the URL
// away, so the row knew nothing about the video it claimed to be. Twenty real
// videos sat in the account while the Library showed rows you could not play.

/** Upsert one provider video. Identity is the remote id, never the title. */
export function rememberVideo(v, provider = 'heygen') {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM assets WHERE provider = ? AND remote_id = ?')
    .get(provider, v.remoteId);

  if (existing) {
    db.prepare(
      `UPDATE assets SET name = ?, url = COALESCE(?, url), thumbnail_url = COALESCE(?, thumbnail_url),
         duration = COALESCE(?, duration), status = ? WHERE id = ?`
    ).run(v.name, v.url ?? null, v.thumbnailUrl ?? null, v.duration ?? null, v.status ?? null, existing.id);
    return { id: existing.id, added: false };
  }

  const position = db.prepare('SELECT COUNT(*) n FROM assets').get().n;
  const id = db
    .prepare(
      `INSERT INTO assets (name, kind, position, provider, remote_id, url, thumbnail_url, duration, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`
    )
    .run(v.name, 'heygen_video', position, provider, v.remoteId,
         v.url ?? null, v.thumbnailUrl ?? null, v.duration ?? null, v.status ?? null)
    .lastInsertRowid;
  return { id, added: true };
}

/**
 * Pull the account's videos into the Library.
 *
 * Reads only — listing costs nothing. A video still rendering is remembered
 * with its status rather than skipped, so it appears and then completes instead
 * of turning up from nowhere later.
 */
export async function syncVideos({ limit = 100 } = {}) {
  if (!mcp.isConnected()) {
    throw Object.assign(new Error('HeyGen is not connected.'), { code: 'NOT_CONNECTED' });
  }

  const rows = await mcp.listVideos(limit);
  let added = 0;
  let updated = 0;

  for (const v of rows) {
    const remoteId = v.video_id ?? v.id;
    if (!remoteId) continue;
    const res = rememberVideo({
      remoteId,
      name: v.title || v.video_title || 'Untitled HeyGen video',
      // The listing carries a thumbnail; the playable URL is signed and expires,
      // so it is fetched when you actually ask to watch it.
      thumbnailUrl: v.thumbnail_url ?? v.thumbnail ?? null,
      duration: v.duration ?? null,
      status: v.status ?? null,
      url: v.video_url ?? null,
    });
    res.added ? added++ : updated++;
  }

  return { added, updated, total: rows.length };
}

/**
 * A playable URL for a library video.
 *
 * Resolved on demand because HeyGen signs them and they expire — a URL stored
 * at sync time works until it quietly does not, which is the worst kind of
 * broken link: one that used to work.
 */
export async function playableUrl(assetId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!row) throw Object.assign(new Error('No such library item.'), { code: 'NOT_FOUND' });
  if (!row.remote_id) {
    throw Object.assign(
      new Error('This library row predates video storage and has nothing behind it. Re-sync your videos.'),
      { code: 'NO_REMOTE' }
    );
  }

  const detail = await mcp.getVideo(row.remote_id);
  const url = detail?.video_url ?? null;
  if (!url) {
    throw Object.assign(
      new Error(`That video is '${detail?.status ?? 'unfinished'}'. It cannot be played yet.`),
      { code: 'NOT_READY' }
    );
  }
  db.prepare('UPDATE assets SET url = ?, status = ? WHERE id = ?')
    .run(url, detail?.status ?? row.status, assetId);
  return { url, status: detail?.status ?? null, name: row.name };
}

/**
 * Attach a library video to a production and pull it down to your storage.
 *
 * Two separate things, done together because doing one without the other is
 * what leaves you with a link that expires or a file nobody can place:
 *
 *   attach    the video is now THIS production's — it appears on the production
 *             rather than only in a list of everything you ever rendered
 *   download  the bytes land under Company / Track / Production, on whichever
 *             drive you chose, so the sync client takes it from there
 *
 * The URL is resolved at download time because HeyGen signs them and they
 * expire; one stored at sync time works until it silently does not.
 */
export async function attachToProduction(assetId, productionId, { download = true } = {}) {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!asset) throw Object.assign(new Error('No such library item.'), { code: 'NOT_FOUND' });
  if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(productionId)) {
    throw Object.assign(new Error('No such production.'), { code: 'NOT_FOUND' });
  }

  db.prepare('UPDATE assets SET production_id = ? WHERE id = ?').run(productionId, assetId);
  if (!download) return { attached: true, downloaded: false, path: null };

  const { url } = await playableUrl(assetId);
  const { folderFor } = await import('./storage.js');
  const { storageRoot } = await import('./exporter.js');
  const { mkdir, stat } = await import('node:fs/promises');
  const { createWriteStream } = await import('node:fs');
  const { pipeline } = await import('node:stream/promises');
  const { Readable } = await import('node:stream');
  const { join } = await import('node:path');

  const shape = folderFor(productionId);
  const dir = join(storageRoot(), ...(shape ? shape.parts : [`production-${productionId}`]));
  await mkdir(dir, { recursive: true });

  const safe = String(asset.name).replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 80) || 'video';
  const dest = join(dir, `${safe}.mp4`);

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw Object.assign(
      new Error(`The provider returned ${res.status} for that video.`),
      { code: 'DOWNLOAD_FAILED' }
    );
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const { size } = await stat(dest);
  if (!size) {
    throw Object.assign(new Error('The download was empty.'), { code: 'EMPTY_DOWNLOAD' });
  }

  db.prepare('UPDATE assets SET local_path = ? WHERE id = ?').run(dest, assetId);
  return { attached: true, downloaded: true, path: dest, bytes: size };
}

/**
 * Bring a video file from this machine into a production: copy it (the
 * original is left where it was) to Company / Track / Production in your
 * storage, measure it, and record it in the Library. If the Library already
 * knows this video (the same name — usually its HeyGen record), that record is
 * reused and linked, rather than a second row appearing for one video.
 */
export async function importLocalVideo({ path, productionId, name }) {
  const { existsSync, statSync } = await import('node:fs');
  const { copyFile, mkdir } = await import('node:fs/promises');
  const { join, basename, extname, resolve } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const db = getDb();

  const src = resolve(String(path ?? ''));
  if (!path || !existsSync(src) || !statSync(src).isFile()) {
    throw Object.assign(new Error('That file does not exist.'), { code: 'NOT_FOUND' });
  }
  if (!['.mp4', '.mov', '.m4v', '.webm'].includes(extname(src).toLowerCase())) {
    throw Object.assign(new Error('Only video files (mp4, mov, m4v, webm) can be imported.'), { code: 'BAD_TYPE' });
  }
  if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(productionId)) {
    throw Object.assign(new Error('No such production.'), { code: 'NOT_FOUND' });
  }
  let probe;
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,width,height', '-of', 'json', src]);
    probe = JSON.parse(stdout);
  } catch {
    throw Object.assign(new Error('That file could not be read as video.'), { code: 'BAD_VIDEO' });
  }
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  if (!video) throw Object.assign(new Error('That file has no video track.'), { code: 'BAD_VIDEO' });
  const duration = Number(probe.format?.duration) || null;

  const title = String(name || basename(src, extname(src))).trim().slice(0, 160);
  const { folderFor } = await import('./storage.js');
  const { storageRoot } = await import('./exporter.js');
  const shape = folderFor(productionId);
  const dir = join(storageRoot(), ...(shape ? shape.parts : [`production-${productionId}`]));
  await mkdir(dir, { recursive: true });
  const safe = title.replace(/[/\\:*?"<>|]/g, '-').slice(0, 80) || 'video';
  const dest = join(dir, `${safe}${extname(src).toLowerCase()}`);
  if (resolve(dest) !== src) await copyFile(src, dest);
  const bytes = statSync(dest).size;
  if (bytes !== statSync(src).size) throw Object.assign(new Error('The copy is incomplete.'), { code: 'COPY_FAILED' });

  const existing = db.prepare("SELECT * FROM assets WHERE name = ? AND kind = 'video' ORDER BY remote_id IS NULL, id LIMIT 1").get(title)
    ?? db.prepare('SELECT * FROM assets WHERE name = ? ORDER BY remote_id IS NULL, id LIMIT 1').get(title);
  let id;
  if (existing) {
    db.prepare(`UPDATE assets SET production_id = ?, local_path = ?, duration = COALESCE(?, duration),
                  status = 'completed', kind = 'video' WHERE id = ?`).run(productionId, dest, duration, existing.id);
    id = existing.id;
  } else {
    id = db.prepare(
      `INSERT INTO assets (name, kind, position, provider, duration, status, created_at, production_id, local_path)
       VALUES (?, 'video', (SELECT COUNT(*) FROM assets), 'local', ?, 'completed', datetime('now'), ?, ?)`
    ).run(title, duration, productionId, dest).lastInsertRowid;
  }
  return { id, name: title, path: dest, bytes, duration, width: video.width, height: video.height, reusedRecord: !!existing };
}
