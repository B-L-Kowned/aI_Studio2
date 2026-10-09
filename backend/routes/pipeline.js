import { Router } from 'express';
import { syncVisualRows } from '../lib/visuals.js';
import { getDb } from '../db/index.js';
import { markStaleFrom, clearStale, staleSummary } from '../lib/stale.js';
import {
  generateScript, estimateRuntime, buildLlmScriptRequest, segmentsFromLlmScript,
} from '../lib/script-generator.js';
import { getRouting } from '../lib/llm.js';
import { generateStructured, LlmRuntimeError } from '../lib/llm-runtime.js';
import { publishTargets, publishChannels, editorTools } from '../data/fixtures.js';
import { buildExport, planEdits } from '../lib/exporter.js';
import { audienceFor } from '../lib/companies.js';
import * as artificialFunny from '../lib/publishers/artificial-funny.js';
import { pushRenderJob, jobsForRender, pollJob } from '../lib/providers/index.js';
import { isDryRun, providerMode, canGenerateLive } from '../lib/providers/mode.js';
import { castingReadiness } from '../lib/casting.js';
import { renderGate, buildSegments } from '../lib/segments.js';
import { enqueue as queueVoice } from '../lib/voice-batch.js';
import { productionLock } from '../lib/production-lock.js';
import { madeBy } from '../lib/made-by.js';
import { cleanRecordingAudio } from '../lib/assemble.js';
import { keepRenderLocally } from '../lib/render-keep.js';
import { costOf, budgetRefusal, budgetApplies } from '../lib/budget.js';
import { chooseRenderPath } from '../lib/providers/heygen-route.js';
import { usable } from '../lib/grants.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();
const DRY_RUN = isDryRun;

// ---------------------------------------------------------------- Script ---
function scriptState(productionId) {
  const db = getDb();
  const versions = db
    .prepare('SELECT * FROM script_versions WHERE production_id = ? ORDER BY version DESC')
    .all(productionId);
  const latest = versions[0];
  const segments = latest
    ? db
        .prepare(
          `SELECT sg.*, sc.ref AS scene_ref, sc.title AS scene_title
           FROM script_segments sg LEFT JOIN scenes sc ON sc.id = sg.scene_id
           WHERE sg.script_version_id = ? ORDER BY sg.position`
        )
        .all(latest.id)
    : [];

  return {
    versions: versions.map((v) => ({
      id: v.id, version: v.version, status: v.status,
      generatorProvider: v.generator_provider, generatorModel: v.generator_model,
      stale: !!v.stale, staleReason: v.stale_reason, createdAt: v.created_at,
    })),
    latest: latest
      ? {
          id: latest.id, version: latest.version, status: latest.status,
          generatorProvider: latest.generator_provider, generatorModel: latest.generator_model,
          stale: !!latest.stale, staleReason: latest.stale_reason,
          segments: segments.map((s) => ({
            id: s.id, speaker: s.speaker, text: s.text,
            sceneRef: s.scene_ref, sceneTitle: s.scene_title,
          })),
        }
      : null,
  };
}

router.get(
  '/:id/script',
  route(async (req, res) => ok(res, scriptState(Number(req.params.id))))
);

