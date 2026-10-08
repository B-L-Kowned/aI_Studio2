import { Router } from 'express';
import { getDb } from '../db/index.js';
import { madeBy } from '../lib/made-by.js';
import { ok, route } from '../utils/respond.js';

/**
 * The register's two queues of reading work, across every video at once:
 * drafts with nothing left to check (they only need your yes), and the open
 * [CONFIRM: …] checks inside drafts (each needs an answer). Only drafts are
 * here — an approved script is not edited, it is replaced by a new draft.
 */
const router = Router();
const REGISTER_ID = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — (.*)$/;
const CONFIRM = /\[CONFIRM:\s*([^\]]*)\]/gi;
const PRIORITY = { P1: 0, P2: 1, P3: 2 };

// Release order, as the register lists it.
const order = (v) => {
  const m = /^([A-Z])(\d+)(?:-(\d+))?$/.exec(v);
  return m ? `${'VOTLAI'.indexOf(m[1])}${m[2].padStart(3, '0')}${(m[3] ?? '0').padStart(2, '0')}` : `9${v}`;
};

function drafts() {
  const db = getDb();
  const field = db.prepare('SELECT value FROM brief_fields WHERE production_id = ? AND label = ?');
  const rows = db.prepare(
    `SELECT p.id, p.title, p.target_runtime, co.name AS company, v.id AS version_id, v.version
       FROM productions p
       JOIN script_versions v ON v.id = (SELECT id FROM script_versions WHERE production_id = p.id AND status = 'proposed' ORDER BY id DESC LIMIT 1)
       LEFT JOIN campaigns c ON c.id = p.campaign_id
       LEFT JOIN companies co ON co.id = c.company_id
      WHERE NOT EXISTS (SELECT 1 FROM script_versions a WHERE a.production_id = p.id AND a.status = 'accepted')
        AND NOT EXISTS (SELECT 1 FROM brief_fields b WHERE b.production_id = p.id AND b.label = 'Completed asset' AND b.value != '')`
  ).all().filter((r) => REGISTER_ID.test(r.title));
  const lines = db.prepare('SELECT id, speaker, text FROM script_segments WHERE script_version_id = ? ORDER BY position');
  return rows.map((r) => {
    const [, videoId, name] = REGISTER_ID.exec(r.title);
    const ls = lines.all(r.version_id).filter((l) => l.text.trim());
    return {
      productionId: r.id, videoId, name, company: r.company, versionId: r.version_id, version: r.version,
      priority: field.get(r.id, 'Priority')?.value || null, format: field.get(r.id, 'Format')?.value || null,
      madeBy: madeBy(r.id), target: r.target_runtime,
      lines: ls.map((l) => ({ id: l.id, speaker: l.speaker, text: l.text, checks: [...l.text.matchAll(CONFIRM)].map((m) => m[1].trim()) })),
    };
  }).sort((a, b) => order(a.videoId).localeCompare(order(b.videoId)));
}

router.get('/review', route(async (req, res) => {
  const all = drafts();
  const ready = all.filter((d) => d.lines.length && d.lines.every((l) => !l.checks.length));
  const withChecks = all.filter((d) => d.lines.some((l) => l.checks.length));
  const byPriority = (a, b) => (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9);
  const sort = req.query.sort === 'priority' ? (list) => [...list].sort(byPriority) : (list) => list;
  return ok(res, {
    ready: sort(ready),
    checks: sort(withChecks).map((d) => ({ ...d, lines: d.lines.filter((l) => l.checks.length) })),
    totals: { ready: ready.length, videosWithChecks: withChecks.length, checks: withChecks.reduce((n, d) => n + d.lines.reduce((m, l) => m + l.checks.length, 0), 0) },
  });
}));

export default router;
