// Programs — the segments of the product. Ported from artificial_funny
// `desktop/ui/src/config/entitlements.ts`.
//
// THE SERVER OWNS THE MAPPING. Their note, and the reason this file is the only
// place it lives: "a second copy of a table the server already owns is only ever
// one edit away from disagreeing with it."
//
// The difference between the two programs is WHO APPEARS ON SCREEN:
//
//   funny    Characters — invented, and they have artwork
//   content  Avatars    — a stock roster of real people, typographic tiles
//   (both)   You        — the user's own likeness, on every plan
//
// "Characters have artwork. The stock roster and your own likeness do not, and
// must not: a stock photo standing in for 'a real presenter' is a claim about a
// person who does not exist, and a mocked-up 'your face' is a promise about
// somebody we have never seen. The visual difference IS the taxonomy."

/** Programs this build can draw. The licence decides which are granted. */
export const KNOWN_PROGRAMS = ['funny', 'content'];

// Two vocabularies meet here and they are NOT the same word. A program is
// identified as `funny`; the same thing on a campaign or production is a `mode`
// of `comedy`. `programsForEntitlement` bridges one way only, so anything that
// filters productions by program had to hard-code the pairing and get it right.
// Stating it once, here, is the only copy — see the note on `mode` below.
export const PROGRAM_INFO = {
  funny: {
    id: 'funny',
    label: 'Comedy',
    // The value this program wears in campaigns.mode / productions.mode.
    mode: 'comedy',
    presenterTab: 'characters',
    detail: 'Invented characters you write and cast yourself',
  },
  content: {
    id: 'content',
    label: 'Content',
    mode: 'content',
    presenterTab: 'avatars',
    detail: 'A stock roster of real presenters',
  },
};

/** The licence key's entitlement, expressed as the programs it grants. */
export function programsForEntitlement(entitlement) {
  switch (entitlement) {
    case 'comedy': return ['funny'];
    case 'content': return ['content'];
    case 'both': return ['funny', 'content'];
    default: return [];
  }
}

export function hasProgram(programs, program) {
  return (programs ?? []).includes(program);
}

/**
 * Which presenter pickers this account gets, in order.
 *
 * Characters belong to comedy and the stock roster to content. "You" — a
 * presenter built from your own footage — belongs to everybody, because your own
 * face is something you brought rather than something the roster lends you.
 *
 * Read from the granted programs, never from a build-time product: doing the
 * latter meant "a bundle build shipped as funny offered its customers the
 * Characters tab and nothing else, however much they had paid."
 */
export function presenterTabsFor(programs) {
  const tabs = [];
  if (hasProgram(programs, 'funny')) tabs.push('characters');
  if (hasProgram(programs, 'content')) tabs.push('avatars');
  tabs.push('personal');
  return tabs;
}

export const PRESENTER_TAB_INFO = {
  characters: {
    id: 'characters',
    label: 'Characters',
    program: 'funny',
    detail: 'Invented performers you write and cast yourself. Named tiles — no artwork exists.',
  },
  avatars: {
    id: 'avatars',
    label: 'Presenters',
    program: 'content',
    detail: 'The stock roster of real people. Typographic tiles, never stock photos.',
  },
  personal: {
    id: 'personal',
    label: 'You',
    program: null,
    detail: 'Built from your own footage. Belongs to every plan.',
  },
};

/**
 * What the thing you MAKE is called — one video, never the container.
 *
 * "Project" was the neutral default here while the Campaigns screen used the same
 * helper to name the thing that GROUPS videos, so the app had two screens called
 * "New Project" doing entirely different jobs.
 */
const CREATION_NOUN = {
  default: { one: 'Project', many: 'Projects' },
  funny: { one: 'Bit', many: 'Bits' },
  content: { one: 'Video', many: 'Videos' },
};

/**
 * With a single program use that brand's word; with both (or none) use the
 * universal one so nothing feels program-specific.
 */
export function creationNoun(programs) {
  const list = programs ?? [];
  if (list.length !== 1) return CREATION_NOUN.default;
  return CREATION_NOUN[list[0]] ?? CREATION_NOUN.default;
}

/** Which program owns a route. Routes absent from this map belong to everyone. */
export const PROGRAM_ROUTES = {
  Training: 'content',
};

export function programForRoute(route) {
  return PROGRAM_ROUTES[route];
}

/**
 * Where an account should land. A client who bought one segment lands inside it
 * rather than on a dashboard mostly about the other one.
 */
export function landingFor({ onboarded, programs }) {
  if (!onboarded) return 'Onboarding';
  const list = programs ?? [];
  if (list.length === 1 && list[0] === 'content') return 'Training';
  return 'Home';
}

/** Everything the UI needs to know about this account's programs. */
export function programState(entitlement, onboarded) {
  // Deliberately NOT filtered to KNOWN_PROGRAMS: the server is the authority on
  // what someone has, this build only on what it can draw. Conflating the two
  // silently tells an account that bought a new program that it owns nothing.
  const programs = programsForEntitlement(entitlement);
  const tabs = presenterTabsFor(programs);
  return {
    programs,
    drawable: programs.filter((p) => KNOWN_PROGRAMS.includes(p)),
    info: programs.map((p) => PROGRAM_INFO[p]).filter(Boolean),
    presenterTabs: tabs.map((t) => PRESENTER_TAB_INFO[t]),
    noun: creationNoun(programs),
    routes: PROGRAM_ROUTES,
    landing: landingFor({ onboarded, programs }),
  };
}
