import React, { useEffect, useState } from 'react';
import { ExternalLink, Wallet } from 'lucide-react';
import { api } from '../services/api.js';
import { useStudio } from '../context/studio-context.jsx';

const money = (n) => `$${Number(n).toFixed(n % 1 ? 2 : 0)}`;

export function useBudget() {
  const [budget, setBudget] = useState(null);
  const reload = () => api.budget().then(setBudget).catch(() => setBudget(null));
  useEffect(() => { reload(); }, []);
  return [budget, reload, setBudget];
}

/** This month against the limit, in one line. */
export function BudgetMeter({ budget, compact }) {
  if (!budget?.set) return null;
  const pct = Math.min(100, Math.round((budget.spent / budget.monthlyCap) * 100));
  const tone = budget.atLimit ? 'bg-danger' : budget.nearLimit ? 'bg-warn' : 'bg-ok';
  return (
    <div className={compact ? 'text-[12px]' : 'text-[12.5px]'}>
      <div className="flex items-baseline gap-[6px]">
        <Wallet size={13} className="text-muted self-center" />
        <b className="font-[600] [font-variant-numeric:tabular-nums]">{money(budget.spent)} of {money(budget.monthlyCap)}</b>
        <span className="text-muted">used this month · resets {budget.resetsOn}</span>
      </div>
      <div className="h-[5px] mt-[6px] rounded-full bg-surface-2 overflow-hidden" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="HeyGen spend this month">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Choose a monthly limit. Presets say what they buy in minutes at your rate;
 * the middle one is suggested. The studio estimates from its own record of
 * renders, so the rate is editable for plans that charge differently.
 */
export function BudgetPicker({ budget, onSaved, saveLabel = 'Save limit' }) {
  const { mutate } = useStudio();
  const [cap, setCap] = useState(budget?.monthlyCap ?? 50);
  const [custom, setCustom] = useState(budget?.set && !budget.presets.some((p) => p.cap === budget.monthlyCap));
  const [rate, setRate] = useState(budget?.ratePerMin ?? 1.4);
  const [saving, setSaving] = useState(false);
  if (!budget) return null;
  const minutes = Math.floor(cap / rate);
  const plan = minutes <= 15 ? 'Pay as you go (API credits)' : minutes <= 60 ? 'a Creator web plan, connected by signing in' : 'a Team or API Pro plan';
  const CARD = (on) => 'text-left p-[9px_11px] rounded-lg border border-solid ' + (on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-2');
  const save = async () => {
    setSaving(true);
    try { const r = await mutate(() => api.setBudget({ monthlyCap: cap, ratePerMin: rate }), null); onSaved?.(r.data); }
    catch { /* reported */ } finally { setSaving(false); }
  };
  return (
    <div>
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-[8px] lte620:grid-cols-[1fr_1fr]">
        {budget.presets.map((p) => (
          <button key={p.id} type="button" className={CARD(!custom && cap === p.cap)} onClick={() => { setCustom(false); setCap(p.cap); }}>
            <span className="flex items-baseline gap-[6px]">
              <b className="text-[15px] font-[640] text-ink">{money(p.cap)}</b>
              <span className="text-[11px] text-muted">/ month</span>
              {p.id === 'regular' && <span className="ml-auto text-[10.5px] font-[600] text-accent">Suggested</span>}
            </span>
            <span className="block text-[12.5px] font-[560] text-ink mt-[2px]">{p.label}</span>
            <span className="block text-[11.5px] text-muted leading-[1.4]">{p.hint} · about {Math.floor(p.cap / rate)} min</span>
          </button>
        ))}
        <div className={CARD(custom)} onClick={() => setCustom(true)} role="button" tabIndex={0}>
          <span className="block text-[12.5px] font-[560] text-ink">Your own</span>
          <span className="flex items-center gap-[4px] mt-[4px]">$
            <input type="number" min={1} max={10000} className="w-[80px] text-[13px] p-[3px_6px]" value={custom ? cap : ''} placeholder="75"
              onFocus={() => setCustom(true)} onChange={(e) => setCap(Number(e.target.value))} aria-label="Monthly limit in dollars" />
          </span>
        </div>
      </div>
      <p className="m-[10px_0_0] text-[12px] text-muted leading-[1.5]">
        At {money(rate)} a minute that is about <b className="text-ink font-[600]">{minutes} minutes</b> of avatar video a month — {plan} usually fits.
        Nothing starts that would pass it; you can raise it any time. HeyGen's own <a href="https://www.heygen.com/pricing" target="_blank" rel="noopener noreferrer">pricing <ExternalLink size={11} className="inline" /></a> is the final word.
      </p>
      <div className="flex flex-wrap items-center gap-[10px] mt-[10px]">
        <label className="flex items-center gap-[6px] text-[12px] text-muted">What a minute costs on your plan: $
          <input type="number" step="0.1" min={0.1} max={50} className="w-[64px] text-[12.5px] p-[3px_6px]" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </label>
        <button className="primary ml-auto" disabled={saving || !(cap >= 1)} onClick={save}>{saving ? 'Saving…' : saveLabel}</button>
      </div>
    </div>
  );
}
