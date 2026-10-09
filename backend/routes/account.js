import { Router } from 'express';
import { accountState, startSignIn, finishSignIn, signOut } from '../lib/authentech.js';
import { ok, fail, route } from '../utils/respond.js';

const router = Router();

router.get('/account', route(async (_req, res) => ok(res, await accountState())));

/** Where to send the browser. It comes back to /account/callback on this machine. */
router.post('/account/sign-in', route(async (req, res) => {
  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/account/callback`;
    return ok(res, { url: startSignIn({ redirectUri, createAccount: req.body?.createAccount === true }) });
  } catch (err) { return fail(res, err.code === 'NOT_CONFIGURED' ? 503 : 400, err.code ?? 'BAD_REQUEST', err.message); }
}));

const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:15px/1.5 -apple-system,system-ui,sans-serif;background:#f6f5f2;color:#1b1b1a;display:grid;place-items:center;min-height:90vh;margin:0 16px">
<main style="max-width:420px;background:#fff;border:1px solid #e4e2dc;border-radius:10px;padding:22px 24px"><h1 style="font-size:18px;margin:0 0 6px">${title}</h1><p style="margin:0;color:#5c5b57">${body}</p></main></body>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

router.get('/account/callback', route(async (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (req.query.error) {
    return res.status(400).send(page('Not signed in', esc(req.query.error_description || 'You cancelled, or AuthenTech could not sign you in.') + ' You can close this tab.'));
  }
  try {
    const a = await finishSignIn({ code: req.query.code, state: req.query.state });
    return res.send(page('Signed in', `You are signed in${a.profile?.name ? ` as ${esc(a.profile.name)}` : ''}. Close this tab and go back to AI Video Studio.`));
  } catch (err) {
    return res.status(400).send(page('Not signed in', esc(err.message)));
  }
}));

router.post('/account/sign-out', route(async (_req, res) => { await signOut(); return ok(res, await accountState(), 'Signed out'); }));

export default router;
