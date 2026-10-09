import { getDb } from '../db/index.js';
import { previewSrc } from './preview-cache.js';
import { looksFor } from './appearance.js';
import { streamOf } from '../routes/register.js';

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

const PERSONA_FIELDS = ['voice', 'signatureOpening', 'signOff', 'neverClaim'];
const useForOf = (row) => { try { const u = JSON.parse(row.use_for || '{}'); return { workstreams: u.workstreams ?? [], companies: u.companies ?? [] }; } catch { return { workstreams: [], companies: [] }; } };
export { useForOf };

/**
 * Set any part of a persona: its looks (in order, first = default), pace,
 * personality (how they speak, open, close, what they never claim), tagline
 * and name, and which videos it presents by default.
 */
export function setPersona(presenterId, { assetIds, speed, persona, tagline, name, useFor } = {}) {
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
  if (persona && typeof persona === 'object') {
    let cur = {};
    try { cur = p.persona ? JSON.parse(p.persona) : {}; } catch { /* replace unreadable */ }
    for (const k of PERSONA_FIELDS) if (typeof persona[k] === 'string') cur[k] = persona[k].trim().slice(0, 600);
    db.prepare('UPDATE presenters SET persona = ? WHERE id = ?').run(JSON.stringify(cur), presenterId);
  }
  if (typeof tagline === 'string') db.prepare('UPDATE presenters SET tagline = ? WHERE id = ?').run(tagline.trim().slice(0, 200), presenterId);
  if (typeof name === 'string' && name.trim()) db.prepare('UPDATE presenters SET name = ? WHERE id = ?').run(name.trim().slice(0, 80), presenterId);
  if (useFor && typeof useFor === 'object') {
    const clean = (a) => (Array.isArray(a) ? [...new Set(a.map(String))].slice(0, 30) : []);
    db.prepare('UPDATE presenters SET use_for = ? WHERE id = ?').run(JSON.stringify({ workstreams: clean(useFor.workstreams), companies: clean(useFor.companies) }), presenterId);
  }
  if (speed !== undefined) {
    const v = speed === null ? null : Number(speed);
    if (v !== null && !(v >= SPEED[0] && v <= SPEED[1])) throw bad(`Pace must be between ${SPEED[0]}× and ${SPEED[1]}×.`);
    db.prepare('UPDATE presenters SET speed = ? WHERE id = ?').run(v, presenterId);
  }
  const row = db.prepare('SELECT * FROM presenters WHERE id = ?').get(presenterId);
  return { looks: personaLooks(presenterId), wearable: looksFor(presenterId), speed: row.speed, useFor: useForOf(row) };
}

/**
 * The persona presenting a video: the one chosen for it; else the persona set
 * to present its company or its kind of video ("Use for"); else your likeness.
 */
export function personaFor(productionId) {
  const db = getDb();
  const p = db.prepare(`SELECT p.persona_id, p.title, co.name AS company FROM productions p
    LEFT JOIN campaigns c ON c.id = p.campaign_id LEFT JOIN companies co ON co.id = c.company_id WHERE p.id = ?`).get(productionId);
  const chosen = p?.persona_id;
  let row = chosen ? db.prepare("SELECT * FROM presenters WHERE id = ? AND kind = 'personal'").get(chosen) : null;
  let why = row ? 'chosen' : null;
  if (!row && p) {
    const vid = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — /.exec(p.title)?.[1];
    const stream = vid ? streamOf(vid) : null;
    const all = db.prepare("SELECT * FROM presenters WHERE kind = 'personal' AND is_active = 1 ORDER BY id").all();
    // A company match is more specific than a workstream match.
    row = all.find((r) => p.company && useForOf(r).companies.includes(p.company));
    if (row) why = `presents ${p.company}`;
    else if ((row = all.find((r) => stream && useForOf(r).workstreams.includes(stream)))) why = `presents ${stream} videos`;
  }
  row ||= db.prepare("SELECT * FROM presenters WHERE kind = 'personal' AND is_active = 1 ORDER BY id LIMIT 1").get();
  if (!row) return null;
  let persona = null;
  try { persona = row.persona ? JSON.parse(row.persona) : null; } catch { /* unreadable: no persona */ }
  return { id: row.id, name: row.name, chosen: row.id === chosen, why: why ?? 'your likeness', speed: row.speed ?? null, persona, looks: personaLooks(row.id) };
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
