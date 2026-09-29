import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Play, AlertCircle, Check, X, Wallet } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';

export default function RenderStage() {
  const { production, mutate } = useStudio();
  const [state, setState] = useState(null);
  const [path, setPath] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => setState(await api.render(production.id)), [production.id]);
  useEffect(() => { load(); }, [load]);

  // Which pocket pays, said BEFORE the button is pressed. The router already
  // knows; leaving it to the error message meant the only way to find out that
  // Test mode cannot render on your plan was to try.
  useEffect(() => {
    api.heygenStatus().then((h) => setPath(h.renderPath)).catch(() => setPath(null));
  }, []);

  // Poll only while a render is actually moving.
  const live = state?.latest && ['queued', 'processing'].includes(state.latest.status);
  useEffect(() => {
    if (!live) return;
    timer.current = setInterval(load, 900);
    return () => clearInterval(timer.current);
  }, [live, load]);

  if (!state) return <p className="muted">Loading…</p>;
  const latest = state.latest;
  const apply = (res) => setState(res.data);

  return (
    <div className="stagepane">
      <div className="sectiontitle">
        <div>
          <h2>Render</h2>
          <p>A render is an intermediate asset, never the end of the line.</p>
        </div>
        <button
          className="primary"
          disabled={path?.path === 'none'}
          title={path?.path === 'none' ? path.reason : path?.reason ?? ''}
          // A paid render needs explicit confirmation. The button used to send
          // the request without it and get a 402 every time, so in Live mode it
          // could never succeed — the safety gate had no door.
          onClick={() => (path && !path.free
            ? setConfirming(true)
            : mutate(() => api.startRender(production.id, true), apply))}
        >
          Start render
        </button>
      </div>

      {confirming && (
        <div className="confirmpaid">
          <AlertCircle size={16} />
          <div>
            <b>This render is charged to your HeyGen plan.</b>
            <small>{path.reason}</small>
          </div>
          <div className="confirmactions">
            <button onClick={() => setConfirming(false)}>Cancel</button>
            <button
              className="primary"
              onClick={async () => {
                setConfirming(false);
                await mutate(() => api.startRender(production.id, true), apply);
              }}
            >
              Yes — render and charge my plan
            </button>
          </div>
        </div>
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
