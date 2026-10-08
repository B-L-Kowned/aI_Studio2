import React, { useState, useEffect, useRef } from 'react';
import { Check, AlertCircle, ChevronDown } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { MADE_BY, madeByOf, madeByLabel } from '../utils/made-by.js';

/**
 * How this video gets made — HeyGen avatar, filmed by you, or voice-over —
 * chosen once and written to every outline section. It decides what the Make
 * step is (Render, Record or Recordings) and whether a HeyGen look is needed.
 */
export default function MadeByChooser({ onChange, inline = false }) {
  const { production, applyProduction, mutate } = useStudio();
  const [saving, setSaving] = useState(false);
  const current = madeByOf(production);
  // Once chosen it is one line; the three options open only to change it.
  const [open, setOpen] = useState(!inline && current === 'mixed');

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

  if (inline) return <InlineChooser current={current} saving={saving} choose={choose} open={open} setOpen={setOpen} />;
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

/** In a page's meta line: the choice as one word, and a small menu to change it. */
function InlineChooser({ current, saving, choose, open, setOpen }) {
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open, setOpen]);
  return (
    <span ref={box} className="relative inline-flex">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        className={'ghostbtn p-[1px_6px] text-[12.5px] font-[540] inline-flex items-center gap-[3px] '
          + (current === 'mixed' ? 'text-warn' : 'text-ink-2')}>
        {madeByLabel(current)} <ChevronDown size={12} className={'text-faint ' + (open ? 'rotate-180' : '')} />
      </button>
      {open && (
        <div role="menu" className="absolute z-30 top-[calc(100%+6px)] left-0 w-[320px] p-[5px] bg-surface border border-solid border-line rounded-lg [box-shadow:0_12px_32px_-12px_rgba(0,0,0,.25)]">
          <div className="p-[6px_8px_4px] text-[10.5px] tracking-[.07em] uppercase text-faint font-semibold">How it's made</div>
          {MADE_BY.map((m) => (
            <button key={m.id} type="button" role="menuitemradio" aria-checked={current === m.id} disabled={saving}
              onClick={() => choose(m)}
              className="w-full grid grid-cols-[16px_1fr] gap-[8px] items-start text-left p-[7px_8px] border-0 rounded bg-transparent hover:bg-surface-2">
              <span className="pt-[2px]">{current === m.id && <Check size={13} className="text-accent" />}</span>
              <span>
                <b className="block text-[13px] font-[560] text-ink">{m.label}</b>
                <span className="block text-[11.5px] text-muted leading-[1.4] font-normal">{m.detail}</span>
              </span>
            </button>
          ))}
          {current === 'mixed' && <p className="m-0 p-[6px_8px] text-[11.5px] text-warn">The sections disagree — pick one to set them all.</p>}
        </div>
      )}
    </span>
  );
}
