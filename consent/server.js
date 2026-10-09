import express from 'express';
import Database from 'better-sqlite3';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/*
 * Consent for AI Video Studio collaborators.
 *
 * The studio runs on its owner's Mac, which no one else can reach, so the page
 * a collaborator opens has to live somewhere public — here. The studio creates
 * an invite (this sends the email), the collaborator answers on a page of
 * their own, and the studio fetches the answers back. Nothing here can reach
 * into the studio, and the only thing the studio pushes is the invite itself.
 *
 *   studio  → POST /api/invites            create + email      (Bearer token)
 *   studio  → GET  /api/invites            statuses + answers  (Bearer token)
 *   studio  → DELETE /api/invites/:id      withdraw an invite  (Bearer token)
 *   person  → GET  /i/:token               their consent page
 *   person  → POST /i/:token               approve / decline
 *   person  → POST /i/:token/withdraw      take consent back
 */

const PORT = Number(process.env.PORT || 3633);
const PUBLIC_URL = String(process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const STUDIO_TOKEN = process.env.STUDIO_TOKEN || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || '';
const DB_PATH = resolve(process.env.DB_PATH || './data/consent.db');

if (!STUDIO_TOKEN || STUDIO_TOKEN.length < 24) {
  console.error('[consent] STUDIO_TOKEN must be set (24+ characters) — the studio uses it to create invites.');
  process.exit(1);
}

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL,          -- camera | voice | approve
  scope       TEXT NOT NULL,          -- what the owner asks for: production | series | workspace
  scope_label TEXT NOT NULL DEFAULT '',
  owner       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'sent',   -- sent | opened | approved | declined | withdrawn | revoked
  answer      TEXT,                   -- JSON: { appearance, voice, scope, signedName, comment }
  emailed     INTEGER NOT NULL DEFAULT 0,
  email_error TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  opened_at   TEXT,
  answered_at TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);
// How long consent lasts: proposed in days by the owner (NULL = until withdrawn),
// chosen by the person, and the moment it ends once they agree.
for (const [col, type] of [['days', 'INTEGER'], ['ends_at', 'TEXT']]) {
  if (!db.prepare('PRAGMA table_info(invites)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE invites ADD COLUMN ${col} ${type}`);
}
const DAY_CHOICES = [7, 30, 90];
const untilWords = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const howLong = (days) => (days ? `${days} days` : 'until withdrawn');
// Consent past its end date is over, whoever looks first.
const settle = () => db.prepare("UPDATE invites SET status = 'expired', updated_at = datetime('now') WHERE status = 'approved' AND ends_at IS NOT NULL AND ends_at <= ?").run(new Date().toISOString());

const ROLES = {
  camera: { label: 'appear on camera', asks: ['appearance', 'voice'] },
  voice: { label: 'lend your voice', asks: ['voice'] },
  approve: { label: 'review and approve videos you appear in', asks: ['appearance'] },
};
const SCOPES = { production: 'one video', series: 'every video in one series', workspace: 'every video they make, until you withdraw' };

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cache-Control': 'no-store',
  });
  next();
});

const reply = (res, status, data, message = 'Success', error = null) => res.status(status).json({ data, error, message });
const fail = (res, status, code, message) => reply(res, status, null, message, code);

