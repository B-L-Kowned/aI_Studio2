# AI Video Studio — v0.4

A single-user desktop application for planning, scripting, rendering and
publishing avatar video (HeyGen) across many companies. There is one build; a
licence key sets the entitlement — Comedy, Content or Both — and upgrading never
reinstalls or migrates a project (`docs/DISTRIBUTION_ONBOARDING.md`).

## Layout

```
frontend/   React + Vite + Tailwind → http://localhost:3333 (dev)
backend/    Express + SQLite        → http://localhost:3433 (dev)
desktop/    Electron shell — serves UI and API from one ephemeral local port
docs/       architecture, handoff, product specs, test plan
```

## Run

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
(cd backend && npm install && npm run seed)   # seed only a new, empty database
(cd frontend && npm install)
pm2 start ecosystem.config.js
```

Then open http://localhost:3333. First run shows onboarding — use a demo key:
`COMEDY-A1B2-C3D4`, `CONTENT-E5F6-G7H8` or `BOTH-9Z8Y-7X6W`.

**Database.** SQLite, in the OS user-data directory, for both dev and the
desktop app:

- macOS `~/Library/Application Support/AIVideoStudio/studio.db`
- Windows `%APPDATA%\AIVideoStudio\studio.db`
- Linux `$XDG_DATA_HOME/AIVideoStudio/studio.db`

Set `STUDIO_DB_PATH` in `backend/.env` to give a dev checkout its own database.
This is recommended: the provider mode is stored in the database, so a dev
server sharing a database that is in Live mode spends real HeyGen credits. On a
dev database, stay in **Fixtures** mode.

**Seeding.** `npm run seed` (in `backend/`) loads sample content for a new
database. It **deletes** productions, campaigns, presenters, people, scripts,
renders, exports and the library first — never run it against a database holding real
work.

| command | effect |
|---|---|
| `pm2 logs ai-video-api` / `ai-video-web` | service output |
| `pm2 restart ai-video-api ai-video-web` | restart both |
| `cd backend && npm run seed` | replace all content with sample content, keep licence and connections |
| `cd backend && npm run seed -- --reset-workspace` | also wipe licence, credentials and connections and synced provider assets — back to first run |
| `cd backend && npm run verify` | all test suites on a throwaway database; read the summary block, every suite must print its total |
| `cd desktop && npm start` | run the Electron shell |
| `cd frontend && BUILD_DIR=.verify-build npm run build` | build check without touching `dist` |
| paste `frontend/tools/ui-diff.js` into the app's console | before/after check of any visual change (instructions in the file) |

## Provider modes

Stored in the workspace and changed in Settings. The stored value wins; the
`PROVIDER_MODE` env var only applies until a mode has been stored.

| mode | what happens |
|---|---|
| `fixtures` | nothing leaves the machine |
| `live_read` — **Test** | real reads; renders use HeyGen's free watermarked test mode via the API key (refused if no key). **Auditions are real speech and cost credits.** |
| `live` | real, billable generation; switching to it needs `confirmBilling: true` |

Auditions, audition-all, `/heygen/speech` and paid renders require
`confirmPaid: true` whenever they would spend, and return
`402 CONFIRMATION_REQUIRED` otherwise. Nothing renders until every line has an
approved take in the shipping voice.

`VITE_API_URL` must stay relative (`/api`); an absolute origin is compiled into
the bundle and pins the app to one host.

## Docs

- `docs/ARCHITECTURE.md` — design, pipeline gates, provider modes, HTTP contract, known gaps
- `docs/HANDOFF.md` — traps already hit, what is not built, next steps
- `docs/TEST_PLAN.md` — zero-credit end-to-end test plan
- `docs/PM_SPEC.md`, `docs/DISTRIBUTION_ONBOARDING.md`, `docs/PM_ACCEPTANCE.md` — product decisions
- `desktop/KEYCHAIN.md` — planned OS keychain migration
- `docs/archive/` — superseded briefs and audit reports
