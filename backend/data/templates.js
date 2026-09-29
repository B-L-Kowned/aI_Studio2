// A template is a production recipe: it pre-populates Brief and Outline
// defaults. Editing a production never writes back to its template unless the
// user explicitly saves it as one.

export const TEMPLATES = [
  {
    id: 'pat-podcast-20',
    purpose: 'promotion',
    name: 'Pat — 20 Minute Podcast',
    mode: 'content',
    runtime: '20:00',
    format: 'Podcast / Interview',
    brief: [
      ['Type', 'Episode / Series'],
      ['Audience', 'Business operators'],
      ['Goal', 'Explain + provoke discussion'],
      ['Format', 'Podcast / Interview'],
      ['Primary output', '16:9 master'],
      ['Clip extraction', '3–5 shorts'],
    ],
    outline: [
      ['Cold Open', '0:45', 'Host'],
      ['Introduce Guest', '1:15', 'Host + Guest'],
      ['Main Topic', '6:00', 'Host ↔ Guest'],
      ['Guest Experience', '5:00', 'Guest'],
      ['Practical Takeaways', '5:00', 'Host + Guest'],
      ['Outro', '2:00', 'Host'],
    ],
  },
  {
    id: 'interview-2p',
    purpose: 'promotion',
    name: 'Two-Person Interview',
    mode: 'content',
    runtime: '30:00',
    format: 'Interview',
    brief: [
      ['Type', 'One-off'],
      ['Audience', 'General'],
      ['Goal', 'Draw out the guest'],
      ['Format', 'Interview'],
      ['Primary output', '16:9 master'],
      ['Clip extraction', '5 shorts'],
    ],
    outline: [
      ['Intro & framing', '2:00', 'Host'],
      ['Background', '7:00', 'Host ↔ Guest'],
      ['Core discussion', '12:00', 'Host ↔ Guest'],
      ['Rapid questions', '6:00', 'Host ↔ Guest'],
      ['Close', '3:00', 'Host'],
    ],
  },
  {
    id: 'explainer-short',
    purpose: 'promotion',
    name: 'Explainer Short',
    mode: 'content',
    runtime: '3:00',
    format: 'Explainer',
    brief: [
      ['Type', 'One-off'],
      ['Audience', 'Prospects'],
      ['Goal', 'Explain one idea clearly'],
      ['Format', 'Explainer'],
      ['Primary output', '9:16 vertical'],
      ['Clip extraction', 'None'],
    ],
    outline: [
      ['Hook', '0:15', 'Narrator'],
      ['The problem', '0:45', 'Narrator'],
      ['The explanation', '1:15', 'Narrator'],
      ['Takeaway + CTA', '0:45', 'Narrator'],
    ],
  },
  {
    id: 'sketch-3p',
    purpose: 'promotion',
    name: 'Three-Hander Sketch',
    mode: 'comedy',
    runtime: '4:00',
    format: 'Sketch',
    brief: [
      ['Type', 'One-off'],
      ['Audience', 'Comedy audience'],
      ['Goal', 'Land one premise hard'],
      ['Format', 'Sketch'],
      ['Primary output', '16:9 master'],
      ['Clip extraction', '2 shorts'],
    ],
    outline: [
      ['Premise established', '0:45', 'A + B'],
      ['Escalation', '1:30', 'A + B + C'],
      ['Turn', '1:00', 'A + B + C'],
      ['Button', '0:45', 'C'],
    ],
  },
  {
    id: 'standup-set',
    purpose: 'promotion',
    name: 'Stand-up Set',
    mode: 'comedy',
    runtime: '10:00',
    format: 'Stand-up',
    brief: [
      ['Type', 'One-off'],
      ['Audience', 'Club audience'],
      ['Goal', 'Tight ten'],
      ['Format', 'Stand-up'],
      ['Primary output', '16:9 master'],
      ['Clip extraction', '3–5 shorts'],
    ],
    outline: [
      ['Opener', '1:30', 'Performer'],
      ['Bit one', '3:00', 'Performer'],
      ['Bit two', '3:00', 'Performer'],
      ['Closer + tag', '2:30', 'Performer'],
    ],
  },
  {
    id: 'bit-short',
    purpose: 'promotion',
    name: 'Short Bit / Cold Open',
    mode: 'comedy',
    runtime: '1:30',
    format: 'Bit',
    brief: [
      ['Type', 'One-off'],
      ['Audience', 'Social'],
      ['Goal', 'One joke, fast'],
      ['Format', 'Bit'],
      ['Primary output', '9:16 vertical'],
      ['Clip extraction', 'None'],
    ],
    outline: [
      ['Setup', '0:30', 'Performer'],
      ['Escalation', '0:35', 'Performer'],
      ['Punch', '0:25', 'Performer'],
    ],
  },

  // ── Added for the operator case: one person, many companies ───────────────
  // The six above are all `promotion`. A company running promotion, GTM,
  // investor and recruiting tracks off one roster had a template for exactly
  // one of them, so every other track started from Blank — which is part of
  // why so many productions ended up called "Untitled". `purpose` matches the
  // closed set on a campaign, so the picker can offer what the track is for.
  {
    id: 'product-demo', name: 'Product Demo', purpose: 'gtm',
    mode: 'content', runtime: '2:30', format: 'Demo',
    brief: [
      ['Type', 'One-off'], ['Audience', 'Buyers comparing options right now'],
      ['Goal', 'Show it working on a real task'], ['Format', 'Screen + presenter'],
      ['Primary output', '16:9 master'], ['Clip extraction', '2 shorts'],
    ],
    outline: [
      ['The job to be done', '0:20', 'Presenter'],
      ['Do it, start to finish', '1:30', 'Presenter'],
      ['What it cost you', '0:25', 'Presenter'],
      ['Where to start', '0:15', 'Presenter'],
    ],
  },
  {
    id: 'customer-story', name: 'Customer Story', purpose: 'gtm',
    mode: 'content', runtime: '2:00', format: 'Case study',
    brief: [
      ['Type', 'One-off'], ['Audience', 'Buyers who want proof, not claims'],
      ['Goal', 'One named outcome with a number on it'], ['Format', 'Interview cutdown'],
      ['Primary output', '16:9 master'], ['Clip extraction', '3 shorts'],
    ],
    outline: [
      ['Who they are', '0:20', 'Customer'],
      ['What was breaking', '0:40', 'Customer'],
      ['What changed', '0:40', 'Customer'],
      ['The number', '0:20', 'Customer'],
    ],
  },
  {
    id: 'objection-handler', name: 'Objection Handler', purpose: 'gtm',
    mode: 'content', runtime: '1:30', format: 'Short',
    brief: [
      ['Type', 'Series'], ['Audience', 'Buyers stuck on one specific doubt'],
      ['Goal', 'Answer it honestly, including where it is fair'], ['Format', 'Direct to camera'],
      ['Primary output', '9:16 vertical'], ['Clip extraction', 'None'],
    ],
    outline: [
      ['State the objection plainly', '0:15', 'Presenter'],
      ['Where it is fair', '0:25', 'Presenter'],
      ['What we actually do', '0:35', 'Presenter'],
      ['Who should still say no', '0:15', 'Presenter'],
    ],
  },
  {
    id: 'investor-update', name: 'Investor Update', purpose: 'investor',
    mode: 'content', runtime: '5:00', format: 'Update',
    brief: [
      ['Type', 'Series'], ['Audience', 'Capital and board — people reading the numbers'],
      ['Goal', 'State the period honestly, including what slipped'],
      ['Format', 'Direct to camera + charts'],
      ['Primary output', '16:9 master'], ['Clip extraction', 'None'],
    ],
    outline: [
      ['Headline number', '0:30', 'Principal'],
      ['What moved it', '1:30', 'Principal'],
      ['What missed, and why', '1:30', 'Principal'],
      ['Next period commitments', '1:00', 'Principal'],
      ['The ask', '0:30', 'Principal'],
    ],
  },
  {
    id: 'how-to', name: 'How-To / Training Module', purpose: 'training',
    mode: 'content', runtime: '4:00', format: 'Training',
    brief: [
      ['Type', 'Series'], ['Audience', 'Customers or staff learning to use it'],
      ['Goal', 'They can do it unaided afterwards'], ['Format', 'Screen + presenter'],
      ['Primary output', '16:9 master'], ['Clip extraction', 'None'],
    ],
    outline: [
      ['What you will be able to do', '0:20', 'Presenter'],
      ['Set up', '0:40', 'Presenter'],
      ['The steps', '2:00', 'Presenter'],
      ['Where people go wrong', '0:40', 'Presenter'],
      ['Check you have it', '0:20', 'Presenter'],
    ],
  },
  {
    id: 'why-work-here', name: 'Why Work Here', purpose: 'recruiting',
    mode: 'content', runtime: '2:00', format: 'Recruiting',
    brief: [
      ['Type', 'One-off'], ['Audience', 'People who might come and work on it'],
      ['Goal', 'Attract the right ones and repel the wrong ones'],
      ['Format', 'Interview cutdown'],
      ['Primary output', '16:9 master'], ['Clip extraction', '2 shorts'],
    ],
    outline: [
      ['What we are actually building', '0:30', 'Principal'],
      ['What the work is like on a bad week', '0:45', 'Team'],
      ['Who this suits', '0:30', 'Principal'],
      ['How to apply', '0:15', 'Principal'],
    ],
  },
  {
    id: 'team-briefing', name: 'Team Briefing', purpose: 'internal',
    mode: 'content', runtime: '3:00', format: 'Briefing',
    brief: [
      ['Type', 'Series'], ['Audience', 'The team — not for outside eyes'],
      ['Goal', 'Replace the meeting'], ['Format', 'Direct to camera'],
      ['Primary output', '16:9 master'], ['Clip extraction', 'None'],
    ],
    outline: [
      ['What changed since last time', '0:45', 'Principal'],
      ['What that means for you', '1:15', 'Principal'],
      ['What I need back, and by when', '0:45', 'Principal'],
      ['Open questions', '0:15', 'Principal'],
    ],
  },
  {
    id: 'announcement', name: 'Announcement', purpose: 'promotion',
    mode: 'content', runtime: '1:00', format: 'Short',
    brief: [
      ['Type', 'One-off'], ['Audience', 'Anyone already following along'],
      ['Goal', 'One thing, said once, clearly'], ['Format', 'Direct to camera'],
      ['Primary output', '9:16 vertical'], ['Clip extraction', 'None'],
    ],
    outline: [
      ['The news', '0:15', 'Presenter'],
      ['Why it matters to you', '0:30', 'Presenter'],
      ['What to do about it', '0:15', 'Presenter'],
    ],
  },
  {
    id: 'parody-ad', name: 'Parody Ad', purpose: 'promotion',
    mode: 'comedy', runtime: '1:00', format: 'Parody',
    brief: [
      ['Type', 'One-off'], ['Audience', 'People scrolling past who have not heard of it'],
      ['Goal', 'Land the joke first; the product second'], ['Format', 'Fake commercial'],
      ['Primary output', '9:16 vertical'], ['Clip extraction', 'None'],
    ],
    outline: [
      ['Straight-faced premise', '0:15', 'Character'],
      ['Escalate past reason', '0:30', 'Character'],
      ['Deadpan tagline', '0:15', 'Character'],
    ],
  },
  {
    id: 'character-monologue', name: 'Character Monologue', purpose: 'promotion',
    mode: 'comedy', runtime: '2:00', format: 'Monologue',
    brief: [
      ['Type', 'Series'], ['Audience', 'People who already follow the character'],
      ['Goal', 'One character, one grievance, all the way down'],
      ['Format', 'Direct to camera'],
      ['Primary output', '9:16 vertical'], ['Clip extraction', '2 shorts'],
    ],
    outline: [
      ['The grievance', '0:20', 'Character'],
      ['The evidence', '0:50', 'Character'],
      ['The unreasonable conclusion', '0:35', 'Character'],
      ['Sign-off', '0:15', 'Character'],
    ],
  },
  {
    id: 'two-hander', name: 'Two-Hander Bit', purpose: 'promotion',
    mode: 'comedy', runtime: '2:30', format: 'Sketch',
    brief: [
      ['Type', 'One-off'], ['Audience', 'People scrolling past'],
      ['Goal', 'One straight man, one lunatic, one idea'], ['Format', 'Two-hander sketch'],
      ['Primary output', '9:16 vertical'], ['Clip extraction', 'None'],
    ],
    outline: [
      ['Establish the normal', '0:25', 'Straight'],
      ['Introduce the lunatic', '0:35', 'Foil'],
      ['Escalate', '1:00', 'Both'],
      ['Button', '0:30', 'Both'],
    ],
  },
];

// A production started from a bare idea still needs somewhere to begin.
export const BLANK_TEMPLATE = {
  id: null,
  name: 'Blank',
  mode: 'both',
  runtime: '5:00',
  format: 'Unset',
  brief: [
    ['Type', 'One-off'],
    ['Audience', ''],
    ['Goal', ''],
    ['Format', ''],
    ['Primary output', '16:9 master'],
    ['Clip extraction', 'None'],
  ],
  outline: [['Open', '1:00', ''], ['Middle', '3:00', ''], ['Close', '1:00', '']],
};

export const SOURCE_TYPES = [
  'idea', 'template', 'existing_video', 'existing_script', 'url', 'existing_project',
];

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
