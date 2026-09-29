# Distribution & Onboarding Contract v0.2

## Distribution: one binary, three storefront pages
There is ONE application build. The three product websites/pages sell entitlements, not separate applications.

- Comedy page -> issues Comedy license key
- Content page -> issues Content license key
- Studio/Both page -> issues Both license key

All three download the same installer/application. License validation sets `entitlement_mode = comedy | content | both`. Upgrade changes entitlement only; no reinstall and no project migration.

Recommended purchase handoff: purchase -> account/license created -> download app -> first run -> enter/sign in to retrieve license -> validate -> onboarding.

## First-run onboarding
1. Validate/retrieve license and show unlocked mode(s).
2. Storage choice: Local, Google Drive, Dropbox. Store project/media root as a storage provider abstraction. Allow changing/migrating later; never silently move files.
3. AI choice: Included internal LLM by default. Optional BYO provider credentials for OpenAI, Anthropic/Claude, and xAI/Grok. Credentials must be encrypted and scoped to the workspace/user. Test before saving. Provider choice can later be set by capability (planning, script, draft, etc.).
4. Optional publishing connections: YouTube, LinkedIn, TikTok, Instagram, Facebook, X. User may skip all of them.
5. Finish -> Command Center.

## Storage contract
Frontend asks for a location/provider, not filesystem implementation details. Canonical interface should support: list/read/write/delete/copy/move plus asset URI resolution. Local path stays local. Cloud OAuth/token storage belongs behind the API/security boundary.

## Publishing philosophy
Publishing does NOT need to be fully automatic. Each platform supports a mode:
- Prepare only: generate correct export + title/caption/description/hashtags/thumbnail package.
- Schedule via connection (where supported).
- Publish now via connection (where supported).

A failed/unavailable API must degrade gracefully to Prepare only, never block export.

## Product flow after onboarding
Idea -> AI Producer planning/clarification -> accepted plan -> script -> scenes/segments -> voice/visuals -> draft/preview -> final render -> post-render edit -> export -> platform preparation/publish.

Planning and editing remain the highest-priority UX gates before backend binding.
