PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Single-row table. A desktop install has exactly one workspace.
CREATE TABLE IF NOT EXISTS workspace (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  entitlement       TEXT    NOT NULL DEFAULT 'none'
                            CHECK (entitlement IN ('none','comedy','content','both')),
  active_mode       TEXT    NOT NULL DEFAULT 'both'
                            CHECK (active_mode IN ('comedy','content','both')),
  license_key_hint  TEXT,
  storage_provider  TEXT    CHECK (storage_provider IN ('local','google_drive','dropbox')),
  storage_path      TEXT,
  llm_provider      TEXT    NOT NULL DEFAULT 'included'
                            CHECK (llm_provider IN ('included','openai','anthropic','xai')),
  onboarded_at      TEXT,
  last_production_id INTEGER,
  provider_mode      TEXT
);

-- Encrypted BYO provider credentials. The ciphertext never leaves the backend;
-- the API exposes only provider + hint + status.
CREATE TABLE IF NOT EXISTS credentials (
  provider   TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv         TEXT NOT NULL,
  tag        TEXT NOT NULL,
  hint       TEXT NOT NULL,
  verified   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publishing_connections (
  platform   TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'disconnected'
                  CHECK (status IN ('disconnected','connected')),
  connected_at TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  mode        TEXT NOT NULL DEFAULT 'both' CHECK (mode IN ('comedy','content','both')),
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS productions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id    INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  breadcrumb     TEXT NOT NULL DEFAULT '',
  subtitle       TEXT NOT NULL DEFAULT '',
  target_runtime TEXT NOT NULL DEFAULT '20:00',
  mode           TEXT NOT NULL DEFAULT 'content' CHECK (mode IN ('comedy','content','both')),
  outline_approved INTEGER NOT NULL DEFAULT 0,
  scenes_approved  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS brief_fields (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  value         TEXT NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (production_id, label)
);

CREATE TABLE IF NOT EXISTS outline_sections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  title         TEXT NOT NULL,
  runtime       TEXT NOT NULL DEFAULT '0:30',
  participants  TEXT NOT NULL DEFAULT '',
  purpose       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scenes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id      INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  outline_section_id INTEGER REFERENCES outline_sections(id) ON DELETE SET NULL,
  position           INTEGER NOT NULL,
  ref                TEXT NOT NULL,
  title              TEXT NOT NULL,
  participants       TEXT NOT NULL DEFAULT '',
  runtime            TEXT NOT NULL DEFAULT '0:30',
  purpose            TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('warning','ok','locked')),
  text          TEXT NOT NULL,
  resolution    TEXT,
  position      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'video'
);

CREATE TABLE IF NOT EXISTS people (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT '',
  representation TEXT NOT NULL DEFAULT '',
  consent_scope TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('approved','pending')),
  invite_token  TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  -- Casting: the provider asset this person is performed by.
  avatar_asset_id INTEGER REFERENCES provider_assets(id) ON DELETE SET NULL,
  voice_asset_id  INTEGER REFERENCES provider_assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  kind     TEXT NOT NULL DEFAULT 'asset',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calendar_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  day           INTEGER NOT NULL,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Prepared',
  production_id INTEGER REFERENCES productions(id) ON DELETE SET NULL
);

-- Downstream artifacts. `stale` is set by lib/stale.js when an upstream artifact
-- changes; nothing is ever destroyed or silently overwritten.
CREATE TABLE IF NOT EXISTS script_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed','accepted','rejected')),
  stale         INTEGER NOT NULL DEFAULT 0,
  stale_reason  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS script_segments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  script_version_id INTEGER NOT NULL REFERENCES script_versions(id) ON DELETE CASCADE,
  scene_id          INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
  position          INTEGER NOT NULL,
  speaker           TEXT NOT NULL DEFAULT '',
  text              TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS render_versions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id     INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  script_version_id INTEGER REFERENCES script_versions(id) ON DELETE SET NULL,
  version           INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued','processing','complete','failed','cancelled')),
  progress          INTEGER NOT NULL DEFAULT 0,
  duration          TEXT NOT NULL DEFAULT '',
  cost_estimate     REAL NOT NULL DEFAULT 0,
  dry_run           INTEGER NOT NULL DEFAULT 1,
  stale             INTEGER NOT NULL DEFAULT 0,
  stale_reason      TEXT,
  error             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT
);

