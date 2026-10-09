import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, ArrowRight, Check, Clock, Headphones, Lightbulb, RefreshCw, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { useDialog } from '../components/Dialog.jsx';
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

function DeadlineForm({ deadlines, onSave, onCancel, first }) {
  const [form, setForm] = useState({ P1: deadlines.P1 ?? '', P2: deadlines.P2 ?? '', P3: deadlines.P3 ?? '' });
  return (
    <form className="flex flex-wrap items-center gap-x-[14px] gap-y-[10px] p-[12px_16px] rounded-lg border border-solid border-line bg-surface"
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      {first && (
        <span className="flex items-center gap-[8px] text-[13px] text-ink font-[560] mr-[4px]" title="Every video is due by its priority's date (unprioritised count as P3). A single video can still have its own date.">
          <CalendarDays size={15} className="text-accent" /> Deadlines
        </span>
      )}
      {['P1', 'P2', 'P3'].map((p) => (
        <label key={p} className="flex items-center gap-[6px] text-[12px] font-semibold text-muted">
          {p}
          <input type="date" className="text-[12.5px] p-[4px_6px] w-[132px]" value={form[p]} onChange={(e) => setForm((f) => ({ ...f, [p]: e.target.value }))} />
        </label>
      ))}
      <span className="ml-auto flex gap-[8px]">
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
        <button className="primary" type="submit">Save</button>
      </span>
    </form>
  );
}

const H = 'text-[11.5px] tracking-[.06em] uppercase text-faint font-semibold m-[0_0_8px] flex items-center gap-[6px]';

