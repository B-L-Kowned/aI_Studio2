// How a video gets made, chosen once per video. Each choice is written to every
// outline section's "Who appears", which is what casting and the register read.
export const SELF_RECORDED = 'Pat (recorded myself)';
export const VOICE_ONLY = 'Pat (voice only)';

export const MADE_BY = [
  { id: 'heygen', who: 'Pat', label: 'HeyGen avatar', detail: 'Your avatar, lip-synced to your approved audio. Render in HeyGen, finish in Edit.' },
  { id: 'self', who: SELF_RECORDED, label: 'I record it myself', detail: 'You film it. No look, no render — the editor kit has the audio, script and subtitles.' },
  { id: 'voice', who: VOICE_ONLY, label: 'Voice-over', detail: 'Your voice over screen recordings. No one on screen, no render.' },
];
export const madeByLabel = (id) => MADE_BY.find((m) => m.id === id)?.label ?? 'Mixed';

// The register's format names a voice-over over a screen recording.
const voiceOnlyFormat = (format) =>
  /screen recording|diagram|graphics|visuals \+ voice/i.test(format ?? '') && !/avatar/i.test(format ?? '');

/** 'heygen' | 'self' | 'voice', or 'mixed' when the sections disagree. */
export function madeByOf(production) {
  const who = (production?.outline ?? []).map((s) => s.participants);
  if (!who.length) return 'heygen';
  if (who.every((w) => w === SELF_RECORDED)) return 'self';
  if (who.every((w) => w === VOICE_ONLY)) return 'voice';
  if (who.every((w) => w === 'Pat')) {
    const format = production.brief?.find((b) => b.label === 'Format')?.value;
    return voiceOnlyFormat(format) ? 'voice' : 'heygen';
  }
  return 'mixed';
}

export const isSelfRecorded = (production) => madeByOf(production) === 'self';
/** Self-recorded and voice-over videos have no HeyGen look or render. */
export const needsRender = (production) => !['self', 'voice'].includes(madeByOf(production));
