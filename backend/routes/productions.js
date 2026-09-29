import { Router } from 'express';
import { getDb } from '../db/index.js';
import { markStaleFrom, staleSummary } from '../lib/stale.js';
import { assess, rebalance } from '../lib/producer.js';
import { templateById, BLANK_TEMPLATE, SOURCE_TYPES } from '../data/templates.js';
import { allowedModes } from '../lib/capabilities.js';
import { importScript, copyPlanFrom } from '../lib/sources.js';
import { analyse } from '../lib/video-analysis.js';
import { researchSource } from '../lib/research.js';
import { normaliseWebsiteUrl } from '../lib/web-research.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
const RUNTIME_RE = /^\d{1,3}:[0-5]\d$/;

export function loadProduction(id) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM productions WHERE id = ?').get(id);
  if (!p) return null;

  const outline = db
    .prepare('SELECT * FROM outline_sections WHERE production_id = ? ORDER BY position')
    .all(id);
  const scenes = db.prepare('SELECT * FROM scenes WHERE production_id = ? ORDER BY position').all(id);
  const briefRows = db
    .prepare('SELECT * FROM brief_fields WHERE production_id = ? ORDER BY position')
    .all(id);
  const decisionRows = db
    .prepare('SELECT * FROM decisions WHERE production_id = ? ORDER BY position')
    .all(id);
  const sources = db.prepare('SELECT * FROM sources WHERE production_id = ?').all(id);

  const groups = [
    { kind: 'warning', label: 'NEEDS YOUR DECISION' },
    { kind: 'ok', label: 'AI CAN DECIDE' },
    { kind: 'locked', label: 'LOCKED' },
  ];

  // The LIST serializer resolves this and the detail one did not, so the same
  // production read "AI for Operators — Season 1" on Home and "No campaign" one
  // click later in Create. Two endpoints describing one row have to agree.
  const campaign = p.campaign_id
    ? db.prepare('SELECT name FROM campaigns WHERE id = ?').get(p.campaign_id)?.name ?? null
    : null;

  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    campaignId: p.campaign_id ?? null,
    campaign,
    breadcrumb: p.breadcrumb,
    subtitle: p.subtitle,
    targetRuntime: p.target_runtime,
    // The deadline, so the list can show and set it without a second request.
    dueAt: p.due_at ?? null,
    mode: p.mode,
    outlineApproved: !!p.outline_approved,
    scenesApproved: !!p.scenes_approved,
    brief: briefRows.map((b) => ({ id: b.id, label: b.label, value: b.value })),
    outline: outline.map((s) => ({
      id: s.id, title: s.title, runtime: s.runtime,
      participants: s.participants, purpose: s.purpose,
    })),
    scenes: scenes.map((s) => ({
      id: s.id, ref: s.ref, title: s.title, participants: s.participants,
      runtime: s.runtime, purpose: s.purpose, outlineSectionId: s.outline_section_id,
    })),
    decisions: groups.map((g) => ({
      kind: g.kind,
      label: g.label,
      items: decisionRows
        .filter((d) => d.kind === g.kind)
        .map((d) => ({ id: d.id, text: d.text, resolution: d.resolution })),
    })),
    sources: sources.map((s) => ({ id: s.id, name: s.name, detail: s.detail, kind: s.kind })),
    stale: staleSummary(id),
  };
}

const touch = (id) =>
  getDb().prepare("UPDATE productions SET updated_at = datetime('now') WHERE id = ?").run(id);

function send(res, id, message, extra = {}) {
  return ok(res, { ...loadProduction(id), ...extra }, message);
}

/**
 * Summary row for the switcher and the Campaigns list. Carries real pipeline
 * state so a list can show how far along a production is without loading it.
 */
