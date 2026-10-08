// The design tokens stay CSS variables in src/style.css (:root) — one source
// of truth that plain CSS and utilities both read. This file only names them
// for Tailwind, so `bg-surface` and `var(--surface)` can never drift apart.
const token = (name) => `var(--${name})`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Preflight stays OFF. src/style.css carries its own base element rules, which
  // are this app's reset. Measured with preflight on (2026-09-29): 3,668
  // computed-style changes across 18 views, and real layout movement on 16 of
  // them (728 elements on the Characters tab alone) — a restyle, not a reset.
  // Consequence for authors: border utilities need an explicit style
  // (`border border-solid border-line`), because nothing sets one by default.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      // The layout's own breakpoints, inclusive (`max-width: N`) like the CSS
      // they replace. Declared widest first: when several match, the narrowest
      // is emitted last and wins. Tailwind's `max-[N]` is exclusive at N, and
      // arbitrary `[@media(...)]` variants are not sorted by width at all.
      screens: Object.fromEntries(
        [1000, 980, 960, 900, 880, 860, 800, 760, 720, 620]
          .map((w) => [`lte${w}`, { raw: `(max-width: ${w}px)` }]),
      ),
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        muted: token('muted'),
        faint: token('faint'),
        line: token('line'),
        'line-2': token('line-2'),
        accent: { DEFAULT: token('accent'), soft: token('accent-soft'), line: token('accent-line') },
        ok: { DEFAULT: token('ok'), soft: token('ok-soft') },
        warn: { DEFAULT: token('warn'), soft: token('warn-soft'), line: token('warn-line') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
      },
      borderRadius: {
        sm: token('r-sm'),
        DEFAULT: token('r'),
        lg: token('r-lg'),
      },
      boxShadow: {
        DEFAULT: token('shadow'),
        pop: token('shadow-pop'),
      },
      fontFamily: {
        mono: token('mono'),
      },
    },
  },
  plugins: [],
};
