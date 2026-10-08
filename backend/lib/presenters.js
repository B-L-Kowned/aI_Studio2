import { previewSrc } from './preview-cache.js';
import { getDb } from '../db/index.js';
import { presenterTabsFor, PRESENTER_TAB_INFO, hasProgram } from './programs.js';

const TAB_FOR_KIND = { character: 'characters', avatar: 'avatars', personal: 'personal' };

function serialize(r) {
  const db = getDb();
  const asset = (id) => (id ? db.prepare('SELECT * FROM provider_assets WHERE id = ?').get(id) : null);
  const a = asset(r.avatar_asset_id);
  const v = asset(r.voice_asset_id);
  return {
    id: r.id,
    kind: r.kind,
    tab: TAB_FOR_KIND[r.kind],
    name: r.name,
    program: r.program,
    description: r.description,
    // Custom artwork is character-only. Every presenter may still show the
    // preview of the exact provider avatar they are cast to; that is not
    // invented artwork, it is the face the finished video will actually use.
    artworkUrl: r.artwork_url,
    hasArtwork: !!r.artwork_url,
    tagline: r.tagline ?? null,
    // What makes this performer sound like themselves. Carried through so the
    // roster can show it and the script generator can use it.
    persona: (() => { try { return r.persona ? JSON.parse(r.persona) : null; } catch { return null; } })(),
    isActive: !!r.is_active,
    personId: r.person_id,
    avatar: a ? {
      id: a.id,
      remoteId: a.remote_id,
      name: a.name,
      previewUrl: previewSrc(a),
      provider: a.provider,
    } : null,
    voice: v ? { id: v.id, remoteId: v.remote_id, name: v.name } : null,
    // Castable only once a real avatar and voice back it.
    ready: !!a && !!v,
  };
}

/**
 * The presenter pickers this account gets, each with its roster.
 * Tabs come from the granted programs, never from a build-time product.
 */
export function presentersFor(programs, { includeRetired = false } = {}) {
  const db = getDb();
  const tabs = presenterTabsFor(programs);

  return tabs.map((tab) => {
    const info = PRESENTER_TAB_INFO[tab];
    const kind = Object.keys(TAB_FOR_KIND).find((k) => TAB_FOR_KIND[k] === tab);
    const rows = db
      .prepare(
        `SELECT * FROM presenters
         WHERE kind = ?${includeRetired ? '' : ' AND is_active = 1'}
         ORDER BY position, id`
      )
      .all(kind);
    return { ...info, presenters: rows.map(serialize) };
  });
}

/** Every presenter this account may actually cast, flattened. */
export function castablePresenters(programs) {
  return presentersFor(programs).flatMap((t) => t.presenters);
}

export function presenterById(id) {
  const row = getDb().prepare('SELECT * FROM presenters WHERE id = ?').get(id);
  return row ? serialize(row) : null;
}

/** May this account use this presenter? Personal belongs to everyone. */
export function mayUse(programs, presenter) {
  if (!presenter) return false;
  if (presenter.kind === 'personal') return true;
  return hasProgram(programs, presenter.program);
}

export function createPresenter({ kind, name, description = '', artworkUrl = null, personId = null }) {
  const db = getDb();
  const program = kind === 'character' ? 'funny' : kind === 'avatar' ? 'content' : null;

  // Enforced in the schema too, but failing here gives a sentence rather than a
  // CHECK violation.
  if (kind !== 'character' && artworkUrl) {
    throw Object.assign(
      new Error('Only characters have artwork. A stock presenter or your own likeness must not carry a picture of someone who does not exist.'),
      { code: 'NO_ARTWORK' }
    );
  }
  if (!String(name ?? '').trim()) {
    throw Object.assign(new Error('A presenter needs a name'), { code: 'NAME_REQUIRED' });
  }

  const position = db.prepare('SELECT COUNT(*) n FROM presenters WHERE kind = ?').get(kind).n;
  const id = db
    .prepare(
      `INSERT INTO presenters (kind, name, program, description, artwork_url, person_id, position)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(kind, String(name).trim(), program, description, artworkUrl, personId, position)
    .lastInsertRowid;
  return presenterById(id);
}

export function castPresenter(id, { avatarAssetId, voiceAssetId }) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM presenters WHERE id = ?').get(id)) {
    throw Object.assign(new Error('Presenter not found'), { code: 'NOT_FOUND' });
  }
  const check = (assetId, kind) => {
    if (assetId === undefined || assetId === null) return null;
    const row = db.prepare('SELECT * FROM provider_assets WHERE id = ?').get(assetId);
    if (!row) throw Object.assign(new Error(`No such ${kind}`), { code: 'NO_ASSET' });
    if (row.kind !== kind) {
      throw Object.assign(new Error(`That asset is a ${row.kind}, not a ${kind}`), { code: 'WRONG_KIND' });
    }
    return row.id;
  };
  if (avatarAssetId !== undefined) {
    db.prepare('UPDATE presenters SET avatar_asset_id = ? WHERE id = ?').run(check(avatarAssetId, 'avatar'), id);
  }
  if (voiceAssetId !== undefined) {
    db.prepare('UPDATE presenters SET voice_asset_id = ? WHERE id = ?').run(check(voiceAssetId, 'voice'), id);
  }
  return presenterById(id);
}

/**
 * Retire, never delete. Productions that already cast this presenter keep
 * resolving; deleting would break their history instead.
 */
export function retirePresenter(id, active = false) {
  const db = getDb();
  const r = db.prepare('UPDATE presenters SET is_active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (!r.changes) throw Object.assign(new Error('Presenter not found'), { code: 'NOT_FOUND' });
  return presenterById(id);
}