function studioOnly(req, res, next) {
  const given = Buffer.from(String(req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(STUDIO_TOKEN);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return fail(res, 401, 'UNAUTHORIZED', 'Not the studio');
  return next();
}

const view = (r) => ({
  id: r.id, name: r.name, email: r.email, role: r.role, scope: r.scope, scopeLabel: r.scope_label, status: r.status,
  answer: r.answer ? JSON.parse(r.answer) : null, emailed: !!r.emailed, emailError: r.email_error,
  createdAt: r.created_at, openedAt: r.opened_at, answeredAt: r.answered_at, updatedAt: r.updated_at,
  days: r.days ?? null, endsAt: r.ends_at ?? null,
  url: `${PUBLIC_URL}/i/${r.token}`,
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function sendInvite(r) {
  if (!RESEND_API_KEY || !MAIL_FROM) return { emailed: false, error: 'Email is not set up on the consent service (RESEND_API_KEY / MAIL_FROM).' };
  const role = ROLES[r.role];
  const url = `${PUBLIC_URL}/i/${r.token}`;
  const text = `Hi ${r.name},\n\n${r.owner} would like you to ${role.label} in their videos, for ${r.scope_label || SCOPES[r.scope]} — ${r.days ? `for ${r.days} days` : 'until you withdraw it'}.\n`
    + `${r.note ? `\n"${r.note}"\n` : ''}\nYou decide what is allowed, and you can take it back at any time:\n${url}\n\nNothing is used until you agree.`;
  const html = `<div style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#17181a;max-width:520px">
    <p>Hi ${esc(r.name)},</p>
    <p><b>${esc(r.owner)}</b> would like you to ${esc(role.label)} in their videos, for ${esc(r.scope_label || SCOPES[r.scope])} — ${r.days ? `for ${r.days} days` : 'until you withdraw it'}.</p>
    ${r.note ? `<p style="border-left:3px solid #d9d8d3;padding-left:12px;color:#55575c">${esc(r.note)}</p>` : ''}
    <p>You decide what is allowed, and you can take it back at any time.</p>
    <p><a href="${esc(url)}" style="display:inline-block;background:#17181a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Review and decide</a></p>
    <p style="color:#8a8c91;font-size:13px">Nothing is used until you agree.</p></div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [r.email], subject: `${r.owner} invited you to appear in their videos`, text, html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { emailed: false, error: `Email was not sent (${res.status}).` };
    return { emailed: true, error: null };
  } catch {
    return { emailed: false, error: 'Email could not be reached.' };
  }
}

// ---------------------------------------------------------------- studio
app.post('/api/invites', studioOnly, async (req, res) => {
  const b = req.body ?? {};
  const name = String(b.name ?? '').trim().slice(0, 80);
  const email = String(b.email ?? '').trim().toLowerCase().slice(0, 160);
  const role = String(b.role ?? 'camera');
  const scope = String(b.scope ?? 'production');
  if (!name) return fail(res, 400, 'NO_NAME', 'Who is this invite for?');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'BAD_EMAIL', 'That email address does not look right.');
  if (!ROLES[role]) return fail(res, 400, 'BAD_ROLE', 'Role must be camera, voice or approve.');
  if (!SCOPES[scope]) return fail(res, 400, 'BAD_SCOPE', 'Scope must be production, series or workspace.');
  const days = b.days == null || b.days === '' ? null : Number(b.days);
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)) return fail(res, 400, 'BAD_DAYS', 'Days must be 1–365, or empty for until withdrawn.');
  const row = {
    id: randomUUID(), token: randomBytes(24).toString('base64url'), name, email, role, scope,
    days, scope_label: String(b.scopeLabel ?? '').trim().slice(0, 140), owner: String(b.owner ?? 'The studio owner').trim().slice(0, 80),
    note: String(b.note ?? '').trim().slice(0, 600),
  };
  db.prepare(`INSERT INTO invites (id, token, name, email, role, scope, scope_label, owner, note, days)
    VALUES (@id, @token, @name, @email, @role, @scope, @scope_label, @owner, @note, @days)`).run(row);
  const sent = await sendInvite(row);
  db.prepare("UPDATE invites SET emailed = ?, email_error = ?, updated_at = datetime('now') WHERE id = ?").run(sent.emailed ? 1 : 0, sent.error, row.id);
  return reply(res, 201, view(db.prepare('SELECT * FROM invites WHERE id = ?').get(row.id)), sent.emailed ? `Invite emailed to ${email}` : 'Invite created — copy the link to send it');
});

app.get('/api/invites', studioOnly, (req, res) => {
  settle();
  const since = String(req.query.since ?? '');
  const rows = since
    ? db.prepare('SELECT * FROM invites WHERE updated_at > ? ORDER BY created_at DESC').all(since)
    : db.prepare('SELECT * FROM invites ORDER BY created_at DESC LIMIT 500').all();
  return reply(res, 200, { invites: rows.map(view), now: db.prepare("SELECT datetime('now') n").get().n });
});

// The studio is finished with their likeness: it ends now, and their page says so.
app.post('/api/invites/:id/finish', studioOnly, (req, res) => {
  const r = db.prepare('SELECT * FROM invites WHERE id = ?').get(req.params.id);
  if (!r) return fail(res, 404, 'NOT_FOUND', 'No such invite.');
  db.prepare("UPDATE invites SET status = 'finished', ends_at = COALESCE(ends_at, ?), updated_at = datetime('now') WHERE id = ? AND status IN ('approved','sent','opened')")
    .run(new Date().toISOString(), r.id);
  return reply(res, 200, view(db.prepare('SELECT * FROM invites WHERE id = ?').get(r.id)));
});

app.delete('/api/invites/:id', studioOnly, (req, res) => {
  const r = db.prepare('SELECT * FROM invites WHERE id = ?').get(req.params.id);
  if (!r) return fail(res, 404, 'NOT_FOUND', 'No such invite');
  db.prepare("UPDATE invites SET status = 'revoked', updated_at = datetime('now') WHERE id = ?").run(r.id);
  return reply(res, 200, view(db.prepare('SELECT * FROM invites WHERE id = ?').get(r.id)), 'Invite withdrawn');
});

// ---------------------------------------------------------------- the person
const PAGE = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>
:root{--ink:#17181a;--ink2:#3c3e43;--muted:#6b6d72;--line:#e3e2de;--canvas:#f6f6f4;--accent:#3d4fd8;--ok:#1f7a55;--warn:#a5631a}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:560px;margin:0 auto;padding:40px 18px 64px}.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px 22px}
h1{font-size:20px;line-height:1.3;margin:0 0 6px;letter-spacing:-.01em}p{margin:0 0 12px;color:var(--ink2)}.muted{color:var(--muted);font-size:13px}
blockquote{margin:12px 0;padding:0 0 0 12px;border-left:3px solid var(--line);color:var(--muted)}
fieldset{border:0;padding:0;margin:18px 0 0}legend{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
label.opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;cursor:pointer}
label.opt input{margin-top:4px}label.opt b{display:block;font-weight:600;font-size:14px}label.opt span{color:var(--muted);font-size:13px}
input[type=text]{width:100%;font:inherit;padding:10px 12px;border:1px solid #cfcec9;border-radius:9px;margin-top:6px}
.row{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}button{font:inherit;font-weight:600;padding:10px 18px;border-radius:9px;border:1px solid #cfcec9;background:#fff;cursor:pointer}
button.primary{background:var(--ink);color:#fff;border-color:var(--ink)}.ok{color:var(--ok)}.warn{color:var(--warn)}
</style></head><body><main><div class="card">${body}</div><p class="muted" style="margin-top:14px;text-align:center">Your answer goes only to the person who invited you.</p></main></body></html>`;

app.get('/i/:token', (req, res) => {
  const r = db.prepare('SELECT * FROM invites WHERE token = ?').get(req.params.token);
  if (!r || r.status === 'revoked') return res.status(404).type('html').send(PAGE('Invite not found', '<h1>This invite is no longer open</h1><p>It may have been withdrawn. Ask the person who sent it for a new one.</p>'));
  settle();
  const fresh = db.prepare('SELECT * FROM invites WHERE id = ?').get(r.id);
  Object.assign(r, fresh);
  if (r.status === 'sent') db.prepare("UPDATE invites SET status = 'opened', opened_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(r.id);
  const role = ROLES[r.role];
  const a = r.answer ? JSON.parse(r.answer) : null;
  if (['approved', 'declined', 'withdrawn', 'expired', 'finished'].includes(r.status)) {
    const allowed = [a?.appearance && 'your appearance', a?.voice && 'your voice'].filter(Boolean).join(' and ');
    const what = {
      approved: `<p class="ok"><b>You agreed</b> — ${allowed}, for ${esc(SCOPES[a?.scope] ?? SCOPES[r.scope])}, ${r.ends_at ? `until <b>${esc(untilWords(r.ends_at))}</b>` : 'until you withdraw it'}.</p>
         <p>It ends by itself then. You can also end it now:</p>
         <form method="post" action="/i/${esc(r.token)}/withdraw"><div class="row"><button type="submit">End my consent now</button></div></form>`,
      declined: '<p>You declined. Nothing of yours will be used.</p>',
      withdrawn: '<p class="warn">You ended your consent. Nothing new will be made with your likeness.</p>',
      expired: `<p>Your consent ended on ${esc(untilWords(r.ends_at))}, as agreed. Nothing new will be made with your likeness.</p>`,
      finished: `<p>${esc(r.owner)} has finished using your likeness, so your consent has ended. Nothing new will be made with it.</p>`,
    }[r.status];
    return res.type('html').send(PAGE('Your answer', `<h1>Thanks, ${esc(r.name)}</h1>${what}`));
  }
  const opt = (k, title, sub) => (role.asks.includes(k)
    ? `<label class="opt"><input type="checkbox" name="${k}" value="1" checked><span><b>${title}</b><span>${sub}</span></span></label>` : '');
  const scopeOpt = (k) => `<label class="opt"><input type="radio" name="scope" value="${k}" ${k === r.scope ? 'checked' : ''}><span><b>${k === 'production' ? 'One video' : k === 'series' ? 'One series' : 'All their videos'}</b><span>${k === r.scope && r.scope_label ? esc(r.scope_label) : esc(SCOPES[k])}</span></span></label>`;
  return res.type('html').send(PAGE('Your consent', `
    <h1>${esc(r.owner)} invited you to ${esc(role.label)}</h1>
    <p>Here is exactly what you would allow. Choose what is fine with you; you can withdraw it later from this same page.</p>
    ${r.note ? `<blockquote>${esc(r.note)}</blockquote>` : ''}
    <form method="post" action="/i/${esc(r.token)}">
      <fieldset><legend>What may be used</legend>
        ${opt('appearance', 'Your appearance', 'Your face and likeness, as an AI avatar or in recordings, in finished videos.')}
        ${opt('voice', 'Your voice', 'Your voice, recorded or as an AI voice made from a sample you provide.')}
      </fieldset>
      <fieldset><legend>For which videos</legend>${['production', 'series', 'workspace'].map(scopeOpt).join('')}</fieldset>
      <fieldset><legend>For how long</legend>${[...new Set([...(r.days ? [r.days] : []), ...DAY_CHOICES])].sort((x, y) => x - y).map((d) => `<label class="opt"><input type="radio" name="days" value="${d}" ${d === r.days ? 'checked' : ''}><span><b>${d} days</b><span>Ends by itself on ${esc(untilWords(new Date(Date.now() + d * 86400000).toISOString()))}${d === r.days ? ' · what was asked for' : ''}</span></span></label>`).join('')}
        <label class="opt"><input type="radio" name="days" value="" ${r.days ? '' : 'checked'}><span><b>Until I end it</b><span>You can end it from this page at any time.</span></span></label></fieldset>
      <fieldset><legend>Sign</legend><label>Type your full name<input type="text" name="signedName" required maxlength="80" autocomplete="name"></label></fieldset>
      <fieldset><legend>Anything to add (optional)</legend><input type="text" name="comment" maxlength="400"></fieldset>
      <div class="row"><button class="primary" type="submit" name="decision" value="approve">I agree</button><button type="submit" name="decision" value="decline" formnovalidate>No, thanks</button></div>
    </form>`));
});

app.post('/i/:token', (req, res) => {
  const r = db.prepare('SELECT * FROM invites WHERE token = ?').get(req.params.token);
  if (!r || r.status === 'revoked') return res.status(404).type('html').send(PAGE('Invite not found', '<h1>This invite is no longer open</h1>'));
  const b = req.body ?? {};
  if (b.decision === 'decline') {
    db.prepare("UPDATE invites SET status = 'declined', answer = ?, answered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify({ comment: String(b.comment ?? '').slice(0, 400) }), r.id);
    return res.redirect(303, `/i/${r.token}`);
  }
  const signedName = String(b.signedName ?? '').trim().slice(0, 80);
  const answer = { appearance: b.appearance === '1', voice: b.voice === '1', scope: SCOPES[b.scope] ? b.scope : r.scope, signedName, comment: String(b.comment ?? '').slice(0, 400) };
  if (!signedName || (!answer.appearance && !answer.voice)) {
    return res.status(400).type('html').send(PAGE('Almost there', '<h1>Almost there</h1><p>Tick at least one thing you allow, and type your name to sign.</p><p><a href="">Go back</a></p>'));
  }
  const chosen = b.days == null || b.days === '' ? null : Number(b.days);
  const days = Number.isInteger(chosen) && chosen >= 1 && chosen <= 365 ? chosen : null;
  const endsAt = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
  db.prepare("UPDATE invites SET status = 'approved', answer = ?, days = ?, ends_at = ?, answered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify({ ...answer, days }), days, endsAt, r.id);
  return res.redirect(303, `/i/${r.token}`);
});

app.post('/i/:token/withdraw', (req, res) => {
  const r = db.prepare('SELECT * FROM invites WHERE token = ?').get(req.params.token);
  if (r && r.status === 'approved') db.prepare("UPDATE invites SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?").run(r.id);
  return res.redirect(303, `/i/${req.params.token}`);
});

app.get('/health', (req, res) => reply(res, 200, { ok: true, email: !!(RESEND_API_KEY && MAIL_FROM) }));
app.use((req, res) => res.status(404).type('text').send('Not found'));

app.listen(PORT, () => console.log(`[consent] listening on ${PORT}, public at ${PUBLIC_URL}, email ${RESEND_API_KEY && MAIL_FROM ? 'on' : 'off'}`));
