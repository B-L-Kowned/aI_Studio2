import { getDb } from '../db/index.js';
import { renderGate } from './segments.js';
import { staleSummary } from './stale.js';
import { ideaCounts } from './ideas.js';

// The production schedule.
//
// The dashboard used to show the pipeline of whichever production happened to
// be open, plus workspace facts that belong in Settings and a templates grid
// that duplicated the New button. For one person across fifty companies, "the
// production I opened last" is the least useful thing on the screen.
//
// Work at that scale does not fail because a button was hard to find. It fails
// because something stalled three weeks ago and nothing said so. So this answers
// two questions and nothing else: WHAT IS BLOCKED ON ME, and WHAT IS DUE.

/** Untouched for this long, with work already started, is a stall. */
const IDLE_DAYS = 14;
/** Inside this many days, a deadline is worth raising before it is missed. */
const DUE_SOON_DAYS = 7;

const days = (iso) => {
  if (!iso) return null;
  const t = Date.parse(iso.includes('T') ? iso : `${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / 86400000);
};

const sinceDays = (iso) => {
  const d = days(iso);
  return d == null ? null : -d;
};

/**
 * Everything standing between a production and its next step.
 *
 * Each item names the production, the company it belongs to, what is wrong and
 * the one thing that fixes it. "3 issues" is not actionable; "cast Narrator" is.
 */
function blockers(p) {
  const db = getDb();
  const out = [];

  const gate = renderGate(p.id);
  if (gate.total > 0) {
    const byReason = gate.blocked.reduce((acc, b) => {
      acc[b.reason] = (acc[b.reason] ?? 0) + 1;
      return acc;
    }, {});
    const WORDS = {
      presenter: (n) => [`${n} line${n === 1 ? '' : 's'} have no presenter`, 'Cast them', 'Segments'],
      avatar: (n) => [`${n} presenter${n === 1 ? '' : 's'} have no avatar`, 'Cast an avatar', 'Cast'],
      audition: (n) => [`${n} line${n === 1 ? '' : 's'} never auditioned`, 'Audition them', 'Segments'],
      unheard: (n) => [`${n} take${n === 1 ? '' : 's'} not approved`, 'Listen and approve', 'Segments'],
    };
    for (const [reason, n] of Object.entries(byReason)) {
      const [what, action, where] = (WORDS[reason] ?? ((k) => [`${k} blocked`, 'Open', 'Segments']))(n);
      out.push({ kind: reason, what, action, where, weight: reason === 'unheard' ? 6 : 7 });
    }
  }

  // A decision that appears on EVERY production is boilerplate, not a reason
  // this one is stuck. Every production is seeded with "Who appears in this
  // production?", so counting it made all fourteen rows say the same thing —
  // a schedule where everything is blocked for one reason ranks nothing.
  const openDecisions = db
    .prepare(
      `SELECT d.text FROM decisions d
        WHERE d.production_id = ? AND d.kind = 'warning' AND d.resolution IS NULL`
    )
    .all(p.id);

  const boilerplate = new Set(
    db.prepare(
      `SELECT text FROM decisions WHERE kind = 'warning' AND resolution IS NULL
        GROUP BY text HAVING COUNT(DISTINCT production_id) > 2`
    ).all().map((r) => r.text)
  );
  const real = openDecisions.filter((d) => !boilerplate.has(d.text));

  if (real.length) {
    out.push({
      kind: 'decision',
      what: real.length === 1
        ? real[0].text.slice(0, 70)
        : `${real.length} decisions waiting on you`,
      action: 'Decide', where: 'Plan', weight: 5,
    });
  } else if (openDecisions.length) {
    // Still worth saying, but it is the weakest possible reason to open this
    // production rather than any of the other thirteen.
    out.push({
      kind: 'decision_generic',
      what: openDecisions[0].text.slice(0, 70),
      action: 'Decide', where: 'Plan', weight: 0,
    });
  }

  const failed = db
    .prepare("SELECT error FROM render_versions WHERE production_id = ? AND status = 'failed' ORDER BY version DESC LIMIT 1")
    .get(p.id);
  if (failed) {
    out.push({
      kind: 'render_failed',
      what: `Render failed: ${String(failed.error ?? 'no reason recorded').slice(0, 80)}`,
      action: 'Look and retry', where: 'Render', weight: 9,
    });
  }

  const stale = staleSummary(p.id);
  const staleCount = Object.keys(stale ?? {}).length;
  if (staleCount) {
    const first = Object.values(stale)[0];
    out.push({
      kind: 'stale',
      what: `${staleCount} artifact${staleCount === 1 ? '' : 's'} out of date — ${String(first?.reason ?? '').slice(0, 60)}`,
      action: 'Regenerate', where: 'Plan', weight: 3,
    });
  }

  // Nothing to render yet is not a blocker, it is the next step.
  const hasScript = db
    .prepare("SELECT 1 FROM script_versions WHERE production_id = ? AND status = 'accepted'")
    .get(p.id);
  if (!hasScript && p.outline_approved) {
    out.push({
      kind: 'script', what: 'Outline approved, no script yet',
      action: 'Generate the script', where: 'Script', weight: 4,
    });
  }

  return out;
}

/**
 * `mode` scopes the whole schedule to one program.
 *
 * A production is 'comedy', 'content' or 'both'. `both` belongs to EACH
 * program, so it must match either scope — `p.mode = ?` alone would hide every
 * `both` row from both programs and quietly shrink the slate by a third.
 *
 * The filter lives in this one query on purpose: the counts, the campaign
 * rollup and the work queue are all derived from these rows, so they cannot
 * disagree with each other about what is in view.
 */
export function schedule({
  idleDays = IDLE_DAYS, dueSoonDays = DUE_SOON_DAYS, weekStart = null, mode = null,
} = {}) {
  const db = getDb();
  const scoped = mode === 'comedy' || mode === 'content';
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS campaign_name
         FROM productions p
         LEFT JOIN campaigns c ON c.id = p.campaign_id
        ${scoped ? "WHERE p.mode = ? OR p.mode = 'both'" : ''}`
    )
    .all(...(scoped ? [mode] : []));

  const needsYou = [];
  const inFlight = [];
  const due = [];
  const idle = [];
  let readyToRender = 0;

  for (const p of rows) {
    const base = {
      id: p.id, title: p.title,
      campaign: p.campaign_name ?? null,
      dueAt: p.due_at ?? null,
      dueInDays: days(p.due_at),
      updatedAt: p.updated_at,
      idleDays: sinceDays(p.updated_at),
    };

    // Moving at the provider. Nothing to do, but it is not stalled either —
    // and telling you to act on it would be noise.
    const live = db
      .prepare(
        `SELECT version, status, progress FROM render_versions
          WHERE production_id = ? AND status IN ('queued','processing')
          ORDER BY version DESC LIMIT 1`
      )
      .get(p.id);
    if (live) {
      inFlight.push({ ...base, version: live.version, status: live.status, progress: live.progress });
    }

    const items = blockers(p);
    if (items.length) {
      items.sort((a, b) => b.weight - a.weight);
      needsYou.push({ ...base, blockers: items, top: items[0] });
    } else if (!live) {
      const gate = renderGate(p.id);
      if (gate.total > 0 && gate.ready) readyToRender++;
    }

    if (p.due_at) due.push(base);

    // Idle only counts when work has actually begun. A production created an
    // hour ago and not touched since is new, not stalled.
    const started = db
      .prepare('SELECT COUNT(*) n FROM script_versions WHERE production_id = ?')
      .get(p.id).n > 0;
    if (started && (base.idleDays ?? 0) >= idleDays && !live && !items.length) {
      idle.push(base);
    }
  }

  // Most urgent first: an overdue deadline outranks a heavy blocker.
  // Overdue first, then by how concrete the blocker is. Sorting by deadline
  // alone put fourteen undated productions in database order, which is not an
  // order anyone would choose to work in.
  needsYou.sort((a, b) => {
    const overdue = (x) => (x.dueInDays != null && x.dueInDays < 0 ? 0 : 1);
    if (overdue(a) !== overdue(b)) return overdue(a) - overdue(b);
    if (a.top.weight !== b.top.weight) return b.top.weight - a.top.weight;
    const ad = a.dueInDays ?? 9999;
    const bd = b.dueInDays ?? 9999;
    if (ad !== bd) return ad - bd;
    return b.blockers.length - a.blockers.length;
  });
  due.sort((a, b) => (a.dueInDays ?? 9999) - (b.dueInDays ?? 9999));
  idle.sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0));

  // ── By company ────────────────────────────────────────────────────────
  //
  // The point of the page at fifty companies. Fourteen rows is a queue; the
  // question is which COMPANIES are stuck and which are moving, and that is a
  // rollup, not an enumeration.
  const byCampaign = [];
  const groups = new Map();
  for (const p of rows) {
    const key = p.campaign_id ?? 0;
    if (!groups.has(key)) {
      groups.set(key, { id: p.campaign_id ?? null, name: p.campaign_name ?? 'No campaign', items: [] });
    }
    groups.get(key).items.push(p);
  }

  const blockedIds = new Set(needsYou.map((n) => n.id));
  const flightIds = new Set(inFlight.map((n) => n.id));

  for (const g of groups.values()) {
    // Where each production has actually got to, so a company shows its shape
    // rather than a single number.
    const stages = { planning: 0, scripted: 0, rendering: 0, done: 0 };
    let nextDue = null;

    for (const p of g.items) {
      const hasScript = db
        .prepare("SELECT 1 FROM script_versions WHERE production_id = ? AND status = 'accepted'")
        .get(p.id);
      const hasRender = db
        .prepare("SELECT 1 FROM render_versions WHERE production_id = ? AND status = 'complete'")
        .get(p.id);
      if (hasRender) stages.done++;
      else if (flightIds.has(p.id)) stages.rendering++;
      else if (hasScript) stages.scripted++;
      else stages.planning++;

      const d = days(p.due_at);
      if (d != null && (nextDue == null || d < nextDue)) nextDue = d;
    }

    byCampaign.push({
      id: g.id, name: g.name,
      productions: g.items.length,
      blocked: g.items.filter((p) => blockedIds.has(p.id)).length,
      inFlight: g.items.filter((p) => flightIds.has(p.id)).length,
      stages,
      nextDue,
    });
  }
  // Companies in trouble first; quiet ones can wait.
  byCampaign.sort((a, b) => {
    if ((a.nextDue ?? 9999) !== (b.nextDue ?? 9999)) return (a.nextDue ?? 9999) - (b.nextDue ?? 9999);
    return b.blocked - a.blocked;
  });

  // ── One week, day by day ──────────────────────────────────────────────
  //
  // A fortnight of fourteen narrow cells was a lot of screen for a view you
  // scan rather than read. A week is the unit people actually plan in, and it
  // leaves room for each day to say what is on it.
  //
  // The number is the ISO week — the one on everyone else's calendar, defined
  // by the Thursday in the same week, which is why it is not simply the day of
  // the year divided by seven.
  const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return {
      week: Math.ceil(((t - yearStart) / 86400000 + 1) / 7),
      year: t.getUTCFullYear(),
    };
  };

  const pad2 = (n) => String(n).padStart(2, '0');
  const localIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  // Weeks start Monday, because ISO week numbers do.
  const anchor = weekStart ? new Date(`${weekStart}T00:00:00`) : new Date();
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const todayIso = localIso(new Date());
  const calendar = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = localIso(d);
    const items = rows.filter((p) => (p.due_at ?? '').slice(0, 10) === key);
    return {
      date: key,
      weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
      dayOfMonth: d.getDate(),
      monthLabel: d.toLocaleDateString(undefined, { month: 'short' }),
      isToday: key === todayIso,
      isWeekend: [0, 6].includes(d.getDay()),
      count: items.length,
      // Ids as well as titles: a day you can click has to lead somewhere.
      items: items.map((p) => ({
        id: p.id,
        title: p.title,
        campaign: p.campaign_name ?? null,
        late: key < todayIso,
      })),
    };
  });

  const wk = isoWeek(monday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const week = {
    number: wk.week,
    year: wk.year,
    start: localIso(monday),
    end: localIso(sunday),
    prev: localIso(new Date(monday.getTime() - 7 * 86400000)),
    next: localIso(new Date(monday.getTime() + 7 * 86400000)),
    isCurrent: localIso(monday) <= todayIso && todayIso <= localIso(sunday),
  };

  return {
    byCampaign,
    calendar,
    week,
    needsYou,
    inFlight,
    due: due.filter((d) => d.dueInDays != null && d.dueInDays <= dueSoonDays),
    overdue: due.filter((d) => d.dueInDays != null && d.dueInDays < 0).length,
    idle,
    counts: {
      productions: rows.length,
      campaigns: new Set(rows.map((r) => r.campaign_id).filter(Boolean)).size,
      needsYou: needsYou.length,
      inFlight: inFlight.length,
      readyToRender,
      idle: idle.length,
    },
    // The lot sits OUTSIDE the schedule on purpose — parked ideas are not
    // work in progress, and counting them as such is how a backlog starts
    // looking like a crisis.
    ideas: ideaCounts(),
    thresholds: { idleDays, dueSoonDays },
  };
}

export function setDueDate(productionId, dueAt) {
  const db = getDb();
  if (dueAt !== null && days(dueAt) === null) {
    throw Object.assign(new Error('That is not a date this can read.'), { code: 'BAD_DATE' });
  }
  const r = db.prepare('UPDATE productions SET due_at = ? WHERE id = ?').run(dueAt, productionId);
  if (!r.changes) throw Object.assign(new Error('Production not found'), { code: 'NOT_FOUND' });
  return { id: productionId, dueAt, dueInDays: days(dueAt) };
}
