import React from 'react';

/**
 * The one page pattern.
 *
 * Every screen was inventing its own: Home used cards with headers, Library was
 * a bare grid on the canvas, People was loose cards with a floating heading.
 * Three layouts for the same job, so nothing lined up and every page had its own
 * spacing.
 *
 * A Section is a card whose heading belongs to it. A heading sitting on the
 * canvas above a card is not labelling anything — it is floating near it.
 */
// Rules for children that callers pass in (header actions, and the lists and
// tables a flush body holds) stay descendant selectors on the section/body so
// their specificity matches the old `.card-section …` / `.card-body.flush …`
// rules. The h2 keeps its (0,1,2) weight so a page's own `h2` rule cannot win.
const SECTION = 'bg-surface border border-solid border-line rounded-lg m-[12px_0] overflow-hidden'
  + ' [&>header_h2]:m-0 [&>header_h2]:text-[13px] [&>header_h2]:font-semibold'
  + ' [&>header_select]:text-[12px] [&>header_select]:p-[5px_8px]'
  + ' [&>header_input]:text-[12px] [&>header_input]:p-[5px_8px]';
const BODY = 'p-[14px_16px] [&>.assetlist]:[border:0] [&>.assetlist]:rounded-none [&>.assetlist]:m-[-16px]';
const BODY_FLUSH = 'flush p-0'
  + ' [&&_.assetlist]:[border:0] [&&_.assetlist]:rounded-none [&&_.assetlist]:m-0'
  + ' [&&_.sectionempty]:p-[16px]'
  + ' [&&_.calendar]:[border:0] [&&_.calendar]:rounded-none'
  + ' [&&_.camptable]:[border:0] [&&_.camptable]:rounded-none [&&_.camptable]:m-0';

export function Section({ title, meta, actions, flush, children }) {
  return (
    <section className={SECTION}>
      {(title || actions) && (
        <header className="flex items-baseline gap-[10px] p-[11px_16px] bg-surface-2 [border-bottom:1px_solid_var(--line)]">
          {title && <h2>{title}</h2>}
          {meta && <span className="text-[11.5px] text-muted">{meta}</span>}
          {actions && <div className="sectionactions">{actions}</div>}
        </header>
      )}
      <div className={flush ? BODY_FLUSH : BODY}>{children}</div>
    </section>
  );
}

/**
 * The page header — the same shape on every page.
 *
 *   breadcrumb (optional)
 *   Title                                    actions
 *   one-line lead
 *   tabs (optional) ─────────────────────────────────
 *
 * The title names what you are looking at: the view ("Campaigns",
 * "Characters") or the production, never the section of the app you are in —
 * the top nav already says that. Pages used to draw this three different ways:
 * tabs above the title on Plan and Cast, a black pill bar beside the title on
 * Create, a bare heading elsewhere.
 */
export function PageHead({ eyebrow, title, titleHint, lead, actions, tabs }) {
  return (
    <div className="mb-[18px]">
      {eyebrow && <div className="mb-[3px]">{eyebrow}</div>}
      {/* Wraps on narrow screens: the actions drop below rather than squeezing
          the title to nothing. */}
      <div className="title flex-wrap gap-y-[10px] [&>.quickrow]:shrink [&>.quickrow]:min-w-0 [&>.quickrow]:max-w-full">
        <div className="min-w-0 flex-[1_1_260px]">
          <h1 className="whitespace-nowrap overflow-hidden text-ellipsis" title={titleHint}>{title}</h1>
          {lead && <p className="text-muted text-[13px] m-[3px_0_0] max-w-[70ch]">{lead}</p>}
        </div>
        {actions && <div className="quickrow">{actions}</div>}
      </div>
      {tabs && <div className="mt-[14px]">{tabs}</div>}
    </div>
  );
}

/**
 * The one tab style: underlined, quiet, below the title. `stale` marks a view
 * whose content is out of date with what feeds it.
 */
export function Tabs({ items, value, onChange }) {
  return (
    // One line that scrolls sideways on a phone, rather than wrapping tabs
    // onto a second row that reads as a different set. The rule is an inset
    // shadow, not a border, so the active underline sits inside the scroll box
    // instead of being clipped by it.
    <nav className="subnav mb-0 flex-nowrap overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [border-bottom:0] [box-shadow:inset_0_-1px_0_var(--line)] [&>button]:mb-0 [&>button]:shrink-0 [&>button]:whitespace-nowrap" role="tablist">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={value === t.id ? 'on' : t.stale ? '!text-warn' : ''}
          title={t.title ?? ''}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null && <span className="tabcount">{t.count}</span>}
          {t.stale && <i className="staledot" />}
        </button>
      ))}
    </nav>
  );
}

/** An empty state that offers the way out, rather than naming it and stopping. */
export function Empty({ icon: Icon, children, action }) {
  return (
    <div className="sectionempty">
      {Icon && <Icon size={15} />}
      <span>{children}</span>
      {action}
    </div>
  );
}
