import { getDb } from '../db/index.js';
import { previewSrc } from './preview-cache.js';
import { looksFor } from './appearance.js';

/*
 * A persona is who is talking: a personality (how they speak, what they never
 * claim — it steers the writing), a delivery (their pace), and their looks
 * (the outfits they wear, from your HeyGen looks). A video picks a persona;
 * its looks come first in Render and its pace is the starting speed.
 */

const bad = (message, code = 'BAD_REQUEST') => Object.assign(new Error(message), { code });
export const SPEED = [0.85, 1.15];

/** The looks a persona wears, its default first. */
export function personaLooks(presenterId) {
  return getDb().prepare(
    `SELECT pa.* FROM presenter_looks pl JOIN provider_assets pa ON pa.id = pl.asset_id
      WHERE pl.presenter_id = ? ORDER BY pl.position, pa.name`
  ).all(presenterId).map((a) => ({ id: a.id, name: a.name, previewUrl: previewSrc(a) }));
}

/** Set a persona's looks (in order, first = default) and/or its pace. */
export function setPersona(presenterId, { assetIds, speed } = {}) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM presenters WHERE id = ?').get(presenterId);
  if (!p) throw bad('No such persona.', 'NOT_FOUND');
  if (Array.isArray(assetIds)) {
    // Only looks this persona can actually wear: its avatar group's.
    const wearable = new Set(looksFor(presenterId).map((l) => l.id));
    const ids = [...new Set(assetIds.map(Number))].filter((id) => wearable.has(id));
    db.transaction(() => {
      db.prepare('DELETE FROM presenter_looks WHERE presenter_id = ?').run(presenterId);
      const ins = db.prepare('INSERT INTO presenter_looks (presenter_id, asset_id, position) VALUES (?,?,?)');
      ids.forEach((id, i) => ins.run(presenterId, id, i));
      // The default look is the one the persona is cast to.
      if (ids[0]) db.prepare('UPDATE presenters SET avatar_asset_id = ? WHERE id = ?').run(ids[0], presenterId);
    })();
  }
  if (speed !== undefined) {
    const v = speed === null ? null : Number(speed);
    if (v !== null && !(v >= SPEED[0] && v <= SPEED[1])) throw bad(`Pace must be between ${SPEED[0]}× and ${SPEED[1]}×.`);
    db.prepare('UPDATE presenters SET speed = ? WHERE id = ?').run(v, presenterId);
  }
  return { looks: personaLooks(presenterId), wearable: looksFor(presenterId), speed: db.prepare('SELECT speed FROM presenters WHERE id = ?').get(presenterId).speed };
}

/** The persona presenting a video: its choice, else your likeness. */
export function personaFor(productionId) {
  const db = getDb();
  const chosen = db.prepare('SELECT persona_id FROM productions WHERE id = ?').get(productionId)?.persona_id;
  const row = (chosen && db.prepare("SELECT * FROM presenters WHERE id = ? AND kind = 'personal'").get(chosen))
    || db.prepare("SELECT * FROM presenters WHERE kind = 'personal' AND is_active = 1 ORDER BY id LIMIT 1").get();
  if (!row) return null;
  let persona = null;
  try { persona = row.persona ? JSON.parse(row.persona) : null; } catch { /* unreadable: no persona */ }
  return { id: row.id, name: row.name, chosen: row.id === chosen, speed: row.speed ?? null, persona, looks: personaLooks(row.id) };
}

export function setVideoPersona(productionId, personaId) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(productionId)) throw bad('Production not found.', 'NOT_FOUND');
  if (personaId != null && !db.prepare("SELECT 1 FROM presenters WHERE id = ? AND kind = 'personal'").get(Number(personaId))) {
    throw bad('That is not one of your personas.', 'NOT_FOUND');
  }
  db.prepare('UPDATE productions SET persona_id = ? WHERE id = ?').run(personaId == null ? null : Number(personaId), productionId);
  return personaFor(productionId);
}
