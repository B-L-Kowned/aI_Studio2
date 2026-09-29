import 'dotenv/config';
import { openDb, closeDb } from './db/index.js';
import * as fx from './data/fixtures.js';

const db = openDb();

// Leaves workspace/credentials alone so seeding does not wipe an onboarded
// install; pass --reset-workspace to send the app back to first run.
const resetWorkspace = process.argv.includes('--reset-workspace');

db.transaction(() => {
  db.exec(`
    DELETE FROM publications;  DELETE FROM exports;
    DELETE FROM edit_decisions; DELETE FROM render_versions;
    DELETE FROM script_segments; DELETE FROM script_versions;
    DELETE FROM decisions; DELETE FROM sources; DELETE FROM scenes;
    DELETE FROM outline_sections; DELETE FROM brief_fields;
    DELETE FROM calendar_entries; DELETE FROM productions;
    DELETE FROM campaigns; DELETE FROM people; DELETE FROM assets;
    DELETE FROM presenters;
  `);

  if (resetWorkspace) {
    // Provider state is part of the install, not the sample content — a reset
    // that leaves HeyGen "connected" does not reproduce a real first run.
    db.exec(`
      DELETE FROM provider_jobs; DELETE FROM provider_assets; DELETE FROM provider_accounts;
      DELETE FROM credentials; DELETE FROM publishing_connections; DELETE FROM workspace;
    `);
    db.prepare('INSERT INTO workspace (id) VALUES (1)').run();
  }

  const campaignIds = {};
  const insCampaign = db.prepare(
    'INSERT INTO campaigns (name, description, mode, position) VALUES (?,?,?,?)'
  );
  for (const c of fx.campaigns) {
    campaignIds[c.name] = insCampaign.run(c.name, c.description, c.mode, c.position).lastInsertRowid;
  }

  const p = fx.production;
  const productionId = db
    .prepare(
      `INSERT INTO productions
        (campaign_id, slug, title, breadcrumb, subtitle, target_runtime, mode)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(campaignIds[p.campaign], p.slug, p.title, p.breadcrumb, p.subtitle, p.target_runtime, p.mode)
    .lastInsertRowid;

  const insBrief = db.prepare(
    'INSERT INTO brief_fields (production_id, label, value, position) VALUES (?,?,?,?)'
  );
  p.brief.forEach(([label, value], i) => insBrief.run(productionId, label, value, i));

  const insOutline = db.prepare(
    'INSERT INTO outline_sections (production_id, position, title, runtime, participants, purpose) VALUES (?,?,?,?,?,?)'
  );
  const outlineIds = p.outline.map((s, i) =>
    insOutline.run(productionId, i, s.title, s.runtime, s.participants, s.purpose).lastInsertRowid
  );

  const insScene = db.prepare(
    'INSERT INTO scenes (production_id, outline_section_id, position, ref, title, participants, runtime, purpose) VALUES (?,?,?,?,?,?,?,?)'
  );
  p.scenes.forEach((s, i) =>
    insScene.run(productionId, outlineIds[s.outlineIndex], i, s.ref, s.title, s.participants, s.runtime, '')
  );

  const insDecision = db.prepare(
    'INSERT INTO decisions (production_id, kind, text, position) VALUES (?,?,?,?)'
  );
  p.decisions.forEach((d, i) => insDecision.run(productionId, d.kind, d.text, i));

  const insSource = db.prepare(
    'INSERT INTO sources (production_id, name, detail, kind) VALUES (?,?,?,?)'
  );
  for (const s of p.sources) insSource.run(productionId, s.name, s.detail, s.kind);

  const insPerson = db.prepare(
    'INSERT INTO people (name, role, representation, consent_scope, status, position) VALUES (?,?,?,?,?,?)'
  );
  for (const x of fx.people)
    insPerson.run(x.name, x.role, x.representation, x.consent_scope, x.status, x.position);

  const insPresenter = db.prepare(
    `INSERT INTO presenters (kind, name, program, description, artwork_url, position)
     VALUES (?,?,?,?,?,?)`
  );
  fx.presenters.forEach((p, i) => {
    const program = p.kind === 'character' ? 'funny' : p.kind === 'avatar' ? 'content' : null;
    insPresenter.run(p.kind, p.name, program, p.description, p.artworkUrl ?? null, i);
  });

  const insAsset = db.prepare('INSERT INTO assets (name, kind, position) VALUES (?,?,?)');
  for (const a of fx.assets) insAsset.run(a.name, a.kind, a.position);

  const insCal = db.prepare(
    'INSERT INTO calendar_entries (day, title, status, production_id) VALUES (?,?,?,?)'
  );
  for (const c of fx.calendarEntries) insCal.run(c.day, c.title, c.status, productionId);
})();

const counts = Object.fromEntries(
  ['presenters', 'campaigns', 'productions', 'brief_fields', 'outline_sections', 'scenes', 'decisions', 'sources', 'people', 'assets', 'calendar_entries'].map(
    (t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]
  )
);

console.log('[seed] done', counts);
if (Object.values(counts).some((n) => n === 0)) {
  console.error('[seed] a table came back empty');
  closeDb();
  process.exit(1);
}
closeDb();
