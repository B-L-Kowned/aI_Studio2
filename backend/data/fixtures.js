// Deterministic dry-run fixtures. No paid provider is ever contacted.

export const campaigns = [
  { name: 'AI Education', description: 'Multiple projects · series and one-offs', mode: 'content', position: 0 },
  { name: 'Artificial Funny', description: 'Multiple projects · series and one-offs', mode: 'comedy', position: 1 },
  { name: 'Product Launches', description: 'Multiple projects · series and one-offs', mode: 'both', position: 2 },
];

export const production = {
  campaign: 'AI Education',
  slug: 'ai-is-getting-too-complicated',
  title: 'AI Is Getting Too Complicated',
  breadcrumb: 'AI Education › AI for Operators › Season 1 › Episode 14',
  subtitle: '20-minute podcast · Pat — Podcast template',
  target_runtime: '20:00',
  mode: 'content',
  brief: [
    ['Template', 'Pat — 20 Minute Podcast'],
    ['Type', 'Episode / Series'],
    ['Target runtime', '20:00'],
    ['Audience', 'Business operators'],
    ['Goal', 'Explain + provoke discussion'],
    ['Format', 'Podcast / Interview'],
    ['Primary output', '16:9 master'],
    ['Clip extraction', '3–5 shorts'],
  ],
  outline: [
    { title: 'Cold Open', runtime: '0:45', participants: 'Pat', purpose: '' },
    { title: 'Introduce Guest', runtime: '1:15', participants: 'Pat + Guest', purpose: '' },
    { title: 'Why AI Got Complicated', runtime: '4:00', participants: 'Pat ↔ Guest', purpose: '' },
    { title: 'Guest Experience', runtime: '4:00', participants: 'Guest', purpose: '' },
    {
      title: 'Agents vs Automation',
      runtime: '5:00',
      participants: 'Pat ↔ Guest',
      purpose:
        'Where agents help, where automation is enough, and where complexity becomes the problem.',
    },
    { title: 'Practical Takeaways', runtime: '4:00', participants: 'Pat + Guest', purpose: '' },
    { title: 'Outro', runtime: '1:00', participants: 'Pat', purpose: '' },
  ],
  // Scenes hang off outline section 5 (index 4), matching the prototype.
  scenes: [
    { outlineIndex: 4, ref: '5.1', title: 'Host establishes problem', participants: 'Pat', runtime: '0:30' },
    { outlineIndex: 4, ref: '5.2', title: 'Guest reacts / gives example', participants: 'Christine', runtime: '1:00' },
    { outlineIndex: 4, ref: '5.3', title: 'Two-person discussion', participants: 'Pat + Christine', runtime: '1:45' },
    { outlineIndex: 4, ref: '5.4', title: 'Diagram / B-roll', participants: 'Voiceover', runtime: '0:45' },
    { outlineIndex: 4, ref: '5.5', title: 'Takeaway and transition', participants: 'Pat + Christine', runtime: '1:00' },
  ],
  decisions: [
    { kind: 'warning', text: 'Guest: Christine or John?' },
    { kind: 'warning', text: 'Show actual product demo or B-roll?' },
    { kind: 'warning', text: 'CTA: subscribe or visit website?' },
    { kind: 'ok', text: 'Background selection' },
    { kind: 'ok', text: 'Caption style' },
    { kind: 'ok', text: 'Transition style' },
    { kind: 'ok', text: 'Music treatment' },
    { kind: 'locked', text: 'Business-operator audience' },
    { kind: 'locked', text: '20-minute target' },
    { kind: 'locked', text: 'Podcast format' },
    { kind: 'locked', text: 'Pat as host' },
  ],
  sources: [
    { name: 'original_interview.mov', detail: '18:42 · Transcribed · 7 topics detected', kind: 'video' },
  ],
};

export const people = [
  { name: 'Pat', role: 'Owner · Host', representation: 'Avatar + Voice', consent_scope: 'Workspace', status: 'approved', position: 0 },
  { name: 'Christine', role: 'Guest', representation: 'Avatar + Voice', consent_scope: 'This series', status: 'approved', position: 1 },
  { name: 'John', role: 'Guest', representation: 'Invitation sent', consent_scope: 'Pending', status: 'pending', position: 2 },
];

export const assets = [
  { name: 'Pat Podcast Template', kind: 'template', position: 0 },
  { name: 'Pat Avatar', kind: 'avatar', position: 1 },
  { name: 'Christine Avatar', kind: 'avatar', position: 2 },
  { name: 'Podcast Studio', kind: 'background', position: 3 },
  { name: 'Interview Source', kind: 'footage', position: 4 },
  { name: 'Render v3', kind: 'render', position: 5 },
];

export const calendarEntries = [
  { day: 4, title: 'AI Operators', status: 'Prepared' },
  { day: 9, title: 'AI Operators', status: 'Prepared' },
  { day: 13, title: 'AI Operators', status: 'Prepared' },
  { day: 18, title: 'AI Operators', status: 'Prepared' },
  { day: 23, title: 'AI Operators', status: 'Prepared' },
];

