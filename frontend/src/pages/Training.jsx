import React, { useEffect, useState } from 'react';
import {
  GraduationCap, Check, Clock, AlertCircle, ChevronUp, ChevronDown,
  ArrowUpDown, X, Plus,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { PageHead, Section, Empty } from '../components/Section.jsx';

/**
 * Training — the content program's view of the collection hierarchy.
 *
 * A course IS a campaign and a lesson IS a production. No separate Course →
 * Module → Lesson tree: that engine is legacy and was never migrated, and a
 * second hierarchy is a second set of rules to keep in step.
 */
const STATE_TONE = {
  ready: 'ok', stale: 'warn', failed: 'danger',
  rendering: 'busy', approved: 'busy', scripted: 'idle', draft: 'idle',
};
const TONE_COLOR = {
  ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', busy: 'text-accent', idle: 'text-muted',
};
const STATE_ICON = { ready: Check, stale: AlertCircle, failed: AlertCircle };

export default function Training({ go, goView }) {
  const { notify, openProduction } = useStudio();
  const [courses, setCourses] = useState(null);
  const [ordering, setOrdering] = useState(null); // course id being reordered
  const [draft, setDraft] = useState([]);         // lesson ids in the new order

  const load = () => api.trainingCourses().then(setCourses);
  useEffect(() => { load(); }, []);

  if (!courses) return <p className="muted">Loading…</p>;

  const startOrdering = (c) => { setOrdering(c.id); setDraft(c.lessons.map((l) => l.id)); };
  const move = (i, by) => {
    const next = [...draft];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };
  const saveOrder = async (courseId) => {
    try {
      setCourses(await api.reorderCourse(courseId, draft));
      setOrdering(null);
      notify('Order saved', 'ok');
    } catch (e) { notify(e.message, 'error'); }
  };

  const totals = courses.reduce(
    (a, c) => ({ lessons: a.lessons + c.counts.lessons, ready: a.ready + c.counts.ready }),
    { lessons: 0, ready: 0 }
  );

  return (
    <>
      <PageHead
        title="Training"
        lead={
          courses.length
            ? `${courses.length} course${courses.length === 1 ? '' : 's'} · ${totals.ready} of ${totals.lessons} lessons ready`
            : 'Courses are campaigns; lessons are the videos inside them.'
        }
        actions={<button onClick={() => goView?.('Campaigns')}><Plus size={14} /> New course</button>}
      />

      {courses.length === 0 && (
        <Empty icon={GraduationCap} action={
          <button className="primary" onClick={() => goView?.('Campaigns')}>Create a course</button>
        }>
          No courses yet. A course is a campaign in Content mode — its videos become its lessons.
        </Empty>
      )}

      {courses.map((c) => {
        const isOrdering = ordering === c.id;
        const lessons = isOrdering
          ? draft.map((id) => c.lessons.find((l) => l.id === id)).filter(Boolean)
          : c.lessons;

        return (
          <Section
            key={c.id}
            title={c.title}
            meta={
              <>
                <span
                  className="inline-block w-[90px] h-[5px] rounded-[3px] bg-line overflow-hidden align-middle"
                  title={`${c.counts.ready} of ${c.counts.lessons} ready`}>
                  <i className="block h-full bg-ok rounded-[3px]" style={{ width: `${c.percent}%` }} />
                </span>
                <small>{c.percent}%</small>
              </>
            }
            actions={
              c.counts.lessons > 1 && (
                isOrdering ? (
                  <>
                    <button onClick={() => setOrdering(null)}><X size={13} /> Cancel</button>
                    <button className="primary" onClick={() => saveOrder(c.id)}>Save order</button>
                  </>
                ) : (
                  <button onClick={() => startOrdering(c)}>
                    <ArrowUpDown size={13} /> {c.ordered ? 'Reorder' : 'Set an order'}
                  </button>
                )
              )
            }
            flush
          >
            {lessons.length === 0 ? (
              <p className="sectionempty">
                <GraduationCap size={15} /> No lessons yet — assign a video to this course from Campaigns.
              </p>
            ) : (
              <div className="flex flex-col">
                {lessons.map((l, i) => {
                  const I = STATE_ICON[l.state] ?? Clock;
                  return (
                    <div
                      className="grid grid-cols-[26px_minmax(0,1fr)_auto_auto_46px_auto] gap-[12px] items-center p-[9px_14px] [border-top:1px_solid_var(--line)] first:[border-top:0] lte900:grid-cols-[22px_minmax(0,1fr)_auto]"
                      key={l.id}
                    >
                      <span className="font-mono text-[11px] leading-none font-normal not-italic text-faint text-right">{String(i + 1).padStart(2, '0')}</span>

                      <div className="min-w-0 flex flex-col gap-[1px]">
                        <b className="text-[13.5px] font-[550]">{l.title}</b>
                        {l.subtitle && <small className="text-muted text-[11.5px] truncate">{l.subtitle}</small>}
                      </div>

                      <span className="font-mono text-[11.5px] leading-[normal] font-normal not-italic text-faint whitespace-nowrap lte900:hidden">
                        {l.segments.total
                          ? `${l.segments.heard}/${l.segments.total} approved`
                          : 'no segments'}
                      </span>

                      <span
                        className={'inline-flex items-center gap-[4px] text-[11.5px] whitespace-nowrap '
                          + STATE_TONE[l.state] + ' ' + (TONE_COLOR[STATE_TONE[l.state]] ?? 'text-muted')}
                      >
                        <I size={12} /> {l.stateLabel}
                      </span>

                      <span className="font-mono text-[11.5px] leading-[normal] font-normal not-italic text-faint text-right lte900:hidden">{l.runtime}</span>

                      {isOrdering ? (
                        <span className="inline-flex gap-[2px]">
                          <button className="p-[3px_4px]" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                            <ChevronUp size={14} />
                          </button>
                          <button className="p-[3px_4px]" disabled={i === lessons.length - 1} onClick={() => move(i, 1)} title="Move down">
                            <ChevronDown size={14} />
                          </button>
                        </span>
                      ) : (
                        <button onClick={async () => { await openProduction(l.id); go?.('Create'); }}>
                          Open
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!isOrdering && !c.ordered && c.counts.lessons > 1 && (
              <p className="sectionnote">
                Newest first. Set an order to fix the sequence lessons are taught in.
              </p>
            )}
          </Section>
        );
      })}
    </>
  );
}
