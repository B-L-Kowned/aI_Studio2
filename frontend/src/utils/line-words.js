// The line as the screen shows it: each word with its punctuation, tagged with
// its sentence. Matches the server's split (backend/lib/line-words.js), so a
// clicked word names the same sentence the server will remake.
export function tokens(text) {
  const out = [];
  let s = 0;
  for (const w of String(text ?? '').replace(/\[CONFIRM:[^\]]*\]/gi, ' ').split(/\s+/).filter(Boolean)) {
    out.push({ w, s });
    if (/[.!?]["”’)]?$/.test(w)) s++;
  }
  return out;
}

/** Until Whisper answers: spread the words over the clip by their length. */
export function estimateTimes(toks, duration) {
  if (!duration) return null;
  const lead = Math.min(0.15, duration * 0.05);
  const span = Math.max(0.1, duration - lead * 2);
  const weight = toks.map((t) => Math.max(2, t.w.length) + (/[,;:]$/.test(t.w) ? 3 : /[.!?]$/.test(t.w) ? 6 : 0));
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  let at = lead;
  return toks.map((t, i) => {
    const len = (weight[i] / total) * span;
    const out = { ...t, start: at, end: at + len * 0.85 };
    at += len;
    return out;
  });
}

/** The word as a dictionary term: no surrounding punctuation, no possessive. */
export const termOf = (w) => String(w).replace(/^[^\w]+|[^\w]+$/g, '').replace(/[’']s$/i, '');

export const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s) % 60)).padStart(2, '0')}`;
