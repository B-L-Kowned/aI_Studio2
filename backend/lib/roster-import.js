import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { getDb } from '../db/index.js';

// Bringing the REAL cast across from the previous build.
//
// This app shipped with three invented characters and one empty "You" tab while
// the working program next door held 163 characters and four personas written
// over months. A roster you have to retype is a roster nobody moves.
//
// Two different things come across, and they are not interchangeable:
//
//   characters  the comedy roster — invented performers, each with a tagline
//               and a persona prompt. They belong to the `funny` program.
//   personas    YOU, in four registers. Voice, demeanour, mannerisms, how each
//               one opens and signs off, what it may never claim. These drive
//               script generation; without them a "personal" presenter is just
//               a name with an avatar attached.

const DEFAULT_ROOT = '/Users/patrickbialko/Desktop/thoughts/artificial_funny';

/** Split a CSV line honouring quoted fields. The taglines contain commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  // A quoted field may span lines; join until the quotes balance.
  const raw = text.split(/\r?\n/);
  const lines = [];
  let buf = '';
  for (const line of raw) {
    buf = buf ? `${buf}\n${line}` : line;
    const quotes = (buf.match(/"/g) ?? []).length;
    if (quotes % 2 === 0) { if (buf.trim()) lines.push(buf); buf = ''; }
  }
  if (buf.trim()) lines.push(buf);

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/** What is available to import, without importing any of it. */
export function survey(root = DEFAULT_ROOT) {
  const csvPath = join(root, 'desktop', 'character_art', 'CHARACTERS.csv');
  const dbPath = join(root, 'desktop', 'ai_studio.db');
  const artDir = join(root, 'desktop', 'character_art', 'images');

  const result = {
    root,
    characters: { available: 0, withArtwork: 0, source: csvPath, found: false },
    personas: { available: 0, names: [], source: dbPath, found: false },
  };

  if (existsSync(csvPath)) {
    const rows = parseCsv(readFileSync(csvPath, 'utf8')).filter((r) => r.name);
    result.characters.found = true;
    result.characters.available = rows.length;
    result.characters.withArtwork = existsSync(artDir)
      ? rows.filter((r) => r.image_filename && existsSync(join(artDir, r.image_filename))).length
      : 0;
  }

  if (existsSync(dbPath)) {
    try {
      const old = new Database(dbPath, { readonly: true, fileMustExist: true });
      const rows = old.prepare('SELECT name FROM profiles WHERE is_active = 1 OR is_active IS NULL').all();
      old.close();
      result.personas.found = true;
      result.personas.available = rows.length;
      result.personas.names = rows.map((r) => r.name);
    } catch (err) {
      result.personas.error = err.message;
    }
  }

  return result;
}

/**
 * Import both rosters.
 *
 * Matching is by NAME, and an existing presenter is updated rather than
 * duplicated — running this twice must not give you two of everything. Casting
 * that has already been done by hand is never overwritten: the whole point of
 * bringing a roster across is to keep the work already on it.
 */
