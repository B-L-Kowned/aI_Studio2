import React, { useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { MADE_BY, madeByOf, madeByLabel } from '../utils/made-by.js';

/**
 * How this video gets made — HeyGen avatar, filmed by you, or voice-over —
 * chosen once and written to every outline section. It decides what the Make
 * step is (Render, Record or Recordings) and whether a HeyGen look is needed.
 */
export default function MadeByChooser({ onChange }) {
  const { production, applyProduction, mutate } = useStudio();
  const [saving, setSaving] = useState(false);
  const current = madeByOf(production);
  // Once chosen it is one line; the three options open only to change it.
  const [open, setOpen] = useState(current === 'mixed');

  const choose = async (m) => {
    const todo = production.outline.filter((s) => s.participants !== m.who);
    if (!todo.length) { setOpen(false); return; }
    setSaving(true);
    try {
      for (const [i, s] of todo.entries()) {
        const last = i === todo.length - 1;
        await mutate(() => api.updateSection(production.id, s.id, { participants: m.who }), last ? applyProduction : null, { silent: !last });
      }
      onChange?.(m.id);
      setOpen(false);
    } catch { /* mutate reports it */ } finally { setSaving(false); }
  };

  if (!open) {
    const m = MADE_BY.find((x) => x.id === current);
    return (
      <p className="flex flex-wrap items-baseline gap-x-[8px] m-0 text-[13px]" aria-label="How this video is made">
        <span className="text-[10.5px] tracking-[.07em] uppercase text-faint font-semibold">How it's made</span>
        <b className="font-[580] text-ink">{madeByLabel(current)}</b>
        {m && <span className="text-muted text-[12.5px]">— {m.detail}</span>}
        <button className="ghostbtn text-[12.5px] text-accent p-0" onClick={() => setOpen(true)}>change</button>
      </p>
    );
  }

  return (
    <section aria-label="How this video is made">
      <div className="text-[10.5px] tracking-[.07em] uppercase text-faint font-semibold mb-[6px]">How it's made</div>
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-[8px] lte800:grid-cols-[1fr]" role="radiogroup">
        {MADE_BY.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={current === m.id} disabled={saving} onClick={() => choose(m)}
            className={'text-left p-[9px_12px] rounded-lg border border-solid bg-surface flex flex-col gap-[2px] '
              + (current === m.id ? 'border-accent [box-shadow:0_0_0_2px_var(--accent)]' : 'border-line hover:border-line-2')}>
            <b className="text-[13px] flex items-center gap-[6px]">{current === m.id && <Check size={13} className="text-accent" />}{m.label}</b>
            <span className="text-[11.5px] text-muted leading-[1.4] font-normal">{m.detail}</span>
          </button>
        ))}
      </div>
      {current === 'mixed' && (
        <p className="text-warn text-[12px] m-[6px_0_0] flex items-center gap-[5px]">
          <AlertCircle size={13} /> The outline sections disagree about who appears. Choose one to set them all, or keep the mix on purpose (Plan details → Outline).
        </p>
      )}
    </section>
  );
}
