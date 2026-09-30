import { Router } from 'express';
import { survey, importRoster, autoCastByName, castFromBackings } from '../lib/roster-import.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

/** What is there to import. Reads only; imports nothing. */
router.get(
  '/roster/survey',
  route(async (req, res) => ok(res, survey(req.query.root || undefined)))
);

router.post(
  '/roster/import',
  route(async (req, res) => {
    try {
      const { counts, notes } = importRoster(req.body?.root || undefined, {
        characters: req.body?.characters !== false,
        personas: req.body?.personas !== false,
      });
      const added = counts.charactersAdded + counts.personasAdded;
      const updated = counts.charactersUpdated + counts.personasUpdated;
      return ok(res, { counts, notes },
        `${added} added, ${updated} updated`
        + (counts.artwork ? `, ${counts.artwork} with artwork` : '')
        + (notes.length ? ` — ${notes[0]}` : ''));
    } catch (err) {
      return fail(res, err.code === 'NOT_FOUND' ? 404 : 500, err.code ?? 'IMPORT_FAILED', err.message);
    }
  })
);

/** Cast everyone whose name already matches an avatar or voice you own. */
router.post(
  '/roster/autocast',
  route(async (_req, res) => {
    const matched = autoCastByName();
    return ok(res, { matched },
      matched.length
        ? `Cast ${matched.length} by name: ${matched.slice(0, 4).map((m) => m.name).join(', ')}`
          + (matched.length > 4 ? '…' : '')
        : 'Nothing matched by name — cast them by hand, or sync HeyGen first.');
  })
);

/**
 * Cast the comedy roster from the previous build's own avatar allocation.
 * Defaults to a DRY RUN: it reports what it would do and writes nothing, so
 * the first thing you see is the list, not 158 changed rows.
 */
router.post(
  '/roster/cast-from-backings',
  route(async (req, res) => {
    try {
      const apply = req.body?.apply === true;
      const r = castFromBackings(undefined, { apply });
      return ok(res, r, apply
        ? `Cast ${r.castable} characters`
        : `${r.castable} characters can be cast — nothing written yet`);
    } catch (err) {
      return fail(res, err.code === 'NOT_FOUND' ? 404 : 400, err.code ?? 'ERROR', err.message);
    }
  })
);

export default router;
