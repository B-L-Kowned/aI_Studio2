import { getDb } from '../db/index.js';
import { researchWebsite } from './web-research.js';

/*
 * What a company has already said about itself, as sentences that can be
 * quoted: the words of its finished videos (the most trustworthy — they were
 * published), its approved scripts, its notes, and its own website. Finding the
 * relevant ones is plain word matching; nothing here calls a model.
 */

const WEEK_MS = 7 * 24 * 3600 * 1000;
const CONFIRM_RE = /\[CONFIRM:[^\]]*\]/gi;
const STOP = new Set(('a an the and or but of to in on for with at by from is are was were be been it its this that these those you your we our they their '
  + 'can will would should could may might must do does did have has had not no yes as if so than then there here what which who when where how why '
  + 'about into over also only just more most some any each every all one two current confirm check verify whether').split(' '));
const wordsOf = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
const stem = (w) => w.replace(/(ings?|ed|es|s)$/, '');

export function companyFor(productionId) {
  return getDb().prepare(
    `SELECT co.* FROM productions p JOIN campaigns c ON c.id = p.campaign_id JOIN companies co ON co.id = c.company_id WHERE p.id = ?`
  ).get(productionId) ?? null;
}

async function websiteText(company) {
  const db = getDb();
  if (!company?.domain) return null;
  const row = db.prepare('SELECT * FROM company_evidence WHERE company_id = ?').get(company.id);
  if (row && Date.now() - Date.parse(`${row.fetched_at}Z`) < WEEK_MS) return row.error ? null : row;
  let url = `https://${company.domain.replace(/^https?:\/\//, '')}`;
  let text = ''; let error = null;
  try {
    const r = await researchWebsite(url);
    url = r.url;
    const e = r.evidence;
    text = [e.title, e.description, ...e.headings, ...e.paragraphs].filter(Boolean).join('. ');
  } catch (err) { error = err.message; }
  db.prepare(`INSERT INTO company_evidence (company_id, url, text, error, fetched_at) VALUES (?,?,?,?,datetime('now'))
    ON CONFLICT(company_id) DO UPDATE SET url = excluded.url, text = excluded.text, error = excluded.error, fetched_at = excluded.fetched_at`)
    .run(company.id, url, text.slice(0, 60000), error);
  return error ? null : { url, text };
}

const sentences = (t) => String(t).replace(CONFIRM_RE, ' ').replace(/\s+/g, ' ')
  .split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 25 && s.length <= 400);

/** Every quotable sentence the company has, each with where it came from. */
export async function corpusFor(productionId) {
  const db = getDb();
  const company = companyFor(productionId);
  if (!company) return { company: null, items: [], searched: [] };
  const productions = db.prepare(
    `SELECT p.id, p.title FROM productions p JOIN campaigns c ON c.id = p.campaign_id WHERE c.company_id = ? AND p.id != ?`
  ).all(company.id, productionId);
  const finished = db.prepare("SELECT 1 FROM brief_fields WHERE production_id = ? AND label = 'Completed asset' AND value != ''");
  const accepted = db.prepare(
    `SELECT text FROM script_segments WHERE script_version_id =
      (SELECT id FROM script_versions WHERE production_id = ? AND status = 'accepted' ORDER BY version DESC LIMIT 1) ORDER BY position`
  );
  const items = [];
  const searched = [];
  let scripts = 0;
  for (const p of productions) {
    const lines = accepted.all(p.id).map((r) => r.text);
    if (!lines.length) continue;
    scripts++;
    const source = `${finished.get(p.id) ? 'Published video' : 'Approved script'} · ${p.title.split(' — ')[0]}`;
    for (const s of sentences(lines.join(' '))) items.push({ text: s, source, weight: finished.get(p.id) ? 1.2 : 1 });
  }
  searched.push(`${scripts} approved or published script${scripts === 1 ? '' : 's'}`);
  if (company.notes) for (const s of sentences(company.notes)) items.push({ text: s, source: 'Company notes', weight: 1 });
  const site = await websiteText(company);
  if (site) {
    for (const s of sentences(site.text)) items.push({ text: s, source: `Website · ${site.url.replace(/^https?:\/\//, '')}`, weight: 1 });
    searched.push(`its website (${company.domain})`);
  } else if (company.domain) searched.push(`its website (${company.domain}, could not be read)`);
  return { company, items, searched };
}

/** The sentences most likely to answer a check, best first. Plain word overlap. */
export function relevant(items, check, line, limit = 6) {
  const want = new Set(wordsOf(check).map(stem));
  const context = new Set(wordsOf(line).map(stem));
  const scored = items.map((it) => {
    const w = new Set(wordsOf(it.text).map(stem));
    let score = 0;
    for (const x of want) if (w.has(x)) score += 2;
    for (const x of context) if (w.has(x) && !want.has(x)) score += 0.5;
    return { ...it, score: score * it.weight };
  }).filter((it) => it.score >= 3);
  const seen = new Set();
  return scored.sort((a, b) => b.score - a.score).filter((it) => {
    const k = it.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, limit);
}
