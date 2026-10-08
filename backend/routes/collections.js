import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { castingFor, setCasting } from '../lib/casting.js';
import { localAssets } from '../lib/providers/index.js';
import { month } from '../lib/calendar.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

const person = (r) => ({
  id: r.id, name: r.name, role: r.role, representation: r.representation,
  consentScope: r.consent_scope, status: r.status, inviteToken: r.invite_token,
  casting: castingFor(r.id),
});

// The avatars and voices available to cast from, pulled from the provider.
router.get(
  '/casting/options',
  route(async (_req, res) =>
    ok(res, {
      avatars: localAssets('heygen', 'avatar'),
      voices: localAssets('heygen', 'voice'),
    })
  )
);

router.patch(
  '/people/:id/casting',
  route(async (req, res) => {
    try {
      const casting = setCasting(Number(req.params.id), {
        avatarAssetId: req.body?.avatarAssetId,
        voiceAssetId: req.body?.voiceAssetId,
      });
      return ok(res, casting, 'Casting updated');
    } catch (err) {
      return fail(res, err.code === 'NOT_FOUND' ? 404 : 400, err.code ?? 'ERROR', err.message);
    }
  })
);

router.get(
  '/people',
  route(async (_req, res) =>
    ok(res, getDb().prepare('SELECT * FROM people ORDER BY position, id').all().map(person))
  )
);

