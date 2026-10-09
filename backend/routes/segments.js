import { Router } from 'express';
import { getDb } from '../db/index.js';
import { approvedLook } from '../lib/appearance.js';
import {
  segmentsFor, buildSegments, updateSegment, auditionSegment, markHeard, renderGate,
  speakers, auditionPending, auditionSpends,
} from '../lib/segments.js';
import { pollSegmentRenders } from '../lib/providers/index.js';
import { renderViaStudio } from '../lib/providers/heygen-studio.js';
import { renderViaKey } from '../lib/providers/heygen-key-render.js';
import { chooseRenderPath } from '../lib/providers/heygen-route.js';
import { ok, fail, route } from '../utils/respond.js';
import { readThrough } from '../lib/readthrough.js';
import { costOf, budgetRefusal, budgetApplies } from '../lib/budget.js';
import { usable } from '../lib/grants.js';
import { createReadStream, existsSync } from 'node:fs';

const router = Router();

/** Everything a segment view needs, assembled the same way for every route. */
// `auditionSpends` is said up front so the page can ask before the click, not
// learn from a 402 after it.
const view = (id) => {
  const segments = segmentsFor(id);
  // Lines cast with your local voice cost nothing, so the page only asks when
  // a line still waiting on a take would go to HeyGen.
  const spends = auditionSpends()
    && segments.some((s) => s.needsAudition && s.presenter?.voice && s.presenter.voice.provider !== 'local');
  return { segments, gate: renderGate(id, segments), speakers: speakers(id), auditionSpends: spends };
};
// Known refusals by code; anything else from an audition is the provider failing.
const STATUS = {
  NOT_FOUND: 404, NO_SCRIPT: 409, CONFIRMATION_REQUIRED: 402, BUDGET_NOT_SET: 402, BUDGET_CAP: 402, GRANT_ENDED: 409,
  EMPTY: 400, NO_PRESENTER: 409, NO_VOICE: 409, NO_AUDIO: 409, STALE: 409,
  TOO_LONG: 400, VOICE_OFFLINE: 503, VOICE_FAILED: 502, UNCONFIRMED: 409,
};
const bad = (res, err, fallback = 400) =>
  fail(res, STATUS[err.code] ?? fallback, err.code ?? 'ERROR', err.message);

router.get(
  '/:id/segments',
  route(async (req, res) => {
    const id = Number(req.params.id);
    await pollSegmentRenders(id);
    return ok(res, view(id));
  })
);

router.post(
  '/:id/segments/build',
  route(async (req, res) => {
    const id = Number(req.params.id);
    try {
      const result = buildSegments(id);
      return ok(res, { ...result, ...view(id) },
        `${result.created} created, ${result.updated} updated` +
        (result.invalidated ? `, ${result.invalidated} takes invalidated` : ''));
    } catch (err) { return bad(res, err); }
  })
);

router.patch(
  '/:id/segments/:segmentId',
  route(async (req, res) => {
    const id = Number(req.params.id);
    try {
      const { invalidated } = updateSegment(Number(req.params.segmentId), req.body ?? {});
      return ok(res, { ...view(id), invalidated },
        invalidated ? 'Updated — the take no longer matches, so it must be heard again' : 'Updated');
    } catch (err) { return bad(res, err); }
  })
);

/** The voice gate. Real synthesis in the voice that will ship; costs credits. */
router.post(
  '/:id/segments/:segmentId/audition',
  route(async (req, res) => {
    const id = Number(req.params.id);
    try {
      const { speed, ssml, confirmPaid } = req.body ?? {};
      const result = await auditionSegment(Number(req.params.segmentId), { speed, ssml, confirmPaid });
      return ok(res, { ...result, ...view(id) },
        result.local
          ? `Auditioned in ${result.voice.name} — on this Mac, nothing spent`
          : result.synthesised
          ? `Auditioned in ${result.voice.name}`
          : 'Take created, but nothing was synthesised in Fixtures mode — switch to Test to hear it');
    } catch (err) { return bad(res, err, 502); }
  })
);