function summarize(p) {
  const db = getDb();
  const one = (sql, ...args) => db.prepare(sql).get(p.id, ...args).n;

  const counts = {
    sections: one('SELECT COUNT(*) n FROM outline_sections WHERE production_id = ?'),
    scenes: one('SELECT COUNT(*) n FROM scenes WHERE production_id = ?'),
    scripts: one('SELECT COUNT(*) n FROM script_versions WHERE production_id = ?'),
    renders: one('SELECT COUNT(*) n FROM render_versions WHERE production_id = ?'),
    exports: one('SELECT COUNT(*) n FROM exports WHERE production_id = ?'),
    publications: one("SELECT COUNT(*) n FROM publications WHERE production_id = ? AND status != 'not_prepared'"),
  };

  const acceptedScript = one("SELECT COUNT(*) n FROM script_versions WHERE production_id = ? AND status = 'accepted'");
  const completeRender = one("SELECT COUNT(*) n FROM render_versions WHERE production_id = ? AND status = 'complete'");

  // done → the step produced an accepted artifact; active → started, not settled.
  const state = (done, active) => (done ? 'done' : active ? 'active' : 'todo');
  const steps = [
    { key: 'plan',    state: state(p.scenes_approved, counts.sections > 0) },
    { key: 'script',  state: state(acceptedScript > 0, counts.scripts > 0) },
    { key: 'render',  state: state(completeRender > 0, counts.renders > 0) },
    { key: 'export',  state: state(counts.exports > 0, false) },
    { key: 'publish', state: state(counts.publications > 0, false) },
  ];

  const stale = staleSummary(p.id);
  const campaign = p.campaign_id
    ? db.prepare('SELECT name FROM campaigns WHERE id = ?').get(p.campaign_id)?.name
    : null;

  return {
    id: p.id, title: p.title, slug: p.slug, mode: p.mode, subtitle: p.subtitle,
    breadcrumb: p.breadcrumb, targetRuntime: p.target_runtime,
    campaignId: p.campaign_id, campaign,
    outlineApproved: !!p.outline_approved, scenesApproved: !!p.scenes_approved,
    updatedAt: p.updated_at, counts, steps,
    stage: steps.filter((s) => s.state === 'done').length,
    stale: Object.keys(stale).length,
    staleDetail: stale,
  };
}

router.get(
  '/',
  route(async (_req, res) => {
    const rows = getDb().prepare('SELECT * FROM productions ORDER BY updated_at DESC, id DESC').all();
    return ok(res, rows.map(summarize));
  })
);

