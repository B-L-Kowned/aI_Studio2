import { previewSrc, cacheOwnedPreviews } from '../preview-cache.js';
import * as heygen from './heygen.js';
import { approvedLook } from '../appearance.js';
import * as mcp from './heygen-mcp.js';
import { getDb } from '../../db/index.js';
import { isDryRun, canGenerateLive } from './mode.js';
import { castingReadiness } from '../casting.js';
import { chooseRenderPath } from './heygen-route.js';
import { renderViaStudio, buildStudioArgs } from './heygen-studio.js';
import { uploadAudio } from './heygen-audio.js';
import { approvedLines, audioRuns } from '../approved-audio.js';

// Capability router. The UI asks for a capability; this decides who fulfils it.
// PM_SPEC: "Frontend should request capabilities, not providers."
const PROVIDERS = { heygen };

const ROUTING = {
  generate_scene: 'heygen',
  draft_avatar: 'heygen',
  draft_voice: 'heygen',
  render: 'heygen',
};

export function routeCapability(capability, preferred = 'auto') {
  if (preferred !== 'auto') {
    if (!PROVIDERS[preferred]) throw new Error(`Unknown provider: ${preferred}`);
    return PROVIDERS[preferred];
  }
  const id = ROUTING[capability];
  if (!id) throw new Error(`No provider routes capability: ${capability}`);
  return PROVIDERS[id];
}

export function getProvider(id) {
  return PROVIDERS[id] ?? null;
}

export function listProviders() {
  const db = getDb();
  return Object.values(PROVIDERS).map((p) => {
    const row = db.prepare('SELECT * FROM provider_accounts WHERE provider = ?').get(p.meta.id);
    const counts = db
      .prepare('SELECT kind, COUNT(*) n FROM provider_assets WHERE provider = ? GROUP BY kind')
      .all(p.meta.id);
    return {
      id: p.meta.id,
      label: p.meta.label,
      capabilities: p.meta.capabilities,
      status: row?.status ?? 'disconnected',
      hint: row?.hint ?? null,
      quotaRemaining: row?.quota_remaining ?? null,
      lastSyncAt: row?.last_sync_at ?? null,
      lastError: row?.last_error ?? null,
      assets: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
      endpointsVerified: Object.values(p.meta.endpoints).every((e) => e.verified),
    };
  });
}

/**
 * PULL: mirror the provider's avatars, voices and templates into local tables,
 * plus remaining quota. Upserts, so it is safe to run repeatedly.
 */
export async function syncProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  const db = getDb();

  const upsert = db.prepare(
    `INSERT INTO provider_assets (provider, kind, remote_id, name, preview_url, language, gender, raw, owned, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(provider, kind, remote_id) DO UPDATE SET
       name = excluded.name, preview_url = excluded.preview_url,
       language = excluded.language, gender = excluded.gender,
       raw = excluded.raw, owned = excluded.owned, synced_at = excluded.synced_at`
  );

  const pulled = {};
  try {
    // Signed in over MCP? Then the catalogue is the user's OWN account, not
    // whatever an API key can see. Syncing through the key client while signed
    // in over MCP returned "not connected" and left the samples in place.
    const viaMcp = id === 'heygen' && mcp.isConnected();

    // YOURS, not the world's. Syncing HeyGen's whole public catalogue pulled
    // 9,967 looks in eight minutes and produced a dropdown of ten thousand
    // strangers; the 25 avatars this account owns are the ones a roster is
    // actually cast from, and several of them share a name with a persona.
    // Stock stays searchable on demand rather than mirrored.
    const sets = viaMcp
      ? [
          ['avatar', (await mcp.avatarLooks({ ownership: 'private' })).map((a) => ({ ...a, owned: true }))],
          ['voice', await mcp.voicesByOwnership()],
          // Over MCP this is a verified call. The key's /v2/templates never was.
          ['template', await mcp.templates().catch(() => [])],
        ]
      : [
          ['avatar', await provider.listAvatars()],
          ['voice', await provider.listVoices()],
          // Unverified endpoint (see heygen.js). Its failure used to abort the
          // whole sync, so avatars and voices were never stored either.
          ['template', await provider.listTemplates().catch(() => [])],
        ];

    db.transaction(() => {
      for (const [kind, rows] of sets) {
        for (const raw of rows) {
          const a = provider.normalizeAsset(kind, raw);
          if (!a.remote_id) continue;
          upsert.run(id, kind, a.remote_id, a.name, a.preview_url, a.language, a.gender,
                     JSON.stringify(raw), raw.owned ? 1 : 0);
        }
        pulled[kind] = rows.length;
      }
    })();

    if (viaMcp) {
      // Drop the stand-ins once real assets arrive, so nothing is castable to a
      // sample that does not exist in the account.
      db.prepare("DELETE FROM provider_assets WHERE provider = ? AND remote_id LIKE 'fx_%'").run(id);
    }

    const quota = viaMcp
      ? { remaining: mcp.creditsRemaining(await mcp.account()) }
      : await provider.remainingQuota();
    db.prepare(
      `INSERT INTO provider_accounts (provider, status, quota_remaining, quota_checked_at, last_sync_at, last_error)
       VALUES (?, 'connected', ?, datetime('now'), datetime('now'), NULL)
       ON CONFLICT(provider) DO UPDATE SET
         quota_remaining = excluded.quota_remaining, quota_checked_at = excluded.quota_checked_at,
         last_sync_at = excluded.last_sync_at, last_error = NULL`
    ).run(id, quota.remaining ?? null);

    // Keep the pictures while their signed links still work.
    cacheOwnedPreviews().catch(() => {});
    return { pulled, quota };
  } catch (err) {
    db.prepare(
      `INSERT INTO provider_accounts (provider, status, last_error)
       VALUES (?, 'disconnected', ?)
       ON CONFLICT(provider) DO UPDATE SET last_error = excluded.last_error`
    ).run(id, err.message);
    throw err;
  }
}

