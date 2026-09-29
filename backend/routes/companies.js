import { Router } from 'express';
import {
  listCompanies, addCompany, updateCompany, retireCompany, setTrack, PURPOSES,
} from '../lib/companies.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
const bad = (res, err) =>
  fail(res, { NOT_FOUND: 404, DUPLICATE: 409 }[err.code] ?? 400, err.code ?? 'ERROR', err.message);

router.get(
  '/companies',
  route(async (req, res) =>
    ok(res, {
      companies: listCompanies({ includeRetired: req.query.includeRetired === 'true' }),
      purposes: PURPOSES,
    })
  )
);

router.post(
  '/companies',
  route(async (req, res) => {
    try {
      const company = addCompany(req.body ?? {});
      return ok(res, company, `Added ${company.name}`);
    } catch (err) { return bad(res, err); }
  })
);

router.patch(
  '/companies/:id',
  route(async (req, res) => {
    try {
      return ok(res, updateCompany(Number(req.params.id), req.body ?? {}), 'Updated');
    } catch (err) { return bad(res, err); }
  })
);

router.post(
  '/companies/:id/retire',
  route(async (req, res) => {
    try {
      const c = retireCompany(Number(req.params.id), req.body?.active === true);
      return ok(res, c, c.isActive ? `${c.name} is active again` : `${c.name} retired — its work is untouched`);
    } catch (err) { return bad(res, err); }
  })
);

/** What a campaign IS: whose it is, what it is for, who it talks to. */
router.patch(
  '/campaigns/:id/track',
  route(async (req, res) => {
    try {
      setTrack(Number(req.params.id), req.body ?? {});
      return ok(res, { companies: listCompanies() }, 'Track updated');
    } catch (err) { return bad(res, err); }
  })
);

export default router;
