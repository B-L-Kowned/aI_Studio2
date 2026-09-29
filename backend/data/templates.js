// A template is a production recipe: it pre-populates Brief and Outline
// defaults. Editing a production never writes back to its template unless the
// user explicitly saves it as one.

export const TEMPLATES = [
  {
    id: 'pat-podcast-20',
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
