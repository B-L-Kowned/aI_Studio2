import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { getDb } from '../db/index.js';
import { localFile } from '../lib/local-voice.js';
import { wordsFor } from '../lib/line-words.js';
import {
  startFix, fixJob, variantFile, applyFix, revertFix, discardFix, othersSaying, remakeOthers,
} from '../lib/line-fix.js';
import { segmentsFor } from '../lib/segments.js';
import { ok, fail, route } from '../utils/respond.js';

/** Hear a line word by word, click the one that is wrong, fix just that part. */
const router = Router();
const STATUS = {
  NOT_FOUND: 404, NO_TAKE: 409, NOT_LOCAL: 409, BUSY: 409, STALE: 409, UNCHANGED: 409,
  BAD_FIX: 400, BAD_TERM: 400, EMPTY: 400, UNCONFIRMED: 409, TOO_LONG: 400,
  VOICE_OFFLINE: 503, VOICE_FAILED: 502,
};
const bad = (res, e) => fail(res, STATUS[e.code] ?? 500, e.code ?? 'ERROR', e.message);
const segmentOf = (segmentId) => getDb().prepare('SELECT production_id FROM segments WHERE id = ?').get(Number(segmentId));
const lineView = (segmentId) => {
  const s = segmentOf(segmentId);
  return s ? segmentsFor(s.production_id).find((x) => x.id === Number(segmentId)) ?? null : null;
};

/** Each word of a take with when it is said. */
router.get('/takes/:id/words', route(async (req, res) => {
  const take = getDb().prepare('SELECT * FROM takes WHERE id = ?').get(Number(req.params.id));
  const file = take?.local_path ? localFile(take.local_path) : null;
  if (!file) return fail(res, 404, 'NOT_FOUND', 'No audio for this take');
  return ok(res, await wordsFor(file, take.text));
}));

/** The same for a line heard from a draft script (the Hear cache). */
router.get('/listen-cache/:key/words', route(async (req, res) => {
  const key = String(req.params.key);
  const line = getDb().prepare('SELECT text FROM script_segments WHERE id = ?').get(Number(req.query.line));
  const file = /^[0-9a-f]{16}$/.test(key) ? localFile(`samples/listen/cache/${key}.wav`) : null;
  if (!file || !line) return fail(res, 404, 'NOT_FOUND', 'Not generated yet');
  return ok(res, await wordsFor(file, line.text));
}));

router.get('/line-fix/:segmentId', route(async (req, res) => ok(res, fixJob(req.params.segmentId) ?? null)));

router.post('/line-fix/:segmentId', route(async (req, res) => {
  try {
    const job = await startFix(req.params.segmentId, req.body ?? {});
    return ok(res, job, job.scope === 'sentence'
      ? 'Making new readings of that sentence — about 10 seconds each'
      : 'Making new readings of the line — about 30 seconds each');
  } catch (e) { return bad(res, e); }
}));

router.get('/line-fix/:segmentId/audio/:n', route(async (req, res) => {
  const file = variantFile(req.params.segmentId, req.params.n, req.query.j);
  if (!file) return fail(res, 404, 'NOT_FOUND', 'That reading is not available');
  res.type('audio/wav');
  return createReadStream(file).pipe(res);
}));

router.post('/line-fix/:segmentId/apply', route(async (req, res) => {
  try {
    const r = applyFix(req.params.segmentId, req.body?.n);
    return ok(res, { ...r, line: lineView(req.params.segmentId) }, `Fixed — ${r.note.charAt(0).toLowerCase()}${r.note.slice(1)}`);
  } catch (e) { return bad(res, e); }
}));

router.post('/line-fix/:segmentId/revert', route(async (req, res) => {
  try {
    revertFix(req.params.segmentId);
    return ok(res, { line: lineView(req.params.segmentId) }, 'Back to the reading before the fix');
  } catch (e) { return bad(res, e); }
}));

router.delete('/line-fix/:segmentId', route(async (req, res) => {
  discardFix(req.params.segmentId);
  return ok(res, null, 'Kept the original');
}));

/** Other lines whose voice still says a term the old way. */
router.get('/pronunciation-uses', route(async (req, res) => {
  const term = String(req.query.term ?? '').trim();
  if (!term) return fail(res, 400, 'EMPTY', 'A term is required');
  return ok(res, othersSaying(term, Number(req.query.except)));
}));

router.post('/pronunciation-uses/remake', route(async (req, res) => {
  const term = String(req.body?.term ?? '').trim();
  if (!term) return fail(res, 400, 'EMPTY', 'A term is required');
  const r = remakeOthers(term, Number(req.body?.except));
  return ok(res, r, r.lines
    ? `Remaking ${r.lines} line${r.lines === 1 ? '' : 's'} in ${r.videos} video${r.videos === 1 ? '' : 's'} — they will be in Voices to approve`
    : 'No other lines say it');
}));

export default router;
