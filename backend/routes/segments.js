import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  segmentsFor, buildSegments, updateSegment, auditionSegment, markHeard, renderGate,
  speakers, auditionPending,
} from '../lib/segments.js';
import { renderViaStudio } from '../lib/providers/heygen-studio.js';
import { renderViaKey } from '../lib/providers/heygen-key-render.js';
import { chooseRenderPath } from '../lib/providers/heygen-route.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

/** Everything a segment view needs, assembled the same way for every route. */
const view = (id) => ({ segments: segmentsFor(id), gate: renderGate(id), speakers: speakers(id) });
const bad = (res, err, fallback = 400) =>
  fail(res, err.code === 'NOT_FOUND' ? 404 : err.code === 'NO_SCRIPT' ? 409 : fallback,
       err.code ?? 'ERROR', err.message);

router.get(
  '/:id/segments',
  route(async (req, res) => {
    const id = Number(req.params.id);
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
      const result = await auditionSegment(Number(req.params.segmentId), req.body ?? {});
      return ok(res, { ...result, ...view(id) },
        result.synthesised
          ? `Auditioned in ${result.voice.name}`
          : 'Take created, but nothing was synthesised in Fixtures mode — switch to Test to hear it');
    } catch (err) { return bad(res, err); }
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
    const { done, failedAt, error } = await auditionPending(id);
    const made = done.filter((d) => d.synthesised).length;

    if (error) {
      return fail(res, 502, 'AUDITION_FAILED',
        `Auditioned ${made} line${made === 1 ? '' : 's'}, then line ${failedAt} failed: ${error}`);
    }
    if (!done.length) {
      return ok(res, view(id), 'Nothing to audition — every line is cast and heard, or waiting on a presenter.');
    }
    return ok(res, view(id), made
      ? `Auditioned ${made} line${made === 1 ? '' : 's'} on your HeyGen plan. Listen to each before approving.`
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
    // The same confirmation the whole-production render demands. Without it
    // here, rendering the five lines one at a time was a way around the gate
    // that renders the same video and asks nothing.
    if (!path.free && req.body?.confirmPaid !== true) {
      return fail(res, 402, 'CONFIRMATION_REQUIRED',
        'This render is charged to your HeyGen plan. Confirm to continue.');
    }

    const version =
      (db.prepare('SELECT MAX(version) m FROM segment_renders WHERE segment_id = ?').get(segmentId).m ?? 0) + 1;

    const line = {
      speaker: seg.speaker, text: seg.text,
      avatarId: seg.presenter.avatar.remoteId,
      voiceId: seg.presenter.voice?.remoteId ?? null,
    };
    const resolution = seg.quality === 'final' ? '1080p' : '720p';
    const title = `${seg.speaker} — line ${seg.position + 1}`;

    try {
      const result = path.path === 'mcp'
        ? await renderViaStudio({ segments: [line], title, resolution })
        : await renderViaKey({ segments: [line], title, resolution, testMode: path.testMode });

      db.prepare(
        `INSERT INTO segment_renders (segment_id, take_id, version, provider, remote_id, status)
         VALUES (?,?,?,?,?,?)`
      ).run(segmentId, seg.take?.id ?? null, version,
            path.path === 'mcp' ? 'heygen_mcp' : 'heygen', result.video_id, 'queued');

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

export default router;