// Create a production. FRONTEND_CONTRACT: createProduction(sourceType, templateId?)
router.post(
  '/',
  route(async (req, res) => {
    const db = getDb();
    const {
      sourceType = 'idea', templateId = null, title, campaignId = null,
      // What the starting point actually needs. Asking for these AFTER creating
      // the production is what made "New production from an existing video" a
      // dialog that never mentioned a video.
      videoFile = null, scriptText = null, copyFromId = null, sourceUrl = null,
    } = req.body ?? {};

    if (!SOURCE_TYPES.includes(sourceType)) {
      return fail(res, 400, 'BAD_SOURCE', `sourceType must be one of ${SOURCE_TYPES.join(', ')}`);
    }
    let validatedSourceUrl = null;
    if (sourceType === 'url') {
      try { validatedSourceUrl = normaliseWebsiteUrl(sourceUrl).href; }
      catch (err) { return fail(res, 400, err.code ?? 'BAD_URL', err.message); }
    }

    const template = templateId ? templateById(templateId) : null;
    if (templateId && !template) return fail(res, 404, 'NO_TEMPLATE', 'Unknown template');

    // A template outside the licence must not become a project you cannot open.
    const w = db.prepare('SELECT entitlement FROM workspace WHERE id = 1').get();
    if (template && !allowedModes(w.entitlement).includes(template.mode)) {
      return fail(res, 403, 'NOT_LICENSED',
        `"${template.name}" is a ${template.mode} template and your licence is ${w.entitlement}`);
    }

    const recipe = template ?? BLANK_TEMPLATE;
    const name = String(title ?? '').trim() || `Untitled ${recipe.name}`;

    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
    if (db.prepare('SELECT 1 FROM productions WHERE slug = ?').get(slug)) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const campaign = campaignId
      ? db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId)
      : null;
    if (campaignId && !campaign) return fail(res, 404, 'NO_CAMPAIGN', 'Unknown campaign');

    const mode = template?.mode ?? (w.entitlement === 'none' ? 'both' : w.entitlement);
    const breadcrumb = [campaign?.name, name].filter(Boolean).join(' › ');
    const subtitle = `${recipe.runtime} ${recipe.format} · ${recipe.name}`;

    const newId = db.transaction(() => {
      const id = db
        .prepare(
          `INSERT INTO productions
            (campaign_id, slug, title, breadcrumb, subtitle, target_runtime, mode)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(campaignId, slug, name, breadcrumb, subtitle, recipe.runtime, mode === 'both' ? 'both' : mode)
        .lastInsertRowid;

      const insBrief = db.prepare(
        'INSERT INTO brief_fields (production_id, label, value, position) VALUES (?,?,?,?)'
      );
      insBrief.run(id, 'Template', recipe.name, 0);
      recipe.brief.forEach(([label, value], i) => insBrief.run(id, label, value, i + 1));
      insBrief.run(id, 'Target runtime', recipe.runtime, recipe.brief.length + 1);

      const insOutline = db.prepare(
        'INSERT INTO outline_sections (production_id, position, title, runtime, participants, purpose) VALUES (?,?,?,?,?,?)'
      );
      recipe.outline.forEach(([t, rt, who], i) => insOutline.run(id, i, t, rt, who, ''));

      // Every new production starts with the same locked facts made explicit.
      const insDecision = db.prepare(
        'INSERT INTO decisions (production_id, kind, text, position) VALUES (?,?,?,?)'
      );
      insDecision.run(id, 'locked', `${recipe.runtime} target runtime`, 0);
      insDecision.run(id, 'locked', `${recipe.format} format`, 1);
      insDecision.run(id, 'warning', 'Who appears in this production?', 2);

      if (sourceType === 'existing_video' && videoFile) {
        db.prepare('INSERT INTO sources (production_id, name, detail, kind, file_path) VALUES (?,?,?,?,?)')
          .run(id, videoFile.split('/').pop(), 'Not measured yet', 'video', videoFile);
      }

      db.prepare('UPDATE workspace SET last_production_id = ? WHERE id = 1').run(id);
      return id;
    })();

    // The starting point does its work now, while the dialog's promise is still
    // fresh, rather than leaving a breadcrumb for you to find later.
    const extras = [];

    if (sourceType === 'existing_script' && String(scriptText ?? '').trim()) {
      try {
        const r = importScript(newId, scriptText);
        extras.push(`${r.lines} lines imported as script v${r.version} (${r.speakers.join(', ')})`);
      } catch (err) {
        extras.push(`the script could not be imported: ${err.message}`);
      }
    }

    if (sourceType === 'existing_project' && copyFromId) {
      try {
        const r = copyPlanFrom(Number(copyFromId), newId);
        extras.push(`plan copied from "${r.from}" — ${r.counts.outline} sections, ${r.counts.scenes} scenes`);
      } catch (err) {
        extras.push(`the plan could not be copied: ${err.message}`);
      }
    }

    if (sourceType === 'existing_video' && videoFile) {
      try {
        const result = await analyse(videoFile);
        const detail = [
          result.facts.video ? `${result.facts.video.width}×${result.facts.video.height}` : 'no video',
          result.facts.duration ? `${Math.round(result.facts.duration)}s` : null,
          `${result.cuts.length} shot${result.cuts.length === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' · ');
        db.prepare(
          "UPDATE sources SET detail = ?, analysis = ?, analysed_at = datetime('now') WHERE production_id = ? AND kind = 'video'"
        ).run(detail, JSON.stringify(result), newId);
        extras.push(`measured: ${detail}`);
      } catch (err) {
        // The production still exists; only the measurement failed, and saying
        // so beats a source row that silently reads "awaiting ingest" forever.
        extras.push(`the video could not be measured: ${err.message}`);
      }
    }

    if (sourceType === 'url' && validatedSourceUrl) {
      try {
        const researched = await researchSource(newId, validatedSourceUrl);
        extras.push(`website researched: ${researched.title || new URL(researched.url).hostname} — review the evidence in Plan → Sources`);
      } catch (err) {
        // Keep the production and the failed research row. A network failure is
        // not a reason to discard the title, campaign and template the user
        // already chose, but it must be visible and must keep the lock closed.
        extras.push(`website research needs attention: ${err.message}`);
      }
    }

    return ok(res, loadProduction(newId),
      `Created "${name}"` + (extras.length ? ` — ${extras.join('; ')}` : ''));
  })
);

