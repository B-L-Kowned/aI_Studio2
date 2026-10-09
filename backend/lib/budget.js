import { getDb } from '../db/index.js';

/**
 * A monthly spending limit for HeyGen, chosen by the customer.
 *
 * Every customer brings their own HeyGen account, so a runaway batch is their
 * money. The studio cannot read a dollar balance from HeyGen, so it keeps its
 * own estimate: each paid render records what it should cost at the customer's
 * rate, and nothing starts that would take this month past the limit.
 *
 * Off by default only until it is chosen: the first paid render asks for one.
 */

// What a minute of avatar video costs varies by HeyGen plan and avatar type,
// so the rate is the customer's to set; this is a cautious starting point.
export const DEFAULT_RATE = 1.4;
export const WARN_AT = 0.8;

// Monthly limits offered as presets. `minutes` is worked out from the rate.
export const PRESETS = [
  { id: 'try', cap: 25, label: 'Trying it out', hint: 'A few short videos a month' },
  { id: 'regular', cap: 50, label: 'Regular', hint: 'About one video a week' },
  { id: 'busy', cap: 100, label: 'Busy', hint: 'Several videos a week' },
];

// Which HeyGen plan fits, by the minutes a month the limit buys. Shown as a
// suggestion with a link to HeyGen's own pricing, which is the source of truth.
export const PLAN_HINTS = [
  { upTo: 15, plan: 'Pay as you go (API)', why: 'No subscription; you buy credits when you need them.' },
  { upTo: 60, plan: 'Creator (web plan) via sign-in', why: 'Renders spend the plan you pay for monthly instead of API credits.' },
  { upTo: Infinity, plan: 'Team or API Pro', why: 'Higher monthly allowance; check the per-minute rate before choosing.' },
];

function readSettings() {
  const raw = getDb().prepare('SELECT budget FROM workspace WHERE id = 1').get()?.budget;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/** Spent this calendar month, from the studio's own record of paid renders. */
export function spentThisMonth(now = new Date()) {
  const db = getDb();
  const since = monthStart(now);
  const full = db.prepare(
    `SELECT COALESCE(SUM(cost_estimate), 0) s FROM render_versions
      WHERE dry_run = 0 AND status NOT IN ('failed','cancelled') AND COALESCE(started_at, created_at) >= ?`
  ).get(since).s;
  const lines = db.prepare(
    `SELECT COALESCE(SUM(cost_estimate), 0) s FROM segment_renders
      WHERE status != 'failed' AND created_at >= ?`
  ).get(since.replace('T', ' ').slice(0, 19)).s;
  return Math.round((full + lines) * 100) / 100;
}

export function minutesFor(dollars, rate) {
  return Math.floor(dollars / rate);
}

export function planHint(minutes) {
  return PLAN_HINTS.find((p) => minutes <= p.upTo);
}

export function budgetState() {
  const s = readSettings();
  const rate = s?.ratePerMin ?? DEFAULT_RATE;
  const spent = spentThisMonth();
  const cap = s?.monthlyCap ?? null;
  return {
    set: cap != null,
    monthlyCap: cap,
    ratePerMin: rate,
    spent,
    remaining: cap == null ? null : Math.max(0, Math.round((cap - spent) * 100) / 100),
    nearLimit: cap != null && spent >= cap * WARN_AT,
    atLimit: cap != null && spent >= cap,
    resetsOn: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10),
    presets: PRESETS.map((p) => ({ ...p, minutes: minutesFor(p.cap, rate) })),
    plan: cap != null ? planHint(minutesFor(cap, rate)) : null,
  };
}

export function setBudget({ monthlyCap, ratePerMin } = {}) {
  const cap = Number(monthlyCap);
  const rate = ratePerMin == null ? (readSettings()?.ratePerMin ?? DEFAULT_RATE) : Number(ratePerMin);
  if (!Number.isFinite(cap) || cap < 1 || cap > 10000) {
    throw Object.assign(new Error('Choose a monthly limit between $1 and $10,000.'), { code: 'BAD_BUDGET' });
  }
  if (!Number.isFinite(rate) || rate <= 0 || rate > 50) {
    throw Object.assign(new Error('The rate per minute must be between $0.01 and $50.'), { code: 'BAD_RATE' });
  }
  getDb().prepare('UPDATE workspace SET budget = ? WHERE id = 1')
    .run(JSON.stringify({ monthlyCap: Math.round(cap * 100) / 100, ratePerMin: rate }));
  return budgetState();
}

export function costOf(minutes) {
  const rate = readSettings()?.ratePerMin ?? DEFAULT_RATE;
  return Math.round(minutes * rate * 100) / 100;
}

/**
 * Whether a paid render of `cost` may start. Returns null when it may, or the
 * refusal: no limit chosen yet, or this render would pass it.
 */
export function budgetRefusal(cost) {
  const b = budgetState();
  if (!b.set) {
    return { code: 'BUDGET_NOT_SET', message: 'Choose a monthly HeyGen limit first (Settings → HeyGen account), so a batch cannot run up your bill. Nothing was sent.' };
  }
  if (b.spent + cost > b.monthlyCap) {
    return {
      code: 'BUDGET_CAP',
      message: `This render (about $${cost.toFixed(2)}) would take this month past your $${b.monthlyCap} HeyGen limit — $${b.remaining.toFixed(2)} left until ${b.resetsOn}. Raise the limit in Settings → HeyGen account to continue. Nothing was sent.`,
    };
  }
  return null;
}
