import { getDb } from '../db/index.js';
import { renderGate } from './segments.js';

// Training — the `content` program's view of the collection hierarchy.
//
// A course IS a campaign and a lesson IS a production. There is deliberately no
// Course/Module/Lesson engine here: "New training work uses this hierarchy. The
// legacy Course → Module → Lesson engine is untouched and still reachable; it is
// not migrated." A second hierarchy is a second set of rules to keep in step.
//
// There is no `collection_type` column for the same reason: "a type field is how
// one generic mechanism turns into three hierarchy engines."

/**
 * ONE function decides order for every reader.
 *
 * `collection_position` is nullable and never backfilled, so a course that has
 * never been ordered by hand is served exactly the newest-first list it was
 * served before the column existed. NULLs sort last and fall back to newest.
 */
export function collectionOrderBy() {
  return `ORDER BY
    CASE WHEN collection_position IS NULL THEN 1 ELSE 0 END,
    collection_position,
    created_at DESC,
    id DESC`;
}

function lessonProgress(productionId) {
  const db = getDb();
  const render = db
    .prepare(
      `SELECT status, stale FROM render_versions
       WHERE production_id = ? ORDER BY version DESC LIMIT 1`
    )
    .get(productionId);
  const script = db
    .prepare("SELECT 1 FROM script_versions WHERE production_id = ? AND status = 'accepted'")
    .get(productionId);
  const gate = renderGate(productionId);

  // The furthest state that is actually true, not the furthest one attempted.
  const state = render?.status === 'complete' && !render.stale ? 'ready'
    : render?.status === 'complete' && render.stale ? 'stale'
    : render?.status === 'failed' ? 'failed'
    : render ? 'rendering'
    : gate.ready ? 'approved'
    : script ? 'scripted'
    : 'draft';

  return { state, gate };
}

export const LESSON_STATE = {
  draft: { label: 'Draft', done: false },
  scripted: { label: 'Script accepted', done: false },
  approved: { label: 'Approved, not rendered', done: false },
  rendering: { label: 'Rendering', done: false },
  failed: { label: 'Render failed', done: false },
  stale: { label: 'Out of date', done: false },
  ready: { label: 'Ready', done: true },
};

/** Courses with their lessons. A campaign with no productions is still a course. */
export function courses() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM campaigns WHERE mode IN ('content','both') ORDER BY position, id`
    )
    .all();

  return rows.map((c) => {
    const lessons = db
      .prepare(`SELECT * FROM productions WHERE campaign_id = ? ${collectionOrderBy()}`)
      .all(c.id)
      .map((p, i) => {
        const { state, gate } = lessonProgress(p.id);
        return {
          id: p.id, title: p.title, subtitle: p.subtitle,
          runtime: p.target_runtime,
          position: p.collection_position,
          ordinal: i + 1,
          ordered: p.collection_position !== null,
          state,
          stateLabel: LESSON_STATE[state].label,
          done: LESSON_STATE[state].done,
          segments: { total: gate.total, heard: gate.heard, ready: gate.ready },
        };
      });

    const done = lessons.filter((l) => l.done).length;
    return {
      id: c.id, title: c.name, description: c.description,
      lessons,
      counts: { lessons: lessons.length, ready: done },
      percent: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
      // Whether anyone has ever set an explicit order on this course.
      ordered: lessons.some((l) => l.ordered),
    };
  });
}

/**
 * Give a course an explicit order.
 *
 * Writes positions for the ids passed and leaves every other production alone —
 * ordering one course must not renumber another, and a production that is not in
 * the list keeps whatever it had.
 */
export function reorderCourse(campaignId, productionIds) {
  const db = getDb();
  const owned = new Set(
    db.prepare('SELECT id FROM productions WHERE campaign_id = ?').all(campaignId).map((r) => r.id)
  );
  const stray = productionIds.filter((id) => !owned.has(id));
  if (stray.length) {
    throw Object.assign(
      new Error(`Not in this course: ${stray.join(', ')}`),
      { code: 'NOT_IN_COURSE' }
    );
  }

  db.transaction(() => {
    productionIds.forEach((id, i) => {
      db.prepare('UPDATE productions SET collection_position = ? WHERE id = ?').run(i, id);
    });
  })();
  return productionIds.length;
}

/** Put a lesson into a course, or take it out. Removal never deletes the work. */
export function setCourse(productionId, campaignId) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM productions WHERE id = ?').get(productionId);
  if (!p) throw Object.assign(new Error('Production not found'), { code: 'NOT_FOUND' });
  if (campaignId !== null && !db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaignId)) {
    throw Object.assign(new Error('Course not found'), { code: 'NOT_FOUND' });
  }
  // Moving between courses drops the old course's ordering rather than carrying a
  // position that meant something in a different list.
  db.prepare('UPDATE productions SET campaign_id = ?, collection_position = NULL WHERE id = ?')
    .run(campaignId, productionId);
  return db.prepare('SELECT * FROM productions WHERE id = ?').get(productionId);
}
