import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

/**
 * Drop a file here, or click to choose one. Shows real upload progress and
 * hands the server's reply to onDone. `compact` renders as a single button
 * for tight spaces (a shot-list row).
 */
export default function UploadDrop({ label, hint, accept = 'video/*', upload, onDone, onError, compact = false }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState(null); // 0–1 while sending
  const [error, setError] = useState(null);

  const send = async (file) => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const res = await upload(file, (p) => setProgress(p));
      setProgress(null);
      onDone?.(res);
    } catch (err) {
      setProgress(null);
      setError(err.message);
      onError?.(err);
    }
  };
  const pick = (e) => { send(e.target.files?.[0]); e.target.value = ''; };
  const busy = progress != null;
  const pct = busy ? Math.round(progress * 100) : 0;

  const field = <input ref={input} type="file" accept={accept} className="hidden" onChange={pick} />;

  if (compact) {
    return (
      <span className="inline-flex flex-col gap-[4px]">
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={13} /> {busy ? `Uploading ${pct}%` : label}
        </button>
        {field}
        {error && <small className="text-danger text-[11px]">{error}</small>}
      </span>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) send(e.dataTransfer.files?.[0]); }}
      className={'flex flex-col items-center justify-center gap-[6px] text-center rounded-lg border-[1.5px] border-dashed p-[18px_16px] cursor-pointer [transition:background_.12s,border-color_.12s] '
        + (over ? 'border-accent bg-accent-soft' : 'border-line-2 bg-surface hover:border-accent')}
    >
      {field}
      <Upload size={18} className="text-muted" aria-hidden="true" />
      <b className="text-[13px] font-[560]">{busy ? `Uploading… ${pct}%` : label}</b>
      {!busy && hint && <span className="text-[11.5px] text-muted max-w-[460px]">{hint}</span>}
      {busy && (
        <span className="w-full max-w-[320px] h-[5px] rounded-full bg-canvas overflow-hidden">
          <span className="block h-full bg-accent [transition:width_.2s]" style={{ width: `${pct}%` }} />
        </span>
      )}
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </div>
  );
}
