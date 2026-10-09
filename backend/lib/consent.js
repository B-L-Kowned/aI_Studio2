import { getDb } from '../db/index.js';
import { createGrant } from './grants.js';

/*
 * The studio's half of collaborator consent. Invites are created on the
 * consent service (public, so the collaborator can open it) and their answers
 * are fetched back from it — this Mac reaches out, nothing reaches in.
 * Without CONSENT_URL / CONSENT_TOKEN the studio says so plainly instead of
 * making links nobody else can open.
 */

const URL_ = () => String(process.env.CONSENT_URL || '').replace(/\/$/, '');
const TOKEN = () => process.env.CONSENT_TOKEN || '';
export const consentReady = () => !!(URL_() && TOKEN());

const bad = (message, code = 'BAD_REQUEST') => Object.assign(new Error(message), { code });
const SCOPE_WORDS = { production: 'This video', series: 'This series', workspace: 'Workspace' };
const ROLE_WORDS = { camera: 'On camera', voice: 'Voice', approve: 'Approves videos' };

async function call(method, path, body) {
  if (!consentReady()) throw bad('Invites need the consent service — set CONSENT_URL and CONSENT_TOKEN for the backend.', 'NOT_CONFIGURED');
  let res;
  try {
    res = await fetch(`${URL_()}${path}`, {
      method, headers: { Authorization: `Bearer ${TOKEN()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
  } catch { throw bad('The consent service could not be reached.', 'UNREACHABLE'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw bad(json.message || `The consent service answered ${res.status}.`, json.error || 'CONSENT_FAILED');
  return json.data;
}

/** Invite someone: a person row here, an invite (and its email) there. */
export async function invite({ name, email, role = 'camera', scope = 'production', scopeLabel = '', note = '', owner = '', days = 7 }) {
  const db = getDb();
  if (!String(name ?? '').trim()) throw bad('Who is this invite for?', 'NAME_REQUIRED');
  const remote = await call('POST', '/api/invites', { name, email, role, scope, scopeLabel, note, owner: owner || ownerName(), days: days || null });
  const position = db.prepare('SELECT COUNT(*) n FROM people').get().n;
  const id = db.prepare(`INSERT INTO people (name, role, representation, consent_scope, status, position, email, invite_id, invite_url, invite_role, invite_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(remote.name, 'Guest', remote.emailed ? 'Invite emailed' : 'Invite ready — send the link',
    'Pending', 'pending', position, remote.email, remote.id, remote.url, role, remote.status).lastInsertRowid;
  // Their likeness, lent to you once they agree, for as long as they choose.
  createGrant({
    direction: 'in', personId: id, counterpart: remote.name, email: remote.email, status: 'pending',
    scopes: role === 'voice' ? ['voice'] : ['appearance', 'voice'], days: days || null, source: 'invite', inviteId: remote.id,
  });
  return { id, emailed: remote.emailed, emailError: remote.emailError, url: remote.url };
}

function ownerName() {
  return getDb().prepare("SELECT name FROM people WHERE role LIKE '%Owner%' ORDER BY id LIMIT 1").get()?.name || 'The studio owner';
}

/** Fetch every answer and bring each person up to date. */
let lastSync = 0;
export async function syncConsent({ force = false } = {}) {
  if (!consentReady() || (!force && Date.now() - lastSync < 30_000)) return { synced: false };
  lastSync = Date.now();
  const { invites } = await call('GET', '/api/invites');
  const db = getDb();
  const upd = db.prepare('UPDATE people SET status = ?, representation = ?, consent_scope = ?, invite_status = ? WHERE invite_id = ?');
  let changed = 0;
  for (const i of invites) {
    const row = db.prepare('SELECT * FROM people WHERE invite_id = ?').get(i.id);
    if (!row || row.invite_status === i.status) continue;
    const a = i.answer ?? {};
    const allowed = [a.appearance && 'Appearance', a.voice && 'Voice'].filter(Boolean).join(' + ');
    const [status, rep, scope] = {
      approved: ['approved', allowed || 'Approved', SCOPE_WORDS[a.scope] ?? 'Approved'],
      declined: ['pending', 'Declined', 'None'],
      withdrawn: ['pending', 'Consent withdrawn', 'None'],
      revoked: ['pending', 'Invite withdrawn', 'None'],
      opened: ['pending', 'Opened the invite', 'Pending'],
      sent: ['pending', row.representation, 'Pending'],
    }[i.status] ?? ['pending', row.representation, row.consent_scope];
    upd.run(status, rep, scope, i.status, i.id);
    changed++;
  }
  // The grant follows the answer: when it starts, when it ends, how it ended.
  const g = db.prepare('UPDATE grants SET status = ?, starts_at = COALESCE(?, starts_at), ends_at = ?, days = ?, ended_at = ?, ended_by = ? WHERE invite_id = ? AND direction = \'in\'');
  for (const i of invites) {
    const answered = i.answeredAt ? new Date(`${i.answeredAt.replace(' ', 'T')}Z`).toISOString() : null;
    const now = new Date().toISOString();
    const [st, endedAt, by] = {
      approved: ['active', null, null],
      expired: ['ended', i.endsAt, 'time'],
      finished: ['done', i.endsAt ?? now, 'borrower'],
      withdrawn: ['withdrawn', now, 'owner'],
      revoked: ['withdrawn', now, 'borrower'],
      declined: ['declined', null, null],
    }[i.status] ?? ['pending', null, null];
    const cur = db.prepare("SELECT status, ended_at FROM grants WHERE invite_id = ? AND direction = 'in'").get(i.id);
    if (!cur || (cur.status === st)) continue;
    g.run(st, answered, i.endsAt ?? null, i.days ?? null, cur.ended_at ?? endedAt, by, i.id);
  }
  return { synced: true, changed };
}

export async function withdrawInvite(personId) {
  const row = getDb().prepare('SELECT * FROM people WHERE id = ?').get(personId);
  if (!row?.invite_id) throw bad('No invite to withdraw.', 'NOT_FOUND');
  await call('DELETE', `/api/invites/${row.invite_id}`);
  getDb().prepare("UPDATE people SET status = 'pending', representation = 'Invite withdrawn', invite_status = 'revoked' WHERE id = ?").run(personId);
}

/** Tell their page you are finished with their likeness. */
export async function finishInvite(inviteId) {
  if (!inviteId || !consentReady()) return false;
  try { await call('POST', `/api/invites/${inviteId}/finish`); return true; } catch { return false; }
}

export const roleWord = (r) => ROLE_WORDS[r] ?? null;
