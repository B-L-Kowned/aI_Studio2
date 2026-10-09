# Likeness consent: AI Video Studio × AuthenTech

**Status:** proposal for Pat to approve, 2026-10-08. It was written from the AI
Video Studio side, using what the AuthenTech session reported about the
approved AuthenTech design (`docs/identity-platform/DESIGN.md`, approved
2026-10-08, and "AuthenTech Architecture and Build Prompt v1.1", section
*Agents and clones*). No AuthenTech code is changed by this document.

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

> **Decision 1 (Pat):** keep raw samples studio-side, as the spec says
> (recommended). If AuthenTech should hold them instead, the spec has to
> change first.

## The record (the same shape on both sides from day one)

```json
{
  "id": "…",
  "person": { "name": "Christine Doe", "email": "christine@example.com" },
  "scopes": ["appearance", "voice"],
  "extent": { "kind": "production | series | workspace", "label": "V05-01 — Fixology: who it helps and why" },
  "assets": [
    { "renderer": "local-voice", "id": "voice:42", "kind": "voice" },
    { "renderer": "heygen", "id": "18e7f41f…", "kind": "appearance" }
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

1. **Where raw samples live:** studio/renderer side (recommended; matches the
   spec) or in AuthenTech (needs a spec change).
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
