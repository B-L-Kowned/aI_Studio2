import React from 'react';
import { AlertCircle } from 'lucide-react';

/** The one question asked before anything is charged to the HeyGen plan. */
export default function PaidConfirm({ title, detail, confirmLabel, busy, onCancel, onConfirm }) {
  return (
    <div className="confirmpaid">
      <AlertCircle size={16} />
      <div>
        <b>{title}</b>
        <small>{detail}</small>
      </div>
      <div className="confirmactions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}
