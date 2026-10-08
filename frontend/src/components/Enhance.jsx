import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, ChevronDown, RefreshCw, Check, X, AlertTriangle } from 'lucide-react';

/**
 * The Enhance control used on every tab: one button, a short menu of what it
 * can do here. Everything behind it runs on this Mac (the local model), so the
 * menu says so once instead of every button carrying a price.
 */
export function EnhanceButton({ options, onPick, busy = false, busyLabel = 'Working…', label = 'Enhance', compact = false, disabled = false, title }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return (
    <span ref={box} className="relative inline-flex">
      {compact ? (
        <button type="button" disabled={busy || disabled} aria-label={label} aria-expanded={open} title={title ?? label}
          onClick={() => setOpen((o) => !o)}
          className="w-[28px] h-[28px] p-0 rounded-full grid place-items-center border border-solid bg-surface border-line text-accent hover:border-accent disabled:opacity-50">
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
        </button>
      ) : (
        <button type="button" disabled={busy || disabled} aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)}
          className="text-[12.5px] p-[6px_12px] inline-flex items-center gap-[6px]">
          {busy ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} className="text-accent" />}
          {busy ? busyLabel : label}
          {!busy && <ChevronDown size={12} className="text-muted" />}
        </button>
      )}
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-30 w-[270px] bg-surface border border-solid border-line rounded-lg p-[5px] [box-shadow:var(--shadow-lg,0_10px_30px_rgba(0,0,0,.12))]">
          {options.map((o) => (
            <button key={o.id} role="menuitem" type="button" disabled={o.disabled}
              onClick={() => { setOpen(false); onPick(o.id); }}
              className="w-full text-left [border:0] bg-transparent rounded-md p-[8px_10px] hover:bg-surface-2 disabled:opacity-50 block">
              <b className="block text-[12.5px] font-[560] text-ink">{o.label}</b>
              {o.detail && <span className="block text-[11.5px] text-muted mt-[2px] leading-[1.4]">{o.detail}</span>}
            </button>
          ))}
          <p className="m-[4px_0_0] p-[6px_10px_4px] [border-top:1px_solid_var(--line)] text-[10.5px] text-faint">
            Runs on this Mac with your local model — free, nothing leaves the machine. You keep or discard the result.
          </p>
        </div>
      )}
    </span>
  );
}

/** A suggested text: read it, then use it or not. Nothing is saved until Use. */
export function Suggestion({ text, meta, flags = [], onUse, onDismiss, useLabel = 'Use this' }) {
  return (
    <div className="mt-[6px] border border-solid border-accent-line bg-accent-soft rounded-md p-[9px_11px]">
      <p className="m-0 text-[13.5px] leading-[1.6] text-ink">{text}</p>
      {flags.length > 0 && (
        <ul className="m-[6px_0_0] p-0 list-none">
          {flags.map((f) => <li key={f} className="text-[11.5px] text-warn flex items-center gap-[5px]"><AlertTriangle size={11} /> {f}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-[8px] mt-[7px]">
        <button type="button" className="text-[12px] p-[4px_10px]" onClick={onUse}><Check size={12} /> {useLabel}</button>
        <button type="button" className="ghostbtn text-[12px] text-muted p-[4px_6px]" onClick={onDismiss}><X size={12} /> Dismiss</button>
        {meta && <span className="ml-auto text-[11px] text-muted">{meta}</span>}
      </div>
    </div>
  );
}

/** "qwen2.5-coder:14b" → "qwen2.5-coder 14B", for a quiet label. */
export const modelLabel = (m) => String(m ?? '').replace(/:(\d+(?:\.\d+)?)b$/i, ' $1B').replace(/:latest$/, '');
