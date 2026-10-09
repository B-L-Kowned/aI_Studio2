# Likeness consent: AI Video Studio × AuthenTech

**Status:** proposal for Pat to approve, 2026-10-08. It was written from the AI
Video Studio side, using what the AuthenTech session reported about the
approved AuthenTech design (`docs/identity-platform/DESIGN.md`, approved
2026-10-08, and "AuthenTech Architecture and Build Prompt v1.1", section
*Agents and clones*). No AuthenTech code is changed by this document.

## Update 2026-10-08: desktop app, the customer's own accounts

This replaces the "platform account" assumption in the sections below.

- **Customers download the desktop app** from the website. Each one uses **their
  own HeyGen account** (sign-in for a web plan, or their own API key) and picks a
  **monthly limit** for it: $25 / $50 (suggested) / $100 or their own amount.
  The studio records an estimate for every paid render and refuses one that
  would go past the limit (`backend/lib/budget.js`). The first paid render asks
  for the limit at that moment.
- **A local model comes with the app**: Light (llama3.2:3b, 2 GB) handles
  checks and suggestions. Full (qwen2.5-coder:14b, 9 GB) is an optional
  in-app download for whole-script rewrites (Settings → Model routing,
  `backend/lib/model-tier.js`).
- **AuthenTech is optional.** It is only needed to **share a twin** (look,
  voice, personality, wardrobe) with another customer, or to receive one, with
  consent either side can prove and withdraw. Sign-in is offered from the
  header and the Share dialog, never at launch.
- **Desktop sign-in** (`backend/lib/authentech.js`, `routes/account.js`):
  - OAuth code + PKCE S256 with a loopback redirect, and no secret in the app;
  - the refresh token is stored encrypted, the access token in memory only;
  - sign-out revokes the token at AuthenTech.

  This is built and tested against a mock. It switches on when
  `AUTHENTECH_CLIENT_ID` is set.
- **Twin card** `ai-video-studio.twin/1` (`backend/lib/twin-card.js`):
  - holds the personality, delivery, wardrobe and voice references, plus a
    consent slot, and never raw samples;
  - renderer assets are marked `portable: false`, because a HeyGen avatar
    belongs to the account that made it;
  - an import becomes a Content presenter tied to a collaborator, with consent
    "not yet verified" until AuthenTech confirms it.
- **Two ways to share** (Cast → You → Share):
  - **They make videos with it:** the recipient builds the twin in their own
    HeyGen from the source the owner shares, and pays for it there.
  - **They ask, you render:** the owner renders on their own account, within
    their own limit.

  Both choices let the owner pick what is shared (look, voice, personality)
  and for how long.

### Needs sent to the AuthenTech terminal (2026-10-08)

1. A public desktop client: PKCE, loopback redirect on any port (RFC 8252), no
   secret. Assumed paths: `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`.
2. Create account inside the same flow (`prompt=create`), plus a bare
   `/signup` for the website.
3. `GET /api/v1/me` returning `{name, email}`.
4. Scopes `twin:share` and `twin:receive` (renamed; see the answers below).
5. A twin share grant from owner to recipient, by email, carrying:
   - scopes;
   - mode (`source` or `render`);
   - expiry;
   - the asset references.

   Plus three calls: create, list "shared with me", and verify by id.
6. For `source`: an encrypted, expiring hand-off of the source clips, either
   relayed as an opaque blob or through a signed short-lived URL.
7. Revocation the desktop can poll ("events since cursor"), since nothing can
   push to a Mac.
8. A sandbox client id.

### AuthenTech's answers (autht-a4, 2026-10-08)

Nothing on their side exists yet: the OAuth server is WP-6 and `/v1` is WP-7.
The studio client already uses the confirmed paths and scopes.