router.post(
  '/:id/script/generate',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const p = db.prepare('SELECT * FROM productions WHERE id = ?').get(id);
    if (!p) return fail(res, 404, 'NOT_FOUND', 'Production not found');

    const websiteSources = db
      .prepare('SELECT status, reviewed FROM website_research WHERE production_id = ?')
      .all(id);
    if (websiteSources.some((source) => source.status !== 'complete' || !source.reviewed)) {
      return fail(
        res,
        409,
        'RESEARCH_NOT_APPROVED',
        'Review and approve the website evidence in Plan · Sources before generating a script'
      );
    }

    // Script is downstream of an approved plan — the handoff makes this explicit.
    if (!p.outline_approved)
      return fail(res, 409, 'OUTLINE_NOT_APPROVED', 'Approve the outline before generating a script');
    // One shot-list row per section exists before any dialogue is written.
    syncVisualRows(id);
    const scenes = db.prepare('SELECT * FROM scenes WHERE production_id = ? ORDER BY position').all(id);
    if (!scenes.length) return fail(res, 409, 'NO_SCENES', 'Add an outline section before generating a script');

    const nextVersion =
      (db.prepare('SELECT MAX(version) m FROM script_versions WHERE production_id = ?').get(id).m ?? 0) + 1;

    // Personas of everyone who might speak, keyed by the name the scenes use.
    // Without this the generator has no idea that "Pat the Strategist" opens by
    // stating the decision — the persona sat in the database doing nothing.
    const personas = Object.fromEntries(
      db.prepare("SELECT name, persona FROM presenters WHERE persona IS NOT NULL AND is_active = 1")
        .all()
        .map((r) => {
          try { return [r.name, JSON.parse(r.persona)]; } catch { return [r.name, null]; }
        })
        .filter(([, v]) => v)
    );
    // Who this track is talking to. The same company says different things to
    // investors and to buyers, and a script that does not know which it is
    // doing is the reason one video has to be rewritten into the other.
    const track = audienceFor(id);
    // Approved website evidence is copied into the brief, but recording it is
    // not enough: the script must actually receive it. The deterministic
    // generator uses Source summary in the opening and CTA at the close.
    const brief = Object.fromEntries(
      db.prepare('SELECT label, value FROM brief_fields WHERE production_id = ? ORDER BY position')
        .all(id)
        .map((field) => [field.label, field.value])
    );
    const routedProvider = getRouting().script;
    let generatorProvider = 'included';
    let generatorModel = null;
    let segments;

    // Fixtures is an offline promise, even if a cloud route and key are saved.
    // Local Ollama is allowed in Test because it stays on this machine and does
    // not consume provider credits. Cloud text generation is allowed only in
    // Live, the same explicit billing boundary used for finished renders.
    if (providerMode() === 'fixtures' || routedProvider === 'included') {
      segments = generateScript(scenes, p.title, personas, track, brief);
    } else if (routedProvider !== 'ollama' && !canGenerateLive()) {
      return fail(
        res,
        409,
        'PAID_AI_DISABLED',
        `Scripting is routed to ${routedProvider}, which may bill your provider account. Enable Live or route Scripting to Built-in deterministic or Local Ollama.`
      );
    } else {
      const request = buildLlmScriptRequest(scenes, p.title, personas, track, brief);
      try {
        const generated = await generateStructured(routedProvider, request);
        segments = segmentsFromLlmScript(generated.data, scenes);
        generatorProvider = generated.provider;
        generatorModel = generated.model;
      } catch (err) {
        const code = err instanceof LlmRuntimeError ? err.code : err.code ?? 'SCRIPT_GENERATION_FAILED';
        const status = code === 'BAD_SCRIPT_SHAPE' ? 502 : code === 'NO_KEY' ? 409 : 502;
        return fail(res, status, code, err.message || 'The selected model could not generate a valid script.');
      }
    }

    db.transaction(() => {
      const versionId = db
        .prepare(
          'INSERT INTO script_versions (production_id, version, status, generator_provider, generator_model) VALUES (?,?,?,?,?)'
        )
        .run(id, nextVersion, 'proposed', generatorProvider, generatorModel).lastInsertRowid;
      const ins = db.prepare(
        'INSERT INTO script_segments (script_version_id, scene_id, position, speaker, text) VALUES (?,?,?,?,?)'
      );
      for (const s of segments) ins.run(versionId, s.scene_id, s.position, s.speaker, s.text);
    })();

    return ok(
      res,
      { ...scriptState(id), stale: staleSummary(id) },
      generatorProvider === 'included'
        ? `Script v${nextVersion} proposed (built-in deterministic · $0)`
        : `Script v${nextVersion} proposed with ${generatorProvider}/${generatorModel}`
    );
  })
);

router.post(
  '/:id/script/:versionId/:action(accept|reject)',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const action = req.params.action;
    const v = db
      .prepare('SELECT * FROM script_versions WHERE id = ? AND production_id = ?')
      .get(req.params.versionId, id);
    if (!v) return fail(res, 404, 'NOT_FOUND', 'Script version not found');

    db.prepare('UPDATE script_versions SET status = ? WHERE id = ?')
      .run(action === 'accept' ? 'accepted' : 'rejected', v.id);
    if (action === 'accept') clearStale('script_versions', v.id);

    const affected = action === 'accept' ? markStaleFrom(id, 'script', `Script v${v.version} accepted`) : {};
    // Approving a script is the first of three decisions; what follows it is
    // not one. Its lines are built and its voice is queued at once (on this
    // Mac, free) — unless you record it yourself, where your voice is the take.
    let voice = null;
    const finished = !!db.prepare("SELECT 1 FROM brief_fields WHERE production_id = ? AND label = 'Completed asset' AND value != ''").get(id);
    if (action === 'accept' && madeBy(id) !== 'self' && !finished) {
      try { buildSegments(id); voice = queueVoice([id]) ? 'queued' : 'already queued'; } catch (err) { voice = `not started: ${err.message}`; }
    }
    return ok(res, { ...scriptState(id), stale: staleSummary(id), affected, voice },
      `Script v${v.version} ${action}ed${voice === 'queued' ? ' — its voice is being made now' : ''}`);
  })
);

