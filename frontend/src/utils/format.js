/** "m:ss" → seconds. Anything unparseable reads as 0. */
export const toSeconds = (t) => {
  const [m, s] = String(t ?? '').split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};

/**
 * Seconds → "m:ss". Rounds first: rounding only the seconds part turned 59.6s
 * into "0:60" in the copies this replaces.
 */
export const toClock = (secs) => {
  const t = Math.max(0, Math.round(Number(secs) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
