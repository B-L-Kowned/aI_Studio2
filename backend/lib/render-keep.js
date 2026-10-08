import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../db/index.js';
import { storageRoot, download } from './exporter.js';
import { folderFor } from './storage.js';

// HeyGen hands back a link to the finished video, not the video. It was only
// fetched at export or kit time, so a render left alone could outlive its
// link. Each one is now saved into the video's folder as soon as it finishes.
const saving = new Set();

export function keepRenderLocally(renderId) {
  if (saving.has(renderId)) return;
  const db = getDb();
  const r = db.prepare('SELECT * FROM render_versions WHERE id = ?').get(renderId);
  if (!r || !/^https?:\/\//.test(r.video_url ?? '') || (r.local_path && existsSync(r.local_path))) return;
  saving.add(renderId);
  (async () => {
    try {
      const p = db.prepare('SELECT title FROM productions WHERE id = ?').get(r.production_id);
      const stem = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — /.exec(p?.title ?? '')?.[1] ?? `production-${r.production_id}`;
      const shape = folderFor(r.production_id);
      const dir = join(storageRoot(), ...(shape ? shape.parts : [`production-${r.production_id}`]));
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${stem} HeyGen render v${r.version}.mp4`);
      await download(r.video_url, file);
      db.prepare('UPDATE render_versions SET local_path = ? WHERE id = ?').run(file, r.id);
    } catch (err) {
      db.prepare('UPDATE render_versions SET error = ? WHERE id = ?').run(`Saving the render locally failed: ${err.message}`, renderId);
    } finally {
      saving.delete(renderId);
    }
  })();
}
