import { TEMPLATES } from '../data/templates.js';

// Gate 1: one application build; the license sets entitlement_mode, which
// controls templates, Producer context and licensed capabilities. It never
// forks the application and never changes the project format.

export const CAPABILITIES = {
  comedy: [
    'plan.sketch',
    'plan.bit',
    'character.create',
    'character.voice',
    'template.comedy',
    'clip.short',
  ],
  content: [
    'plan.longform',
    'plan.series',
    'plan.interview',
    'template.content',
    'source.existing_video',
    'clip.short',
  ],
};

CAPABILITIES.both = [...new Set([...CAPABILITIES.comedy, ...CAPABILITIES.content])];

// Available regardless of entitlement — the shared spine of the app.
const UNIVERSAL = [
  'plan.brief',
  'plan.outline',
  'plan.scenes',
  'plan.people',
  'plan.sources',
  'plan.decisions',
  'script.generate',
  'render.create',
  'edit.post_render',
  'publish.prepare',
  'library.read',
];

export function capabilitiesFor(entitlement) {
  if (entitlement === 'none') return [];
  return [...UNIVERSAL, ...(CAPABILITIES[entitlement] ?? [])].sort();
}

export function can(entitlement, capability) {
  return capabilitiesFor(entitlement).includes(capability);
}

/** Which active_mode values a given entitlement may switch between. */
export function allowedModes(entitlement) {
  switch (entitlement) {
    case 'both':
      return ['comedy', 'content', 'both'];
    case 'comedy':
      return ['comedy'];
    case 'content':
      return ['content'];
    default:
      return [];
  }
}

/** Templates are listed without their recipe bodies — the UI only picks one. */
export function templatesFor(entitlement) {
  const visible = entitlement === 'both' ? TEMPLATES : TEMPLATES.filter((t) => t.mode === entitlement);
  return visible.map(({ id, name, mode, runtime, format }) => ({ id, name, mode, runtime, format }));
}
