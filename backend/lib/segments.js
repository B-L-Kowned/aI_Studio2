import { getDb } from '../db/index.js';
import { resolveSpeaker, presenterCasting } from './casting.js';
import * as mcp from './providers/heygen-mcp.js';
import { canReadLive } from './providers/mode.js';
import { LOCAL, speakLocal } from './local-voice.js';

// The segment is the unit of script, take, presenter, shot, quality and render.
//
// THE HARD GATE: nothing renders unheard. A take is an audition in the voice
// that will actually ship — auditioning in some other vendor's voice approves a
// sound the video never makes, which makes the approval meaningless. Editing the
// line makes its take stale and unheard again.

const now = () => new Date().toISOString();

function serializeTake(t) {
  return t && {
    id: t.id, version: t.version, text: t.text,
    audioUrl: t.audio_url, duration: t.duration,
    heard: !!t.heard, stale: !!t.stale, staleReason: t.stale_reason,
    createdAt: t.created_at,
  };
}

export function segmentsFor(productionId) {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM segments WHERE production_id = ? ORDER BY position')
    .all(productionId);

  return rows.map((s) => {
    const take = db
      .prepare('SELECT * FROM takes WHERE segment_id = ? ORDER BY version DESC LIMIT 1')
      .get(s.id);
    const render = db
      .prepare('SELECT * FROM segment_renders WHERE segment_id = ? ORDER BY version DESC LIMIT 1')
      .get(s.id);
    const presenter = s.presenter_id
      ? db.prepare('SELECT * FROM presenters WHERE id = ?').get(s.presenter_id)
      : null;
    const cast = presenter ? presenterCasting(presenter.id) : null;

    // A take approves the words it was made from. If the line moved on, the
    // approval did not move with it.
    const textMatches = take ? take.text === s.text : false;
    const heard = !!take?.heard && textMatches && !take.stale;

    return {
      id: s.id, position: s.position, speaker: s.speaker, text: s.text,
      quality: s.quality, shot: s.shot, sceneId: s.scene_id,
      presenter: presenter && {
        id: presenter.id, name: presenter.name, kind: presenter.kind,
        avatar: cast?.avatar ?? null, voice: cast?.voice ?? null,
      },
      take: serializeTake(take),
      textMatchesTake: textMatches,
      heard,
      // A stale take is as good as no take: the only way forward is a new one.
      // Reading this off blockedBy alone missed them — a stale take reports
      // 'unheard', so a batch audition skipped exactly the lines that needed it.
      needsAudition: !take || !!take.stale || !textMatches,
      render: render && {
        id: render.id, version: render.version, status: render.status,
        progress: render.progress, videoUrl: render.video_url,
        stale: !!render.stale, staleReason: render.stale_reason, error: render.error,
      },
      // Why this segment cannot render, in the order a person would fix it.
      blockedBy: !presenter ? 'presenter'
        : !cast?.avatar ? 'avatar'
        : !take ? 'audition'
        : !heard ? 'unheard'
        : null,
    };
  });
}

/**
 * Build segments from the accepted script. Idempotent: re-running after a script
 * change updates text in place and invalidates only the takes whose words moved,
 * rather than discarding approvals that are still valid.
 */
