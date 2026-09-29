# SANDY_REPORT

> Historical report for the 2026-09-28 run. Its commit-state notes describe
> that moment, not the current repository. For the current verified state use
> `HANDOFF.md` and `ARCHITECTURE.md` in this directory.

**Program:** AI Video Studio (`/Users/patrickbialko/Desktop/Projects/ai-video-frontend`)
**Run:** 2026-09-28 · operator path, local
**Verdict:** **NOT CERTIFIABLE — and not because it failed.** This program is not
an ERP-registered fleet program, so the stages that issue a verdict cannot resolve
it. What `/sandy` *could* run, ran. See §1 before reading anything else.

---

## 1. Scope — what could not run, and why

`/sandy` certifies **deployed, ERP-registered** programs. This one is a local
desktop application. Four of its stages therefore had nothing to act on:

| Stage | Status | Evidence |
|---|---|---|
| `prep_audit.py` (Prod01) | **Could not run** | Imports `programs.py` from the ERP backend (`sys.path` → `BE/core/standards`). Not portable to an unregistered path. Its `--self-test` **passes** on Prod01, so the tool is sound — it simply has no record for this program. |
| `conformance_audit.py` | **N/A** | Audits a *served origin*. Nothing is deployed; there is no domain. |
| `pretest_readiness.py` | **N/A** | Resolves via `companies`. `fleet-target --company ai_video_studio` → *"no company record"*. |
| ERP chain (certifying) | **N/A** | Same. Only a chain run can issue `go: true`. |
| `testpjb` / `testhu` / `demo` skills | **Not available** | Not in this session's skill list. They were **not** invoked and **nothing was generated in their place** — `HUMAN_TESTING_PLAN.md` and `DEMO_PLAN.md` do not exist and are not claimed to. |

The PREP **rules** were applied **by hand** and are labelled as such. A hand
check is not the tool; where the two could differ, trust the tool.

> Making this certifiable means a `companies` record (code, domain, `deploy_root`,
> `db_name`) and a deployment. That is a decision, not a defect.

---

## 2. Prep ledger

| Rule | Before | After | What happened |
|---|---|---|---|
| PREP-01 protect live paths | — | — | pm2 runs `ai-video-api` / `ai-video-web` from this tree. Nothing in the protected set was touched. |
| PREP-02 permissions | **2** | **0** | `backend/.env` and `frontend/.env` were `0644` — readable by any user on the machine. `chmod 600`. Checked by a script reading **mode and path only**, resolving symlinks to their target. |
| PREP-03 secret copies | 0 | 0 | None. |
| PREP-04 tracked backups | n/a | 0 | No repository existed. |
| PREP-05 leftovers | 0 | 0 | None. |
| PREP-06 `.gitignore` | **missing** | **created** | Excludes secrets (`!*.example`), `*.db`, builds, `node_modules`, leftovers. |
| PREP-07 root `.md` | 0 | 0 | Only `README.md`. |
| PREP-08 ad-hoc scripts | 0 | 0 | `verify*.mjs` / `run-verify.mjs` are the named test entry points in `package.json`, not strays. |
| PREP-09 tracked artifacts | n/a | 0 | Verified **before** the first commit. |
| PREP-10 root `package.json` | flag | flag | None at root. Correct split. |
| PREP-11 re-verify | — | **green** | API 200; `npm run verify` **162/162**; `vite build` clean. |

### The finding that mattered most

**There was no version control.** Days of work, one `rm -rf` from gone, and no
way to answer "what changed and when".

`git init` done, `.gitignore` written first, all 119 files staged. The index was
verified **before** committing — the first commit of a repository is the one that
matters, because a secret committed once stays in history after it is deleted and
the fix becomes rotation, not `git rm`:

```
staged files              : 119
secret configs   (want 0) : 0
databases        (want 0) : 0
node_modules     (want 0) : 0
build output     (want 0) : 0
example configs  (want>0) : 2
VERDICT: SAFE TO COMMIT
```

**Not committed.** The standing instruction is *"Never commit unless I explicitly
ask."* Staged and stopped:

```bash
git -C /Users/patrickbialko/Desktop/Projects/ai-video-frontend commit -m "Initial commit"
```

---

## 3. Documentation

### Coverage

| Dimension | Covered by | Status |
|---|---|---|
| Architecture | `frontend/docs/ARCHITECTURE.md` | ✅ **written this run** (was missing) |
| Data model | ARCHITECTURE §2 | ✅ |
| Roles / entitlement | ARCHITECTURE §6 | ✅ |
| Routes | ARCHITECTURE §7 | ✅ |
| Env vars | `.env.example` ×2 | ⚠️ present, not annotated |
| Setup / run / deploy | `README.md` + ARCHITECTURE §1 | ✅ |
| Security model | ARCHITECTURE §6 | ✅ |
| Test accounts | — | **N/A** — licence-key app, no accounts |
| Seed path | `backend/seed.js` | ✅ |

