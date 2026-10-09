import { getDb } from '../db/index.js';
import { reviewScript } from './enhance.js';

/*
 * The words posted with a finished video: title, description, chapters,
 * hashtags. A first version is worked out from what is already known — the
 * register name, the approved script, the outline, the website — with plain
 * rules; checks say what a platform would reject. The local model only helps
 * with wording (Enhance), and only from the script.
 */

const CONFIRM_RE = /\[CONFIRM:[^\]]*\]/gi;
const FIELDS = ['title', 'description', 'chapters', 'hashtags'];
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const words = (t) => String(t).replace(CONFIRM_RE, ' ').split(/\s+/).filter(Boolean).length;
const domainOf = (url) => { try { return new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return null; } };

function context(productionId) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM productions WHERE id = ?').get(productionId);
  if (!p) return null;
  const brief = Object.fromEntries(db.prepare('SELECT label, value FROM brief_fields WHERE production_id = ?').all(productionId).map((b) => [b.label, b.value]));
  const version = db.prepare(`SELECT id, status FROM script_versions WHERE production_id = ?
    ORDER BY (status = 'accepted') DESC, version DESC LIMIT 1`).get(productionId);
  const lines = version ? db.prepare('SELECT text FROM script_segments WHERE script_version_id = ? ORDER BY position').all(version.id).map((r) => r.text) : [];
  const company = db.prepare('SELECT co.name FROM campaigns c JOIN companies co ON co.id = c.company_id WHERE c.id = ?').get(p.campaign_id)?.name ?? null;
  const file = db.prepare("SELECT duration FROM assets WHERE production_id = ? AND duration > 0 AND local_path IS NOT NULL AND name NOT LIKE 'Recording — %' ORDER BY id DESC LIMIT 1").get(productionId);
  return { p, brief, lines, approved: version?.status === 'accepted', company, duration: file?.duration ?? null };
}

/**
 * Section starts from where the words actually fall — a section's share of
 * the spoken words — scaled to the finished file when there is one. A section
 * with no lines gets no chapter.
 */
function chaptersFor(ctx) {
  const review = reviewScript(ctx.p.id);
  const sections = (review?.sections ?? []).filter((s) => s.title && s.words > 0);
  const total = sections.reduce((n, s) => n + s.words, 0);
  if (sections.length < 3 || !total) return '';
  const spoken = ctx.duration ?? (total / review.wpm) * 60;
  // YouTube shows chapters only when there are three or more, each at least
  // ten seconds long — under a minute there is nothing to divide.
  if (spoken < 60) return '';
  // A section too short to be its own chapter (under ten seconds) is folded
  // into the one before it, so the chapters always pass YouTube's rule.
  const starts = [];
  let at = 0;
  for (const s of sections) {
    const t = Math.round(at);
    if (!starts.length || t - starts[starts.length - 1].t >= 10) starts.push({ t, title: s.title });
    at += (s.words / total) * spoken;
  }
  if (starts.length < 3) return '';
  return starts.map((c) => `${clock(c.t)} ${c.title}`).join('\n');
}

export function draftCopy(productionId) {
  const ctx = context(productionId);
  if (!ctx) return null;
  const name = ctx.p.title.includes(' — ') ? ctx.p.title.split(' — ').slice(1).join(' — ') : ctx.p.title;
  const site = ctx.brief.Website ? domainOf(ctx.brief.Website) : null;
  const opening = ctx.lines.join(' ').replace(CONFIRM_RE, ' ').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').trim();
  const tag = (s) => `#${String(s).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase())}`;
  return {
    title: name.slice(0, 100),
    description: [opening, site ? `Learn more: https://${site}` : ''].filter(Boolean).join('\n\n'),
    chapters: chaptersFor(ctx),
    hashtags: [ctx.company && tag(ctx.company), ctx.company !== 'Bialkowned' && '#Bialkowned'].filter(Boolean).join(' '),
  };
}

/** What a platform would reject or a viewer would trip on. Plain rules. */
export function checkCopy(productionId, copy) {
  const ctx = context(productionId);
  const out = [];
  const site = ctx?.brief.Website ? domainOf(ctx.brief.Website) : null;
  if (!copy.title.trim()) out.push({ field: 'title', message: 'No title.' });
  else if (copy.title.length > 100) out.push({ field: 'title', message: `Title is ${copy.title.length} characters; YouTube allows 100.` });
  else if (copy.title.length > 70) out.push({ field: 'title', message: `Title is ${copy.title.length} characters; past about 70 it is cut off in search.` });
  if (copy.description.length > 5000) out.push({ field: 'description', message: 'Description is over 5,000 characters.' });
  if (site && !copy.description.toLowerCase().includes(site.toLowerCase())) out.push({ field: 'description', message: `The description never gives the website (${site}).` });
  for (const f of FIELDS) if (CONFIRM_RE.test(copy[f])) out.push({ field: f, message: 'Still has an open [CONFIRM].' });
  CONFIRM_RE.lastIndex = 0;
  const ch = copy.chapters.split('\n').map((l) => l.trim()).filter(Boolean);
  if (ch.length) {
    const secs = ch.map((l) => { const m = /^(\d+):(\d{2})\b/.exec(l); return m ? Number(m[1]) * 60 + Number(m[2]) : null; });
    if (secs.some((x) => x == null)) out.push({ field: 'chapters', message: 'Each chapter line starts with a time, like 0:00.' });
    else {
      if (secs[0] !== 0) out.push({ field: 'chapters', message: 'The first chapter must start at 0:00.' });
      if (ch.length < 3) out.push({ field: 'chapters', message: 'YouTube needs at least three chapters to show them.' });
      if (secs.some((x, i) => i && x - secs[i - 1] < 10)) out.push({ field: 'chapters', message: 'Chapters must be at least 10 seconds apart.' });
    }
  }
  const tags = copy.hashtags.split(/\s+/).filter(Boolean);
  if (tags.some((t) => !/^#\w+$/.test(t))) out.push({ field: 'hashtags', message: 'Hashtags are one word each, starting with #.' });
  if (tags.length > 3) out.push({ field: 'hashtags', message: 'YouTube shows only the first three hashtags above the title.' });
  return out;
}

export function postCopy(productionId) {
  const db = getDb();
  const ctx = context(productionId);
  if (!ctx) return null;
  const row = db.prepare('SELECT * FROM post_copy WHERE production_id = ?').get(productionId);
  const copy = row ? Object.fromEntries(FIELDS.map((f) => [f, row[f]])) : draftCopy(productionId);
  return { ...copy, saved: !!row, approved: ctx.approved, checks: checkCopy(productionId, copy), script: ctx.lines.join('\n'), website: ctx.brief.Website ?? null };
}

export function savePostCopy(productionId, patch) {
  const current = postCopy(productionId);
  if (!current) throw Object.assign(new Error('Production not found.'), { code: 'NOT_FOUND' });
  const next = Object.fromEntries(FIELDS.map((f) => [f, typeof patch?.[f] === 'string' ? patch[f].slice(0, 5000) : current[f]]));
  getDb().prepare(`INSERT INTO post_copy (production_id, title, description, chapters, hashtags, updated_at) VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(production_id) DO UPDATE SET title = excluded.title, description = excluded.description, chapters = excluded.chapters,
      hashtags = excluded.hashtags, updated_at = excluded.updated_at`).run(productionId, next.title, next.description, next.chapters, next.hashtags);
  return postCopy(productionId);
}

/** Start again from the worked-out version. */
export function resetPostCopy(productionId) {
  getDb().prepare('DELETE FROM post_copy WHERE production_id = ?').run(productionId);
  return postCopy(productionId);
}
