import { getDb } from '../db/index.js';
import { buildSegments } from './segments.js';

// What each starting point actually DOES.
//
// Six were offered and one behaved differently; the other five accepted their
// sourceType and ignored it, so "from an existing script" produced exactly the
// same blank production as "from an idea". A menu of six routes that converge
// before they diverge is a menu of one route with six labels.

/**
 * Turn pasted script text into an accepted script version.
 *
 * Speaker detection is deliberately simple and deliberately visible: a line of
 * the form "Name: words" is dialogue by Name, and anything else belongs to the
 * previous speaker. Guessing harder would mis-attribute lines silently, and a
 * line attributed to the wrong presenter renders in the wrong voice.
 */
export function parseScript(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // A scene heading, kept as a marker rather than as dialogue.
    if (/^(scene|int\.|ext\.)\b/i.test(line) || /^#{1,3}\s/.test(line)) {
      current = null;
      continue;
    }
    const m = /^([A-Z][\w .'-]{0,38}?)\s*[:—-]\s+(.*)$/.exec(line);
    if (m && m[2]) {
      current = { speaker: m[1].trim(), text: m[2].trim() };
      out.push(current);
    } else if (current) {
      current.text = `${current.text} ${line}`.trim();
    } else {
      current = { speaker: 'Narrator', text: line };
      out.push(current);
    }
  }
  return out;
}

/**
 * Import a script someone already wrote, as an ACCEPTED version.
 *
 * Accepted, not proposed: you did not ask this app to write it, so there is
 * nothing here for you to approve. The outline is left alone — an imported
 * script is evidence of a plan, not a replacement for one.
 */
export function importScript(productionId, text, { status = 'accepted' } = {}) {
  if (!['accepted', 'proposed'].includes(status)) {
    throw Object.assign(new Error('status must be accepted or proposed'), { code: 'BAD_STATUS' });
  }
  const db = getDb();
  const segments = parseScript(text);
  if (!segments.length) {
    throw Object.assign(
      new Error('Nothing in that script looked like dialogue.'),
      { code: 'EMPTY_SCRIPT' }
    );
  }

  const imported = db.transaction(() => {
    const version =
      (db.prepare('SELECT MAX(version) m FROM script_versions WHERE production_id = ?')
        .get(productionId).m ?? 0) + 1;
    const vid = db
      // Recorded as imported so it is never mistaken for the app's own output.
      .prepare('INSERT INTO script_versions (production_id, version, status, generator_provider) VALUES (?,?,?,?)')
      .run(productionId, version, status, 'imported').lastInsertRowid;

    const ins = db.prepare(
      'INSERT INTO script_segments (script_version_id, scene_id, position, speaker, text) VALUES (?,?,?,?,?)'
    );
    segments.forEach((s, i) => ins.run(vid, null, i, s.speaker, s.text));

    // An imported script is already agreed, so the gates it would have passed
    // through are marked passed rather than left to be clicked through.
    // The outline is evidenced by the script; the visuals are not — they are
    // planned and approved in Visuals, not assumed from an imported text.
    db.prepare('UPDATE productions SET outline_approved = 1 WHERE id = ?')
      .run(productionId);

    return {
      version,
      status,
      lines: segments.length,
      speakers: [...new Set(segments.map((s) => s.speaker))],
    };
  })();

  // An imported script is accepted on arrival, so it crosses the same
  // acceptance boundary as a script approved in the editor. Its production
  // lines should be ready without teaching a second workflow for this source.
  // A draft written elsewhere still needs your yes: it lands as a proposal you
  // can edit, accept or reject, and nothing downstream is built from it yet.
  if (status === 'proposed') return imported;
  return { ...imported, segmentBuild: buildSegments(productionId) };
}

/**
 * Copy an existing production's plan into a new one.
 *
 * The PLAN only: brief, outline, scenes, sources and decisions. Scripts, takes,
 * renders and publications are the results of that plan being worked, and
 * copying them would hand you a new production that claims work nobody did.
 */
export function copyPlanFrom(sourceId, targetId) {
  const db = getDb();
  const src = db.prepare('SELECT * FROM productions WHERE id = ?').get(sourceId);
  if (!src) throw Object.assign(new Error('That production does not exist.'), { code: 'NOT_FOUND' });

  return db.transaction(() => {
    db.prepare('DELETE FROM brief_fields WHERE production_id = ?').run(targetId);
    db.prepare('DELETE FROM outline_sections WHERE production_id = ?').run(targetId);
    db.prepare('DELETE FROM decisions WHERE production_id = ?').run(targetId);
    db.prepare('DELETE FROM scenes WHERE production_id = ?').run(targetId);
    db.prepare('DELETE FROM sources WHERE production_id = ?').run(targetId);

    const copy = (table, cols) => {
      const rows = db.prepare(`SELECT * FROM ${table} WHERE production_id = ?`).all(sourceId);
      const ins = db.prepare(
        `INSERT INTO ${table} (production_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
      );
      for (const r of rows) ins.run(targetId, ...cols.map((c) => r[c]));
      return rows.length;
    };

    const counts = {
      brief: copy('brief_fields', ['label', 'value', 'position']),
      outline: copy('outline_sections', ['position', 'title', 'runtime', 'participants', 'purpose']),
      scenes: copy('scenes', ['position', 'ref', 'title', 'participants', 'runtime', 'purpose']),
      sources: copy('sources', ['name', 'detail', 'kind']),
      decisions: copy('decisions', ['kind', 'text', 'position']),
    };

    db.prepare('UPDATE productions SET target_runtime = ?, mode = ? WHERE id = ?')
      .run(src.target_runtime, src.mode, targetId);
    // Approvals do NOT come across: this is a new production, and nobody has
    // yet agreed to its plan.
    db.prepare('UPDATE productions SET outline_approved = 0, scenes_approved = 0 WHERE id = ?')
      .run(targetId);

    db.prepare('INSERT INTO decisions (production_id, kind, text, position) VALUES (?,?,?,?)')
      .run(targetId, 'locked', `Plan copied from "${src.title}"`, 0);

    return { from: src.title, counts };
  })();
}