export default function Home({ go }) {
  const { openProduction, setPendingStage, setPendingView, setPendingDate, mutate, scopeMode, notify } = useStudio();
  const dialog = useDialog();
  const [m, setM] = useState(null);
  const [week, setWeek] = useState(null);           // the calendar strip and campaigns (the schedule)
  const [weekStart, setWeekStart] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [idea, setIdea] = useState('');
  const load = useCallback(() => api.manager().then((d) => { setM(d); setError(null); }).catch(setError), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let live = true;
    api.schedule(weekStart, scopeMode).then((d) => live && setWeek(d)).catch(() => {});
    return () => { live = false; };
  }, [weekStart, scopeMode]);

  if (!m) return <><PageHead title="Today" /><LoadState error={error} retry={load} /></>;

  const openAt = async (v, step) => { await openProduction(v.id); setPendingStage(step ?? STEP_FOR(v)); go('Create'); };
  const toReview = (mode) => { try { sessionStorage.setItem('plan-view', 'Review'); sessionStorage.setItem('review-mode', mode); } catch { /* storage blocked */ } go('Plan'); };
  const saveDeadlines = async (form) => {
    try { const r = await mutate(() => api.setDeadlines(form), null); setM(r.data); setEditing(false); } catch { /* reported */ }
  };
  const makeVoice = async () => {
    const ids = m.queues.makeVoice.ids;
    if (!await dialog.confirm({ title: `Make the voice for ${ids.length} video${ids.length === 1 ? '' : 's'}?`,
      body: 'Made on this Mac, free, a few seconds a line. You still listen to and approve every line.', confirmLabel: 'Make the voice' })) return;
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
  // Voice approved means ready to render: one decision starts them all. A render
  // spends HeyGen credits, so it asks once, plainly, for the whole batch.
  const renderAll = async () => {
    const n = Q.render.count;
    if (n === 1) { openAt(Q.render.first, 'Make'); return; }
    const budget = await api.budget().catch(() => null);
    if (budget && !budget.set) {
      if (await dialog.confirm({ title: 'Choose a monthly HeyGen limit first', confirmLabel: 'Choose a limit',
        body: 'Renders are charged to your own HeyGen account. Set how much a month the studio may spend there, and a batch can never run past it.' })) {
        try { sessionStorage.setItem('settings-section', 'heygen'); } catch { /* storage blocked */ }
        go('Settings');
      }
      return;
    }
    if (!await dialog.confirm({ title: `Start ${n} renders on HeyGen?`, tone: 'warn', confirmLabel: `Render ${n}`,
      body: `Each render uses your HeyGen credits. Videos without an approved look are skipped and named afterwards.${budget?.set ? ` You have $${budget.remaining.toFixed(2)} of your $${budget.monthlyCap} monthly limit left; renders that would pass it are skipped.` : ''}` })) return;
    const skipped = [];
    let started = 0;
    for (const id of Q.render.ids) {
      try { await api.startRender(id, true); started++; } catch (err) { skipped.push(err.message); }
    }
    notify(`${started} render${started === 1 ? '' : 's'} started${skipped.length ? ` · ${skipped.length} skipped — ${skipped[0]}` : ''}`, skipped.length ? 'error' : 'ok');
  };
  const fitDrafts = async () => {
    const n = Q.fit.count;
    if (!await dialog.confirm({ title: `Fit ${n} draft${n === 1 ? '' : 's'} to time?`, confirmLabel: 'Fit to time',
      body: 'Each is rewritten on this Mac, about a minute a video, and kept as a new draft you can compare, keep or undo. Nothing is approved — leave it running overnight.' })) return;
    await mutate(() => api.queueEnhance(Q.fit.ids), null).catch(() => {});
  };
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

  const openDay = (date) => { setPendingView('Calendar'); setPendingDate(date); go('Plan'); };
  const alerts = m.lateCount > 0 || m.dueSoonCount > 0 || m.stalledCount > 0;
  const campaigns = (week?.byCampaign ?? []).filter((c) => c.productions > 0)
    .sort((a, b) => (b.blocked - a.blocked) || ((a.nextDue ?? 1e9) - (b.nextDue ?? 1e9)));

  return (
    <>
      <PageHead title="Today" lead={`${m.totals.done} of ${m.totals.videos} videos done · ${m.totals.left} to go`} />

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-[22px] items-start lte960:grid-cols-[1fr]">
        {/* ================= the work ================= */}
        <div className="flex flex-col gap-[22px] min-w-0">
          {!hasDates || editing ? (
            <DeadlineForm first={!hasDates} deadlines={m.deadlines ?? {}} onSave={saveDeadlines} onCancel={hasDates ? () => setEditing(false) : null} />
          ) : (
            <section>
              <h2 className={H}>Pace <button className="ghostbtn ml-auto p-0 text-[11.5px] normal-case tracking-normal font-normal text-muted hover:text-ink" onClick={() => setEditing(true)}>change deadlines</button></h2>
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
                      <div className="text-[12.5px] text-muted mt-[2px]">{g.done} of {g.total}{g.due ? ` · due ${fmtDate(g.due)}` : ''}</div>
                      <div className="h-[5px] rounded-full bg-canvas mt-[8px] overflow-hidden"><div className={`h-full ${st.bar}`} style={{ width: `${pct}%` }} /></div>
                      {g.left > 0 && g.needPerWeek != null && (
                        <div className="text-[12px] mt-[8px] text-ink-2">Need <b>{g.needPerWeek}/wk</b> · doing {m.pacePerWeek}/wk</div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[12px] text-muted m-[8px_0_0]">
                {m.projected ? <>At this pace everything is done around <b className="text-ink-2">{fmtDate(m.projected)}</b>.</> : 'Nothing finished in the last four weeks — no pace yet.'}
              </p>
            </section>
          )}

          <section>
            <h2 className={H}>Waiting on you</h2>
            {/* auto-fit: however many queues there are, they fill the row. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[10px]">
              {queue('approve', 'Scripts to approve', 'Review', () => toReview('ready'))}
              {queue('checks', 'Scripts with checks', 'Answer them', () => toReview('checks'))}
              {queue('fit', 'Drafts off length', 'Fit to time tonight', fitDrafts)}
              {queue('makeVoice', 'Voices to make', 'Make overnight', makeVoice)}
              {queue('approveVoice', 'Voices to approve', 'Listen', () => toReview('voice'))}
              {queue('record', 'To record', Q.record?.count > 1 ? 'Recording session' : 'Record', () => {
                // A sitting at the camera works through every video waiting, in due order.
                try { sessionStorage.setItem('record-session', JSON.stringify(Q.record.ids)); } catch { /* storage blocked */ }
                openAt(Q.record.first, 'Make');
              })}
              {queue('render', 'Ready to render', Q.render?.count > 1 ? 'Render all' : 'Render', renderAll)}
              {queue('export', 'To export', 'Edit', () => openAt(Q.export.first, 'Edit'))}
              {queue('publish', 'To publish', 'Finish', () => openAt(Q.publish.first, 'Finish'))}
            </div>
            {Q.makeVoice?.count > 0 && <p className="text-faint text-[11.5px] m-[8px_0_0]"><Headphones size={11} className="inline -mt-[2px]" /> Voices are made on this Mac, one line at a time — start them before you stop for the day.</p>}
          </section>

          <section>
            <h2 className={H}>Work on next</h2>
            <ol className="list-none p-0 m-0 border border-solid border-line rounded-lg bg-surface [&>li+li]:[border-top:1px_solid_var(--line)]">
              {m.next.map((v) => row(v, <span className={`text-[11.5px] whitespace-nowrap ${v.daysLeft < 0 ? 'text-danger font-semibold' : 'text-faint'}`}>{dueWords(v.daysLeft)}</span>))}
            </ol>
          </section>
        </div>

        {/* ================= the sidebar: the calendar and the big picture ================= */}
        <aside className="flex flex-col gap-[22px] min-w-0">
          {week && (
            <section>
              <h2 className={H}>
                <CalendarDays size={13} /> Week {week.week.number}
                <span className="normal-case tracking-normal font-normal text-muted">{week.week.isCurrent ? 'this week' : `${week.week.start} → ${week.week.end}`}</span>
                <span className="ml-auto flex gap-[2px]">
                  <button className="ghostbtn p-[2px]" aria-label="Previous week" onClick={() => setWeekStart(week.week.prev)}><ChevronLeft size={14} /></button>
                  {!week.week.isCurrent && <button className="ghostbtn p-[1px_5px] text-[11px] normal-case tracking-normal" onClick={() => setWeekStart(null)}>Today</button>}
                  <button className="ghostbtn p-[2px]" aria-label="Next week" onClick={() => setWeekStart(week.week.next)}><ChevronRight size={14} /></button>
                </span>
              </h2>
              <div className="grid grid-cols-[repeat(7,1fr)] gap-[4px] p-[8px] rounded-lg border border-solid border-line bg-surface">
                {week.calendar.map((d) => (
                  <button key={d.date} type="button" onClick={() => openDay(d.date)}
                    title={d.count ? `${d.count} due ${d.date} — open in the calendar` : `Nothing on ${d.date} — open the calendar to put something here`}
                    className={'flex flex-col items-center p-[6px_0_7px] rounded border border-solid '
                      + (d.isToday ? 'border-ink ' : 'border-transparent hover:border-line ')
                      + (d.count ? 'bg-accent-soft' : 'bg-transparent')}>
                    <i className="not-italic text-[9.5px] uppercase tracking-[.04em] text-faint">{d.weekday}</i>
                    <b className={'text-[15px] font-[560] leading-[1.3] ' + (d.isWeekend && !d.isToday ? 'text-faint' : 'text-ink')}>{d.dayOfMonth}</b>
                    <em className={'not-italic text-[10px] font-semibold rounded-full min-w-[16px] px-[4px] leading-[16px] '
                      + (d.count ? 'bg-accent text-white' : 'text-transparent')}>{d.count || '·'}</em>
                  </button>
                ))}
              </div>
              <button className="ghostbtn p-0 mt-[6px] text-[11.5px] text-muted hover:text-ink" onClick={() => openDay(null)}>
                Open the calendar <ArrowRight size={11} className="inline" />
              </button>
            </section>
          )}

          {alerts ? (
            <>
              {m.lateCount > 0 && (
                <section>
                  <h2 className={H + ' !text-danger'}><AlertCircle size={13} /> Late · {m.lateCount}</h2>
                  <ol className="list-none p-0 m-0 border border-solid border-[#f2ccc9] rounded-lg bg-surface [&>li+li]:[border-top:1px_solid_var(--line)]">
                    {m.late.slice(0, 5).map((v) => row(v, <span className="text-[11.5px] text-danger font-semibold">{dueWords(v.daysLeft)}</span>))}
                  </ol>
                </section>
              )}
              {m.dueSoonCount > 0 && (
                <section>
                  <h2 className={H + ' !text-warn'}><Clock size={13} /> Due this week · {m.dueSoonCount}</h2>
                  <ol className="list-none p-0 m-0 border border-solid border-line rounded-lg bg-surface [&>li+li]:[border-top:1px_solid_var(--line)]">
                    {m.dueSoon.slice(0, 5).map((v) => row(v, <span className="text-[11.5px] text-warn">{dueWords(v.daysLeft)}</span>))}
                  </ol>
                </section>
              )}
              {m.stalledCount > 0 && (
                <section>
                  <h2 className={H}><RefreshCw size={13} /> Stalled · {m.stalledCount}</h2>
                  <ol className="list-none p-0 m-0 border border-solid border-line rounded-lg bg-surface [&>li+li]:[border-top:1px_solid_var(--line)]">
                    {m.stalled.slice(0, 5).map((v) => row(v, <span className="text-[11.5px] text-muted whitespace-nowrap">idle {v.idleDays}d</span>))}
                  </ol>
                </section>
              )}
            </>
          ) : (
            <p className="m-0 text-[12.5px] text-ok flex items-center gap-[6px]"><Check size={14} /> Nothing late, due this week or stalled.</p>
          )}

          {campaigns.length > 0 && (
            <section>
              <h2 className={H}>By campaign <span className="normal-case tracking-normal font-normal text-muted">{campaigns.length}</span></h2>
              <ul className="list-none p-0 m-0 border border-solid border-line rounded-lg bg-surface max-h-[340px] overflow-y-auto [&>li+li]:[border-top:1px_solid_var(--line)]">
                {campaigns.map((c) => {
                  const seg = (n) => `${(n / (c.productions || 1)) * 100}%`;
                  return (
                    <li key={c.id ?? 'none'}>
                      <button type="button" onClick={() => go('Plan')} className="w-full text-left p-[8px_12px] border-0 rounded-none bg-transparent hover:bg-surface-2"
                        title={`planning ${c.stages.planning} · scripted ${c.stages.scripted} · rendering ${c.stages.rendering} · done ${c.stages.done}`}>
                        <span className="flex items-baseline gap-[8px]">
                          <b className="text-[12.5px] font-[540] text-ink truncate flex-1">{c.name}</b>
                          <span className="text-[11px] text-faint whitespace-nowrap [font-variant-numeric:tabular-nums]">{c.stages.done}/{c.productions}</span>
                          {c.blocked > 0 && <em className="not-italic text-[11px] text-warn whitespace-nowrap" title="The next step on these is yours — an approval or an answer">{c.blocked} need you</em>}
                        </span>
                        <span className="flex h-[4px] rounded-full overflow-hidden bg-line mt-[6px]">
                          <i className="block h-full bg-line-2" style={{ width: seg(c.stages.planning) }} />
                          <i className="block h-full bg-warn" style={{ width: seg(c.stages.scripted) }} />
                          <i className="block h-full bg-accent" style={{ width: seg(c.stages.rendering) }} />
                          <i className="block h-full bg-ok" style={{ width: seg(c.stages.done) }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <form className="flex gap-[8px] items-center" onSubmit={park}>
            <Lightbulb size={15} className="text-faint flex-none" />
            <input className="flex-1 min-w-0 text-[13px]" placeholder="Park an idea for later…" value={idea} onChange={(e) => setIdea(e.target.value)} />
            <button type="submit" disabled={!idea.trim()}>Park</button>
          </form>
        </aside>
      </div>
    </>
  );
}
