// The AI Producer's assessment. PM_SPEC requires it to return known facts,
// inferred values, decisions required and proposed defaults — separated, so the
// user is only asked about what cannot be safely inferred.
//
// Dry run derives all of this from the stored plan. A shipped build routes a
// 'plan.clarify' capability request; the returned shape is identical.

import { getDb } from '../db/index.js';

const toSeconds = (t) => {
  const [m, s] = String(t).split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};
const toClock = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

export function assess(productionId) {
  const db = getDb();
  const production = db.prepare('SELECT * FROM productions WHERE id = ?').get(productionId);
  if (!production) return null;

  const outline = db
    .prepare('SELECT * FROM outline_sections WHERE production_id = ? ORDER BY position')
    .all(productionId);
  const scenes = db
    .prepare('SELECT * FROM scenes WHERE production_id = ? ORDER BY position')
    .all(productionId);
  const brief = db
    .prepare('SELECT label, value FROM brief_fields WHERE production_id = ? ORDER BY position')
    .all(productionId);
  const openDecisions = db
    .prepare("SELECT text FROM decisions WHERE production_id = ? AND kind = 'warning' AND resolution IS NULL")
    .all(productionId);

  const planned = outline.reduce((n, s) => n + toSeconds(s.runtime), 0);
  const target = toSeconds(production.target_runtime);
  const drift = planned - target;

  const known = [
    ...brief.filter((b) => b.value).map((b) => `${b.label}: ${b.value}`),
    `${outline.length} outline sections totalling ${toClock(planned)}`,
    `${scenes.length} scenes developed`,
  ];

  const inferred = [];
  const decisionsNeeded = openDecisions.map((d) => d.text);
  const proposals = [];

  if (drift !== 0) {
    const verb = drift > 0 ? 'over' : 'under';
    decisionsNeeded.push(
      `Outline runs ${toClock(Math.abs(drift))} ${verb} the ${production.target_runtime} target.`
    );
    proposals.push({
      action: 'rebalance',
      label: `Rebalance sections to hit ${production.target_runtime}`,
      detail: `Scales every section proportionally to absorb the ${toClock(Math.abs(drift))} ${verb}run.`,
    });
  } else {
    inferred.push(`Runtime is balanced at ${production.target_runtime}.`);
  }

  const unpurposed = outline.filter((s) => !s.purpose).length;
  if (unpurposed) {
    inferred.push(`${unpurposed} sections will use a generated purpose unless you set one.`);
    proposals.push({
      action: 'fill_purposes',
      label: `Draft a purpose for ${unpurposed} sections`,
      detail: 'Low-risk default; every field stays editable.',
    });
  }

  if (!scenes.length) {
    decisionsNeeded.push('No scenes developed yet — approve the outline to generate them.');
    proposals.push({
      action: 'develop_scenes',
      label: 'Develop scenes from the approved outline',
      detail: 'Creates scenes without writing any dialogue.',
    });
  }

  if (!production.outline_approved) {
    inferred.push('Outline is not approved, so script generation stays locked.');
  }

  return { known, inferred, decisionsNeeded, proposals };
}

/** Scale every section proportionally so the outline totals the target runtime. */
export function rebalance(productionId) {
  const db = getDb();
  const production = db.prepare('SELECT * FROM productions WHERE id = ?').get(productionId);
  const sections = db
    .prepare('SELECT * FROM outline_sections WHERE production_id = ? ORDER BY position')
    .all(productionId);
  if (!production || !sections.length) return 0;

  const target = toSeconds(production.target_runtime);
  const planned = sections.reduce((n, s) => n + toSeconds(s.runtime), 0);
  if (planned === target) return 0;

  const factor = target / planned;
  let allocated = 0;
  const update = db.prepare('UPDATE outline_sections SET runtime = ? WHERE id = ?');

  db.transaction(() => {
    sections.forEach((s, i) => {
      // Give the last section the remainder so rounding can never drift the total.
      const secs =
        i === sections.length - 1
          ? target - allocated
          : Math.max(5, Math.round(toSeconds(s.runtime) * factor));
      allocated += secs;
      update.run(toClock(secs), s.id);
    });
  })();

  return sections.length;
}
