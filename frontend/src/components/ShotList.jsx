import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Check } from 'lucide-react';
import { EnhanceButton, Suggestion, modelLabel } from './Enhance.jsx';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import UploadDrop from './UploadDrop.jsx';

// What a section looks like on screen, and what the editor needs to make it.
const SHOT_HINT = {
  camera: 'PJB speaking to camera in the approved look',
  screen: 'What to record, step by step — e.g. Sign in → create a goal → invite a partner',
  diagram: 'What the graphic shows — e.g. three layers: parent → verticals → city',
  broll: 'Footage to use — e.g. a homeowner at the front door',
  title: 'Words on the card',
};
const SHOT_TONE = {
  camera: 'bg-accent-soft text-accent border-accent-line', screen: 'bg-ok-soft text-ok border-[#c5e3d5]',
  diagram: 'bg-warn-soft text-warn border-warn-line', broll: 'bg-surface-2 text-ink-2 border-line', title: 'bg-surface-2 text-ink-2 border-line',
};

/**
 * Visuals: the shot list. For each section of the outline — what is on
 * screen while those lines are spoken. For screen-recording videos it is
 * also the recording checklist: Plan details shows it, and so does the Make
 * step of a voice-over, where the recordings are the video.
 */
export default function ShotList() {
  const { production, mutate } = useStudio();
  const [v, setV] = useState(null);
  const [ideas, setIdeas] = useState(null); // null | 'busy' | { model, rows: { [id]: suggestion } }
  const load = useCallback(() => api.visuals(production.id).then(setV), [production.id]);
  useEffect(() => { load(); }, [load]);

  if (!v) return <p className="muted">Loading…</p>;
  const save = (row, patch) => mutate(() => api.updateVisual(production.id, row.id, patch), (r) => setV(r.data), { silent: true }).catch(() => {});
  const suggestAll = async () => {
    setIdeas('busy');
    try {
      const r = await mutate(() => api.enhanceVisuals(production.id), null, { silent: true });
      setIdeas({ model: r.data.model, rows: Object.fromEntries(r.data.rows.map((x) => [x.id, x])) });
    } catch { setIdeas(null); }
  };
  const useIdea = (row, idea) => {
    save(row, { ...(idea.detail ? { detail: idea.detail } : {}), ...(idea.onscreen ? { onscreenText: idea.onscreen } : {}) });
    setIdeas((m) => ({ ...m, rows: Object.fromEntries(Object.entries(m.rows).filter(([k]) => Number(k) !== row.id)) }));
  };
  const ideaRows = ideas && ideas !== 'busy' ? ideas.rows : {};
  const recordable = v.rows.filter((r) => r.shotType === 'screen');
  const captured = recordable.filter((r) => r.captured).length;

  return (
    <>
      <div className="sectiontitle">
        <div>
          <h2>Visuals</h2>
          <p>What is on screen while each part of the script plays. Sections follow the outline.</p>
        </div>
        <span className="flex items-center gap-[12px]">
        {Object.keys(ideaRows).length > 1 && (
          <button className="text-[12px] p-[5px_11px]" onClick={() => v.rows.forEach((r) => ideaRows[r.id] && useIdea(r, ideaRows[r.id]))}>
            Use all {Object.keys(ideaRows).length}
          </button>
        )}
        {!v.approved && (
          <EnhanceButton label="Suggest visuals" busy={ideas === 'busy'} busyLabel="Planning…" onPick={suggestAll} options={[
            { id: 'all', label: 'What to show and the on-screen text', detail: 'For every section, from its own lines. Shown under each for you to use or not.' },
          ]} />
        )}
        </span>
        {recordable.length > 0 && (
          <span className={`text-[12px] ${captured === recordable.length ? 'text-ok' : 'text-muted'}`}>
            Screens recorded: <b>{captured} of {recordable.length}</b>
          </span>
        )}
      </div>

      {!production.outlineApproved && (
        <div className="notice warn"><Lock /> Approve the outline first — the shot list follows its sections.</div>
      )}

      {v.rows.map((r) => (
        <section key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-[16px] p-[14px_0] [border-top:1px_solid_var(--line)] first-of-type:[border-top:0] lte800:grid-cols-[1fr]">
          <div className="min-w-0">
            <div className="flex items-baseline gap-[8px] mb-[6px]">
              <code className="text-[11px] text-faint">{String(r.ref).padStart(2, '0')}</code>
              <b className="text-[13.5px] font-[580]">{r.title}</b>
              <span className="text-[11.5px] text-muted [font-variant-numeric:tabular-nums]">{r.runtime}</span>
            </div>
            {r.lines.length ? (
              <ol className="m-0 p-0 list-none flex flex-col gap-[4px]">
                {r.lines.map((l) => (
                  <li key={l.id} className="text-[12.5px] leading-[1.5] text-ink-2 [border-left:2px_solid_var(--line)] pl-[8px]">{l.text}</li>
                ))}
              </ol>
            ) : (
              <p className="text-faint text-[12px] m-0">No script lines here yet.</p>
            )}
          </div>

          <div className="flex flex-col gap-[8px] min-w-0">
            <div className="flex flex-wrap gap-[5px]" role="group" aria-label={`What is on screen in ${r.title}`}>
              {v.shots.map((s) => (
                <button key={s.id} type="button" onClick={() => r.shotType !== s.id && save(r, { shotType: s.id })}
                  className={'text-[11.5px] p-[4px_10px] rounded-full border border-solid ' + (r.shotType === s.id ? SHOT_TONE[s.id] + ' font-semibold' : 'bg-surface text-muted border-line hover:border-line-2')}>
                  {s.label}
                </button>
              ))}
            </div>
            <textarea className="w-full min-h-[58px] text-[12.5px] leading-[1.5] resize-y" defaultValue={r.detail}
              key={`${r.id}-${r.shotType}-${r.detail}`} placeholder={SHOT_HINT[r.shotType]} aria-label="What is shown"
              onBlur={(e) => e.target.value !== r.detail && save(r, { detail: e.target.value })} />
            <input key={r.onscreenText} className="text-[12px]" defaultValue={r.onscreenText} placeholder="On-screen text or caption (optional)"
              aria-label="On-screen text" onBlur={(e) => e.target.value !== r.onscreenText && save(r, { onscreenText: e.target.value })} />
            {ideaRows[r.id] && (
              <Suggestion
                text={<>{ideaRows[r.id].detail}{ideaRows[r.id].onscreen && <span className="block mt-[3px] text-[12px] text-ink-2">On screen: <b className="font-[600]">{ideaRows[r.id].onscreen}</b></span>}</>}
                flags={ideaRows[r.id].flags} meta={modelLabel(ideas.model)}
                onDismiss={() => setIdeas((m) => ({ ...m, rows: Object.fromEntries(Object.entries(m.rows).filter(([k]) => Number(k) !== r.id)) }))}
                onUse={() => useIdea(r, ideaRows[r.id])} />
            )}
            {r.shotType === 'screen' && (
              <div className="flex flex-wrap items-center gap-[10px]">
                {r.recording ? (
                  <>
                    <video className="w-[150px] rounded bg-ink" src={r.recording.fileUrl} controls preload="metadata" />
                    <span className="text-[12px] text-ok flex items-center gap-[5px]"><Check size={13} /> Recorded</span>
                    <UploadDrop compact label="Replace" upload={(f, p) => api.uploadRecording(production.id, r.id, f, p)}
                      onDone={(res) => setV(res.data.visuals)} />
                  </>
                ) : (
                  <>
                    <UploadDrop compact label="Upload screen recording" upload={(f, p) => api.uploadRecording(production.id, r.id, f, p)}
                      onDone={(res) => setV(res.data.visuals)} />
                    <label className="flex items-center gap-[6px] text-[12px] text-muted cursor-pointer">
                      <input type="checkbox" checked={r.captured} onChange={(e) => save(r, { captured: e.target.checked })} />
                      recorded elsewhere
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      ))}

      <div className="actions">
        <button className="primary" disabled={v.approved || !v.rows.length || !production.outlineApproved}
          onClick={() => mutate(() => api.approveVisuals(production.id), (r) => setV(r.data)).catch(() => {})}>
          {v.approved ? <><Check size={15} /> Visuals approved</> : 'Approve visuals'}
        </button>
      </div>
    </>
  );
}
