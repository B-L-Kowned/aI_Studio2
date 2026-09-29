import React, { useState, useEffect } from 'react';
import { Check, AlertCircle, ChevronDown, Plus, X } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import PlanStage from './PlanStage.jsx';
import ScriptStage from './ScriptStage.jsx';
import SegmentsStage from './SegmentsStage.jsx';
import RenderStage from './RenderStage.jsx';
import EditStage from './EditStage.jsx';
import PublishStage from './PublishStage.jsx';
import NewProductionFlow from './NewProductionFlow.jsx';

// Six stages, each one a phase of the production that is open. "Idea" used to
// sit at the front of this row, which put "make a new production" inside the
// row that describes the life of the one you are already working on.
const STAGES = ['Plan', 'Script', 'Segments', 'Render', 'Edit', 'Publish'];

export default function Create() {
  const [stage, setStage] = useState('Plan');
  const [creating, setCreating] = useState(false);
  const { production, saveState, workspace, pendingStage, setPendingStage } = useStudio();

  // Opened from the schedule, which knows where the work is stuck.
  useEffect(() => {
    if (pendingStage && STAGES.includes(pendingStage)) {
      setStage(pendingStage);
      setPendingStage(null);
    }
  }, [pendingStage, setPendingStage]);

  const staleStages = production.stale ?? {};

  return (
    <>
      {/* ONE row: which production, where in it, and whether it saved. These
          were three stacked bands — a title block, a stage bar and a save chip —
          costing about 120px before any of the work appeared. */}
      <div className="prodhead">
        <ProductionSwitcher onNew={() => setCreating(true)} />

        <div className="stagebar inline">
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

      {creating && (
        <NewProductionFlow
          canSeries={workspace.capabilities.includes('plan.series')}
          onClose={() => setCreating(false)}
        />
      )}

      {stage === 'Plan' && <PlanStage goToStage={setStage} />}
      {stage === 'Script' && <ScriptStage />}
      {stage === 'Segments' && <SegmentsStage />}
      {stage === 'Render' && <RenderStage />}
      {stage === 'Edit' && <EditStage />}
      {stage === 'Publish' && <PublishStage />}
    </>
  );
}

/** Breadcrumb that opens the list of productions, plus a way to add one. */
function ProductionSwitcher({ onNew }) {
  const [open, setOpen] = useState(false);
  const { production, productions, openProduction } = useStudio();

  const byCampaign = productions.reduce((acc, p) => {
    const key = p.campaign ?? 'No campaign';
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="switcher">
      {/* Reads as a picker, not a heading: the campaign sits above the name and
          the chevron is always visible, so it is obvious this opens something. */}
      <button className="switchbtn" onClick={() => setOpen((v) => !v)} title="Switch production">
        <span className="switchlabel">
          {production.campaign ?? 'No campaign'}
          <ChevronDown size={13} />
        </span>
        <h1>{production.title}</h1>
      </button>

      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="switchpanel">
            <div className="switchhead">
              <b>Productions ({productions.length})</b>
              <button onClick={() => setOpen(false)}><X size={13} /></button>
            </div>

            {Object.entries(byCampaign).map(([campaign, list]) => (
              <div className="switchgroup" key={campaign}>
                <small>{campaign}</small>
                {list.map((p) => (
                  <button
                    key={p.id}
                    className={p.id === production.id ? 'cur' : ''}
                    onClick={async () => { await openProduction(p.id); setOpen(false); }}
                  >
                    <span>
                      {p.title}
                      <i>{p.counts.sections} sections · {p.counts.scenes} scenes</i>
                    </span>
                    {p.id === production.id
                      ? <em className="swcur"><Check size={12} /> open</em>
                      : p.stale > 0
                        ? <em className="swstale" title={`${p.stale} downstream artifact${p.stale > 1 ? 's' : ''} out of date`}>
                            <AlertCircle size={12} /> {p.stale} stale
                          </em>
                        : <em className="swrt">{p.targetRuntime}</em>}
                  </button>
                ))}
              </div>
            ))}

            <button className="switchnew" onClick={() => { setOpen(false); onNew(); }}>
              <Plus size={14} /> New production
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Autosave feedback: silent when idle, transient on success, sticky on failure. */
function SaveState({ state }) {
  if (state === 'idle') return null;
  if (state === 'saving') return <span className="savechip saving">Saving…</span>;
  if (state === 'failed') return <span className="savechip failed"><AlertCircle size={13} /> Not saved</span>;
  return <span className="savechip saved"><Check size={13} /> Saved</span>;
}