### Contradictions found and fixed

| # | Claim | Source | Reality | Fix |
|---|---|---|---|---|
| 1 | `Workspace > Campaign > Project > Series > Production` | `PM_SPEC.md` | **No `projects` or `series` table exists.** A series is a campaign with `collection_position`. `Company` sits above campaigns and was absent. | Rewritten + note |
| 2 | Core objects include `Project`, `Series`, `EditProject` | `FRONTEND_CONTRACT.md` | Same; also missing `Company`, `Take`, `Idea`, `Presenter` | Rewritten + note |
| 3 | "All tests run with `DRY_RUN=true`" | `TEST_PLAN.md` | Three modes (`fixtures`/`live_read`/`live`). `DRY_RUN` is a legacy alias only. | Rewritten + note |

Each carries a dated note saying what it used to say and why it changed — a
corrected doc that hides its correction teaches nothing.

---

## 4. Runtime (evidence, not certification)

Proven against the live runtime this session, not asserted:

- **Render** — `create_video_from_studio` on the user's plan → real video, played back in-app.
- **Export** — 2.9 MB / 1920×1080 / h264+aac on disk, confirmed by `ffprobe`.
- **Edit** — trim `0:02–0:10` applied by ffmpeg: 15.7s → **8.0s**, 2.9 MB → 1.0 MB.
- **Attach** — HeyGen video → production → **20 MB, 1080×1920, 61.7s** under `Company/Track/Production/`.
- **Gate** — per-segment and whole-production renders both refuse when unheard.
- **Tests** — 162/162 on a factory-fresh database.

### Defects found and fixed this session

| Defect | Why it mattered |
|---|---|
| Test mode would have **billed the plan** | `create_video_from_studio` has no `test` param; the route ignored the mode entirely |
| Paid render **could never succeed** | UI never sent `confirmPaid`; Live returned 402 every time |
| Render progress was a **clock, not the provider** | "Complete" after ~8s regardless; created exports for videos that did not exist |
| Export was **a row with no file** | `status: ready` with nothing on disk |
| Library import **discarded the URL** | Stored a name; the video was unreachable |
| Catalogue silently capped at **exactly 1000** | Pagination guard, not the roster size |
| `/api/presenters` shipped **4.9 MB** | Whole catalogue into ~350 dropdowns |

---

## 5. Open items

**Blocking certification** (external, not code):
1. No `companies` record → stages 2/3/5 cannot resolve the program.
2. Not deployed → no origin to audit.

**Open in the code** — see `ARCHITECTURE.md` §9: OS keychain (`desktop/KEYCHAIN.md`), transcription, character artwork,
`/v2/templates`, the unexercised API-key render path, URL import.

**Carried forward:** the workspace is in **Live** mode (`spend: billable`).
Renders are confirmation-gated, but nothing else guards it.

---

## 6. Scorecard

| Area | Verdict |
|---|---|
| Prep gate | ✅ PREP-02..09 clear (by hand; tool unavailable) |
| Version control | ⚠️ initialised, verified, **awaiting your commit** |
| Documentation | ✅ architecture written, 3 contradictions fixed |
| Runtime | ✅ end-to-end proven live |
| Tests | ✅ 162/162 factory-fresh |
| Testing plan / demo plan | ❌ **not generated** — skills unavailable |
| Cross-consistency | ⚠️ docs ↔ code reconciled; no testing/demo artifacts to cross-check |
| **Certification** | **❌ N/A** — not an ERP-registered program |

**One line:** the documentation now matches the code and the runtime does what
the documentation says, but this program cannot be *certified* by `/sandy`
because it is not in the fleet — and no part of that pipeline was simulated to
make the report look complete.

### Correction — 2026-09-28, the Electron crash

This report and `ARCHITECTURE.md` both recorded the desktop crash as an
`better-sqlite3` **ABI mismatch** needing `electron-rebuild`. That was wrong, and
it was wrong in the way this fleet's rules warn about: `@electron/rebuild`
printed `✔ Rebuild Complete` and exited **0** having produced no binary at all
(`build/Release/` held two `.stamp` files), and that green output was taken as
the answer.

The real cause is a **version floor**: `better-sqlite3` 13 needs N-API 10, and
Electron 33 embeds Node 20.18 / N-API 9. Proof it was not the ABI: a binary
built correctly against Electron 33's own headers segfaults identically.

Fixed by moving to **Electron 44** (Node 24.21 / N-API 10), where the shipped
prebuild loads unmodified. Verified: app launches, backend reports its port,
window loads the bundle, `/api/*` 404s stay hard, `npm run verify` 162/162 under
system Node. Full account in `ARCHITECTURE.md` §1.
