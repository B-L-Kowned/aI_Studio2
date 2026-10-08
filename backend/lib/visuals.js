import { getDb } from '../db/index.js';

/**
 * Visuals: the shot list. One row per outline section — what is on screen
 * while that part of the script plays. Rows live in `scenes` (the generator
 * still reads them as scenes) and follow the outline: a renamed or retimed
 * section is renamed or retimed here, never copied once and left behind.
 */
export const SHOTS = [
  { id: 'camera', label: 'You on camera' },
  { id: 'screen', label: 'Screen recording' },
  { id: 'diagram', label: 'Diagram / graphic' },
  { id: 'broll', label: 'B-roll / lifestyle' },
  { id: 'title', label: 'Title card' },
];
const SHOT_IDS = new Set(SHOTS.map((s) => s.id));

/** The shot a section starts as, from the production's format. */
function defaultShot(format, index, count) {
  const f = String(format ?? '').toLowerCase();
  if (/screen recording/.test(f)) return 'screen';
  if (/diagram/.test(f)) return 'diagram';
  if (/graphic/.test(f)) return 'diagram';
  if (/lifestyle/.test(f)) return 'broll';
  // "Avatar or product visuals": open and close on camera, show the product between.
  if (/product visuals/.test(f) && count > 2 && index > 0 && index < count - 1) return 'screen';
  return 'camera';
}

const field = (productionId, label) =>
  getDb().prepare('SELECT value FROM brief_fields WHERE production_id = ? AND label = ?').get(productionId, label)?.value ?? '';

