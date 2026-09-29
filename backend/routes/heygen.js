import { Router } from 'express';
import * as mcp from '../lib/providers/heygen-mcp.js';
import { rememberVideo, syncVideos, playableUrl, attachToProduction } from '../lib/video-library.js';
import { listConnections } from '../lib/connections.js';
import { chooseRenderPath, mcpCapabilities, invalidateCapabilityCache } from '../lib/providers/heygen-route.js';
import { getDb } from '../db/index.js';
import { ok, fail, route } from '../utils/respond.js';

/** Record an imported HeyGen video as a Library asset. */
// Storage moved to lib/video-library.js, which actually keeps the video.

const router = Router();

/**
 * Which pocket is in use, and why it matters.
 *
 *   mcp  spends the credits in the user's HeyGen WEB plan — the one they pay for
 *   key  spends a SEPARATE pay-as-you-go balance; a Creator/Pro web subscription
 *        funds none of it
 *
 * Reporting this is the whole point: the two look identical once a render
 * succeeds, and the difference is a second bill.
 */
router.get(
  '/heygen/status',
  route(async (_req, res) => {
    const m = mcp.mcpStatus();
    const key = listConnections().find((c) => c.id === 'heygen');
    const pocket = m.connected ? 'mcp' : key?.connected ? 'key' : 'none';

    let account = null;
    let credits = null;
    if (m.connected) {
      try {
        account = await mcp.account();
        credits = mcp.creditsRemaining(account);
      } catch (err) {
        account = { error: err.message };
      }
    }

    return ok(res, {
      pocket,
      mcp: m,
      plan: account?.subscription?.plan ?? account?.plan ?? null,
      credits,
      renderPath: await chooseRenderPath(),
      capabilities: await mcpCapabilities(),
      key: { connected: !!key?.connected, verified: !!key?.verified, hint: key?.hint ?? null },
      explanation: {
        mcp: 'Spends the credits in your HeyGen web plan, and reaches the avatars, outfits and cloned voices that account already owns.',
        key: 'Billed against a separate pay-as-you-go balance. A Creator/Pro web subscription funds none of it.',
        none: 'Not connected. Sign in over MCP to use the plan you already pay for.',
      }[pocket],
      // Stated plainly so the fallback is never chosen by accident.
      recommendation: pocket === 'key'
        ? 'You are on the API key, which bills separately from your web plan. Sign in over MCP to use the plan you pay for.'
        : null,
    });
  })
);

router.post(
  '/heygen/connect',
  route(async (req, res) => {
    // The redirect must match what gets registered, and the backend's port can
    // move, so it is derived per connect rather than stored.
    const port = req.socket.localPort;
    const redirectUri = req.body?.redirectUri || `http://127.0.0.1:${port}/api/heygen/callback`;
    try {
      const { url, consentNameIsOverridden } = await mcp.beginAuthorization(redirectUri);
      return ok(res, { url, redirectUri, consentNameIsOverridden },
        'Open this URL to sign in to HeyGen');
    } catch (err) {
      return fail(res, 502, 'MCP_ERROR', err.message);
    }
  })
);

// Hit by the system browser, which carries no app session — so it is
// unauthenticated by necessity and answers with a page, not JSON.
router.get(
  '/heygen/callback',
  route(async (req, res) => {
    const { code, state, error, error_description: desc } = req.query;
    const page = (title, body) => res
      .status(error ? 400 : 200)
      .type('html')
      .send(`<!doctype html><meta charset="utf-8"><title>${title}</title>
        <body style="font:15px -apple-system,system-ui,sans-serif;margin:0;display:grid;
                     place-items:center;height:100vh;background:#f6f6f4;color:#17181a">
          <div style="max-width:30rem;padding:2rem;background:#fff;border:1px solid #e5e4e1;border-radius:9px">
            <h1 style="font-size:17px;margin:0 0 .5rem">${title}</h1>
            <p style="color:#3f4145;line-height:1.55;margin:0">${body}</p>
          </div></body>`);

    if (error) return page('HeyGen sign-in failed', desc || String(error));
    if (!code || !state) return page('HeyGen sign-in failed', 'The callback was missing its code.');

    try {
      await mcp.completeAuthorization(String(code), String(state));
      return page('Connected', 'HeyGen is connected. You can close this tab and return to the studio.');
    } catch (err) {
      return page('HeyGen sign-in failed', err.message);
    }
  })
);

router.get(
  '/heygen/tools',
  route(async (_req, res) => {
    try {
      return ok(res, await mcp.listTools());
    } catch (err) {
      return fail(res, err instanceof mcp.NotConnected ? 409 : 502, 'MCP_ERROR', err.message);
    }
  })
);

router.delete(
  '/heygen',
  route(async (_req, res) => {
    mcp.disconnect();
    return ok(res, mcp.mcpStatus(), 'HeyGen MCP disconnected');
  })
);


// ── what the account actually holds ─────────────────────────────────────────

