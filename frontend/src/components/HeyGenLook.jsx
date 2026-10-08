import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Check, Image as ImageIcon } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';

const FORM_LABEL = 'flex flex-col gap-[4px] text-muted text-[11px] font-semibold';
const PROOF_SMALL = 'text-muted text-[11px]';
// A proof keeps its status class; the status only recolours or fades the card.
const PROOF_STATUS = { approved: ' border-[#c5e3d5]', rejected: ' border-line opacity-[.65]' };

// Background swatches: the plain light grey the finished PJB videos use, then white and dark.
const SUBHEAD_PLAN = 'text-[11px] tracking-[.07em] text-faint font-[600] m-[20px_0_8px] uppercase';
const SWATCHES = ['#f6f6fc', '#ffffff', '#1f2230'];
const LOOK_TILE = 'relative border border-solid rounded-lg overflow-hidden bg-canvas text-left p-0 cursor-pointer [&>img]:w-full [&>img]:h-[118px] [&>img]:object-cover [&>img]:block';

/**
 * Who appears in this video, and exactly how — one step. The performer is
 * PJB unless the outline says otherwise; the look (outfit and setting),
 * background, frame and motion direction are chosen here and, once approved,
 * are what the render uses. Consent for people lives in Cast → Collaborators.
 */
export default function HeyGenLook() {
  const { production, mutate } = useStudio();
  const [opts, setOpts] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [form, setForm] = useState(null);
  const [showMotion, setShowMotion] = useState(false);
  const [defaultNote, setDefaultNote] = useState(null);
  // The 20-look grid is for choosing; once a look is approved (or a starting
  // look is set for every video) it folds to one line until you change it.
  const [picking, setPicking] = useState(null);

  const load = useCallback(async () => {
    const [o, flow] = await Promise.all([api.appearanceOptions(production.id), api.workflow(production.id)]);
    setOpts(o);
    setWorkflow(flow);
    const performer = o.performers[0];
    if (!performer) return;
    // Start from what is approved for this video, else the default, else the house look.
    const approved = flow.appearances.find((a) => a.presenterId === performer.id && a.status === 'approved' && a.look);
    const draft = flow.appearances.find((a) => a.presenterId === performer.id && a.status === 'draft' && a.look);
    const base = approved ?? draft;
    const d = o.default;
    setForm({
      presenterId: performer.id,
      avatarAssetId: base?.look?.id ?? d?.avatarAssetId ?? performer.looks.find((l) => /sweatshirt/i.test(l.name))?.id ?? performer.looks[0]?.id,
      backgroundKind: base?.backgroundKind ?? d?.backgroundKind ?? o.settings.backgroundKind,
      backgroundValue: base?.backgroundValue ?? d?.backgroundValue ?? o.settings.backgroundValue,
      aspect: base?.aspect ?? d?.aspect ?? o.settings.aspect,
      resolution: base?.resolution ?? d?.resolution ?? o.settings.resolution,
      motionPrompt: base?.motionPrompt ?? d?.motionPrompt ?? o.settings.motionPrompt,
    });
  }, [production.id]);
  useEffect(() => { load(); setPicking(null); }, [load]);

  if (!opts || !workflow) return <p className="muted">Loading…</p>;
  const performer = opts.performers[0];
  if (!performer || !form) {
    return (
      <>
        <h2>Your HeyGen look</h2>
        <div className="notice warn"><AlertCircle /> No performer with looks yet. Cast a presenter with your HeyGen avatar in Cast.</div>
      </>
    );
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const proofs = workflow.appearances.filter((a) => a.presenterId === performer.id);
  const approved = proofs.find((a) => a.status === 'approved');
  const template = opts.template?.name;
  const templateId = opts.template?.id;
  const chosen = performer.looks.find((l) => l.id === form.avatarAssetId);
  const startingLook = !approved && opts.default ? performer.looks.find((l) => l.id === opts.default.avatarAssetId) : null;
  const showPicker = picking ?? !(approved || startingLook);

  const saveLook = async (approve) => {
    try {
      const res = await mutate(() => api.createAppearance(production.id, { ...form, label: chosen?.name }), (r) => setWorkflow(r.data));
      if (approve) {
        const newest = res.data.appearances.find((a) => a.presenterId === performer.id && a.status === 'draft');
        if (newest) await mutate(() => api.updateAppearance(production.id, newest.id, { status: 'approved' }), (r) => setWorkflow(r.data));
        setPicking(false);
      }
    } catch { /* mutate reports it */ }
  };
  const setStatus = (proof, status) =>
    mutate(() => api.updateAppearance(production.id, proof.id, { status }), (r) => setWorkflow(r.data)).catch(() => {});
  const makeDefault = async (scope) => {
    try {
      await mutate(() => api.saveAppearanceDefault(scope, form), null, { silent: true });
      const r = await mutate(() => api.applyAppearanceDefault(scope), null);
      setDefaultNote(r.message);
      await load();
    } catch { /* reported */ }
  };

  return (
    <>
      <div className="sectiontitle">
        <div>
          <h2>Your HeyGen look</h2>
          <p>How your avatar appears. The approved look is what the render uses.</p>
        </div>
      </div>

      <div className={'notice ' + (approved ? '' : 'warn')}>
        {approved ? <Check /> : <AlertCircle />}
        <span>
          <b>{performer.name.replace(/ \(your likeness\)/, '')} — PJB</b> · voice: your local voice ·{' '}
          {approved ? `approved look: ${approved.look?.name ?? approved.outfit}` : showPicker ? 'no approved look yet — choose one below and approve it' : 'no approved look yet — approve the one below'}
        </span>
      </div>

      {!showPicker && (() => {
        const look = approved ? (performer.looks.find((l) => l.id === approved.look?.id) ?? approved.look) : chosen;
        return (
          <div className="flex items-center gap-[14px] mt-[12px] p-[10px] border border-solid border-line rounded-lg bg-surface">
            {look?.previewUrl
              ? <img src={look.previewUrl} alt="" className="w-[72px] h-[72px] object-cover rounded" />
              : <div className="w-[72px] h-[72px] grid place-items-center bg-canvas rounded text-faint"><ImageIcon /></div>}
            <div className="flex flex-col gap-[2px] min-w-0">
              <span className="text-[10.5px] tracking-[.07em] uppercase text-faint font-semibold">{approved ? 'Approved look' : 'Ready to approve'}</span>
              <b className="text-[13.5px] truncate">{look?.name ?? approved?.outfit ?? 'Look'}</b>
              <small className="text-muted text-[12px]">{form.aspect} · {form.resolution}{approved ? '' : ' · your starting look — approve it for this video'}</small>
            </div>
            <div className="ml-auto flex gap-[8px] shrink-0">
              {!approved && <button className="primary" onClick={() => saveLook(true)}><Check size={13} /> Approve for this video</button>}
              <button onClick={() => setPicking(true)}>Change look</button>
            </div>
          </div>
        );
      })()}

      {showPicker && <>
      <div className={SUBHEAD_PLAN}>Look — outfit and setting ({performer.looks.length})</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-[8px]">
        {performer.looks.map((l) => (
          <button key={l.id} type="button" onClick={() => set({ avatarAssetId: l.id })}
            className={LOOK_TILE + (l.id === form.avatarAssetId ? ' border-accent [box-shadow:0_0_0_2px_var(--accent)]' : ' border-line hover:border-line-2')}
            title={l.name}>
            {l.previewUrl ? <img src={l.previewUrl} alt="" loading="lazy" /> : <div className="h-[118px] grid place-items-center text-faint"><ImageIcon /></div>}
            <span className="block p-[5px_7px] text-[11px] leading-[1.3] truncate text-ink-2">{l.name}</span>
            {l.avatarType === 'digital_twin' && <span className="absolute top-[5px] left-[5px] text-[9.5px] bg-ink text-[#fff] rounded-[3px] p-[1px_5px]">VIDEO TWIN</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_1fr_1fr] gap-[12px] mt-[16px] lte800:grid-cols-[1fr]">
        <label className={FORM_LABEL}>Background
          <span className="flex items-center gap-[6px]">
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={`Background ${c}`} onClick={() => set({ backgroundKind: 'color', backgroundValue: c })}
                className={'w-[26px] h-[26px] p-0 rounded-full border border-solid ' + (form.backgroundKind === 'color' && form.backgroundValue === c ? 'border-accent [box-shadow:0_0_0_2px_var(--accent)]' : 'border-line')}
                style={{ background: c }} />
            ))}
            <input type="color" aria-label="Custom background colour" className="w-[34px] h-[28px] p-[2px]"
              value={form.backgroundKind === 'color' ? form.backgroundValue : '#f6f6fc'}
              onChange={(e) => set({ backgroundKind: 'color', backgroundValue: e.target.value })} />
          </span>
          <input className="mt-[6px] font-normal" placeholder="…or an https image URL"
            value={form.backgroundKind === 'image' ? form.backgroundValue : ''}
            onChange={(e) => set(e.target.value ? { backgroundKind: 'image', backgroundValue: e.target.value } : { backgroundKind: 'color', backgroundValue: '#f6f6fc' })} />
        </label>
        <label className={FORM_LABEL}>Framing
          <select value={form.aspect} onChange={(e) => set({ aspect: e.target.value })}>
            {opts.settings.aspects.map((a) => <option key={a} value={a}>{a}{a === '9:16' ? ' — vertical (social)' : a === '16:9' ? ' — widescreen' : ' — square'}</option>)}
          </select>
          {chosen?.orientation && ((chosen.orientation === 'portrait') !== (form.aspect === '9:16')) && (
            <small className="font-normal text-warn">This look was shot {chosen.orientation}; it may be cropped in {form.aspect}.</small>
          )}
        </label>
        <label className={FORM_LABEL}>Resolution
          <select value={form.resolution} onChange={(e) => set({ resolution: e.target.value })}>
            {opts.settings.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      <button type="button" className="ghostbtn mt-[10px] text-[12px] p-[3px_0]" onClick={() => setShowMotion((v) => !v)}>
        {showMotion ? 'Hide' : 'Edit'} motion direction
      </button>
      {showMotion && (
        <textarea className="w-full min-h-[90px] text-[12.5px] mt-[6px]" value={form.motionPrompt}
          onChange={(e) => set({ motionPrompt: e.target.value })} aria-label="Motion direction" />
      )}

      <div className="flex flex-wrap gap-[8px] mt-[14px] items-center">
        <button className="primary" onClick={() => saveLook(true)} disabled={!form.avatarAssetId}>
          <Check size={13} /> Approve this look for this video
        </button>
        <button onClick={() => saveLook(false)} disabled={!form.avatarAssetId}>Save as draft</button>
        <span className="text-faint text-[11.5px]">or set it as the starting look for</span>
        {templateId && <button onClick={() => makeDefault(`template:${templateId}`)}>All {template} videos</button>}
        <button onClick={() => makeDefault('all')}>Every video</button>
      </div>
      </>}
      {defaultNote && <p className="text-[12px] text-muted m-[8px_0_0]">{defaultNote} — each still needs its own approval.</p>}

      {showPicker && proofs.length > 0 && (
        <>
          <div className={SUBHEAD_PLAN}>Looks for this video</div>
          <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[10px] lte800:grid-cols-[1fr]">
            {proofs.map((proof) => (
              <article key={proof.id} className={'grid grid-cols-[84px_1fr] border border-solid rounded-lg overflow-hidden bg-surface ' + (PROOF_STATUS[proof.status] ?? ' border-line')}>
                {/^https?:\/\//i.test(proof.imageUrl ?? '')
                  ? <img className="w-[84px] h-[104px] object-cover bg-canvas" src={proof.imageUrl} alt="" />
                  : <div className="w-[84px] h-[104px] bg-canvas grid place-items-center text-line-2"><ImageIcon /></div>}
                <div className="flex flex-col gap-[3px] p-[9px] min-w-0">
                  <span className={'rstatus ' + proof.status}>{proof.status}</span>
                  <b className="text-[12.5px] truncate">{proof.look?.name ?? proof.label}</b>
                  <small className={PROOF_SMALL}>{proof.background} · {proof.framing}</small>
                  {proof.status === 'draft' && (
                    <div className="flex gap-[6px] mt-auto">
                      <button className="text-[12px] p-[4px_8px]" onClick={() => setStatus(proof, 'rejected')}>Reject</button>
                      <button className="primary text-[12px] p-[4px_8px]" onClick={() => setStatus(proof, 'approved')}><Check size={12} /> Approve</button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <p className="text-faint text-[11.5px] mt-[16px]">
        People and consent for the whole workspace are managed in Cast → Collaborators.
      </p>
    </>
  );
}
