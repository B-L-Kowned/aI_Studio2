import { getDb } from '../db/index.js';
import { resolveSpeaker, presenterCasting } from './casting.js';
import { listLocalVoices, SPEED_RANGE } from './local-voice.js';
import { madeBy } from './made-by.js';

// What a planned script was timed at, used only until the voice has been measured.
export const PLANNING_WPM = 150;
export const secs = (rt) => { const [m, s] = String(rt ?? '0:00').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

/** The local voice this production's narration is spoken in (the voice cast on "Pat"). */
export function narrationVoice() {
  const p = resolveSpeaker('Pat');
  const v = p ? presenterCasting(p.id)?.voice : null;
  const voices = listLocalVoices();
  return voices.find((x) => x.id === v?.id) ?? voices[0] ?? null;
}

/** Everything that judges length: pace, speed, target, section budgets. Null when there is no such production. */
export function scriptTiming(productionId) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM productions WHERE id = ?').get(productionId);
  if (!p) return null;
  const voice = narrationVoice();
  const natural = voice?.naturalWpm ?? null;
  const speed = p.voice_speed ?? voice?.speed ?? 1;
  const sections = db.prepare('SELECT title, runtime FROM outline_sections WHERE production_id = ? ORDER BY position').all(p.id)
    .map((s) => ({ title: s.title, runtime: s.runtime, seconds: secs(s.runtime) }));
  // Recording it yourself, the pace that matters is yours: words over time
  // spoken, across the takes you chose. Until there are takes, a typical pace.
  if (madeBy(p.id) === 'self') {
    const takes = db.prepare('SELECT text, in_point, out_point, duration FROM line_takes WHERE production_id = ? AND chosen = 1').all(p.id)
      .map((t) => ({ words: t.text.replace(/\[CONFIRM:[^\]]*\]/gi, ' ').split(/\s+/).filter(Boolean).length, secs: (t.out_point ?? t.duration ?? 0) - t.in_point }))
      .filter((t) => t.words && t.secs > 0.5);
    const words = takes.reduce((n, t) => n + t.words, 0);
    const secsSpoken = takes.reduce((n, t) => n + t.secs, 0);
    const own = takes.length ? Math.round((words / secsSpoken) * 60) : null;
    return {
      pace: 'own', voice: null, naturalWpm: own ?? PLANNING_WPM, measured: own != null, takes: takes.length,
      speed: 1, speedRange: SPEED_RANGE, wpm: own ?? PLANNING_WPM, targetSeconds: secs(p.target_runtime), sections,
    };
  }
  return {
    pace: 'voice',
    voice: voice && { id: voice.id, name: voice.name, naturalWpm: natural, measuredSeconds: voice.paceSeconds },
    naturalWpm: natural ?? PLANNING_WPM,
    measured: natural != null,
    speed, speedRange: SPEED_RANGE,
    wpm: Math.round((natural ?? PLANNING_WPM) * speed),
    targetSeconds: secs(p.target_runtime),
    sections,
  };
}
