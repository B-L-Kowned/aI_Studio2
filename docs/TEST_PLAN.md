# Zero-credit test plan

All tests run in **Fixtures** mode (`PROVIDER_MODE=fixtures`), pinned by the
runner. `npm run verify` gives the suite its own throwaway database on its own
port, and **refuses to run against the development server** — it asserts a
factory-fresh install and writes settings, so a run against a used database
reports leftover state as failures and silently changes your provider mode.

> **Reconciled 2026-09-28 against the code.** This read "All tests run with
> `DRY_RUN=true`". One flag forced you to arm paid generation just to read your
> own avatars, so it was replaced by three modes — `fixtures` / `live_read`
> (Test) / `live` — which separate *reading* from *spending*. `DRY_RUN=false` is
> still honoured as a legacy alias for `live`. See `frontend/docs/ARCHITECTURE.md` §4.

1. License: Comedy, Content, Both; upgrade entitlement without reinstall/migration.
2. Onboarding: Local/Drive/Dropbox selection; Included LLM; mocked BYO OpenAI/Claude/Grok validation; skip and resume.
3. Create entry: idea, template, existing video, existing script, URL/source, existing project.
4. Template: load 20-minute podcast recipe; override episode values without mutating template; optionally save as new template.
5. Plan: build Brief; target 20:00; outline totals/rebalance; reorder/add/remove sections; approve.
6. Scenes: expand outline sections; add/remove/reorder scenes; assign 0/1/2+ participants; set roles and representation; approve without script.
7. People: invite collaborator; mock consent/avatar/voice/preview/scope; add approved guest to scene; optional publication approval.
8. Series: create 20 one-off productions or 20-episode series; bulk-plan outlines; open one production independently.
9. Existing video: mock import/transcript/topic detection; suggestions; build outline/scenes/timeline; enter Editor.
10. Script: generate deterministic mock script from approved plan; version, edit, accept/reject proposals; downstream stale flags.
11. Produce: mock voice/visual/avatar previews; no paid calls.
12. Render: mock queued→processing→complete/fail/cancel; cost estimate shown; explicit paid confirmation disabled in dry run.
13. Edit: trim, replace/regenerate scene, B-roll, captions, audio, reframe, filler/silence, participant insert, short clip; non-destructive edit versions.
14. Publish: Prepare Only for YouTube/LinkedIn/TikTok/Instagram/Facebook/X; mocked schedule/publish connectors; downloadable package metadata.
15. Persistence: navigate across pages, reload fixture store, version restore, autosave failure/retry.
16. Failure cases: provider timeout, invalid key, missing storage, collaborator revocation, stale render, publication failure.

Acceptance: every primary flow is testable end-to-end with zero external paid calls.
