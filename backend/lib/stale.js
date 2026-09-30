// The state rule from docs/ARCHITECTURE.md §3: an upstream edit never silently
// overwrites downstream work. It marks the dependents stale and leaves the user
// to regenerate or reconcile. Nothing here deletes a row.

import { getDb } from '../db/index.js';

// Ordered downstream of each stage. Editing the plan reaches everything after it.
const CHAIN = ['plan', 'script', 'render', 'export', 'publication'];

const TABLE_FOR = {
  script: 'script_versions',
  render: 'render_versions',
  export: 'exports',
  publication: 'publications',
};

// Only the LIVE artifact of each kind is worth flagging. A rejected script or a
// cancelled render is already superseded — marking it stale inflates the count
// and makes a normal, expected state read like a failure.
const LIVE = {
  script: `id = (SELECT id FROM script_versions WHERE production_id = :pid ORDER BY version DESC LIMIT 1)`,
  render: `id = (SELECT id FROM render_versions  WHERE production_id = :pid AND status IN ('queued','processing','complete') ORDER BY version DESC LIMIT 1)`,
  export: `id = (SELECT id FROM exports          WHERE production_id = :pid ORDER BY version DESC LIMIT 1)`,
  // Each prepared platform is independently live.
  publication: `status != 'not_prepared'`,
};

/**
 * Mark everything downstream of `stage` as stale for one production.
 * Returns a count per artifact type so callers can report what they disturbed.
 */
export function markStaleFrom(productionId, stage, reason) {
  const db = getDb();
  const start = CHAIN.indexOf(stage);
  if (start === -1) throw new Error(`Unknown stage: ${stage}`);

  const affected = {};
  for (const downstream of CHAIN.slice(start + 1)) {
    const table = TABLE_FOR[downstream];

    // Invariant: only a live artifact carries a stale flag. A version that has
    // since been superseded is cleared, otherwise old rows keep a flag the
    // summary no longer counts and the UI contradicts itself.
    db.prepare(
      `UPDATE ${table} SET stale = 0, stale_reason = NULL
       WHERE production_id = :pid AND stale = 1 AND NOT (${LIVE[downstream]})`
    ).run({ pid: productionId });

    const res = db
      .prepare(
        `UPDATE ${table} SET stale = 1, stale_reason = :reason
         WHERE production_id = :pid AND stale = 0 AND ${LIVE[downstream]}`
      )
      .run({ pid: productionId, reason });
    if (res.changes) affected[downstream] = res.changes;
  }
  return affected;
}

/** Summary the UI uses to show stale badges without fetching every artifact. */
export function staleSummary(productionId) {
  const db = getDb();
  const out = {};
  for (const [key, table] of Object.entries(TABLE_FOR)) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n, MAX(stale_reason) AS reason
         FROM ${table}
         WHERE production_id = :pid AND stale = 1 AND ${LIVE[key]}`
      )
      .get({ pid: productionId });
    if (row.n > 0) out[key] = { count: row.n, reason: row.reason };
  }
  return out;
}

export function clearStale(table, id) {
  getDb()
    .prepare(`UPDATE ${table} SET stale = 0, stale_reason = NULL WHERE id = ?`)
    .run(id);
}
