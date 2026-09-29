# Architecture

AI Video Studio — a single-user **desktop** application for planning, generating
and publishing avatar video across many companies.

Everything here is derived from the code, not from the older contracts in
`/docs`. Where the two disagree, the code is right and the contradiction is
recorded in `SANDY_REPORT.md`.

---

## 1. Stack and topology

| Part | What it is | Where |
|---|---|---|
| Frontend | React 18 + Vite, plain CSS with design tokens | `frontend/` |
| Backend | Node + Express (ESM) | `backend/` |
| Database | SQLite via `better-sqlite3` | OS user-data dir, **not** the repo |
| Desktop shell | Electron **44** (main + preload) | `desktop/` |
| Video | HeyGen, over **MCP** (OAuth) or an API key | `backend/lib/providers/` |
| Media tooling | ffmpeg / ffprobe, invoked as subprocesses | system |

**Database location** is `~/Library/Application Support/AIVideoStudio/studio.db`
on macOS (`STUDIO_DB_PATH` overrides). It is deliberately outside the source
tree so the app survives a reinstall and no database is ever committed.

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

---

## 2. The domain model

```
Company                     who the work is for
  └── Campaign (track)      what it is for + WHO IT TALKS TO
        └── Production      one video
              ├── Brief · Outline · Scene      the plan
              ├── ScriptVersion → ScriptSegment
              ├── Segment → Take → SegmentRender   one line each
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

---

## 3. The pipeline and its gates

```
Plan → Script → Segments → Render → Edit → Publish
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

**Paid renders need explicit confirmation** (`confirmPaid`), on the whole
production *and* per segment.

---

## 4. Provider modes — what may be spent

`fixtures` · `live_read` (Test) · `live`, stored in the workspace.

| Mode | Reads | Renders | Auditions |
|---|---|---|---|
| fixtures | stand-ins | simulated (real file, colour bars) | none |
| live_read | real | free only — **refuses** if it cannot be free | **real, costs credits** |
| live | real | real, billed | real |

**`create_video_from_studio` has no `test` parameter.** Its schema is
`scenes, title, folderId, aspectRatio, resolution, brandGlossaryId,
callbackUrl, callbackId, caption` — so the MCP path cannot render for free.
Only the API key's `/v2/video/generate` takes `test: true`. Test mode therefore
routes to the key, or refuses and says why. A mode that promises not to spend
must keep the promise or refuse the job.

Test mode is labelled `spend: metered`, not `none`: renders are free but
auditions are real speech and cost credits.

### Two HeyGen pockets

**MCP (OAuth)** spends the web plan you already pay for. **API key** spends a
separate pay-as-you-go balance. They are not interchangeable, and
`chooseRenderPath()` decides between them from what the MCP server actually
exposes (`tools/list`) plus the current mode — never from an assumption.

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

| Mount | Owns |
|---|---|
| `/api/workspace` | licence, entitlement, storage, provider mode, LLM routing |
| `/api/companies`, `/api/campaigns/:id/track` | company → track layer |
| `/api/productions/*` | production CRUD, pipeline, segments, analysis |
| `/api/series` | bulk episode creation (gated on `plan.series`) |
| `/api/schedule`, `/api/calendar` | what is blocked, what is due |
| `/api/ideas` | the parking lot |
| `/api/presenters`, `/api/roster/*` | cast, personas, import |
| `/api/heygen/*`, `/api/providers/*` | provider account, catalogue, videos |
| `/api/library`, `/api/storage` | finished media and where it goes |
| `/api/training` | courses (content program, 402-gated) |

---

## 8. Tests

`npm run verify` — **184 assertions across three suites**, run against a
throwaway database on its own port. It prints a per-suite verdict and a closing
summary, because a suite that *throws* prints no total and exits non-zero: read
only the "N passed" lines and an aborted suite is indistinguishable from a clean
one. `verify-gate.mjs` sat dead at 6 of 22 checks that way — the gate suite, the
one that enforces the product's central rule — while the run was reported as
162/162 (118 + 44, with the gate contributing nothing).

It **refuses to run against the development server**, because the suite asserts a
factory-fresh install *and writes settings*: an earlier run against the dev
server silently left the app in Fixtures mode. Run against a used database it
reported a dozen failures that were leftover state, which is worse than useless —
it trains you to read red as normal.

| Suite | Covers |
|---|---|
| `verify.mjs` | licence, onboarding, planning, stale propagation, provider sync, publish |
| `verify-gate.mjs` | the hard gate — nothing renders unheard |
| `verify-build.mjs` | series planning, local video analysis, roster import, the parking lot |

---

## 9. Known gaps

| Gap | State |
|---|---|
| Electron packaging | **Closed 2026-09-28.** See §1 “The Electron floor”. |
| OS keychain | Specified in `desktop/KEYCHAIN.md`, not implemented — deliberately, see that file. |
| Transcription | Detected if installed; no local transcriber here, and the analyser says so rather than returning an empty transcript. |
| Character artwork | None exists and none is referenced. Three seeded characters used to point at `/art/*.png` files that were never drawn; the tile is the name for all 166. |
| `/v2/templates` | The one HeyGen endpoint still flagged unverified. |
| API-key render path | Written, never exercised — no key stored. |
| Source / URL import | Not built; the UI says so rather than making a blank production. |
