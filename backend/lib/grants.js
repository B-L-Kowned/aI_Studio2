import { getDb } from '../db/index.js';

/**
 * Grants: someone's likeness, shared for a while.
 *
 * `out` is your twin, lent to someone. `in` is theirs, lent to you. A grant
 * ends in one of three ways, and each is recorded:
 *   - time:     its end date passes (status `ended`)
 *   - borrower: whoever was using it says they are finished (status `done`)
 *   - owner:    whoever it belongs to ends it (status `withdrawn`)
 *
 * Ending stops anything new being made with the twin: casting, voice and
 * render all ask `usable()`. Videos already made stay as they are.
 *
 * Expiry is settled on read, not by a timer, so a Mac that was asleep on the
 * end date still treats the grant as ended the moment anything asks.
 */

export const SCOPES = ['appearance', 'voice', 'personality'];
export const DURATIONS = [7, 30, 90]; // days; null = until someone ends it
const ENDING_SOON_DAYS = 2;

const bad = (message, code = 'BAD_REQUEST') => Object.assign(new Error(message), { code });
const nowIso = () => new Date().toISOString();
const addDays = (iso, days) => new Date(new Date(iso).getTime() + days * 86400000).toISOString();

/** Any active grant whose end date has passed is ended, by time. */
export function settle() {
  const db = getDb();
  return db.prepare(
    `UPDATE grants SET status = 'ended', ended_by = 'time', ended_at = ends_at
      WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ?`
  ).run(nowIso()).changes;
}

function cleanScopes(scopes) {
  const list = (Array.isArray(scopes) ? scopes : SCOPES).filter((s) => SCOPES.includes(s));
  if (!list.length) throw bad('Share at least one of look, voice or personality.', 'NO_SCOPE');
  return [...new Set(list)];
}

function cleanDays(days) {
  if (days == null || days === '') return null;
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw bad('Choose between 1 and 365 days, or until you end it.', 'BAD_DAYS');
  return n;
}

