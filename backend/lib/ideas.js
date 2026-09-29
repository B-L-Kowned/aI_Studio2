import { getDb } from '../db/index.js';

// The parking lot: things you might make, held somewhere that costs nothing.
//
// Capture has to be cheaper than the thing it captures. If recording an idea
// means naming a production, picking a template, choosing a campaign and then
// looking at its empty pipeline forever, you stop recording ideas — or worse,
// you record them and the schedule fills with work nobody chose to start.

const serialize = (r) => ({
  id: r.id,
  text: r.text,
  note: r.note,
  campaignId: r.campaign_id,
  campaign: r.campaign_name ?? null,
  heat: r.heat,
  promotedTo: r.promoted_production_id,
  promotedTitle: r.promoted_title ?? null,
  archivedAt: r.archived_at,
  createdAt: r.created_at,
  ageDays: Math.floor((Date.now() - Date.parse(`${r.created_at}Z`)) / 86400000),
});

export function listIdeas({ includeArchived = false } = {}) {
  const rows = getDb()
    .prepare(
      `SELECT i.*, c.name AS campaign_name, p.title AS promoted_title
         FROM ideas i
         LEFT JOIN campaigns c ON c.id = i.campaign_id
         LEFT JOIN productions p ON p.id = i.promoted_production_id
        WHERE (? OR i.archived_at IS NULL)
        ORDER BY
          CASE i.heat WHEN 'hot' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
          i.created_at DESC`
    )
    .all(includeArchived ? 1 : 0);
  return rows.map(serialize);
}

export function addIdea({ text, note = '', campaignId = null, heat = 'normal' }) {
  const clean = String(text ?? '').trim();
  if (!clean) throw Object.assign(new Error('An idea needs some words.'), { code: 'EMPTY' });

  const id = getDb()
    .prepare('INSERT INTO ideas (text, note, campaign_id, heat) VALUES (?,?,?,?)')
    .run(clean.slice(0, 300), String(note).slice(0, 2000), campaignId, heat).lastInsertRowid;
  return listIdeas().find((i) => i.id === id);
}

export function updateIdea(id, patch) {
  const db = getDb();
  const existing = db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(id);
  if (!existing) throw Object.assign(new Error('No such idea.'), { code: 'NOT_FOUND' });

  if (patch.text !== undefined) {
    db.prepare('UPDATE ideas SET text = ? WHERE id = ?').run(String(patch.text).trim().slice(0, 300), id);
  }
  if (patch.note !== undefined) {
    db.prepare('UPDATE ideas SET note = ? WHERE id = ?').run(String(patch.note).slice(0, 2000), id);
  }
  if (patch.heat !== undefined) {
    if (!['low', 'normal', 'hot'].includes(patch.heat)) {
      throw Object.assign(new Error('Heat is low, normal or hot.'), { code: 'BAD_HEAT' });
    }
    db.prepare('UPDATE ideas SET heat = ? WHERE id = ?').run(patch.heat, id);
  }
  if (patch.campaignId !== undefined) {
    db.prepare('UPDATE ideas SET campaign_id = ? WHERE id = ?').run(patch.campaignId, id);
  }
  if (patch.archived !== undefined) {
    db.prepare(`UPDATE ideas SET archived_at = ${patch.archived ? "datetime('now')" : 'NULL'} WHERE id = ?`)
      .run(id);
  }
  return listIdeas({ includeArchived: true }).find((i) => i.id === id);
}

export function deleteIdea(id) {
  const r = getDb().prepare('DELETE FROM ideas WHERE id = ?').run(id);
  if (!r.changes) throw Object.assign(new Error('No such idea.'), { code: 'NOT_FOUND' });
  return { id };
}

/**
 * Record that an idea became a production.
 *
 * The idea is KEPT and marked, not deleted. The lot is then a record of what
 * you decided to make as well as what you are still thinking about, and an
 * idea cannot be promoted twice by accident.
 */
export function markPromoted(ideaId, productionId) {
  const db = getDb();
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId);
  if (!idea) throw Object.assign(new Error('No such idea.'), { code: 'NOT_FOUND' });
  if (idea.promoted_production_id) {
    throw Object.assign(
      new Error('That idea has already become a production.'),
      { code: 'ALREADY_PROMOTED' }
    );
  }
  db.prepare("UPDATE ideas SET promoted_production_id = ?, archived_at = datetime('now') WHERE id = ?")
    .run(productionId, ideaId);
  return listIdeas({ includeArchived: true }).find((i) => i.id === ideaId);
}

/** How full the lot is, for the one line the dashboard shows. */
export function ideaCounts() {
  const db = getDb();
  const open = db.prepare('SELECT heat, COUNT(*) n FROM ideas WHERE archived_at IS NULL GROUP BY heat').all();
  const total = open.reduce((n, r) => n + r.n, 0);
  return {
    total,
    hot: open.find((r) => r.heat === 'hot')?.n ?? 0,
    promoted: db.prepare('SELECT COUNT(*) n FROM ideas WHERE promoted_production_id IS NOT NULL').get().n,
  };
}
