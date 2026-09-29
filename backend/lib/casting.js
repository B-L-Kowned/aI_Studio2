import { getDb } from '../db/index.js';

// Casting maps a person in a production to the real provider assets that
// perform them. Without it a render silently used the first avatar and the
// first voice in the catalogue for every speaker, so a two-hander came back
// with one face reading both parts.

export function castingFor(personId) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
  if (!p) return null;

  const asset = (id) =>
    id ? db.prepare('SELECT * FROM provider_assets WHERE id = ?').get(id) : null;

  const a = asset(p.avatar_asset_id);
  const v = asset(p.voice_asset_id);
  return {
    avatar: a ? { id: a.id, remoteId: a.remote_id, name: a.name, provider: a.provider } : null,
    voice: v ? { id: v.id, remoteId: v.remote_id, name: v.name, provider: v.provider } : null,
  };
}

export function setCasting(personId, { avatarAssetId, voiceAssetId }) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM people WHERE id = ?').get(personId)) {
    throw Object.assign(new Error('Person not found'), { code: 'NOT_FOUND' });
  }

  const check = (id, kind) => {
    if (id === undefined || id === null) return null;
    const row = db.prepare('SELECT * FROM provider_assets WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error(`No such ${kind}`), { code: 'NO_ASSET' });
    if (row.kind !== kind) {
      throw Object.assign(new Error(`That asset is a ${row.kind}, not a ${kind}`), { code: 'WRONG_KIND' });
    }
    return row.id;
  };

  if (avatarAssetId !== undefined) {
    db.prepare('UPDATE people SET avatar_asset_id = ? WHERE id = ?')
      .run(check(avatarAssetId, 'avatar'), personId);
  }
  if (voiceAssetId !== undefined) {
    db.prepare('UPDATE people SET voice_asset_id = ? WHERE id = ?')
      .run(check(voiceAssetId, 'voice'), personId);
  }
  return castingFor(personId);
}

/**
 * A script segment names its speaker as free text ("Pat", "Pat + Christine").
 * Resolve that to a PRESENTER — who appears on screen — matching on the first
 * name in the string.
 *
 * People and presenters are different questions. `people` is the consent
 * register: who agreed to appear and at what scope. `presenters` is the cast:
 * which avatar and voice actually perform. Resolving a render against the
 * consent register meant the presenter roster was never used by a render at all.
 */
export function resolveSpeaker(speaker) {
  const db = getDb();
  const name = String(speaker ?? '').split(/[+↔,&]/)[0].trim();
  if (!name) return null;

  // Exact first, then a prefix match, so "Pat" finds "Pat (your likeness)".
  return (
    db.prepare('SELECT * FROM presenters WHERE is_active = 1 AND lower(name) = lower(?) LIMIT 1').get(name)
    ?? db.prepare("SELECT * FROM presenters WHERE is_active = 1 AND lower(name) LIKE lower(?) || '%' ORDER BY id LIMIT 1").get(name)
    ?? null
  );
}

/** The provider assets a presenter performs with. */
export function presenterCasting(presenterId) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM presenters WHERE id = ?').get(presenterId);
  if (!p) return null;
  const asset = (id) => (id ? db.prepare('SELECT * FROM provider_assets WHERE id = ?').get(id) : null);
  const a = asset(p.avatar_asset_id);
  const v = asset(p.voice_asset_id);
  return {
    avatar: a ? { id: a.id, remoteId: a.remote_id, name: a.name } : null,
    voice: v ? { id: v.id, remoteId: v.remote_id, name: v.name } : null,
  };
}

/**
 * Is this production ready to render? Reports every speaker in the accepted
 * script and what is missing, rather than letting the render substitute someone.
 */
export function castingReadiness(productionId) {
  const db = getDb();
  const accepted = db
    .prepare("SELECT * FROM script_versions WHERE production_id = ? AND status = 'accepted' ORDER BY version DESC")
    .get(productionId);
  if (!accepted) return { ready: false, reason: 'NO_SCRIPT', speakers: [] };

  const speakers = db
    .prepare('SELECT DISTINCT speaker FROM script_segments WHERE script_version_id = ?')
    .all(accepted.id)
    .map((r) => r.speaker)
    .filter(Boolean);

  const rows = speakers.map((speaker) => {
    const presenter = resolveSpeaker(speaker);
    const cast = presenter ? presenterCasting(presenter.id) : null;
    return {
      speaker,
      presenterId: presenter?.id ?? null,
      presenterName: presenter?.name ?? null,
      kind: presenter?.kind ?? null,
      avatar: cast?.avatar ?? null,
      voice: cast?.voice ?? null,
      // voice is optional: HeyGen falls back to the avatar's own default.
      missing: !presenter ? 'presenter' : !cast?.avatar ? 'avatar' : null,
    };
  });

  return { ready: rows.every((r) => !r.missing), reason: null, speakers: rows };
}
