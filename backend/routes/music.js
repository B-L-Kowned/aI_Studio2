import { Router } from 'express';
import { listTracks, receiveTrack } from '../lib/music.js';
import { ok, fail, route } from '../utils/respond.js';

/** The shared Music folder: what is in it, and adding to it. */
const router = Router();
const status = { BAD_TYPE: 415, TOO_LARGE: 413, EMPTY: 400, UPLOAD_FAILED: 400 };

router.get('/music', route(async (_req, res) => ok(res, await listTracks())));

router.post('/music', route(async (req, res) => {
  let name = '';
  try { name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')); } catch { /* keep the default */ }
  try {
    const saved = await receiveTrack(req, name);
    return ok(res, { saved, tracks: await listTracks() }, `Added "${saved}" to the Music folder`);
  } catch (err) { return fail(res, status[err.code] ?? 500, err.code ?? 'ERROR', err.message); }
}));

export default router;
