import * as mcp from './heygen-mcp.js';

// Rendering a scripted production over MCP, which spends the HeyGen web plan.
//
// TOOL CHOICE MATTERS, and a heuristic got it wrong. The first pass picked
// `create_video_from_cinematic_avatar` because its name matched "create…video".
// That tool takes a natural-language PROMPT and returns 4–15 seconds — it is
// prompt-to-video, not "render this script with these people saying these
// lines", and it would have silently produced something unrelated to the plan.
//
// `create_video_from_studio` is the one that matches: "compose an ordered list
// of whole-frame scenes", 1–50 of them, each an avatar speaking a script. That
// is exactly outline → scenes → segments.
//
// Shapes below are read from the live tool schema, not guessed:
//   scenes[]            { type: 'avatar_video', input: StudioAvatarInput }
//   StudioAvatarInput   requires type + avatar_id; script pairs with voice_id,
//                       and voice_id may be omitted to use the avatar's default.

export const STUDIO_TOOL = 'create_video_from_studio';
export const MAX_SCENES = 50;

/** HeyGen caps a studio render at 50 scenes, so segments are merged per speaker run. */
export function groupIntoScenes(segments, { maxScenes = MAX_SCENES } = {}) {
  const runs = [];
  for (const seg of segments ?? []) {
    const last = runs[runs.length - 1];
    // Consecutive lines by the same cast member belong in one scene; a cut per
    // line would burn the 50-scene budget and look like a stutter.
    if (last && last.avatarId === seg.avatarId && last.voiceId === seg.voiceId) {
      last.text += ' ' + seg.text;
    } else {
      runs.push({ avatarId: seg.avatarId, voiceId: seg.voiceId, speaker: seg.speaker, text: seg.text });
    }
  }
  if (runs.length <= maxScenes) return runs;

  // Still too many: fold the tail into the last allowed scene rather than
  // dropping lines, which would ship a video missing its ending.
  const head = runs.slice(0, maxScenes - 1);
  const tail = runs.slice(maxScenes - 1);
  head.push({ ...tail[0], text: tail.map((r) => r.text).join(' ') });
  return head;
}

export function buildStudioArgs({ segments, title, aspectRatio = '16:9', resolution = '1080p' }) {
  const runs = groupIntoScenes(segments);
  if (!runs.length) {
    throw Object.assign(new Error('Nothing to render — the script has no lines.'), { code: 'EMPTY' });
  }
  const uncast = runs.filter((r) => !r.avatarId);
  if (uncast.length) {
    throw Object.assign(
      new Error(`No avatar cast for: ${[...new Set(uncast.map((r) => r.speaker))].join(', ')}`),
      { code: 'NOT_CAST' }
    );
  }

  return {
    args: {
      title,
      aspectRatio,
      resolution,
      scenes: runs.map((r) => ({
        type: 'avatar_video',
        input: {
          type: 'avatar',
          avatar_id: r.avatarId,
          script: r.text,
          // Omitted voice_id falls back to the avatar's own default voice.
          ...(r.voiceId ? { voice_id: r.voiceId } : {}),
        },
      })),
    },
    stats: { scenes: runs.length, segments: segments.length, chars: runs.reduce((n, r) => n + r.text.length, 0) },
  };
}

/** Render over MCP. Returns the remote video id to poll. */
export async function renderViaStudio({ segments, title, aspectRatio, resolution }) {
  const { args, stats } = buildStudioArgs({ segments, title, aspectRatio, resolution });
  const result = await mcp.callTool(STUDIO_TOOL, args);

  const videoId =
    result?.video_id ?? result?.videoId ?? result?.id ?? result?.data?.video_id ?? null;
  if (!videoId) {
    throw Object.assign(
      new Error(`${STUDIO_TOOL} returned no video id (keys: ${Object.keys(result ?? {}).join(', ') || 'none'})`),
      { code: 'NO_VIDEO_ID' }
    );
  }
  return { video_id: videoId, via: 'mcp', tool: STUDIO_TOOL, stats };
}

/** Poll a studio render through MCP, using the account's own status tool. */
export async function studioStatus(videoId) {
  const r = await mcp.getVideo(videoId);
  const status = String(r?.status ?? 'unknown').toLowerCase();
  return {
    status: status === 'done' ? 'completed' : status,
    progress: status === 'completed' || status === 'done' ? 100 : r?.progress ?? 0,
    video_url: r?.video_url ?? null,
    thumbnail_url: r?.thumbnail_url ?? null,
    duration: r?.duration ?? null,
    credits_used: r?.credits_used ?? null,
  };
}
