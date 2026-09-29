import { Router } from 'express';
import { survey, importRoster, autoCastByName } from '../lib/roster-import.js';
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
      return fail(res, 500, err.code ?? 'IMPORT_FAILED', err.message);
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

export default router;
