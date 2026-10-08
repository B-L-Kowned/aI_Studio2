import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Check, ChevronLeft, ArrowRight } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { PageHead, Tabs } from '../components/Section.jsx';
import ScriptStage from './ScriptStage.jsx';
import SegmentsStage from './SegmentsStage.jsx';
import RenderStage from './RenderStage.jsx';
import RecordStage from './RecordStage.jsx';
import EditStage from './EditStage.jsx';
import FinishStage from './FinishStage.jsx';
import ShotList from '../components/ShotList.jsx';

// Five steps, in the order the work happens. Only Make differs by how the
// video is made: Render (HeyGen), Record (you) or Recordings (voice-over).
// The plan — brief, outline, shot list, sources — opens from the Script step.
const STEPS = ['Script', 'Voice', 'Make', 'Edit', 'Finish'];
const STEP_KEY = { Script: 'script', Voice: 'voice', Make: 'make', Edit: 'edit', Finish: 'finish' };
// Older names still arrive from Home, the calendar and inside the stages.
const LEGACY = { Plan: 'Script', Segments: 'Voice', Render: 'Make', Record: 'Make', Publish: 'Finish' };
const toStep = (s) => LEGACY[s] ?? (STEPS.includes(s) ? s : 'Script');
const STALE_KEY = { Script: 'script', Make: 'render', Edit: 'export', Finish: 'publication' };

export default function Create({ go }) {
  const [stage, setStageRaw] = useState('Script');
  const [steps, setSteps] = useState(null);
  const { production, saveState, pendingStage, setPendingStage } = useStudio();
  const setStage = useCallback((s) => setStageRaw(toStep(s)), []);

  // Opened from the schedule, which knows where the work is stuck.
  useEffect(() => {
    if (pendingStage) {
      setStage(pendingStage);
      setPendingStage(null);
    }
  }, [pendingStage, setPendingStage, setStage]);

  // Where each step stands, re-read whenever the step or the production changes.
  const loadSteps = useCallback(() => {
    if (production?.id) api.steps(production.id).then(setSteps).catch(() => setSteps(null));
  }, [production]);
  useEffect(() => { loadSteps(); }, [loadSteps, stage]);

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
  const label = (s) => (s === 'Make' ? steps?.steps.make.label ?? 'Make' : s);
  const made = steps?.madeBy;
  const nextStep = steps?.next ? STEPS.find((s) => STEP_KEY[s] === steps.next) : null;

  return (
    <>
      <PageHead
        eyebrow={<CampaignCrumb go={go} />}
        title={production.title}
        titleHint={production.title}
        actions={<SaveState state={saveState} />}
        tabs={
          <Tabs
            items={STEPS.map((s, i) => {
              const st = steps?.steps[STEP_KEY[s]];
              const stale = STALE_KEY[s] && staleStages[STALE_KEY[s]];
              const optional = st?.optional || st?.required === false;
              return {
                id: s,
                label: (
                  <span className="inline-flex items-center gap-[5px]">
                    {st?.done ? <Check size={13} className="text-ok" /> : <span className="text-faint text-[11px]">{i + 1}</span>}
                    {label(s)}{optional && !st?.done && <span className="text-faint font-normal text-[11px]">optional</span>}
                  </span>
                ),
                stale: !!stale,
                title: stale ? stale.reason : st?.detail ?? '',
              };
            })}
            value={stage}
            onChange={setStage}
          />
        }
      />

      {stage === 'Script' && <ScriptStage goToStage={setStage} />}
      {stage === 'Voice' && <SegmentsStage optional={made === 'self'} />}
      {stage === 'Make' && made === 'self' && <RecordStage goToStage={setStage} />}
      {stage === 'Make' && made === 'voice' && (
        <div className="stagepane">
          <p className="text-[13px] text-muted m-[0_0_12px]">Your voice over screen recordings: record each screen section below. The editor kit lays them out against your approved audio.</p>
          <ShotList />
        </div>
      )}
      {stage === 'Make' && made !== 'self' && made !== 'voice' && <RenderStage />}
      {stage === 'Edit' && <EditStage />}
      {stage === 'Finish' && <FinishStage />}

      {nextStep && nextStep !== stage && (
        <div className="flex items-center justify-end gap-[10px] mt-[16px] text-[12.5px] text-muted">
          <span>{steps.steps[STEP_KEY[nextStep]]?.detail}</span>
          <button className="primary" onClick={() => setStage(nextStep)}>
            {STEPS.indexOf(nextStep) < STEPS.indexOf(stage) ? 'Still to do' : 'Next'}: {label(nextStep)} <ArrowRight size={14} />
          </button>
        </div>
      )}
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
