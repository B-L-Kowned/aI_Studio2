import { getDb } from '../db/index.js';
import { researchWebsite } from './web-research.js';
import { markStaleFrom } from './stale.js';

export function serializeResearch(row) {
  if (!row) return null;
  const parse = (value, fallback) => {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  };
  return {
    id: row.id,
    sourceId: row.source_id,
    url: row.url,
    status: row.status,
    title: row.title,
    description: row.description,
    evidence: parse(row.evidence, {}),
    suggestedBrief: parse(row.suggested_brief, {}),
    reviewed: !!row.reviewed,
    error: row.error,
    researchedAt: row.researched_at,
    reviewedAt: row.reviewed_at,
  };
}

export function researchForProduction(productionId) {
  return getDb()
    .prepare('SELECT * FROM website_research WHERE production_id = ? ORDER BY id DESC')
    .all(productionId)
    .map(serializeResearch);
}

export async function researchSource(productionId, input, { sourceId = null } = {}) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM productions WHERE id = ?').get(productionId)) {
    throw Object.assign(new Error('Production not found'), { code: 'NOT_FOUND' });
  }
  let sid = sourceId;
  if (!sid) {
    sid = db.prepare(
      "INSERT INTO sources (production_id, name, detail, kind) VALUES (?,?,?,'url')"
    ).run(productionId, String(input).slice(0, 200), 'Research pending').lastInsertRowid;
  }
  const id = db.prepare(
    `INSERT INTO website_research (production_id, source_id, url, status)
     VALUES (?,?,?,'pending')`
  ).run(productionId, sid, String(input).slice(0, 2000)).lastInsertRowid;

  try {
    const result = await researchWebsite(input);
    db.prepare(
      `UPDATE website_research SET
         url = ?, status = 'complete', title = ?, description = ?, evidence = ?,
         snapshot = ?, suggested_brief = ?, researched_at = datetime('now'), error = NULL
       WHERE id = ?`
    ).run(
      result.url,
      result.evidence.title,
      result.evidence.description,
      JSON.stringify({
        canonical: result.evidence.canonical,
        siteName: result.evidence.siteName,
        headings: result.evidence.headings,
        paragraphs: result.evidence.paragraphs,
        summary: result.evidence.summary,
      }),
      result.evidence.text,
      JSON.stringify(result.suggestedBrief),
      id
    );
    db.prepare('UPDATE sources SET name = ?, detail = ? WHERE id = ?')
      .run(result.evidence.title || new URL(result.url).hostname,
        `Website researched · ${new URL(result.url).hostname}`, sid);
    return serializeResearch(db.prepare('SELECT * FROM website_research WHERE id = ?').get(id));
  } catch (err) {
    db.prepare(
      "UPDATE website_research SET status = 'failed', error = ?, researched_at = datetime('now') WHERE id = ?"
    ).run(String(err.message).slice(0, 1000), id);
    db.prepare('UPDATE sources SET detail = ? WHERE id = ?').run(`Research failed · ${err.message}`.slice(0, 300), sid);
    err.researchId = id;
    throw err;
  }
}

export function reviewResearch(productionId, researchId, { applyBrief = true } = {}) {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM website_research WHERE id = ? AND production_id = ?')
    .get(researchId, productionId);
  if (!row) throw Object.assign(new Error('Website research not found'), { code: 'NOT_FOUND' });
  if (row.status !== 'complete') {
    throw Object.assign(new Error('Only completed website research can be approved.'), { code: 'NOT_READY' });
  }

  const suggested = (() => {
    try { return JSON.parse(row.suggested_brief || '{}'); } catch { return {}; }
  })();
  let applied = 0;
  db.transaction(() => {
    if (applyBrief) {
      let position = db
        .prepare('SELECT COALESCE(MAX(position), -1) n FROM brief_fields WHERE production_id = ?')
        .get(productionId).n + 1;
      for (const [label, value] of Object.entries(suggested)) {
        if (!String(value ?? '').trim()) continue;
        const existing = db
          .prepare('SELECT * FROM brief_fields WHERE production_id = ? AND lower(label) = lower(?)')
          .get(productionId, label);
        if (existing) {
          if (!String(existing.value ?? '').trim()) {
            db.prepare('UPDATE brief_fields SET value = ? WHERE id = ?').run(String(value).slice(0, 500), existing.id);
            applied++;
          }
        } else {
          db.prepare(
            'INSERT INTO brief_fields (production_id, label, value, position) VALUES (?,?,?,?)'
          ).run(productionId, label, String(value).slice(0, 500), position++);
          applied++;
        }
      }
      if (applied) markStaleFrom(productionId, 'plan', 'Approved website research updated the brief');
    }
    db.prepare(
      "UPDATE website_research SET reviewed = 1, reviewed_at = datetime('now') WHERE id = ?"
    ).run(researchId);
  })();
  return { research: serializeResearch(db.prepare('SELECT * FROM website_research WHERE id = ?').get(researchId)), applied };
}