router.post(
  '/:id/segments/:segmentId/heard',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const takeId = Number(req.body?.takeId);
    if (!takeId) return fail(res, 400, 'NO_TAKE', 'takeId is required');
    try {
      const take = markHeard(takeId, req.body?.heard !== false);
      return ok(res, { take, ...view(id) },
        take.heard ? 'Approved' : 'Approval withdrawn');
    } catch (err) { return bad(res, err, 409); }
  })
);

/**
 * Audition every line that is only waiting on a take. Real speech on the
 * connected plan, so the message says what happened rather than just "done".
 */
router.post(
  '/:id/segments/audition-all',
  route(async (req, res) => {
    const id = Number(req.params.id);
    let result;
    try {
      result = await auditionPending(id, {
        confirmPaid: req.body?.confirmPaid,
        limit: req.body?.limit == null ? null : Number(req.body.limit),
      });
    } catch (err) { return bad(res, err); }
    const { done, failedAt, error } = result;
    const made = done.filter((d) => d.synthesised).length;
    const local = done.filter((d) => d.local).length;

    if (error) {
      return fail(res, 502, 'AUDITION_FAILED',
        `Auditioned ${made} line${made === 1 ? '' : 's'}, then line ${failedAt} failed: ${error}`);
    }
    if (!done.length) {
      return ok(res, view(id), 'Nothing to audition — every line is cast and heard, or waiting on a presenter.');
    }
    return ok(res, view(id), made
      ? `Auditioned ${made} line${made === 1 ? '' : 's'}` +
        (local === made ? ' in your local voice — nothing spent.' : local ? ` (${local} local, ${made - local} on your HeyGen plan).` : ' on your HeyGen plan.') +
        ' Listen to each before approving.'
      : 'Nothing was synthesised in Fixtures mode — switch to Test to hear these.');
  })
);

/**
 * Render ONE segment. Re-render a line, not the video — and only if that line
 * has been heard.
 */
