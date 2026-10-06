import express, { Router } from 'express';
import { createReadStream } from 'node:fs';
import { getDb } from '../db/index.js';
import {
  listLocalVoices, createLocalVoice, updateLocalVoice, speakLocal, serviceStatus, localFile,
  listPronunciations, setPronunciation, deletePronunciation,
} from '../lib/local-voice.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
const STATUS = {
  NOT_FOUND: 404, EMPTY: 400, TOO_SHORT: 400, BAD_AUDIO: 400, BAD_LENGTH: 400,
  TOO_LONG: 400, BAD_PATH: 400, VOICE_OFFLINE: 503, VOICE_FAILED: 502,
};
const bad = (res, err) => fail(res, STATUS[err.code] ?? 500, err.code ?? 'ERROR', err.message);

router.get(
  '/voices/local',
  route(async (_req, res) => ok(res, { voices: listLocalVoices(), service: await serviceStatus() }))
);

// The recording arrives as the raw request body — a file input posts it
// as-is — so it never has to fit the 1MB JSON limit.
router.post(
  '/voices/local',
  express.raw({ type: ['audio/*', 'video/*', 'application/octet-stream'], limit: '30mb' }),
  route(async (req, res) => {
    try {
      const voice = await createLocalVoice({
        name: req.query.name,
        audio: req.body,
        exaggeration: req.query.exaggeration,
        cfgWeight: req.query.cfgWeight,
      });
      return ok(res, voice, `Created ${voice.name} from ${voice.referenceSeconds}s of audio`);
    } catch (err) { return bad(res, err); }
  })
);

router.patch(
  '/voices/local/:id',
  route(async (req, res) => {
    try {
      return ok(res, updateLocalVoice(Number(req.params.id), req.body ?? {}), 'Voice updated');
    } catch (err) { return bad(res, err); }
  })
);

/** Say a test sentence in this voice. Free; one sample per voice, replaced each time. */
router.post(
  '/voices/local/:id/sample',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const text = String(req.body?.text ?? '').trim()
      || 'This is my own voice, made on this computer. Every line I approve here is the audio the video will use.';
    try {
      const r = await speakLocal(id, text, `samples/voice-${id}.wav`);
      return ok(res, { url: `/api/voices/local/${id}/sample?t=${Date.now()}`, duration: r.duration, secondsTaken: r.secondsTaken },
        `Sample ready — ${r.duration?.toFixed?.(1) ?? '?'}s of audio, made in ${r.secondsTaken ?? '?'}s`);
    } catch (err) { return bad(res, err); }
  })
);

router.get(
  '/voices/local/:id/sample',
  route(async (req, res) => {
    const file = localFile(`samples/voice-${Number(req.params.id)}.wav`);
    if (!file) return fail(res, 404, 'NOT_FOUND', 'No sample yet for this voice');
    res.type('audio/wav');
    return createReadStream(file).pipe(res);
  })
);

/** A take synthesised on this machine. HeyGen takes carry their own remote URL. */
router.get(
  '/takes/:id/audio',
  route(async (req, res) => {
    const take = getDb().prepare('SELECT local_path FROM takes WHERE id = ?').get(Number(req.params.id));
    const file = take?.local_path ? localFile(take.local_path) : null;
    if (!file) return fail(res, 404, 'NOT_FOUND', 'No local audio for this take');
    res.type('audio/wav');
    return createReadStream(file).pipe(res);
  })
);

// ------------------------------------------------------------ pronunciation
router.get('/pronunciations', route(async (_req, res) => ok(res, listPronunciations())));

router.post(
  '/pronunciations',
  route(async (req, res) => {
    try { return ok(res, setPronunciation(req.body ?? {}), 'Pronunciation saved'); }
    catch (err) { return bad(res, err); }
  })
);

router.delete(
  '/pronunciations/:id',
  route(async (req, res) => {
    try { deletePronunciation(Number(req.params.id)); return ok(res, listPronunciations(), 'Removed'); }
    catch (err) { return bad(res, err); }
  })
);

/** Say one term, in a sentence, so it can be checked by ear. Free. */
router.post(
  '/pronunciations/:id/hear',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const row = listPronunciations().find((p) => p.id === id);
    if (!row) return fail(res, 404, 'NOT_FOUND', 'No such pronunciation');
    const voiceId = Number(req.body?.voiceId) || listLocalVoices()[0]?.id;
    if (!voiceId) return fail(res, 409, 'NO_VOICE', 'Create a local voice first');
    try {
      // The term as written: the substitution is what is being tested.
      await speakLocal(voiceId, `This is ${row.term}.`, `samples/pron-${id}.wav`);
      return ok(res, { url: `/api/pronunciations/${id}/audio?t=${Date.now()}` }, `Said "${row.sayAs}"`);
    } catch (err) { return bad(res, err); }
  })
);

router.get(
  '/pronunciations/:id/audio',
  route(async (req, res) => {
    const file = localFile(`samples/pron-${Number(req.params.id)}.wav`);
    if (!file) return fail(res, 404, 'NOT_FOUND', 'Not heard yet');
    res.type('audio/wav');
    return createReadStream(file).pipe(res);
  })
);

export default router;
