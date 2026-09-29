import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Users, Clock, Video, Upload, FileText, Link, FolderKanban,
  Lock, Check, AlertCircle, UserPlus, Trash2, X, RefreshCw,
} from 'lucide-react';
import { useStudio, toSeconds, toClock } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import PeoplePage from './PeoplePage.jsx';

const VIEWS = ['Brief', 'Outline', 'Scenes', 'People', 'Sources', 'Decisions'];

export default function PlanStage({ goToStage }) {
  const [view, setView] = useState('Outline');
  const [producer, setProducer] = useState(null);
  const { production, applyProduction, mutate } = useStudio();

  const askProducer = async () => {
    setProducer('loading');
    setProducer(await api.producer(production.id));
  };

  return (
    <div className="workspace planning">
      <aside>
        <b>PLAN</b>
        {VIEWS.map((v) => (
          <button key={v} className={view === v ? 'sel' : ''} onClick={() => setView(v)}>{v}</button>
        ))}
        <hr />
        <small>AI PRODUCER</small>
        <p className="muted">Uses the included LLM by default. It asks only for decisions it cannot safely make.</p>
        <button className="producer" onClick={askProducer}><Sparkles /> Ask Producer</button>
      </aside>

      <section>
        {producer && producer !== 'loading' && (
          <ProducerPanel
            result={producer}
            onClose={() => setProducer(null)}
            onAction={async (action) => {
              if (action === 'rebalance') await mutate(() => api.rebalance(production.id), applyProduction);
              if (action === 'develop_scenes') await mutate(() => api.developScenes(production.id), applyProduction);
              setProducer(await api.producer(production.id));
            }}
          />
        )}
        {view === 'Brief' && <Brief goToStage={goToStage} />}
        {view === 'Outline' && <Outline goToStage={goToStage} />}
        {view === 'Scenes' && <Scenes goToStage={goToStage} />}
        {view === 'People' && <PeoplePage compact />}
        {view === 'Sources' && <Sources />}
        {view === 'Decisions' && <Decisions />}
      </section>
    </div>
  );
}

