# Claude implementation handoff — v0.3

> Historical implementation brief. It is not the current handoff or architecture
> source of truth. Use `frontend/docs/HANDOFF.md` and
> `frontend/docs/ARCHITECTURE.md`; where this file disagrees, those documents and
> the running application win.

## Goal
Turn this PM prototype into a production-quality frontend while preserving the product contract. Do not spend paid generation credits during implementation or testing.

## Product invariant
One installed application. Three entitlements: Comedy, Content, Both. License changes capabilities, never codebase/project format.

## Canonical workflow
Acquire/license → onboard → Idea/Source → Plan → Script → Produce → Render → Edit → Export/Publish → Library.

Plan is NOT Script. Planning must persist these views: Brief, Outline, Scenes, People, Sources, Decisions. The AI Producer may infer low-risk defaults but must surface unresolved material decisions. Templates are production recipes and pre-populate planning defaults.

## Hierarchy
Workspace → Campaign (optional) → Project (optional) → Series (optional) → Production → Outline Section → Scene → Segment/Line → Asset/Render/Edit/Export.
Campaign can contain multiple projects. One-offs may skip Campaign/Series.

## People/collaboration
Scenes have participants[] (0..n), not avatar_id. Participant representation may be avatar, real video, or hybrid. Invite links allow a collaborator to create/approve appearance and voice without project access. Consent scope: production, series/project, workspace-until-revoked. Optional final-publication approval.

## Existing video
Existing Video is a first-class Create source. Dry-run analysis should simulate: ingest → metadata → transcript → topic/scene detection → improvement suggestions → outline/timeline → Editor. Suggested tools include silence/filler removal, audio cleanup, captions, B-roll, intro/outro, graphics, reframe, chapters and short clips.

## Generation architecture
UI requests capabilities, never provider-specific endpoints. Provider router chooses model/provider. Draft/preview/final are distinct. Paid final generation requires explicit confirmation. Dry Run must be the default development mode.

## Definition of done for frontend pass
- All navigation works and never loses in-memory project state.
- Autosave UI states exist: Saving, Saved, Failed/Retry.
- Template selection feeds Brief/Outline defaults.
- Outline runtime can be edited/rebalanced.
- Outline → Scenes works without generating dialogue.
- Scenes support multiple participants and roles.
- Collaborator invite/approval screens exist as mock flows.
- Existing-video import/analyze/edit path exists as mock flow.
- Script is downstream of approved planning.
- Render creates a version; Edit is post-render and non-destructive.
- Publish supports Prepare Only even with no social connection.
- Dry Run exercises every flow with fixtures and zero paid API calls.
- Responsive desktop-first UI; no dead buttons in the primary happy paths.