router.patch(
  '/:id/script/:versionId/segments/:segmentId',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const version = db.prepare(
      'SELECT * FROM script_versions WHERE id = ? AND production_id = ?'
    ).get(req.params.versionId, id);
    if (!version) return fail(res, 404, 'NOT_FOUND', 'Script version not found');
    if (version.status !== 'proposed') {
      return fail(res, 409, 'SCRIPT_LOCKED', 'Accepted and rejected scripts are immutable; regenerate to make a new proposal');
    }
    const segment = db.prepare(
      'SELECT * FROM script_segments WHERE id = ? AND script_version_id = ?'
    ).get(req.params.segmentId, version.id);
    if (!segment) return fail(res, 404, 'NOT_FOUND', 'Script line not found');

    const speaker = req.body?.speaker === undefined ? segment.speaker : String(req.body.speaker).trim();
    const text = req.body?.text === undefined ? segment.text : String(req.body.text).trim();
    if (!speaker) return fail(res, 400, 'SPEAKER_REQUIRED', 'A script line needs a speaker');
    if (!text) return fail(res, 400, 'TEXT_REQUIRED', 'A script line cannot be empty');
    db.prepare('UPDATE script_segments SET speaker = ?, text = ? WHERE id = ?')
      .run(speaker.slice(0, 120), text.slice(0, 5000), segment.id);
    return ok(res, scriptState(id), `Updated script v${version.version}`);
  })
);

// --------------------------------------------------------------- Produce ---
// Capability previews. The UI requests a capability, never a provider.
const PREVIEW_CAPABILITIES = [
  { capability: 'draft_voice', label: 'Voice draft', detail: 'Synthesised read of the accepted script' },
  { capability: 'generate_scene', label: 'Scene visual', detail: 'Avatar + background composition' },
  { capability: 'draft_avatar', label: 'Avatar preview', detail: 'Likeness and framing check' },
  { capability: 'b_roll', label: 'B-roll suggestion', detail: 'Stock/diagram candidates per scene' },
];

router.get(
  '/:id/produce',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const accepted = db
      .prepare("SELECT * FROM script_versions WHERE production_id = ? AND status = 'accepted' ORDER BY version DESC")
      .get(id);
    return ok(res, {
      dryRun: DRY_RUN(),
      ready: !!accepted,
      acceptedVersion: accepted?.version ?? null,
      previews: PREVIEW_CAPABILITIES.map((c) => ({
        ...c,
        provider: DRY_RUN() ? 'fixture (dry run)' : 'auto-routed',
        quality: 'draft',
      })),
    });
  })
);

