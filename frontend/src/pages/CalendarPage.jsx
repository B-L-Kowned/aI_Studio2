import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ArrowRight, CalendarDays, Plus } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section, PageHead } from '../components/Section.jsx';

/**
 * The production calendar.
 *
 * It used to be 28 fixture rows keyed by an integer day-of-month — a shape that
 * cannot be overdue, cannot express "next Tuesday" and cannot point at a
 * production. So it showed a tidy month of things that did not exist while the
 * real deadlines lived nowhere.
 *
 * A day now holds the productions due on it, coloured by how far along each one
 * actually is, and every entry carries the next step and the stage that step
 * lives on — so the calendar is a way INTO the work rather than a picture of it.
 */
const STAGE = {
  planning:  { label: 'Planning',  tone: 'plan' },
  scripted:  { label: 'Scripted',  tone: 'script' },
  ready:     { label: 'Ready',     tone: 'ready' },
  rendered:  { label: 'Rendered',  tone: 'rend' },
  exported:  { label: 'Exported',  tone: 'export' },
  published: { label: 'Published', tone: 'done' },
};

// Colour is the pipeline position, so a month reads as progress. The left edge
// carries it; `border: 0` leaves the other three sides in currentcolor.
// Written out in full so Tailwind can see every class.
const ITEM_TONE = {
  plan:   '[border-color:currentcolor_currentcolor_currentcolor_var(--line-2)] bg-canvas text-ink-2',
  script: '[border-color:currentcolor_currentcolor_currentcolor_var(--warn)] bg-canvas text-ink-2',
  ready:  '[border-color:currentcolor_currentcolor_currentcolor_var(--accent)] bg-canvas text-ink-2',
  rend:   '[border-color:currentcolor_currentcolor_currentcolor_var(--accent)] bg-accent-soft text-ink-2',
  export: '[border-color:currentcolor_currentcolor_currentcolor_var(--ok)] bg-ok-soft text-ink-2',
  done:   '[border-color:currentcolor_currentcolor_currentcolor_var(--ok)] bg-ok-soft text-ok',
  late:   '[border-color:currentcolor_currentcolor_currentcolor_var(--danger)] bg-danger-soft text-danger',
};

// A zero is not news, so it is dimmed rather than coloured.
const statSpan = (n, tone) => (n ? tone : 'text-faint font-[500]');
const statB = (n, color) =>
  'text-[16px] mr-[5px] ' + (n ? 'font-semibold ' + color : 'text-faint font-[500]');

