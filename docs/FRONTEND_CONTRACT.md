# Frontend contract (backend-agnostic)

Core objects: Workspace, Entitlement, CredentialRef, StorageProvider, **Company**,
Campaign (a *track*: purpose + audience), Production, Template, Brief, OutlineSection,
Scene, Participant, Person, CollaborationInvite, ConsentGrant, Source, ScriptVersion,
Segment, **Take**, **Idea**, **Presenter** (with persona), Asset, Job, RenderVersion,
EditDecision, Export, Publication.

> **Reconciled 2026-09-28 against the code.** `Project`, `Series` and `EditProject`
> were listed here and have no table — a series is a campaign with ordered
> productions. `Company`, `Take`, `Idea` and `Presenter` exist and were missing.
> Canonical source: `frontend/docs/ARCHITECTURE.md`.

Critical actions:
- createProduction(sourceType, templateId?)
- producerAssess(productionId) -> known[], inferred[], decisionsNeeded[], proposals[]
- updateBrief / applyTemplate / saveTemplate
- create/update/reorderOutlineSection; rebalanceRuntime; approveOutline
- developScenes; create/update/reorderScene; assignParticipant; approveScenes
- inviteCollaborator; submitAvatarVoice; grant/revokeConsent; requestPublicationApproval
- ingestSource; analyzeExistingVideo
- generateScriptProposal; accept/reject/revise proposal
- requestCapability(capability, quality=draft|preview|final, provider=auto|explicit)
- createJob/cancelJob/retryJob
- createRenderVersion; createEditProject; applyEditDecision; exportVersion
- preparePublication; schedulePublication; publishPublication

State rule: upstream edits never silently overwrite downstream work. Mark dependent artifacts stale and let user choose regenerate/reconcile.