/** Make the rows match the outline: create missing, refresh titles/times, drop orphans that hold nothing. */
export function syncVisualRows(productionId) {
  const db = getDb();
  const sections = db.prepare('SELECT * FROM outline_sections WHERE production_id = ? ORDER BY position').all(productionId);
  const format = field(productionId, 'Format');
  // The pack's visual plan ("Problem → offer → product visuals → CTA") fills
  // the detail when it has one step per section.
  const plan = field(productionId, 'Visual plan').split('→').map((x) => x.trim().replace(/\.$/, '')).filter(Boolean);
  const rows = db.prepare('SELECT * FROM scenes WHERE production_id = ?').all(productionId);
  const bySection = new Map(rows.filter((r) => r.outline_section_id).map((r) => [r.outline_section_id, r]));
  const ins = db.prepare(
    `INSERT INTO scenes (production_id, outline_section_id, position, ref, title, participants, runtime, purpose, shot_type)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const upd = db.prepare('UPDATE scenes SET position = ?, ref = ?, title = ?, participants = ?, runtime = ? WHERE id = ?');
  db.transaction(() => {
    sections.forEach((s, i) => {
      const row = bySection.get(s.id);
      if (row) upd.run(i, `${i + 1}`, s.title, s.participants, s.runtime, row.id);
      else {
        ins.run(productionId, s.id, i, `${i + 1}`, s.title, s.participants, s.runtime,
          plan.length === sections.length ? plan[i] : '', defaultShot(format, i, sections.length));
      }
    });
    // A row whose section was deleted goes too, unless someone wrote in it.
    db.prepare(
      `DELETE FROM scenes WHERE production_id = ? AND outline_section_id IS NULL
         AND purpose = '' AND onscreen_text = '' AND captured = 0`
    ).run(productionId);
  })();
}

/** Lines of the latest script, placed into sections by their position in the running text. */
function linesBySection(productionId, sectionIds, sectionSeconds) {
  const db = getDb();
  const v = db.prepare('SELECT id FROM script_versions WHERE production_id = ? ORDER BY version DESC LIMIT 1').get(productionId);
  if (!v) return new Map();
  const lines = db.prepare('SELECT id, speaker, text FROM script_segments WHERE script_version_id = ? ORDER BY position').all(v.id)
    .map((l) => ({ ...l, words: l.text.replace(/\[CONFIRM:[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length }));
  const total = lines.reduce((n, l) => n + l.words, 0);
  const planned = sectionSeconds.reduce((n, s) => n + s, 0);
  const out = new Map(sectionIds.map((id) => [id, []]));
  if (!total || !planned) return out;
  const bounds = []; let acc = 0;
  for (const s of sectionSeconds) { acc += s / planned; bounds.push(acc); }
  let start = 0;
  for (const l of lines) {
    const mid = (start + l.words / 2) / total;
    const i = bounds.findIndex((b) => mid <= b + 1e-9);
    out.get(sectionIds[i === -1 ? sectionIds.length - 1 : i]).push(l);
    start += l.words;
  }
  return out;
}

const secs = (rt) => { const [m, s] = String(rt ?? '0:00').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

export function visualsFor(productionId) {
  syncVisualRows(productionId);
  const db = getDb();
  const rows = db.prepare('SELECT * FROM scenes WHERE production_id = ? ORDER BY position, id').all(productionId);
  const lines = linesBySection(productionId, rows.map((r) => r.id), rows.map((r) => secs(r.runtime)));
  const p = db.prepare('SELECT scenes_approved FROM productions WHERE id = ?').get(productionId);
  return {
    approved: !!p?.scenes_approved,
    format: field(productionId, 'Format'),
    shots: SHOTS,
    rows: rows.map((r) => ({
      id: r.id, ref: r.ref, title: r.title, runtime: r.runtime, seconds: secs(r.runtime),
      participants: r.participants, shotType: r.shot_type || 'camera', detail: r.purpose,
      onscreenText: r.onscreen_text ?? '', captured: !!r.captured,
      recording: r.recording_asset_id
        ? (() => { const a = db.prepare('SELECT id, name, duration FROM assets WHERE id = ?').get(r.recording_asset_id);
          return a && { id: a.id, name: a.name, duration: a.duration, fileUrl: `/api/library/${a.id}/file` }; })()
        : null,
      lines: (lines.get(r.id) ?? []).map((l) => ({ id: l.id, text: l.text, words: l.words })),
    })),
  };
}

export function updateVisualRow(productionId, rowId, { shotType, detail, onscreenText, captured }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM scenes WHERE id = ? AND production_id = ?').get(rowId, productionId);
  if (!row) throw Object.assign(new Error('No such shot.'), { code: 'NOT_FOUND' });
  if (shotType !== undefined && !SHOT_IDS.has(shotType)) {
    throw Object.assign(new Error('Unknown shot type.'), { code: 'BAD_SHOT' });
  }
  const next = {
    shot_type: shotType ?? row.shot_type,
    purpose: detail === undefined ? row.purpose : String(detail).slice(0, 1000),
    onscreen_text: onscreenText === undefined ? row.onscreen_text : String(onscreenText).slice(0, 300),
    captured: captured === undefined ? row.captured : captured ? 1 : 0,
  };
  db.prepare('UPDATE scenes SET shot_type = ?, purpose = ?, onscreen_text = ?, captured = ? WHERE id = ?')
    .run(next.shot_type, next.purpose, next.onscreen_text, next.captured, row.id);
  // What is on screen changing is a change to the approved plan.
  const changesPlan = shotType !== undefined || detail !== undefined || onscreenText !== undefined;
  if (changesPlan) db.prepare('UPDATE productions SET scenes_approved = 0 WHERE id = ?').run(productionId);
  return visualsFor(productionId);
}

export function approveVisuals(productionId) {
  const v = visualsFor(productionId);
  if (!v.rows.length) throw Object.assign(new Error('There is nothing to approve yet — add an outline section.'), { code: 'EMPTY' });
  const thin = v.rows.filter((r) => r.shotType !== 'camera' && !r.detail.trim());
  if (thin.length) {
    throw Object.assign(new Error(`Say what is shown in: ${thin.map((r) => r.title).join(', ')}.`), { code: 'INCOMPLETE' });
  }
  getDb().prepare('UPDATE productions SET scenes_approved = 1 WHERE id = ?').run(productionId);
  return visualsFor(productionId);
}
