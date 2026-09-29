import { buildGeneratePayload } from './heygen-payload.js';
import { generateVideo } from './heygen.js';

/**
 * Render through the API key, with the same call shape as `renderViaStudio`.
 *
 * This exists so a caller can switch pockets without also switching payload
 * vocabulary. It is the only path that can render for FREE: `test: true` is
 * HeyGen's own watermarked mode on `/v2/video/generate`, and the MCP studio
 * tool has no equivalent — its schema carries no test parameter at all.
 *
 * The key bills separately from the web plan, which is why Live prefers MCP and
 * only Test comes here.
 */
export async function renderViaKey({ segments, title, resolution = '1080p', testMode = true }) {
  const uncast = (segments ?? []).filter((s) => !s.avatarId);
  if (uncast.length) {
    throw Object.assign(
      new Error(`No avatar cast for: ${[...new Set(uncast.map((s) => s.speaker))].join(', ')}`),
      { code: 'NOT_CAST' }
    );
  }

  const [width, height] = resolution === '720p' ? [1280, 720] : [1920, 1080];
  const { payload, stats } = buildGeneratePayload({ segments, testMode, width, height });
  const result = await generateVideo({ ...payload, title });

  return {
    video_id: result.video_id,
    via: 'key',
    tool: null,
    test: result.test,
    note: result.note,
    stats: { ...stats, segments: segments.length },
  };
}
