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
export function Section({ title, meta, actions, flush, children }) {
  return (
    <section className="card-section">
      {(title || actions) && (
        <header>
          {title && <h2>{title}</h2>}
          {meta && <span className="sectionmeta">{meta}</span>}
          {actions && <div className="sectionactions">{actions}</div>}
        </header>
      )}
      <div className={'card-body' + (flush ? ' flush' : '')}>{children}</div>
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
      {lead && <p className="pagelead">{lead}</p>}
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
