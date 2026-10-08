import { getDb } from '../db/index.js';

// Every outline section of a video you film and edit yourself carries this.
export const SELF_RECORDED = 'Pat (recorded myself)';
export const VOICE_ONLY = 'Pat (voice only)';

// The register's format names a voice-over over a screen recording.
export const voiceOnlyFormat = (format) =>
  /screen recording|diagram|graphics|visuals \+ voice/i.test(format ?? '') && !/avatar/i.test(format ?? '');

/**
 * How a video gets made: 'self' (you film it), 'voice' (your voice over screen
 * recordings, no presenter on screen) or 'heygen' (an avatar lip-synced to your
 * approved audio).
 */
export function madeBy(productionId, format) {
  const db = getDb();
  const who = db.prepare('SELECT participants FROM outline_sections WHERE production_id = ?').all(productionId);
  if (who.length && who.every((w) => w.participants === SELF_RECORDED)) return 'self';
  if (who.length && who.every((w) => w.participants === VOICE_ONLY)) return 'voice';
  const fmt = format ?? db.prepare("SELECT value FROM brief_fields WHERE production_id = ? AND label = 'Format'").get(productionId)?.value;
  return voiceOnlyFormat(fmt) ? 'voice' : 'heygen';
}
