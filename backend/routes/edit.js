import { Router } from 'express';
import { existsSync, statSync } from 'node:fs';
import { getDb } from '../db/index.js';
import { linesWithTakes } from '../lib/line-takes.js';
import { editSettings, saveEditSettings, analyzeTakes, analysisJob, toggleCut } from '../lib/cleanup.js';
import { assemble, assembleJob, previewFile } from '../lib/assemble.js';
import { madeBy } from '../lib/made-by.js';
import { recordFinal } from '../lib/media.js';
import { ok, fail, route } from '../utils/respond.js';

/**
 * Finishing a video you recorded (or narrated over screen recordings) in the
 * app: listen to the takes and propose cuts, choose how it looks and sounds,
 * preview, export. HeyGen videos are finished from their render.
 */
const router = Router();
const status = { NOT_FOUND: 404, BAD_SETTING: 400, NO_TAKES: 409, MISSING_TAKES: 409, NOT_APPROVED: 409, HEYGEN: 409 };
const exists = (id) => getDb().prepare('SELECT 1 FROM productions WHERE id = ?').get(id);
const failWith = (res, err) => fail(res, status[err.code] ?? 500, err.code ?? 'ERROR', err.message);

function editState(id) {
  const file = previewFile(id);
  return {
    madeBy: madeBy(id),
    settings: editSettings(id),
    lines: linesWithTakes(id).lines,
    analysis: analysisJob(id),
    job: assembleJob(id),
    preview: existsSync(file) ? { url: `/api/productions/${id}/edit/preview.mp4?t=${statSync(file).mtimeMs}` } : null,
  };
}

router.get('/:id/edit', route(async (req, res) => {
  const id = Number(req.params.id);
  return exists(id) ? ok(res, editState(id)) : fail(res, 404, 'NOT_FOUND', 'Production not found');
}));

router.put('/:id/edit/settings', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!exists(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  try { saveEditSettings(id, req.body ?? {}); return ok(res, editState(id), 'Saved'); } catch (err) { return failWith(res, err); }
}));

router.post('/:id/edit/analyze', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!exists(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  analyzeTakes(id, Array.isArray(req.body?.takeIds) ? req.body.takeIds.map(Number) : null);
  return ok(res, editState(id), 'Listening to your takes');
}));

router.patch('/:id/line-takes/:takeId/cuts/:index', route(async (req, res) => {
  try {
    toggleCut(Number(req.params.id), Number(req.params.takeId), Number(req.params.index), req.body?.on);
    return ok(res, editState(Number(req.params.id)));
  } catch (err) { return failWith(res, err); }
}));

for (const kind of ['preview', 'export']) {
  router.post(`/:id/edit/${kind}`, route(async (req, res) => {
    const id = Number(req.params.id);
    if (!exists(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
    try { assemble(id, { preview: kind === 'preview' }); return ok(res, editState(id), kind === 'preview' ? 'Building a preview' : 'Exporting'); }
    catch (err) { return failWith(res, err); }
  }));
}

/** The avatar video made from your recording, kept as the finished video. */
router.post('/:id/edit/use-render', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!exists(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  const { kitFor, renderFile } = await import('./editor-kit.js');
  const kit = kitFor(id);
  if (!kit.render) return fail(res, 409, 'NO_RENDER', 'The avatar video has not finished rendering yet.');
  try {
    const file = await renderFile(kit);
    const r = await recordFinal(id, file, `${kit.stem} avatar v${kit.render.version}`, { note: 'rendered from your recording' });
    return ok(res, { ...editState(id), finished: r }, `Saved "${r.name}" as the finished video`);
  } catch (err) { return failWith(res, err); }
}));

router.get('/:id/edit/preview.mp4', route(async (req, res) => {
  const file = previewFile(Number(req.params.id));
  return existsSync(file) ? res.sendFile(file) : fail(res, 404, 'NOT_FOUND', 'No preview yet');
}));

export default router;
