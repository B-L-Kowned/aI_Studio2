import { previewSrc, cacheOwnedPreviews } from './preview-cache.js';
import { getDb } from '../db/index.js';
import { TEMPLATES } from '../data/templates.js';

/**
 * Appearance: how a performer looks in ONE video — which of their looks
 * (outfit and setting), the background behind them, the frame and the motion
 * direction. An approved proof is a render instruction: the render uses
 * exactly what was approved, or refuses.
 */

// The direction the owner's finished videos were rendered with (2026-10).
export const DEFAULT_MOTION = 'Professional, composed presenter speaking naturally to the viewer. '
  + 'Keep the eyebrows relaxed and mostly neutral, with no exaggerated raising or bouncing. '
  + 'Use steady eye contact, subtle mouth movement, minimal head movement, and only a small controlled smile. '
  + 'Begin calmly without a broad toothy smile. End facing the camera with eyes open, relaxed features, '
  + 'and a gentle closed-mouth smile held steadily through the closing silence.';
export const DEFAULT_LOOK = { backgroundKind: 'color', backgroundValue: '#f6f6fc', aspect: '9:16', resolution: '1080p' };
export const ASPECTS = ['9:16', '16:9', '1:1'];
export const RESOLUTIONS = ['1080p', '720p'];
const DIMENSIONS = {
  '9:16': { '1080p': [1080, 1920], '720p': [720, 1280] },
  '16:9': { '1080p': [1920, 1080], '720p': [1280, 720] },
  '1:1': { '1080p': [1080, 1080], '720p': [720, 720] },
};

const bad = (message, code = 'BAD_APPEARANCE') => Object.assign(new Error(message), { code });

export function serializeLook(r) {
  return r && {
    id: r.id, remoteId: r.remote_id, name: r.name, previewUrl: previewSrc(r),
    groupId: r.group_id ?? null, avatarType: r.avatar_type ?? null, orientation: r.orientation ?? null,
  };
}

/** Every look of the person a presenter performs as: their avatar's group. */
export function looksFor(presenterId) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM presenters WHERE id = ?').get(presenterId);
  if (!p) return [];
  const own = p.avatar_asset_id ? db.prepare('SELECT * FROM provider_assets WHERE id = ?').get(p.avatar_asset_id) : null;
  // A persona is you: it can wear any look of yours, not just those in its
  // avatar's group — HPB's looks live outside the main group, and were
  // unreachable while the picker stopped at the group. Its group comes first.
  if (p.kind === 'personal') {
    return db.prepare(
      `SELECT * FROM provider_assets WHERE kind = 'avatar' AND owned = 1 AND hidden = 0
        ORDER BY (group_id IS NOT NULL AND group_id = ?) DESC, (group_id IS NULL), name`
    ).all(own?.group_id ?? null).map(serializeLook);
  }
  if (!own) return [];
  if (!own.group_id) return [serializeLook(own)];
  return db.prepare(
    "SELECT * FROM provider_assets WHERE kind = 'avatar' AND group_id = ? ORDER BY name"
  ).all(own.group_id).map(serializeLook);
}

/**
 * Record looks pulled from the provider (one avatar group). Upserts by remote
 * id so a re-sync refreshes names and expiring preview URLs in place.
 */
