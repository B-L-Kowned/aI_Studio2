import React from 'react';
import { AlertCircle } from 'lucide-react';

/** The one question asked before anything is charged to the HeyGen plan. */
export default function PaidConfirm({ title, detail, confirmLabel, busy, onCancel, onConfirm }) {
  return (
    <div className="flex items-center gap-[12px] m-[12px_0] p-[12px_14px] border border-solid border-warn-line rounded bg-warn-soft text-warn">
      <AlertCircle size={16} className="flex-none" />
      <div className="flex-1 flex flex-col gap-[2px]">
        <b className="text-[13.5px]">{title}</b>
        <small className="text-[12px] opacity-[.85]">{detail}</small>
      </div>
      <div className="flex gap-[8px] flex-none">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}