export function createGrant({
  direction, personId = null, presenterId = null, counterpart = '', email = null,
  scopes, mode = 'source', days = 7, status = 'active', startsAt = null, endsAt, source = 'studio', inviteId = null,
} = {}) {
  if (!['out', 'in'].includes(direction)) throw bad('A grant is either yours to lend or theirs to you.', 'BAD_DIRECTION');
  if (!['source', 'render'].includes(mode)) throw bad('Choose how it is used.', 'BAD_MODE');
  const d = cleanDays(days);
  const start = status === 'active' ? (startsAt ?? nowIso()) : null;
  const end = endsAt !== undefined ? endsAt : (start && d ? addDays(start, d) : null);
  const id = getDb().prepare(
    `INSERT INTO grants (direction, person_id, presenter_id, counterpart, email, scopes, mode, status, starts_at, ends_at, source, invite_id, days)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(direction, personId, presenterId, String(counterpart).trim().slice(0, 120), email, JSON.stringify(cleanScopes(scopes)),
    mode, status, start, end, source, inviteId, d).lastInsertRowid;
  settle();
  return grantById(id);
}

function shape(r) {
  const db = getDb();
  let scopes = SCOPES;
  try { scopes = JSON.parse(r.scopes); } catch { /* keep all */ }
  const presenter = r.presenter_id ? db.prepare('SELECT id, name FROM presenters WHERE id = ?').get(r.presenter_id) : null;
  const msLeft = r.status === 'active' && r.ends_at ? new Date(r.ends_at).getTime() - Date.now() : null;
  const daysLeft = msLeft == null ? null : Math.max(0, Math.ceil(msLeft / 86400000));
  return {
    id: r.id,
    direction: r.direction,
    personId: r.person_id,
    presenter,
    counterpart: r.counterpart,
    email: r.email,
    scopes,
    mode: r.mode,
    status: r.status,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    endedAt: r.ended_at,
    endedBy: r.ended_by,
    days: r.days,
    source: r.source,
    daysLeft,
    endingSoon: daysLeft != null && daysLeft <= ENDING_SOON_DAYS,
    // What this side may do with it.
    canExtend: r.direction === 'out' && (r.status === 'active' || r.status === 'ended'),
    canEnd: r.status === 'active' || r.status === 'pending',
    createdAt: r.created_at,
  };
}

export function grantById(id) {
  const r = getDb().prepare('SELECT * FROM grants WHERE id = ?').get(id);
  return r ? shape(r) : null;
}

/**
 * Bring collaborators from before grants existed under the same rules: an
 * approved one is an open-ended grant to you, an outstanding invite a pending
 * one. Runs once per person; their record is not changed.
 */
export function backfill() {
  const db = getDb();
  // Consent from before grants was for appearance and voice, never personality.
  db.prepare(`UPDATE grants SET scopes = '["appearance","voice"]' WHERE source = 'legacy' AND scopes LIKE '%personality%'`).run();
  const people = db.prepare(
    `SELECT * FROM people p WHERE role NOT LIKE '%Owner%'
       AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.person_id = p.id)`
  ).all();
  for (const p of people) {
    const presenter = db.prepare('SELECT id FROM presenters WHERE person_id = ? ORDER BY id LIMIT 1').get(p.id);
    const revoked = /revoked|withdrawn/i.test(p.representation) || ['revoked', 'withdrawn'].includes(p.invite_status);
    const status = p.status === 'approved' ? 'active' : revoked ? 'withdrawn' : p.invite_status === 'declined' ? 'declined' : 'pending';
    db.prepare(
      `INSERT INTO grants (direction, person_id, presenter_id, counterpart, email, scopes, status, starts_at, ends_at, ended_at, ended_by, source, invite_id, days)
       VALUES ('in',?,?,?,?,'["appearance","voice"]',?,?,NULL,?,?,'legacy',?,NULL)`
    ).run(p.id, presenter?.id ?? null, p.name, p.email ?? null, status,
      status === 'active' ? nowIso() : null,
      status === 'withdrawn' ? nowIso() : null, status === 'withdrawn' ? 'owner' : null, p.invite_id ?? null);
  }
  return people.length;
}

export function listGrants() {
  backfill();
  settle();
  const rows = getDb().prepare(
    `SELECT * FROM grants ORDER BY
       CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
       COALESCE(ends_at, '9999') , id DESC`
  ).all().map(shape);
  return {
    out: rows.filter((g) => g.direction === 'out'),
    in: rows.filter((g) => g.direction === 'in'),
    endingSoon: rows.filter((g) => g.status === 'active' && g.endingSoon),
    durations: DURATIONS,
  };
}

/** Lend your twin for longer. Restarts the clock from today if it had already ended by time. */
export function extendGrant(id, days) {
  const db = getDb();
  settle();
  const g = db.prepare('SELECT * FROM grants WHERE id = ?').get(id);
  if (!g) throw bad('No such share.', 'NOT_FOUND');
  if (g.direction !== 'out') throw bad('Only the person it belongs to can extend it.', 'NOT_YOURS');
  if (!['active', 'ended'].includes(g.status)) throw bad('This share was ended on purpose. Share it again instead.', 'ENDED');
  const d = cleanDays(days);
  if (d == null) {
    db.prepare("UPDATE grants SET status = 'active', ends_at = NULL, ended_at = NULL, ended_by = NULL, days = NULL WHERE id = ?").run(id);
  } else {
    const from = g.status === 'active' && g.ends_at ? g.ends_at : nowIso();
    db.prepare("UPDATE grants SET status = 'active', ends_at = ?, ended_at = NULL, ended_by = NULL, starts_at = COALESCE(starts_at, ?) WHERE id = ?")
      .run(addDays(from, d), nowIso(), id);
  }
  return grantById(id);
}

/**
 * End a grant now. On your twin (`out`) that is the owner withdrawing it; on
 * someone else's (`in`) it is you, the borrower, saying you are finished.
 */
export function endGrant(id) {
  const db = getDb();
  settle();
  const g = db.prepare('SELECT * FROM grants WHERE id = ?').get(id);
  if (!g) throw bad('No such share.', 'NOT_FOUND');
  if (!['active', 'pending'].includes(g.status)) throw bad('This share has already ended.', 'ENDED');
  const [status, by] = g.direction === 'out' ? ['withdrawn', 'owner']
    : g.status === 'pending' ? ['withdrawn', 'borrower'] : ['done', 'borrower'];
  db.prepare('UPDATE grants SET status = ?, ended_by = ?, ended_at = ? WHERE id = ?').run(status, by, nowIso(), id);
  if (g.person_id && g.direction === 'in' && status === 'done') {
    db.prepare("UPDATE people SET status = 'pending', consent_scope = 'Finished', representation = 'Finished using their likeness' WHERE id = ?").run(g.person_id);
  }
  return grantById(id);
}

// Dates in the words people read are their own day, not UTC's.
const onDay = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const ENDED_WORDS = {
  ended: (g) => `ended on ${onDay(g.ended_at ?? g.ends_at)} when its time ran out`,
  done: (g) => `was marked finished on ${onDay(g.ended_at)}`,
  withdrawn: (g) => `was withdrawn on ${onDay(g.ended_at)}`,
  pending: () => 'has not been accepted yet',
  declined: () => 'was declined',
};

/**
 * May this presenter be used for something new? A presenter no grant governs
 * (yourself, a stock HeyGen presenter) always may. One that grants govern may
 * only while one of them is active.
 */
export function usable(presenterId) {
  if (!presenterId) return { ok: true, governed: false };
  settle();
  const personId = getDb().prepare('SELECT person_id FROM presenters WHERE id = ?').get(presenterId)?.person_id ?? null;
  // Only someone else's likeness lent to you limits what you make. Lending
  // your own twin out never stops you using it.
  const rows = getDb().prepare(
    "SELECT * FROM grants WHERE direction = 'in' AND (presenter_id = ? OR (person_id IS NOT NULL AND person_id = ?)) ORDER BY id DESC"
  ).all(presenterId, personId);
  if (!rows.length) return { ok: true, governed: false };
  const active = rows.find((g) => g.status === 'active');
  if (active) return { ok: true, governed: true, grant: shape(active) };
  const last = rows[0];
  const name = getDb().prepare('SELECT name FROM presenters WHERE id = ?').get(presenterId)?.name ?? 'This presenter';
  return {
    ok: false, governed: true, grant: shape(last),
    reason: `${name}: the share ${(ENDED_WORDS[last.status] ?? (() => 'is not active'))(last)}. Nothing new can be made with them.`,
  };
}

export function assertUsable(presenterId) {
  const u = usable(presenterId);
  if (!u.ok) throw bad(u.reason, 'GRANT_ENDED');
  return u;
}
