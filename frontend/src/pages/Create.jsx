import React, { useState, useEffect } from 'react';
import { AlertCircle, Check, ChevronLeft } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import PlanStage from './PlanStage.jsx';
import ScriptStage from './ScriptStage.jsx';
import SegmentsStage from './SegmentsStage.jsx';
import RenderStage from './RenderStage.jsx';
import EditStage from './EditStage.jsx';
import PublishStage from './PublishStage.jsx';

// Six stages, each one a phase of the production that is open. "Idea" used to
// sit at the front of this row, which put "make a new production" inside the
// row that describes the life of the one you are already working on.
const STAGES = ['Plan', 'Script', 'Segments', 'Render', 'Edit', 'Publish'];

export default function Create({ go }) {
  const [stage, setStage] = useState('Plan');
  const { production, saveState, pendingStage, setPendingStage } = useStudio();

  // Opened from the schedule, which knows where the work is stuck.
  useEffect(() => {
    if (pendingStage && STAGES.includes(pendingStage)) {
      setStage(pendingStage);
      setPendingStage(null);
    }
  }, [pendingStage, setPendingStage]);

  // No open production (a fresh workspace, or the current one failed to load)
  // used to throw here and blank the page.
  if (!production) {
    return (
      <p className="sectionempty">
        No production is open. <button onClick={() => go('Plan')}>Open or start one in Plan</button>
      </p>
    );
  }

  const staleStages = production.stale ?? {};

  return (
    <>
      {/* ONE row: which production, where in it, and whether it saved. These
          were three stacked bands — a title block, a stage bar and a save chip —
          costing about 120px before any of the work appeared. */}
      {/* At ≤1000px the title and six stages cannot honestly share one line:
          the production takes the full first row, the stages the second. */}
      <div className="flex items-center gap-[16px] mb-[16px] pb-[14px] border-b border-b-line [border-bottom-style:solid] lte1000:grid lte1000:grid-cols-[minmax(0,1fr)_auto] lte1000:gap-[10px_16px] lte1000:[align-items:end]">
        <Breadcrumb go={go} />

        {/* The stage bar sits IN the title row rather than under it; stacked, the
            two cost about 120px before any of the work appeared. */}
        <div className="stagebar flex-[1_1_auto] min-w-0 m-0 [&_button]:p-[6px_4px] [&_button]:text-[12.5px] lte1000:col-span-full lte1000:[grid-row:2] lte1000:w-full">
        {STAGES.map((s) => {
          const key = { Script: 'script', Render: 'render', Edit: 'export', Publish: 'publication' }[s];
          const isStale = key && staleStages[key];
          return (
            <button
              key={s}
              className={(stage === s ? 'active' : '') + (isStale ? ' hasstale' : '')}
              onClick={() => setStage(s)}
              title={isStale ? staleStages[key].reason : ''}
            >
              {s}
              {isStale && <i className="staledot" />}
            </button>
          );
        })}
        </div>

        <SaveState state={saveState} />
      </div>


      {stage === 'Plan' && <PlanStage goToStage={setStage} />}
      {stage === 'Script' && <ScriptStage goToStage={setStage} />}
      {stage === 'Segments' && <SegmentsStage />}
      {stage === 'Render' && <RenderStage />}
      {stage === 'Edit' && <EditStage />}
      {stage === 'Publish' && <PublishStage />}
    </>
  );
}

/**
 * The breadcrumb.
 *
 * Campaign and title used to sit inside ONE button that opened a dropdown of
 * every production. It reads as a breadcrumb, so the natural click — the
 * campaign name, to get back — switched productions instead.
 *
 * The dropdown is gone rather than fixed. It was a second copy of Plan →
 * Campaigns: the same productions, grouped the same way, with the same stale
 * counts, plus a "New production" button that also lives there. Going up to
 * the campaign lands on that list, so switching has a home and this row can be
 * what it looks like — a path, not a control.
 */
const CRUMBUP = 'inline-flex items-center gap-[3px] border-0 border-none border-current bg-transparent p-0 text-[11px] tracking-[.01em] max-w-full overflow-hidden text-ellipsis whitespace-nowrap';

function Breadcrumb({ go }) {
  const { production, setPendingView, setPendingCampaign } = useStudio();

  const upToCampaign = () => {
    setPendingView('Campaigns');
    setPendingCampaign(production.campaignId ?? null);
    go?.('Plan');
  };

  return (
    // max-w-[42%]: the title takes only what it needs so a long one cannot push
    // the stage bar off its row. Load-bearing.
    <div className="flex flex-col items-start gap-px min-w-0 flex-[0_1_auto] max-w-[42%] lte1000:max-w-none lte1000:[grid-column:1] lte1000:[grid-row:1]">
      {production.campaignId ? (
        <button
          className={CRUMBUP + ' text-muted cursor-pointer hover:text-ink hover:underline [&_svg]:shrink-0 [&_svg]:text-faint [&:hover_svg]:text-ink'}
          onClick={upToCampaign}
          title={`Back to ${production.campaign}`}
        >
          <ChevronLeft size={11} />
          {production.campaign}
        </button>
      ) : (
        // A one-off has no campaign to go up to. Saying so flatly beats a dead
        // control that looks like the others.
        <span className={CRUMBUP + ' none text-faint cursor-default'}>No campaign</span>
      )}
      <h1 className="m-0 min-w-0 max-w-full text-[19px] whitespace-nowrap overflow-hidden text-ellipsis" title={production.title}>{production.title}</h1>
    </div>
  );
}

// Rendered only in the production header, so its row placement lives here.
const SAVECHIP = 'inline-flex items-center gap-[4px] text-[11.5px] whitespace-nowrap ml-auto flex-none lte1000:[grid-column:2] lte1000:[grid-row:1]';

/** Autosave feedback: silent when idle, transient on success, sticky on failure. */
function SaveState({ state }) {
  if (state === 'idle') return null;
  if (state === 'saving') return <span className={SAVECHIP + ' saving text-muted'}>Saving…</span>;
  if (state === 'failed') return <span className={SAVECHIP + ' failed text-danger bg-danger-soft border border-solid border-[#f2ccc9] rounded-sm p-[3px_8px]'}><AlertCircle size={13} /> Not saved</span>;
  return <span className={SAVECHIP + ' saved text-ok'}><Check size={13} /> Saved</span>;
}
