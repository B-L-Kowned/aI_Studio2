import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, ArrowRight, Check, Clock, Headphones, Lightbulb, RefreshCw, CalendarDays } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import { PageHead } from '../components/Section.jsx';

/**
 * Today: the production manager. Where the register stands against your three
 * deadlines, the queues of work waiting on you, what is late, what is stalled,
 * and the videos to work on next. Every number comes from what has actually
 * happened in the app, not from a status typed into the register.
 */
const STATUS = {
  'on-track': { label: 'On track', tone: 'text-ok', bar: 'bg-ok' },
  behind: { label: 'Behind', tone: 'text-danger', bar: 'bg-danger' },
  late: { label: 'Past the date', tone: 'text-danger', bar: 'bg-danger' },
  done: { label: 'Done', tone: 'text-ok', bar: 'bg-ok' },
  'no-date': { label: 'No date set', tone: 'text-muted', bar: 'bg-line-2' },
};
// Where each stage's next piece of work is done.
const STEP_FOR = (v) => ({
  'needs-script': 'Script', 'draft-ready': 'Script', 'draft-checks': 'Script',
  script: v.madeBy === 'self' ? 'Make' : 'Voice', audio: 'Voice',
  'audio-approved': v.madeBy === 'heygen' ? 'Make' : 'Edit', final: 'Edit',
}[v.stage] ?? 'Script');
const NEXT_WORDS = {
  'needs-script': 'needs a script', 'draft-ready': 'approve the script', 'draft-checks': 'answer its checks',
  script: 'make the voice', audio: 'approve the voice', 'audio-approved': 'make the video', final: 'export it',
};
// The year only when it is not this year.
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};
const dueWords = (d) => (d == null ? '' : d < 0 ? `${-d}d late` : d === 0 ? 'due today' : `due in ${d}d`);

