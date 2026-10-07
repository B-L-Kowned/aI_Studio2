// The "Who appears" value for a video you film and edit yourself. It has no
// HeyGen look or render; it is done when the finished file is uploaded.
export const SELF_RECORDED = 'Pat (recorded myself)';

export const isSelfRecorded = (production) =>
  (production?.outline?.length ?? 0) > 0 && production.outline.every((s) => s.participants === SELF_RECORDED);
