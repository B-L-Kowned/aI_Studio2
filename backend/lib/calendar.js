import { getDb } from '../db/index.js';
import { renderGate } from './segments.js';

// A real calendar of real work.
//
// This used to be 28 fixture rows keyed by an integer DAY OF MONTH — a shape
// that cannot express "next Tuesday", cannot be overdue, and cannot point at a
// production. So the calendar showed a tidy month of things that did not exist
// while the actual deadlines lived nowhere.
//
// Now a day holds the productions due on it, each carrying how far along it
// actually is, so the month reads as a plan rather than as decoration.

/** Where a production has got to. The calendar colours by this. */
export function stageOf(productionId) {
  const db = getDb();
  const published = db
    .prepare("SELECT 1 FROM publications WHERE production_id = ? AND status = 'published' AND post_id IS NOT NULL")
    .get(productionId);
  if (published) return 'published';

  const exported = db
    .prepare('SELECT 1 FROM exports WHERE production_id = ? AND file_path IS NOT NULL')
    .get(productionId);
  if (exported) return 'exported';

  const rendered = db
    .prepare("SELECT 1 FROM render_versions WHERE production_id = ? AND status = 'complete'")
    .get(productionId);
  if (rendered) return 'rendered';

  const gate = renderGate(productionId);
  if (gate.total > 0 && gate.ready) return 'ready';

  const scripted = db
    .prepare("SELECT 1 FROM script_versions WHERE production_id = ? AND status = 'accepted'")
    .get(productionId);
  if (scripted) return 'scripted';

  return 'planning';
}

export const STAGE_ORDER = ['planning', 'scripted', 'ready', 'rendered', 'exported', 'published'];

/** The step that moves this production forward, and where that step lives. */
function nextStep(stage) {
  return {
    planning: ['Write the script', 'Script'],
    scripted: ['Cast and approve the lines', 'Segments'],
    ready: ['Render it', 'Render'],
    rendered: ['Export it', 'Edit'],
    exported: ['Publish it', 'Publish'],
    published: [null, null],
  }[stage];
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * A month, as six full weeks so the grid never changes shape.
 *
 * `month` is YYYY-MM. Leading and trailing days belong to the neighbouring
 * months and are marked, because a calendar that hides them makes the first of
 * the month look like it starts mid-air.
 */
/**
 * `mode` scopes the calendar to one program, matching the dashboard and Plan.
 * `both` productions belong to each program, so they appear under either — the
 * same rule as `schedule()`; see the note there.
 */
export function month(monthKey, mode = null) {
  const db = getDb();
  const scoped = mode === 'comedy' || mode === 'content';
  const scopeSql = scoped ? " AND (p.mode = ? OR p.mode = 'both')" : '';
  const scopeArg = scoped ? [mode] : [];
  const [y, m] = (monthKey ?? '').split('-').map(Number);
  const base = Number.isInteger(y) && Number.isInteger(m)
    ? new Date(y, m - 1, 1)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // back to Sunday

  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.due_at, c.name AS campaign
         FROM productions p
         LEFT JOIN campaigns c ON c.id = p.campaign_id
        WHERE p.due_at IS NOT NULL${scopeSql}`
    )
    .all(...scopeArg);

  const byDay = new Map();
  for (const r of rows) {
    const key = String(r.due_at).slice(0, 10);
    const stage = stageOf(r.id);
    const [action, where] = nextStep(stage);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({
      id: r.id, title: r.title, campaign: r.campaign ?? null,
      stage, action, where,
      // Late means the date has passed and it is not out the door.
      late: key < iso(new Date()) && stage !== 'published',
    });
  }

  const todayIso = iso(new Date());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = iso(d);
    return {
      date: key,
      dayOfMonth: d.getDate(),
      inMonth: d.getMonth() === base.getMonth(),
      isToday: key === todayIso,
      isWeekend: [0, 6].includes(d.getDay()),
      items: byDay.get(key) ?? [],
    };
  });

  const inMonth = days.filter((d) => d.inMonth).flatMap((d) => d.items);
  return {
    month: `${base.getFullYear()}-${pad(base.getMonth() + 1)}`,
    label: base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    days,
    // Everything with a date, whatever month it is in, so nothing scheduled is
    // invisible just because you are looking at the wrong page of the calendar.
    unscheduled: db
      .prepare(
        `SELECT p.id, p.title, c.name AS campaign
           FROM productions p
           LEFT JOIN campaigns c ON c.id = p.campaign_id
          WHERE p.due_at IS NULL${scopeSql}
          ORDER BY p.updated_at DESC`
      )
      .all(...scopeArg)
      .map((r) => ({ id: r.id, title: r.title, campaign: r.campaign ?? null, stage: stageOf(r.id) })),
    counts: {
      scheduled: inMonth.length,
      late: inMonth.filter((i) => i.late).length,
      readyToPublish: inMonth.filter((i) => i.stage === 'exported').length,
      published: inMonth.filter((i) => i.stage === 'published').length,
    },
  };
}
