# Architecture

AI Video Studio — a single-user **desktop** application for planning, generating
and publishing avatar video across many companies.

Everything here is derived from the code. The product specs beside this file
(`PM_SPEC.md`, `DISTRIBUTION_ONBOARDING.md`, `PM_ACCEPTANCE.md`) record intent;
where they and the code disagree, the code is right. Earlier contradictions and
their resolution are in `archive/SANDY_REPORT.md`.

---

## 1. Stack and topology

| Part | What it is | Where |
|---|---|---|
| Frontend | React 18 + Vite, plain CSS with design tokens | `frontend/` |
| Backend | Node + Express (ESM) | `backend/` |
| Database | SQLite via `better-sqlite3` | OS user-data dir, **not** the repo |
| Desktop shell | Electron **44** (main + preload) | `desktop/` |
| Video | HeyGen, over **MCP** (OAuth) or an API key | `backend/lib/providers/` |
| Script AI | deterministic · local Ollama · connected cloud providers | `backend/lib/llm*.js` |
| Media tooling | ffmpeg / ffprobe, invoked as subprocesses | system |

**Database location** defaults to the OS user-data directory —
`~/Library/Application Support/AIVideoStudio/studio.db` on macOS
(`backend/db/index.js`, `defaultDbPath()`). It is deliberately outside the source
tree so the app survives a reinstall and no database is ever committed.

Development and the desktop app use **the same default file**. Electron's own
`userData` directory (`ai-video-studio-desktop`) is not where the database lives.
`STUDIO_DB_PATH` overrides the location; give a development checkout its own
file with it. The provider mode is stored in the database, so a dev server
sharing a database that is in Live mode spends real HeyGen credits.

### Runtime shapes

There are two, and they differ in one way only — who serves the HTML.

**Development.** Two processes. Vite on `3333` serves the UI and proxies `/api`
to Express on `3433`. Managed by pm2 (`ecosystem.config.js`).

**Packaged.** One process. Express serves `frontend/dist` *and* `/api` from the
**same origin** on an **ephemeral port** (`PORT=0`), and Electron reads the
chosen port from the `STUDIO_READY` line on stdout. A fixed port would collide
with whatever else is on the user's machine and with a second copy of the app.

This is why `VITE_API_URL` must stay a **relative path**. An absolute origin
compiled into the bundle pins the app to one hostname, and in a packaged build
the port is not known until startup, so there is nothing to pin. The frontend
refuses at import time if it is given an absolute one.

### The Electron floor — why the version is pinned high

`better-sqlite3` 13 is built against **N-API 10** and declares `engines: node >=22`.
N-API is forward-compatible, not backward: a module built for 10 registering on a
runtime that offers 9 does not get a clean error from Node 20 — it **segfaults
inside `node_module_register`**, before any JavaScript runs, with an empty stderr.

Electron 33 embeds Node 20.18 / N-API 9, so it was below that floor and the app
could not start. **This is a version floor, not an ABI mismatch, and
`electron-rebuild` cannot fix it.** It is worth saying plainly because the
evidence points the wrong way:

- `@electron/rebuild` prints `✔ Rebuild Complete` and exits **0** while building
  nothing. `better-sqlite3`'s `binding.gyp` sets `prebuild_exists` from
  `node lib/binding.js`, and when a prebuild exists both targets become
  `'type': 'none'`. The "successful rebuild" leaves `build/Release/` holding two
  `.stamp` files and no `.node`.
