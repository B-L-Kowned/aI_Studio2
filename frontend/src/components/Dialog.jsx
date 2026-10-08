import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle } from 'lucide-react';

/*
 * One dialog system for the whole app. Every question the app asks — "Start
 * 12 renders?", "Name the persona" — and every panel that opens over a page
 * goes through here, so they all look, focus and close the same way. The
 * browser's own confirm()/prompt() boxes are not used anywhere.
 */

/** A dialog over the page: centred (default) or a side panel. Esc and the dimmed backdrop close it. */
export function Modal({ title, children, footer, onClose, side = false, width = 460, labelledBy }) {
  const box = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const first = box.current?.querySelector('input, textarea, select, button[data-primary], button');
    first?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey, true); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgba(17,18,20,.32)] [animation:dlgfade_.12s_ease-out]" onClick={onClose} aria-hidden="true" />
      <div ref={box} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} aria-labelledby={labelledBy}
        className={side
          ? 'absolute top-0 right-0 bottom-0 bg-surface [border-left:1px_solid_var(--line)] [box-shadow:var(--shadow-pop)] flex flex-col [animation:dlgslide_.16s_ease-out]'
          : 'absolute left-1/2 top-[12vh] -translate-x-1/2 bg-surface border border-solid border-line-2 rounded-xl [box-shadow:var(--shadow-pop)] flex flex-col max-h-[76vh] [animation:dlgpop_.14s_ease-out]'}
        style={{ width: side ? `min(${width}px, 100vw)` : `min(${width}px, calc(100vw - 32px))` }}>
        {title != null && (
          <header className="flex items-start gap-[10px] p-[16px_18px_10px]">
            <h2 className="flex-1 m-0 text-[15px] leading-[1.35] font-[620] tracking-[-0.005em]">{title}</h2>
            <button type="button" className="ghostbtn p-[4px] text-muted hover:text-ink -mr-[6px] -mt-[2px]" aria-label="Close" onClick={onClose}><X size={16} /></button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto p-[0_18px_16px] text-[13px] text-ink-2 leading-[1.55]">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-[8px] p-[12px_18px] [border-top:1px_solid_var(--line)] bg-surface-2 rounded-b-xl">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

const DialogContext = createContext(null);

/**
 * Promise-based questions: `await dialog.confirm({...})` → true/false,
 * `await dialog.prompt({...})` → text or null, `await dialog.notice({...})`.
 */
export function DialogProvider({ children }) {
  const [current, setCurrent] = useState(null);
  const ask = useCallback((spec) => new Promise((resolve) => setCurrent({ ...spec, resolve })), []);
  const api = useRef({
    confirm: (spec) => ask({ kind: 'confirm', ...spec }),
    prompt: (spec) => ask({ kind: 'prompt', ...spec }),
    notice: (spec) => ask({ kind: 'notice', ...spec }),
  });
  api.current.confirm = (spec) => ask({ kind: 'confirm', ...spec });
  api.current.prompt = (spec) => ask({ kind: 'prompt', ...spec });
  api.current.notice = (spec) => ask({ kind: 'notice', ...spec });

  const close = (value) => { current?.resolve(value); setCurrent(null); };
  return (
    <DialogContext.Provider value={api.current}>
      {children}
      {current && <Question spec={current} onDone={close} />}
    </DialogContext.Provider>
  );
}

function Question({ spec, onDone }) {
  const [value, setValue] = useState(spec.initial ?? '');
  const cancel = () => onDone(spec.kind === 'prompt' ? null : false);
  const ok = () => {
    if (spec.kind === 'prompt') { if (value.trim() || spec.allowEmpty) onDone(value.trim()); return; }
    onDone(true);
  };
  const danger = spec.tone === 'danger';
  return (
    <Modal title={spec.title} onClose={cancel} width={spec.width ?? 440}
      footer={<>
        {spec.kind !== 'notice' && <button type="button" onClick={cancel}>{spec.cancelLabel ?? 'Cancel'}</button>}
        <button type="button" data-primary className={danger ? 'danger !bg-danger !text-white !border-danger' : 'primary'}
          disabled={spec.kind === 'prompt' && !value.trim() && !spec.allowEmpty} onClick={ok}>
          {spec.confirmLabel ?? (spec.kind === 'notice' ? 'OK' : spec.kind === 'prompt' ? 'Save' : 'Continue')}
        </button>
      </>}>
      {spec.body && (
        <div className={'flex gap-[10px] ' + (spec.kind === 'prompt' ? 'mb-[12px]' : '')}>
          {(danger || spec.tone === 'warn') && <AlertTriangle size={16} className={'flex-none mt-[2px] ' + (danger ? 'text-danger' : 'text-warn')} />}
          <div className="min-w-0">{spec.body}</div>
        </div>
      )}
      {spec.kind === 'prompt' && (
        <form onSubmit={(e) => { e.preventDefault(); ok(); }}>
          <label className="flex flex-col gap-[5px] text-[11.5px] font-semibold text-muted">
            {spec.label}
            {spec.multiline
              ? <textarea className="font-normal text-[13.5px] text-ink min-h-[80px]" value={value} placeholder={spec.placeholder} onChange={(e) => setValue(e.target.value)} />
              : <input className="font-normal text-[13.5px] text-ink" value={value} placeholder={spec.placeholder} onChange={(e) => setValue(e.target.value)} />}
          </label>
          {spec.hint && <p className="m-[6px_0_0] text-[11.5px] text-faint">{spec.hint}</p>}
        </form>
      )}
    </Modal>
  );
}

export const useDialog = () => useContext(DialogContext);
