import { Router } from 'express';
import { detectDestinations, checkWritable, serviceFor, folderFor } from '../lib/storage.js';
import { storageRoot } from '../lib/exporter.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

/**
 * Where videos can go, and where they currently do.
 *
 * The detected list is what is actually mounted on THIS machine, not a menu of
 * services we hope you have — an option you cannot pick is worse than no option.
 */
router.get(
  '/storage',
  route(async (_req, res) => {
    const current = storageRoot();
    return ok(res, {
      current: { path: current, ...serviceFor(current) },
      detected: await detectDestinations(),
    });
  })
);

/** Prove a folder works before trusting a finished render to it. */
router.post(
  '/storage/check',
  route(async (req, res) => {
    const path = String(req.body?.path ?? '').trim();
    if (!path.startsWith('/')) {
      return fail(res, 400, 'NOT_ABSOLUTE', 'Use a full path, starting with /.');
    }
    const result = await checkWritable(path);
    return ok(res, result, result.ok
      ? `Writable — ${result.label}${result.account ? ` (${result.account})` : ''}`
      : `Cannot write there: ${result.error}`);
  })
);

/** Where one production's files land, so the shape is visible before it exists. */
router.get(
  '/productions/:id/folder',
  route(async (req, res) => {
    const shape = folderFor(Number(req.params.id));
    if (!shape) return fail(res, 404, 'NOT_FOUND', 'Production not found');
    return ok(res, { ...shape, full: `${storageRoot()}/${shape.relative}` });
  })
);

export default router;
