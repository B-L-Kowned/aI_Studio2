import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Play, AlertCircle, Check, X, Wallet, Image as ImageIcon } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import PaidConfirm from '../components/PaidConfirm.jsx';
import { madeByOf, needsRender } from '../utils/made-by.js';

// Which pocket pays: every render path is exactly one of these, so the tone
// carries its whole colour set (the icon inherits it).
const PATH_TONE = {
  free: 'border-[#c5e3d5] bg-ok-soft text-ok',
  billed: 'border-warn-line bg-warn-soft text-warn',
  blocked: 'border-[#f2ccc9] bg-danger-soft text-danger',
};
const GATE_ICON_TONE = { pass: 'text-ok', warn: 'text-warn', block: 'text-danger' };
const gateIcon = (status) => 'w-[14px] h-[14px] ' + (GATE_ICON_TONE[status] ?? '');

export default function RenderStage() {
  const { production, mutate } = useStudio();
  const [state, setState] = useState(null);
  const [lock, setLock] = useState(null);
  const [path, setPath] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  // A render is charged once per request, so the request must go once. The ref
  // blocks a double-click synchronously; `starting` disables the buttons.
  const startLock = useRef(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const [render, productionLock] = await Promise.all([
      api.render(production.id),
      api.productionLock(production.id),
    ]);
    setState(render);
    setLock(productionLock);
    setLoadError(null);
  }, [production.id]);
  useEffect(() => { load().catch(setLoadError); }, [load]);

  // Which pocket pays, said BEFORE the button is pressed. The router already
  // knows; leaving it to the error message meant the only way to find out that
  // Test mode cannot render on your plan was to try.
  useEffect(() => {
    api.heygenStatus().then((h) => setPath(h.renderPath)).catch(() => setPath(null));
  }, []);

  // Poll only while a render is actually moving, and only one request at a
  // time: the next poll is scheduled after the last one lands, so a slow
  // response can never overwrite a newer one.
  const live = state?.latest && ['queued', 'processing'].includes(state.latest.status);
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => { load().catch(() => {}); }, 900);
    return () => clearTimeout(t);
  }, [live, state, load]);

  if (!needsRender(production)) {
    return (
      <div className="stagepane">
        <h2>Render</h2>
        <div className="notice"><Check /> <span><b>{madeByOf(production) === 'self' ? 'Recorded by you' : 'Voice-over'} — nothing to render.</b> Take the approved audio,
          script, subtitles and shot list from Edit → Editor kit, cut it in CapCut or Descript, then upload the finished video in Plan → Brief.</span></div>
      </div>
    );
  }
  if (!state) return <LoadState error={loadError} retry={() => load().catch(setLoadError)} />;
  const latest = state.latest;
  const apply = (res) => setState(res.data);
  const start = async () => {
    if (startLock.current) return;
    startLock.current = true;
    setStarting(true);
    setConfirming(false);
    try { await mutate(() => api.startRender(production.id, true), apply); }
    catch { /* mutate has already said what went wrong */ }
    finally { startLock.current = false; setStarting(false); }
  };

  return (
    <div className="stagepane">
      {/* The look comes first: it is what the render is given. */}
      <PeopleAndLook />
      <hr className="m-[22px_0] [border:0] [border-top:1px_solid_var(--line)]" />
      <div className="sectiontitle">
        <div>
          <h2>Render</h2>
          <p>Your avatar is lip-synced to your approved audio from Segments. The render then goes to Edit → Editor kit with each line's clip cut from it.</p>
        </div>
        <button
          className="primary"
          disabled={starting || !lock?.ready || path?.path === 'none'}
          title={!lock?.ready
            ? `${lock?.blockers?.length ?? 0} production approval${lock?.blockers?.length === 1 ? '' : 's'} still block rendering`
            : path?.path === 'none' ? path.reason : path?.reason ?? ''}
          // A paid render needs explicit confirmation. The button used to send
          // the request without it and get a 402 every time, so in Live mode it
          // could never succeed — the safety gate had no door.
          onClick={() => (path && !path.free ? setConfirming(true) : start())}
        >
          {starting ? 'Starting…' : 'Start render'}
        </button>
      </div>

      {confirming && (
        <PaidConfirm
          title="This render is charged to your HeyGen plan."
          detail={path.reason}
          confirmLabel="Yes — render and charge my plan"
          busy={starting}
          onCancel={() => setConfirming(false)}
          onConfirm={start}
        />
      )}

      {path && (
        <div className={'flex items-start gap-[8px] m-[12px_0] p-[9px_12px] border border-solid rounded text-[12.5px] leading-[1.5] '
          + PATH_TONE[path.path === 'none' ? 'blocked' : path.free ? 'free' : 'billed']}>
          <Wallet size={15} className="flex-none mt-[1px]" />
          <span>
            <b className="font-[600]">
              {{
                mcp: 'Renders on your HeyGen plan',
                key: 'Renders through your API key',
                fixtures: 'Renders are simulated',
                none: 'Cannot render right now',
              }[path.path]}
            </b>{' '}
            {path.reason}
          </span>
        </div>
      )}

      {lock && (
        <div className="border border-solid border-line rounded m-[12px_0] overflow-hidden">
          <b className="block p-[9px_12px] bg-surface-2 text-[12px]">Production Lock · {lock.ready ? 'ready to render' : `${lock.blockers.length} blocker${lock.blockers.length === 1 ? '' : 's'}`}</b>
          {lock.gates.map((gate) => (
            <div className="grid grid-cols-[18px_145px_1fr_auto] gap-[8px] items-center p-[7px_12px] [border-top:1px_solid_var(--line)] text-[11.5px]" key={gate.key}>
              {gate.status === 'pass' ? <Check className={gateIcon(gate.status)} />
                : gate.status === 'warn' ? <AlertCircle className={gateIcon(gate.status)} />
                : <X className={gateIcon(gate.status)} />}
              <strong>{gate.label}</strong>
              <span className="text-muted">{gate.detail}</span>
              {gate.action && <em className="text-faint not-italic text-[10.5px]">{gate.action}</em>}
            </div>
          ))}
        </div>
      )}

      {latest?.stale && (
        <div className="stalebar">
          <AlertCircle size={15} />
          <span>{latest.staleReason} — this render no longer matches the plan. It was kept, not replaced.</span>
        </div>
      )}

      {!latest && (
        <div className="empty"><Play size={30} /><p>No render yet.</p></div>
      )}

      {latest && (
        <>
          <div className="border border-solid border-line rounded-lg p-[16px] m-[14px_0]">
            <div className="flex justify-between items-center mb-[11px]">
              <b className="text-[14px]">Render v{latest.version}</b>
              <span className={'rstatus ' + latest.status}>{latest.status}</span>
            </div>
            <div className="progress"><i style={{ width: `${latest.progress}%` }} /></div>

            {/* The video you just paid for, playable. It used to exist only as
                a url on the provider job, so "Render complete" was a claim you
                had no way to check. */}
            {latest.videoUrl && (
              <video
                className="renderplayer"
                controls
                preload="metadata"
                poster={latest.thumbnailUrl ?? undefined}
                src={latest.videoUrl}
              />
            )}
            <div className="flex gap-[16px] mt-[11px] flex-wrap text-[12px] text-muted tabular-nums">
              <span>Duration {latest.duration || '—'}{latest.videoUrl ? '' : ' (estimate)'}</span>
              <span>Estimated cost ${latest.costEstimate.toFixed(2)}</span>
              <span>{latest.dryRun ?? state.dryRun ? 'nothing charged' : 'charged to your account'}</span>
            </div>
            {['queued', 'processing'].includes(latest.status) && (
              <button className="mt-[11px]" onClick={() => mutate(() => api.cancelRender(production.id, latest.id), apply)}>
                <X size={14} /> Cancel
              </button>
            )}
          </div>

          {/* The pathbar above already says which pocket pays and why, in the
              mode's own words. Repeating it here in the older "Dry Run"
              vocabulary gave two answers to one question. */}

          {state.renders.length > 1 && (
            <div className="versionbar">
              {state.renders.map((r) => (
                <span key={r.id} className={'vchip ' + r.status + (r.stale ? ' stale' : '')}>
                  v{r.version} · {r.status}{r.stale ? ' · stale' : ''}
                </span>
              ))}
            </div>
          )}

          {latest.providerJobs?.length > 0 && (
            <div className="border border-solid border-line rounded p-[13px_15px] mt-[16px]">
              <b className="block text-[11px] text-muted mb-[8px] font-[600]">Handed to the generation provider</b>
              {latest.providerJobs.map((j) => (
                <div key={j.id} className="grid grid-cols-[18px_minmax(0,1fr)_auto_auto] gap-[10px] items-center p-[7px_0] [border-top:1px_solid_var(--line)] text-[13px]">
                  {/* Only the leading initial is a badge, never every span in the row. */}
                  <span className="w-[18px] h-[18px] rounded-sm bg-canvas border border-solid border-line text-muted grid place-items-center text-[10px]">{j.provider[0].toUpperCase()}</span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ flex: 1 }}>
                    {j.provider} · <code className="font-mono text-[11.5px] leading-[normal] font-normal text-muted">{j.remoteId}</code>
                  </span>
                  <span className={'vchip ' + (j.status === 'completed' ? 'complete' : j.status)}>
                    {j.status}
                  </span>
                  <span className="pstatus font-mono text-[11.5px] leading-[normal] font-normal text-faint whitespace-nowrap">{j.dryRun ? 'dry run · $0' : `${j.creditsUsed ?? 0} credits`}</span>
                </div>
              ))}
            </div>
          )}

          {latest.status === 'complete' && (
            <div className="actions">
              <span className="statusnote"><Check size={15} /> Render complete — open Edit to work on it</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
function PeopleAndLook() {
  const { production, mutate } = useStudio();
  const [opts, setOpts] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [form, setForm] = useState(null);
  const [showMotion, setShowMotion] = useState(false);
  const [defaultNote, setDefaultNote] = useState(null);

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
  useEffect(() => { load(); }, [load]);

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

  const saveLook = async (approve) => {
    try {
      const res = await mutate(() => api.createAppearance(production.id, { ...form, label: chosen?.name }), (r) => setWorkflow(r.data));
      if (approve) {
        const newest = res.data.appearances.find((a) => a.presenterId === performer.id && a.status === 'draft');
        if (newest) await mutate(() => api.updateAppearance(production.id, newest.id, { status: 'approved' }), (r) => setWorkflow(r.data));
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
          {approved ? `approved look: ${approved.look?.name ?? approved.outfit}` : 'no approved look yet — choose one below and approve it'}
        </span>
      </div>

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
      {defaultNote && <p className="text-[12px] text-muted m-[8px_0_0]">{defaultNote} — each still needs its own approval.</p>}

      {proofs.length > 0 && (
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
