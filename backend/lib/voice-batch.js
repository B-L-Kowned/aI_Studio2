import { getDb } from '../db/index.js';
import { segmentsFor, auditionSegment } from './segments.js';
import { LOCAL } from './local-voice.js';

/**
 * Your voice for many videos, made one line at a time in the background —
 * free, on this Mac, at about twice real time, so a queue of forty videos is
 * an overnight job. Only lines cast in your local voice are made: the batch
 * never spends HeyGen credits. Takes are made, not approved — you still listen.
 */
let running = false;

export function enqueue(productionIds) {
  const db = getDb();
  const open = db.prepare("SELECT 1 FROM voice_batch WHERE production_id = ? AND state IN ('queued','running')");
  const add = db.prepare('INSERT INTO voice_batch (production_id) VALUES (?)');
  let added = 0;
  for (const id of productionIds) {
    if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(id) || open.get(id)) continue;
    add.run(id); added++;
  }
  kick();
  return added;
}

export function cancel() {
  return getDb().prepare("UPDATE voice_batch SET state = 'cancelled', finished_at = datetime('now') WHERE state IN ('queued','running')").run().changes;
}

/** Pick up after a restart: whatever was mid-way goes back in the queue. */
export function resume() {
  getDb().prepare("UPDATE voice_batch SET state = 'queued' WHERE state = 'running'").run();
  kick();
}

export function batchState() {
  const rows = getDb().prepare(
    `SELECT b.*, p.title FROM voice_batch b JOIN productions p ON p.id = b.production_id
      WHERE b.state IN ('queued','running') OR b.finished_at > datetime('now', '-1 day') ORDER BY b.id`
  ).all();
  return {
    running,
    items: rows.map((r) => ({ id: r.id, productionId: r.production_id, title: r.title, state: r.state, done: r.done, total: r.total, failed: r.failed, note: r.note })),
    queued: rows.filter((r) => r.state === 'queued').length,
  };
}

function kick() {
  if (running) return;
  running = true;
  (async () => {
    const db = getDb();
    try {
      for (;;) {
        const job = db.prepare("SELECT * FROM voice_batch WHERE state = 'queued' ORDER BY id LIMIT 1").get();
        if (!job) break;
        const pending = segmentsFor(job.production_id).filter((s) => s.needsAudition && s.presenter?.voice);
        const mine = pending.filter((s) => s.presenter.voice.provider === LOCAL);
        if (!mine.length) {
          const note = pending.length ? 'Not your local voice — made only by hand, with a cost check' : 'Nothing to make — every line already has a current take';
          db.prepare("UPDATE voice_batch SET state = 'skipped', note = ?, finished_at = datetime('now') WHERE id = ?").run(note, job.id);
          continue;
        }
        db.prepare("UPDATE voice_batch SET state = 'running', total = ?, done = 0 WHERE id = ?").run(mine.length, job.id);
        let failed = 0; let last = null;
        for (const [i, seg] of mine.entries()) {
          if (db.prepare('SELECT state FROM voice_batch WHERE id = ?').get(job.id).state === 'cancelled') break;
          try { await auditionSegment(seg.id); } catch (err) { failed++; last = err.message; }
          db.prepare('UPDATE voice_batch SET done = ?, failed = ? WHERE id = ?').run(i + 1, failed, job.id);
        }
        db.prepare(`UPDATE voice_batch SET state = CASE WHEN state = 'cancelled' THEN 'cancelled' WHEN ? = total THEN 'failed' ELSE 'done' END,
                    note = ?, finished_at = datetime('now') WHERE id = ?`).run(failed, last, job.id);
      }
    } finally {
      running = false;
    }
  })();
}
