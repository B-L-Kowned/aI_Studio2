import { Router } from 'express';
import { existsSync } from 'node:fs';
import { getDb } from '../db/index.js';
import { madeBy } from '../lib/made-by.js';
import { approvedLines } from '../lib/approved-audio.js';
import { kitFolder } from './editor-kit.js';
import { ok, fail, route } from '../utils/respond.js';

/**
 * Where one video stands in the five steps — Script, Voice, Make, Edit,
 * Finish — read from what has actually happened, the same evidence the
 * register reads. "Make" is Render, Record or Recordings by how it's made.
 */
const router = Router();
const MAKE = { heygen: 'Render', self: 'Record', voice: 'Recordings' };

export function stepsFor(id) {
  const db = getDb();
  const made = madeBy(id);
  const brief = (label) => db.prepare('SELECT value FROM brief_fields WHERE production_id = ? AND label = ?').get(id, label)?.value || null;

  const version = (status) => db.prepare('SELECT id FROM script_versions WHERE production_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(id, status);
  const accepted = version('accepted');
  const draft = version('proposed');
  const checksIn = (v) => (v ? db.prepare('SELECT text FROM script_segments WHERE script_version_id = ?').all(v.id)
    .reduce((n, l) => n + (l.text.match(/\[CONFIRM/gi) ?? []).length, 0) : 0);
  const checks = checksIn(accepted ?? draft);
  const script = {
    done: !!accepted && !checks,
    detail: accepted ? (checks ? `${checks} check${checks === 1 ? '' : 's'} open` : 'Approved') : draft ? 'Draft to approve' : 'No script yet',
  };

  const lines = approvedLines(id);
  const heard = lines.filter((l) => l.file).length;
  const voice = {
    required: made !== 'self',
    done: lines.length > 0 && heard === lines.length,
    detail: lines.length ? `${heard} of ${lines.length} lines approved` : 'After the script',
  };

  let make;
  if (made === 'heygen') {
    const r = db.prepare('SELECT status, version FROM render_versions WHERE production_id = ? ORDER BY version DESC LIMIT 1').get(id);
    make = { done: r?.status === 'complete', detail: r ? `Render v${r.version} ${r.status}` : 'Not rendered' };
  } else if (made === 'self') {
    const n = db.prepare('SELECT COUNT(DISTINCT segment_id) n FROM line_takes WHERE production_id = ? AND segment_id IS NOT NULL').get(id).n;
    make = { done: lines.length > 0 && n >= lines.length, detail: `${n} of ${lines.length} lines recorded` };
  } else {
    const rows = db.prepare("SELECT captured FROM scenes WHERE production_id = ? AND shot_type = 'screen'").all(id);
    const got = rows.filter((r) => r.captured).length;
    make = { done: rows.length > 0 && got === rows.length, detail: rows.length ? `${got} of ${rows.length} screens recorded` : 'Mark the screen shots in the shot list' };
  }
  make.label = MAKE[made] ?? 'Render';

  const finished = !!brief('Completed asset');
  const edit = { optional: true, done: finished || existsSync(kitFolder(id)), detail: finished ? 'Finished' : existsSync(kitFolder(id)) ? 'Kit saved' : 'Optional' };
  const finish = { done: finished, detail: finished ? 'Done' : 'Upload the finished video' };

  const steps = { script, voice, make, edit, finish };
  // A finished video needs nothing more from the steps it skipped.
  if (finished) for (const st of [voice, make]) if (!st.done) Object.assign(st, { done: true, detail: 'Not needed — finished' });
  const order = ['script', 'voice', 'make', 'edit', 'finish'];
  const next = finished ? null
    : order.find((k) => !steps[k].done && !steps[k].optional && steps[k].required !== false) ?? 'finish';
  return { madeBy: made, steps, next };
}

router.get('/:id/steps', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!getDb().prepare('SELECT 1 FROM productions WHERE id = ?').get(id)) return fail(res, 404, 'NOT_FOUND', 'Production not found');
  return ok(res, stepsFor(id));
}));

export default router;
