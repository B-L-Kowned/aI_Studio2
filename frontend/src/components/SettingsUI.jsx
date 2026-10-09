import React from 'react';

// The pieces every Settings page is built from, so they all read alike.

export function SectionHead({ title, lead }) {
  return (
    <header className="mb-[16px]">
      <h2 className="m-0 text-[18px] font-[620] tracking-[-0.01em]">{title}</h2>
      {lead && <p className="m-[4px_0_0] text-[13px] text-muted leading-[1.55] max-w-[64ch]">{lead}</p>}
    </header>
  );
}

/** A group of settings: a titled card whose rows share one label column. */
export function Card({ title, meta, actions, children, className = '' }) {
  return (
    <section className={'bg-surface border border-solid border-line rounded-lg overflow-clip [&+&]:mt-[14px] ' + className}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-[8px_12px] p-[11px_16px] [border-bottom:1px_solid_var(--line)] bg-surface-2">
          <b className="text-[13px] font-[600]">{title}</b>
          {meta && <span className="text-[12px] text-muted">{meta}</span>}
          {actions && <span className="ml-auto flex items-center gap-[6px]">{actions}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Row({ label, hint, children, align = 'center' }) {
  return (
    <div className={'grid grid-cols-[190px_minmax(0,1fr)] gap-[16px] p-[12px_16px] [&+&]:[border-top:1px_solid_var(--line)] lte800:grid-cols-[1fr] lte800:gap-[6px] ' + (align === 'start' ? 'items-start' : 'items-center')}>
      <div className="min-w-0">
        <span className="block text-[13px] font-[560] text-ink">{label}</span>
        {hint && <span className="block text-[11.5px] text-muted leading-[1.45] mt-[2px]">{hint}</span>}
      </div>
      <div className="flex items-center gap-[8px] flex-wrap min-w-0">{children}</div>
    </div>
  );
}

export const Pill = ({ tone = 'muted', children }) => {
  const tones = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', muted: 'bg-surface-2 text-muted', accent: 'bg-accent-soft text-accent' };
  return <span className={`inline-flex items-center gap-[5px] text-[11.5px] font-[560] rounded-full p-[3px_10px] ${tones[tone]}`}>{children}</span>;
};