export function importRoster(root = DEFAULT_ROOT, { characters = true, personas = true } = {}) {
  const db = getDb();
  const csvPath = join(root, 'desktop', 'character_art', 'CHARACTERS.csv');
  const dbPath = join(root, 'desktop', 'ai_studio.db');
  const artDir = join(root, 'desktop', 'character_art', 'images');

  const counts = { charactersAdded: 0, charactersUpdated: 0, personasAdded: 0, personasUpdated: 0, artwork: 0 };
  const notes = [];

  const findByName = db.prepare('SELECT id FROM presenters WHERE name = ? AND kind = ?');
  const nextPosition = (kind) =>
    (db.prepare('SELECT MAX(position) m FROM presenters WHERE kind = ?').get(kind).m ?? -1) + 1;

  if (characters) {
    if (!existsSync(csvPath)) {
      notes.push(`No character list at ${csvPath}.`);
    } else {
      const rows = parseCsv(readFileSync(csvPath, 'utf8')).filter((r) => r.name);
      const vibeKey = Object.keys(rows[0] ?? {}).find((k) => k.startsWith('vibe')) ?? 'vibe';

      db.transaction(() => {
        for (const r of rows) {
          const art = r.image_filename && existsSync(join(artDir, r.image_filename))
            ? join(artDir, r.image_filename)
            : null;
          if (art) counts.artwork++;

          const persona = JSON.stringify({
            key: r.id || null,
            tagline: r.tagline || '',
            prompt: r[vibeKey] || '',
            importedFrom: 'artificial_funny',
          });

          const existing = findByName.get(r.name, 'character');
          if (existing) {
            // Description and persona refresh; artwork only fills a gap, because
            // art added here by hand is newer than art from the old build.
            db.prepare(
              `UPDATE presenters SET description = ?, persona = ?, tagline = ?,
                 artwork_url = COALESCE(artwork_url, ?) WHERE id = ?`
            ).run(r.tagline || '', persona, r.tagline || '', art, existing.id);
            counts.charactersUpdated++;
          } else {
            db.prepare(
              `INSERT INTO presenters (kind, name, program, description, tagline, persona, artwork_url, position)
               VALUES ('character', ?, 'funny', ?, ?, ?, ?, ?)`
            ).run(r.name, r.tagline || '', r.tagline || '', persona, art, nextPosition('character'));
            counts.charactersAdded++;
          }
        }
      })();

      if (!counts.artwork) {
        notes.push(
          `${rows.length} characters imported without artwork — the image folder in that checkout is empty. `
          + 'They are usable now and can have art attached later.'
        );
      }
    }
  }

  if (personas) {
    if (!existsSync(dbPath)) {
      notes.push(`No profile database at ${dbPath}.`);
    } else {
      let rows = [];
      try {
        const old = new Database(dbPath, { readonly: true, fileMustExist: true });
        rows = old.prepare(
          `SELECT name, tagline, voice, audience, demeanor, mannerisms, signature_opening,
                  sign_off, credentials, never_claim, topics_off_limits, requires_disclosure,
                  disclosure, zones, default_aspect_ratio
             FROM profiles`
        ).all();
        old.close();
      } catch (err) {
        notes.push(`Could not read the profiles: ${err.message}`);
      }

      db.transaction(() => {
        for (const p of rows) {
          // Everything that makes this persona sound like itself. Stored whole
          // so scripting can use it — a persona reduced to a name is a name.
          const persona = JSON.stringify({
            tagline: p.tagline ?? '',
            voice: p.voice ?? '',
            audience: p.audience ?? '',
            demeanor: p.demeanor ?? '',
            mannerisms: p.mannerisms ?? '',
            signatureOpening: p.signature_opening ?? '',
            signOff: p.sign_off ?? '',
            credentials: p.credentials ?? '',
            neverClaim: p.never_claim ?? '',
            topicsOffLimits: p.topics_off_limits ?? '',
            requiresDisclosure: !!p.requires_disclosure,
            disclosure: p.disclosure ?? '',
            aspectRatio: p.default_aspect_ratio ?? null,
            importedFrom: 'artificial_funny',
          });

          const existing = findByName.get(p.name, 'personal');
          if (existing) {
            db.prepare('UPDATE presenters SET description = ?, tagline = ?, persona = ? WHERE id = ?')
              .run(p.tagline ?? '', p.tagline ?? '', persona, existing.id);
            counts.personasUpdated++;
          } else {
            // `personal` carries no program and no artwork: your own likeness is
            // something you brought, not something a roster lends you.
            db.prepare(
              `INSERT INTO presenters (kind, name, program, description, tagline, persona, position)
               VALUES ('personal', ?, NULL, ?, ?, ?, ?)`
            ).run(p.name, p.tagline ?? '', p.tagline ?? '', persona, nextPosition('personal'));
            counts.personasAdded++;
          }
        }
      })();
    }
  }

  return { counts, notes };
}

/**
 * Cast presenters to the provider assets that share their name.
 *
 * Your HeyGen account holds avatars called "Pat the Strategist" and "Pat the
 * Businessman" — the same names as the personas. Making someone pick those out
 * of a list by hand, when both sides already agree what they are called, is
 * work the app can do and then show you.
 *
 * Only EXACT, case-insensitive name matches, and only where nothing is cast
 * yet: a near-match is a guess, and a guess here puts the wrong face on you.
 */
export function autoCastByName() {
  const db = getDb();
  const assets = db
    .prepare("SELECT id, kind, name FROM provider_assets WHERE provider = 'heygen'")
    .all();

  const index = (kind) => {
    const map = new Map();
    for (const a of assets.filter((x) => x.kind === kind)) {
      const key = a.name.trim().toLowerCase();
      // An ambiguous name must not be resolved by whichever row came first.
      map.set(key, map.has(key) ? null : a.id);
    }
    return map;
  };
  const avatars = index('avatar');
  const voices = index('voice');

  const matched = [];
  db.transaction(() => {
    const rows = db
      .prepare('SELECT id, name, avatar_asset_id, voice_asset_id FROM presenters WHERE is_active = 1')
      .all();
    for (const p of rows) {
      const key = p.name.trim().toLowerCase();
      const avatarId = p.avatar_asset_id ? null : avatars.get(key);
      const voiceId = p.voice_asset_id ? null : voices.get(key);
      if (!avatarId && !voiceId) continue;
      db.prepare(
        `UPDATE presenters SET avatar_asset_id = COALESCE(?, avatar_asset_id),
           voice_asset_id = COALESCE(?, voice_asset_id) WHERE id = ?`
      ).run(avatarId ?? null, voiceId ?? null, p.id);
      matched.push({ name: p.name, avatar: !!avatarId, voice: !!voiceId });
    }
  })();

  return matched;
}
