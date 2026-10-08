import { Router } from 'express';
import { reviewScript, applyFixes, startEnhance, enhanceJob, undoEnhance, improveLine, suggestAnswer } from '../lib/enhance.js';
import { getDb } from '../db/index.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
const STATUS = { NO_CHECK: 409, NOT_FOUND: 404, NOT_DRAFT: 409, BAD_MODE: 400, BAD_GOAL: 400, CANNOT_UNDO: 409, LLM_OFFLINE: 503, NO_MODEL: 503, BAD_OUTPUT: 502 };
const failWith = (res, err) => fail(res, STATUS[err.code] ?? 502, err.code ?? 'ENHANCE_FAILED', err.message);

/** The plain checks — instant, no model. */
router.get('/:id/script/checks', route(async (req, res) => {
  const r = reviewScript(Number(req.params.id));
  return r ? ok(res, r) : fail(res, 404, 'NOT_FOUND', 'No script yet');
}));

/** Apply the checks' mechanical fixes to the draft: all of them, or the ids given. */
router.post('/:id/script/checks/fix', route(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = applyFixes(id, Array.isArray(req.body?.ids) ? req.body.ids : null);
    return ok(res, { ...r, checks: reviewScript(id) }, `${r.applied} line${r.applied === 1 ? '' : 's'} fixed`);
  } catch (err) { return failWith(res, err); }
}));

/** Rewrite the draft with the local model: fit | tighten | polish. Runs in the background. */
router.post('/:id/enhance/script', route(async (req, res) => {
  try { return ok(res, await startEnhance(Number(req.params.id), String(req.body?.mode ?? 'fit'), { model: req.body?.model ? String(req.body.model) : null }), 'Enhancing on this Mac'); }
  catch (err) { return failWith(res, err); }
}));
router.get('/:id/enhance/script', route(async (req, res) => ok(res, enhanceJob(Number(req.params.id)))));
router.delete('/:id/enhance/script/:versionId', route(async (req, res) => {
  try { return ok(res, undoEnhance(Number(req.params.id), Number(req.params.versionId)), 'Enhance undone'); }
  catch (err) { return failWith(res, err); }
}));

/** An earlier version's lines, to compare against the current draft. */
router.get('/:id/script/versions/:versionId/lines', route(async (req, res) => {
  const db = getDb();
  const v = db.prepare('SELECT id, version, status FROM script_versions WHERE id = ? AND production_id = ?').get(Number(req.params.versionId), Number(req.params.id));
  if (!v) return fail(res, 404, 'NOT_FOUND', 'Script version not found');
  const lines = db.prepare('SELECT id, speaker, text FROM script_segments WHERE script_version_id = ? ORDER BY position').all(v.id);
  return ok(res, { ...v, lines });
}));

/** One line, reworded: speak | shorter | longer. A suggestion; nothing is saved. */
router.post('/:id/enhance/line/:lineId', route(async (req, res) => {
  try { return ok(res, await improveLine(Number(req.params.id), Number(req.params.lineId), String(req.body?.goal ?? 'speak'))); }
  catch (err) { return failWith(res, err); }
}));

/** Suggest an answer to the line's [CONFIRM] check, from the company's own material. */
router.post('/:id/enhance/answer/:lineId', route(async (req, res) => {
  try { return ok(res, await suggestAnswer(Number(req.params.id), Number(req.params.lineId))); }
  catch (err) { return failWith(res, err); }
}));

export default router;