export function buildSegments(productionId) {
  const db = getDb();
  const accepted = db
    .prepare("SELECT * FROM script_versions WHERE production_id = ? AND status = 'accepted' ORDER BY version DESC")
    .get(productionId);
  if (!accepted) {
    throw Object.assign(new Error('Accept a script version before building segments'), { code: 'NO_SCRIPT' });
  }

  const lines = db
    .prepare('SELECT * FROM script_segments WHERE script_version_id = ? ORDER BY position')
    .all(accepted.id);

  const existing = db
    .prepare('SELECT * FROM segments WHERE production_id = ? ORDER BY position')
    .all(productionId);

  let created = 0, updated = 0, invalidated = 0;

  db.transaction(() => {
    lines.forEach((line, i) => {
      const presenter = resolveSpeaker(line.speaker);
      const prev = existing[i];

      if (!prev) {
        db.prepare(
          `INSERT INTO segments (production_id, scene_id, position, speaker, presenter_id, text)
           VALUES (?,?,?,?,?,?)`
        ).run(productionId, line.scene_id, i, line.speaker, presenter?.id ?? null, line.text);
        created++;
        return;
      }

      if (prev.text !== line.text || prev.speaker !== line.speaker) {
        db.prepare(
          `UPDATE segments SET text = ?, speaker = ?, presenter_id = ?, scene_id = ?,
           updated_at = datetime('now') WHERE id = ?`
        ).run(line.text, line.speaker, presenter?.id ?? prev.presenter_id, line.scene_id, prev.id);
        // The words changed, so the approval of the old words no longer applies.
        invalidated += invalidateTakes(prev.id, 'The line changed after this take was approved');
        updated++;
      } else if (!prev.presenter_id && presenter) {
        db.prepare('UPDATE segments SET presenter_id = ? WHERE id = ?').run(presenter.id, prev.id);
        updated++;
      }
    });

    // Lines removed from the script take their segments with them.
    for (const extra of existing.slice(lines.length)) {
      db.prepare('DELETE FROM segments WHERE id = ?').run(extra.id);
    }
  })();

  return { created, updated, invalidated, total: lines.length };
}

/** Mark takes stale and unheard. Rows are kept — the audio is still evidence. */
export function invalidateTakes(segmentId, reason) {
  const res = getDb()
    .prepare('UPDATE takes SET stale = 1, heard = 0, stale_reason = ? WHERE segment_id = ? AND stale = 0')
    .run(reason, segmentId);
  getDb()
    .prepare('UPDATE segment_renders SET stale = 1, stale_reason = ? WHERE segment_id = ? AND stale = 0')
    .run(reason, segmentId);
  return res.changes;
}

// One edit is one change: a half-applied speaker recast (some lines moved, the
// rest not) is worse than either outcome, so the whole update is a transaction.
export function updateSegment(segmentId, changes) {
  return getDb().transaction(() => applySegmentUpdate(segmentId, changes))();
}

function applySegmentUpdate(segmentId, { text, presenterId, quality, shot, applyToSpeaker }) {
  const db = getDb();
  const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
  if (!seg) throw Object.assign(new Error('Segment not found'), { code: 'NOT_FOUND' });

  let invalidated = 0;

  // Casting is a decision about a SPEAKER, not about a line. A script where
  // every line says "Narrator" otherwise needs the same choice made once per
  // line, and the one that gets missed is the one that blocks the render.
  if (applyToSpeaker && presenterId !== undefined) {
    const peers = db
      .prepare('SELECT id FROM segments WHERE production_id = ? AND speaker = ? AND id != ?')
      .all(seg.production_id, seg.speaker, segmentId);
    for (const peer of peers) {
      db.prepare('UPDATE segments SET presenter_id = ? WHERE id = ?').run(presenterId, peer.id);
      invalidated += invalidateTakes(peer.id, 'The presenter changed after this take was approved');
    }
  }
  if (text !== undefined && text !== seg.text) {
    db.prepare("UPDATE segments SET text = ?, updated_at = datetime('now') WHERE id = ?").run(text, segmentId);
    invalidated += invalidateTakes(segmentId, 'The line was edited after this take was approved');
  }
  if (presenterId !== undefined) {
    db.prepare('UPDATE segments SET presenter_id = ? WHERE id = ?').run(presenterId, segmentId);
    // A different performer is a different sound, so the audition no longer stands.
    invalidated += invalidateTakes(segmentId, 'The presenter changed after this take was approved');
  }
  if (quality !== undefined) {
    if (!['draft', 'final'].includes(quality)) {
      throw Object.assign(new Error('Quality must be draft or final'), { code: 'BAD_QUALITY' });
    }
    db.prepare('UPDATE segments SET quality = ? WHERE id = ?').run(quality, segmentId);
  }
  if (shot !== undefined) {
    db.prepare('UPDATE segments SET shot = ? WHERE id = ?').run(String(shot).slice(0, 40), segmentId);
  }
  return { invalidated };
}

/**
 * Will an audition right now be real speech on the connected plan? True in Test
 * as well as Live — there is no free audition anywhere.
 */
export const auditionSpends = () => canReadLive() && mcp.isConnected();

