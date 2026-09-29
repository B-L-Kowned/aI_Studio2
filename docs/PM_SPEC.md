# Product / UX Contract v0.1

## Canonical hierarchy
Workspace > Campaign (optional) > Project > Series (optional) > Production > Scene > Segment/Line > Asset/Render.

A campaign may contain multiple projects. A project may contain series and/or one-off productions.

## Global mode
One persistent state: `comedy | content | both`. It controls templates, AI Producer context and licensed capabilities; it does not fork the application.

## Planning — highest-priority concept area
The planner has two synchronized surfaces:
- conversational AI Producer
- structured Production Plan

AI must return: known facts, inferred values, decisions required, proposed defaults, questions, and a structured plan. Users can accept/override every field. Free-form and templates produce the same canonical plan object.

Suggested planner states: idea, clarifying, proposed, accepted, changed/stale.

## Editing — highest-priority concept area
Rendering is an intermediate state. Post-render editor must support non-destructive edit decisions: trim/cut, clip replacement, B-roll, captions/text, audio/music, effects, crop/aspect, scene regeneration, and export versions.

Canonical flow:
Production > Render vN > Edit Project > Edit Decision List > Export vN > Publication.

Regenerating one scene creates/replaces an asset reference and marks dependent exports stale; it does not destroy earlier renders.

## Frontend/backend boundary (future)
Frontend should request capabilities, not providers: plan, clarify, rewrite, draft_voice, generate_scene, render, regenerate_selection, export, publish. Provider routing belongs behind the API.

## Next PM gates
1. Validate planner interaction and decision model.
2. Validate production hierarchy and navigation.
3. Define editor timeline behavior, edit decision types, stale-state propagation and version UX.
4. Validate publication/calendar workflow.
5. Only then map desired actions to existing backend as EXISTS / MODIFY / NEW / RETIRE.

## v0.2 distribution/onboarding addition
One app is distributed from three storefront/download pages: Comedy, Content, Studio/Both. Each issues a different entitlement key; upgrade changes entitlement without reinstalling. First-run onboarding covers license validation, storage (Local/Google Drive/Dropbox), Included LLM vs optional BYO OpenAI/Claude/Grok credentials, and optional social publishing connections. See `DISTRIBUTION_ONBOARDING.md`.

Publishing is intentionally hybrid: Prepare only is a first-class successful state, alongside schedule/publish through connected platform APIs where supported.
