import { Router } from 'express';
import { getDb } from '../db/index.js';
import { researchForProduction, researchSource, reviewResearch } from '../lib/research.js';
import { productionLock } from '../lib/production-lock.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

function appearances(productionId) {
  return getDb().prepare(
    `SELECT ap.*, p.name AS presenter_name, p.kind AS presenter_kind
       FROM appearance_proofs ap
       LEFT JOIN presenters p ON p.id = ap.presenter_id
      WHERE ap.production_id = ? ORDER BY ap.id DESC`
  ).all(productionId).map((r) => ({
    id: r.id,
    presenterId: r.presenter_id,
    presenterName: r.presenter_name,
    presenterKind: r.presenter_kind,
    label: r.label,
    imageUrl: r.image_url,
    outfit: r.outfit,
    background: r.background,
    framing: r.framing,
    notes: r.notes,
    status: r.status,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
  }));
}

function state(id) {
  return {
    research: researchForProduction(id),
    appearances: appearances(id),
    lock: productionLock(id),
  };
}

router.get(
  '/:id/workflow',
  route(async (req, res) => {
    const id = Number(req.params.id);
    if (!getDb().prepare('SELECT 1 FROM productions WHERE id = ?').get(id)) {
      return fail(res, 404, 'NOT_FOUND', 'Production not found');
    }
    return ok(res, state(id));
  })
);

router.post(
  '/:id/research',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const url = req.body?.url;
    try {
      const research = await researchSource(id, url);
      return ok(res, { ...state(id), current: research }, `Researched ${new URL(research.url).hostname} — review the evidence before scripting`);
    } catch (err) {
      return fail(res,
        err.code === 'NOT_FOUND' ? 404 : ['BAD_URL', 'URL_REQUIRED', 'PRIVATE_URL'].includes(err.code) ? 400 : 422,
        err.code ?? 'RESEARCH_FAILED', err.message);
    }
  })
);

router.post(
  '/:id/research/:researchId/review',
  route(async (req, res) => {
    const id = Number(req.params.id);
    try {
      const reviewed = reviewResearch(id, Number(req.params.researchId), {
        applyBrief: req.body?.applyBrief !== false,
      });
      return ok(res, { ...state(id), reviewed },
        `Website research approved${reviewed.applied ? ` — ${reviewed.applied} brief field${reviewed.applied === 1 ? '' : 's'} filled` : ''}`);
    } catch (err) {
      return fail(res, err.code === 'NOT_FOUND' ? 404 : 409, err.code ?? 'REVIEW_FAILED', err.message);
    }
  })
);

router.delete(
  '/:id/research/:researchId',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const row = db.prepare(
      'SELECT * FROM website_research WHERE id = ? AND production_id = ?'
    ).get(req.params.researchId, id);
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Website research not found');
    if (row.reviewed) {
      return fail(res, 409, 'REVIEWED_SOURCE', 'Reviewed evidence is part of the production record and cannot be removed');
    }
    db.transaction(() => {
      db.prepare('DELETE FROM website_research WHERE id = ?').run(row.id);
      if (row.source_id && !db.prepare('SELECT 1 FROM website_research WHERE source_id = ?').get(row.source_id)) {
        db.prepare('DELETE FROM sources WHERE id = ?').run(row.source_id);
      }
    })();
    return ok(res, state(id), 'Unreviewed website source removed');
  })
);

router.post(
  '/:id/appearance',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(id)) {
      return fail(res, 404, 'NOT_FOUND', 'Production not found');
    }
    const presenterId = Number(req.body?.presenterId);
    if (!presenterId || !db.prepare('SELECT 1 FROM presenters WHERE id = ?').get(presenterId)) {
      return fail(res, 400, 'PRESENTER_REQUIRED', 'Choose the performer this proof belongs to.');
    }
    const result = db.prepare(
      `INSERT INTO appearance_proofs
         (production_id, presenter_id, label, image_url, outfit, background, framing, notes)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      id, presenterId,
      String(req.body?.label || 'Appearance proof').slice(0, 120),
      String(req.body?.imageUrl || '').slice(0, 2000) || null,
      String(req.body?.outfit || '').slice(0, 500),
      String(req.body?.background || '').slice(0, 500),
      String(req.body?.framing || '').slice(0, 500),
      String(req.body?.notes || '').slice(0, 1000)
    );
    return ok(res, state(id), `Appearance proof saved as draft (#${result.lastInsertRowid})`);
  })
);

router.patch(
  '/:id/appearance/:proofId',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const proof = db.prepare(
      'SELECT * FROM appearance_proofs WHERE id = ? AND production_id = ?'
    ).get(req.params.proofId, id);
    if (!proof) return fail(res, 404, 'NOT_FOUND', 'Appearance proof not found');

    const allowed = ['label', 'imageUrl', 'outfit', 'background', 'framing', 'notes'];
    const columns = { label: 'label', imageUrl: 'image_url', outfit: 'outfit', background: 'background', framing: 'framing', notes: 'notes' };
    for (const field of allowed) {
      if (req.body?.[field] !== undefined) {
        db.prepare(`UPDATE appearance_proofs SET ${columns[field]} = ? WHERE id = ?`)
          .run(String(req.body[field]).slice(0, field === 'imageUrl' ? 2000 : 1000), proof.id);
      }
    }

    if (req.body?.status !== undefined) {
      if (!['draft', 'approved', 'rejected'].includes(req.body.status)) {
        return fail(res, 400, 'BAD_STATUS', 'Appearance status must be draft, approved or rejected');
      }
      const current = db.prepare('SELECT * FROM appearance_proofs WHERE id = ?').get(proof.id);
      if (req.body.status === 'approved') {
        const missing = [
          ['image proof', current.image_url], ['outfit', current.outfit],
          ['background', current.background], ['framing', current.framing],
        ].filter(([, value]) => !String(value ?? '').trim()).map(([label]) => label);
        if (missing.length) {
          return fail(res, 409, 'PROOF_INCOMPLETE', `Approve after setting: ${missing.join(', ')}.`);
        }
        db.prepare(
          `UPDATE appearance_proofs SET status = 'rejected'
            WHERE production_id = ? AND presenter_id = ? AND id != ? AND status = 'approved'`
        ).run(id, current.presenter_id, current.id);
      }
      db.prepare(
        `UPDATE appearance_proofs SET status = ?, approved_at =
          CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END WHERE id = ?`
      ).run(req.body.status, req.body.status, proof.id);
    }
    return ok(res, state(id), `Appearance proof ${req.body?.status ?? 'updated'}`);
  })
);

router.get(
  '/:id/lock',
  route(async (req, res) => {
    const lock = productionLock(Number(req.params.id));
    return lock ? ok(res, lock) : fail(res, 404, 'NOT_FOUND', 'Production not found');
  })
);

export default router;
