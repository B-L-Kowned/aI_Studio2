import React, { useState } from 'react';
import {
  AlertCircle, Loader, Moon, ArrowRight, Lightbulb, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { useResource } from '../hooks/use-resource.js';
import LoadState from '../components/LoadState.jsx';
import { Section, PageHead } from '../components/Section.jsx';

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

const STAT_TONE = { bad: 'text-danger', warn: 'text-warn', good: 'text-ok', '': 'text-ink' };

const ROW = 'grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto_auto] gap-[14px] items-center p-[11px_14px] '
  + '[border-top:1px_solid_var(--line)] first:[border-top:0] '
  + 'lte900:grid-cols-[minmax(0,1fr)_auto] lte900:gap-y-[8px]';
const WHO = 'flex flex-col gap-[1px] min-w-0';
const WHO_B = 'text-[13.5px] font-[550] truncate';
const WHO_I = 'not-italic text-[11px] text-faint truncate';
const WHAT = 'flex items-center gap-[6px] min-w-0 text-[12.5px] text-ink-2 [&>svg]:flex-none [&>svg]:text-warn '
  + 'lte900:col-[1/-1]';

export default function Home({ go }) {
  const {
    openProduction, setPendingStage, setPendingView, setPendingDate, mutate, notify,
    scopeMode,
  } = useStudio();
  const [idea, setIdea] = useState('');
  const [weekStart, setWeekStart] = useState(null);

  // Refetches when the program bubble changes, so the counts in the title
  // and the work queue below always describe the same slate. Paging weeks
  // quickly cannot land an older week over a newer one.
  const { data, error, reload: load } =
    useResource(() => api.schedule(weekStart, scopeMode), [weekStart, scopeMode]);

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

  // Land on the stage where the work is actually stuck, not on Plan every time.
  const open = async (id, stage) => {
    await openProduction(id);
    if (stage) setPendingStage(stage);
    go('Create');
  };

  if (!data) return <LoadState error={error} retry={load} label="Reading the schedule…" />;
  const { counts, needsYou, inFlight, idle, byCampaign, calendar, overdue, week } = data;
  const dueCount = calendar.reduce((n, d) => n + d.count, 0);

  return (
    <>
      {/* The five counts sit where every other page keeps its actions. A zero is
          not news, so it is dimmed rather than given the same weight as a number
          that needs you. */}
      <PageHead
        title="Production schedule"
        lead={`${counts.productions} production${counts.productions === 1 ? '' : 's'} · ${counts.campaigns} campaign${counts.campaigns === 1 ? '' : 's'}`}
        actions={
        <div className="flex gap-[18px] flex-wrap text-[12px] text-muted">
          {[
            ['blocked on you', counts.needsYou, 'bad'],
            ['rendering', counts.inFlight, ''],
            ['ready to render', counts.readyToRender, 'good'],
            ['gone quiet', counts.idle, 'warn'],
            ['overdue', overdue, 'bad'],
          ].map(([label, n, tone]) => (
            // A zero is not news, so it is dimmed.
            <span key={label} className={n ? (tone === 'bad' ? '' : tone) : 'text-faint font-[500]'}>
              <b className={'text-[17px] mr-[5px] '
                + (n ? 'font-semibold ' + STAT_TONE[tone] : 'text-faint font-[500]')}>{n}</b> {label}
            </span>
          ))}
        </div>
        }
      />

      {/* Capture has to be cheaper than the thing it captures. A thought that
          arrives while you are looking at the schedule should land without
          leaving the page — otherwise it becomes a half-started production, or
          nothing at all. */}
      <form
        className="flex items-center gap-[9px] mb-[18px] p-[8px_12px] border border-solid border-line rounded bg-surface-2 [&>svg]:text-faint [&>svg]:flex-none"
        onSubmit={park}
      >
        <Lightbulb size={15} />
        <input
          className="flex-1 [border:0] [background:none] text-[13.5px] p-[3px_0] focus:[outline:none]"
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
        <div className="grid grid-cols-[repeat(7,1fr)] gap-[5px]">
          {calendar.map((d) => (
            <button
              className={'flex flex-col items-center gap-0 p-[8px_4px_9px] rounded border border-solid relative '
                + 'disabled:cursor-default'
                + (d.isToday ? ' today' : '') + (d.count ? ' has' : '')
                + (d.count ? ' border-accent-line [&:hover:not(:disabled)]:border-accent'
                  : d.isToday ? ' border-ink' : ' border-line')
                + (d.count ? ' bg-accent-soft cursor-pointer' : d.isWeekend ? ' bg-surface-2' : ' bg-surface')}
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
              <i className="not-italic text-[10px] uppercase tracking-[.04em] text-faint">{d.weekday}</i>
              <b className={'text-[18px] font-[550] leading-[1.25]'
                + (d.isToday ? ' text-ink' : d.isWeekend ? ' text-faint' : '')}>{d.dayOfMonth}</b>
              <u className="[text-decoration:none] text-[9.5px] uppercase text-faint">{d.monthLabel}</u>
              {d.count > 0 && (
                <em className="not-italic text-[10px] font-semibold text-surface bg-accent rounded-[8px] p-[0_6px] mt-[4px]">
                  {d.count}
                </em>
              )}
            </button>
          ))}
        </div>

        {!dueCount && (
          <p className="sectionnote">
            {counts.productions === 0
              // Telling someone to put a production on a day when they have no
              // productions is advice they cannot take.
              ? 'Nothing here yet. Start a video and it will show up on the week it is due.'
              : 'Nothing due this week. Click any day to put a production on it.'}
          </p>
        )}
      </Section>

      {/* The rollup. Fourteen rows is a queue; at fifty companies the question
          is which COMPANIES are stuck and which are moving. */}
      <Section
        title="By campaign"
        meta={`${byCampaign.length} · a campaign is one company, series or theme`}
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-[10px]">
          {byCampaign.map((c) => {
            const total = c.productions || 1;
            const seg = (n) => `${(n / total) * 100}%`;
            return (
              <button
                className="flex flex-col gap-[8px] items-stretch text-left p-[12px_13px] border border-solid border-line rounded-lg bg-surface cursor-pointer [&:hover:not(:disabled)]:border-line-2 [&:hover:not(:disabled)]:bg-surface-2"
                key={c.id ?? 'none'}
                onClick={() => go('Plan')}
              >
                <span className="flex items-center justify-between gap-[8px]">
                  <b className="text-[13px] font-[550] truncate">{c.name}</b>
                  {c.blocked > 0 && (
                    <em className="not-italic text-[10.5px] whitespace-nowrap text-danger">{c.blocked} stuck</em>
                  )}
                </span>

                <span className="flex h-[6px] rounded-[3px] overflow-hidden bg-line" title={`planning ${c.stages.planning} · scripted ${c.stages.scripted} · rendering ${c.stages.rendering} · done ${c.stages.done}`}>
                  <i className="block h-full bg-line-2" style={{ width: seg(c.stages.planning) }} />
                  <i className="block h-full bg-warn" style={{ width: seg(c.stages.scripted) }} />
                  <i className="block h-full bg-accent" style={{ width: seg(c.stages.rendering) }} />
                  <i className="block h-full bg-ok" style={{ width: seg(c.stages.done) }} />
                </span>

                <span className="text-[11px] text-faint">
                  {/* A campaign you have set up but not filled is the one that
                      most needs saying out loud. "0 videos" reads as a broken
                      count; naming the next move reads as a campaign waiting. */}
                  {c.productions === 0
                    ? <em className="campempty not-italic text-accent">No videos yet — start one</em>
                    : <>
                        {c.productions} video{c.productions === 1 ? '' : 's'}
                        {c.stages.done > 0 && ` · ${c.stages.done} done`}
                        {c.nextDue != null && ` · ${dueWords(c.nextDue)}`}
                      </>}
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
          <div className="flex flex-col">
            {needsYou.slice(0, TOP).map((p) => (
              <div className={ROW} key={p.id}>
                <span className={WHO}>
                  <b className={WHO_B}>{p.title}</b>
                  <i className={WHO_I}>{p.campaign ?? 'No campaign'}</i>
                </span>
                <span className={WHAT}>
                  <AlertCircle size={13} /> {p.top.what}
                  {p.blockers.length > 1 && (
                    <em
                      className="not-italic text-[11px] text-faint border border-solid border-line rounded-[9px] p-[0_6px] flex-none"
                      title={p.blockers.map((b) => b.what).join('\n')}>
                      +{p.blockers.length - 1}
                    </em>
                  )}
                </span>
                {p.dueInDays != null && (
                  <span
                    className={'inline-flex items-center gap-[5px] text-[11.5px] whitespace-nowrap'
                      + (p.dueInDays < 0 ? ' over text-danger font-[550]' : ' text-muted')}
                  >
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
          <div className="flex flex-col">
            {inFlight.map((p) => (
              <div className={ROW} key={p.id}>
                <span className={WHO}>
                  <b className={WHO_B}>{p.title}</b>
                  <i className={WHO_I}>{p.campaign ?? 'No campaign'}</i>
                </span>
                <span className={WHAT}><Loader size={13} /> v{p.version} · {p.status}</span>
                <span className="w-[90px] h-[5px] rounded-[3px] bg-line overflow-hidden">
                  <i className="block h-full bg-accent" style={{ width: `${p.progress ?? 0}%` }} />
                </span>
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
          <div className="flex flex-col">
            {idle.slice(0, TOP).map((p) => (
              <div className={ROW} key={p.id}>
                <span className={WHO}>
                  <b className={WHO_B}>{p.title}</b>
                  <i className={WHO_I}>{p.campaign ?? 'No campaign'}</i>
                </span>
                <span className={WHAT}><Moon size={13} /> {p.idleDays} days</span>
                <button onClick={() => open(p.id)}>Pick it back up</button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
