// Deterministic dry-run script generation. Same plan in, same script out — the
// TEST_PLAN requires reproducible output with zero paid calls. A shipped build
// replaces generateScript() with a capability request ('script.generate'); the
// segment shape it returns is unchanged.

function seededPick(list, seed) {
  return list[Math.abs(seed) % list.length];
}

const OPENERS = [
  'Let me start with something that has been bothering me.',
  'Here is the thing nobody says out loud.',
  'I want to put a question to you before we get going.',
];

const RESPONSES = [
  'That matches what I keep running into.',
  'I would push back on part of that, actually.',
  'Yes — and it gets worse the larger the team is.',
];

const BRIDGES = [
  'Which brings us to the part people actually care about.',
  'So let us make that concrete.',
  'Hold that thought, because it connects to the next piece.',
];

function speakersOf(participants) {
  return String(participants)
    .split(/[+↔,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {{title:string, participants:string, purpose:string, id:number}[]} scenes
 * @returns {{scene_id:number, position:number, speaker:string, text:string}[]}
 */
/**
 * How a track's purpose changes the opening.
 *
 * Deliberately small: enough to make an investor video not sound like an advert,
 * without pretending this dry-run generator can write either of them properly.
 * What matters is that the audience reaches the script at all — it was being
 * recorded and then ignored.
 */
const PURPOSE_FRAME = {
  promotion:  'Here is the thing most people get wrong about this.',
  gtm:        'If you are deciding between options right now, this is the difference.',
  investor:   'Here is the number that matters, and what it did last quarter.',
  training:   'By the end of this you will be able to do it yourself.',
  recruiting: 'This is what the work actually looks like day to day.',
  internal:   'This is for the team, so I will skip the preamble.',
};

export function generateScript(scenes, productionTitle, personas = {}, track = null) {
  const segments = [];
  let position = 0;
  const lastScene = scenes.length - 1;

  scenes.forEach((scene, sceneIndex) => {
    const speakers = speakersOf(scene.participants);
    const cast = speakers.length ? speakers : ['Narrator'];
    const seed = sceneIndex + productionTitle.length;

    cast.forEach((speaker, i) => {
      // A persona is not decoration. If this speaker has one, its own opening
      // and sign-off are used instead of the generic pool — a presenter who
      // always states the decision first should state the decision first.
      const persona = personas[speaker];
      let line;
      if (i === 0 && sceneIndex === 0 && persona?.signatureOpening) {
        // A persona's own opening outranks the track's, because it is more
        // specific: it is how THIS presenter starts, not how this kind of
        // video starts.
        line = persona.signatureOpening;
      } else if (i === 0 && sceneIndex === 0 && track?.purpose && PURPOSE_FRAME[track.purpose]) {
        line = PURPOSE_FRAME[track.purpose];
      } else if (i === 0) {
        line = `${seededPick(OPENERS, seed)} ${scene.purpose || scene.title}.`;
      } else {
        line = seededPick(RESPONSES, seed + i);
      }
      segments.push({ scene_id: scene.id, position: position++, speaker, text: line });
    });

    // The sign-off belongs at the end of the last scene, in the voice of
    // whoever is carrying it.
    if (sceneIndex === lastScene) {
      const persona = personas[cast[0]];
      if (persona?.signOff) {
        segments.push({
          scene_id: scene.id, position: position++, speaker: cast[0], text: persona.signOff,
        });
      }
    }

    if (sceneIndex < scenes.length - 1) {
      segments.push({
        scene_id: scene.id,
        position: position++,
        speaker: cast[0],
        text: seededPick(BRIDGES, seed),
      });
    }
  });

  return segments;
}

/** Rough runtime estimate at ~140 words/min, used for the render cost estimate. */
export function estimateRuntime(segments) {
  const words = segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  const seconds = Math.max(1, Math.round((words / 140) * 60));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