CREATE TABLE IF NOT EXISTS edit_decisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  render_version_id INTEGER NOT NULL REFERENCES render_versions(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  target            TEXT NOT NULL DEFAULT '',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exports (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id     INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  render_version_id INTEGER REFERENCES render_versions(id) ON DELETE SET NULL,
  version           INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'ready',
  stale             INTEGER NOT NULL DEFAULT 0,
  stale_reason      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  export_id     INTEGER REFERENCES exports(id) ON DELETE SET NULL,
  platform      TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'prepare'
                     CHECK (mode IN ('prepare','schedule','publish')),
  status        TEXT NOT NULL DEFAULT 'not_prepared',
  stale         INTEGER NOT NULL DEFAULT 0,
  stale_reason  TEXT,
  prepared_at   TEXT,
  UNIQUE (production_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_outline_production ON outline_sections(production_id, position);
CREATE INDEX IF NOT EXISTS idx_scenes_production  ON scenes(production_id, position);
CREATE INDEX IF NOT EXISTS idx_script_production  ON script_versions(production_id, version);
CREATE INDEX IF NOT EXISTS idx_render_production  ON render_versions(production_id, version);

-- Provider integration (HeyGen and any future generation provider).
-- The UI never names a provider; the router in lib/providers/index.js does.
CREATE TABLE IF NOT EXISTS provider_accounts (
  provider          TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'disconnected'
                         CHECK (status IN ('disconnected','connected')),
  hint              TEXT,
  quota_remaining   INTEGER,
  quota_checked_at  TEXT,
  last_sync_at      TEXT,
  last_error        TEXT
);

-- PULL: avatars, voices and templates mirrored from the provider so the app
-- works offline and the Library shows real, selectable options.
CREATE TABLE IF NOT EXISTS provider_assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('avatar','voice','template')),
  remote_id   TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  preview_url TEXT,
  language    TEXT,
  gender      TEXT,
  raw         TEXT,
  synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, kind, remote_id)
);

-- PUSH: one row per generation request handed to the provider, with the remote
-- id needed to poll it back. Survives restarts, so a job is never orphaned.
CREATE TABLE IF NOT EXISTS provider_jobs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider          TEXT NOT NULL,
  capability        TEXT NOT NULL,
  render_version_id INTEGER REFERENCES render_versions(id) ON DELETE CASCADE,
  production_id     INTEGER REFERENCES productions(id) ON DELETE CASCADE,
  remote_id         TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  progress          INTEGER NOT NULL DEFAULT 0,
  video_url         TEXT,
  thumbnail_url     TEXT,
  duration          REAL,
  credits_used      REAL,
  error             TEXT,
  dry_run           INTEGER NOT NULL DEFAULT 1,
  request_payload   TEXT,
  last_polled_at    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pjobs_render ON provider_jobs(render_version_id);
CREATE INDEX IF NOT EXISTS idx_passets_kind ON provider_assets(provider, kind);

-- Which LLM fulfils which planning capability. PM_SPEC: "Provider choice can
-- later be set by capability (planning, script, draft, etc.)". Without this a
-- second stored key is dead weight — only one provider could ever be active.
CREATE TABLE IF NOT EXISTS llm_routing (
  capability TEXT PRIMARY KEY,
  provider   TEXT NOT NULL
);