router.post(
  '/:id/segments/:segmentId/render',
  route(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const segmentId = Number(req.params.segmentId);

    const seg = segmentsFor(id).find((s) => s.id === segmentId);
    if (!seg) return fail(res, 404, 'NOT_FOUND', 'Segment not found');
    // Permission comes before readiness: an ended share is the answer even
    // when something else about the line is not ready yet.
    const share = usable(seg.presenter?.id);
    if (!share.ok) return fail(res, 409, 'GRANT_ENDED', share.reason);
    if (seg.blockedBy) {
      return fail(res, 409, 'GATE_' + seg.blockedBy.toUpperCase(),
        {
          presenter: `No presenter cast for "${seg.speaker}".`,
          avatar: `${seg.presenter?.name} has no avatar assigned.`,
          audition: 'This line has never been auditioned. Nothing renders unheard.',
          unheard: 'This take has not been approved. Nothing renders unheard.',
        }[seg.blockedBy]);
    }

    // The mode decides what a render may cost, and the router decides which
    // pocket can honour it. A segment render that ignored either would bill the
    // plan while Test mode promised it would not.
    const path = await chooseRenderPath();
    if (path.path === 'none') {
      return fail(res, 409, path.warning ?? 'NO_PATH', path.reason);
    }
    if (path.path !== 'fixtures' && seg.presenter.voice?.provider === 'local') {
      return fail(res, 409, 'LOCAL_VOICE_RENDER',
        'This line uses your local voice. Render the whole video from Render — it lip-syncs the avatar to your approved audio, and each line\'s clip is cut from it in Edit → Editor kit. Nothing was sent.');
    }
    // The same confirmation the whole-production render demands. Without it
    // here, rendering the five lines one at a time was a way around the gate
    // that renders the same video and asks nothing.
    if (!path.free && req.body?.confirmPaid !== true) {
      return fail(res, 402, 'CONFIRMATION_REQUIRED',
        'This render is charged to your HeyGen plan. Confirm to continue.');
    }

    const lineCost = budgetApplies(path) ? costOf(Math.max(1, seg.text.split(/\s+/).length) / 140) : 0;
    const overBudget = budgetApplies(path) ? budgetRefusal(lineCost) : null;
    if (overBudget) return fail(res, 402, overBudget.code, overBudget.message);

    const version =
      (db.prepare('SELECT MAX(version) m FROM segment_renders WHERE segment_id = ?').get(segmentId).m ?? 0) + 1;

    // The look approved for this video, not the presenter's default avatar.
    const look = approvedLook(id, seg.presenter.id);
    const line = {
      speaker: seg.speaker, text: seg.text,
      avatarId: look?.remoteId ?? seg.presenter.avatar.remoteId,
      voiceId: seg.presenter.voice?.remoteId ?? null,
      ...(look ? { background: look.background } : {}),
    };
    const resolution = seg.quality === 'final' ? '1080p' : '720p';
    const title = `${seg.speaker} — line ${seg.position + 1}`;

    try {
      const result = path.path === 'mcp'
        ? await renderViaStudio({ segments: [line], title, resolution, ...(look ? { aspectRatio: look.aspect } : {}) })
        : await renderViaKey({ segments: [line], title, resolution, testMode: path.testMode });

      db.prepare(
        `INSERT INTO segment_renders (segment_id, take_id, version, provider, remote_id, status, cost_estimate)
         VALUES (?,?,?,?,?,?,?)`
      ).run(segmentId, seg.take?.id ?? null, version,
            path.path === 'mcp' ? 'heygen_mcp' : 'heygen', result.video_id, 'queued', lineCost);

      return ok(res, view(id),
        `Segment ${seg.position + 1} queued at ${resolution}` +
        (path.testMode ? ' — watermarked test render, no credits spent' : ' on your HeyGen plan'));
    } catch (err) {
      db.prepare(
        `INSERT INTO segment_renders (segment_id, take_id, version, provider, status, error)
         VALUES (?,?,?,?,?,?)`
      ).run(segmentId, seg.take?.id ?? null, version,
            path.path === 'mcp' ? 'heygen_mcp' : 'heygen', 'failed', err.message);
      return fail(res, 502, err.code ?? 'RENDER_FAILED', err.message);
    }
  })
);

/**
 * Read the script aloud locally. Free, offline, and NOT the shipping voice —
 * it answers "are these the right words", which is the question you ask before
 * spending anything. It does not create a take and cannot open the render
 * gate; only a real audition does that.
 */
router.post(
  '/:id/readthrough',
  route(async (req, res) => {
    try {
      const r = await readThrough(Number(req.params.id), {
        voice: req.body?.voice || undefined,
        rate: Number(req.body?.rate) || undefined,
      });
      const mins = Math.floor(r.spokenSeconds / 60);
      const secs = String(r.spokenSeconds % 60).padStart(2, '0');
      return ok(res, r, `Read ${r.lines.filter((l) => !l.empty).length} lines — ${mins}:${secs} spoken, nothing spent`);
    } catch (err) {
      return fail(res, err.code === 'NOT_FOUND' ? 404 : 400, err.code ?? 'ERROR', err.message);
    }
  })
);

router.get(
  '/:id/readthrough/audio',
  route(async (req, res) => {
    const { join, dirname } = await import('node:path');
    const { defaultDbPath } = await import('../db/index.js');
    const file = join(dirname(defaultDbPath()), 'readthrough', String(Number(req.params.id)), 'readthrough.m4a');
    if (!existsSync(file)) return fail(res, 404, 'NOT_FOUND', 'No read-through yet for this production');
    res.type('audio/mp4');
    return createReadStream(file).pipe(res);
  })
);

export default router;
