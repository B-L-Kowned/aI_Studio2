import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

// Desktop installs keep the database in the OS user-data directory, not next to
// the application bundle — an installed app's own directory is often read-only.
// The desktop shell passes this same path explicitly as STUDIO_DB_PATH, so dev
// and desktop share one database unless STUDIO_DB_PATH points a checkout elsewhere.
export function defaultDbPath() {
  if (process.env.STUDIO_DB_PATH) return resolve(process.env.STUDIO_DB_PATH);

  const appDir = 'AIVideoStudio';
  switch (platform()) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', appDir, 'studio.db');
    case 'win32':
      return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), appDir, 'studio.db');
    default:
      return join(
        process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
        appDir,
        'studio.db'
      );
  }
}

let db;

export function openDb(path = defaultDbPath()) {
  if (db) return db;
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  db.prepare('INSERT OR IGNORE INTO workspace (id) VALUES (1)').run();
  return db;
}

// `CREATE TABLE IF NOT EXISTS` leaves an existing table untouched, so a new
// column never reaches a database that already exists. Each entry is applied
// only when the column is genuinely absent.
const ADDED_COLUMNS = [
  ['workspace', 'last_production_id', 'INTEGER'],
  ['workspace', 'provider_mode', 'TEXT'],
  ['people', 'avatar_asset_id', 'INTEGER'],
  ['people', 'voice_asset_id', 'INTEGER'],
  // Nullable and never backfilled: a collection with no positions is served the
  // same newest-first list it was served before this column existed.
  ['productions', 'collection_position', 'INTEGER'],
  // Where the finished video actually is. It used to live only on the provider
  // job, so a completed render had nothing to play.
  ['render_versions', 'video_url', 'TEXT'],
  ['render_versions', 'thumbnail_url', 'TEXT'],
  // An export is a file now, so it records where that file is and how big it
  // is. Without these, "ready" was a word with nothing behind it.
  ['exports', 'file_path', 'TEXT'],
  ['exports', 'bytes', 'INTEGER'],
  ['exports', 'duration_seconds', 'REAL'],
  ['exports', 'edits_applied', 'INTEGER'],
  ['exports', 'note', 'TEXT'],
  ['exports', 'error', 'TEXT'],
  // What a publication actually produced: a post on a real site.
  ['publications', 'post_id', 'TEXT'],
  ['publications', 'post_url', 'TEXT'],
  ['publications', 'error', 'TEXT'],
  // A presenter is more than a name. `persona` carries the voice, demeanour,
  // mannerisms and rules that make a performer sound like themselves.
  ['presenters', 'persona', 'TEXT'],
  ['presenters', 'tagline', 'TEXT'],
  // A library row used to hold a NAME and nothing else — importing a video
  // recorded that it happened and discarded the video.
  ['assets', 'provider', 'TEXT'],
  ['assets', 'remote_id', 'TEXT'],
  ['assets', 'url', 'TEXT'],
  ['assets', 'thumbnail_url', 'TEXT'],
  ['assets', 'duration', 'REAL'],
  ['assets', 'status', 'TEXT'],
  ['assets', 'created_at', 'TEXT'],
  // Yours versus HeyGen's. Without this the roster picker offers ten thousand
  // strangers and the twenty-five that are actually you look identical to them.
  ['provider_assets', 'owned', 'INTEGER'],
  // A real deadline. The calendar stored a day-of-MONTH integer, which cannot
  // express "next Tuesday" or be overdue, so nothing could be scheduled.
  ['productions', 'due_at', 'TEXT'],
  // A campaign is a TRACK within a company: promotion, investor, GTM. The
  // purpose is a small enum because the point is comparing the same track
  // across fifty companies; the audience is free text because no enum survives
  // fifty companies, and it is the thing that actually changes the script.
  ['campaigns', 'company_id', 'INTEGER'],
  // The portfolio group a company belongs to (Innovations, More Time…). Fifty
  // companies in one list only scan when they fall into their verticals.
  ['companies', 'group_name', 'TEXT'],
  // A take synthesised on this machine keeps its file here (relative to the
  // voices folder); a HeyGen take has only its remote audio_url.
  ['takes', 'local_path', 'TEXT'],
  // A take made by fixing another (a respelled name, a reworded sentence, a
  // new reading): which take it was fixed from, and what was done — so the
  // fix can be undone, and the line says what changed.
  ['takes', 'origin_take_id', 'INTEGER'],
  ['takes', 'fix_note', 'TEXT'],
  // Which avatar GROUP a look belongs to, so a picker offers one person's
  // looks (20 of Pat) and not every face the account owns. A photo avatar is
  // sent to HeyGen as a talking photo, not an avatar, so the type is kept too.
  ['provider_assets', 'group_id', 'TEXT'],
  ['provider_assets', 'avatar_type', 'TEXT'],
  ['provider_assets', 'orientation', 'TEXT'],
  // An appearance proof that is a real render instruction, not prose: the
  // exact look, background and frame HeyGen will be given once it is approved.
  ['appearance_proofs', 'avatar_asset_id', 'INTEGER'],
  ['appearance_proofs', 'background_kind', 'TEXT'],
  ['appearance_proofs', 'background_value', 'TEXT'],
  ['appearance_proofs', 'aspect', 'TEXT'],
  ['appearance_proofs', 'resolution', 'TEXT'],
  ['appearance_proofs', 'motion_prompt', 'TEXT'],
  // How fast this video's narration runs, relative to the clone's natural
  // pace (1 = natural). Set to fit the words to the target length.
  ['productions', 'voice_speed', 'REAL'],
  // A persona's own pace (1 = the clone's natural), used by every video it
  // presents unless that video sets its own speed.
  ['presenters', 'speed', 'REAL'],
  // Which videos a persona presents by default: {workstreams: [], companies: []}.
  ['presenters', 'use_for', 'TEXT'],
  // A collaborator's invite lives on the consent service; these tie the two.
  ['people', 'email', 'TEXT'],
  ['people', 'invite_id', 'TEXT'],
  ['people', 'invite_url', 'TEXT'],
  ['people', 'invite_role', 'TEXT'],
  ['people', 'invite_status', 'TEXT'],
  // Which of your personas presents this video; null = your likeness.
  ['productions', 'persona_id', 'INTEGER'],
  // A scene is a row of the shot list: what is on screen while a section of
  // the script plays. `purpose` holds the shot detail.
  ['scenes', 'shot_type', 'TEXT'],
  ['scenes', 'onscreen_text', "TEXT NOT NULL DEFAULT ''"],
  ['scenes', 'captured', 'INTEGER NOT NULL DEFAULT 0'],
  ['scenes', 'recording_asset_id', 'INTEGER'],
  ['campaigns', 'purpose', 'TEXT'],
  ['campaigns', 'audience', 'TEXT'],
  // A library video attached to a production, and where it was saved.
  ['assets', 'production_id', 'INTEGER'],
  ['assets', 'local_path', 'TEXT'],
  // An imported video: where it is, and what measuring it found.
  ['sources', 'file_path', 'TEXT'],
  ['sources', 'analysis', 'TEXT'],
  ['sources', 'analysed_at', 'TEXT'],
  // Audit which engine wrote each proposal. A generated script must not become
  // indistinguishable from the deterministic offline fixture after the fact.
  ['script_versions', 'generator_provider', "TEXT NOT NULL DEFAULT 'included'"],
  ['script_versions', 'generator_model', 'TEXT'],
  // Clean-up of a take you recorded: the words heard in it (with times) and the
  // cuts proposed from them — fillers, long gaps, dead air — each one switchable.
  ['line_takes', 'words', 'TEXT'],
  ['line_takes', 'cuts', 'TEXT'],
  // How this video is finished in the app: clean audio, look, frame, captions.
  ['productions', 'edit_settings', 'TEXT'],
  // A finished HeyGen render, saved into the video's folder: its link expires.
  ['render_versions', 'local_path', 'TEXT'],
  // The three dates your register is worked to: { P1, P2, P3 } as YYYY-MM-DD.
  // A video is due by its priority's date unless it carries its own due_at.
  ['workspace', 'deadlines', 'TEXT'],
  // The customer's monthly HeyGen limit and rate: { monthlyCap, ratePerMin }.
  ['workspace', 'budget', 'TEXT'],
  // What a single-line render was estimated to cost, counted against the limit.
  ['segment_renders', 'cost_estimate', 'REAL NOT NULL DEFAULT 0'],
  // Which local model tier Enhance and the checks use: 'light' | 'full'.
  ['workspace', 'llm_tier', 'TEXT'],
  // A twin someone shared with you: owner, wardrobe and voice references, grant.
  ['presenters', 'twin_source', 'TEXT'],
  // "Not me": an avatar in your account the studio should not offer. Kept
  // across syncs, since the sync never writes this column.
  ['provider_assets', 'hidden', 'INTEGER NOT NULL DEFAULT 0'],
  // A presenter you reach for first: listed at the top, and a filter of its own.
  ['presenters', 'favorite', 'INTEGER NOT NULL DEFAULT 0'],
];

function migrate(db) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`[db] added ${table}.${column}`);
    }
  }
}

export function getDb() {
  if (!db) throw new Error('Database not open. Call openDb() first.');
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}