export function localAssets(providerId, kind) {
  const db = getDb();
  // Yours first. Sorting your own avatars alphabetically in among ten thousand
  // stock ones is the same as hiding them.
  const rows = kind
    ? db.prepare('SELECT * FROM provider_assets WHERE provider = ? AND kind = ? ORDER BY owned DESC, name')
        .all(providerId, kind)
    : db.prepare('SELECT * FROM provider_assets WHERE provider = ? ORDER BY kind, owned DESC, name')
        .all(providerId);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, remoteId: r.remote_id, name: r.name,
    previewUrl: previewSrc(r), language: r.language, gender: r.gender, syncedAt: r.synced_at,
    // Whether THIS account owns it. The column was being written and then
    // dropped here, so every caller saw a catalogue with no sense of mine
    // versus HeyGen's — which is the only distinction that matters in a picker.
    owned: !!r.owned,
    // Stand-ins carry the fx_ prefix. Surfacing this is not cosmetic: a sample
    // called "Pat (Studio)" is indistinguishable from a real avatar otherwise,
    // and the whole point of the catalogue is to show what YOUR account holds.
    isFixture: String(r.remote_id).startsWith('fx_'),
  }));
}

/** PUSH: hand a render to the routed provider and record the job locally. */
export async function pushRenderJob({ productionId, renderVersionId, segments, title, audioFile }) {
  const db = getDb();
  const provider = routeCapability('render');
  const id = provider.meta.id;

  const firstOf = (kind) =>
    db.prepare('SELECT * FROM provider_assets WHERE provider = ? AND kind = ? ORDER BY id LIMIT 1')
      .get(id, kind);

  if (!firstOf('avatar') || !firstOf('voice')) {
    // Fixtures needs no credential, so pull the stand-in catalogue rather than
    // blocking. A real run genuinely cannot proceed without one.
    if (!canGenerateLive()) {
      await syncProvider(id);
    } else {
      throw Object.assign(
        new Error(`Sync ${provider.meta.label} before rendering — no avatar or voice available`),
        { code: 'NOT_SYNCED' }
      );
    }
  }

  // Who performs each line. Anything uncast falls back to the first asset, and
  // the caller is told which speakers that happened for — a silent substitution
  // is how a two-hander comes back read entirely by one avatar.
  const readiness = castingReadiness(productionId);
  const bySpeaker = new Map(readiness.speakers.map((s) => [s.speaker, s]));
  const fallbackAvatar = firstOf('avatar');
  const fallbackVoice = firstOf('voice');

  // The look each performer was APPROVED in for this video overrides their
  // default avatar: outfit, background and frame are what was signed off.
  const looks = new Map();
  for (const s of readiness.speakers) {
    if (s.presenterId) looks.set(s.speaker, approvedLook(productionId, s.presenterId));
  }
  const castSegments = (segments ?? []).map((seg) => {
    const cast = bySpeaker.get(seg.speaker);
    const look = looks.get(seg.speaker);
    return {
      ...seg,
      avatarId: look && !look.isPhoto ? look.remoteId : cast?.avatar?.remoteId ?? fallbackAvatar?.remote_id,
      talkingPhotoId: look?.isPhoto ? look.remoteId : undefined,
      background: look?.background,
      voiceId: cast?.voice?.remoteId ?? fallbackVoice?.remote_id,
    };
  });
  const frame = [...looks.values()].find(Boolean);

  const uncast = readiness.speakers.filter((s) => s.missing).map((s) => s.speaker);

  // testMode true = HeyGen renders it watermarked and free. Only Live turns it off.
  const testMode = !canGenerateLive();
  const { payload, stats } = provider.buildGeneratePayload({
    segments: castSegments,
    avatarId: fallbackAvatar?.remote_id,
    voiceId: fallbackVoice?.remote_id,
    testMode,
    ...(frame ? { width: frame.width, height: frame.height } : {}),
  });

  // Which pocket. MCP spends the plan the user already pays for; the API key
  // spends a separate balance. This was built and then never called — the render
  // went to the key path regardless of being signed in.
  const route = await chooseRenderPath();
  if (route.path === 'none') {
    throw Object.assign(new Error(route.reason), { code: route.warning ?? 'NO_PATH' });
  }
  // A local voice's remote id is a folder name on this Mac, not a HeyGen voice.
  // So the approved audio itself goes up, and the avatar lip-syncs to it: one
  // scene per run of one speaker, voiced by exactly the files the editor kit
  // hands out. Only the plan path's studio tool takes uploaded audio per scene.
  const localVoiced = readiness.speakers.filter((s) => s.voice?.provider === 'local').map((s) => s.speaker);
  let audioScenes = null;
  if (audioFile) {
    // A recording you made, re-performed by the avatar: one scene, your audio.
    if (route.path === 'key') {
      throw Object.assign(new Error('An avatar video from your recording renders through your HeyGen plan connection (Settings → HeyGen), not the API key — nothing was sent.'),
        { code: 'LOCAL_VOICE_RENDER' });
    }
    const [id] = await uploadAudio([audioFile], { title, simulate: route.path === 'fixtures' });
    const speaker = castSegments[0]?.speaker ?? 'Pat';
    audioScenes = [{
      speaker, text: castSegments.map((c) => c.text).join(' '),
      avatarId: looks.get(speaker)?.remoteId ?? castSegments[0]?.avatarId ?? fallbackAvatar?.remote_id, audioAssetId: id,
    }];
  } else if (localVoiced.length) {
    if (route.path === 'key') {
      throw Object.assign(
        new Error(`${localVoiced.join(', ')} ${localVoiced.length === 1 ? 'uses' : 'use'} your local voice, which renders through your HeyGen plan connection (Settings → HeyGen), not the API key — nothing was sent.`),
        { code: 'LOCAL_VOICE_RENDER' }
      );
    }
    const lines = approvedLines(productionId);
    const missing = lines.filter((l) => !l.file).length;
    if (!lines.length || missing) {
      throw Object.assign(new Error(`${missing || 'No'} line${missing === 1 ? ' has' : 's have'} no approved audio — approve every line in Segments first.`),
        { code: 'UNHEARD' });
    }
    const runs = await audioRuns(productionId, lines);
    const ids = await uploadAudio(runs.map((r) => r.file), { title, simulate: route.path === 'fixtures' });
    const avatarFor = (speaker) => castSegments.find((c) => c.speaker === speaker)?.avatarId
      ?? bySpeaker.get(speaker)?.avatar?.remoteId ?? fallbackAvatar?.remote_id;
    audioScenes = runs.map((r, i) => ({
      speaker: r.speaker, text: r.text, avatarId: looks.get(r.speaker)?.remoteId ?? avatarFor(r.speaker), audioAssetId: ids[i],
    }));
  }
  let result;
  let sent = payload;

  if (route.path === 'mcp') {
    // The studio tool has no test flag, so the router only chooses it when the
    // mode permits real spend. Asserting it here as well means a future caller
    // cannot reach a billed render by passing testMode and being ignored.
    if (testMode) {
      throw Object.assign(
        new Error('Refusing to render: this path cannot honour test mode.'),
        { code: 'NO_FREE_PATH' }
      );
    }
    result = await renderViaStudio({
      // The studio tool takes a look id as avatar_id whatever its type.
      segments: castSegments.map((s) => ({ ...s, avatarId: s.talkingPhotoId ?? s.avatarId })),
      runs: audioScenes ?? undefined,
      title,
      aspectRatio: frame?.aspect ?? '16:9',
      resolution: frame?.resolution ?? '1080p',
    });
  } else {
    result = await provider.generateVideo(payload);
    // Fixtures sends nothing, but records what the plan path WOULD have sent.
    if (audioScenes) sent = buildStudioArgs({ runs: audioScenes, title }).args;
  }

  const dry = isDryRun();

  const jobId = db
    .prepare(
      `INSERT INTO provider_jobs
        (provider, capability, render_version_id, production_id, remote_id, status, dry_run, request_payload)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(route.path === 'mcp' ? 'heygen_mcp' : id, 'render', renderVersionId, productionId,
         result.video_id, 'pending', dry ? 1 : 0, JSON.stringify(sent))
    .lastInsertRowid;

  return {
    jobId, remoteId: result.video_id,
    provider: route.path === 'mcp' ? 'heygen (your plan)' : id,
    path: route.path, tool: result.tool ?? null,
    dryRun: dry, testMode, note: result.note ?? route.reason,
    stats: result.stats ?? stats,
    lipSyncedToYourAudio: !!audioScenes,
    casting: { speakers: readiness.speakers, uncast },
  };
}

/** PULL: poll a pushed job and mirror the provider's state locally. */
export async function pollJob(jobId) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM provider_jobs WHERE id = ?').get(jobId);
  if (!job) return null;
  if (['completed', 'failed', 'cancelled'].includes(job.status)) return serializeJob(job);

  const elapsed = (Date.now() - Date.parse(job.created_at + 'Z')) / 1000;

  try {
    const s = await remoteStatus(job.provider, job.remote_id, elapsed);
    db.prepare(
      `UPDATE provider_jobs SET status = ?, progress = ?, video_url = ?, thumbnail_url = ?,
       duration = ?, credits_used = ?, error = NULL, last_polled_at = datetime('now') WHERE id = ?`
    ).run(s.status, s.progress, s.video_url, s.thumbnail_url, s.duration, s.credits_used, jobId);
  } catch (err) {
    // A failed POLL is not a failed RENDER. Marking the job failed here made a
    // network blip or a token refresh permanently abandon a video that was
    // paid for and still rendering — terminal jobs are never polled again.
    // Only the provider saying "failed" ends a job.
    db.prepare("UPDATE provider_jobs SET error = ?, last_polled_at = datetime('now') WHERE id = ?")
      .run(err.message, jobId);
  }

  return serializeJob(db.prepare('SELECT * FROM provider_jobs WHERE id = ?').get(jobId));
}

/** The provider's view of one video. A job pushed over MCP is polled over MCP; the key client cannot see it. */
async function remoteStatus(provider, remoteId, elapsedSeconds) {
  if (provider === 'heygen_mcp') {
    return (await import('./heygen-studio.js')).studioStatus(remoteId);
  }
  return PROVIDERS[provider].videoStatus(remoteId, elapsedSeconds);
}

/**
 * PULL for single-line renders. They were inserted as `queued` and never looked
 * at again, so a paid line render never got its video. Same rule as pollJob:
 * only the provider ends a render; a failed poll is recorded and retried.
 */
export async function pollSegmentRenders(productionId) {
  const db = getDb();
  const moving = db
    .prepare(
      `SELECT sr.* FROM segment_renders sr JOIN segments s ON s.id = sr.segment_id
        WHERE s.production_id = ? AND sr.remote_id IS NOT NULL
          AND sr.status IN ('queued','pending','processing')`
    )
    .all(productionId);

  for (const r of moving) {
    const elapsed = (Date.now() - Date.parse(r.created_at + 'Z')) / 1000;
    try {
      const s = await remoteStatus(r.provider, r.remote_id, elapsed);
      db.prepare(
        'UPDATE segment_renders SET status = ?, progress = ?, video_url = COALESCE(?, video_url), error = NULL WHERE id = ?'
      ).run(s.status, s.progress ?? 0, s.video_url ?? null, r.id);
    } catch (err) {
      db.prepare('UPDATE segment_renders SET error = ? WHERE id = ?').run(err.message, r.id);
    }
  }
}

export function serializeJob(j) {
  return {
    id: j.id, provider: j.provider, capability: j.capability, remoteId: j.remote_id,
    status: j.status, progress: j.progress, videoUrl: j.video_url, thumbnailUrl: j.thumbnail_url,
    duration: j.duration, creditsUsed: j.credits_used, error: j.error,
    dryRun: !!j.dry_run, renderVersionId: j.render_version_id, createdAt: j.created_at,
  };
}

export function jobsForRender(renderVersionId) {
  return getDb()
    .prepare('SELECT * FROM provider_jobs WHERE render_version_id = ? ORDER BY id DESC')
    .all(renderVersionId)
    .map(serializeJob);
}