| # | Answer |
|---|---|
| 1 | Yes: public desktop client, PKCE S256 required, loopback on any port, no secret. Paths: `https://theauthentech.app/api/oauth/authorize`, `/api/oauth/token`, `/api/oauth/revoke`; discovery at `/.well-known/oauth-authorization-server`. |
| 2 | Yes: `prompt=create`. The account page is `/register`. |
| 3 | Not `/me`. `GET /api/v1/profile` returns only the fields the person granted, with a subject id that differs per client. Email comes from `/api/oauth/userinfo` under the `email` scope. |
| 4 | Colon-style scopes: `openid profile email twin:receive`. **Decided: no `twin:share`** (see Pat's decisions below): in v1, client scopes are read-only, so the owner starts a share on AuthenTech's own screens, deep-linked from the studio with the card's references prefilled. |
| 5 | Fits the planned representative asset grant: owner → recipient by email, with scopes, mode `source` or `render`, expiry and asset references, accepted on AuthenTech's consent screen. Planned calls are `GET /api/v1/grants/received` and `POST /api/v1/assertions/verify`. A card should carry an **AuthenTech-signed, short-lived assertion** rather than a bare grant id. **The grant's shape is open (Pat)**, pending Decisions 0 and 1. |
| 6 | **Decided, adopted as proposed:** relaying an encrypted blob would still mean AuthenTech stores biometric data, which Decision 1 rules out. Their proposal: clips move outside AuthenTech (the owner's own expiring link, or the renderer's own sharing), and the grant records each clip's `sha256`, so consent is tied to exactly those files. |
| 7 | Yes: `GET /api/v1/events?after=<cursor>` returns `grant.revoked`, `grant.changed` and similar. Revocation takes effect on the server at once, but a downloaded copy cannot be recalled, and the Share dialog says so. |
| 8 | When WP-6 lands. There is no staging environment, so it will be a dev client on production behind a feature flag, plus a test account. |

### Pat's decisions (2026-10-08): how sharing works

1. **The app runs the share. The owner confirms consent on AuthenTech's
   screen.**
   - The app packages the twin card and source clips, sends them app to app,
     and the recipient rebuilds the twin in their own HeyGen. This works with
     no AuthenTech account.
   - When the owner is signed in, Share deep-links to AuthenTech's
     share-confirm screen, prefilled with the recipient, scopes, mode, expiry
     and the clips' `sha256`.
   - The owner confirms there. AuthenTech returns a `grant_id` and a signed
     assertion to the app's loopback redirect, and the app puts them in the
     card.
   - **There is no app write scope.** A consent given on AuthenTech's own
     screen is what makes AuthenTech worth having: if apps could create grants
     through the API, AuthenTech would only be storing what apps claim.
2. **Source clips go app to app**, outside AuthenTech, with each clip's
   `sha256` bound into the grant.
3. **AuthenTech is optional:** it is the record, the proof and the withdrawal
   channel, never a requirement for sharing.

Still needed from AuthenTech: the share-confirm deep link (its URL format, the
prefill fields or a short-lived prefill handle, and `return_to`),
`grants/received`, `assertions/verify` and `events`.

Studio changes still to make once these exist:
- the Share button deep-links to AuthenTech's share screen;
- an import verifies the card's assertion;
- the app polls `/events` for withdrawals.

## The goal

There should be one standard process for making videos with someone else's
likeness. Each step has a single owner:

1. **Invite.** The studio invites a person by email.
2. **Consent and samples.** On a page of their own, the person consents to
   their appearance and/or voice, for one video, one series or every video,
   with an expiry if they want one. They also provide the samples a clone is
   built from.
3. **Clones.** The studio builds the clones: a voice from the sample, and a
   HeyGen digital twin from the face video.
4. **Record of consent.** AuthenTech keeps the record: who agreed to what,
   until when, and which clones that covers. It is revocable at any time and
   provable for every published video.

## What each system holds (follows the AuthenTech spec)

| | AI Video Studio (and its renderers) | AuthenTech |
|---|---|---|
| Raw samples (voice recording, face video or photos) | **Yes.** Stored with the studio and passed to the renderer that builds the clone. | **No.** Biometric collection is out of scope for v1, per the spec. |
| Clones (local voice id, HeyGen twin/avatar id) | **Yes**, as renderer assets | **References only** (renderer + asset id) |
| Consent: who, scopes, extent, expiry, revocation, signature | A copy for working offline | **The record of truth**, as a revocable grant |
| Proof per published video | Keeps the assertion with the video | Issues and verifies signed assertions |

> Where samples are stored and clones generated is **Decision 0**, below in
> *Storage and generation*. AuthenTech never holds raw samples.

## Storage and generation (decide before Phase 1 ships)

Customers will create in the **web** studio and won't have the desktop app. So
the plan has to settle two questions, not one: where samples are **stored**,
and where clones are **generated**. Today only the owner's own voice is
generated on the owner's Mac (Chatterbox Turbo), and a web customer has no Mac
in the loop. In every option below, **AuthenTech is the record of consent and
permission, and never the store for samples.**

| | **A. Hosted renderer** (HeyGen; ElevenLabs as an alternative for voice) | **B. Web studio stores, renderer generates** | **C. Self-hosted generation** (fleet hardware) |
|---|---|---|---|
| Where the raw sample lives | At the renderer only. The studio passes it straight through and keeps no copy. | Studio backend, encrypted at rest, kept for a set period (e.g. 90 days, or until the clone is built) | Fleet storage, encrypted, kept for a set period |
| Where the clone is generated | At the renderer (HeyGen digital twin; HeyGen or ElevenLabs voice clone) | At the renderer, per job, from the stored original | On fleet GPUs (Chatterbox Turbo for voice; no self-hosted face/avatar model at HeyGen's quality today) |
| What AuthenTech holds | Grant + renderer asset id | Grant + renderer asset id + studio asset id | Grant + fleet asset id |
| Re-cloning, or switching renderer later | Needs a new sample from the person | **Possible from the stored original**, without asking again | Possible |
| Privacy and fewest copies | **Best: one copy, at the renderer** | Two copies (studio + renderer) | One copy, on infrastructure you run |
| Cost | Renderer pricing per clone and per minute | The same as A, plus encrypted storage | GPU hardware and its running costs; voice cheap per minute, but no viable avatar path |
| Operations burden | Lowest | Medium: encryption keys, retention jobs, deletion on revoke | Highest: GPU capacity, queueing, model updates |
| Revocation | Delete at the renderer (its API) + revoke the grant | + delete the stored original | + delete the fleet copy |
| Fits HeyGen's own consent rule (the person reads its statement on camera) | Natively | Yes, the stored clip is the evidence | Doesn't apply to voice; avatar would still need HeyGen |

**Recommendation: A for v1, built so B can follow.** That matches the
AuthenTech session's advice. Concretely:

- **Samples go straight from the person's browser to the renderer**, through a
  short-lived upload link from the studio backend. The studio records only the
  renderer's asset id plus a hash of the sample.
- **Every asset record already has the fields B needs:** `storage: "renderer" |
  "studio"`, `retention_until`, and `sha256`. Moving to B later means turning
  on encrypted storage plus a retention job; the record doesn't change.
- **Voice:** the owner keeps the free local clone on the desktop app.
  Customers on the web use a hosted voice clone (HeyGen or ElevenLabs). The
  studio already routes each video's voice to a provider, so this becomes one
  more provider, not a new pipeline.
- **C is a cost play for voice only, later.** If hosted voice cloning gets
  expensive at volume, run Chatterbox Turbo on a fleet GPU behind the same
  provider interface. No self-hosted option yet makes avatars at HeyGen's
  quality.

> **Decision 0 (Pat): A, B or C for v1.** Recommended: A, with B's fields in
> place. With A or B, also choose the voice renderer for web customers: HeyGen
> voice (one vendor) or ElevenLabs (often better voice clones; a second vendor
> and a second consent).

Whichever is chosen, revocation has three parts, run in order and logged:

1. Revoke the AuthenTech grant.
2. Delete at the renderer.
3. Delete any studio or fleet copy.

Videos already published stay published. Nothing new is made.

## The record (the same shape on both sides from day one)

```json
{
  "id": "…",
  "person": { "name": "Christine Doe", "email": "christine@example.com" },
  "scopes": ["appearance", "voice"],
  "extent": { "kind": "production | series | workspace", "label": "V05-01 — Fixology: who it helps and why" },
  "assets": [
    { "renderer": "heygen", "id": "18e7f41f…", "kind": "appearance",
      "storage": "renderer", "retention_until": null, "sha256": "…" },
    { "renderer": "elevenlabs | heygen | local-voice", "id": "…", "kind": "voice",
      "storage": "renderer", "retention_until": null, "sha256": "…" }
  ],
  "expires_at": null,
  "granted_at": "…",
  "revoked_at": null,
  "signature": { "signed_name": "Christine Doe", "at": "…", "method": "typed | authentech-oauth" }
}
```

This maps one-to-one onto the planned AuthenTech **representative asset
grant**. The studio already keeps every consent exchange in one file
(`backend/lib/consent.js`), so switching that file from the studio's own
consent service to AuthenTech touches nothing else.

## Phases

### Phase 1: studio-side, can ship now (no AuthenTech dependency)

Already built and tested (not yet deployed):

- the Invite dialog;
- the consent service (`consent/`), whose public page lets the person agree or
  decline, choose scopes and extent, sign, and withdraw;
- syncing answers back to Cast → Collaborators.

To add:

1. **Samples on the consent page**, offered after the person agrees:
   - **Voice:** a 15–30 second reading, recorded in the browser, of a short
     prompt the page shows.
   - **Face** (for on-camera consent): a 30–60 second front-facing clip.
   - **HeyGen's own consent statement:** HeyGen requires the person to read
     its consent statement on camera before it will build a digital twin, so
     the page records it as a separate step.
2. **Storage.** The consent service stores samples privately, only as long as
   it takes for the studio to collect them, then deletes its copy.
3. **Clone building in the studio:** a new **Collaborator** entry under Cast →
   Presenters, carrying:
   - their voice, built from the sample with the same local cloning as yours;
   - their look, a HeyGen twin built from the clip;
   - the consent record above.
4. **Enforcement:**
   - A video can only cast a collaborator inside their consent's scopes,
     extent and expiry.
   - Revocation marks their assets "do not use". Takes and renders already
     made are flagged, not deleted.
5. **Deployment** to Prod01 at **consent.bialkowned.com** (Decision 2), with
   Resend sending from **invites@bialkowned.com** (Decision 3). This follows
   the fleet rules: deploy root from the ERP, an announced window, and
   `conformance_audit.py` before calling it live.

### Phase 2: AuthenTech becomes the record (needs WP-5/6/7)

AuthenTech adds the following, all planned but not built:

| Step | AuthenTech |
|---|---|
| The studio registers as a client | `POST /v1/developer/clients` (an "AI Video Studio" client) |
| The invite becomes an AuthenTech consent request | Planned "representative asset grant" in WP-5/6, to be added to the endpoint list |
| The person authorizes | OAuth authorization code + PKCE, on AuthenTech's consent screen, which previews exactly what is shared (scopes, extent, the asset references) |
| Status | `GET /v1/grants/current` with an opaque access token, checked against the grant on every call, so revocation takes effect immediately |
| Revocation | The person revokes with `DELETE /v1/me/grants/{id}`; the studio receives the `grant.revoked` / `representative.revoked` webhooks (HMAC-signed outbox) |
| Proof | `POST /v1/assertions` when a video is exported; `/verify` to check it later. The assertion is stored with the video's post copy and export. |

In the studio:

- `consent.js` calls AuthenTech instead of the studio's consent service.
- The sample-collection page stays studio-side: after AuthenTech's consent
  screen, the person is redirected back to the studio's sample step.
- Webhooks arrive at the consent service on Prod01, the studio's public edge.
  The studio fetches them from there, because AuthenTech cannot reach a Mac.
- The studio's consent service stays as that public edge (sample upload plus
  webhook inbox). It stops being a consent store.

### Phase 3: optional

- **Your own personas** registered as representative profiles in AuthenTech
  (WP-5: persona, approved assets as references, capability policy). Then
  "Pat the Strategist" is a verifiable, revocable identity too.
- **A verify link** in every published video's description: "Made with
  consent — verify", backed by the AuthenTech assertion.

## Decisions for Pat

0. **Storage and generation for web customers:** A (hosted renderer), B (web
   studio stores originals, renderer generates) or C (fleet hardware).
   Recommended: A, with B's fields in place. Also choose the voice renderer
   for web customers: HeyGen voice or ElevenLabs.
1. **Never in AuthenTech:** raw samples stay out of AuthenTech in every option
   (it is the consent record only, per its spec). Confirm.
2. **Consent page address for Phase 1:** consent.bialkowned.com (recommended),
   or wait for AuthenTech and skip Phase 1's page.
3. **Invite email sender:** invites@bialkowned.com. Is bialkowned.com verified
   in Resend?
4. **Ordering:** run Phase 1 now and Phase 2 when WP-5/6/7 land
   (recommended), or hold all collaborator work until AuthenTech is ready.

## Questions for the AuthenTech terminal

1. Can the **representative asset grant** be added to the WP-5/6 endpoint list
   with the record shape above? (Scopes `appearance` and `voice`; extent
   `production | series | workspace` plus a label; assets as `{renderer, id,
   kind}`; optional expiry.)
2. Can the OAuth consent screen carry a `return_to` back to a client page (the
   studio's sample step) after the person approves?
3. Webhook delivery: will it retry, and with what signature header and secret
   rotation? The studio's receiver will be the consent service on Prod01.
4. Assertions: what claims does `POST /v1/assertions` sign, so the studio can
   attach one per export (`grant_id`, `asset ids`, `video id/hash`,
   `issued_at`)?
5. A sandbox or test client for development, before WP-7 is live?