router.get(
  '/current',
  route(async (_req, res) => {
    const db = getDb();
    const last = db.prepare('SELECT last_production_id AS id FROM workspace WHERE id = 1').get();
    const row =
      (last?.id && db.prepare('SELECT id FROM productions WHERE id = ?').get(last.id)) ||
      db.prepare('SELECT id FROM productions ORDER BY updated_at DESC, id DESC LIMIT 1').get();
    if (!row) return fail(res, 404, 'NO_PRODUCTION', 'No production yet. Create one from Idea.');
    return ok(res, loadProduction(row.id));
  })
);

// Remember which production is open, so a restart returns to it.
router.post(
  '/:id/open',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(id))
      return fail(res, 404, 'NOT_FOUND', 'Production not found');
    db.prepare('UPDATE workspace SET last_production_id = ? WHERE id = 1').run(id);
    return ok(res, loadProduction(id));
  })
);

router.patch(
  '/:id',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const p = db.prepare('SELECT * FROM productions WHERE id = ?').get(id);
    if (!p) return fail(res, 404, 'NOT_FOUND', 'Production not found');

    const { title, campaignId } = req.body ?? {};
    const nextTitle = title === undefined ? p.title : String(title).trim();
    if (title !== undefined && !nextTitle) return fail(res, 400, 'NO_TITLE', 'Title cannot be empty');

    let nextCampaign = p.campaign_id;
    if (campaignId !== undefined) {
      nextCampaign = campaignId === null ? null : Number(campaignId);
      if (nextCampaign !== null && !db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(nextCampaign)) {
        return fail(res, 404, 'NO_CAMPAIGN', 'Unknown campaign');
      }
    }

    const campaignName = nextCampaign
      ? db.prepare('SELECT name FROM campaigns WHERE id = ?').get(nextCampaign).name
      : null;

    db.prepare(
      `UPDATE productions SET title = ?, campaign_id = ?, breadcrumb = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(nextTitle, nextCampaign, [campaignName, nextTitle].filter(Boolean).join(' › '), id);

    return send(res, id, 'Production updated');
  })
);

router.delete(
  '/:id',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (db.prepare('SELECT COUNT(*) n FROM productions').get().n <= 1) {
      return fail(res, 409, 'LAST_PRODUCTION', 'Create another production before deleting this one');
    }
    const r = db.prepare('DELETE FROM productions WHERE id = ?').run(id);
    if (!r.changes) return fail(res, 404, 'NOT_FOUND', 'Production not found');
    const next = db.prepare('SELECT id FROM productions ORDER BY updated_at DESC LIMIT 1').get();
    db.prepare('UPDATE workspace SET last_production_id = ? WHERE id = 1').run(next?.id ?? null);
    return ok(res, loadProduction(next.id), 'Production deleted');
  })
);

router.get(
  '/:id',
  route(async (req, res) => {
    const p = loadProduction(Number(req.params.id));
    return p ? ok(res, p) : fail(res, 404, 'NOT_FOUND', 'Production not found');
  })
);

// --- Brief -----------------------------------------------------------------
router.patch(
  '/:id/brief/:fieldId',
  route(async (req, res) => {
    const { value } = req.body ?? {};
    if (typeof value !== 'string') return fail(res, 400, 'NO_VALUE', 'value must be a string');

    const db = getDb();
    const field = db
      .prepare('SELECT * FROM brief_fields WHERE id = ? AND production_id = ?')
      .get(req.params.fieldId, req.params.id);
    if (!field) return fail(res, 404, 'NOT_FOUND', 'Brief field not found');

    db.prepare('UPDATE brief_fields SET value = ? WHERE id = ?').run(value.slice(0, 500), field.id);
    if (field.label === 'Target runtime' && RUNTIME_RE.test(value)) {
      db.prepare('UPDATE productions SET target_runtime = ? WHERE id = ?').run(value, req.params.id);
    }
    const affected = markStaleFrom(Number(req.params.id), 'plan', `Brief field "${field.label}" changed`);
    touch(req.params.id);
    return send(res, Number(req.params.id), 'Brief updated', { affected });
  })
);

// --- Outline ---------------------------------------------------------------
router.post(
  '/:id/outline',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(id))
      return fail(res, 404, 'NOT_FOUND', 'Production not found');

    const next =
      (db.prepare('SELECT MAX(position) m FROM outline_sections WHERE production_id = ?').get(id).m ?? -1) + 1;
    db.prepare(
      'INSERT INTO outline_sections (production_id, position, title, runtime, participants, purpose) VALUES (?,?,?,?,?,?)'
    ).run(id, next, req.body?.title || 'New Section', req.body?.runtime || '1:00', req.body?.participants || '', '');

    const affected = markStaleFrom(id, 'plan', 'Outline section added');
    touch(id);
    return send(res, id, 'Section added', { affected });
  })
);

router.patch(
  '/:id/outline/:sectionId',
  route(async (req, res) => {
    const { runtime, title, purpose, participants } = req.body ?? {};
    if ([runtime, title, purpose, participants].every((v) => v === undefined)) {
      return fail(res, 400, 'NO_FIELDS', 'Provide runtime, title, purpose or participants');
    }
    const db = getDb();
    const id = Number(req.params.id);
    const section = db
      .prepare('SELECT * FROM outline_sections WHERE id = ? AND production_id = ?')
      .get(req.params.sectionId, id);
    if (!section) return fail(res, 404, 'NOT_FOUND', 'Outline section not found');

    if (runtime !== undefined) {
      if (!RUNTIME_RE.test(String(runtime)))
        return fail(res, 400, 'BAD_RUNTIME', 'Runtime must look like M:SS');
      db.prepare('UPDATE outline_sections SET runtime = ? WHERE id = ?').run(runtime, section.id);
    }
    if (title !== undefined)
      db.prepare('UPDATE outline_sections SET title = ? WHERE id = ?').run(String(title).slice(0, 200), section.id);
    if (purpose !== undefined)
      db.prepare('UPDATE outline_sections SET purpose = ? WHERE id = ?').run(String(purpose).slice(0, 1000), section.id);
    if (participants !== undefined)
      db.prepare('UPDATE outline_sections SET participants = ? WHERE id = ?').run(String(participants).slice(0, 200), section.id);

    const affected = markStaleFrom(id, 'plan', `Outline section "${section.title}" changed`);
    touch(id);
    return send(res, id, 'Outline updated', { affected });
  })
);

router.delete(
  '/:id/outline/:sectionId',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const r = db
      .prepare('DELETE FROM outline_sections WHERE id = ? AND production_id = ?')
      .run(req.params.sectionId, id);
    if (!r.changes) return fail(res, 404, 'NOT_FOUND', 'Outline section not found');
    const affected = markStaleFrom(id, 'plan', 'Outline section removed');
    touch(id);
    return send(res, id, 'Section removed', { affected });
  })
);

router.post(
  '/:id/outline/rebalance',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const n = rebalance(id);
    if (!n) return send(res, id, 'Already balanced — nothing changed');
    const affected = markStaleFrom(id, 'plan', 'Outline rebalanced');
    touch(id);
    return send(res, id, `Rebalanced ${n} sections`, { affected });
  })
);

router.post(
  '/:id/outline/approve',
  route(async (req, res) => {
    const id = Number(req.params.id);
    getDb().prepare('UPDATE productions SET outline_approved = 1 WHERE id = ?').run(id);
    return send(res, id, 'Outline approved');
  })
);

// --- Scenes ----------------------------------------------------------------
router.post(
  '/:id/scenes/develop',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const p = db.prepare('SELECT * FROM productions WHERE id = ?').get(id);
    if (!p) return fail(res, 404, 'NOT_FOUND', 'Production not found');
    if (!p.outline_approved)
      return fail(res, 409, 'OUTLINE_NOT_APPROVED', 'Approve the outline before developing scenes');

    const sections = db
      .prepare('SELECT * FROM outline_sections WHERE production_id = ? ORDER BY position')
      .all(id);
    const existing = new Set(
      db.prepare('SELECT outline_section_id FROM scenes WHERE production_id = ?').all(id)
        .map((r) => r.outline_section_id)
    );

    const ins = db.prepare(
      'INSERT INTO scenes (production_id, outline_section_id, position, ref, title, participants, runtime, purpose) VALUES (?,?,?,?,?,?,?,?)'
    );
    let position = db.prepare('SELECT COUNT(*) n FROM scenes WHERE production_id = ?').get(id).n;
    let created = 0;

    // One scene per un-expanded section. No dialogue is written here — Gate 6
    // requires scenes to be approvable without a script existing.
    db.transaction(() => {
      sections.forEach((s, i) => {
        if (existing.has(s.id)) return;
        ins.run(id, s.id, position++, `${i + 1}.1`, s.title, s.participants, s.runtime, s.purpose);
        created++;
      });
    })();

    if (!created) return send(res, id, 'Every section already has scenes');
    const affected = markStaleFrom(id, 'plan', 'Scenes developed');
    touch(id);
    return send(res, id, `Developed ${created} scenes`, { affected });
  })
);

router.post(
  '/:id/scenes',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(id))
      return fail(res, 404, 'NOT_FOUND', 'Production not found');
    const position = db.prepare('SELECT COUNT(*) n FROM scenes WHERE production_id = ?').get(id).n;
    db.prepare(
      'INSERT INTO scenes (production_id, outline_section_id, position, ref, title, participants, runtime, purpose) VALUES (?,?,?,?,?,?,?,?)'
    ).run(id, req.body?.outlineSectionId ?? null, position, req.body?.ref || `${position + 1}.1`,
      req.body?.title || 'New Scene', req.body?.participants || '', req.body?.runtime || '0:30', '');
    const affected = markStaleFrom(id, 'plan', 'Scene added');
    touch(id);
    return send(res, id, 'Scene added', { affected });
  })
);

router.patch(
  '/:id/scenes/:sceneId',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const scene = db
      .prepare('SELECT * FROM scenes WHERE id = ? AND production_id = ?')
      .get(req.params.sceneId, id);
    if (!scene) return fail(res, 404, 'NOT_FOUND', 'Scene not found');

    for (const f of ['title', 'participants', 'purpose']) {
      if (req.body?.[f] !== undefined)
        db.prepare(`UPDATE scenes SET ${f} = ? WHERE id = ?`).run(String(req.body[f]).slice(0, 500), scene.id);
    }
    if (req.body?.runtime !== undefined) {
      if (!RUNTIME_RE.test(String(req.body.runtime)))
        return fail(res, 400, 'BAD_RUNTIME', 'Runtime must look like M:SS');
      db.prepare('UPDATE scenes SET runtime = ? WHERE id = ?').run(req.body.runtime, scene.id);
    }
    const affected = markStaleFrom(id, 'plan', `Scene "${scene.title}" changed`);
    touch(id);
    return send(res, id, 'Scene updated', { affected });
  })
);

router.delete(
  '/:id/scenes/:sceneId',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const r = getDb()
      .prepare('DELETE FROM scenes WHERE id = ? AND production_id = ?')
      .run(req.params.sceneId, id);
    if (!r.changes) return fail(res, 404, 'NOT_FOUND', 'Scene not found');
    const affected = markStaleFrom(id, 'plan', 'Scene removed');
    touch(id);
    return send(res, id, 'Scene removed', { affected });
  })
);

router.post(
  '/:id/scenes/approve',
  route(async (req, res) => {
    const id = Number(req.params.id);
    getDb().prepare('UPDATE productions SET scenes_approved = 1 WHERE id = ?').run(id);
    return send(res, id, 'Scenes approved');
  })
);

// --- Decisions -------------------------------------------------------------
router.post(
  '/:id/decisions/:decisionId/resolve',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const r = getDb()
      .prepare('UPDATE decisions SET resolution = ? WHERE id = ? AND production_id = ?')
      .run(String(req.body?.resolution ?? '').slice(0, 300) || 'Resolved', req.params.decisionId, id);
    if (!r.changes) return fail(res, 404, 'NOT_FOUND', 'Decision not found');
    const affected = markStaleFrom(id, 'plan', 'A planning decision was resolved');
    touch(id);
    return send(res, id, 'Decision resolved', { affected });
  })
);

// --- Sources ---------------------------------------------------------------
router.post(
  '/:id/sources',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const { name, detail, kind } = req.body ?? {};
    if (!String(name ?? '').trim()) return fail(res, 400, 'NAME_REQUIRED', 'A source needs a name');
    getDb()
      .prepare('INSERT INTO sources (production_id, name, detail, kind) VALUES (?,?,?,?)')
      .run(id, String(name).slice(0, 200), String(detail ?? '').slice(0, 300), kind || 'file');
    touch(id);
    return send(res, id, 'Source added');
  })
);

// --- AI Producer -----------------------------------------------------------
router.get(
  '/:id/producer',
  route(async (req, res) => {
    const result = assess(Number(req.params.id));
    return result ? ok(res, result) : fail(res, 404, 'NOT_FOUND', 'Production not found');
  })
);

export default router;
