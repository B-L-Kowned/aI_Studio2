import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  listProviders, syncProvider, localAssets, getProvider, pollJob, serializeJob,
} from '../lib/providers/index.js';
import { ok, fail, route } from '../utils/respond.js';
import { createReadStream } from 'node:fs';
import { cachedFile, cachePreview, linkExpired } from '../lib/preview-cache.js';

const router = Router();

router.get('/providers', route(async (_req, res) => ok(res, listProviders())));

router.get(
  '/providers/:id',
  route(async (req, res) => {
    const found = listProviders().find((p) => p.id === req.params.id);
    return found ? ok(res, found) : fail(res, 404, 'NOT_FOUND', 'Unknown provider');
  })
);

// Connecting and disconnecting live at /connections/:id (routes/connections.js).
// A second connect here stored keys as verified without checking the verdict.

// PULL on demand.
router.post(
  '/providers/:id/sync',
  route(async (req, res) => {
    if (!getProvider(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'Unknown provider');
    try {
      const sync = await syncProvider(req.params.id);
      return ok(res, { providers: listProviders(), sync },
        `Pulled ${Object.entries(sync.pulled).map(([k, n]) => `${n} ${k}s`).join(', ')}`);
    } catch (err) {
      return fail(res, 502, err.code ?? 'SYNC_FAILED', err.message);
    }
  })
);

/** An asset's picture, from this Mac — fetched and kept the first time while its link works. */
router.get('/provider-assets/:id/preview', route(async (req, res) => {
  const row = getDb().prepare('SELECT * FROM provider_assets WHERE id = ?').get(Number(req.params.id));
  if (!row) return fail(res, 404, 'NOT_FOUND', 'No such asset');
  const hit = cachedFile(row.id) ?? await cachePreview(row);
  if (!hit) return fail(res, 404, 'NO_PREVIEW', 'The preview link has expired — sync HeyGen to refresh it');
  res.type(hit.type ?? 'image/jpeg');
  res.set('Cache-Control', 'private, max-age=86400');
  return createReadStream(hit.file).pipe(res);
}));

router.get(
  '/providers/:id/assets',
  route(async (req, res) => {
    if (!getProvider(req.params.id)) return fail(res, 404, 'NOT_FOUND', 'Unknown provider');

    // Searched, not shipped. The whole catalogue is ten thousand rows; a picker
    // wants the handful that match what you typed.
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const all = localAssets(req.params.id, req.query.kind);
    const owned = all.filter((a) => a.owned);
    // Yours first — but an account with nothing of its own gets the catalogue
    // rather than an empty picker. "Show only yours" is useless advice when you
    // have none yet, which is exactly the state a new install is in.
    // `pool`: mine = only your own, all = the whole catalogue; unset keeps the
    // picker's rule (yours first, the catalogue when you have none).
    // stock = HeyGen's own presenters only: your looks are yours, under You.
    // HeyGen's catalogue mixes video avatars (stock presenters, stable pictures)
    // with talking photos (still images, signed links that expire, names like
    // "111"). A presenter is a video avatar.
    const talkingPhoto = new Set(getDb().prepare(
      "SELECT id FROM provider_assets WHERE provider = ? AND kind = 'avatar' AND preview_url LIKE '%/talking_photo/%'"
    ).all(req.params.id).map((r) => r.id));
    const stock = all.filter((a) => !a.owned && !talkingPhoto.has(a.id));
    // Looks whose picture can no longer be shown: an expired link, never saved here.
    const noPicture = new Set(getDb().prepare(
      "SELECT id, preview_url FROM provider_assets WHERE provider = ? AND kind = 'avatar' AND preview_url LIKE '%Expires=%'"
    ).all(req.params.id).filter((r) => linkExpired(r.preview_url) && !cachedFile(r.id)).map((r) => r.id));
    const pool = req.query.pool === 'mine' ? owned : req.query.pool === 'all' ? all : req.query.pool === 'stock' ? stock : null;
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const gender = ['male', 'female'].includes(req.query.gender) ? req.query.gender : null;
    // HeyGen's catalogue says both "male" and "Man".
    const genderOf = (a) => ({ male: 'male', man: 'male', female: 'female', woman: 'female' })[String(a.gender ?? '').toLowerCase()] ?? null;
    // One stock presenter wears many looks ("Dante Office 2", "Dante Living
    // Room 3"): the person is the first word of the look's name, quotes and
    // stray spaces aside.
    // A name that is a description ("A man is sitting…", "111") is its own
    // card under its full name, sorted after the named presenters.
    const NOT_NAMES = new Set(['A', 'An', 'The', 'Man', 'Woman', 'Young', 'Old', 'Business', 'Professional']);
    const personOf = (a) => {
      const clean = a.name.trim().replace(/^["'“”]+|["'“”]+$/g, '');
      const first = clean.split(/\s+/)[0] ?? '';
      if (/^\p{Lu}[\p{Ll}'’-]+$/u.test(first) && !NOT_NAMES.has(first)) return first;
      return clean.replace(/\s*\d+$/, '') || clean;
    };
    const named = (k) => /^\p{Lu}[\p{Ll}'’-]+$/u.test(k);
    const person = String(req.query.person ?? '').trim();
    let matched = q
      ? (pool ?? all).filter((a) => a.name.toLowerCase().includes(q))
      : (pool ?? (owned.length ? owned : all));
    if (gender) matched = matched.filter((a) => genderOf(a) === gender);
    if (person) matched = matched.filter((a) => personOf(a) === person && !noPicture.has(a.id));

    // Grouped: one card per person, their first look as the picture.
    if (req.query.group === 'person' && !person) {
      const byPerson = new Map();
      for (const a of matched) {
        const k = personOf(a);
        const g = byPerson.get(k);
        if (g) {
          g.looks += 1;
          // The card's picture: the first look that can still be shown.
          if (noPicture.has(g.cover.id) && !noPicture.has(a.id)) g.cover = a;
        } else byPerson.set(k, { person: k, looks: 1, cover: a, gender: genderOf(a) });
      }
      // A presenter none of whose looks can be shown waits for the next sync,
      // which refreshes the links, rather than sitting in the grid as a blank tile.
      const people = [...byPerson.values()].filter((g) => !noPicture.has(g.cover.id)).sort((x, y) => (named(y.person) - named(x.person)) || x.person.localeCompare(y.person, undefined, { sensitivity: 'base' }));
      return ok(res, {
        people: people.slice(offset, offset + limit),
        offset,
        matched: people.length,
        looks: matched.length,
        total: stock.length,
        owned: owned.length,
      });
    }

    return ok(res, {
      items: matched.slice(offset, offset + limit),
      offset,
      matched: matched.length,
      total: all.length,
      // Said plainly, so a short list never reads as the whole answer.
      truncated: matched.length > limit,
      owned: owned.length,
      // Whether this list is your roster or the whole catalogue.
      scope: q ? 'search' : (owned.length ? 'owned' : 'all'),
    });
  })
);

// Jobs pushed to a provider, and the poll that pulls their state back.
router.get(
  '/provider-jobs',
  route(async (_req, res) =>
    ok(res, getDb().prepare('SELECT * FROM provider_jobs ORDER BY id DESC LIMIT 50').all().map(serializeJob))
  )
);

router.get(
  '/provider-jobs/:jobId',
  route(async (req, res) => {
    const job = await pollJob(Number(req.params.jobId));
    return job ? ok(res, job) : fail(res, 404, 'NOT_FOUND', 'Job not found');
  })
);

export default router;
