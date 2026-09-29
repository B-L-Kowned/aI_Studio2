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
            <b className="monthlabel">{label}</b>
            <button onClick={() => setMonthKey(shiftMonth(monthKey, 1))}><ChevronRight size={14} /></button>
          </>
        }
      />

      <div className="calstats">
        <span><b>{counts.scheduled}</b> scheduled</span>
        <span className={counts.late ? 'bad' : 'zero'}><b>{counts.late}</b> late</span>
        <span className={counts.readyToPublish ? 'good' : 'zero'}>
          <b>{counts.readyToPublish}</b> ready to publish
        </span>
        <span className={counts.published ? 'good' : 'zero'}><b>{counts.published}</b> published</span>
      </div>

      <div className="calgrid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <span className="calhead" key={d}>{d}</span>
        ))}

        {days.map((d) => (
          <div
            className={'calday' + (d.inMonth ? '' : ' out') + (d.isToday ? ' today' : '')
              + (d.isWeekend ? ' weekend' : '') + (highlight === d.date ? ' picked' : '')}
            key={d.date}
          >
            <span className="caldate">{d.dayOfMonth}</span>

            {/* Every in-month day takes work. This is the gesture people
                actually reach for on a calendar, and it did not exist: days
                were containers, never targets, so an empty day was inert and
                scheduling meant scrolling past the whole grid to a list. */}
            {d.inMonth && (
              <button
                className="caladdbtn"
                title={`Put a production on ${d.date}`}
                aria-label={`Put a production on ${d.date}`}
                onClick={() => setAddingOn(addingOn === d.date ? null : d.date)}
              >
                <Plus size={12} />
              </button>
            )}

            {addingOn === d.date && (
              <div className="caladd" onKeyDown={(e) => e.key === 'Escape' && setAddingOn(null)}>
                {unscheduled.length === 0 ? (
                  <p className="muted">Everything already has a date.</p>
                ) : (
                  <>
                    <small>Put on {d.date}</small>
                    {/* Not capped. With fifty companies a list that silently
                        stops at ten hides the thing you are looking for. */}
                    <div className="caladdlist">
                      {unscheduled.map((u) => (
                        <button key={u.id} onClick={() => putOnDay(u.id, d.date)}>
                          {u.title}
                          <i>{u.campaign ?? 'No campaign'}</i>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {d.items.map((i) => (
              <button
                className={'calitem ' + (STAGE[i.stage]?.tone ?? '') + (i.late ? ' late' : '')}
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
          <div className="schedlist">
            {unscheduled.map((p) => (
              <div className="schedrow tight" key={p.id}>
                <span className="schedwho">
                  <b>{p.title}</b>
                  <i>{p.campaign ?? 'No campaign'} · {STAGE[p.stage]?.label}</i>
                </span>
                {scheduling === p.id ? (
                  <input
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
