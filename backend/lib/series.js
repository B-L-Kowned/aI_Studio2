import { getDb } from '../db/index.js';
import { templateById } from '../data/templates.js';
import { allowedModes } from './capabilities.js';

// Planning a series: many productions at once, in a deliberate order.
//
// A series is not a new kind of thing. It is a CAMPAIGN holding productions
// whose `collection_position` says what order they are taught or watched in —
// the same hierarchy Training reads, and the same ordering function. Inventing
// a Series model here would have made a second hierarchy to keep in step with
// the first, which is exactly what `collection_type` was rejected for.

const MAX_EPISODES = 60;

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

/**
 * Episode titles from a premise.
 *
 * Deterministic, like the script generator: the same premise gives the same
 * run every time, and nothing is paid for. These are STARTING POINTS and the
 * caller is told so — an episode called "Part 3" is a placeholder, not a plan,
 * and pretending otherwise would fill a season with titles nobody chose.
 */
export function proposeEpisodes({ premise, count, numbering = 'episode' }) {
  const base = String(premise ?? '').trim();
  const label = { episode: 'Episode', part: 'Part', lesson: 'Lesson', day: 'Day' }[numbering] ?? 'Episode';

  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    title: base ? `${base} — ${label} ${i + 1}` : `${label} ${i + 1}`,
    placeholder: true,
  }));
}

/**
 * Create a whole series in one transaction.
 *
 * All of it or none of it: a half-created season leaves you deleting episodes
 * by hand to work out where it stopped.
 */
export function createSeries({ name, premise = '', templateId, count, episodes, campaignId = null, numbering }) {
  const db = getDb();

  const list = Array.isArray(episodes) && episodes.length
    ? episodes.map((e, i) => ({
        number: i + 1,
        title: String(typeof e === 'string' ? e : e.title ?? '').trim(),
        placeholder: false,
      }))
    : proposeEpisodes({ premise, count: Number(count) || 0, numbering });

  if (!list.length) {
    throw Object.assign(new Error('A series needs at least one episode.'), { code: 'NO_EPISODES' });
  }
  if (list.length > MAX_EPISODES) {
    throw Object.assign(
      new Error(`${list.length} episodes is more than this build creates at once (max ${MAX_EPISODES}).`),
      { code: 'TOO_MANY' }
    );
  }
  const unnamed = list.findIndex((e) => !e.title);
  if (unnamed >= 0) {
    throw Object.assign(
      new Error(`Episode ${unnamed + 1} has no title.`),
      { code: 'UNTITLED_EPISODE' }
    );
  }

  const template = templateId ? templateById(templateId) : null;
  if (templateId && !template) {
    throw Object.assign(new Error('Unknown template'), { code: 'NO_TEMPLATE' });
  }

  const w = db.prepare('SELECT entitlement FROM workspace WHERE id = 1').get();
  if (template && !allowedModes(w.entitlement).includes(template.mode)) {
    throw Object.assign(
      new Error(`"${template.name}" is a ${template.mode} template and your licence is ${w.entitlement}`),
      { code: 'NOT_LICENSED' }
    );
  }

  // Every episode gets the template's plan, so a series is consistent by
  // construction rather than by remembering to pick the same one each time.
  const recipe = template ?? {
    name: 'Blank', runtime: '5:00', format: 'Blank',
    brief: [], outline: [['Open', '1:00', ''], ['Middle', '3:00', ''], ['Close', '1:00', '']],
    mode: 'content',
  };
  const mode = template?.mode ?? (w.entitlement === 'none' ? 'both' : w.entitlement);

  return db.transaction(() => {
    let campaign = campaignId
      ? db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId)
      : null;
    if (campaignId && !campaign) {
      throw Object.assign(new Error('Unknown campaign'), { code: 'NO_CAMPAIGN' });
    }

    if (!campaign) {
      const seriesName = String(name ?? '').trim() || 'Untitled series';
      if (db.prepare('SELECT 1 FROM campaigns WHERE name = ?').get(seriesName)) {
        throw Object.assign(
          new Error(`A campaign called "${seriesName}" already exists — add to it instead.`),
          { code: 'DUPLICATE_CAMPAIGN' }
        );
      }
      const position = db.prepare('SELECT COUNT(*) n FROM campaigns').get().n;
      const cid = db
        .prepare('INSERT INTO campaigns (name, description, mode, position) VALUES (?,?,?,?)')
        .run(seriesName, premise || `${list.length}-part series`,
             mode === 'both' ? 'both' : mode, position).lastInsertRowid;
      campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(cid);
    }

    // Continue the numbering of anything already in this campaign rather than
    // restarting at zero and giving two episodes the same position.
    const existing = db
      .prepare('SELECT COUNT(*) n FROM productions WHERE campaign_id = ?')
      .get(campaign.id).n;

    const created = list.map((ep, i) => {
      let slug = slugify(`${campaign.name}-${ep.title}`);
      if (db.prepare('SELECT 1 FROM productions WHERE slug = ?').get(slug)) {
        slug = `${slug}-${Date.now().toString(36)}${i}`;
      }
      const subtitle = `${recipe.runtime} ${recipe.format} · ${recipe.name}`;

      const id = db
        .prepare(
          `INSERT INTO productions
            (campaign_id, slug, title, breadcrumb, subtitle, target_runtime, mode, collection_position)
           VALUES (?,?,?,?,?,?,?,?)`
        )
        .run(campaign.id, slug, ep.title, `${campaign.name} › ${ep.title}`, subtitle,
             recipe.runtime, mode === 'both' ? 'both' : mode, existing + i)
        .lastInsertRowid;

      const insBrief = db.prepare(
        'INSERT INTO brief_fields (production_id, label, value, position) VALUES (?,?,?,?)'
      );
      insBrief.run(id, 'Template', recipe.name, 0);
      recipe.brief.forEach(([label, value], n) => insBrief.run(id, label, value, n + 1));
      insBrief.run(id, 'Series', campaign.name, recipe.brief.length + 1);
      insBrief.run(id, 'Episode', String(existing + i + 1), recipe.brief.length + 2);
      insBrief.run(id, 'Target runtime', recipe.runtime, recipe.brief.length + 3);

      const insOutline = db.prepare(
        'INSERT INTO outline_sections (production_id, position, title, runtime, participants, purpose) VALUES (?,?,?,?,?,?)'
      );
      recipe.outline.forEach(([t, rt, who], n) => insOutline.run(id, n, t, rt, who ?? '', ''));

      const insDecision = db.prepare(
        'INSERT INTO decisions (production_id, kind, text, position) VALUES (?,?,?,?)'
      );
      insDecision.run(id, 'locked', `${recipe.runtime} target runtime`, 0);
      insDecision.run(id, 'locked', `Part of the series "${campaign.name}"`, 1);
      // A generated title is a placeholder until someone decides otherwise, and
      // saying so is the difference between a plan and a filled-in form.
      if (ep.placeholder) {
        insDecision.run(id, 'warning', 'This episode title was generated — rename it.', 2);
      }
      insDecision.run(id, 'warning', 'Who appears in this production?', 3);

      return { id, number: existing + i + 1, title: ep.title, slug, placeholder: ep.placeholder };
    });

    db.prepare('UPDATE workspace SET last_production_id = ? WHERE id = 1').run(created[0].id);

    return {
      campaign: { id: campaign.id, name: campaign.name },
      episodes: created,
      placeholders: created.filter((e) => e.placeholder).length,
    };
  })();
}
