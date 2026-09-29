import { access, mkdir, readdir, stat, writeFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getDb } from '../db/index.js';

// Where finished videos land.
//
// Dropbox, Google Drive, OneDrive and iCloud need NO integration: with their
// desktop client installed they are folders, and writing a file into one IS
// uploading it. Three OAuth flows would add tokens, refresh cycles and a new
// class of failure in order to reimplement what the sync client already does,
// and would break the moment a token expired while a render was finishing.
//
// So this picks a folder and then says, honestly, where that folder goes — and
// says so loudly when the answer is "nowhere but this machine".

const HOME = homedir();

/** Which service owns a path, worked out from where it is mounted. */
export function serviceFor(path) {
  const p = resolve(path);
  const cloud = join(HOME, 'Library', 'CloudStorage');

  if (p.startsWith(join(cloud, 'Dropbox')) || p.startsWith(join(HOME, 'Dropbox'))) {
    return { id: 'dropbox', label: 'Dropbox', synced: true };
  }
  if (p.startsWith(join(cloud, 'GoogleDrive'))) {
    // The account is in the mount name, which matters when three are mounted.
    const seg = p.slice(cloud.length + 1).split('/')[0];
    const account = seg.includes('-') ? seg.slice(seg.indexOf('-') + 1) : null;
    return { id: 'google_drive', label: 'Google Drive', account, synced: true };
  }
  if (p.startsWith(join(cloud, 'OneDrive'))) {
    return { id: 'onedrive', label: 'OneDrive', synced: true };
  }
  if (p.startsWith(join(cloud, 'Box'))) {
    return { id: 'box', label: 'Box', synced: true };
  }
  if (p.startsWith(join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'))) {
    return { id: 'icloud', label: 'iCloud Drive', synced: true };
  }
  if (p.startsWith('/Volumes/')) {
    return { id: 'external', label: 'External or network volume', synced: false };
  }
  return { id: 'local', label: 'This machine only', synced: false };
}

/** Every sync folder actually mounted here, so the choice is a list not a guess. */
export async function detectDestinations() {
  const out = [];
  const cloud = join(HOME, 'Library', 'CloudStorage');

  const add = async (path) => {
    try {
      const s = await stat(path);
      if (!s.isDirectory()) return;
      out.push({ path, ...serviceFor(path) });
    } catch { /* not mounted */ }
  };

  try {
    for (const entry of await readdir(cloud)) await add(join(cloud, entry));
  } catch { /* no CloudStorage on this machine */ }

  await add(join(HOME, 'Dropbox'));
  await add(join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
  await add(join(HOME, 'Movies'));

  // De-duplicate: Dropbox appears both at ~/Dropbox and under CloudStorage.
  const seen = new Set();
  return out.filter((d) => {
    const key = `${d.id}:${d.account ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Is this somewhere we can actually write?
 *
 * Checked by WRITING, not by reading permission bits: a cloud mount can be
 * listed and still refuse a write when the client is signed out, and a path
 * that fails at the moment a render finishes is the worst time to find out.
 */
export async function checkWritable(path) {
  const p = resolve(path);
  try {
    await mkdir(p, { recursive: true });
    await access(p, constants.W_OK);
    const probe = join(p, `.studio-write-test-${Date.now()}`);
    await writeFile(probe, 'ok');
    await unlink(probe);
    return { ok: true, path: p, ...serviceFor(p) };
  } catch (err) {
    return { ok: false, path: p, error: err.message, ...serviceFor(p) };
  }
}

/**
 * Where one production's files go.
 *
 * Company / Track / Production. At fifty companies a flat folder of video files
 * is unusable, and the layering already exists — it just was not reaching the
 * filesystem, so the structure on disk said nothing about whose work it was.
 */
export function folderFor(productionId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.slug, p.title, c.name AS track, co.name AS company
         FROM productions p
         LEFT JOIN campaigns c ON c.id = p.campaign_id
         LEFT JOIN companies co ON co.id = c.company_id
        WHERE p.id = ?`
    )
    .get(productionId);
  if (!row) return null;

  const safe = (s) => String(s ?? '').replace(/[/\\:*?"<>|]/g, '-').trim().slice(0, 80);
  const parts = [
    safe(row.company) || 'Unassigned',
    safe(row.track) || 'No track',
    safe(row.slug || row.title) || `production-${productionId}`,
  ];
  return { parts, relative: parts.join('/') };
}
