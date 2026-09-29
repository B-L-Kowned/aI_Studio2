const BASE = import.meta.env.VITE_API_URL ?? '/api';

if (/^https?:\/\//i.test(BASE)) {
  throw new Error(
    `VITE_API_URL must be a relative path, got "${BASE}". An absolute origin pins the bundle to one hostname.`
  );
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`${res.status} ${res.statusText} — response was not JSON`);
  }
  if (!res.ok || body.error) {
    const err = new Error(body.message || `${res.status} ${res.statusText}`);
    err.code = body.error;
    throw err;
  }
  return { data: body.data, message: body.message };
}

const get = (p) => request(p).then((r) => r.data);
const post = (p, body) => request(p, { method: 'POST', body: JSON.stringify(body ?? {}) });
const patch = (p, body) => request(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
const del = (p) => request(p, { method: 'DELETE' });

export const api = {
  health: () => get('/health'),

  // workspace / onboarding
  workspace: () => get('/workspace'),
  submitLicense: (key) => post('/workspace/license', { key }),
  saveStorage: (provider, path) => post('/workspace/storage', { provider, path }),
  testAiKey: (provider, key) => post('/workspace/ai/test', { provider, key }),
  saveAi: (provider, key) => post('/workspace/ai', { provider, key }),
  deleteCredential: (provider) => del(`/workspace/credentials/${provider}`),
  saveCredential: (provider, key) => post('/workspace/credentials', { provider, key }),

  // one connect path for every vendor — planning model, voice or video
  connections: () => get('/connections'),
  connectVendor: (id, key) => post(`/connections/${id}`, { key }),
  recheckVendor: (id) => post(`/connections/${id}/recheck`),
  disconnectVendor: (id) => del(`/connections/${id}`),
  setLlmRouting: (capability, provider) => post('/workspace/llm/routing', { capability, provider }),
  setProviderMode: (mode, confirmBilling) => post('/workspace/provider-mode', { mode, confirmBilling }),
  setConnection: (platform, status) => post('/workspace/connections', { platform, status }),
  completeOnboarding: () => post('/workspace/complete-onboarding'),
  resetOnboarding: () => post('/workspace/reset-onboarding'),
  setMode: (mode) => post('/workspace/mode', { mode }),

  // collections
  people: () => get('/people'),

  // presenters — who appears on screen; the comedy/content gate
  presenters: (includeRetired) => get(`/presenters${includeRetired ? '?includeRetired=true' : ''}`),
  castablePresenters: () => get('/presenters/castable'),
  createPresenter: (body) => post('/presenters', body),
  castPresenter: (id, body) => patch(`/presenters/${id}/casting`, body),
  retirePresenter: (id, active) => post(`/presenters/${id}/retire`, { active }),
  invitePerson: (name, role) => post('/people/invite', { name, role }),
  grantConsent: (id, scope) => post(`/people/${id}/consent`, { scope }),
  revokeConsent: (id) => post(`/people/${id}/revoke`),
  campaigns: () => get('/campaigns'),
  createCampaign: (body) => post('/campaigns', body),
  deleteCampaign: (id) => del(`/campaigns/${id}`),
  library: () => get('/library'),
  deleteAsset: (id) => del(`/library/${id}`),
  calendar: (month, mode) => {
    const q = new URLSearchParams();
    if (month) q.set('month', month);
    if (mode) q.set('mode', mode);
    const s = q.toString();
    return get(`/calendar${s ? `?${s}` : ''}`);
  },
  publishTargets: () => get('/publish-targets'),
  editorTools: () => get('/editor-tools'),
  setup: () => get('/setup'),
  startSources: () => get('/start-sources'),

  // generation providers (HeyGen)
  providers: () => get('/providers'),
  connectProvider: (id, key) => post(`/providers/${id}/connect`, { key }),
  disconnectProvider: (id) => post(`/providers/${id}/disconnect`),
  syncProvider: (id) => post(`/providers/${id}/sync`),
  providerAssets: (id, { kind, q, limit } = {}) => {
    const p = new URLSearchParams();
    if (kind) p.set('kind', kind);
    if (q) p.set('q', q);
    if (limit) p.set('limit', String(limit));
    const qs = p.toString();
    return get(`/providers/${id}/assets${qs ? `?${qs}` : ''}`);
  },
  providerJobs: () => get('/provider-jobs'),

  // training — the content program. Courses are campaigns, lessons are videos.
  trainingCourses: () => get('/training/courses'),
  reorderCourse: (id, productionIds) => post(`/training/courses/${id}/order`, { productionIds }),
  setLessonCourse: (id, courseId) => post(`/training/lessons/${id}/course`, { courseId }),

  // analysing a video you already have — all measured locally with ffmpeg
  analysis: (id) => get(`/productions/${id}/analysis`),
  analyseVideo: (id, file) => post(`/productions/${id}/analysis`, { file }),
  adoptAnalysisOutline: (id) => post(`/productions/${id}/analysis/adopt-outline`),

  // series planning — many productions at once, in a deliberate order
  seriesMeta: () => get('/series'),
  previewSeries: (body) => post('/series/preview', body),
  createSeries: (body) => post('/series', body),

  playLibraryItem: (assetId) => get(`/heygen/library/${assetId}/play`),

  // companies and their tracks — who the work is for, and who it talks to
  companies: (includeRetired) => get(`/companies${includeRetired ? '?includeRetired=true' : ''}`),
  addCompany: (body) => post('/companies', body),
  updateCompany: (id, body) => patch(`/companies/${id}`, body),
  retireCompany: (id, active) => post(`/companies/${id}/retire`, { active }),
  setTrack: (campaignId, body) => patch(`/campaigns/${campaignId}/track`, body),

  // the parking lot — ideas, before they are productions
  ideas: (includeArchived) => get(`/ideas${includeArchived ? '?includeArchived=true' : ''}`),
  addIdea: (body) => post('/ideas', body),
  updateIdea: (id, body) => patch(`/ideas/${id}`, body),
  deleteIdea: (id) => del(`/ideas/${id}`),
  markIdeaPromoted: (id, productionId) => post(`/ideas/${id}/promoted`, { productionId }),

  // the production schedule — what is blocked on you, and what is due
  // `mode` scopes the schedule to one program. It is built here rather than by
  // the caller so the counts and the lists can never be fetched with different
  // scopes and disagree on screen.
  schedule: (weekStart, mode) => {
    const q = new URLSearchParams();
    if (weekStart) q.set('weekStart', weekStart);
    if (mode) q.set('mode', mode);
    const s = q.toString();
    return get(`/schedule${s ? `?${s}` : ''}`);
  },
  setDueDate: (id, dueAt) => post(`/productions/${id}/due`, { dueAt }),

  // segments — the unit of script, take, presenter, shot, quality and render
  segments: (id) => get(`/productions/${id}/segments`),
  buildSegments: (id) => post(`/productions/${id}/segments/build`),
  updateSegment: (id, segmentId, body) => patch(`/productions/${id}/segments/${segmentId}`, body),
  auditionAll: (id) => post(`/productions/${id}/segments/audition-all`),
  auditionSegment: (id, segmentId, body) => post(`/productions/${id}/segments/${segmentId}/audition`, body ?? {}),
  markHeard: (id, segmentId, takeId, heard) =>
    post(`/productions/${id}/segments/${segmentId}/heard`, { takeId, heard }),
  renderSegment: (id, segmentId, confirmPaid) =>
    post(`/productions/${id}/segments/${segmentId}/render`, { confirmPaid }),

  // the real HeyGen account, over MCP
  heygenStatus: () => get('/heygen/status'),
  heygenConnect: () => post('/heygen/connect', {}),
  heygenDisconnect: () => del('/heygen'),
  heygenVideos: (limit) => get(`/heygen/videos${limit ? `?limit=${limit}` : ''}`),
  heygenAccount: () => get('/heygen/account'),
  heygenTools: () => get('/heygen/tools'),
  importHeygenVideo: (id) => post(`/heygen/videos/${id}/import`, {}),
  providerJob: (jobId) => get(`/provider-jobs/${jobId}`),

  // production / planning
  currentProduction: () => get('/productions/current'),
  listProductions: () => get('/productions'),
  createProduction: (body) => post('/productions', body),
  openProduction: (id) => post(`/productions/${id}/open`),
  updateProduction: (id, body) => patch(`/productions/${id}`, body),
  deleteProduction: (id) => del(`/productions/${id}`),
  producer: (id) => get(`/productions/${id}/producer`),
  updateBrief: (id, fieldId, value) => patch(`/productions/${id}/brief/${fieldId}`, { value }),
  addSection: (id, body) => post(`/productions/${id}/outline`, body),
  updateSection: (id, sectionId, body) => patch(`/productions/${id}/outline/${sectionId}`, body),
  deleteSection: (id, sectionId) => del(`/productions/${id}/outline/${sectionId}`),
  rebalance: (id) => post(`/productions/${id}/outline/rebalance`),
  approveOutline: (id) => post(`/productions/${id}/outline/approve`),
  developScenes: (id) => post(`/productions/${id}/scenes/develop`),
  addScene: (id, body) => post(`/productions/${id}/scenes`, body),
  updateScene: (id, sceneId, body) => patch(`/productions/${id}/scenes/${sceneId}`, body),
  deleteScene: (id, sceneId) => del(`/productions/${id}/scenes/${sceneId}`),
  approveScenes: (id) => post(`/productions/${id}/scenes/approve`),
  resolveDecision: (id, decisionId, resolution) =>
    post(`/productions/${id}/decisions/${decisionId}/resolve`, { resolution }),
  addSource: (id, body) => post(`/productions/${id}/sources`, body),

  // pipeline
  script: (id) => get(`/productions/${id}/script`),
  generateScript: (id) => post(`/productions/${id}/script/generate`),
  acceptScript: (id, versionId) => post(`/productions/${id}/script/${versionId}/accept`),
  rejectScript: (id, versionId) => post(`/productions/${id}/script/${versionId}/reject`),
  render: (id) => get(`/productions/${id}/render`),
  startRender: (id, confirmPaid) => post(`/productions/${id}/render`, { confirmPaid }),
  cancelRender: (id, renderId) => post(`/productions/${id}/render/${renderId}/cancel`),
  applyEdit: (id, renderId, body) => post(`/productions/${id}/render/${renderId}/edit`, body),
  createExport: (id) => post(`/productions/${id}/export`),
  publications: (id) => get(`/productions/${id}/publications`),
  // Channel names may contain spaces ("Artificial Funny"), so the segment is encoded.
  publish: (id, platform, mode) =>
    post(`/productions/${id}/publications/${encodeURIComponent(platform)}`, { mode }),
};