router.post(
  '/people/invite',
  route(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return fail(res, 400, 'NAME_REQUIRED', 'A collaborator needs a name');

    const db = getDb();
    const token = crypto.randomBytes(9).toString('base64url');
    const position = db.prepare('SELECT COUNT(*) n FROM people').get().n;
    const id = db
      .prepare(
        `INSERT INTO people (name, role, representation, consent_scope, status, invite_token, position)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(name, req.body?.role || 'Guest', 'Invitation sent', 'Pending', 'pending', token, position)
      .lastInsertRowid;

    return ok(
      res,
      {
        person: person(db.prepare('SELECT * FROM people WHERE id = ?').get(id)),
        // A collaborator approves appearance and voice without project access.
        inviteUrl: `/invite/${token}`,
      },
      `Invite created for ${name}`
    );
  })
);

// Mock consent flow: consent → appearance/avatar → voice → preview → scope.
router.post(
  '/people/:id/consent',
  route(async (req, res) => {
    const db = getDb();
    const scope = req.body?.scope;
    if (!['production', 'series', 'workspace'].includes(scope)) {
      return fail(res, 400, 'BAD_SCOPE', 'Scope must be production, series or workspace');
    }
    const label = { production: 'This production', series: 'This series', workspace: 'Workspace' }[scope];
    const r = db
      .prepare(
        `UPDATE people SET status = 'approved', representation = 'Avatar + Voice',
         consent_scope = ?, invite_token = NULL WHERE id = ?`
      )
      .run(label, req.params.id);
    if (!r.changes) return fail(res, 404, 'NOT_FOUND', 'Person not found');
    return ok(res, person(db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id)), 'Consent granted');
  })
);

router.post(
  '/people/:id/revoke',
  route(async (req, res) => {
    const db = getDb();
    const r = db
      .prepare(
        `UPDATE people SET status = 'pending', representation = 'Consent revoked',
         consent_scope = 'Pending' WHERE id = ?`
      )
      .run(req.params.id);
    if (!r.changes) return fail(res, 404, 'NOT_FOUND', 'Person not found');
    return ok(res, person(db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id)), 'Consent revoked');
  })
);

router.post(
  '/campaigns',
  route(async (req, res) => {
    const db = getDb();
    const name = String(req.body?.name ?? '').trim();
    if (!name) return fail(res, 400, 'NAME_REQUIRED', 'A campaign needs a name');

    const mode = req.body?.mode ?? 'both';
    if (!['comedy', 'content', 'both'].includes(mode)) {
      return fail(res, 400, 'BAD_MODE', 'Mode must be comedy, content or both');
    }
    if (db.prepare('SELECT 1 FROM campaigns WHERE name = ?').get(name)) {
      return fail(res, 409, 'DUPLICATE', `A campaign called "${name}" already exists`);
    }

    const position = db.prepare('SELECT COUNT(*) n FROM campaigns').get().n;
    const id = db
      .prepare('INSERT INTO campaigns (name, description, mode, position) VALUES (?,?,?,?)')
      .run(name, String(req.body?.description ?? '').slice(0, 200), mode, position).lastInsertRowid;

    return ok(res, { id, name, mode }, `Created campaign "${name}"`);
  })
);

router.delete(
  '/campaigns/:id',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const held = db.prepare('SELECT COUNT(*) n FROM productions WHERE campaign_id = ?').get(id).n;
    // Deleting a campaign must never take its productions with it.
    if (held > 0) {
      return fail(res, 409, 'NOT_EMPTY',
        `"${db.prepare('SELECT name FROM campaigns WHERE id = ?').get(id)?.name}" still holds ${held} production${held === 1 ? '' : 's'}`);
    }
    const r = db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    if (!r.changes) return fail(res, 404, 'NOT_FOUND', 'Campaign not found');
    return ok(res, { id }, 'Campaign deleted');
  })
);

router.get(
  '/campaigns',
  route(async (_req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM campaigns ORDER BY position, id').all();
    return ok(
      res,
      // `SELECT *` reads the track columns and this mapping dropped them, so
      // /companies described campaign 44 as "promotion · People who have never
      // heard of it" while /campaigns said purpose: null. Plan reads THIS one,
      // which is why the company/track layering was invisible on the page that
      // lists campaigns. Third endpoint pair today to disagree about one row.
      rows.map((c) => ({
        id: c.id, name: c.name, description: c.description, mode: c.mode,
        companyId: c.company_id ?? null,
        purpose: c.purpose ?? null,
        audience: c.audience ?? null,
        productions: db.prepare('SELECT COUNT(*) n FROM productions WHERE campaign_id = ?').get(c.id).n,
      }))
    );
  })
);

router.get(
  '/library',
  route(async (_req, res) =>
    ok(
      res,
      // Everything the Library knows about each item. It used to return the
      // name and the kind, which is why a "HeyGen video" in here could not be
      // played, dated or told apart from any other.
      getDb().prepare(`SELECT a.*, p.title AS production_title, p.mode AS production_mode
          FROM assets a LEFT JOIN productions p ON p.id = a.production_id ORDER BY a.position, a.id`).all()
        .map((a) => ({
          // Which program it belongs to, for the Content / Comedy switch: its
          // video's, else anything from HeyGen is your business work, and the
          // rest are the sample podcast items that came with the app.
          program: a.production_mode ?? (a.provider === 'heygen' ? 'content' : 'comedy'),
          productionTitle: a.production_title ?? null,
          id: a.id, name: a.name, kind: a.kind,
          provider: a.provider ?? null, remoteId: a.remote_id ?? null,
          url: a.url ?? null, thumbnailUrl: a.thumbnail_url ?? null,
          duration: a.duration ?? null, status: a.status ?? null,
          createdAt: a.created_at ?? null,
          productionId: a.production_id ?? null,
          localPath: a.local_path ?? null,
          // A row with a remote id can be fetched and played; one without is a
          // leftover from when importing stored only a name.
          playable: !!a.remote_id || !!a.local_path,
          fileUrl: a.local_path ? `/api/library/${a.id}/file` : null,
        }))
    )
  )
);

/** A video file from this machine, copied into a production's folder. */
router.post(
  '/library/import-local',
  route(async (req, res) => {
    try {
      const { importLocalVideo } = await import('../lib/video-library.js');
      const r = await importLocalVideo({ path: req.body?.path, productionId: Number(req.body?.productionId), name: req.body?.name });
      return ok(res, r, `Saved "${r.name}" (${(r.bytes / 1e6).toFixed(1)} MB, ${Math.round(r.duration ?? 0)}s) to the production`);
    } catch (err) {
      return fail(res, { NOT_FOUND: 404, BAD_TYPE: 400, BAD_VIDEO: 400 }[err.code] ?? 500, err.code ?? 'ERROR', err.message);
    }
  })
);

/** Play a video stored on this machine. */
router.get(
  '/library/:id/file',
  route(async (req, res) => {
    const row = getDb().prepare('SELECT local_path FROM assets WHERE id = ?').get(Number(req.params.id));
    const { existsSync } = await import('node:fs');
    if (!row?.local_path || !existsSync(row.local_path)) return fail(res, 404, 'NOT_FOUND', 'No local file for this video');
    return res.sendFile(row.local_path);
  })
);

router.delete(
  '/library/:id',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Asset not found');

    // Removing the local record only. An imported HeyGen video still exists in
    // the HeyGen account and can be imported again.
    db.prepare('DELETE FROM assets WHERE id = ?').run(id);
    return ok(res, { id, name: row.name }, `Removed "${row.name}" from the Library`);
  })
);

router.get(
  '/calendar',
  // Real dates, real productions. The old shape was 28 rows keyed by an integer
  // day-of-month, which cannot be overdue and cannot point at anything.
  route(async (req, res) => ok(res, month(req.query.month, req.query.mode || null)))
);

export default router;
