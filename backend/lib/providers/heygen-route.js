import * as mcp from './heygen-mcp.js';
import { getDb } from '../../db/index.js';
import { providerMode } from './mode.js';

// Which pocket a render should come out of, decided from what the MCP server
// ACTUALLY exposes rather than from an assumption.
//
// artificial_funny renders through the API key and uses MCP only for account,
// credits, voices and audio auditions — so a generation tool may not exist on
// the MCP server at all. `tools/list` is free and definitive, so it is the
// thing consulted, and the answer is cached until the connection changes.

import { STUDIO_TOOL } from './heygen-studio.js';

// Named, not matched. A name-shaped heuristic picked
// `create_video_from_cinematic_avatar`, which takes a natural-language prompt
// and returns 4-15 seconds — it would have rendered something unrelated to the
// script and looked like it worked. Only tools whose CONTRACT matches a scripted
// multi-speaker production belong here, in preference order.
const RENDER_TOOLS = [STUDIO_TOOL];

let cache = null; // { at, tools, generateTool }

export function invalidateCapabilityCache() {
  cache = null;
}

/** Is an API key stored for HeyGen? The value is never read here. */
function hasStoredKey() {
  return !!getDb()
    .prepare('SELECT 1 FROM credentials WHERE provider = ?')
    .get('heygen');
}

/**
 * What this account's MCP server can do. Costs nothing; result is cached so the
 * render path does not pay a round trip per job.
 */
export async function mcpCapabilities({ force = false } = {}) {
  if (!mcp.isConnected()) {
    return { connected: false, tools: [], canGenerateVideo: false, generateTool: null };
  }
  if (cache && !force && Date.now() - cache.at < 10 * 60 * 1000) return cache.value;

  let tools = [];
  let error = null;
  try {
    tools = await mcp.listTools();
  } catch (err) {
    error = err.message;
  }

  const names = tools.map((t) => t.name).filter(Boolean);
  const generateTool = RENDER_TOOLS.find((t) => names.includes(t)) ?? null;

  const value = {
    connected: true,
    tools: names,
    canGenerateVideo: !!generateTool,
    generateTool,
    error,
  };
  cache = { at: Date.now(), value };
  return value;
}

/**
 * Decide the pocket for the next render.
 *   mcp  → spends the HeyGen web plan the user already pays for
 *   key  → spends a separate pay-as-you-go balance
 *
 * THE MODE IS PART OF THE DECISION, because the two pockets do not have the
 * same free option. `create_video_from_studio` has no `test` parameter — its
 * schema is scenes/title/folderId/aspectRatio/resolution/brandGlossaryId/
 * callbackUrl/callbackId/caption and nothing else — so the only render it can
 * perform is a real, billed one. The API key's `/v2/video/generate` does take
 * `test: true`, which HeyGen renders watermarked and free.
 *
 * So Test mode cannot render through MCP. It used to: the mode said "Renders
 * use HeyGen's own test mode — watermarked, free" while this function ignored
 * the mode entirely and the caller submitted a full render against the plan.
 * A mode that promises not to spend must either keep the promise or refuse the
 * job — quietly billing instead is the one thing it must not do.
 */
export async function chooseRenderPath({ mode = providerMode() } = {}) {
  const caps = await mcpCapabilities();
  const keyStored = hasStoredKey();

  if (mode === 'fixtures') {
    return {
      path: 'fixtures', tool: null, testMode: true, free: true,
      reason: 'Fixtures mode — nothing leaves this machine, so the render is simulated.',
    };
  }

  const mcpCanRender = caps.connected && caps.canGenerateVideo;

  if (mode === 'live_read') {
    if (keyStored) {
      return {
        path: 'key', tool: null, testMode: true, free: true,
        reason: mcpCanRender
          ? "Test mode renders through the API key with HeyGen's own test flag — watermarked and free. "
            + 'The plan path has no test mode, so it is not used here.'
          : "Test mode renders through the API key with HeyGen's own test flag — watermarked and free.",
      };
    }
    return {
      path: 'none', tool: null, testMode: true, free: true,
      warning: 'NO_FREE_PATH',
      reason: mcpCanRender
        ? 'Test mode must not spend, but the plan path (create_video_from_studio) has no test mode — '
          + 'its only render is a real one. Switch to Live to render on your plan, or connect an API key '
          + 'to render watermarked test videos for free.'
        : 'Test mode has no free render path: no API key is stored and the MCP server exposes no '
          + 'video-generation tool.',
    };
  }

  // Live. Prefer the plan the user already pays for.
  if (mcpCanRender) {
    return {
      path: 'mcp', tool: caps.generateTool, testMode: false, free: false,
      reason: 'Signed in over MCP and the server exposes a video-generation tool, so this spends your HeyGen plan.',
    };
  }
  if (caps.connected) {
    return {
      path: keyStored ? 'key' : 'none', tool: null, testMode: false, free: false,
      reason: keyStored
        ? "Signed in over MCP, but this account's MCP server exposes no video-generation tool, so the render falls back to the API key — which bills separately from your plan."
        : "Signed in over MCP, but the server exposes no video-generation tool and no API key is stored, so a render cannot run.",
      warning: keyStored ? 'SECOND_BILL' : 'NO_PATH',
      toolsSeen: caps.tools,
    };
  }
  return {
    path: keyStored ? 'key' : 'none', tool: null, testMode: false, free: false,
    reason: keyStored
      ? 'Not signed in over MCP, so the render uses the API key — a separate pay-as-you-go balance from your web plan.'
      : 'No HeyGen connection at all.',
    warning: keyStored ? 'SECOND_BILL' : 'NO_PATH',
  };
}
