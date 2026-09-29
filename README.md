# AI Video Studio — PM Frontend v0.4

Prototype for **one downloadable desktop application** with Comedy / Content / Both
entitlements. Per `docs/DISTRIBUTION_ONBOARDING.md` there is one build; the licence key
sets `entitlement_mode`, and upgrading never reinstalls or migrates a project.

## Layout

```
frontend/   React + Vite            → http://localhost:3333
backend/    Express + SQLite        → http://localhost:3433
docs/       product specs and handoff
```

## Run

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
(cd backend && npm install && npm run seed)
(cd frontend && npm install)
pm2 start ecosystem.config.js
```

Then open http://localhost:3333. First run shows onboarding — use a demo key:
`COMEDY-A1B2-C3D4`, `CONTENT-E5F6-G7H8` or `BOTH-9Z8Y-7X6W`.

| command | effect |
|---|---|
| `pm2 logs ai-video-api` / `ai-video-web` | service output |
| `pm2 restart ai-video-api ai-video-web` | restart both |
| `cd backend && npm run seed` | reset sample content, keep the install |
| `cd backend && npm run seed -- --reset-workspace` | full factory reset, back to first run |

## Working with more than one production

Three ways in:

- **Campaigns → New production** — pick a template and a campaign.
- **The breadcrumb on Create** is a switcher: click it for every production grouped by
  campaign, with section/scene counts and stale markers, plus *New production*.
- **Create → Idea** — each start card (idea, template, existing video, script, URL) opens
  the same dialog with that `sourceType`.

A template carries real planning defaults (`backend/data/templates.js`): it seeds the brief,
the outline and the target runtime. Creating from a template your licence does not cover is
refused — a comedy template on a Content key returns `403 NOT_LICENSED`, so you can never end
up with a project you cannot open.

The open production is remembered in `workspace.last_production_id`, so a restart returns to
where you were. Productions are fully isolated: editing one never marks another stale.

A URL start is now a real workflow: the backend reads one public page, stores the evidence,
proposes brief fields, and waits for human approval. The approved source summary and CTA feed
the editable script. Shipping-voice approval and an appearance proof then join the approved
plan in one Production Lock before any non-Fixtures render can reach HeyGen.

## Data

**SQLite**, not a database server — a desktop app cannot ask a customer to run one.
The file lives in the OS user-data directory, never beside the application bundle:

- macOS `~/Library/Application Support/AIVideoStudio/studio.db`
- Windows `%APPDATA%\AIVideoStudio\studio.db`
- Linux `$XDG_DATA_HOME/AIVideoStudio/studio.db`

Override with `STUDIO_DB_PATH`. Under Electron this becomes `app.getPath('userData')`.

## Generation providers

The UI requests a **capability** (`render`, `generate_scene`, `draft_voice`) and
`backend/lib/providers/index.js` routes it. HeyGen-specific integrations stay under
`backend/lib/providers/`.

| direction | what moves |
|---|---|
| **PULL** | avatars, voices, templates and remaining quota → mirrored into `provider_assets` so the app works offline |
| **PUSH** | each render → `POST /v2/video/generate`, recorded in `provider_jobs` with the remote id |
| **PULL** | job status polled back → progress, video URL, duration, credits used |

HeyGen has two independent connections. MCP/OAuth spends the web plan and has no
free test render. An API key uses a separate balance and supports HeyGen's
watermarked `test: true` render. Keep both connected: Test routes to the key and
Live prefers MCP. If Test has no key, it returns `NO_FREE_PATH` rather than
quietly spending the plan.

## Publishing

`Artificial Funny` (**artificialfunny.com**) is an **owned channel**: publishing pushes
directly to the site rather than through a third-party API, and it is listed first because it
is the only destination that does not depend on someone else's uptime. YouTube, LinkedIn,
TikTok, Instagram, Facebook and X are social channels.

An unavailable connection **degrades to Prepare only** and never blocks an export.

## Provider modes

The workspace stores one of three modes: `fixtures` (offline simulated output),
`live_read` / Test (real catalogue and auditions; renders must be free), and
`live` (billable). Paid renders require explicit confirmation. `DRY_RUN` remains
only as a legacy environment alias.

## API

All responses are `{ data, error, message }`. `VITE_API_URL` **must stay relative** (`/api`);
an absolute origin would be compiled into the bundle and pin the app to one hostname.

| area | endpoints |
|---|---|
| workspace | `GET /api/workspace` · `POST /workspace/license\|storage\|ai\|connections\|mode\|complete-onboarding` |
| planning | `GET /api/productions/current` · brief/outline/scene CRUD · website research/review · appearance proofs · Production Lock · `GET …/producer` |
| pipeline | `…/script/generate\|accept\|reject` · editable proposed script lines · `…/render` · `…/render/:id/edit` · `…/export` · `…/publications/:platform` |
| providers | `GET /api/providers` · `POST /providers/:id/connect\|sync\|disconnect` · `GET /provider-jobs/:id` |

## State rule

An upstream edit never silently overwrites downstream work (`backend/lib/stale.js`).
Editing the plan marks scripts, renders, exports and publications **stale** with a reason,
keeping every row. The UI shows a dot on the affected stage and an explanatory bar.

## Build check

```bash
cd frontend && BUILD_DIR=.verify-build npm run build
```

## Not done yet

- The Electron shell exists and serves the frontend and API from one ephemeral
  local origin. A packaged build is still required for the correct Dock name.
- BYO keys still need to move to the OS keychain via `safeStorage`;
  `lib/credentials.js` is the seam for that swap.
- URL research is built for one public page; it is not a crawler. The
  collaborator invite landing page is not built.
- Appearance approval is durable, but creating a reusable provider-native
  HeyGen Look/avatar from it still needs a verified provider operation.
- The Producer is an assessment/action panel, not yet a free-form conversational
  collaborator across the full workflow.
- The editor presents the broader roadmap, but only time-range trim/short-clip
  decisions are currently applied to exported files. Captions, graphics,
  reframing, B-roll and the other listed operations remain unimplemented.

## Important docs

- docs/CLAUDE_HANDOFF.md — implementation brief
- docs/TEST_PLAN.md — zero-credit end-to-end test plan
- docs/FRONTEND_CONTRACT.md — backend-agnostic object/action contract
- docs/PM_SPEC.md and DISTRIBUTION_ONBOARDING.md — product decisions