const confirmationRequired = (message) =>
  Object.assign(new Error(message), { code: 'CONFIRMATION_REQUIRED' });

/**
 * The voice gate: audio-only synthesis in the voice that will actually render.
 * Costs credits on the connected plan — it is a real synthesis, which is the
 * point: a stand-in voice approves a sound the video never makes. Refused
 * without `confirmPaid` whenever it would spend, so no caller can charge the
 * plan by forgetting to ask.
 */
export async function auditionSegment(segmentId, { speed = 1.0, ssml = false, confirmPaid = false } = {}) {
  const db = getDb();
  const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
  if (!seg) throw Object.assign(new Error('Segment not found'), { code: 'NOT_FOUND' });
  if (!String(seg.text).trim()) {
    throw Object.assign(new Error('Nothing to say — the line is empty.'), { code: 'EMPTY' });
  }
  // A placeholder for a fact someone still has to check must never be spoken.
  if (/\[CONFIRM/i.test(seg.text)) {
    throw Object.assign(new Error('This line still has a [CONFIRM: …] placeholder — resolve it before auditioning.'), { code: 'UNCONFIRMED' });
  }

  const presenter = seg.presenter_id
    ? db.prepare('SELECT * FROM presenters WHERE id = ?').get(seg.presenter_id)
    : null;
  if (!presenter) {
    throw Object.assign(new Error(`No presenter cast for "${seg.speaker}"`), { code: 'NO_PRESENTER' });
  }
  const cast = presenterCasting(presenter.id);
  if (!cast?.voice) {
    throw Object.assign(
      new Error(`${presenter.name} has no voice assigned — an audition must use the voice that will ship.`),
      { code: 'NO_VOICE' }
    );
  }

  const version =
    (db.prepare('SELECT MAX(version) m FROM takes WHERE segment_id = ?').get(segmentId).m ?? 0) + 1;

  // Your local voice: synthesised on this machine, free in every mode, and the
  // file it writes is the audio the video will use.
  if (cast.voice.provider === LOCAL) {
    const out = `takes/${seg.production_id}/${segmentId}-v${version}.wav`;
    const speed = db.prepare('SELECT voice_speed FROM productions WHERE id = ?').get(seg.production_id)?.voice_speed ?? undefined;
    const spoken = await speakLocal(cast.voice.id, seg.text, out, { speed });
    const id = db
      .prepare(
        `INSERT INTO takes (segment_id, version, text, voice_asset_id, audio_url, duration, local_path)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(segmentId, version, seg.text, cast.voice.id, null, spoken.duration, out).lastInsertRowid;
    db.prepare('UPDATE takes SET audio_url = ? WHERE id = ?').run(`/api/takes/${id}/audio`, id);
    return {
      take: serializeTake(db.prepare('SELECT * FROM takes WHERE id = ?').get(id)),
      synthesised: true,
      local: true,
      voice: cast.voice,
    };
  }

  let audioUrl = null;
  let duration = null;

  if (auditionSpends()) {
    if (confirmPaid !== true) {
      throw confirmationRequired('This audition is real speech charged to your HeyGen plan. Confirm to continue.');
    }
    const res = await mcp.synthesize(seg.text, cast.voice.remoteId, { speed, ssml });
    audioUrl = res?.audio_url ?? res?.url ?? res?.data?.audio_url ?? null;
    duration = res?.duration ?? null;
  }
  // In Fixtures nothing is synthesised, so the take exists but cannot be marked
  // heard — the gate stays closed rather than being waved through.

  const id = db
    .prepare(
      `INSERT INTO takes (segment_id, version, text, voice_asset_id, audio_url, duration)
       VALUES (?,?,?,?,?,?)`
    )
    .run(segmentId, version, seg.text, cast.voice.id, audioUrl, duration).lastInsertRowid;

  return {
    take: serializeTake(db.prepare('SELECT * FROM takes WHERE id = ?').get(id)),
    synthesised: !!audioUrl,
    voice: cast.voice,
  };
}

/** Only a real, current audition may be marked heard. */
export function markHeard(takeId, heard = true) {
  const db = getDb();
  const take = db.prepare('SELECT * FROM takes WHERE id = ?').get(takeId);
  if (!take) throw Object.assign(new Error('Take not found'), { code: 'NOT_FOUND' });

  if (heard) {
    if (!take.audio_url) {
      throw Object.assign(
        new Error('There is no audio to hear. Audition it in Test or Live mode first.'),
        { code: 'NO_AUDIO' }
      );
    }
    if (take.stale) {
      throw Object.assign(
        new Error('This take is stale — the line or presenter changed. Audition again.'),
        { code: 'STALE' }
      );
    }
  }
  db.prepare('UPDATE takes SET heard = ? WHERE id = ?').run(heard ? 1 : 0, takeId);
  return serializeTake(db.prepare('SELECT * FROM takes WHERE id = ?').get(takeId));
}

/**
 * Can this production render? Every segment must be cast and heard. Pass the
 * segments when you already have them — each one costs several queries.
 */
export function renderGate(productionId, segs = segmentsFor(productionId)) {
  const blocked = segs.filter((s) => s.blockedBy);
  return {
    total: segs.length,
    ready: segs.length > 0 && blocked.length === 0,
    heard: segs.filter((s) => s.heard).length,
    blocked: blocked.map((s) => ({
      id: s.id, position: s.position, speaker: s.speaker,
      text: s.text.slice(0, 60), reason: s.blockedBy,
    })),
  };
}

/** Every distinct speaker in the script, with who is currently cast as them. */
export function speakers(productionId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT speaker, COUNT(*) AS lines, MIN(id) AS firstSegmentId,
              COUNT(DISTINCT COALESCE(presenter_id, 0)) AS distinctCasting,
              MAX(presenter_id) AS presenterId
       FROM segments WHERE production_id = ?
       GROUP BY speaker ORDER BY MIN(position)`
    )
    .all(productionId);

  return rows.map((r) => {
    const presenter = r.presenterId
      ? db.prepare('SELECT * FROM presenters WHERE id = ?').get(r.presenterId)
      : null;
    const cast = presenter ? presenterCasting(presenter.id) : null;
    return {
      speaker: r.speaker,
      lines: r.lines,
      firstSegmentId: r.firstSegmentId,
      // More than one answer for one speaker is worth saying out loud rather
      // than picking one and hiding the disagreement.
      mixed: r.distinctCasting > 1,
      presenter: presenter && {
        id: presenter.id, name: presenter.name,
        avatar: cast?.avatar ?? null, voice: cast?.voice ?? null,
      },
    };
  });
}

/**
 * Audition every line that is waiting only on a take.
 *
 * Real synthesis on the connected plan, so it refuses without confirmation and
 * stops at the first failure rather than burning credits on a misconfiguration
 * N more times. `limit` is the number of lines the user was shown when they
 * confirmed: lines that became pending since then are not charged on that yes.
 */
export async function auditionPending(productionId, { confirmPaid = false, limit = null } = {}) {
  // Cast and in need of a take — including the ones holding a stale one.
  const pending = segmentsFor(productionId)
    .filter((s) => s.needsAudition && s.presenter?.voice
      && (s.presenter.avatar || s.presenter.voice.provider === LOCAL));
  // Local-voice lines cost nothing; only HeyGen lines need a yes.
  const spends = auditionSpends() && pending.some((s) => s.presenter.voice.provider !== LOCAL);
  if (spends && confirmPaid !== true) {
    throw Object.assign(
      confirmationRequired(
        `Auditioning ${pending.length} line${pending.length === 1 ? '' : 's'} is real speech charged to your HeyGen plan. Confirm to continue.`
      ),
      { pending: pending.length }
    );
  }
  const batch = spends && Number.isInteger(limit) && limit >= 0 ? pending.slice(0, limit) : pending;
  const done = [];
  for (const seg of batch) {
    try {
      const r = await auditionSegment(seg.id, { confirmPaid });
      done.push({ id: seg.id, position: seg.position, synthesised: r.synthesised, local: !!r.local });
      if (!r.synthesised) break; // Fixtures: the rest would be the same no-op.
    } catch (err) {
      return { done, failedAt: seg.position + 1, error: err.message };
    }
  }
  return { done, failedAt: null, error: null };
}
