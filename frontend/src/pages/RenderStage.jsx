import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Play, AlertCircle, Check, X, Wallet } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import PaidConfirm from '../components/PaidConfirm.jsx';

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
      <div className="sectiontitle">
        <div>
          <h2>Render</h2>
          <p>A render is an intermediate asset, never the end of the line.</p>
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
        <div className={'pathbar' + (path.path === 'none' ? ' blocked' : path.free ? ' free' : ' billed')}>
          <Wallet size={15} />
          <span>
            <b>
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
        <div className="productionlock">
          <b>Production Lock · {lock.ready ? 'ready to render' : `${lock.blockers.length} blocker${lock.blockers.length === 1 ? '' : 's'}`}</b>
          {lock.gates.map((gate) => (
            <div className={'lockrow ' + gate.status} key={gate.key}>
              {gate.status === 'pass' ? <Check /> : gate.status === 'warn' ? <AlertCircle /> : <X />}
              <strong>{gate.label}</strong>
              <span>{gate.detail}</span>
              {gate.action && <em>{gate.action}</em>}
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
          <div className="renderbox">
            <div className="renderhead">
              <b>Render v{latest.version}</b>
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
            <div className="rmeta">
              <span>Duration {latest.duration || '—'}{latest.videoUrl ? '' : ' (estimate)'}</span>
              <span>Estimated cost ${latest.costEstimate.toFixed(2)}</span>
              <span>{latest.dryRun ?? state.dryRun ? 'nothing charged' : 'charged to your account'}</span>
            </div>
            {['queued', 'processing'].includes(latest.status) && (
              <button onClick={() => mutate(() => api.cancelRender(production.id, latest.id), apply)}>
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
            <div className="edl">
              <b>Handed to the generation provider</b>
              {latest.providerJobs.map((j) => (
                <div key={j.id}>
                  <span>{j.provider[0].toUpperCase()}</span>
                  <span style={{ flex: 1 }}>
                    {j.provider} · <code>{j.remoteId}</code>
                  </span>
                  <span className={'vchip ' + (j.status === 'completed' ? 'complete' : j.status)}>
                    {j.status}
                  </span>
                  <span className="pstatus">{j.dryRun ? 'dry run · $0' : `${j.creditsUsed ?? 0} credits`}</span>
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