- Building one properly (`--force_build=1` against Electron's headers) produces a
  real binary that **segfaults identically** — which is the proof that the ABI was
  never the problem.
- `lib/binding.js` prefers `prebuilds/` **over** `build/Release/`, so a hand-built
  binary would not have been loaded even if it had worked.

So the fix is the runtime, not the module: **Electron must embed Node ≥ 22.**
Electron 44 embeds Node 24.21 / N-API 10, where the *shipped prebuild* loads
as-is — no rebuild step, no `nativeBinding` override, no second copy of the
binary to drift out of date.

Electron 33 was also out of support (only the newest three majors get Chromium
security fixes), which is its own reason not to stay there.

**Check it by measurement, never by version arithmetic:**

```bash
ELECTRON_RUN_AS_NODE=1 ./desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  -e "console.log(process.version, process.versions.napi)"   # want >= v22, 10
```

One more trap on this machine: npm's allow-scripts policy blocks Electron's
postinstall, so `npm install` leaves `node_modules/electron/` with **no `dist/`**
and the launcher fails with a bare `no such file or directory`. Run the
downloader explicitly:

```bash
node desktop/node_modules/electron/install.js
```

The server binds `127.0.0.1` — a single-user desktop app that listened on every
interface would put the workspace on the local network.

### Active product versus salvage source

This architecture describes `aI_Studio2` in
`~/Desktop/Projects/ai-video-frontend`. The older
`~/Desktop/thoughts/artificial_funny/desktop` program is reference-only. Its
multi-provider LLM contract, constrained Ollama JSON pattern and safe parsing
were ported selectively; its hosted tier, accounts, licensing and application
shell were not.

---

## 2. The domain model

```
Company                     who the work is for
  └── Campaign (track)      what it is for + WHO IT TALKS TO
        └── Production      one video
              ├── Brief · Outline · Scene      the plan
              ├── Source → WebsiteResearch     evidence + human review
              ├── ScriptVersion → ScriptSegment
              ├── Segment → Take → SegmentRender   one line each
              ├── Presenter → AppearanceProof  approved visual treatment
              ├── RenderVersion → Export → Publication
              └── Source (imported video + its measurements)
```

Workspace-level, shared across every production: **Presenter** (with `persona`),
**ProviderAsset** (HeyGen avatars/voices), **Asset** (the Library), **Idea** (the
parking lot), **Person** (collaborators + consent).

### Three decisions worth knowing

**A campaign is a track, not a folder.** It carries a `purpose` from a closed
set (promotion · gtm · investor · training · recruiting · internal) and a
free-text `audience`. The purpose is closed so "investor" means the same thing
across fifty companies and they can be compared; the audience is open because no
enum survives fifty companies. The audience reaches `generateScript`, which is
the whole point — the same company says different things to investors and to
buyers.

**There is no Project and no Series table.** A series is a campaign whose
productions carry `collection_position`. `collection_order_by()` is the single
function every reader uses, and a campaign with no positions is served the same
newest-first list it was served before ordering existed. Training reads exactly
this structure, which is why a series created in one place shows up as an
ordered course in the other without either knowing about the other.

**An Idea is not a Production.** It has no pipeline, no gate, no deadline and no
place in the schedule. That is what makes capture cheap. A parked thing with a
deadline is a production; that is the line between them.

### Working across productions

A production starts from Campaigns → *New production*, the switcher in the
Create breadcrumb, or a start card on Create → Idea (idea, template, existing
video, script, URL — each sets the `sourceType`). A template seeds the brief,
outline and target runtime (`backend/data/templates.js`). Creating from a
template outside the licence returns **403 `NOT_LICENSED`**, so no one ends up
holding a project they cannot open. The open production is remembered in
`workspace.last_production_id`. Productions are isolated: editing one never
marks another stale.

---

## 3. The pipeline and its gates

```
Website evidence → Plan → editable Script → Segments / shipping-voice approval
                 → Appearance approval → Production Lock → Render → Edit → Publish
```

Each stage refuses to run until the one before it is genuinely done. The refusals
are the product.

**Nothing renders unheard.** A `Segment` is the unit of script, take, presenter,
shot, quality and render. It cannot render until it is cast, auditioned, and the
take is *approved*. Editing the line makes its take stale — approving a sound and
then changing the words is not approval of the new words. `renderGate()` reports
`{total, ready, heard, blocked[]}` and the whole-production render is gated too,
so rendering line-by-line is not a way around it.

**A take is real audio.** Auditions call HeyGen `create_speech` in the voice that
will actually ship. A take with no audio cannot be marked heard — a stand-in
voice approves a sound the video never makes.

**Upstream edits never overwrite downstream.** They mark it stale with a reason
(`lib/stale.js`). Nothing is deleted; you regenerate when ready.

**Anything that would spend needs explicit confirmation.** `confirmPaid: true`
is required on the whole-production render, per-segment renders on a non-free
path, single auditions, `audition-all`, and `POST /heygen/speech` whenever they
would spend. Without it they return **402 `CONFIRMATION_REQUIRED`**.

**Website evidence is reviewed before it becomes script context.** URL research
stores the page title, description, headings, summary, a bounded text snapshot
and proposed brief fields. A human approves the reading; only then may script
generation proceed. The approved `Source summary` reaches the opening and the
approved `CTA` reaches the close. Failed/unreviewed sources keep the lock shut
but may be removed before review.

**Appearance is a separate approval from casting.** Personal and fictional
performers need one approved proof per production: image, outfit, background
and framing. Stock avatars already refer to a fixed provider appearance. The
approval is a local production record; it does not claim to create a reusable
provider-native avatar/look.

**`productionLock()` is the one answer to “may this render?”** It returns every
gate and every blocker together: research, outline, scenes, accepted non-stale
script, built segments, approved shipping takes, appearance and open-decision
warnings. The desktop Render screen draws that answer directly. Any provider
mode that can reach HeyGen enforces it server-side; Fixtures remains an explicit
offline sandbox for testing export and publication code.

---

## 4. Provider modes — what may be spent

`fixtures` · `live_read` (Test) · `live` (`backend/lib/providers/mode.js`).

The mode is stored in `workspace.provider_mode` and the stored value wins. The
`PROVIDER_MODE` env var (or legacy `DRY_RUN=false`, meaning `live`) is used only
while no mode has been stored — in practice, a fresh database. Switching to
`live` requires `confirmBilling: true`; without it the request returns
**402 `CONFIRM_BILLING`** and the previous mode stays in place.

| Mode | Reads | Renders | Auditions |
|---|---|---|---|
| fixtures | stand-ins — nothing leaves the machine | simulated (real file, colour bars) | none |
| live_read | real | free only (HeyGen watermarked test render via API key) — **refuses** if it cannot be free | **real speech, costs credits** — needs `confirmPaid` |
| live | real | real, billed — needs `confirmPaid` | real, billed — needs `confirmPaid` |

**`create_video_from_studio` has no `test` parameter.** Its schema is
`scenes, title, folderId, aspectRatio, resolution, brandGlossaryId,
callbackUrl, callbackId, caption` — so the MCP path cannot render for free.
Only the API key's `/v2/video/generate` takes `test: true`. Test mode therefore
routes to the key, or refuses and says why. A mode that promises not to spend
must keep the promise or refuse the job.

Test mode is labelled `spend: metered`, not `none`: renders are free but
auditions are real speech and cost credits.

### LLM routing is separate from video routing

The built-in route is deterministic code, **not** a disguised local model.
Ollama is a separate provider restricted to loopback and probed through
`/api/tags`. OpenAI, Anthropic, Groq and xAI read their encrypted credentials
only inside the backend. Fixtures never makes an LLM call. Test may call local
Ollama; cloud generation requires Live because it may incur provider charges.

Only `script` executes through this runtime today. `plan` and `clarify` remain
visible but disabled in Settings and continue through deterministic code. The
separation is deliberate: a saved route is not evidence that a feature calls
that route.

Structured output has one contract. Ollama receives `format: "json"`; cloud
providers receive JSON-only instructions and supported JSON-object mode. The
parser accepts direct/fenced/outer-object JSON but never includes malformed
customer output in exceptions. `segmentsFromLlmScript()` then requires every
approved scene exactly once, rejects unknown speakers and caps stored line
sizes. Script versions preserve the provider and model for audit.

### Two HeyGen pockets

**MCP (OAuth)** spends the web plan you already pay for. **API key** spends a
separate pay-as-you-go balance. They are not interchangeable, and
`chooseRenderPath()` decides between them from what the MCP server actually
exposes (`tools/list`) plus the current mode — never from an assumption. In
Fixtures it answers before asking the server anything, and a stored key that
cannot be decrypted does not count as a key.

**Either connection works independently.** MCP alone covers normal Live
production. The API key is optional; it adds HeyGen's watermarked free Test
render and can act as a separately billed Live fallback. With both stored:

| mode | path | free |
|---|---|---|
| fixtures | `fixtures` | yes — simulated |
| live_read (Test) | `key` | **yes** — HeyGen test flag, watermarked |
| live | `mcp` | no — spends your plan |

With no key, `live_read` returns `NO_FREE_PATH` and refuses, because a mode
that promises not to spend must keep the promise or refuse the job.

`/connections` reports `pockets: { mcp, key }` independently and the key is
always addable. An earlier version reported a single `pocket` with MCP winning,
which hid a stored key once you signed in and made the free Test path
unreachable. Keep the report and the router reading the same two facts.

---

## 5. Storage

Exports and attached videos land under:

```
<storage root>/<Company>/<Track>/<Production>/
```

**Cloud services need no integration.** Dropbox, Google Drive, OneDrive, Box and
iCloud are folders when their desktop client is installed — writing a file into
one *is* uploading it. `lib/storage.js` detects which service owns a path
(including *which* Google account, since several can be mounted) and says
plainly when a folder is "This machine only".

A destination is validated by **writing a probe file and deleting it**, not by
reading permission bits: a cloud mount can list fine and still refuse writes when
its client is signed out, and a finishing render is the worst time to find out.

Signed provider URLs are resolved **at download time** because they expire. One
stored at sync time works right up until it silently does not.

---

## 6. Security model

- **Licence, not accounts.** A key grants an entitlement (`comedy`/`content`/
  `both`) → programs → capabilities. The **server owns the mapping**; the client
  never decides access, only what it draws. `requireProgram()` returns **402** so
  a bookmark kept from before a downgrade gets a clean refusal.
- **Secrets** are AES-256-GCM encrypted at rest with a `0600` key file, never
  returned by any endpoint, and shown only as masked hints. Migration to the OS
  keychain is specified in `desktop/KEYCHAIN.md` and deliberately not done.
- **Key checks have three verdicts** — `ok` / `refused` / `unknown`. A network
  failure is not a verdict on a key.
- No inbound auth: the server is loopback-only and single-user.
- Website fetches accept only HTTP(S), resolve DNS before each hop, refuse
  loopback/private/link-local addresses, cap redirects and response bytes, and
  accept only text pages. This is the SSRF boundary for URL research.

---

## 7. HTTP contract

Every endpoint answers `{ data, error, message }` with a real status code.
Unknown `/api/*` paths hard-404 as JSON even in a packaged build — answering
them with `index.html` would turn a typo into a 200. **A path carrying a file
extension 404s too.** `express.static` has already had its chance at it, so the
SPA fallback would be answering a request for a *file* with HTML: the browser
gets a document where it wanted an image and silently renders the fallback, or
where it wanted a script and dies on `<` as a parse error. `/art/marv.png`
returned 200 that way for artwork that never existed. Deep links carry no
extension, so client routing is unaffected.

Every router mounts under `/api` (`backend/server.js`). Most mount at `/api`
itself and declare their own top-level paths; four mount at a deeper prefix.

| Mount | Router | Paths it serves |
|---|---|---|
| `/api` | `workspace.js` | `/workspace/*` (licence, storage, AI keys, LLM routing, provider mode, onboarding), `/setup`, `/start-sources`, `/publish-targets`, `/editor-tools` |
| `/api` | `collections.js` | `/campaigns`, `/people` (invite, consent, casting), `/casting/options`, `/library`, `/calendar` |
| `/api` | `companies.js` | `/companies/*`, `/campaigns/:id/track` |
| `/api` | `providers.js` | `/providers/*`, `/provider-jobs/:id` |
| `/api` | `connections.js` | `/connections/*` |
| `/api` | `heygen.js` | `/heygen/*` — account, catalogue, videos, speech |
| `/api` | `presenters.js` | `/presenters` |
| `/api` | `roster.js` | `/roster/*` |
| `/api` | `schedule.js` | `/schedule`, `/productions/:id/due` |
| `/api` | `ideas.js` | `/ideas` |
| `/api` | `storage.js` | `/storage`, `/storage/check`, `/productions/:id/folder` |
| `/api/productions` | `productions.js`, `pipeline.js`, `segments.js`, `analysis.js`, `workflow.js` | production CRUD and planning, script/render/edit/export/publish, segments and read-through, video analysis, website research, appearance proofs, Production Lock |
| `/api/series` | `series.js` | bulk episode creation (gated on `plan.series`) |
| `/api/training` | `training.js` | `/courses`, `/lessons` (content program, 402-gated) |

---|---|
| `/api/workspace` | licence, entitlement, storage, provider mode, LLM routing |
| `/api/companies`, `/api/campaigns/:id/track` | company → track layer |
| `/api/productions/*` | production CRUD, pipeline, segments, analysis, website research, appearance proofs and Production Lock |
| `/api/series` | bulk episode creation (gated on `plan.series`) |
| `/api/schedule`, `/api/calendar` | what is blocked, what is due |
| `/api/ideas` | the parking lot |
| `/api/presenters`, `/api/roster/*` | cast, personas, import |
| `/api/heygen/*`, `/api/providers/*` | provider account, catalogue, videos |
| `/api/library`, `/api/storage` | finished media and where it goes |
| `/api/training` | courses (content program, 402-gated) |

---

## 8. Tests

Run `npm run verify` in `backend/` and read the summary block: every suite
must print its total. The count changes as tests are added, so none is recorded
here. `run-verify.mjs` runs four suites against a throwaway seeded database on
its own port, in Fixtures mode. It prints a per-suite verdict and a closing
summary, because a suite that *throws* prints no total and exits non-zero: read
only the "N passed" lines and an aborted suite is indistinguishable from a clean
one. `verify-gate.mjs` sat dead at 6 of 22 checks that way — the gate suite, the
one that enforces the product's central rule — while the run was reported as
162/162 (118 + 44, with the gate contributing nothing).

`verify.mjs` **refuses to run against the development server** unless
`VERIFY_BASE` is set, because the suite asserts a
factory-fresh install *and writes settings*: an earlier run against the dev
server silently left the app in Fixtures mode. Run against a used database it
reported a dozen failures that were leftover state, which is worse than useless —
it trains you to read red as normal.

| Suite | Covers |
|---|---|
| `verify.mjs` | licence, onboarding, planning, script revision, editing, stale propagation, provider sync, honest publish |
| `verify-gate.mjs` | the hard gate — nothing renders unheard |
| `verify-build.mjs` | website evidence, appearance approval, Production Lock, series planning, local video analysis, roster import, the parking lot |
| `verify-llm.mjs` | safe structured parsing, constrained Ollama JSON, local status, prompt context and script-shape validation |

---

## 9. Known gaps

| Gap | State |
|---|---|
| Electron packaging | **Closed 2026-09-28.** See §1 “The Electron floor”. |
| OS keychain | Specified in `desktop/KEYCHAIN.md`, not implemented — deliberately, see that file. |
| Transcription | Detected if installed; no local transcriber here, and the analyser says so rather than returning an empty transcript. |
| Character visuals | **Open — no artwork exists yet.** A character's avatar is its *performer*, never its likeness: the previous build's README says each character borrows a realistic human HeyGen avatar by default, and custom art replaces it (uploaded as a HeyGen talking photo, which then animates that image instead). So a character card shows the character's `artwork_url`, or its monogram until there is one, with the performing avatar named in a small "Performed by …" chip. Presenter and You cards show the avatar photo, because there the avatar IS the likeness. To add art: set it per character, or put `<id>.png` in the previous build's `desktop/character_art/images/` and re-run the roster import, which fills `artwork_url` where it is empty. |
| `/v2/templates` | The one HeyGen endpoint still flagged unverified. |
| API-key render path | Written, never exercised — no key stored. |
| Source / URL import | **Closed in `codex/production-workflow-parity`.** One public page is researched, evidence is preserved and reviewed, and approved context reaches the script. This is intentionally not a crawler. |
| Post-render editing | **Partial.** `Trim / Cut` and `Create Short Clip` collect ranges and are applied to the exported file. The other tools are disabled roadmap labels. No lower-thirds, burn-in captions or branding. `caption` exists only as publish metadata. |
| Conversational producer | Durable workflow states and direct script revision are built. A free-form assistant that proposes controlled mutations across stages is not yet built. |
| LLM-routed planning/clarification | The shared execution runtime and routing UI exist; only Scripting invokes it today. Planning and Clarification are explicitly disabled/reserved. |
| Provider-native reusable Look | Local appearance proof/approval is built; a verified HeyGen operation to create a reusable remote look/avatar from it is not. |
| Script → Segments | **Closed 2026-09-29.** Accepting a proposed script, or importing one that is already accepted, builds the line-level production segments immediately. The UI then advances to Segments; rebuilding remains an explicit recovery/update action. |
| Free audio review | **Closed 2026-09-29.** Auditions are HeyGen speech and spend the plan, which made the only way to hear a script a paid one. `lib/readthrough.js` reads it with local `say`: free, offline, with per-line and total duration against the target. It deliberately cannot satisfy the render gate — it answers "are these the right words", not "is this the right delivery". |

---

## 10. Action contract

The UI asks for actions and capabilities, never provider endpoints; provider
choice happens behind the API (`routeCapability()` in
`backend/lib/providers/index.js`). This is the action list from the original
frontend contract (`archive/FRONTEND_CONTRACT.md`) mapped to what exists in
`frontend/src/services/api.js`.

| Contract action | Client function(s) | State |
|---|---|---|
| createProduction(sourceType, templateId?) | `createProduction` | built; the template seeds brief, outline and runtime |
| producerAssess | `producer` | built — known / inferred / decisions needed |
| updateBrief · applyTemplate · saveTemplate | `updateBrief` | template applies at creation; saving a new template is not built |
| outline sections · rebalanceRuntime · approveOutline | `addSection`, `updateSection`, `deleteSection`, `rebalance`, `approveOutline` | built |
| developScenes · scene CRUD · approveScenes | `developScenes`, `addScene`, `updateScene`, `deleteScene`, `approveScenes` | built |
| inviteCollaborator · grant/revokeConsent | `invitePerson`, `grantConsent`, `revokeConsent` | invite mints a link with no page behind it; consent built |
| submitAvatarVoice · requestPublicationApproval | — | not built |
| ingestSource · analyzeExistingVideo | `addSource`, `researchWebsite`, `reviewResearch`, `analyseVideo`, `adoptAnalysisOutline` | built (one page per URL; no transcription) |
| generateScriptProposal · accept/reject/revise | `generateScript`, `acceptScript`, `rejectScript`, `updateScriptSegment` | built; only proposed versions are editable |
| createJob · cancelJob · retryJob | `startRender`, `cancelRender`, `renderSegment`, `providerJob` | no retry action |
| createRenderVersion · applyEditDecision · exportVersion | `startRender`, `applyEdit`, `createExport` | built; there is no EditProject — edit decisions attach to a render version |
| prepare · schedule · publishPublication | `publish` | Prepare-only for social platforms; direct publish only to Artificial Funny |