router.get(
  '/heygen/account',
  route(async (_req, res) => {
    try {
      const acct = await mcp.account();
      return ok(res, { account: acct, credits: mcp.creditsRemaining(acct) });
    } catch (err) {
      return fail(res, err instanceof mcp.NotConnected ? 409 : 502, 'MCP_ERROR', err.message);
    }
  })
);

router.get(
  '/heygen/videos',
  route(async (req, res) => {
    try {
      return ok(res, await mcp.listVideos(Number(req.query.limit ?? 20)));
    } catch (err) {
      return fail(res, err instanceof mcp.NotConnected ? 409 : 502, 'MCP_ERROR', err.message);
    }
  })
);

router.post(
  '/heygen/videos/:id/import',
  route(async (req, res) => {
    try {
      const detail = await mcp.getVideo(req.params.id);
      const url = detail?.video_url;
      // The signed URL expires, so it is resolved here rather than handed to the
      // client to fetch later.
      if (!url) {
        return fail(res, 409, 'NOT_READY',
          `That video is '${detail?.status ?? 'unfinished'}'. Try again once it has rendered.`);
      }
      const name = String(detail?.title || 'HeyGen video');
      rememberVideo({
        remoteId: req.params.id, name, url,
        thumbnailUrl: detail?.thumbnail_url ?? null,
        duration: detail?.duration ?? null,
        status: detail?.status ?? null,
      });
      return ok(res, { name, status: detail?.status ?? 'complete' }, `Imported "${name}" into the Library`);
    } catch (err) {
      return fail(res, err instanceof mcp.NotConnected ? 409 : 502, 'MCP_ERROR', err.message);
    }
  })
);

/** Pull every video in the account into the Library. Reads only; free. */
router.post(
  '/heygen/videos/sync',
  route(async (req, res) => {
    try {
      const r = await syncVideos({ limit: Number(req.body?.limit ?? 100) });
      return ok(res, r,
        `${r.added} new, ${r.updated} updated — ${r.total} videos in your HeyGen account`);
    } catch (err) {
      return fail(res, err.code === 'NOT_CONNECTED' ? 409 : 502, err.code ?? 'MCP_ERROR', err.message);
    }
  })
);

/** A signed, playable URL. Resolved now because HeyGen's expire. */
router.get(
  '/heygen/library/:assetId/play',
  route(async (req, res) => {
    try {
      return ok(res, await playableUrl(Number(req.params.assetId)));
    } catch (err) {
      const status = { NOT_FOUND: 404, NO_REMOTE: 409, NOT_READY: 409 }[err.code] ?? 502;
      return fail(res, status, err.code ?? 'MCP_ERROR', err.message);
    }
  })
);

/** Tie a video to a production and put it on the drive you chose. */
router.post(
  '/heygen/library/:assetId/attach',
  route(async (req, res) => {
    const productionId = Number(req.body?.productionId);
    if (!productionId) return fail(res, 400, 'NO_PRODUCTION', 'Which production?');
    try {
      const r = await attachToProduction(Number(req.params.assetId), productionId, {
        download: req.body?.download !== false,
      });
      return ok(res, r, r.downloaded
        ? `Saved to ${r.path} (${(r.bytes / 1024 / 1024).toFixed(1)} MB)`
        : 'Attached — not downloaded');
    } catch (err) {
      const status = { NOT_FOUND: 404, NOT_READY: 409, NO_REMOTE: 409 }[err.code] ?? 502;
      return fail(res, status, err.code ?? 'ATTACH_FAILED', err.message);
    }
  })
);

router.get(
  '/heygen/voices',
  route(async (req, res) => {
    try {
      // engine=starfish is enforced in the client: create_speech accepts nothing
      // else, so an unfiltered list offers voices that fail after being chosen.
      return ok(res, await mcp.voices({
        priv: req.query.private === 'true',
        language: req.query.language,
        gender: req.query.gender,
        limit: Number(req.query.limit ?? 50),
      }));
    } catch (err) {
      return fail(res, err instanceof mcp.NotConnected ? 409 : 502, 'MCP_ERROR', err.message);
    }
  })
);

router.post(
  '/heygen/speech',
  route(async (req, res) => {
    const { text, voiceId, ssml, speed, locale } = req.body ?? {};
    try {
      // The voice gate: an audition in the voice that will actually ship.
      // COSTS CREDITS from the connected plan.
      return ok(res, await mcp.synthesize(text, voiceId, { ssml, speed, locale }),
        'Audition generated in the voice that will render');
    } catch (err) {
      return fail(res, err instanceof mcp.NotConnected ? 409 : 400, 'MCP_ERROR', err.message);
    }
  })
);

router.post(
  '/heygen/refresh-capabilities',
  route(async (_req, res) => {
    invalidateCapabilityCache();
    return ok(res, await mcpCapabilities({ force: true }), 'Re-read what the server exposes');
  })
);

export default router;