-- Presenters: who appears on screen. The comedy/content difference lives here,
-- not in template lists.
--
--   character  invented, belongs to funny, HAS artwork
--   avatar     stock roster of real people, belongs to content, NO artwork
--   personal   the user's own likeness, every plan, NO artwork
--
-- The artwork rule is a product decision, not styling: a stock photo standing in
-- for "a real presenter" is a claim about a person who does not exist, and a
-- mocked-up "your face" is a promise about somebody we have never seen. The CHECK
-- makes it impossible to get wrong by accident.
CREATE TABLE IF NOT EXISTS presenters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('character','avatar','personal')),
  name         TEXT NOT NULL,
  program      TEXT CHECK (program IN ('funny','content')),
  description  TEXT NOT NULL DEFAULT '',
  artwork_url  TEXT,
  -- Which provider assets perform them.
  avatar_asset_id INTEGER REFERENCES provider_assets(id) ON DELETE SET NULL,
  voice_asset_id  INTEGER REFERENCES provider_assets(id) ON DELETE SET NULL,
  -- Retire rather than delete, so videos that already cast them keep resolving.
  is_active    INTEGER NOT NULL DEFAULT 1,
  person_id    INTEGER REFERENCES people(id) ON DELETE SET NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (
    (kind = 'character' AND program = 'funny')
    OR (kind = 'avatar' AND program = 'content' AND artwork_url IS NULL)
    OR (kind = 'personal' AND program IS NULL AND artwork_url IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_presenters_kind ON presenters(kind, is_active, position);

-- Segments and takes.
--
-- "The segment is the unit of script, take, presenter, shot, quality and render.
--  Re-render one, not all." A production-wide render means one bad line costs a
-- whole video; a segment-level one costs a line.
--
-- THE HARD GATE: nothing renders unheard. A take must be auditioned in the voice
-- that will actually ship before its segment may render, and editing the line
-- makes the take stale AND unheard again — approving a sound, then changing the
-- words, is not approval of the new words.
CREATE TABLE IF NOT EXISTS segments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  scene_id      INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
  position      INTEGER NOT NULL,
  speaker       TEXT NOT NULL DEFAULT '',
  presenter_id  INTEGER REFERENCES presenters(id) ON DELETE SET NULL,
  text          TEXT NOT NULL DEFAULT '',
  -- Quality moves down from the video to the segment: one line can be final
  -- while the rest is still draft.
  quality       TEXT NOT NULL DEFAULT 'draft' CHECK (quality IN ('draft','final')),
  shot          TEXT NOT NULL DEFAULT 'medium',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS takes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id     INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  -- What was actually auditioned: the exact text and voice, so a later edit is
  -- detectable rather than assumed.
  text           TEXT NOT NULL DEFAULT '',
  voice_asset_id INTEGER REFERENCES provider_assets(id) ON DELETE SET NULL,
  audio_url      TEXT,
  duration       REAL,
  heard          INTEGER NOT NULL DEFAULT 0,
  stale          INTEGER NOT NULL DEFAULT 0,
  stale_reason   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One render per segment, so a re-render replaces a line and not the video.
CREATE TABLE IF NOT EXISTS segment_renders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id    INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  take_id       INTEGER REFERENCES takes(id) ON DELETE SET NULL,
  version       INTEGER NOT NULL,
  provider      TEXT,
  remote_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  progress      INTEGER NOT NULL DEFAULT 0,
  video_url     TEXT,
  stale         INTEGER NOT NULL DEFAULT 0,
  stale_reason  TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segments_production ON segments(production_id, position);
CREATE INDEX IF NOT EXISTS idx_takes_segment ON takes(segment_id, version);
CREATE INDEX IF NOT EXISTS idx_segrender_segment ON segment_renders(segment_id, version);

-- The parking lot.
--
-- An idea is NOT a production. It has no pipeline, no gate, no stale
-- propagation and no place in the schedule — that is the entire point. The only
-- way to record "a video about X for company Y" used to be to create a whole
-- production, so every passing thought became a row with five pipeline stages
-- and a deadline it would never meet, and the schedule filled with things
-- nobody had decided to make.
--
-- It becomes a production when you commit to it, and that act is recorded:
-- `promoted_production_id` means this idea grew up, and the row is kept so the
-- lot is a history of what you decided rather than only what survived.
CREATE TABLE IF NOT EXISTS ideas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  text          TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  -- low | normal | hot. Not a date: an idea with a deadline is a production.
  heat          TEXT NOT NULL DEFAULT 'normal' CHECK (heat IN ('low','normal','hot')),
  promoted_production_id INTEGER REFERENCES productions(id) ON DELETE SET NULL,
  archived_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Companies: the layer above campaigns.
--
-- Campaigns were doing three jobs at once. "Artificial Funny" was a company,
-- "AI for Operators — Season 1" a series and "Product Launches" a theme, all
-- stored identically, which works at four and stops working at fifty. Flattening
-- a company's tracks into their names — "Fixology — Investor Update Q3" — is how
-- a list becomes unsortable.
CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  slug       TEXT NOT NULL UNIQUE,
  domain     TEXT,
  notes      TEXT NOT NULL DEFAULT '',
  is_active  INTEGER NOT NULL DEFAULT 1,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
