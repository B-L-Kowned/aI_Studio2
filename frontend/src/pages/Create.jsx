import React, { useState, useEffect } from 'react';
import { AlertCircle, Check, ChevronLeft } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { PageHead, Tabs } from '../components/Section.jsx';
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
      <PageHead
        eyebrow={<CampaignCrumb go={go} />}
        title={production.title}
        titleHint={production.title}
        actions={<SaveState state={saveState} />}
        tabs={
          <Tabs
            items={STAGES.map((s) => {
              const key = { Script: 'script', Render: 'render', Edit: 'export', Publish: 'publication' }[s];
              const stale = key && staleStages[key];
              return { id: s, label: s, stale: !!stale, title: stale ? stale.reason : '' };
            })}
            value={stage}
            onChange={setStage}
          />
        }
      />

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

function CampaignCrumb({ go }) {
  const { production, setPendingView, setPendingCampaign } = useStudio();

  const upToCampaign = () => {
    setPendingView('Campaigns');
    setPendingCampaign(production.campaignId ?? null);
    go?.('Plan');
  };

  return production.campaignId ? (
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
  );
}

const SAVECHIP = 'inline-flex items-center gap-[4px] text-[11.5px] whitespace-nowrap';

/** Autosave feedback: silent when idle, transient on success, sticky on failure. */
function SaveState({ state }) {
  if (state === 'idle') return null;
  if (state === 'saving') return <span className={SAVECHIP + ' saving text-muted'}>Saving…</span>;
  if (state === 'failed') return <span className={SAVECHIP + ' failed text-danger bg-danger-soft border border-solid border-[#f2ccc9] rounded-sm p-[3px_8px]'}><AlertCircle size={13} /> Not saved</span>;
  return <span className={SAVECHIP + ' saved text-ok'}><Check size={13} /> Saved</span>;
}
