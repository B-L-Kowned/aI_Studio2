import { Router } from 'express';
import { existsSync } from 'node:fs';
import { getDb } from '../db/index.js';
import { receiveUpload } from '../lib/media.js';
import { addTake, linesWithTakes, updateTake, discardTake, takeFile, splitRecording, splitJob } from '../lib/line-takes.js';
import { ok, fail, route } from '../utils/respond.js';

/**
 * Recording a video yourself: a take per script line, from the teleprompter or
 * uploaded, and a whole recording made elsewhere split into lines by what you
 * said. Uploads are the raw request body, as for finished videos.
 */
const router = Router();
const status = { BAD_TYPE: 415, TOO_LARGE: 413, EMPTY: 400, UPLOAD_FAILED: 400, NOT_FOUND: 404, BAD_RANGE: 400, BUSY: 409 };
const exists = (id) => getDb().prepare('SELECT 1 FROM productions WHERE id = ?').get(id);
const failWith = (res, err) => fail(res, status[err.code] ?? 500, err.code ?? 'ERROR', err.message);

router.get('/:id/line-takes', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!exists(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  return ok(res, { ...linesWithTakes(id), split: splitJob(id) });
}));

router.post('/:id/line-takes/line/:segmentId', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!exists(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  try {
    const source = req.query.source === 'upload' ? 'upload' : 'teleprompter';
    const take = await addTake(id, Number(req.params.segmentId), await receiveUpload(req), source);
    return ok(res, take, `Take ${take.version} saved`);
  } catch (err) { return failWith(res, err); }
}));

router.patch('/:id/line-takes/:takeId', route(async (req, res) => {
  try { return ok(res, updateTake(Number(req.params.id), Number(req.params.takeId), req.body ?? {}), 'Take updated'); }
  catch (err) { return failWith(res, err); }
}));

router.delete('/:id/line-takes/:takeId', route(async (req, res) => {
  try { discardTake(Number(req.params.id), Number(req.params.takeId)); return ok(res, { id: Number(req.params.takeId) }, 'Take discarded'); }
  catch (err) { return failWith(res, err); }
}));

// sendFile answers Range requests, so the player can seek inside a long recording.
router.get('/:id/line-takes/:takeId/video', route(async (req, res) => {
  const file = takeFile(Number(req.params.id), Number(req.params.takeId));
  if (!file || !existsSync(file)) return fail(res, 404, 'NOT_FOUND', 'Take file not found');
  return res.sendFile(file);
}));

router.post('/:id/line-takes/split', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!exists(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  if (!getDb().prepare('SELECT 1 FROM segments WHERE production_id = ?').get(id)) {
    return fail(res, 409, 'NO_LINES', 'Accept the script first — the recording is split into its lines.');
  }
  try {
    const job = splitRecording(id, await receiveUpload(req), String(req.headers['x-file-name'] ?? ''));
    return ok(res, job, 'Splitting your recording into lines');
  } catch (err) { return failWith(res, err); }
}));

export default router;