// ---------------------------------------------------------------- Render ---
// A render is a row that advances on its own clock, so queued → processing →
// complete is observable without a job runner. The queue phase is deliberate:
// TEST_PLAN step 12 needs every state to be reachable, and without it a render
// reports `processing` on the very first read.
/** The provider reports seconds; this column holds m:ss. */
function clock(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return null;
  const total = Math.round(Number(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const QUEUE_SECONDS = 2;
const RENDER_SECONDS = 6;
const PUSH_GRACE_SECONDS = 120;

/**
 * Move live renders forward.
 *
 * A render backed by a REAL provider job takes its state from the provider. The
 * clock below is for simulated jobs only — it used to run for every render, so
 * a real HeyGen job was declared complete eight seconds after submission, the
 * UI said "Render complete — open Edit to work on it", and an export row was
 * created for a video that did not exist yet. A progress bar that advances on
 * its own is not progress, it is an animation.
 */
async function advanceRenders(productionId) {
  const db = getDb();
  const live = db
    .prepare("SELECT * FROM render_versions WHERE production_id = ? AND status IN ('queued','processing')")
    .all(productionId);

  // A render that completed before its job reported a url keeps no way to play
  // itself, and the loop below never looks at completed rows again. Carry it
  // across from the job, which is where the provider actually wrote it.
  const orphaned = db
    .prepare(
      `SELECT rv.id, pj.video_url, pj.thumbnail_url, pj.duration
         FROM render_versions rv
         JOIN provider_jobs pj ON pj.render_version_id = rv.id
        WHERE rv.production_id = ? AND rv.status = 'complete'
          AND rv.video_url IS NULL AND pj.video_url IS NOT NULL`
    )
    .all(productionId);
  for (const o of orphaned) {
    db.prepare(
      'UPDATE render_versions SET video_url = ?, thumbnail_url = ?, duration = COALESCE(?, duration) WHERE id = ?'
    ).run(o.video_url, o.thumbnail_url, clock(o.duration), o.id);
  }

  for (const r of live) {
    const job = db
      .prepare('SELECT * FROM provider_jobs WHERE render_version_id = ? ORDER BY id DESC LIMIT 1')
      .get(r.id);
    const real = job && !String(job.remote_id ?? '').startsWith('fx_');
    const simulated = job ? !real : !!r.dry_run;

    let status;
    let progress;

    if (!real && !simulated) {
      // A paid render with no provider job never reached the provider. It is
      // not "processing", and the clock below must never declare it complete.
      // The grace period covers a poll that lands while the push is in flight.
      const age = (Date.now() - Date.parse(r.started_at)) / 1000;
      if (age < PUSH_GRACE_SECONDS) continue;
      db.prepare("UPDATE render_versions SET status = 'failed', error = COALESCE(error, ?) WHERE id = ?")
        .run('No provider job was recorded for this render.', r.id);
      continue;
    }

    if (real) {
      const polled = await pollJob(job.id).catch(() => null);
      progress = polled?.progress ?? r.progress;
      status = {
        completed: 'complete', failed: 'failed', cancelled: 'cancelled',
        processing: 'processing', pending: 'queued',
      }[polled?.status] ?? r.status;
      if (status === 'complete') progress = 100;
      if (polled?.error) {
        db.prepare('UPDATE render_versions SET error = ? WHERE id = ?').run(polled.error, r.id);
      }
      // Carry the finished video onto the render version. The provider's
      // duration is the REAL one; ours was an estimate made before the render
      // existed, and showing the estimate next to a finished video is a guess
      // presented as a measurement.
      if (polled?.videoUrl) {
        db.prepare(
          'UPDATE render_versions SET video_url = ?, thumbnail_url = ?, duration = COALESCE(?, duration) WHERE id = ?'
        ).run(polled.videoUrl, polled.thumbnailUrl ?? null, clock(polled.duration), r.id);
      }
    } else {
      const elapsed = (Date.now() - Date.parse(r.started_at)) / 1000;
      progress =
        elapsed < QUEUE_SECONDS
          ? 0
          : Math.min(100, Math.round(((elapsed - QUEUE_SECONDS) / RENDER_SECONDS) * 100));
      status = progress >= 100 ? 'complete' : elapsed < QUEUE_SECONDS ? 'queued' : 'processing';
    }

    db.prepare('UPDATE render_versions SET progress = ?, status = ? WHERE id = ?')
      .run(progress, status, r.id);

    if (status === 'complete') {
      keepRenderLocally(r.id);
      const exists = db.prepare('SELECT 1 FROM exports WHERE render_version_id = ?').get(r.id);
      if (!exists) {
        const n = (db.prepare('SELECT MAX(version) m FROM exports WHERE production_id = ?').get(productionId).m ?? 0) + 1;
        db.prepare(
          'INSERT INTO exports (production_id, render_version_id, version, status) VALUES (?,?,?,?)'
        ).run(productionId, r.id, n, 'ready');
      }
    }
  }
}

async function renderState(productionId) {
  await advanceRenders(productionId);
  const db = getDb();
  const renders = db
    .prepare('SELECT * FROM render_versions WHERE production_id = ? ORDER BY version DESC')
    .all(productionId);
  const latest = renders[0];
  const decisions = latest
    ? db.prepare('SELECT * FROM edit_decisions WHERE render_version_id = ? ORDER BY id').all(latest.id)
    : [];
  const exports = db
    .prepare('SELECT * FROM exports WHERE production_id = ? ORDER BY version DESC')
    .all(productionId);

  return {
    dryRun: DRY_RUN(),
    casting: castingReadiness(productionId),
    gate: renderGate(productionId),
    editorTools,
    renders: renders.map((r) => ({
      id: r.id, version: r.version, status: r.status, progress: r.progress,
      duration: r.duration, costEstimate: r.cost_estimate, dryRun: !!r.dry_run,
      videoUrl: r.video_url, thumbnailUrl: r.thumbnail_url,
      stale: !!r.stale, staleReason: r.stale_reason, error: r.error, createdAt: r.created_at,
    })),
    latest: latest
      ? {
          id: latest.id, version: latest.version, status: latest.status,
          progress: latest.progress, duration: latest.duration,
          // `latest` is built separately from `renders`, so a field added to
          // one is silently missing from the other — which is why the finished
          // video had a url in the list and none on the thing being displayed.
          videoUrl: latest.video_url, thumbnailUrl: latest.thumbnail_url,
          costEstimate: latest.cost_estimate, stale: !!latest.stale,
          staleReason: latest.stale_reason,
          editDecisions: decisions.map((d) => ({ id: d.id, kind: d.kind, target: d.target, note: d.note })),
          providerJobs: jobsForRender(latest.id),
        }
      : null,
    exports: exports.map((e) => ({
      id: e.id, version: e.version, status: e.status,
      // What is actually on disk, so the UI can stop saying "ready" about a row.
      filePath: e.file_path, bytes: e.bytes, durationSeconds: e.duration_seconds,
      editsApplied: e.edits_applied, note: e.note, error: e.error,
      stale: !!e.stale, staleReason: e.stale_reason,
    })),
  };
}

router.get('/:id/render', route(async (req, res) => ok(res, await renderState(Number(req.params.id)))));

router.post(
  '/:id/render',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const accepted = db
      .prepare("SELECT * FROM script_versions WHERE production_id = ? AND status = 'accepted' ORDER BY version DESC")
      .get(id);
    if (!accepted) return fail(res, 409, 'NO_ACCEPTED_SCRIPT', 'Accept a script version before rendering');
    // Your own recording, re-performed by your avatar: the cleaned audio of
    // your takes drives it, so the AI voice and its approvals do not apply.
    const fromRecording = req.body?.fromRecording === true;
    if (fromRecording && madeBy(id) !== 'self') {
      return fail(res, 409, 'NOT_SELF_RECORDED', 'Only a video you recorded yourself can be turned into an avatar video.');
    }

    // Fixtures remains an explicit sandbox for exercising downstream export
    // and publication code. Any path that can reach HeyGen — including Test's
    // free, watermarked API-key route — must pass the whole approval chain.
    // A share that has ended stops a render in every mode, Fixtures included:
    // it is a question of permission, not of cost.
    const castIds = [...new Set(getDb().prepare('SELECT presenter_id FROM segments WHERE production_id = ?').all(id).map((r) => r.presenter_id).filter(Boolean))];
    const ended = castIds.map((pid) => usable(pid)).find((u) => !u.ok);
    if (ended) return fail(res, 409, 'GRANT_ENDED', ended.reason);

    const lock = productionLock(id);
    const blockers = (lock?.blockers ?? []).filter((b) => !(fromRecording && b.key === 'voice'));
    if (providerMode() !== 'fixtures' && blockers.length) {
      return fail(
        res,
        409,
        'PRODUCTION_LOCKED',
        `Production Lock has ${blockers.length} blocker${blockers.length === 1 ? '' : 's'}: `
          + blockers.slice(0, 4).map((item) => `${item.label} — ${item.detail}`).join('; ')
          + (blockers.length > 4 ? '…' : '')
      );
    }

    // The hard gate applies to the whole production too: if segments exist, every
    // one of them must be cast and heard. Rendering the whole thing must not be a
    // way around a gate that stops you rendering one line of it.
    const gate = renderGate(id);
    if (!fromRecording && gate.total > 0 && !gate.ready) {
      return fail(res, 409, 'UNHEARD',
        `${gate.blocked.length} of ${gate.total} segments are not ready: ` +
        gate.blocked.slice(0, 3).map((b) => `#${b.position + 1} (${b.reason})`).join(', ') +
        (gate.blocked.length > 3 ? '…' : '') + '. Nothing renders unheard.');
    }

    // Gate 10 / safety rule: a paid render needs explicit confirmation, and the
    // confirmation is refused outright while dry run is on.
    if (!DRY_RUN() && req.body?.confirmPaid !== true) {
      return fail(res, 402, 'CONFIRMATION_REQUIRED', 'A paid render requires explicit confirmation');
    }

    let audio = null;
    if (fromRecording) {
      try { audio = await cleanRecordingAudio(id); } catch (err) { return fail(res, 409, err.code ?? 'NO_TAKES', err.message); }
    }
    const segments = db
      .prepare('SELECT text FROM script_segments WHERE script_version_id = ?')
      .all(accepted.id);
    const duration = audio
      ? `${Math.floor(audio.seconds / 60)}:${String(Math.round(audio.seconds % 60)).padStart(2, '0')}`
      : estimateRuntime(segments);
    const minutes = duration.split(':').reduce((m, s, i) => (i === 0 ? Number(m) : Number(m) + Number(s) / 60), 0);
    // The customer's own monthly limit, for pay-as-you-go (API key) renders.
    // A plan render spends plan credits and is not counted against it.
    const renderPath = DRY_RUN() ? null : await chooseRenderPath();
    const cost = budgetApplies(renderPath) ? costOf(minutes) : 0;
    const overBudget = budgetApplies(renderPath) ? budgetRefusal(cost) : null;
    if (overBudget) return fail(res, 402, overBudget.code, overBudget.message);

    const version =
      (db.prepare('SELECT MAX(version) m FROM render_versions WHERE production_id = ?').get(id).m ?? 0) + 1;

    const renderVersionId = db.prepare(
      `INSERT INTO render_versions
        (production_id, script_version_id, version, status, progress, duration, cost_estimate, dry_run, started_at)
       VALUES (?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).run(id, accepted.id, version, 'queued', 0, duration, cost, DRY_RUN() ? 1 : 0).lastInsertRowid;

    // PUSH to the routed generation provider. A failure here must not lose the
    // render row — the render is recorded, and the job can be retried.
    let push = null;
    let pushError = null;
    try {
      const fullSegments = db
        .prepare('SELECT speaker, text FROM script_segments WHERE script_version_id = ? ORDER BY position')
        .all(accepted.id);
      push = await pushRenderJob({
        productionId: id,
        renderVersionId,
        segments: fullSegments,
        title: db.prepare('SELECT title FROM productions WHERE id = ?').get(id).title,
        audioFile: audio?.file,
      });
    } catch (err) {
      // Failed, not queued: a queued row with no provider job is what the
      // simulated clock below advances, so a rejected render used to be marked
      // complete eight seconds later, with an export for a video nobody made.
      pushError = err.message;
      db.prepare("UPDATE render_versions SET status = 'failed', error = ? WHERE id = ?")
        .run(err.message, renderVersionId);
    }

    return ok(
      res,
      { ...(await renderState(id)), push, pushError },
      pushError
        ? `Render v${version} recorded, but the provider rejected it: ${pushError}`
        : DRY_RUN()
          ? `Render v${version} queued (dry run — no credits used, est. $${cost})`
          : `Render v${version} queued — est. $${cost}`
    );
  })
);

router.post(
  '/:id/render/:renderId/cancel',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const r = getDb()
      .prepare("UPDATE render_versions SET status = 'cancelled' WHERE id = ? AND production_id = ? AND status IN ('queued','processing')")
      .run(req.params.renderId, id);
    if (!r.changes) return fail(res, 409, 'NOT_CANCELLABLE', 'That render is not queued or processing');
    return ok(res, await renderState(id), 'Render cancelled');
  })
);

router.post(
  '/:id/render/:renderId/edit',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { kind, target, note } = req.body ?? {};
    if (!editorTools.includes(kind)) return fail(res, 400, 'BAD_TOOL', 'Unknown edit tool');

    const render = db
      .prepare('SELECT * FROM render_versions WHERE id = ? AND production_id = ?')
      .get(req.params.renderId, id);
    if (!render) return fail(res, 404, 'NOT_FOUND', 'Render not found');
    if (render.status !== 'complete')
      return fail(res, 409, 'RENDER_INCOMPLETE', 'Edits apply to a completed render');

    const supported = new Set(['Trim / Cut', 'Create Short Clip']);
    if (!supported.has(kind)) {
      return fail(res, 501, 'NOT_IMPLEMENTED', `${kind} is visible on the editor roadmap but is not built yet`);
    }
    const planned = planEdits([{ kind, target, note }]);
    if (!planned.applied.length) {
      return fail(res, 400, 'BAD_RANGE', 'Enter a valid time range such as 0:05-0:12; the end must be after the start');
    }

    // Non-destructive: the edit is recorded as a decision; the render is untouched.
    db.prepare('INSERT INTO edit_decisions (render_version_id, kind, target, note) VALUES (?,?,?,?)')
      .run(render.id, kind, String(target ?? '').slice(0, 200), String(note ?? '').slice(0, 500));

    const affected = markStaleFrom(id, 'render', `Edit applied: ${kind}`);
    return ok(res, { ...(await renderState(id)), affected }, `${kind} added to the edit decision list`);
  })
);

router.post(
  '/:id/export',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const render = db
      .prepare("SELECT * FROM render_versions WHERE production_id = ? AND status = 'complete' ORDER BY version DESC")
      .get(id);
    if (!render) return fail(res, 409, 'NO_RENDER', 'Complete a render before exporting');

    const version = (db.prepare('SELECT MAX(version) m FROM exports WHERE production_id = ?').get(id).m ?? 0) + 1;
    const prod = db.prepare('SELECT slug FROM productions WHERE id = ?').get(id);
    const decisions = db
      .prepare('SELECT * FROM edit_decisions WHERE render_version_id = ? ORDER BY id')
      .all(render.id);

    // An export is a FILE. This used to insert a row saying "ready" with nothing
    // on disk behind it, and publishing then uploaded that nothing.
    let built;
    try {
      built = await buildExport({ productionId: id, render, decisions, slug: prod?.slug, version });
    } catch (err) {
      db.prepare(
        'INSERT INTO exports (production_id, render_version_id, version, status, error) VALUES (?,?,?,?,?)'
      ).run(id, render.id, version, 'failed', err.message);
      return fail(res, err.code === 'NO_VIDEO' ? 409 : 502, err.code ?? 'EXPORT_FAILED', err.message);
    }

    db.prepare(
      `INSERT INTO exports
        (production_id, render_version_id, version, status, file_path, bytes, duration_seconds, edits_applied, note)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(id, render.id, version, 'ready', built.path, built.bytes,
          built.duration, built.editsApplied, built.note);
    clearStale('render_versions', render.id);

    const mb = (built.bytes / 1024 / 1024).toFixed(1);
    const skipped = built.editsSkipped.length;
    const affected = markStaleFrom(id, 'export', `Export v${version} created`);
    return ok(
      res,
      { ...(await renderState(id)), affected, export: built },
      `Export v${version}: ${mb}MB on disk`
        + (built.editsApplied ? `, ${built.editsApplied} edit${built.editsApplied === 1 ? '' : 's'} applied` : '')
        + (skipped ? `, ${skipped} edit${skipped === 1 ? '' : 's'} could not be applied` : '')
        + (built.note ? ` — ${built.note}` : '')
    );
  })
);

// --------------------------------------------------------------- Publish ---
router.get(
  '/:id/publications',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const rows = db.prepare('SELECT * FROM publications WHERE production_id = ?').all(id);
    const realConnections = { artificialFunny: await artificialFunny.isConnected() };
    // Only an export with a file can be published: a finished render files a
    // placeholder export row before its file is built.
    const latestExport = db
      .prepare('SELECT * FROM exports WHERE production_id = ? AND file_path IS NOT NULL ORDER BY version DESC')
      .get(id);

    // A video finished elsewhere (HeyGen, CapCut) has a file but no in-app export.
    const { existsSync } = await import('node:fs');
    const hasFile = db.prepare('SELECT local_path FROM assets WHERE production_id = ? AND local_path IS NOT NULL').all(id).some((r) => existsSync(r.local_path));
    return ok(res, {
      hasExport: !!latestExport || hasFile,
      targets: publishChannels.map((channel) => {
        const platform = channel.platform;
        const row = rows.find((r) => r.platform === platform);
        return {
          platform,
          kind: channel.kind,
          domain: channel.domain ?? null,
          detail: channel.detail,
          // For a platform this build can actually reach, "connected" means a
          // key that works — not a row in a seeded table. The card used to say
          // Connected next to a Publish button that could only ever refuse.
          connected: channel.platform === artificialFunny.PLATFORM && realConnections.artificialFunny,
          canReallyPublish: channel.platform === artificialFunny.PLATFORM,
          availableModes: channel.platform === artificialFunny.PLATFORM && realConnections.artificialFunny
            ? ['prepare', 'schedule', 'publish']
            : ['prepare'],
          mode: channel.platform === artificialFunny.PLATFORM && realConnections.artificialFunny
            ? (row?.mode ?? 'prepare')
            : 'prepare',
          status: row?.status ?? 'not_prepared',
          stale: !!row?.stale,
          staleReason: row?.stale_reason ?? null,
          preparedAt: row?.prepared_at ?? null,
          postId: row?.post_id ?? null,
          postUrl: row?.post_url ?? null,
          postedByHand: !!row?.by_hand && row?.status === 'published',
          postedAt: row?.by_hand ? row?.prepared_at : null,
          error: row?.error ?? null,
          // A "published" row with nothing to link to was written before this
          // build uploaded anything. The row is a record and is kept; what is
          // corrected is the impression it gives.
          verified: !!row?.post_id,
        };
      }),
    });
  })
);

