import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  presentersFor, presenterById, createPresenter, castPresenter,
  retirePresenter, mayUse, castablePresenters,
} from '../lib/presenters.js';
import { programsForEntitlement, programState } from '../lib/programs.js';
import { localAssets } from '../lib/providers/index.js';
import { listLocalVoices } from '../lib/local-voice.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

function grantedPrograms() {
  const w = getDb().prepare('SELECT entitlement, onboarded_at FROM workspace WHERE id = 1').get();
  return {
    programs: programsForEntitlement(w?.entitlement ?? 'none'),
    state: programState(w?.entitlement ?? 'none', !!w?.onboarded_at),
  };
}

/**
 * The presenter pickers this account gets. Comedy sees Characters, Content sees
 * the stock roster, everyone sees You — which is the actual comedy/content gate.
 */
router.get(
  '/presenters',
  route(async (req, res) => {
    const { programs, state } = grantedPrograms();
    return ok(res, {
      programs: state.programs,
      noun: state.noun,
      tabs: presentersFor(programs, { includeRetired: req.query.includeRetired === 'true' }),
      // What a presenter can be backed by, for the casting pickers.
      // YOURS only, by default.
      //
      // This used to ship the entire synced catalogue — 9,967 avatars and 2,943
      // voices, a 4.9MB response — which the page then rendered into two
      // <select> elements per presenter. With 174 presenters that is roughly
      // 350 dropdowns holding 13,000 options each, and the browser spent its
      // time building option nodes nobody would ever scroll to.
      //
      // The 25 avatars this account owns are what a roster is cast from.
      // Everything else is searched, not shipped.
      options: (() => {
        const pick = (kind) => {
          const all = localAssets('heygen', kind);
          const owned = all.filter((a) => a.owned);
          // An account with nothing of its own still needs a usable picker, so
          // it falls back to the catalogue rather than offering nothing.
          return owned.length ? owned : all.slice(0, 200);
        };
        // Your local voices first: they are yours by definition and cost nothing to audition.
        const local = listLocalVoices().map((v) => ({ ...v, kind: 'voice', owned: true, isFixture: false }));
        return { avatars: pick('avatar'), voices: [...local, ...pick('voice')] };
      })(),
      catalogue: {
        avatars: localAssets('heygen', 'avatar').length,
        voices: localAssets('heygen', 'voice').length,
      },
    });
  })
);

router.post(
  '/presenters',
  route(async (req, res) => {
    const { programs } = grantedPrograms();
    const { kind } = req.body ?? {};
    if (!['character', 'avatar', 'personal'].includes(kind)) {
      return fail(res, 400, 'BAD_KIND', 'kind must be character, avatar or personal');
    }
    // Creating into a program you do not own would put a presenter in the app
    // that you can see and never cast.
    const needed = kind === 'character' ? 'funny' : kind === 'avatar' ? 'content' : null;
    if (needed && !programs.includes(needed)) {
      return fail(res, 403, 'NOT_LICENSED', `${kind}s belong to the ${needed} program, which your licence does not include`);
    }
    try {
      return ok(res, createPresenter(req.body), `${req.body.name} added`);
    } catch (err) {
      return fail(res, 400, err.code ?? 'ERROR', err.message);
    }
  })
);

router.patch(
  '/presenters/:id/casting',
  route(async (req, res) => {
    const { programs } = grantedPrograms();
    const p = presenterById(Number(req.params.id));
    if (!p) return fail(res, 404, 'NOT_FOUND', 'Presenter not found');
    if (!mayUse(programs, p)) return fail(res, 403, 'NOT_LICENSED', 'That presenter is not in your programs');
    try {
      return ok(res, castPresenter(p.id, {
        avatarAssetId: req.body?.avatarAssetId,
        voiceAssetId: req.body?.voiceAssetId,
      }), 'Casting updated');
    } catch (err) {
      return fail(res, 400, err.code ?? 'ERROR', err.message);
    }
  })
);

// Retire rather than delete: productions that already cast them keep resolving.
// Favourite: listed first, and one click to filter to.
router.post('/presenters/:id/favorite', route(async (req, res) => {
  const r = getDb().prepare('UPDATE presenters SET favorite = ? WHERE id = ?').run(req.body?.favorite === false ? 0 : 1, Number(req.params.id));
  return r.changes ? ok(res, { id: Number(req.params.id), favorite: req.body?.favorite !== false }) : fail(res, 404, 'NOT_FOUND', 'No such presenter');
}));

router.post(
  '/presenters/:id/retire',
  route(async (req, res) => {
    try {
      const p = retirePresenter(Number(req.params.id), req.body?.active === true);
      return ok(res, p, p.isActive ? `${p.name} restored` : `${p.name} retired — existing productions still resolve`);
    } catch (err) {
      return fail(res, 404, err.code ?? 'ERROR', err.message);
    }
  })
);

/** Everything castable right now, flattened — used by scene/segment pickers. */
router.get(
  '/presenters/castable',
  route(async (_req, res) => {
    const { programs } = grantedPrograms();
    return ok(res, castablePresenters(programs).filter((p) => p.ready));
  })
);

export default router;
