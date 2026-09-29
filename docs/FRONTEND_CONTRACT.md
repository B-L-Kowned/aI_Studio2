# Frontend contract (backend-agnostic)

Core objects: Workspace, Entitlement, CredentialRef, StorageProvider, Campaign, Project, Series, Production, Template, Brief, OutlineSection, Scene, Participant, Person, CollaborationInvite, ConsentGrant, Source, ScriptVersion, Segment, Asset, Job, RenderVersion, EditProject, EditDecision, Export, Publication.

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