/**
 * The files to post: the finished video and any other shapes exported with it
 * (9:16 for Shorts, Reels and TikTok; 1:1), newest first, each downloadable.
 */
router.get('/:id/post-files', route(async (req, res) => {
  const { existsSync, statSync } = await import('node:fs');
  const id = Number(req.params.id);
  const rows = getDb().prepare(
    `SELECT id, name, local_path, duration, created_at FROM assets
      WHERE production_id = ? AND local_path IS NOT NULL ORDER BY id DESC`
  ).all(id).filter((r) => existsSync(r.local_path));
  // The shape is measured from the file, not guessed from its name: a HeyGen
  // render called "…Approved v1" can be vertical.
  const { execFile } = await import('node:child_process');
  const probe = (file) => new Promise((done) => execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { timeout: 8000 }, (err, out) => { const [w, h] = String(out ?? '').trim().split(',').map(Number); done(err || !w || !h ? null : { w, h }); }));
  const shapeOf = (d, name) => {
    if (!d) return /9x16/.test(name) ? '9:16' : /1x1/.test(name) ? '1:1' : '16:9';
    const r = d.w / d.h;
    return r < 0.8 ? '9:16' : r < 1.25 ? '1:1' : '16:9';
  };
  const seen = new Set();
  const files = [];
  for (const r of rows) {
    const shape = shapeOf(await probe(r.local_path), r.name);
    if (seen.has(shape)) continue;
    seen.add(shape);
    files.push({ id: r.id, name: r.name, shape, bytes: statSync(r.local_path).size, duration: r.duration ?? null, url: `/api/library/${r.id}/file?download=1` });
  }
  return ok(res, { files });
}));

