import { getDb } from '../db/index.js';
import { localDay } from '../utils/local-date.js';
import { thinDrafts } from './enhance.js';
import { buildRegister } from '../routes/register.js';

/**
 * The production manager: where the register stands against your deadlines,
 * and what to do today. Every number is read from what has actually happened
 * — finished files, takes, recordings, renders, publications — never from a
 * status someone typed.
 */
const PRIORITIES = ['P1', 'P2', 'P3'];
const STALL_DAYS = 7;
const DAY = 86400000;
const today = () => localDay();
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export function deadlines() {
  const raw = getDb().prepare('SELECT deadlines FROM workspace WHERE id = 1').get()?.deadlines;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export function setDeadlines(input) {
  const next = {};
  for (const p of PRIORITIES) {
    const v = input?.[p];
    if (v == null || v === '') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) {
      throw Object.assign(new Error(`${p} needs a date like 2026-10-31.`), { code: 'BAD_DATE' });
    }
    next[p] = String(v);
  }
  getDb().prepare('UPDATE workspace SET deadlines = ? WHERE id = 1').run(JSON.stringify(next));
  return next;
}

export function manager({ program = 'content' } = {}) {
  const db = getDb();
  const dl = deadlines();
  const now = today();
  const { items } = buildRegister({ program });

  const doneOn = db.prepare("SELECT value FROM brief_fields WHERE production_id = ? AND label = 'Completed confirmed'");
  const dueAt = db.prepare('SELECT due_at FROM productions WHERE id = ?');
  const recorded = db.prepare('SELECT COUNT(DISTINCT segment_id) n FROM line_takes WHERE production_id = ? AND segment_id IS NOT NULL');
  const takesMade = db.prepare(
    `SELECT COUNT(DISTINCT s.id) n FROM segments s JOIN takes t ON t.segment_id = s.id
      WHERE s.production_id = ? AND t.local_path IS NOT NULL AND t.stale = 0 AND t.text = s.text`
  );
  const rendered = db.prepare("SELECT 1 FROM render_versions WHERE production_id = ? AND status = 'complete'");
  const prepared = db.prepare("SELECT 1 FROM publications WHERE production_id = ? AND status != 'not_prepared'");
  const lastTouch = db.prepare(
    `SELECT MAX(t) t FROM (
       SELECT updated_at t FROM productions WHERE id = @id
       UNION ALL SELECT MAX(created_at) FROM script_versions WHERE production_id = @id
       UNION ALL SELECT MAX(t.created_at) FROM takes t JOIN segments s ON s.id = t.segment_id WHERE s.production_id = @id
       UNION ALL SELECT MAX(created_at) FROM line_takes WHERE production_id = @id
       UNION ALL SELECT MAX(created_at) FROM render_versions WHERE production_id = @id)`
  );

  const videos = items.map((i) => {
    const done = i.stage === 'done';
    const own = dueAt.get(i.id)?.due_at?.slice(0, 10) ?? null;
    const due = own ?? dl[i.priority ?? 'P3'] ?? null;
    const finished = done ? /(\d{4}-\d{2}-\d{2})/.exec(doneOn.get(i.id)?.value ?? '')?.[1] ?? null : null;
    const touched = String(lastTouch.get({ id: i.id })?.t ?? '').slice(0, 10) || null;
    return {
      id: i.id, videoId: i.videoId, order: i.order, name: i.name, company: i.company, priority: i.priority, madeBy: i.madeBy,
      stage: i.stage, checks: i.checks, lines: i.lines, heard: i.heard, done, finished, due, ownDue: !!own,
      daysLeft: due ? daysBetween(now, due) : null, idleDays: touched ? daysBetween(touched, now) : null,
    };
  });

  // Per priority: what is left, what is needed per week, what you are doing.
  const recent = (days) => videos.filter((v) => v.finished && daysBetween(v.finished, now) <= days).length;
  const pace = recent(28) / 4; // finished per week, over the last four weeks
  const groups = PRIORITIES.map((p) => {
    const mine = videos.filter((v) => (v.priority ?? 'P3') === p);
    const left = mine.filter((v) => !v.done).length;
    const due = dl[p] ?? null;
    const weeksLeft = due ? Math.max(0, daysBetween(now, due)) / 7 : null;
    const need = due ? (weeksLeft > 0 ? left / weeksLeft : left) : null;
    return {
      priority: p, total: mine.length, done: mine.length - left, left, due, weeksLeft,
      needPerWeek: need == null ? null : Math.ceil(need * 10) / 10,
      status: !due ? 'no-date' : !left ? 'done' : daysBetween(now, due) < 0 ? 'late' : need > pace ? 'behind' : 'on-track',
    };
  });
  // The whole register at the current pace, in priority order.
  const leftAll = videos.filter((v) => !v.done).length;
  const projected = pace > 0 ? localDay(new Date(Date.now() + (leftAll / pace) * 7 * DAY)) : null;

  const open = videos.filter((v) => !v.done);
  const late = open.filter((v) => v.daysLeft != null && v.daysLeft < 0).sort((a, b) => a.daysLeft - b.daysLeft);
  const dueSoon = open.filter((v) => v.daysLeft != null && v.daysLeft >= 0 && v.daysLeft <= 7).sort((a, b) => a.daysLeft - b.daysLeft);
  const started = ['script', 'audio', 'audio-approved', 'final'];
  const stalled = open.filter((v) => started.includes(v.stage) && v.idleDays != null && v.idleDays >= STALL_DAYS)
    .sort((a, b) => b.idleDays - a.idleDays);

  // Today's queues — each is a place in the app where a batch of work waits.
  const q = (fn) => open.filter(fn);
  const queues = {
    approve: q((v) => v.stage === 'draft-ready'),
    checks: q((v) => v.stage === 'draft-checks'),
    // Drafts whose length is off for their target: Fit to time can run on them tonight.
    fit: (() => { const off = new Set(thinDrafts()); return videos.filter((v) => off.has(v.id) && !v.done); })(),
    makeVoice: q((v) => v.madeBy !== 'self' && v.lines > 0 && takesMade.get(v.id).n < v.lines),
    approveVoice: q((v) => v.madeBy !== 'self' && v.lines > 0 && takesMade.get(v.id).n === v.lines && v.heard < v.lines),
    record: q((v) => v.madeBy === 'self' && v.lines > 0 && recorded.get(v.id).n < v.lines),
    render: q((v) => v.madeBy === 'heygen' && v.stage === 'audio-approved' && !rendered.get(v.id)),
    export: q((v) => (v.madeBy === 'self' && v.lines > 0 && recorded.get(v.id).n >= v.lines)
      || (v.madeBy === 'voice' && v.stage === 'audio-approved')
      || (v.madeBy === 'heygen' && !!rendered.get(v.id))),
    publish: videos.filter((v) => v.done && !prepared.get(v.id)),
  };
  const slim = (v) => ({ id: v.id, videoId: v.videoId, order: v.order, name: v.name, company: v.company, priority: v.priority,
    stage: v.stage, madeBy: v.madeBy, due: v.due, daysLeft: v.daysLeft, idleDays: v.idleDays, checks: v.checks });

  // What to work on next: your production order first, as you set it; then
  // late, then soonest due, then the furthest along (closest to done), so
  // effort turns into finished videos.
  const rank = ['final', 'audio-approved', 'audio', 'script', 'draft-ready', 'draft-checks', 'needs-script'];
  const next = [...open].sort((a, b) =>
    (a.order ?? 1e6) - (b.order ?? 1e6)
    || (a.daysLeft ?? 1e4) - (b.daysLeft ?? 1e4)
    || rank.indexOf(a.stage) - rank.indexOf(b.stage)
    || (a.priority ?? 'P9').localeCompare(b.priority ?? 'P9')).slice(0, 12);

  return {
    today: now, deadlines: dl, groups, pacePerWeek: Math.round(pace * 10) / 10, projected,
    totals: { videos: videos.length, done: videos.length - open.length, left: open.length },
    late: late.slice(0, 20).map(slim), lateCount: late.length,
    dueSoon: dueSoon.slice(0, 20).map(slim), dueSoonCount: dueSoon.length,
    stalled: stalled.slice(0, 10).map(slim), stalledCount: stalled.length,
    queues: Object.fromEntries(Object.entries(queues).map(([k, list]) => [k, { count: list.length, first: list[0] ? slim(list[0]) : null, ids: list.map((v) => v.id) }])),
    next: next.map(slim),
  };
}
