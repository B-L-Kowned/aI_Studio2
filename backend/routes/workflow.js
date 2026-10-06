import { Router } from 'express';
import { getDb } from '../db/index.js';
import { researchForProduction, researchSource, reviewResearch } from '../lib/research.js';
import { productionLock } from '../lib/production-lock.js';
import { looksFor, proofColumns, defaultFor, serializeLook, templateIdOf, DEFAULT_LOOK, DEFAULT_MOTION, ASPECTS, RESOLUTIONS } from '../lib/appearance.js';
import { templateById } from '../data/templates.js';
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
    look: r.avatar_asset_id
      ? serializeLook(getDb().prepare('SELECT * FROM provider_assets WHERE id = ?').get(r.avatar_asset_id))
      : null,
    backgroundKind: r.background_kind ?? null,
    backgroundValue: r.background_value ?? null,
    aspect: r.aspect ?? null,
    resolution: r.resolution ?? null,
    motionPrompt: r.motion_prompt ?? null,
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
    if (req.body?.avatarAssetId) {
      let c;
      try { c = proofColumns(presenterId, req.body); }
      catch (err) { return fail(res, 400, err.code ?? 'BAD_APPEARANCE', err.message); }
      const r = db.prepare(
        `INSERT INTO appearance_proofs (production_id, presenter_id, label, image_url, outfit, background, framing, notes,
           avatar_asset_id, background_kind, background_value, aspect, resolution, motion_prompt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(id, presenterId, String(req.body?.label || c.outfit).slice(0, 120), c.image_url, c.outfit, c.background,
        c.framing, String(req.body?.notes || '').slice(0, 1000), c.avatar_asset_id, c.background_kind,
        c.background_value, c.aspect, c.resolution, c.motion_prompt);
      return ok(res, state(id), `Look saved for approval (#${r.lastInsertRowid})`);
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

    const structured = ['avatarAssetId', 'backgroundKind', 'backgroundValue', 'aspect', 'resolution', 'motionPrompt'];
    if (structured.some((k) => req.body?.[k] !== undefined)) {
      let c;
      try {
        c = proofColumns(proof.presenter_id, {
          avatarAssetId: req.body.avatarAssetId ?? proof.avatar_asset_id,
          backgroundKind: req.body.backgroundKind ?? proof.background_kind ?? undefined,
          backgroundValue: req.body.backgroundValue ?? proof.background_value ?? undefined,
          aspect: req.body.aspect ?? proof.aspect ?? undefined,
          resolution: req.body.resolution ?? proof.resolution ?? undefined,
          motionPrompt: req.body.motionPrompt ?? proof.motion_prompt ?? undefined,
        });
      } catch (err) { return fail(res, 400, err.code ?? 'BAD_APPEARANCE', err.message); }
      db.prepare(
        `UPDATE appearance_proofs SET image_url = ?, outfit = ?, background = ?, framing = ?, avatar_asset_id = ?,
           background_kind = ?, background_value = ?, aspect = ?, resolution = ?, motion_prompt = ?,
           -- an approval was of the previous look; a changed look is a new question
           status = CASE WHEN status = 'approved' THEN 'draft' ELSE status END,
           approved_at = CASE WHEN status = 'approved' THEN NULL ELSE approved_at END
         WHERE id = ?`
      ).run(c.image_url, c.outfit, c.background, c.framing, c.avatar_asset_id, c.background_kind,
        c.background_value, c.aspect, c.resolution, c.motion_prompt, proof.id);
    }
    const allowed = ['label', 'notes'];
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
        // A performer with real looks to choose from is approved by look, so
        // the render has an exact instruction rather than a description.
        if (looksFor(current.presenter_id).some((l) => l.groupId) && !current.avatar_asset_id) {
          return fail(res, 409, 'LOOK_REQUIRED', 'Choose one of the performer’s looks before approving.');
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

/** What can be chosen for this video: each proofable performer's looks, and the default. */
router.get(
  '/:id/appearance/options',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(id)) {
      return fail(res, 404, 'NOT_FOUND', 'Production not found');
    }
    // Real people only (not invented characters), and one entry per person:
    // Pat's five presenter records share one avatar group, so they are one
    // performer with twenty looks, not five near-identical rows.
    const seen = new Set();
    const performers = db.prepare("SELECT * FROM presenters WHERE kind = 'personal' AND is_active = 1 ORDER BY id").all()
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, looks: looksFor(p.id) }))
      .filter((p) => {
        const key = p.looks[0]?.groupId ?? `p${p.id}`;
        if (!p.looks.length || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const tid = templateIdOf(id);
    return ok(res, {
      performers,
      template: tid ? { id: tid, name: templateById(tid)?.name } : null,
      default: defaultFor(id),
      settings: { ...DEFAULT_LOOK, motionPrompt: DEFAULT_MOTION, aspects: ASPECTS, resolutions: RESOLUTIONS },
    });
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