/** You posted it yourself: record where, so the calendar and Today know it is live. */
router.post('/:id/publications/:platform/posted', route(async (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { platform } = req.params;
  if (!publishTargets.includes(platform)) return fail(res, 404, 'NOT_FOUND', 'Unknown platform');
  if (req.body?.undo === true) {
    db.prepare('DELETE FROM publications WHERE production_id = ? AND platform = ? AND by_hand = 1').run(id, platform);
    return ok(res, { platform, posted: false }, `${platform}: not posted`);
  }
  const raw = String(req.body?.url ?? '').trim();
  let url = null;
  if (raw) {
    try { const u = new URL(raw); if (!/^https?:$/.test(u.protocol)) throw new Error(); url = u.toString(); }
    catch { return fail(res, 400, 'BAD_URL', 'That does not look like a link — paste the post’s address, or leave it empty.'); }
  }
  const latestExport = db.prepare('SELECT id FROM exports WHERE production_id = ? AND file_path IS NOT NULL ORDER BY version DESC').get(id);
  db.prepare(
    `INSERT INTO publications (production_id, export_id, platform, mode, status, prepared_at, post_id, post_url, error, by_hand)
     VALUES (?,?,?,'publish','published',datetime('now'),?,?,NULL,1)
     ON CONFLICT(production_id, platform) DO UPDATE SET
       export_id = excluded.export_id, mode = 'publish', by_hand = 1, status = 'published', stale = 0, stale_reason = NULL,
       prepared_at = excluded.prepared_at, post_id = excluded.post_id, post_url = excluded.post_url, error = NULL`
  ).run(id, latestExport?.id ?? null, platform, url ?? `posted-by-hand:${Date.now()}`, url);
  return ok(res, { platform, posted: true, url }, `Marked as posted on ${platform}`);
}));