const shiftMonth = (key, by) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function CalendarPage({ go }) {
  const {
    openProduction, setPendingStage, mutate, pendingDate, setPendingDate, scopeMode,
  } = useStudio();
  // Seeded from the day that was clicked elsewhere, so the FIRST fetch asks for
  // the right month. Setting it in an effect afterwards raced the initial load:
  // the load started with monthKey=null (the current month), the effect set
  // October, and then the September response landed and called setMonthKey with
  // its own month, overwriting it. Clicking 1 October from the dashboard left
  // you in September looking at 1 October as a greyed-out trailing day — a cell
  // that, being out of month, has no add button either.
  const [monthKey, setMonthKey] = useState(() => (pendingDate ? pendingDate.slice(0, 7) : null));
  const [data, setData] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const [highlight, setHighlight] = useState(null);
  // Which day cell is open for "put something here". A calendar whose days are
  // not targets is a picture of a calendar: the only way to schedule anything
  // used to be a capped list below the month grid.
  const [addingOn, setAddingOn] = useState(null);

  const load = useCallback(
    // `?? d.month` and not `= d.month`: the response may only ever FILL IN a
    // month nobody asked for. A response must not overwrite a month that was
    // explicitly requested, or a late reply silently navigates you.
    () => api.calendar(monthKey, scopeMode)
      .then((d) => { setData(d); setMonthKey((k) => k ?? d.month); }),
    [monthKey, scopeMode]
  );
  useEffect(() => { load(); }, [load]);

  // Arrived from a day someone clicked elsewhere: open that month and say which
  // day it was, so the answer is visible rather than merely present.
  useEffect(() => {
    if (!pendingDate) return;
    setMonthKey(pendingDate.slice(0, 7));   // for arrivals after the first load
    setHighlight(pendingDate);
    setPendingDate(null);
  }, [pendingDate, setPendingDate]);

  const open = async (id, stage) => {
    await openProduction(id);
    if (stage) setPendingStage(stage);
    go('Create');
  };

  const putOnDay = async (id, date) => {
    setAddingOn(null);
    try { await mutate(() => api.setDueDate(id, date), null); await load(); }
    catch { /* mutate reports it */ }
  };

  const schedule = async (id, date) => {
    setScheduling(null);
    try { await mutate(() => api.setDueDate(id, date || null), null); await load(); }
    catch { /* mutate reports it */ }
  };

  if (!data) return <p className="muted">Loading…</p>;
  const { days, label, counts, unscheduled } = data;

  return (
    <>
      <PageHead
        title="Production calendar"
        lead="What lands when, and what it still needs before it can."
        actions={
          <>
            <button onClick={() => setMonthKey(shiftMonth(monthKey, -1))}><ChevronLeft size={14} /></button>
            <b className="text-[13px] min-w-[140px] text-center">{label}</b>
            <button onClick={() => setMonthKey(shiftMonth(monthKey, 1))}><ChevronRight size={14} /></button>
          </>
        }
      />

      <div className="flex gap-[18px] m-[0_0_14px] text-[12px] text-muted">
        <span><b className={statB(1, 'text-ink')}>{counts.scheduled}</b> scheduled</span>
        <span className={statSpan(counts.late, '')}>
          <b className={statB(counts.late, 'text-danger')}>{counts.late}</b> late
        </span>
        <span className={statSpan(counts.readyToPublish, 'good')}>
          <b className={statB(counts.readyToPublish, 'text-ok')}>{counts.readyToPublish}</b> ready to publish
        </span>
        <span className={statSpan(counts.published, 'good')}>
          <b className={statB(counts.published, 'text-ok')}>{counts.published}</b> published
        </span>
      </div>

      <div className="grid grid-cols-[repeat(7,1fr)] gap-[1px] bg-line border border-solid border-line rounded overflow-hidden mb-[20px]">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <span className="bg-surface-2 p-[7px_8px] text-[10.5px] uppercase tracking-[.04em] text-muted" key={d}>{d}</span>
        ))}

        {days.map((d) => (
          <div
            // relative: the day cell is what the add popover anchors to.
            className={'group relative min-h-[92px] p-[6px] flex flex-col gap-[3px]'
              + (d.inMonth ? '' : ' out') + (d.isToday ? ' today' : '')
              + (highlight === d.date ? ' picked' : '')
              // Days from the neighbouring months are shown, not hidden.
              + (highlight === d.date ? ' bg-accent-soft' : !d.inMonth ? ' bg-canvas'
                : d.isWeekend ? ' bg-surface-2' : ' bg-surface')
              + (highlight === d.date ? ' [box-shadow:inset_0_0_0_2px_var(--accent)]'
                : d.isToday ? ' [box-shadow:inset_0_0_0_2px_var(--ink)]' : '')}
            key={d.date}
          >
            <span
              className={'font-mono text-[11px] not-italic leading-[normal] '
                + (d.isToday ? 'text-ink font-semibold' : !d.inMonth ? 'text-line-2 font-normal' : 'text-faint font-normal')}
            >{d.dayOfMonth}</span>

            {/* Every in-month day takes work. This is the gesture people
                actually reach for on a calendar, and it did not exist: days
                were containers, never targets, so an empty day was inert and
                scheduling meant scrolling past the whole grid to a list. */}
            {d.inMonth && (
              <button
                className="absolute top-[3px] right-[3px] inline-flex items-center justify-center w-[18px] h-[18px] p-0 [border:0] rounded-sm bg-transparent text-faint opacity-0 cursor-pointer group-hover:opacity-100 focus-visible:opacity-100 hover:bg-canvas hover:text-ink"
                title={`Put a production on ${d.date}`}
                aria-label={`Put a production on ${d.date}`}
                onClick={() => setAddingOn(addingOn === d.date ? null : d.date)}
              >
                <Plus size={12} />
              </button>
            )}

            {addingOn === d.date && (
              <div
                className="absolute top-[22px] left-[4px] right-[4px] z-30 bg-surface border border-solid border-line rounded-sm [box-shadow:0_8px_24px_rgb(0_0_0/0.14)] p-[6px] min-w-[190px]"
                onKeyDown={(e) => e.key === 'Escape' && setAddingOn(null)}>
                {unscheduled.length === 0 ? (
                  <p className="muted m-0 p-[4px] text-[11.5px]">Everything already has a date.</p>
                ) : (
                  <>
                    <small className="block text-faint text-[10.5px] p-[2px_4px_5px]">Put on {d.date}</small>
                    {/* Not capped. With fifty companies a list that silently
                        stops at ten hides the thing you are looking for. */}
                    {/* Scrolls rather than truncating. */}
                    <div className="flex flex-col max-h-[210px] overflow-y-auto">
                      {unscheduled.map((u) => (
                        <button
                          className="block w-full text-left [border:0] bg-transparent cursor-pointer p-[5px_6px] rounded-sm text-[12px] text-ink [&:hover:not(:disabled)]:bg-canvas"
                          key={u.id}
                          onClick={() => putOnDay(u.id, d.date)}
                        >
                          {u.title}
                          <i className="block not-italic text-faint text-[10.5px]">{u.campaign ?? 'No campaign'}</i>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {d.items.map((i) => (
              <button
                className={'[border-style:none_none_none_solid] [border-width:0_0_0_3px] rounded-[3px] p-[3px_6px] text-[11px] text-left truncate '
                  + '[&:hover:not(:disabled)]:bg-surface-2 [&:hover:not(:disabled)]:text-ink '
                  + (STAGE[i.stage]?.tone === 'rend' ? '' : (STAGE[i.stage]?.tone ?? '')) + ' '
                  + ITEM_TONE[i.late ? 'late' : STAGE[i.stage]?.tone ?? 'plan']}
                key={i.id}
                title={`${i.title}\n${i.campaign ?? 'No campaign'}\n${STAGE[i.stage]?.label}`
                  + (i.action ? ` — next: ${i.action}` : ' — done')}
                onClick={() => open(i.id, i.where)}
              >
                {i.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* A production with no date is invisible on a calendar, which is exactly
          how things get forgotten. They are listed here so a date is one click
          away rather than somewhere else entirely. */}
      {unscheduled.length > 0 && (
        <Section
          title="Not scheduled"
          meta={`${unscheduled.length} without a date`}
          flush
        >
          <div className="flex flex-col">
            {unscheduled.map((p) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-[14px] items-center p-[11px_14px] [border-top:1px_solid_var(--line)] first:[border-top:0] lte900:gap-y-[8px]"
                key={p.id}
              >
                <span className="flex flex-col gap-[1px] min-w-0">
                  <b className="text-[13.5px] font-[550] truncate">{p.title}</b>
                  <i className="not-italic text-[11px] text-faint truncate">{p.campaign ?? 'No campaign'} · {STAGE[p.stage]?.label}</i>
                </span>
                {scheduling === p.id ? (
                  <input
                    className="text-[12.5px] p-[5px_8px]"
                    type="date"
                    autoFocus
                    onChange={(e) => schedule(p.id, e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setScheduling(null)}
                  />
                ) : (
                  <button onClick={() => setScheduling(p.id)}>
                    <CalendarDays size={13} /> Put it on a day
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
