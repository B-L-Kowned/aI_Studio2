import { Router } from 'express';
import { getDb } from '../db/index.js';
import { can } from '../lib/capabilities.js';
import { createSeries, proposeEpisodes } from '../lib/series.js';
import { templatesFor } from '../lib/capabilities.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

/** `plan.series` is sold; the server decides whether it was bought. */
function requireSeries(req, res, next) {
  const w = getDb().prepare('SELECT entitlement FROM workspace WHERE id = 1').get();
  if (!can(w?.entitlement, 'plan.series')) {
    return fail(res, 402, 'NOT_LICENSED', 'Series planning is not part of your licence.');
  }
  return next();
}
router.use(requireSeries);

router.get(
  '/',
  route(async (_req, res) => {
    const db = getDb();
    const w = db.prepare('SELECT entitlement FROM workspace WHERE id = 1').get();
    const rows = db.prepare('SELECT * FROM campaigns ORDER BY position, id').all();

    return ok(res, {
      templates: templatesFor(w.entitlement),
      numbering: ['episode', 'part', 'lesson', 'day'],
      // Existing campaigns, so a new run can extend a series instead of
      // starting a second one with almost the same name.
      series: rows.map((c) => ({
        id: c.id, name: c.name, mode: c.mode,
        episodes: db
          .prepare('SELECT COUNT(*) n FROM productions WHERE campaign_id = ?')
          .get(c.id).n,
      })),
    });
  })
);

/** A preview, which writes nothing. Deciding is a separate act from proposing. */
router.post(
  '/preview',
  route(async (req, res) => {
    const count = Number(req.body?.count);
    if (!Number.isInteger(count) || count < 1) {
      return fail(res, 400, 'BAD_COUNT', 'How many episodes? Give a whole number, 1 or more.');
    }
    const episodes = proposeEpisodes({
      premise: req.body?.premise, count, numbering: req.body?.numbering,
    });
    return ok(res, { episodes },
      `${episodes.length} placeholder title${episodes.length === 1 ? '' : 's'} — rename them before you build.`);
  })
);

router.post(
  '/',
  route(async (req, res) => {
    try {
      const result = createSeries(req.body ?? {});
      const n = result.episodes.length;
      return ok(res, result,
        `Created ${n} episode${n === 1 ? '' : 's'} in "${result.campaign.name}"`
        + (result.placeholders ? ` — ${result.placeholders} still carry generated titles` : ''));
    } catch (err) {
      const status = { NOT_LICENSED: 403, NO_TEMPLATE: 404, NO_CAMPAIGN: 404 }[err.code] ?? 400;
      return fail(res, status, err.code ?? 'SERIES_FAILED', err.message);
    }
  })
);

export default router;
