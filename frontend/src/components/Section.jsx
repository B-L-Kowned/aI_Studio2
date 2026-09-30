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

/** Page title row: name on the left, actions on the right. */
export function PageHead({ title, lead, actions }) {
  return (
    <>
      <div className="title">
        <h1>{title}</h1>
        {actions && <div className="quickrow">{actions}</div>}
      </div>
      {lead && <p className="text-muted text-[13px] m-[2px_0_16px] max-w-[70ch]">{lead}</p>}
    </>
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
