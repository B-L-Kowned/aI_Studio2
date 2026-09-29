import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle, Loader, Moon, ArrowRight, Lightbulb, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section } from '../components/Section.jsx';

/**
 * The production schedule.
 *
 * This page used to show the pipeline of whichever production happened to be
 * open, workspace facts that belong in Settings, and a templates grid plus
 * quick links that both duplicated the New button. Across fifty companies, "the
 * one I opened last" is the least useful thing on the screen.
 *
 * Work at that scale does not fail because a button was hard to find. It fails
 * because something stalled three weeks ago and nothing said so. So this answers
 * two questions: WHAT IS BLOCKED ON ME, and WHAT IS DUE. Everything a blocker
 * knows — the production, the company, the fix, and the stage the fix lives on —
 * is on the row, because "3 issues" is a number and "cast Narrator" is a job.
 */
const dueWords = (d) => {
  if (d == null) return null;
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  return `due in ${d}d`;
};

// How many rows before this stops being a dashboard and becomes a list.
const TOP = 5;

export default function Home({ go }) {
  const {
    openProduction, setPendingStage, setPendingView, setPendingDate, mutate, notify,
    scopeMode,
  } = useStudio();
  const [data, setData] = useState(null);

  const [idea, setIdea] = useState('');
  const [weekStart, setWeekStart] = useState(null);

  // Refetches when the program bubble changes, so the counts in the title
  // and the work queue below always describe the same slate.
  const load = useCallback(
    () => api.schedule(weekStart, scopeMode).then(setData),
    [weekStart, scopeMode],
  );

  const park = async (e) => {
    e.preventDefault();
    const text = idea.trim();
    if (!text) return;
    setIdea('');
    try {
      await mutate(() => api.addIdea({ text }), null);
      notify('Parked — find it in Plan → Parking lot', 'ok');
      await load();
    } catch { /* mutate reports it */ }
  };
  useEffect(() => { load(); }, [load]);

  // Land on the stage where the work is actually stuck, not on Plan every time.
  const open = async (id, stage) => {
    await openProduction(id);
    if (stage) setPendingStage(stage);
    go('Create');
  };

  if (!data) return <p className="muted">Reading the schedule…</p>;
  const { counts, needsYou, inFlight, idle, byCampaign, calendar, overdue, week } = data;
  const dueCount = calendar.reduce((n, d) => n + d.count, 0);

  return (
    <>
      {/* One row. The title, the scale and the five counts were stacked over
          four lines and a rule, which is a lot of vertical space to say what
          fits across the top of the page. A zero is not news, so it is dimmed
          rather than given the same weight as a number that needs you. */}
      <div className="schedhead">
        <div>
          <h1>Production schedule</h1>
          <small>
            {counts.productions} production{counts.productions === 1 ? '' : 's'} ·{' '}
            {counts.campaigns} campaign{counts.campaigns === 1 ? '' : 's'}
          </small>
        </div>

        <div className="schedstats">
          {[
            ['blocked on you', counts.needsYou, 'bad'],
            ['rendering', counts.inFlight, ''],
            ['ready to render', counts.readyToRender, 'good'],
            ['gone quiet', counts.idle, 'warn'],
            ['overdue', overdue, 'bad'],
          ].map(([label, n, tone]) => (
            <span key={label} className={n ? tone : 'zero'}>
              <b>{n}</b> {label}
            </span>
          ))}
        </div>
      </div>

      {/* Capture has to be cheaper than the thing it captures. A thought that
          arrives while you are looking at the schedule should land without
          leaving the page — otherwise it becomes a half-started production, or
          nothing at all. */}
      <form className="parkline" onSubmit={park}>
        <Lightbulb size={15} />
        <input
          placeholder="Park an idea for later…"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />
        <button type="submit" disabled={!idea.trim()}>Park it</button>
        {data.ideas?.total > 0 && (
          <button
            type="button"
            className="ghostbtn"
            // Land on the LOT, not on Plan's default view. Sending someone to
            // Campaigns after they clicked "1 parked" is why a parked idea read
            // as one that had disappeared.
            onClick={() => { setPendingView('Ideas'); go('Plan'); }}
          >
            {data.ideas.total} parked
            {data.ideas.hot ? ` · ${data.ideas.hot} hot` : ''}
          </button>
        )}
      </form>

      {/* One week, not a fortnight. A week is the unit people plan in, and it
          leaves each day enough room to be clicked and say what is on it. The
          number is the ISO week — the one on everyone else's calendar. */}
      <Section
        title={`Week ${week.number}`}
        meta={week.isCurrent ? 'this week' : `${week.start} → ${week.end}`}
        actions={
          <>
            <button onClick={() => setWeekStart(week.prev)} title="Previous week">
              <ChevronLeft size={14} />
            </button>
            {!week.isCurrent && <button onClick={() => setWeekStart(null)}>Today</button>}
            <button onClick={() => setWeekStart(week.next)} title="Next week">
              <ChevronRight size={14} />
            </button>
          </>
        }
      >
        <div className="weekstrip">
          {calendar.map((d) => (
            <button
              className={'weekday' + (d.isToday ? ' today' : '') + (d.isWeekend ? ' weekend' : '')
                + (d.count ? ' has' : '')}
              key={d.date}
              // An empty day used to be `disabled`, so six or seven of the
              // seven buttons in this strip were dead — it looked like a
              // control and behaved like a picture. An empty day is precisely
              // the one you want to put work on, so it opens the calendar
              // there, where a day can now take a production.
              title={d.count
                ? `Open ${d.date} in the calendar`
                : `Nothing on ${d.date} — open the calendar to put something here`}
              // The calendar is the place that shows a day properly. Expanding
              // a list inline here built a second, worse calendar inside the
              // dashboard and left you somewhere that could not show the rest
              // of the month.
              onClick={() => { setPendingView('Calendar'); setPendingDate(d.date); go('Plan'); }}
            >
              <i>{d.weekday}</i>
              <b>{d.dayOfMonth}</b>
              <u>{d.monthLabel}</u>
              {d.count > 0 && <em>{d.count}</em>}
            </button>
          ))}
        </div>

        {!dueCount && (
          <p className="sectionnote">
            Nothing due this week. Click any day to put a production on it.
          </p>
        )}
      </Section>

      {/* The rollup. Fourteen rows is a queue; at fifty companies the question
          is which COMPANIES are stuck and which are moving. */}
      <Section
        title="By campaign"
        meta={`${byCampaign.length} · a campaign is one company, series or theme`}
      >
        <div className="campgrid">
          {byCampaign.map((c) => {
            const total = c.productions || 1;
            const seg = (n) => `${(n / total) * 100}%`;
            return (
              <button className="campcard" key={c.id ?? 'none'} onClick={() => go('Plan')}>
                <span className="camphead">
                  <b>{c.name}</b>
                  {c.blocked > 0 && <em className="bad">{c.blocked} stuck</em>}
                </span>

                <span className="campbar" title={`planning ${c.stages.planning} · scripted ${c.stages.scripted} · rendering ${c.stages.rendering} · done ${c.stages.done}`}>
                  <i className="s-plan" style={{ width: seg(c.stages.planning) }} />
                  <i className="s-script" style={{ width: seg(c.stages.scripted) }} />
                  <i className="s-rend" style={{ width: seg(c.stages.rendering) }} />
                  <i className="s-done" style={{ width: seg(c.stages.done) }} />
                </span>

                <span className="campfoot">
                  {c.productions} video{c.productions === 1 ? '' : 's'}
                  {c.stages.done > 0 && ` · ${c.stages.done} done`}
                  {c.nextDue != null && ` · ${dueWords(c.nextDue)}`}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Only the top few. The full queue lives in Plan, where you can filter
          it; repeating all fourteen here made this a list, not a dashboard. */}
      {needsYou.length > 0 && (
        <Section
          title="Do these next"
          meta={needsYou.length > TOP ? `${TOP} of ${needsYou.length}` : `${needsYou.length}`}
          actions={needsYou.length > TOP && (
            <button onClick={() => go('Plan')}>See all {needsYou.length}</button>
          )}
          flush
        >
          <div className="schedlist">
            {needsYou.slice(0, TOP).map((p) => (
              <div className="schedrow" key={p.id}>
                <span className="schedwho">
                  <b>{p.title}</b>
                  <i>{p.campaign ?? 'No campaign'}</i>
                </span>
                <span className="schedwhat">
                  <AlertCircle size={13} /> {p.top.what}
                  {p.blockers.length > 1 && (
                    <em title={p.blockers.map((b) => b.what).join('\n')}>
                      +{p.blockers.length - 1}
                    </em>
                  )}
                </span>
                {p.dueInDays != null && (
                  <span className={'scheddue' + (p.dueInDays < 0 ? ' over' : '')}>
                    {dueWords(p.dueInDays)}
                  </span>
                )}
                <button className="primary" onClick={() => open(p.id, p.top.where)}>
                  {p.top.action} <ArrowRight size={13} />
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {inFlight.length > 0 && (
        <Section title="Rendering now" meta="at the provider" flush>
          <div className="schedlist">
            {inFlight.map((p) => (
              <div className="schedrow" key={p.id}>
                <span className="schedwho">
                  <b>{p.title}</b>
                  <i>{p.campaign ?? 'No campaign'}</i>
                </span>
                <span className="schedwhat"><Loader size={13} /> v{p.version} · {p.status}</span>
                <span className="schedprog"><i style={{ width: `${p.progress ?? 0}%` }} /></span>
                <button onClick={() => open(p.id, 'Render')}>Watch</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {idle.length > 0 && (
        <Section
          title="Gone quiet"
          meta={`untouched for ${data.thresholds.idleDays}+ days`}
          flush
        >
          <div className="schedlist">
            {idle.slice(0, TOP).map((p) => (
              <div className="schedrow" key={p.id}>
                <span className="schedwho">
                  <b>{p.title}</b>
                  <i>{p.campaign ?? 'No campaign'}</i>
                </span>
                <span className="schedwhat"><Moon size={13} /> {p.idleDays} days</span>
                <button onClick={() => open(p.id)}>Pick it back up</button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
