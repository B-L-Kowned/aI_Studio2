import React from 'react';
import { AlertCircle } from 'lucide-react';
import { useBudget, BudgetMeter, BudgetPicker } from './Budget.jsx';

/**
 * The one question asked before anything is charged to the HeyGen plan. The
 * first time, it asks for a monthly limit instead: a render cannot start
 * without one, so the customer chooses it here rather than meeting a refusal.
 */
export default function PaidConfirm({ title, detail, confirmLabel, busy, onCancel, onConfirm }) {
  const [budget, , setBudget] = useBudget();
  if (budget && !budget.set) {
    return (
      <div className="m-[12px_0] p-[12px_14px] border border-solid border-line rounded-lg bg-surface">
        <b className="block text-[13.5px] font-[600]">First, a monthly limit for HeyGen</b>
        <p className="m-[2px_0_10px] text-[12.5px] text-muted">Renders are charged to your own HeyGen account. Pick how much a month the studio may spend there — it stops before going over.</p>
        <BudgetPicker budget={budget} onSaved={setBudget} saveLabel="Set limit and continue" />
        <div className="flex mt-[8px]"><button onClick={onCancel}>Cancel</button></div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-[12px] m-[12px_0] p-[12px_14px] border border-solid border-warn-line rounded bg-warn-soft text-warn">
      <AlertCircle size={16} className="flex-none" />
      <div className="flex-1 min-w-[220px] flex flex-col gap-[2px]">
        <b className="text-[13.5px]">{title}</b>
        <small className="text-[12px] opacity-[.85]">{detail}</small>
        {budget?.set && <div className="mt-[6px] text-ink"><BudgetMeter budget={budget} compact /></div>}
      </div>
      <div className="flex gap-[8px] flex-none">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy || budget?.atLimit} title={budget?.atLimit ? 'This month’s limit is reached — raise it in Settings → HeyGen account' : ''} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}