function ProducerPanel({ result, onClose, onAction }) {
  return (
    <div className="producerpanel">
      <div className="pphead">
        <b><Sparkles size={16} /> Producer assessment</b>
        <button onClick={onClose}><X size={15} /></button>
      </div>
      <div className="ppgrid">
        <div>
          <small>KNOWN</small>
          {result.known.map((k) => <p key={k}><Check size={13} /> {k}</p>)}
        </div>
        <div>
          <small>INFERRED</small>
          {result.inferred.length
            ? result.inferred.map((k) => <p key={k}><Sparkles size={13} /> {k}</p>)
            : <p className="muted">Nothing inferred.</p>}
        </div>
        <div>
          <small>NEEDS YOU</small>
          {result.decisionsNeeded.length
            ? result.decisionsNeeded.map((k) => <p key={k}><AlertCircle size={13} /> {k}</p>)
            : <p className="muted">Nothing blocking.</p>}
        </div>
      </div>
      {result.proposals.length > 0 && (
        <div className="ppproposals">
          {result.proposals.map((p) => (
            <button key={p.action} onClick={() => onAction(p.action)} title={p.detail}>{p.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Not an error: the expected result of editing a plan that already has work
// downstream. It states what is affected and offers the next step.
const STALE_STAGE = { script: 'Script', render: 'Render', export: 'Edit', publication: 'Publish' };
const STALE_ORDER = ['script', 'render', 'export', 'publication'];

function StaleNote({ stale, goToStage }) {
  const keys = STALE_ORDER.filter((k) => stale?.[k]);
  if (!keys.length) return null;

  const first = keys[0];
  const list = keys
    .map((k) => `${stale[k].count} ${k}${stale[k].count > 1 ? 's' : ''}`)
    .join(', ');

  return (
    <div className="stalebar">
      <RefreshCw size={15} />
      <span>
        <b>Plan changed since this work was made.</b>{' '}
        {list} now {keys.length === 1 && stale[first].count === 1 ? 'reflects' : 'reflect'} an
        older plan. Nothing was deleted — regenerate whenever you are ready.
      </span>
      {goToStage && (
        <button onClick={() => goToStage(STALE_STAGE[first])}>
          Go to {STALE_STAGE[first]}
        </button>
      )}
    </div>
  );
}

function Brief({ goToStage }) {
  const { production, applyProduction, mutate } = useStudio();
  return (
    <>
      <h2>Production Brief</h2>
      <StaleNote stale={production.stale} goToStage={goToStage} />
      <div className="formgrid">
        {production.brief.map((f) => (
          <label key={f.id}>
            {f.label}
            <input
              defaultValue={f.value}
              onBlur={(e) => {
                if (e.target.value !== f.value) {
                  mutate(() => api.updateBrief(production.id, f.id, e.target.value), applyProduction);
                }
              }}
            />
          </label>
        ))}
      </div>
      <div className="notice">
        <Sparkles /> Template defaults are editable. Changing a default does not modify the source
        template unless you explicitly save it back.
      </div>
    </>
  );
}

function Outline({ goToStage }) {
  const { production, applyProduction, mutate } = useStudio();
  const planned = production.outline.reduce((n, s) => n + toSeconds(s.runtime), 0);
  const target = toSeconds(production.targetRuntime);
  const drift = planned - target;

  return (
    <>
      <div className="sectiontitle">
        <div>
          <h2>Outline</h2>
          <p>Structure and allocate runtime before writing dialogue.</p>
        </div>
        <button onClick={() => mutate(() => api.addSection(production.id, {}), applyProduction)}>+ Section</button>
      </div>

      <StaleNote stale={production.stale} goToStage={goToStage} />

      <div className={'runtime' + (drift ? ' off' : '')}>
        <Clock /> Target {production.targetRuntime}
        <b>
          Planned {toClock(planned)}
          {drift !== 0 && <em>{drift > 0 ? '+' : '−'}{toClock(Math.abs(drift))}</em>}
        </b>
      </div>

      {production.outline.map((s, i) => (
        <div className={'outline' + (s.purpose ? ' haspurpose' : '')} key={s.id}>
          <b>{String(i + 1).padStart(2, '0')}</b>
          <div className="outlinemain">
            <input
              className="ghost"
              defaultValue={s.title}
              onBlur={(e) => {
                if (e.target.value !== s.title) {
                  mutate(() => api.updateSection(production.id, s.id, { title: e.target.value }), applyProduction);
                }
              }}
            />
            {/* Only a real purpose earns a second line. The placeholder sentence
                said the same nothing on every row and made each one 67px tall. */}
            {s.purpose && <small>{s.purpose}</small>}
          </div>
          {s.participants && <span className="outlinewho"><Users /> {s.participants}</span>}
          <input
            className="outlinetime"
            defaultValue={s.runtime}
            aria-label="Runtime"
            onBlur={(e) => {
              if (e.target.value !== s.runtime) {
                mutate(() => api.updateSection(production.id, s.id, { runtime: e.target.value }), applyProduction);
              }
            }}
          />
          <button
            className="outlinedel"
            title="Remove section"
            onClick={() => mutate(() => api.deleteSection(production.id, s.id), applyProduction)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div className="actions">
        <button onClick={() => mutate(() => api.rebalance(production.id), applyProduction)}>
          Ask AI to rebalance
        </button>
        <button
          className="primary"
          disabled={production.outlineApproved}
          onClick={() => mutate(() => api.approveOutline(production.id), applyProduction)}
        >
          {production.outlineApproved ? <><Check size={15} /> Outline approved</> : 'Approve outline → Develop scenes'}
        </button>
      </div>
    </>
  );
}

function Scenes({ goToStage }) {
  const { production, applyProduction, mutate } = useStudio();

  return (
    <>
      <div className="sectiontitle">
        <div>
          <h2>Scenes</h2>
          <p>Decide who is present, what is shown and what each scene accomplishes before scripting.</p>
        </div>
        <button onClick={() => mutate(() => api.addScene(production.id, {}), applyProduction)}>+ Scene</button>
      </div>

      <StaleNote stale={production.stale} goToStage={goToStage} />

      {!production.outlineApproved && (
        <div className="notice warn">
          <Lock /> Approve the outline first — scenes are generated from approved sections.
        </div>
      )}

      {production.scenes.map((s) => (
        <div className="scene" key={s.id}>
          <div className="sceneicon"><Video /></div>
          <div>
            <b>Scene {s.ref} — {s.title}</b>
            {s.purpose && <p>{s.purpose}</p>}
          </div>
          {s.participants && <span><Users /> {s.participants}</span>}
          <span><Clock /> {s.runtime}</span>
          <button onClick={() => mutate(() => api.deleteScene(production.id, s.id), applyProduction)}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div className="actions">
        <button
          disabled={!production.outlineApproved}
          onClick={() => mutate(() => api.developScenes(production.id), applyProduction)}
        >
          Develop scenes from outline
        </button>
        <button
          className="primary"
          disabled={production.scenesApproved || !production.scenes.length}
          onClick={() => mutate(() => api.approveScenes(production.id), applyProduction)}
        >
          {production.scenesApproved ? <><Check size={15} /> Scenes approved</> : 'Approve scenes → Script'}
        </button>
      </div>
    </>
  );
}

function Sources() {
  const { production, applyProduction, mutate, workspace } = useStudio();
  const canImportVideo = workspace.capabilities.includes('source.existing_video');

  const [state, setState] = useState(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  // The desktop shell exposes exactly one thing here: a native file picker.
  const desktop = typeof window !== 'undefined' && window.studio?.desktop;

  const choose = async () => {
    const picked = await window.studio.pickVideo();
    if (picked) setPath(picked);
  };

  const load = useCallback(
    () => api.analysis(production.id).then(setState),
    [production.id]
  );
  useEffect(() => { load(); }, [load]);

  const add = (name, kind) =>
    mutate(() => api.addSource(production.id, { name, detail: 'Added by hand', kind }), applyProduction);

  const measure = async () => {
    setBusy(true);
    try { await mutate(() => api.analyseVideo(production.id, path), null); await load(); }
    catch { /* mutate reports it */ }
    finally { setBusy(false); }
  };

  const analysed = state?.sources.find((s) => s.analysis);
  const a = analysed?.analysis;

  return (
    <>
      <h2>Sources</h2>
      <p>Everything the Producer may use to plan this production.</p>

      {/* Measuring a video you already have. Every number below comes from
          ffmpeg on this machine — nothing is uploaded and no key is used. */}
      <div className="analyser">
        <label>Analyse a video you already have</label>
        <div className="analyserrow">
          {/* In the desktop build the user picks the file in a native dialog.
              In a browser there is no such thing: a file input reports a name,
              never a location, so the path has to be typed. */}
          {desktop ? (
            <button onClick={choose}>
              <Upload size={13} /> {path ? 'Choose a different file' : 'Choose a video…'}
            </button>
          ) : (
            <input
              placeholder="/Users/you/Movies/interview.mp4"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && path && canImportVideo && measure()}
            />
          )}
          <button className="primary" onClick={measure}
            disabled={!path || busy || !canImportVideo}
            title={canImportVideo ? '' : 'Requires a Content or Studio licence'}>
            {canImportVideo
              ? (busy ? 'Measuring…' : 'Measure')
              : <><Lock size={13} /> Not licensed</>}
          </button>
        </div>
        {desktop && path && <code className="chosenpath">{path}</code>}
        <small>
          {desktop ? 'Read in place — the file is not copied.' : 'A full path.'}
          {' '}Measured locally with ffmpeg — nothing leaves this machine.
          {state && !state.transcriber && ' No local transcriber is installed, so there will be no transcript.'}
        </small>
      </div>

      {a && (
        <div className="analysis">
          <div className="anfacts">
            <span><b>{a.facts.name}</b></span>
            {a.facts.video && <span>{a.facts.video.width}×{a.facts.video.height} · {a.facts.video.fps}fps</span>}
            <span>{a.facts.duration ? `${Math.round(a.facts.duration)}s` : 'unknown length'}</span>
            <span>{a.facts.audio ? `${a.facts.audio.codec} ${a.facts.audio.channels}ch` : 'no audio'}</span>
            {a.facts.bytes && <span>{(a.facts.bytes / 1024 / 1024).toFixed(1)} MB</span>}
          </div>

          <ul className="anfindings">
            {a.findings.map((f, i) => (
              <li key={i} className={f.level}>
                {f.level === 'warn' ? <AlertCircle size={13} /> : <Check size={13} />} {f.text}
              </li>
            ))}
            <li className={a.transcript ? 'info' : 'warn'}>
              <AlertCircle size={13} /> {a.transcriptNote}
            </li>
          </ul>

          {a.outline.length > 0 && (
            <div className="anoutline">
              <b>{a.outline.length} section{a.outline.length === 1 ? '' : 's'} measured from the shot changes</b>
              {a.outline.map((o) => (
                <span key={o.position}>{o.title} · {o.startsAt} · {o.runtime}</span>
              ))}
              <button onClick={() => mutate(() => api.adoptAnalysisOutline(production.id), null)
                .then(() => window.location.reload())}>
                Replace the outline with this
              </button>
              <small>This overwrites the outline you have now.</small>
            </div>
          )}
        </div>
      )}

      <div className="cards">
        {[[Upload, 'Upload file / video', 'file'], [Link, 'Add URL', 'url'],
          [FileText, 'Paste text', 'text'], [FolderKanban, 'Choose from Library', 'library']]
          .map(([I, t, kind]) => (
            <div className="card clickable" key={t} onClick={() => add(t, kind)}>
              <I /><b>{t}</b>
            </div>
          ))}
      </div>

      {production.sources.map((s) => (
        <div className="source" key={s.id}>
          <Video />
          <div>
            <b>{s.name}</b>
            <small>{s.detail}</small>
          </div>
        </div>
      ))}
    </>
  );
}

function Decisions() {
  const { production, applyProduction, mutate } = useStudio();
  const ICON = { locked: Lock, ok: Check, warning: AlertCircle };

  return (
    <>
      <h2>Decisions</h2>
      <p>The Producer separates what needs you from what it can decide and what is locked.</p>
      {production.decisions.map((g) => {
        const I = ICON[g.kind];
        return (
          <div className={'decisiongroup ' + g.kind} key={g.kind}>
            <b>{g.label}</b>
            {g.items.map((item) => (
              <div key={item.id}>
                <I size={15} />
                <span className={item.resolution ? 'resolved' : ''}>{item.text}</span>
                {g.kind === 'warning' && (
                  item.resolution
                    ? <em>{item.resolution}</em>
                    : <button onClick={() => mutate(
                        () => api.resolveDecision(production.id, item.id, 'Resolved by you'),
                        applyProduction
                      )}>Resolve</button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