router.post(
  '/:id/publications/:platform',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const { platform } = req.params;
    const mode = req.body?.mode ?? 'prepare';
    if (!publishTargets.includes(platform)) return fail(res, 404, 'NOT_FOUND', 'Unknown platform');
    if (!['prepare', 'schedule', 'publish'].includes(mode))
      return fail(res, 400, 'BAD_MODE', 'Mode must be prepare, schedule or publish');

    const latestExport = db
      .prepare('SELECT * FROM exports WHERE production_id = ? AND file_path IS NOT NULL ORDER BY version DESC')
      .get(id);
    if (!latestExport) return fail(res, 409, 'NO_EXPORT', 'Create an export before preparing a publication');

    // A platform this build can actually reach decides for itself whether it is
    // connected. The fixtures table only ever knew what it was seeded with.
    const canReallyPublish = platform === artificialFunny.PLATFORM;
    const connected = canReallyPublish && await artificialFunny.isConnected();

    // Publishing philosophy: an unavailable connection degrades to Prepare only,
    // it never blocks the export.
    let effectiveMode = mode;
    let message = `${platform}: ${mode}`;
    if (mode !== 'prepare' && (!canReallyPublish || !connected)) {
      effectiveMode = 'prepare';
      message = canReallyPublish
        ? `${platform} is not connected — prepared a package instead (never blocks export)`
        : `${platform} direct publishing is not built — prepared a package for manual upload`;
    }

    let postId = null;
    let postUrl = null;
    let error = null;

    // THE ACTUAL UPLOAD. Publishing used to write a row that said "published"
    // and reach nothing at all; the status was a claim about the world made
    // without consulting it.
    if (effectiveMode === 'publish' && canReallyPublish) {
      if (!latestExport.file_path) {
        return fail(res, 409, 'NO_FILE',
          'That export has no file on disk — re-export before publishing.');
      }
      const prod = db.prepare('SELECT title, subtitle FROM productions WHERE id = ?').get(id);
      try {
        const result = await artificialFunny.publish({
          file: latestExport.file_path,
          caption: [prod?.title, prod?.subtitle].filter(Boolean).join('\n'),
          hashtags: req.body?.hashtags ?? [],
        });
        postId = result.postId;
        postUrl = result.postUrl;
        message = `Published to ${platform} — ${postUrl ?? postId}`;
      } catch (err) {
        // A failed upload is not a publication. Record it as prepared with the
        // reason, rather than marking it published and leaving you to find out
        // by visiting the site.
        error = err.message;
        effectiveMode = 'prepare';
        db.prepare(
          `INSERT INTO publications (production_id, export_id, platform, mode, status, error, prepared_at)
           VALUES (?,?,?,?,?,?,datetime('now'))
           ON CONFLICT(production_id, platform) DO UPDATE SET
             export_id = excluded.export_id, mode = excluded.mode, status = excluded.status,
             error = excluded.error, prepared_at = excluded.prepared_at`
        ).run(id, latestExport.id, platform, 'prepare', 'prepared', error);
        return fail(res, err.code === 'NOT_CONNECTED' ? 409 : 502, err.code ?? 'PUBLISH_FAILED', err.message);
      }
    }

    const status = { prepare: 'prepared', schedule: 'scheduled', publish: 'published' }[effectiveMode];
    db.prepare(
      `INSERT INTO publications
         (production_id, export_id, platform, mode, status, stale, stale_reason, prepared_at, post_id, post_url, error)
       VALUES (?,?,?,?,?,0,NULL,datetime('now'),?,?,?)
       ON CONFLICT(production_id, platform) DO UPDATE SET
         export_id = excluded.export_id, mode = excluded.mode, status = excluded.status,
         stale = 0, stale_reason = NULL, prepared_at = excluded.prepared_at,
         post_id = excluded.post_id, post_url = excluded.post_url, error = excluded.error`
    ).run(id, latestExport.id, platform, effectiveMode, status, postId, postUrl, error);

    const rows = db.prepare('SELECT * FROM publications WHERE production_id = ?').all(id);
    return ok(res, { degraded: effectiveMode !== mode, publications: rows.length, postId, postUrl }, message);
  })
);

export default router;
