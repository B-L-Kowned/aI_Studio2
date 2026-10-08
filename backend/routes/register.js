import { Router } from 'express';
import { getDb } from '../db/index.js';
import { ok, route } from '../utils/respond.js';
import { madeBy } from '../lib/made-by.js';

const router = Router();

// The register's Video ID leads the production title: "V14-02 — Goalzie: …".
// Register IDs (V14-02, O05) and the script pack's own (GTM-03, SRC-NS-ADMIN).
const secs = (rt) => { const [m, s] = String(rt ?? '').split(':').map(Number); return (m || 0) * 60 + (s || 0); };
const REGISTER_ID = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*) — (.*)$/;
const WORKSTREAM = { V: 'Company', O: 'Outreach', T: 'Training', L: 'Wrapper', A: 'Editions', I: 'Investor', GTM: 'GTM masters', SRC: 'Training' };
export const streamOf = (id) => WORKSTREAM[/^(GTM|SRC)-/.exec(id)?.[1] ?? id[0]] ?? 'Other';
export const WORKSTREAMS = [...new Set(Object.values(WORKSTREAM))];
// Read the furthest true step, in the order the work actually happens.
// A draft splits by whether it still holds [CONFIRM: …] checks: one with none
// only needs your yes.
const STAGES = ['needs-script', 'draft-checks', 'draft-ready', 'script', 'audio', 'audio-approved', 'final', 'done'];

/**
 * The video register as the app sees it: what the workbook says (priority,
 * format, statuses — carried in the brief) beside what has actually happened
 * here (script accepted, lines heard, renders finished). Where the two
 * disagree, both are shown; the register's word is never silently replaced.
 */
export function buildRegister() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT p.id, p.title, p.target_runtime, c.name AS track, co.name AS company, co.group_name AS grp
       FROM productions p
       LEFT JOIN campaigns c ON c.id = p.campaign_id
       LEFT JOIN companies co ON co.id = c.company_id`
  ).all().filter((r) => REGISTER_ID.test(r.title));

  const briefOf = db.prepare('SELECT label, value FROM brief_fields WHERE production_id = ?');
  const accepted = db.prepare(
    "SELECT COUNT(*) n FROM script_versions WHERE production_id = ? AND status = 'accepted'"
  );
  const proposed = db.prepare(
    "SELECT COUNT(*) n FROM script_versions WHERE production_id = ? AND status = 'proposed'"
  );
  // The look for the performer: approved, waiting for approval, or none yet.
  const lookOf = db.prepare(
    `SELECT ap.status, pa.name FROM appearance_proofs ap LEFT JOIN provider_assets pa ON pa.id = ap.avatar_asset_id
      WHERE ap.production_id = ? AND ap.status IN ('approved','draft') ORDER BY ap.status = 'approved' DESC, ap.id DESC LIMIT 1`
  );
  // Open checks in the newest draft (or, with none, the accepted script).
  const checksOf = db.prepare(
    `SELECT ss.text FROM script_segments ss WHERE ss.script_version_id = (
       SELECT id FROM script_versions WHERE production_id = ? AND status != 'rejected'
        ORDER BY status = 'proposed' DESC, id DESC LIMIT 1)`
  );
  const segs = db.prepare(
    `SELECT s.id,
            (SELECT t.heard FROM takes t WHERE t.segment_id = s.id ORDER BY t.version DESC LIMIT 1) AS heard,
            (SELECT COUNT(*) FROM takes t WHERE t.segment_id = s.id) AS takes,
            (SELECT r.status FROM segment_renders r WHERE r.segment_id = s.id ORDER BY r.version DESC LIMIT 1) AS render
       FROM segments s WHERE s.production_id = ?`
  );

  const items = rows.map((r) => {
    const [, videoId, name] = REGISTER_ID.exec(r.title);
    const b = Object.fromEntries(briefOf.all(r.id).map((f) => [f.label, f.value]));
    const lines = segs.all(r.id);
    const heard = lines.filter((l) => l.heard).length;
    const rendered = lines.filter((l) => l.render === 'complete').length;
    const format = b.Format ?? '';
    const made = madeBy(r.id, format);
    const voiceOnly = made === 'voice';
    const selfRecorded = made === 'self';
    const done = !!b['Completed asset'];
    const checks = checksOf.all(r.id).reduce((n, l) => n + (l.text.match(/\[CONFIRM/gi) ?? []).length, 0);
    const stage = done ? 'done'
      : lines.length && rendered === lines.length ? 'final'
      : lines.length && heard === lines.length ? 'audio-approved'
      : lines.some((l) => l.takes) ? 'audio'
      : accepted.get(r.id).n ? 'script'
      // A draft written elsewhere, waiting for your yes.
      : proposed.get(r.id).n ? (checks ? 'draft-checks' : 'draft-ready')
      : 'needs-script';
    return {
      id: r.id, videoId, name, workstream: streamOf(videoId),
      company: r.company, group: r.grp, track: r.track,
      priority: b.Priority || null, format, voiceOnly, selfRecorded, checks,
      madeBy: made,
      runtime: r.target_runtime, runtimeSeconds: secs(r.target_runtime), registerDuration: b['Register duration'] || null,
      scriptStatus: b['Script status'] || null,
      inRegister: !b['Script pack only'],
      stage, lines: lines.length, heard, rendered,
      // Four answers the list shows at a glance.
      marks: {
        script: done ? 'done' : accepted.get(r.id).n ? 'done' : proposed.get(r.id).n ? 'draft' : 'none',
        audio: done ? 'done' : lines.length && heard === lines.length ? 'done' : lines.some((l) => l.takes) ? 'partial' : 'none',
        look: done ? 'done' : voiceOnly || selfRecorded ? 'n/a' : (() => { const l = lookOf.get(r.id); return l ? (l.status === 'approved' ? 'done' : 'draft') : 'none'; })(),
        lookName: lookOf.get(r.id)?.name ?? null,
        // Your own recording is done when its file arrives; there is no render.
        video: done ? 'done' : selfRecorded ? 'none' : lines.length && rendered === lines.length ? 'done' : rendered ? 'partial' : 'none',
      },
      completedAsset: b['Completed asset'] || null,
      verify: b['Verify first'] || null,
      register: {
        overall: b['Status: overall'] || null, script: b['Status: script'] || null,
        mp3: b['Status: MP3'] || null, final: b['Status: final video'] || null,
        published: b['Status: published'] || null,
      },
      next: b['Owner / next action'] || null,
    };
  });

  // Register order first (V, O, T, L, A, I), then the pack's GTM and SRC rows.
  const order = (v) => {
    const m = /^([A-Z])(\d+)(?:-(\d+))?$/.exec(v);
    if (!m) return `9${v}`;
    return `${'VOTLAI'.indexOf(m[1])}${m[2].padStart(3, '0')}${(m[3] ?? '0').padStart(2, '0')}`;
  };
  items.sort((a, b) => order(a.videoId).localeCompare(order(b.videoId)));
  const count = (k, v) => items.filter((i) => i[k] === v).length;
  return {
    items,
    totals: {
      all: items.length,
      stages: Object.fromEntries(STAGES.map((s) => [s, count('stage', s)])),
      voiceOnly: items.filter((i) => i.voiceOnly).length,
      priority: { P1: count('priority', 'P1'), P2: count('priority', 'P2'), P3: count('priority', 'P3') },
    },
  };
}

router.get('/register', route(async (_req, res) => ok(res, buildRegister())));

export default router;
