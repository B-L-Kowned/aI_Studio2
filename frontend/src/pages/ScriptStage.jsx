import React, { useEffect, useState, useCallback } from 'react';
import { Sparkles, Check, X, Lock, AlertCircle, FileText } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';

const GENERATOR_LABELS = {
  included: 'Built-in deterministic',
  ollama: 'Local Ollama',
  openai: 'ChatGPT (OpenAI)',
  anthropic: 'Claude (Anthropic)',
  groq: 'Groq',
  xai: 'Grok (xAI)',
};

function generatorLabel(version) {
  const provider = GENERATOR_LABELS[version.generatorProvider] ?? version.generatorProvider ?? 'Unknown engine';
  return version.generatorModel ? `${provider} · ${version.generatorModel}` : provider;
}

export default function ScriptStage({ goToStage }) {
  const { production, mutate } = useStudio();
  const [state, setState] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    const [script, flow] = await Promise.all([
      api.script(production.id),
      api.workflow(production.id),
    ]);
    setState(script);
    setWorkflow(flow);
    setLoadError(null);
  }, [production.id]);
  useEffect(() => { load().catch(setLoadError); }, [load]);

  const researchGate = workflow?.lock?.gates.find((gate) => gate.key === 'research');
  const ready = production.outlineApproved && production.scenesApproved && researchGate?.status !== 'block';
  const apply = (res) => setState(res.data);

  if (!state || !workflow) return <LoadState error={loadError} retry={() => load().catch(setLoadError)} label="Loading script…" />;
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
          <Lock /> Locked until source evidence, the outline and scenes are approved in Plan.
          {' '}Research: {researchGate?.status === 'pass' ? 'approved' : researchGate?.detail ?? 'not approved'} ·
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
              v{v.version} · {v.status}{v.stale ? ' · stale' : ''} · {generatorLabel(v)}
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
                    {latest.status === 'proposed' ? (
                      <>
                        <input className="scriptspeaker" defaultValue={s.speaker} aria-label="Speaker"
                          onBlur={(e) => {
                            if (e.target.value !== s.speaker) {
                              mutate(
                                () => api.updateScriptSegment(production.id, latest.id, s.id, { speaker: e.target.value }),
                                apply
                              ).catch(() => {});
                            }
                          }} />
                        <textarea className="scripttext" defaultValue={s.text} aria-label="Script line" rows={2}
                          onBlur={(e) => {
                            if (e.target.value !== s.text) {
                              mutate(
                                () => api.updateScriptSegment(production.id, latest.id, s.id, { text: e.target.value }),
                                apply
                              ).catch(() => {});
                            }
                          }} />
                      </>
                    ) : (
                      <><b>{s.speaker}</b><p>{s.text}</p></>
                    )}
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
              <button
                className="primary"
                onClick={async () => {
                  await mutate(() => api.acceptScript(production.id, latest.id), apply);
                  // One user action crosses the writing/production boundary.
                  // The APIs remain separately useful and testable, while the
                  // interface never lands on an empty next stage that requires
                  // a second, non-obvious “Build” press.
                  await mutate(
                    () => api.buildSegments(production.id),
                    null,
                    { silent: true }
                  );
                  goToStage?.('Segments');
                }}
              >
                <Check size={15} /> Accept v{latest.version} → Segments
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
