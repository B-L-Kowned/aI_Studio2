import { getDb } from '../db/index.js';

// Company → Track → Production.
//
// A company is who the work is FOR. A track is what it is trying to do for
// them, and who it is talking to while it does it — an investor update and a
// GTM explainer for the same company share nothing except the company.
//
// The purpose list is deliberately short and closed. Its value is that the
// "investor" track means the same thing across all fifty companies, so they can
// be compared; a free-text purpose would give fifty spellings of one idea.

export const PURPOSES = [
  { id: 'promotion',  label: 'Promotion',  detail: 'Reach and awareness — the people who have not heard of it' },
  { id: 'gtm',        label: 'GTM',        detail: 'Go to market — buyers deciding right now' },
  { id: 'investor',   label: 'Investor',   detail: 'Capital and board — people reading the numbers' },
  { id: 'training',   label: 'Training',   detail: 'Customers or staff learning to use it' },
  { id: 'recruiting', label: 'Recruiting', detail: 'People who might come and work on it' },
  { id: 'internal',   label: 'Internal',   detail: 'The team — not for outside eyes' },
];

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function listCompanies({ includeRetired = false } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM companies WHERE (? OR is_active = 1) ORDER BY position, name`
    )
    .all(includeRetired ? 1 : 0);

  return rows.map((c) => {
    const tracks = db
      .prepare('SELECT * FROM campaigns WHERE company_id = ? ORDER BY position, id')
      .all(c.id);
    const productions = db
      .prepare(
        `SELECT COUNT(*) n FROM productions
          WHERE campaign_id IN (SELECT id FROM campaigns WHERE company_id = ?)`
      )
      .get(c.id).n;

    return {
      id: c.id, name: c.name, slug: c.slug, domain: c.domain,
      notes: c.notes, isActive: !!c.is_active,
      tracks: tracks.map((t) => ({
        id: t.id, name: t.name, purpose: t.purpose ?? null, audience: t.audience ?? null,
        productions: db
          .prepare('SELECT COUNT(*) n FROM productions WHERE campaign_id = ?')
          .get(t.id).n,
      })),
      // A company with no track has nothing to make, which is worth seeing.
      counts: { tracks: tracks.length, productions },
    };
  });
}

export function addCompany({ name, domain = null, notes = '' }) {
  const db = getDb();
  const clean = String(name ?? '').trim();
  if (!clean) throw Object.assign(new Error('A company needs a name.'), { code: 'EMPTY' });
  if (db.prepare('SELECT 1 FROM companies WHERE name = ?').get(clean)) {
    throw Object.assign(new Error(`"${clean}" is already here.`), { code: 'DUPLICATE' });
  }

  let slug = slugify(clean) || 'company';
  if (db.prepare('SELECT 1 FROM companies WHERE slug = ?').get(slug)) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }
  const position = db.prepare('SELECT COUNT(*) n FROM companies').get().n;
  const id = db
    .prepare('INSERT INTO companies (name, slug, domain, notes, position) VALUES (?,?,?,?,?)')
    .run(clean, slug, domain ? String(domain).trim() : null, String(notes).slice(0, 500), position)
    .lastInsertRowid;
  return listCompanies({ includeRetired: true }).find((c) => c.id === id);
}

export function updateCompany(id, patch) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM companies WHERE id = ?').get(id)) {
    throw Object.assign(new Error('No such company.'), { code: 'NOT_FOUND' });
  }
  for (const [key, col] of [['name', 'name'], ['domain', 'domain'], ['notes', 'notes']]) {
    if (patch[key] !== undefined) {
      db.prepare(`UPDATE companies SET ${col} = ? WHERE id = ?`)
        .run(patch[key] === null ? null : String(patch[key]).trim(), id);
    }
  }
  if (patch.isActive !== undefined) {
    db.prepare('UPDATE companies SET is_active = ? WHERE id = ?').run(patch.isActive ? 1 : 0, id);
  }
  return listCompanies({ includeRetired: true }).find((c) => c.id === id);
}

/**
 * Retire rather than delete, and never orphan the work.
 *
 * Deleting a company would either take its tracks with it or leave them
 * pointing at nothing. Retiring keeps every production reachable and every
 * video that was already published still explicable.
 */
export function retireCompany(id, active = false) {
  return updateCompany(id, { isActive: active });
}

/** Attach a campaign to a company, and say what the track is for. */
export function setTrack(campaignId, { companyId, purpose, audience, name }) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaignId)) {
    throw Object.assign(new Error('No such campaign.'), { code: 'NOT_FOUND' });
  }
  if (purpose !== undefined && purpose !== null && !PURPOSES.some((p) => p.id === purpose)) {
    throw Object.assign(
      new Error(`Purpose must be one of ${PURPOSES.map((p) => p.id).join(', ')}.`),
      { code: 'BAD_PURPOSE' }
    );
  }
  if (companyId !== undefined && companyId !== null
      && !db.prepare('SELECT 1 FROM companies WHERE id = ?').get(companyId)) {
    throw Object.assign(new Error('No such company.'), { code: 'NOT_FOUND' });
  }

  if (companyId !== undefined) {
    db.prepare('UPDATE campaigns SET company_id = ? WHERE id = ?').run(companyId, campaignId);
  }
  if (purpose !== undefined) {
    db.prepare('UPDATE campaigns SET purpose = ? WHERE id = ?').run(purpose, campaignId);
  }
  if (audience !== undefined) {
    db.prepare('UPDATE campaigns SET audience = ? WHERE id = ?')
      .run(audience === null ? null : String(audience).slice(0, 500), campaignId);
  }
  if (name !== undefined && String(name).trim()) {
    db.prepare('UPDATE campaigns SET name = ? WHERE id = ?').run(String(name).trim(), campaignId);
  }
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
}

/**
 * The audience a production is speaking to, resolved from its track.
 *
 * This is the point of the whole layer: the same company says different things
 * to investors and to buyers, and the script should know which it is doing.
 */
export function audienceFor(productionId) {
  const row = getDb()
    .prepare(
      `SELECT c.purpose, c.audience, c.name AS track, co.name AS company
         FROM productions p
         JOIN campaigns c ON c.id = p.campaign_id
         LEFT JOIN companies co ON co.id = c.company_id
        WHERE p.id = ?`
    )
    .get(productionId);
  if (!row) return null;
  return {
    company: row.company ?? null,
    track: row.track,
    purpose: row.purpose ?? null,
    audience: row.audience ?? null,
  };
}
