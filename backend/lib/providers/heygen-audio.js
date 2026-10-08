import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import * as mcp from './heygen-mcp.js';

// Your voice is made on this Mac, so HeyGen never has it: the approved audio is
// uploaded as assets and the avatar lip-syncs to them. Shapes are from the live
// tool schemas — create_asset_upload_batch returns a batch_id and one slot per
// file (asset_id + presigned upload_url + required headers); get_asset_batch
// reports items as queued | processing | completed | failed, the asset id in
// `video_id`. Field names are read tolerantly and a miss is reported with the
// keys that did arrive, never guessed past.

const pick = (o, ...keys) => keys.map((k) => k.split('.').reduce((v, p) => v?.[p], o)).find((v) => v != null);
const keysOf = (o) => Object.keys(o ?? {}).join(', ') || 'none';
const fail = (message) => Object.assign(new Error(message), { code: 'AUDIO_UPLOAD_FAILED' });

/**
 * Upload wav files to HeyGen and wait until each is usable. Returns asset ids
 * in the order given. `simulate` (Fixtures) returns stand-in ids and sends nothing.
 */
export async function uploadAudio(files, { title, simulate = false, timeoutMs = 180_000 } = {}) {
  if (simulate) return files.map((_, i) => `fx_audio_${Date.now().toString(36)}_${i}`);

  const batch = await mcp.callTool('create_asset_upload_batch', {
    title,
    files: files.map((f) => ({ filename: basename(f), content_type: 'audio/wav', size_bytes: statSync(f).size })),
  });
  const batchId = pick(batch, 'batch_id', 'batchId', 'id', 'data.batch_id');
  const slots = pick(batch, 'files', 'uploads', 'items', 'slots', 'data.files') ?? [];
  if (!batchId || slots.length !== files.length) {
    throw fail(`HeyGen's upload batch came back without ${batchId ? 'a slot per file' : 'a batch id'} (keys: ${keysOf(batch)}).`);
  }

  const ids = [];
  for (const [i, slot] of slots.entries()) {
    const url = pick(slot, 'upload_url', 'uploadUrl', 'url');
    const id = pick(slot, 'asset_id', 'assetId', 'id');
    if (!url || !id) throw fail(`Upload slot ${i + 1} has no ${url ? 'asset id' : 'upload URL'} (keys: ${keysOf(slot)}).`);
    const headers = pick(slot, 'headers', 'required_headers', 'upload_headers') ?? { 'Content-Type': 'audio/wav' };
    const res = await fetch(url, { method: 'PUT', headers, body: readFileSync(files[i]) });
    if (!res.ok) throw fail(`Uploading ${basename(files[i])} to HeyGen failed (${res.status}).`);
    ids.push(id);
  }

  await mcp.callTool('complete_asset_batch', { batchId });

  const until = Date.now() + timeoutMs;
  for (;;) {
    const state = await mcp.callTool('get_asset_batch', { batchId });
    const items = pick(state, 'items', 'data.items') ?? [];
    const failed = items.filter((it) => it.status === 'failed');
    if (failed.length) throw fail(`HeyGen could not ingest ${failed.length} audio file${failed.length === 1 ? '' : 's'}.`);
    if (items.length >= ids.length && items.every((it) => it.status === 'completed')) return ids;
    if (Date.now() > until) throw fail('HeyGen is still processing the uploaded audio — try the render again in a minute.');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
