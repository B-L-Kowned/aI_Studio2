import { getDb } from '../db/index.js';
import { personaLooks } from './personas.js';

/**
 * A twin card: everything about a persona that can travel, and nothing that
 * should not. Personality, delivery, wardrobe and voice are described with the
 * renderer and asset each one lives at; raw samples never go in a card.
 *
 * Renderer assets belong to the account that made them — a HeyGen avatar id is
 * useless in someone else's HeyGen. So a card says, per asset, whether the
 * recipient can use it directly or has to build their own from the source the
 * owner shares. The shape matches the asset grant proposed to AuthenTech, so a
 * card can later ride inside a grant unchanged.
 */
export const FORMAT = 'ai-video-studio.twin/1';

const bad = (message, code = 'BAD_CARD') => Object.assign(new Error(message), { code });

function parsePersona(raw) {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export function twinCard(presenterId, { ownerName } = {}) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM presenters WHERE id = ?').get(presenterId);
  if (!p) throw bad('No such persona.', 'NOT_FOUND');
  if (p.kind !== 'personal') throw bad('Only your own personas can be shared. A collaborator shares their own twin.', 'NOT_YOURS');
  const voice = p.voice_asset_id ? db.prepare('SELECT * FROM provider_assets WHERE id = ?').get(p.voice_asset_id) : null;
  const persona = parsePersona(p.persona);
  return {
    format: FORMAT,
    name: p.name,
    owner: ownerName ?? null,
    tagline: p.tagline ?? '',
    personality: {
      voice: persona.voice ?? '',
      signatureOpening: persona.signatureOpening ?? '',
      signOff: persona.signOff ?? '',
      neverClaim: persona.neverClaim ?? '',
    },
    delivery: { speed: p.speed ?? 1 },
    wardrobe: personaLooks(presenterId).map((l) => db.prepare('SELECT * FROM provider_assets WHERE id = ?').get(l.id)).filter(Boolean).map((a, i) => ({
      renderer: a.provider, id: a.remote_id, kind: 'appearance', name: a.name, default: i === 0,
      // The owner's account holds it; a recipient builds their own from the source.
      portable: false,
    })),
    voice: voice ? {
      renderer: voice.provider === 'local' ? 'local-voice' : voice.provider,
      id: voice.remote_id, kind: 'voice', name: voice.name, portable: false,
    } : null,
    // Filled in by AuthenTech once a grant exists; a card on its own grants nothing.
    consent: { grant_id: null, scopes: [], expires_at: null },
    exported_at: new Date().toISOString(),
  };
}

const str = (v, n = 600) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Read a card someone shared, without trusting it: strings are clipped, unknown keys dropped. */
export function readCard(card) {
  if (!card || typeof card !== 'object' || card.format !== FORMAT) {
    throw bad('That file is not a twin card from AI Video Studio.');
  }
  const name = str(card.name, 120);
  if (!name) throw bad('The twin card has no name.');
  const speed = Number(card.delivery?.speed);
  return {
    name,
    owner: str(card.owner, 120) || null,
    tagline: str(card.tagline, 200),
    personality: {
      voice: str(card.personality?.voice), signatureOpening: str(card.personality?.signatureOpening),
      signOff: str(card.personality?.signOff), neverClaim: str(card.personality?.neverClaim),
    },
    speed: Number.isFinite(speed) ? Math.min(1.15, Math.max(0.85, speed)) : 1,
    wardrobe: (Array.isArray(card.wardrobe) ? card.wardrobe : []).slice(0, 20)
      .map((w) => ({ renderer: str(w?.renderer, 40), id: str(w?.id, 120), name: str(w?.name, 120), default: !!w?.default })),
    voice: card.voice ? { renderer: str(card.voice.renderer, 40), id: str(card.voice.id, 120), name: str(card.voice.name, 120) } : null,
    grantId: str(card.consent?.grant_id, 120) || null,
  };
}

/**
 * Add a shared twin as a Content presenter tied to a collaborator. Its look and
 * voice start empty: they are cast from the recipient's own HeyGen once built.
 * Nothing about it is usable for videos until consent exists for it.
 */
export function importCard(card) {
  const c = readCard(card);
  const db = getDb();
  const owner = c.owner || c.name;
  let person = db.prepare('SELECT id FROM people WHERE name = ?').get(owner);
  if (!person) {
    const position = db.prepare('SELECT COUNT(*) n FROM people').get().n;
    const id = db.prepare(
      `INSERT INTO people (name, role, representation, consent_scope, status, position)
       VALUES (?,?,?,?,?,?)`
    // A grant id inside a file is a claim, not consent: it stays pending until
    // AuthenTech confirms the grant.
    ).run(owner, 'Collaborator', 'Shared twin card', 'Not yet verified', 'pending', position).lastInsertRowid;
    person = { id };
  }
  const position = db.prepare("SELECT COUNT(*) n FROM presenters WHERE kind = 'avatar'").get().n;
  const description = c.tagline || `${owner}'s twin, shared with you`;
  const id = db.prepare(
    `INSERT INTO presenters (kind, name, program, description, person_id, position, persona, tagline, speed, twin_source)
     VALUES ('avatar', ?, 'content', ?, ?, ?, ?, ?, ?, ?)`
  ).run(c.name, description, person.id, position, JSON.stringify(c.personality), c.tagline, c.speed,
    JSON.stringify({ owner, wardrobe: c.wardrobe, voice: c.voice, grantId: c.grantId, importedAt: new Date().toISOString() }))
    .lastInsertRowid;
  return { presenterId: id, personId: person.id, name: c.name, owner, needs: needsFor(c) };
}

/** What the recipient still has to do before the twin can appear in a video. */
export function needsFor(c) {
  const needs = [];
  needs.push(c.grantId ? `${c.owner || c.name}'s consent confirmed with AuthenTech` : `${c.owner || c.name}'s consent, recorded with AuthenTech`);
  if (c.wardrobe.length) needs.push('their look built in your HeyGen from the source they share');
  if (c.voice) needs.push('their voice built from the sample they share');
  return needs;
}