export function importLooks(provider, looks) {
  if (!Array.isArray(looks) || !looks.length) throw bad('No looks to import.', 'EMPTY');
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO provider_assets (provider, kind, remote_id, name, preview_url, raw, owned, group_id, avatar_type, orientation, synced_at)
     VALUES (?, 'avatar', ?, ?, ?, ?, 1, ?, ?, ?, datetime('now'))
     ON CONFLICT(provider, kind, remote_id) DO UPDATE SET
       name = excluded.name, preview_url = excluded.preview_url, raw = excluded.raw, owned = 1,
       group_id = excluded.group_id, avatar_type = excluded.avatar_type,
       orientation = excluded.orientation, synced_at = excluded.synced_at`
  );
  let n = 0;
  db.transaction(() => {
    for (const l of looks) {
      if (!l?.id || !l?.name) continue;
      upsert.run(provider, String(l.id), String(l.name).slice(0, 200), l.preview_image_url ?? null,
        JSON.stringify(l), l.group_id ?? null, l.avatar_type ?? null, l.preferred_orientation ?? null);
      n++;
    }
  })();
  cacheOwnedPreviews().catch(() => {});
  return n;
}

function cleanSettings(input, fallback = DEFAULT_LOOK) {
  const kind = input.backgroundKind ?? fallback.backgroundKind;
  if (!['color', 'image'].includes(kind)) throw bad('Background must be a colour or an image.');
  const value = String(input.backgroundValue ?? fallback.backgroundValue ?? '').trim();
  if (kind === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) throw bad('Background colour must look like #f6f6fc.');
  if (kind === 'image' && !/^https:\/\/\S+$/i.test(value)) throw bad('A background image must be an https URL.');
  const aspect = input.aspect ?? fallback.aspect;
  if (!ASPECTS.includes(aspect)) throw bad(`Framing must be one of ${ASPECTS.join(', ')}.`);
  const resolution = input.resolution ?? fallback.resolution;
  if (!RESOLUTIONS.includes(resolution)) throw bad(`Resolution must be ${RESOLUTIONS.join(' or ')}.`);
  const motion = String(input.motionPrompt ?? fallback.motionPrompt ?? DEFAULT_MOTION).trim().slice(0, 1200);
  return { backgroundKind: kind, backgroundValue: value, aspect, resolution, motionPrompt: motion };
}

function lookFor(presenterId, avatarAssetId) {
  const look = getDb().prepare("SELECT * FROM provider_assets WHERE id = ? AND kind = 'avatar'").get(avatarAssetId);
  if (!look) throw bad('Choose one of the looks shown.', 'NO_LOOK');
  if (!looksFor(presenterId).some((l) => l.id === look.id)) {
    throw bad(`"${look.name}" is not one of this performer's looks.`, 'WRONG_LOOK');
  }
  return look;
}

/**
 * The columns a look-based proof stores. The prose fields (outfit, background,
 * framing, image) are derived from the structured choice so the existing
 * approval check and the proof card read the same truth.
 */
export function proofColumns(presenterId, input) {
  const look = lookFor(presenterId, Number(input.avatarAssetId));
  const s = cleanSettings(input);
  return {
    avatar_asset_id: look.id,
    image_url: look.preview_url,
    outfit: look.name,
    background: s.backgroundKind === 'color' ? `Plain colour ${s.backgroundValue}` : `Image ${s.backgroundValue}`,
    framing: `${s.aspect} · ${s.resolution}`,
    background_kind: s.backgroundKind,
    background_value: s.backgroundValue,
    aspect: s.aspect,
    resolution: s.resolution,
    motion_prompt: s.motionPrompt,
  };
}

// ----------------------------------------------------------------- defaults
export const templateIdOf = (productionId) => {
  const name = getDb().prepare("SELECT value FROM brief_fields WHERE production_id = ? AND label = 'Template'").get(productionId)?.value;
  return TEMPLATES.find((t) => t.name === name)?.id ?? null;
};

export function listDefaults() {
  return getDb().prepare('SELECT * FROM appearance_defaults ORDER BY scope').all().map((d) => ({
    scope: d.scope, presenterId: d.presenter_id, avatarAssetId: d.avatar_asset_id,
    backgroundKind: d.background_kind, backgroundValue: d.background_value,
    aspect: d.aspect, resolution: d.resolution, motionPrompt: d.motion_prompt, updatedAt: d.updated_at,
    look: serializeLook(d.avatar_asset_id ? getDb().prepare('SELECT * FROM provider_assets WHERE id = ?').get(d.avatar_asset_id) : null),
  }));
}

