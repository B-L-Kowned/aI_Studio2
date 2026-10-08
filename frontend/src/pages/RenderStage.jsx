import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Play, AlertCircle, Check, X, Wallet } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import PaidConfirm from '../components/PaidConfirm.jsx';
import { madeByOf, needsRender } from '../utils/made-by.js';
import HeyGenLook from '../components/HeyGenLook.jsx';

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
      <HeyGenLook />
      <hr className="m-[22px_0] [border:0] [border-top:1px_solid_var(--line)]" />
      <div className="sectiontitle">
        <div>
          <h2>Render</h2>
          <p>Your avatar is lip-synced to your approved audio from Voice. The render then goes to Edit → Editor kit with each line's clip cut from it.</p>
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
