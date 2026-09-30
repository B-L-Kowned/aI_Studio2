import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Users, Clock, Video, Upload, FileText, Link, FolderKanban,
  Lock, Check, AlertCircle, UserPlus, Trash2, X, RefreshCw, Image as ImageIcon,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { toSeconds, toClock } from '../utils/format.js';
import { api } from '../services/api.js';
import PeoplePage from '../components/PeoplePage.jsx';

const VIEWS = ['Brief', 'Outline', 'Scenes', 'People', 'Sources', 'Appearance', 'Decisions'];

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
        <p className="muted">Runs a deterministic production check. It flags only decisions that still need you.</p>
        <button className="producer" onClick={askProducer}><Sparkles /> Review with Producer</button>
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
        {view === 'Appearance' && <Appearance />}
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
          Rebalance timings
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
  const [workflow, setWorkflow] = useState(null);
  const [path, setPath] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  // The desktop shell exposes exactly one thing here: a native file picker.
  const desktop = typeof window !== 'undefined' && window.studio?.desktop;

  const choose = async () => {
    const picked = await window.studio.pickVideo();
    if (picked) setPath(picked);
  };

  const load = useCallback(async () => {
    const [analysis, flow] = await Promise.all([
      api.analysis(production.id),
      api.workflow(production.id),
    ]);
    setState(analysis);
    setWorkflow(flow);
  }, [production.id]);
  useEffect(() => { load(); }, [load]);

  const add = (name, kind) =>
    mutate(() => api.addSource(production.id, { name, detail: 'Added by hand', kind }), applyProduction);

  const measure = async () => {
    setBusy(true);
    try { await mutate(() => api.analyseVideo(production.id, path), null); await load(); }
    catch { /* mutate reports it */ }
    finally { setBusy(false); }
  };

  const research = async () => {
    setBusy(true);
    try {
      await mutate(() => api.researchWebsite(production.id, website), (res) => setWorkflow(res.data));
      setWebsite('');
      const opened = await api.openProduction(production.id);
      applyProduction(opened);
    } catch { /* mutate reports it */ }
    finally { setBusy(false); }
  };

  const approveResearch = async (item) => {
    try {
      await mutate(
        () => api.reviewResearch(production.id, item.id, true),
        (res) => setWorkflow(res.data)
      );
      // Research may have filled empty brief fields, so refresh the production
      // rather than leaving Brief one save behind the evidence on this page.
      applyProduction(await api.openProduction(production.id));
    } catch { /* mutate reports it */ }
  };

  const analysed = state?.sources.find((s) => s.analysis);
  const a = analysed?.analysis;

  return (
    <>
      <h2>Sources</h2>
      <p>Everything the Producer may use to plan this production, with the website claims preserved for review.</p>

      <div className="webresearch">
        <label>Research a website</label>
        <div className="analyserrow">
          <input
            type="text"
            inputMode="url"
            placeholder="https://example.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && website.trim() && !busy && research()}
          />
          <button className="primary" onClick={research} disabled={!website.trim() || busy}>
            <Link size={13} /> {busy ? 'Researching…' : 'Research website'}
          </button>
        </div>
        <small>The app reads the public page, stores the evidence it used, and proposes brief fields. You approve it before it can unlock production.</small>
      </div>

      {workflow?.research.map((item) => (
        <div className={'researchcard ' + item.status} key={item.id}>
          <div className="researchhead">
            <div>
              <b>{item.title || item.url}</b>
              <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
            </div>
            <span className={'rstatus ' + (item.reviewed ? 'complete' : item.status)}>
              {item.reviewed ? 'approved' : item.status}
            </span>
          </div>
          {item.error && <p className="dangerv"><AlertCircle size={13} /> {item.error}</p>}
          {item.evidence?.summary && <p>{item.evidence.summary}</p>}
          {item.evidence?.headings?.length > 0 && (
            <div className="evidencechips">
              {item.evidence.headings.slice(0, 8).map((heading, i) => <span key={`${heading}-${i}`}>{heading}</span>)}
            </div>
          )}
          {Object.keys(item.suggestedBrief ?? {}).length > 0 && (
            <dl className="researchbrief">
              {Object.entries(item.suggestedBrief).map(([label, value]) => (
                <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>
              ))}
            </dl>
          )}
          {item.status === 'complete' && !item.reviewed && (
            <button className="primary" onClick={() => approveResearch(item)}>
              <Check size={13} /> Approve evidence + fill empty brief fields
            </button>
          )}
          {item.status === 'failed' && (
            <button onClick={async () => {
              try {
                await mutate(
                  () => api.deleteResearch(production.id, item.id),
                  (res) => setWorkflow(res.data)
                );
                applyProduction(await api.openProduction(production.id));
              } catch { /* mutate reports it */ }
            }}>
              <Trash2 size={13} /> Remove failed source
            </button>
          )}
        </div>
      ))}

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
        {[[Upload, 'Upload file / video', 'file'],
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

function Appearance() {
  const { production, mutate } = useStudio();
  const [workflow, setWorkflow] = useState(null);
  const [presenters, setPresenters] = useState([]);
  const [form, setForm] = useState({
    presenterId: '', label: 'Approved look', imageUrl: '', outfit: '', background: '', framing: '', notes: '',
  });

  const load = useCallback(async () => {
    const [flow, castable] = await Promise.all([
      api.workflow(production.id),
      api.castablePresenters(),
    ]);
    const proofable = castable.filter((p) => p.kind !== 'avatar');
    setWorkflow(flow);
    setPresenters(proofable);
    setForm((current) => ({
      ...current,
      presenterId: current.presenterId || (proofable[0]?.id ? String(proofable[0].id) : ''),
    }));
  }, [production.id]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      await mutate(
        () => api.createAppearance(production.id, { ...form, presenterId: Number(form.presenterId) }),
        (res) => setWorkflow(res.data)
      );
      setForm((current) => ({ ...current, imageUrl: '', outfit: '', background: '', framing: '', notes: '' }));
    } catch { /* mutate reports it */ }
  };

  const setStatus = async (proof, status) => {
    try {
      await mutate(
        () => api.updateAppearance(production.id, proof.id, { status }),
        (res) => setWorkflow(res.data)
      );
    } catch { /* mutate reports it */ }
  };

  if (!workflow) return <p className="muted">Loading…</p>;
  return (
    <>
      <h2>Appearance Approval</h2>
      <p>Approve the exact look before video generation: performer, outfit, background and framing.</p>

      {presenters.length ? (
        <div className="appearanceform">
          <label>Performer
            <select value={form.presenterId} onChange={(e) => setForm({ ...form, presenterId: e.target.value })}>
              {presenters.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.kind}</option>)}
            </select>
          </label>
          <label>Proof image URL
            <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              placeholder="Provider preview or approved reference image" />
          </label>
          <label>Outfit
            <input value={form.outfit} onChange={(e) => setForm({ ...form, outfit: e.target.value })}
              placeholder="Black crew neck, no logos" />
          </label>
          <label>Background
            <input value={form.background} onChange={(e) => setForm({ ...form, background: e.target.value })}
              placeholder="Warm neutral studio" />
          </label>
          <label>Framing
            <input value={form.framing} onChange={(e) => setForm({ ...form, framing: e.target.value })}
              placeholder="9:16, waist-up, centered" />
          </label>
          <label>Notes
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Expression, lighting, continuity notes" />
          </label>
          <button className="primary" onClick={save}
            disabled={!form.presenterId || !form.imageUrl.trim() || !form.outfit.trim() || !form.background.trim() || !form.framing.trim()}>
            <ImageIcon size={14} /> Save proof for approval
          </button>
        </div>
      ) : (
        <div className="notice"><Check /> No personal or fictional performer is castable yet. Stock avatars use the selected provider appearance.</div>
      )}

      <div className="proofgrid">
        {workflow.appearances.map((proof) => (
          <article className={'proofcard ' + proof.status} key={proof.id}>
            {/^https?:\/\//i.test(proof.imageUrl ?? '')
              ? <img src={proof.imageUrl} alt={`${proof.presenterName} appearance proof`} />
              : <div className="proofplaceholder"><ImageIcon /></div>}
            <div>
              <span className={'rstatus ' + proof.status}>{proof.status}</span>
              <b>{proof.presenterName} · {proof.label}</b>
              <small><strong>Outfit</strong> {proof.outfit || '—'}</small>
              <small><strong>Background</strong> {proof.background || '—'}</small>
              <small><strong>Framing</strong> {proof.framing || '—'}</small>
              {proof.notes && <p>{proof.notes}</p>}
              {proof.status === 'draft' && (
                <div className="proofactions">
                  <button onClick={() => setStatus(proof, 'rejected')}>Reject</button>
                  <button className="primary" onClick={() => setStatus(proof, 'approved')}>
                    <Check size={13} /> Approve this look
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
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
