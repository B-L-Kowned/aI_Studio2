// Payload construction for /v2/video/generate.
//
// Ported from artificial_funny `desktop/app/services/heygen_client.py`
// (`_split_text`, `generate_video`, `generate_avatar_video`). The previous
// version here was invented: one video_input per script segment, no length
// guard, and no `test` flag.

/** HeyGen's per-input hard limit is 5000; 4500 leaves headroom. */
export const MAX_INPUT_CHARS = 4500;

/**
 * Split text into chunks that fit one video_input, breaking on sentence
 * boundaries so speech flow survives. A segment longer than the limit is
 * rejected by HeyGen outright, so this is not cosmetic.
 */
export function splitText(text, maxChars = MAX_INPUT_CHARS) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length <= maxChars) return trimmed ? [trimmed] : [];

  const chunks = [];
  let remaining = trimmed;

  while (remaining) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining.trim());
      break;
    }
    // Last sentence end inside the window; fall back to a hard cut.
    let splitAt = maxChars;
    const window = remaining.slice(0, maxChars);
    let last = null;
    for (const m of window.matchAll(/[.!?]\s+/g)) last = m;
    if (last) splitAt = last.index + last[0].length;

    const chunk = remaining.slice(0, splitAt).trim();
    remaining = remaining.slice(splitAt).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

/**
 * One video_input per chunk. `character` is either a pre-built avatar or an
 * uploaded talking photo — the two shapes HeyGen accepts.
 */
function videoInput({ chunk, voiceId, avatarId, talkingPhotoId, background }) {
  const character = talkingPhotoId
    ? { type: 'talking_photo', talking_photo_id: talkingPhotoId }
    : { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' };

  const input = {
    character,
    voice: { type: 'text', input_text: chunk, voice_id: voiceId },
  };
  if (background) input.background = background;
  return input;
}

/**
 * @param {object} o
 * @param {{speaker?:string,text:string}[]} o.segments script lines, in order
 * @param {boolean} o.testMode  true = watermarked and FREE at HeyGen
 * @returns {{payload:object, stats:{inputs:number,chars:number,split:number}}}
 */
export function buildGeneratePayload({
  segments,
  avatarId,
  talkingPhotoId = null,
  voiceId,
  background = null,
  testMode = true,
  width = 1920,
  height = 1080,
}) {
  const videoInputs = [];
  let chars = 0;
  let split = 0;

  for (const seg of segments ?? []) {
    const chunks = splitText(seg.text);
    if (chunks.length > 1) split += 1;
    chars += (seg.text ?? '').length;

    // Each segment carries the casting for its own speaker; the top-level
    // avatarId/voiceId are only a fallback. Without this every speaker in a
    // two-hander renders with the same face and the same voice.
    const segAvatar = seg.avatarId ?? avatarId;
    const segVoice = seg.voiceId ?? voiceId;
    const segPhoto = seg.talkingPhotoId ?? talkingPhotoId;

    for (const chunk of chunks) {
      videoInputs.push(videoInput({
        chunk,
        voiceId: segVoice,
        avatarId: segAvatar,
        talkingPhotoId: segPhoto,
        background: seg.background ?? background,
      }));
    }
  }

  return {
    payload: {
      video_inputs: videoInputs,
      // HeyGen's own free/watermarked switch. This is the flag that makes a
      // real generate call cost nothing, and it belongs in the payload rather
      // than being simulated on our side.
      test: testMode,
      dimension: { width, height },
    },
    stats: { inputs: videoInputs.length, chars, split },
  };
}
