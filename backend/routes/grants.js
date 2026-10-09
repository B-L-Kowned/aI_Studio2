import { Router } from 'express';
import { getDb } from '../db/index.js';
import { listGrants, createGrant, extendGrant, endGrant, grantById } from '../lib/grants.js';
import { syncConsent, finishInvite } from '../lib/consent.js';
import { isSignedIn, authentechBase } from '../lib/authentech.js';
import { receivedShares } from '../lib/authentech-shares.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
const STATUS = { NOT_FOUND: 404, NOT_YOURS: 403, ENDED: 409 };
const failWith = (res, err) => fail(res, STATUS[err.code] ?? 400, err.code ?? 'BAD_REQUEST', err.message);

/** Everything shared: your twins lent out, and others' lent to you. */
router.get('/grants', route(async (_req, res) => {
  try { await syncConsent(); } catch { /* the consent page is unreachable: list what is known */ }
  const list = listGrants();
  // Twins sent to you through AuthenTech that you have not opened yet: each
  // with where it stands and the link to accept it there.
  let offers = [];
  if (await isSignedIn().catch(() => false)) {
    try {
      const known = new Set(list.in.map((g) => g.authentech?.shareId).filter(Boolean));
      offers = (await receivedShares()).filter((s) => !known.has(s.share_id)).map((s) => ({
        shareId: s.share_id, from: s.from?.name ?? s.from ?? 'Someone', status: s.status,
        scopes: s.scopes ?? [], mode: s.mode ?? 'source', label: s.label ?? null,
        expiresAt: s.expires_at ?? null, acceptedAt: s.accepted_at ?? null,
        acceptUrl: `${authentechBase()}/api/oauth/share/accept?share=${encodeURIComponent(s.share_id)}`,
      }));
    } catch { /* AuthenTech unreachable: show what is here */ }
  }
  return ok(res, { ...list, offers });
}));

/** Lend one of your personas to someone, for a while. */
router.post('/grants', route(async (req, res) => {
  const b = req.body ?? {};
  const p = getDb().prepare('SELECT * FROM presenters WHERE id = ?').get(Number(b.presenterId));
  if (!p || p.kind !== 'personal') return fail(res, 400, 'NOT_YOURS', 'Only your own personas can be shared.');
  if (!String(b.counterpart ?? '').trim()) return fail(res, 400, 'NAME_REQUIRED', 'Who is it for?');
  try {
    const g = createGrant({
      direction: 'out', presenterId: p.id, counterpart: b.counterpart, email: b.email || null,
      scopes: b.scopes, mode: b.mode, days: b.days ?? null, source: 'card',
    });
    return ok(res, g, g.endsAt ? `Shared until ${g.endsAt.slice(0, 10)}` : 'Shared until you end it');
  } catch (err) { return failWith(res, err); }
}));

router.post('/grants/:id/extend', route(async (req, res) => {
  try { return ok(res, extendGrant(Number(req.params.id), req.body?.days ?? null), 'Extended'); }
  catch (err) { return failWith(res, err); }
}));

/** End now: your twin withdrawn, or someone else's — you are finished with it. */
router.post('/grants/:id/end', route(async (req, res) => {
  try {
    const before = grantById(Number(req.params.id));
    const g = endGrant(Number(req.params.id));
    const row = getDb().prepare('SELECT invite_id FROM grants WHERE id = ?').get(g.id);
    // Their page hears it too, so they see it has ended.
    const told = before?.direction === 'in' && row?.invite_id ? await finishInvite(row.invite_id) : false;
    return ok(res, { ...g, told }, g.direction === 'out' ? 'Share ended' : 'Marked finished');
  } catch (err) { return failWith(res, err); }
}));

export default router;