// An owned channel is a destination Bialkowned controls, so publishing is a
// direct push to the site rather than a third-party social API. It is listed
// first because it is the only one that never depends on someone else's uptime.
export const publishChannels = [
  // `direct`: the studio can post there itself. The others get a complete upload
  // package (video, captions, title, description) to post yourself; a Connect
  // button for them would claim a connection nothing behind it makes.
  { platform: 'Artificial Funny', domain: 'artificialfunny.com', kind: 'owned', direct: true,
    detail: 'Owned site · direct publish via site API' },
  { platform: 'YouTube',   kind: 'social', detail: 'Long-form and Shorts' },
  { platform: 'LinkedIn',  kind: 'social', detail: 'Native video post' },
  { platform: 'TikTok',    kind: 'social', detail: 'Vertical short-form' },
  { platform: 'Instagram', kind: 'social', detail: 'Reels and feed video' },
  { platform: 'Facebook',  kind: 'social', detail: 'Page video post' },
  { platform: 'X',         kind: 'social', detail: 'Native video post' },
];

export const publishTargets = publishChannels.map((c) => c.platform);

export const editorTools = [
  'Trim / Cut', 'Replace Clip', 'Regenerate Scene', 'Add B-roll',
  'Captions / Text', 'Audio Cleanup', 'Music', 'Reframe / Crop',
  'Remove Filler', 'Remove Silence', 'Insert Participant', 'Create Short Clip',
];

// What each route actually DOES, in its own words.
//
// Five of these six carried one identical sentence — "Use the same planning
// pipeline regardless of starting point" — which is true of all of them and
// therefore tells you nothing about any of them. A card that cannot say what
// makes it different from the card beside it is a card nobody can choose.
//
// `available: false` is not a tease. It is the honest state of a route that is
// offered by the licence but not yet built, and it is better said on the card
// than discovered after filling in a form.
export const startSources = [
  { icon: 'Sparkles', title: 'An Idea',
    body: 'Start from nothing. You write the brief and the outline; the Producer fills the gaps.' },
  { icon: 'FileText', title: 'A Template',
    body: 'Start from a shape that works — brief, outline and runtime already allocated.' },
  { icon: 'Video', title: 'Existing Video',
    body: 'Measure footage you already have: resolution, shot changes, silence and loudness. The shot structure becomes your outline.',
    capability: 'source.existing_video' },
  { icon: 'FileText', title: 'Existing Script',
    body: 'Paste a script you already wrote. Speakers are detected and it lands as an accepted version, ready to cast.' },
  { icon: 'FolderKanban', title: 'Existing Project',
    body: 'Copy the plan from another production — brief, outline and scenes. The work is not copied, only the plan.' },
  { icon: 'Link', title: 'Source / URL',
    body: 'Research a website, preserve the evidence and propose brief fields for your approval.' },
];

export const setupCards = [
  { title: 'License', icon: 'KeyRound', body: 'Validate key · upgrade without reinstall', step: 'license' },
  { title: 'Storage', icon: 'HardDrive', body: 'Local · Google Drive · Dropbox', step: 'storage' },
  { title: 'Planning AI', icon: 'Sparkles', body: 'Built-in deterministic · local Ollama · cloud keys', step: 'ai' },
  { title: 'Generation', icon: 'Video', body: 'Provider abstraction · HeyGen connection · Dry Run default', step: 'generation' },
  { title: 'Publishing', icon: 'Share2', body: 'YouTube · LinkedIn · TikTok · Instagram · Facebook · X', step: 'publishing' },
  { title: 'Safety / Cost', icon: 'Lock', body: 'Preview first · explicit paid render confirmation · usage ledger', step: 'safety' },
];

// Presenters. The comedy/content split is who appears on screen.
// Nothing here carries artwork. Three characters used to point at PNG files
// that were never drawn, so their tile rendered as a big empty letter. The
// tile now falls back to the name, which is what the other 171 already do.
export const presenters = [
  // ── Characters (comedy) — invented ────────────────────────────────────────
  { kind: 'character', name: 'Marv the Consultant',
    description: 'Overconfident middle manager. Explains things nobody asked about.' },
  { kind: 'character', name: 'Dr. Prakash Nope',
    description: 'Academic who has read the paper and hated it.' },
  { kind: 'character', name: 'Tina from Procurement',
    description: 'Has a form for that. Has always had a form for that.' },

  // ── Presenters (content) — stock roster, NO artwork, typographic tiles ────
  { kind: 'avatar', name: 'Daniel — Business Casual',
    description: 'Neutral delivery, desk framing. Good default for explainers.' },
  { kind: 'avatar', name: 'Amara — Studio',
    description: 'Warm delivery, studio background. Suits long-form.' },
  { kind: 'avatar', name: 'Kenji — Standing',
    description: 'Standing presenter, full body. Suits demos and walkthroughs.' },

  // ── You — every plan, NO artwork ─────────────────────────────────────────
  { kind: 'personal', name: 'Pat (your likeness)',
    description: 'Built from your own footage. Available on every plan.' },
];