function DeadlineForm({ deadlines, onSave, onCancel }) {
  const [form, setForm] = useState({ P1: deadlines.P1 ?? '', P2: deadlines.P2 ?? '', P3: deadlines.P3 ?? '' });
  return (
    <form className="flex flex-wrap items-end gap-[12px] p-[14px_16px] rounded-lg bg-surface-2" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      {['P1', 'P2', 'P3'].map((p) => (
        <label key={p} className="flex flex-col gap-[4px] text-[11.5px] font-semibold text-muted">
          {p} done by
          <input type="date" className="text-[13px]" value={form[p]} onChange={(e) => setForm((f) => ({ ...f, [p]: e.target.value }))} />
        </label>
      ))}
      <button className="primary" type="submit">Save deadlines</button>
      {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      <p className="basis-full m-0 text-[12px] text-faint">Every video is due by its priority's date (unprioritised count as P3). A single video can still have its own date.</p>
    </form>
  );
}

export default function Home({ go }) {
  const { openProduction, setPendingStage, mutate } = useStudio();
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [idea, setIdea] = useState('');
  const load = useCallback(() => api.manager().then((d) => { setM(d); setError(null); }).catch(setError), []);
  useEffect(() => { load(); }, [load]);

  if (!m) return <><PageHead title="Today" /><LoadState error={error} retry={load} /></>;

  const openAt = async (v, step) => { await openProduction(v.id); setPendingStage(step ?? STEP_FOR(v)); go('Create'); };
  const toReview = (mode) => { try { sessionStorage.setItem('plan-view', 'Review'); sessionStorage.setItem('review-mode', mode); } catch { /* storage blocked */ } go('Plan'); };
  const saveDeadlines = async (form) => {
    try { const r = await mutate(() => api.setDeadlines(form), null); setM(r.data); setEditing(false); } catch { /* reported */ }
  };
  const makeVoice = async () => {
    const ids = m.queues.makeVoice.ids;
    if (!window.confirm(`Make your voice for ${ids.length} video${ids.length === 1 ? '' : 's'}? It runs free on this Mac — leave it overnight. You still listen and approve.`)) return;
    try { await mutate(() => api.queueVoice(ids), null); } catch { /* reported */ }
  };
  const park = async (e) => {
    e.preventDefault();
    const text = idea.trim();
    if (!text) return;
    setIdea('');
    try { await mutate(() => api.addIdea({ text }), null); } catch { setIdea(text); }
  };
  const hasDates = Object.keys(m.deadlines ?? {}).length > 0;
  const Q = m.queues;
  const queue = (key, label, hint, action) => (Q[key]?.count > 0) && (
    <button key={key} type="button" onClick={action}
      className="text-left p-[12px_14px] rounded-lg border border-solid border-line bg-surface hover:border-line-2 hover:[box-shadow:var(--shadow)] flex flex-col gap-[3px]">
      <span className="text-[22px] font-[640] [font-variant-numeric:tabular-nums] text-ink leading-none">{Q[key].count}</span>
      <span className="text-[13px] font-[560] text-ink">{label}</span>
      <span className="text-[11.5px] text-muted flex items-center gap-[4px]">{hint} <ArrowRight size={11} /></span>
    </button>
  );
  const row = (v, right) => (
    <li key={v.id}>
      <button type="button" onClick={() => openAt(v)}
        className="w-full grid grid-cols-[64px_minmax(0,1fr)_auto] gap-[10px] items-center text-left p-[8px_12px] bg-transparent [border:0] rounded-none hover:bg-surface-2">
        <code className="text-[11.5px] font-semibold text-ink-2">{v.videoId}</code>
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-ink">{v.name}</span>
          <span className="block text-[11.5px] text-muted truncate">{v.company}{v.priority ? ` · ${v.priority}` : ''} · next: {NEXT_WORDS[v.stage] ?? v.stage}</span>
        </span>
        {right}
      </button>
    </li>
  );

  return (
    <>
      <PageHead title="Today" lead={`${m.totals.done} of ${m.totals.videos} videos done · ${m.totals.left} to go`} />

      {/* ---- the deadlines, and whether you will make them */}
      {!hasDates || editing ? (
        <section className="mb-[18px]">
          {!hasDates && <p className="text-[13.5px] text-ink-2 m-[0_0_8px]"><CalendarDays size={14} className="inline -mt-[2px]" /> Set when each priority must be done, and this page tells you every day whether you are on pace.</p>}
          <DeadlineForm deadlines={m.deadlines ?? {}} onSave={saveDeadlines} onCancel={hasDates ? () => setEditing(false) : null} />
        </section>
      ) : (
        <section className="mb-[18px]">
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-[10px] lte800:grid-cols-[1fr]">
            {m.groups.map((g) => {
              const st = STATUS[g.status];
              const pct = g.total ? Math.round((g.done / g.total) * 100) : 0;
              return (
                <div key={g.priority} className="p-[12px_14px] rounded-lg border border-solid border-line bg-surface">
                  <div className="flex items-baseline justify-between">
                    <b className="text-[14px]">{g.priority}</b>
                    <span className={`text-[12px] font-semibold ${st.tone}`}>{st.label}</span>
                  </div>
                  <div className="text-[12.5px] text-muted mt-[2px]">{g.done} of {g.total} done{g.due ? ` · due ${fmtDate(g.due)}` : ''}</div>
                  <div className="h-[6px] rounded-full bg-canvas mt-[8px] overflow-hidden"><div className={`h-full ${st.bar}`} style={{ width: `${pct}%` }} /></div>
                  {g.left > 0 && g.needPerWeek != null && (
                    <div className="text-[12.5px] mt-[8px] text-ink-2">
                      Need <b>{g.needPerWeek}/week</b> · you're finishing {m.pacePerWeek}/week
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="flex flex-wrap items-center gap-x-[10px] text-[12px] text-muted m-[8px_0_0]">
            {m.projected ? <>At your current pace the whole register is done around <b className="text-ink-2">{fmtDate(m.projected)}</b>.</> : 'No videos finished in the last four weeks — no pace yet.'}
            <button className="ghostbtn text-[12px] text-accent p-0" onClick={() => setEditing(true)}>change deadlines</button>
          </p>
        </section>
      )}

      {/* ---- the queues: each one click into the work */}
      <h2 className="text-[13px] tracking-[.04em] uppercase text-faint font-semibold m-[6px_0_8px]">Waiting on you</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-[10px]">
        {queue('approve', 'Scripts to approve', 'Review', () => toReview('ready'))}
        {queue('checks', 'Scripts with checks', 'Answer them', () => toReview('checks'))}
        {queue('makeVoice', 'Voices to make', 'Make overnight', makeVoice)}
        {queue('approveVoice', 'Voices to approve', 'Listen', () => openAt(Q.approveVoice.first, 'Voice'))}
        {queue('record', 'To record', Q.record?.count > 1 ? 'Start a recording session' : 'Record', () => {
          // A sitting at the camera works through every video waiting, in due order.
          try { sessionStorage.setItem('record-session', JSON.stringify(Q.record.ids)); } catch { /* storage blocked */ }
          openAt(Q.record.first, 'Make');
        })}
        {queue('render', 'To render', 'Render', () => openAt(Q.render.first, 'Make'))}
        {queue('export', 'To export', 'Edit', () => openAt(Q.export.first, 'Edit'))}
        {queue('publish', 'To publish', 'Finish', () => openAt(Q.publish.first, 'Finish'))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-[16px] mt-[20px] lte960:grid-cols-[1fr]">
        <section>
          <h2 className="text-[13px] tracking-[.04em] uppercase text-faint font-semibold m-[0_0_8px]">Work on next</h2>
          <ol className="list-none p-0 m-0 border border-solid border-line rounded-lg bg-surface [&>li+li]:[border-top:1px_solid_var(--line)]">
            {m.next.map((v) => row(v, <span className={`text-[11.5px] whitespace-nowrap ${v.daysLeft < 0 ? 'text-danger font-semibold' : 'text-faint'}`}>{dueWords(v.daysLeft)}</span>))}
          </ol>
        </section>
        <section className="flex flex-col gap-[16px]">
          {m.lateCount > 0 && (
            <div>
              <h2 className="text-[13px] tracking-[.04em] uppercase text-danger font-semibold m-[0_0_8px]"><AlertCircle size={13} className="inline -mt-[2px]" /> Late · {m.lateCount}</h2>
              <ol className="list-none p-0 m-0 border border-solid border-[#f2ccc9] rounded-lg bg-surface [&>li+li]:[border-top:1px_solid_var(--line)]">
                {m.late.slice(0, 6).map((v) => row(v, <span className="text-[11.5px] text-danger font-semibold">{dueWords(v.daysLeft)}</span>))}
              </ol>
            </div>
          )}
          {m.dueSoonCount > 0 && (
            <div>
              <h2 className="text-[13px] tracking-[.04em] uppercase text-warn font-semibold m-[0_0_8px]"><Clock size={13} className="inline -mt-[2px]" /> Due this week · {m.dueSoonCount}</h2>
              <ol className="list-none p-0 m-0 border border-solid border-line rounded-lg bg-surface [&>li+li]:[border-top:1px_solid_var(--line)]">
                {m.dueSoon.slice(0, 6).map((v) => row(v, <span className="text-[11.5px] text-warn">{dueWords(v.daysLeft)}</span>))}
              </ol>
            </div>
          )}
          {m.stalledCount > 0 && (
            <div>
              <h2 className="text-[13px] tracking-[.04em] uppercase text-faint font-semibold m-[0_0_8px]"><RefreshCw size={13} className="inline -mt-[2px]" /> Stalled · {m.stalledCount}</h2>
              <ol className="list-none p-0 m-0 border border-solid border-line rounded-lg bg-surface [&>li+li]:[border-top:1px_solid_var(--line)]">
                {m.stalled.slice(0, 6).map((v) => row(v, <span className="text-[11.5px] text-muted whitespace-nowrap">untouched {v.idleDays}d</span>))}
              </ol>
            </div>
          )}
          {!m.lateCount && !m.dueSoonCount && !m.stalledCount && (
            <div className="p-[16px] rounded-lg bg-ok-soft text-ok text-[13px]"><Check size={14} className="inline -mt-[2px]" /> Nothing late, nothing due this week, nothing stalled.</div>
          )}
          <form className="flex gap-[8px] items-center" onSubmit={park}>
            <Lightbulb size={15} className="text-faint flex-none" />
            <input className="flex-1 text-[13px]" placeholder="Park an idea for later…" value={idea} onChange={(e) => setIdea(e.target.value)} />
            <button type="submit" disabled={!idea.trim()}>Park it</button>
          </form>
        </section>
      </div>
      {Q.makeVoice?.count > 0 && <p className="text-faint text-[11.5px] mt-[12px]"><Headphones size={11} className="inline -mt-[2px]" /> "Voices to make" runs on this Mac, one line at a time — start it before you stop for the day.</p>}
    </>
  );
}
