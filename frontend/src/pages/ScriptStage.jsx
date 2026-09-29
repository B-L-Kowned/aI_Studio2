import React, { useEffect, useState, useCallback } from 'react';
import { Sparkles, Check, X, Lock, AlertCircle, FileText } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';

export default function ScriptStage() {
  const { production, mutate } = useStudio();
  const [state, setState] = useState(null);

  const load = useCallback(async () => setState(await api.script(production.id)), [production.id]);
  useEffect(() => { load(); }, [load]);

  const ready = production.outlineApproved && production.scenesApproved;
  const apply = (res) => setState(res.data);

  if (!state) return <p className="muted">Loading script…</p>;
  const latest = state.latest;

  return (
    <div className="stagepane">
      <div className="sectiontitle">
        <div>
          <h2>Script</h2>
          <p>Generated from the approved plan. Dialogue never precedes an approved outline and scenes.</p>
        </div>
        <button
          className="primary"
          disabled={!ready}
          onClick={() => mutate(() => api.generateScript(production.id), apply)}
        >
          <Sparkles size={15} /> {latest ? 'Regenerate' : 'Generate script'}
        </button>
      </div>

      {!ready && (
        <div className="notice warn">
          <Lock /> Locked until the outline and scenes are approved in Plan.
          {' '}Outline: {production.outlineApproved ? 'approved' : 'not approved'} ·
          {' '}Scenes: {production.scenesApproved ? 'approved' : 'not approved'}
        </div>
      )}

      {latest?.stale && (
        <div className="stalebar">
          <AlertCircle size={15} />
          <span>{latest.staleReason} — this script is out of date. It was kept, not overwritten.</span>
        </div>
      )}

      {state.versions.length > 0 && (
        <div className="versionbar">
          {state.versions.map((v) => (
            <span key={v.id} className={'vchip ' + v.status + (v.stale ? ' stale' : '')}>
              v{v.version} · {v.status}{v.stale ? ' · stale' : ''}
            </span>
          ))}
        </div>
      )}

      {!latest && ready && (
        <div className="empty"><FileText size={30} /><p>No script yet. Generate one from the approved plan.</p></div>
      )}

      {latest && (
        <>
          <div className="scriptbody">
            {latest.segments.map((s, i) => {
              const newScene = i === 0 || latest.segments[i - 1].sceneRef !== s.sceneRef;
              return (
                <React.Fragment key={s.id}>
                  {newScene && <div className="scriptscene">Scene {s.sceneRef} — {s.sceneTitle}</div>}
                  <div className="scriptline">
                    <b>{s.speaker}</b>
                    <p>{s.text}</p>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {latest.status === 'proposed' ? (
            <div className="actions">
              <button onClick={() => mutate(() => api.rejectScript(production.id, latest.id), apply)}>
                <X size={15} /> Reject
              </button>
              <button className="primary" onClick={() => mutate(() => api.acceptScript(production.id, latest.id), apply)}>
                <Check size={15} /> Accept v{latest.version} → Produce
              </button>
            </div>
          ) : (
            <div className="actions">
              <span className="statusnote">
                <Check size={15} /> v{latest.version} {latest.status}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
