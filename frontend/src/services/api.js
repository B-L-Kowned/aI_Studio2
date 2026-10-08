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

/**
 * Send a file as the raw request body, reporting progress (fetch cannot).
 * Resolves to the same { data, message } shape as every other call.
 */
function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}${path}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body;
      try { body = JSON.parse(xhr.responseText); } catch { return reject(new Error(`${xhr.status} — response was not JSON`)); }
      if (xhr.status >= 400 || body.error) {
        const err = new Error(body.message || `Upload failed (${xhr.status})`); err.code = body.error; return reject(err);
      }
      resolve({ data: body.data, message: body.message });
    };
    xhr.onerror = () => reject(new Error('The upload was interrupted.'));
    xhr.send(file);
  });
}

export const api = {
  health: () => get('/health'),

  // workspace / onboarding
  workspace: () => get('/workspace'),
  submitLicense: (key) => post('/workspace/license', { key }),
  saveStorage: (provider, path) => post('/workspace/storage', { provider, path }),
  testAiKey: (provider, key) => post('/workspace/ai/test', { provider, key }),
  saveAi: (provider, key) => post('/workspace/ai', { provider, key }),

  // one connect path for every vendor — planning model, voice or video
  connections: () => get('/connections'),
  connectVendor: (id, key) => post(`/connections/${id}`, { key }),
  recheckVendor: (id) => post(`/connections/${id}/recheck`),
  disconnectVendor: (id) => del(`/connections/${id}`),
  setLlmRouting: (capability, provider) => post('/workspace/llm/routing', { capability, provider }),
  llmStatus: () => get('/workspace/llm/status'),
  setProviderMode: (mode, confirmBilling) => post('/workspace/provider-mode', { mode, confirmBilling }),
  setConnection: (platform, status) => post('/workspace/connections', { platform, status }),
  completeOnboarding: () => post('/workspace/complete-onboarding'),
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
  removePerson: (id) => del(`/people/${id}`),
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
  // Local, free, and not the shipping voice — see lib/readthrough.js.
  readThrough: (id) => post(`/productions/${id}/readthrough`, {}),
  updateSegment: (id, segmentId, body) => patch(`/productions/${id}/segments/${segmentId}`, body),
  // `limit` is the line count the user confirmed; the server charges no more than that.
  auditionAll: (id, { confirmPaid = false, limit } = {}) =>
    post(`/productions/${id}/segments/audition-all`, { confirmPaid, limit }),
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
  importHeygenVideo: (id) => post(`/heygen/videos/${id}/import`, {}),

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
  deleteScene: (id, sceneId) => del(`/productions/${id}/scenes/${sceneId}`),
  approveScenes: (id) => post(`/productions/${id}/scenes/approve`),
  resolveDecision: (id, decisionId, resolution) =>
    post(`/productions/${id}/decisions/${decisionId}/resolve`, { resolution }),
  addSource: (id, body) => post(`/productions/${id}/sources`, body),

  // The approval chain shared by Plan and Render. Website research and
  // appearance proofs are durable records, not transient modal state.
  workflow: (id) => get(`/productions/${id}/workflow`),
  researchWebsite: (id, url) => post(`/productions/${id}/research`, { url }),
  deleteResearch: (id, researchId) => del(`/productions/${id}/research/${researchId}`),
  reviewResearch: (id, researchId, applyBrief = true) =>
    post(`/productions/${id}/research/${researchId}/review`, { applyBrief }),
  createAppearance: (id, body) => post(`/productions/${id}/appearance`, body),
  updateAppearance: (id, proofId, body) => patch(`/productions/${id}/appearance/${proofId}`, body),
  appearanceOptions: (id) => get(`/productions/${id}/appearance/options`),
  scriptTiming: (id) => get(`/productions/${id}/script-timing`),
  visuals: (id) => get(`/productions/${id}/visuals`),
  updateVisual: (id, rowId, body) => patch(`/productions/${id}/visuals/${rowId}`, body),
  approveVisuals: (id) => post(`/productions/${id}/visuals/approve`),
  uploadFinishedVideo: (id, file, onProgress) => uploadFile(`/productions/${id}/media/final`, file, onProgress),
  uploadRecording: (id, sceneId, file, onProgress) => uploadFile(`/productions/${id}/media/recording/${sceneId}`, file, onProgress),
  transcription: (id) => get(`/productions/${id}/transcription`),
  retranscribe: (id) => post(`/productions/${id}/transcription`),
  setVoiceSpeed: (id, speed) => patch(`/productions/${id}/voice-speed`, { speed }),
  keepScript: (id, versionId) => post(`/productions/${id}/script/${versionId}/keep`),
  listenAll: (id, versionId) => post(`/productions/${id}/script/${versionId}/listen-all`),
  fullRead: (id, versionId) => get(`/productions/${id}/script/${versionId}/listen-all`),
  // For an editor (CapCut, Descript): approved audio and the script as text and subtitles.
  editorKit: (id) => get(`/productions/${id}/editor-kit`),
  editorKitUrl: (id, file) => `${BASE}/productions/${id}/editor-kit/${file}`,
  saveEditorKit: (id) => post(`/productions/${id}/editor-kit/folder`),
  revealEditorKit: (id) => post(`/productions/${id}/editor-kit/reveal`),
  steps: (id) => get(`/productions/${id}/steps`),
  // Finishing it in the app: clean-up, settings, preview, export.
  editState: (id) => get(`/productions/${id}/edit`),
  saveEditSettings: (id, body) => request(`/productions/${id}/edit/settings`, { method: 'PUT', body: JSON.stringify(body) }),
  analyzeTakes: (id, takeIds) => post(`/productions/${id}/edit/analyze`, takeIds ? { takeIds } : {}),
  toggleCut: (id, takeId, index, on) => patch(`/productions/${id}/line-takes/${takeId}/cuts/${index}`, { on }),
  previewEdit: (id) => post(`/productions/${id}/edit/preview`),
  exportEdit: (id) => post(`/productions/${id}/edit/export`),
  useRender: (id) => post(`/productions/${id}/edit/use-render`),
  musicTracks: () => get('/music'),
  uploadMusic: (file, onProgress) => uploadFile('/music', file, onProgress),
  // Recording it yourself: a take per line, or a whole recording split into lines.
  lineTakes: (id) => get(`/productions/${id}/line-takes`),
  uploadLineTake: (id, segmentId, file, onProgress, source = 'teleprompter') =>
    uploadFile(`/productions/${id}/line-takes/line/${segmentId}?source=${source}`, file, onProgress),
  updateLineTake: (id, takeId, body) => patch(`/productions/${id}/line-takes/${takeId}`, body),
  discardLineTake: (id, takeId) => del(`/productions/${id}/line-takes/${takeId}`),
  splitRecording: (id, file, onProgress) => uploadFile(`/productions/${id}/line-takes/split`, file, onProgress),
  listenLine: (id, versionId, lineId) => post(`/productions/${id}/script/${versionId}/listen/${lineId}`),
  warmScript: (id, versionId) => post(`/productions/${id}/script/${versionId}/warm`),
  saveAppearanceDefault: (scope, body) => request(`/appearance-defaults/${encodeURIComponent(scope)}`, { method: 'PUT', body: JSON.stringify(body) }),
  applyAppearanceDefault: (scope) => post(`/appearance-defaults/${encodeURIComponent(scope)}/apply`),
  productionLock: (id) => get(`/productions/${id}/lock`),

  // pipeline
  script: (id) => get(`/productions/${id}/script`),
  generateScript: (id) => post(`/productions/${id}/script/generate`),
  updateScriptSegment: (id, versionId, segmentId, body) =>
    patch(`/productions/${id}/script/${versionId}/segments/${segmentId}`, body),
  acceptScript: (id, versionId) => post(`/productions/${id}/script/${versionId}/accept`),
  rejectScript: (id, versionId) => post(`/productions/${id}/script/${versionId}/reject`),
  render: (id) => get(`/productions/${id}/render`),
  startRender: (id, confirmPaid, opts = {}) => post(`/productions/${id}/render`, { confirmPaid, ...opts }),
  cancelRender: (id, renderId) => post(`/productions/${id}/render/${renderId}/cancel`),
  applyEdit: (id, renderId, body) => post(`/productions/${id}/render/${renderId}/edit`, body),
  createExport: (id) => post(`/productions/${id}/export`),
  publications: (id) => get(`/productions/${id}/publications`),
  // Channel names may contain spaces ("Artificial Funny"), so the segment is encoded.
  publish: (id, platform, mode) =>
    post(`/productions/${id}/publications/${encodeURIComponent(platform)}`, { mode }),

  // Your own voice, synthesised on this machine (voice/server.py).
  register: () => get('/register'),
  review: (sort = 'release') => get(`/review?sort=${sort}`),
  manager: () => get('/manager'),
  setDeadlines: (body) => request('/manager/deadlines', { method: 'PUT', body: JSON.stringify(body) }),
  reopenScript: (productionId, versionId) => post('/review/reopen', { productionId, versionId }),
  checkToNote: (productionId, lineId) => post('/review/note', { productionId, lineId }),
  voiceBatch: () => get('/voice-batch'),
  queueVoice: (productionIds) => post('/voice-batch', { productionIds }),
  // line fixing — hear a line word by word, fix just the sentence that is wrong
  takeWords: (takeId) => get(`/takes/${takeId}/words`),
  cacheWords: (key, lineId) => get(`/listen-cache/${key}/words?line=${lineId}`),
  lineFix: (segmentId) => get(`/line-fix/${segmentId}`),
  startLineFix: (segmentId, body) => post(`/line-fix/${segmentId}`, body),
  applyLineFix: (segmentId, n) => post(`/line-fix/${segmentId}/apply`, { n }),
  revertLineFix: (segmentId) => post(`/line-fix/${segmentId}/revert`),
  discardLineFix: (segmentId) => del(`/line-fix/${segmentId}`),
  pronunciationUses: (term, except) => get(`/pronunciation-uses?term=${encodeURIComponent(term)}&except=${except ?? ''}`),
  remakePronunciationUses: (term, except) => post('/pronunciation-uses/remake', { term, except }),
  stopVoiceBatch: () => post('/voice-batch/cancel'),
  localVoices: () => get('/voices/local'),
  // The recording goes up as the raw body — it would never fit the JSON limit.
  createLocalVoice: (name, file, { exaggeration, cfgWeight } = {}) => {
    const q = new URLSearchParams({ name });
    if (exaggeration != null) q.set('exaggeration', exaggeration);
    if (cfgWeight != null) q.set('cfgWeight', cfgWeight);
    return request(`/voices/local?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
  },
  updateLocalVoice: (id, changes) => patch(`/voices/local/${id}`, changes),
  sampleLocalVoice: (id, text) => post(`/voices/local/${id}/sample`, { text }),
  pronunciations: () => get('/pronunciations'),
  savePronunciation: (p) => post('/pronunciations', p),
  deletePronunciation: (id) => del(`/pronunciations/${id}`),
  hearPronunciation: (id, voiceId) => post(`/pronunciations/${id}/hear`, { voiceId }),
  pronunciationsReady: (voiceId) => get(`/pronunciations/ready${voiceId ? `?voiceId=${voiceId}` : ''}`),
  warmPronunciations: (voiceId) => post('/pronunciations/warm', { voiceId }),
};