export function setDefault(scope, presenterId, input) {
  if (scope !== 'all' && !/^template:[a-z0-9-]+$/.test(scope)) throw bad('Scope must be "all" or "template:<id>".');
  if (scope !== 'all' && !TEMPLATES.some((t) => `template:${t.id}` === scope)) throw bad('Unknown template.');
  const c = proofColumns(presenterId, input);
  getDb().prepare(
    `INSERT INTO appearance_defaults (scope, presenter_id, avatar_asset_id, background_kind, background_value, aspect, resolution, motion_prompt, updated_at)
     VALUES (?,?,?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(scope) DO UPDATE SET presenter_id = excluded.presenter_id, avatar_asset_id = excluded.avatar_asset_id,
       background_kind = excluded.background_kind, background_value = excluded.background_value, aspect = excluded.aspect,
       resolution = excluded.resolution, motion_prompt = excluded.motion_prompt, updated_at = excluded.updated_at`
  ).run(scope, presenterId, c.avatar_asset_id, c.background_kind, c.background_value, c.aspect, c.resolution, c.motion_prompt);
  return listDefaults().find((d) => d.scope === scope);
}

/** The default that applies to a production: its template's, else 'all'. */
export function defaultFor(productionId) {
  const t = templateIdOf(productionId);
  const all = listDefaults();
  return all.find((d) => d.scope === `template:${t}`) ?? all.find((d) => d.scope === 'all') ?? null;
}

/**
 * Give every production in scope a DRAFT proof from its default, unless it
 * already has a draft or approved proof for that performer. Never approves.
 */
export function applyDefault(scope) {
  const db = getDb();
  const d = listDefaults().find((x) => x.scope === scope);
  if (!d) throw bad('Save the default first.', 'NO_DEFAULT');
  const ids = db.prepare('SELECT id FROM productions').all().map((r) => r.id)
    .filter((id) => scope === 'all' || `template:${templateIdOf(id)}` === scope);
  const has = db.prepare(
    "SELECT 1 FROM appearance_proofs WHERE production_id = ? AND presenter_id = ? AND status IN ('draft','approved')"
  );
  const c = proofColumns(d.presenterId, d);
  const ins = db.prepare(
    `INSERT INTO appearance_proofs (production_id, presenter_id, label, image_url, outfit, background, framing, notes,
       avatar_asset_id, background_kind, background_value, aspect, resolution, motion_prompt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  let created = 0;
  db.transaction(() => {
    for (const id of ids) {
      if (has.get(id, d.presenterId)) continue;
      ins.run(id, d.presenterId, `Default — ${scope === 'all' ? 'all videos' : scope.slice(9)}`, c.image_url, c.outfit,
        c.background, c.framing, 'Created from a default; approve to use it for this video.',
        c.avatar_asset_id, c.background_kind, c.background_value, c.aspect, c.resolution, c.motion_prompt);
      created++;
    }
  })();
  return { created, inScope: ids.length };
}

// ------------------------------------------------------------------ render
/**
 * What the render must use for one performer in one production: the
 * approved look, or null when that performer has none (the lock blocks then).
 */
export function approvedLook(productionId, presenterId) {
  const r = getDb().prepare(
    `SELECT ap.*, pa.remote_id AS look_remote, pa.avatar_type AS look_type, pa.name AS look_name
       FROM appearance_proofs ap LEFT JOIN provider_assets pa ON pa.id = ap.avatar_asset_id
      WHERE ap.production_id = ? AND ap.presenter_id = ? AND ap.status = 'approved'
      ORDER BY ap.approved_at DESC, ap.id DESC LIMIT 1`
  ).get(productionId, presenterId);
  if (!r || !r.look_remote) return null;
  const aspect = r.aspect || DEFAULT_LOOK.aspect;
  const resolution = r.resolution || DEFAULT_LOOK.resolution;
  const [width, height] = DIMENSIONS[aspect]?.[resolution] ?? DIMENSIONS['9:16']['1080p'];
  return {
    remoteId: r.look_remote,
    name: r.look_name,
    // A photo avatar is a talking photo to HeyGen's generate API.
    isPhoto: r.look_type === 'photo_avatar',
    background: r.background_kind === 'image'
      ? { type: 'image', url: r.background_value }
      : { type: 'color', value: r.background_value || DEFAULT_LOOK.backgroundValue },
    aspect, resolution, width, height,
    motionPrompt: r.motion_prompt || null,
  };
}
