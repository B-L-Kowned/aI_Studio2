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

const PP_LABEL = 'block text-[10px] tracking-[.07em] text-faint font-semibold mb-[7px]';
const PP_LINE = 'flex gap-[6px] items-start text-[12px] m-[0_0_6px] leading-[1.45]';

function ProducerPanel({ result, onClose, onAction }) {
  return (
    <div className="border border-solid border-line bg-surface-2 rounded-lg p-[15px] mb-[18px]">
      <div className="flex justify-between items-center mb-[11px]">
        <b className="flex items-center gap-[7px] text-[12.5px]"><Sparkles size={16} /> Producer assessment</b>
        <button className="border-0 border-none border-current bg-transparent p-[3px] text-muted" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="grid grid-cols-[repeat(3,1fr)] gap-[15px] lte800:grid-cols-[1fr] [&_svg]:shrink-0 [&_svg]:mt-[2px] [&_svg]:w-[12px] [&_svg]:h-[12px] [&_svg]:text-muted">
        <div>
          <small className={PP_LABEL}>KNOWN</small>
          {result.known.map((k) => <p className={PP_LINE} key={k}><Check size={13} /> {k}</p>)}
        </div>
        <div>
          <small className={PP_LABEL}>INFERRED</small>
          {result.inferred.length
            ? result.inferred.map((k) => <p className={PP_LINE} key={k}><Sparkles size={13} /> {k}</p>)
            : <p className={'muted ' + PP_LINE}>Nothing inferred.</p>}
        </div>
        <div>
          <small className={PP_LABEL}>NEEDS YOU</small>
          {result.decisionsNeeded.length
            ? result.decisionsNeeded.map((k) => <p className={PP_LINE} key={k}><AlertCircle size={13} /> {k}</p>)
            : <p className={'muted ' + PP_LINE}>Nothing blocking.</p>}
        </div>
      </div>
      {result.proposals.length > 0 && (
        <div className="mt-[13px] flex gap-[7px] flex-wrap border-t border-t-line [border-top-style:solid] pt-[12px]">
          {result.proposals.map((p) => (
            <button className="text-[12px]" key={p.action} onClick={() => onAction(p.action)} title={p.detail}>{p.label}</button>
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

// Outline rows and scene rows share one grid shape: a trailing delete button
// and meta spans that drop out at narrow widths. The button rules sit on the
// row (not the button) so they keep out-ranking the generic button:hover.
const ROW = 'grid items-center lte800:grid-cols-[26px_1fr]'
  + ' [&>button:last-child]:border-0 [&>button:last-child]:border-none [&>button:last-child]:border-current'
  + ' [&>button:last-child]:bg-transparent [&>button:last-child]:text-faint [&>button:last-child]:p-[5px]'
  + ' [&>button:last-child:hover]:text-danger [&>button:last-child:hover]:bg-danger-soft';
const OUTLINE_ROW = 'group/row grid-cols-[24px_minmax(0,1fr)_auto_auto_28px] gap-[10px] border border-solid border-line rounded m-[4px_0] bg-surface hover:border-line-2';
const ROW_META = 'flex items-center gap-[5px] text-[12px] text-muted lte800:hidden [&_svg]:w-[13px] [&_svg]:h-[13px]';

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
        <div className={ROW + ' ' + OUTLINE_ROW + (s.purpose ? ' p-[9px_10px]' : ' p-[6px_10px]')} key={s.id}>
          <b className="font-mono text-[11px] text-faint font-medium">{String(i + 1).padStart(2, '0')}</b>
          <div className="min-w-0">
            <input
              className="w-full [font-variant-numeric:tabular-nums] text-left border-transparent bg-transparent font-[560] text-[13.5px] p-[3px_5px] m-[-3px_0_0_-5px] hover:border-line focus:border-accent focus:bg-surface"
              defaultValue={s.title}
              onBlur={(e) => {
                if (e.target.value !== s.title) {
                  mutate(() => api.updateSection(production.id, s.id, { title: e.target.value }), applyProduction);
                }
              }}
            />
            {/* Only a real purpose earns a second line. The placeholder sentence
                said the same nothing on every row and made each one 67px tall. */}
            {s.purpose && <small className="block text-muted text-[12px] mt-[2px]">{s.purpose}</small>}
          </div>
          {s.participants && <span className={ROW_META + ' whitespace-nowrap'}><Users /> {s.participants}</span>}
          {/* The row's width:100% always beat the old 62px here, so 100% it is. */}
          <input
            className="w-full [font-variant-numeric:tabular-nums] text-center p-[5px_6px] lte800:hidden"
            defaultValue={s.runtime}
            aria-label="Runtime"
            onBlur={(e) => {
              if (e.target.value !== s.runtime) {
                mutate(() => api.updateSection(production.id, s.id, { runtime: e.target.value }), applyProduction);
              }
            }}
          />
          <button
            className="opacity-0 [transition:opacity_.12s] group-hover/row:opacity-100 focus-visible:opacity-100"
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
        <div className={ROW + ' grid-cols-[30px_minmax(0,1fr)_auto_auto_30px] gap-[12px] border-b border-b-line [border-bottom-style:solid] p-[13px_0]'} key={s.id}>
          <div className="w-[32px] h-[32px] bg-canvas border border-solid border-line rounded grid place-items-center text-muted [&_svg]:w-[15px] [&_svg]:h-[15px]"><Video /></div>
          <div>
            <b className="text-[13.5px] font-[560]">Scene {s.ref} — {s.title}</b>
            {s.purpose && <p className="text-muted m-[3px_0_0] text-[12px]">{s.purpose}</p>}
          </div>
          {s.participants && <span className={ROW_META}><Users /> {s.participants}</span>}
          <span className={ROW_META}><Clock /> {s.runtime}</span>
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

const ANALYSER_INPUT = 'flex-1 font-mono text-[12.5px] font-normal not-italic leading-[normal] p-[7px_9px]';

// Finding rows keep their level class; the level only picks a colour.
const findingClass = (level) => level
  + ' flex items-start gap-[7px] text-[13px] [&>svg]:flex-none [&>svg]:mt-[2px]'
  + (level === 'warn' ? ' text-warn' : ' text-ink-2')
  + (level === 'info' ? ' [&>svg]:text-ok' : '');

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

      <div className="border border-solid border-line rounded-lg p-[14px] m-[14px_0] bg-surface-2">
        <label className="block text-[12px] font-semibold mb-[7px]">Research a website</label>
        <div className="flex gap-[8px]">
          <input
            className={ANALYSER_INPUT}
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
        <small className="block text-faint text-[11.5px] mt-[7px] leading-[1.5]">The app reads the public page, stores the evidence it used, and proposes brief fields. You approve it before it can unlock production.</small>
      </div>

      {workflow?.research.map((item) => (
        <div className={'border border-solid rounded-lg p-[14px] m-[12px_0] bg-surface ' + item.status + (item.status === 'failed' ? ' border-line border-l-[3px] border-l-danger' : ' border-line')} key={item.id}>
          <div className="flex justify-between gap-[16px] items-start">
            <div className="min-w-0 flex flex-col gap-[3px]">
              <b className="text-[13.5px]">{item.title || item.url}</b>
              <a className="font-mono text-[11px] font-normal not-italic leading-[normal] text-muted overflow-hidden text-ellipsis" href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
            </div>
            <span className={'rstatus ' + (item.reviewed ? 'complete' : item.status)}>
              {item.reviewed ? 'approved' : item.status}
            </span>
          </div>
          {item.error && <p className="dangerv text-[12.5px] leading-[1.55] flex items-start gap-[6px] text-danger"><AlertCircle size={13} /> {item.error}</p>}
          {item.evidence?.summary && <p className="text-[12.5px] leading-[1.55] text-ink-2">{item.evidence.summary}</p>}
          {item.evidence?.headings?.length > 0 && (
            <div className="flex flex-wrap gap-[5px] m-[9px_0]">
              {item.evidence.headings.slice(0, 8).map((heading, i) => <span className="p-[3px_7px] border border-solid border-line rounded-[20px] text-muted text-[10.5px]" key={`${heading}-${i}`}>{heading}</span>)}
            </div>
          )}
          {Object.keys(item.suggestedBrief ?? {}).length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-[5px_10px] p-[10px_0] m-0">
              {Object.entries(item.suggestedBrief).map(([label, value]) => (
                <React.Fragment key={label}><dt className="text-faint text-[10px] uppercase tracking-[.04em]">{label}</dt><dd className="m-0 text-[12px] text-ink-2">{value}</dd></React.Fragment>
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
      <div className="m-[16px_0] p-[14px] border border-solid border-line rounded bg-surface-2">
        <label className="block text-[11px] font-semibold tracking-[.04em] uppercase text-muted mb-[8px]">Analyse a video you already have</label>
        <div className="flex gap-[8px]">
          {/* In the desktop build the user picks the file in a native dialog.
              In a browser there is no such thing: a file input reports a name,
              never a location, so the path has to be typed. */}
          {desktop ? (
            <button onClick={choose}>
              <Upload size={13} /> {path ? 'Choose a different file' : 'Choose a video…'}
            </button>
          ) : (
            <input
              className={ANALYSER_INPUT}
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
        {desktop && path && <code className="block mt-[7px] font-mono text-[11px] font-normal not-italic leading-[normal] text-muted overflow-hidden text-ellipsis whitespace-nowrap">{path}</code>}
        <small className="block mt-[7px] text-faint text-[11.5px]">
          {desktop ? 'Read in place — the file is not copied.' : 'A full path.'}
          {' '}Measured locally with ffmpeg — nothing leaves this machine.
          {state && !state.transcriber && ' No local transcriber is installed, so there will be no transcript.'}
        </small>
      </div>

      {a && (
        <div className="analysis">
          <div className="flex flex-wrap gap-[14px] p-[10px_14px] bg-surface-2 border-b border-b-line [border-bottom-style:solid] text-[12.5px] text-ink-2">
            <span><b>{a.facts.name}</b></span>
            {a.facts.video && <span>{a.facts.video.width}×{a.facts.video.height} · {a.facts.video.fps}fps</span>}
            <span>{a.facts.duration ? `${Math.round(a.facts.duration)}s` : 'unknown length'}</span>
            <span>{a.facts.audio ? `${a.facts.audio.codec} ${a.facts.audio.channels}ch` : 'no audio'}</span>
            {a.facts.bytes && <span>{(a.facts.bytes / 1024 / 1024).toFixed(1)} MB</span>}
          </div>

          <ul className="list-none m-0 p-[10px_14px] flex flex-col gap-[6px]">
            {a.findings.map((f, i) => (
              <li key={i} className={findingClass(f.level)}>
                {f.level === 'warn' ? <AlertCircle size={13} /> : <Check size={13} />} {f.text}
              </li>
            ))}
            <li className={findingClass(a.transcript ? 'info' : 'warn')}>
              <AlertCircle size={13} /> {a.transcriptNote}
            </li>
          </ul>

          {a.outline.length > 0 && (
            <div className="flex flex-col gap-[5px] items-start p-[12px_14px] border-t border-t-line [border-top-style:solid]">
              <b className="text-[12.5px]">{a.outline.length} section{a.outline.length === 1 ? '' : 's'} measured from the shot changes</b>
              {a.outline.map((o) => (
                <span className="font-mono text-[11.5px] font-normal not-italic leading-[normal] text-muted" key={o.position}>{o.title} · {o.startsAt} · {o.runtime}</span>
              ))}
              <button className="mt-[6px]" onClick={() => mutate(() => api.adoptAnalysisOutline(production.id), null)
                .then(() => window.location.reload())}>
                Replace the outline with this
              </button>
              <small className="text-faint text-[11px]">This overwrites the outline you have now.</small>
            </div>
          )}
        </div>
      )}

      <div className="cards">
        {[[Upload, 'Upload file / video', 'file'],
          [FileText, 'Paste text', 'text'], [FolderKanban, 'Choose from Library', 'library']]
          .map(([I, t, kind]) => (
            <div className="card cursor-pointer hover:border-ink" key={t} onClick={() => add(t, kind)}>
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

const FORM_LABEL = 'flex flex-col gap-[4px] text-muted text-[11px] font-semibold';
const PROOF_SMALL = 'text-muted text-[11px]';
// A proof keeps its status class; the status only recolours or fades the card.
const PROOF_STATUS = { approved: ' border-[#c5e3d5]', rejected: ' border-line opacity-[.65]' };

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
        <div className="border border-solid border-line rounded-lg p-[14px] m-[14px_0] bg-surface-2 grid grid-cols-[1fr_1fr] gap-[10px]">
          <label className={FORM_LABEL}>Performer
            <select value={form.presenterId} onChange={(e) => setForm({ ...form, presenterId: e.target.value })}>
              {presenters.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.kind}</option>)}
            </select>
          </label>
          <label className={FORM_LABEL}>Proof image URL
            <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              placeholder="Provider preview or approved reference image" />
          </label>
          <label className={FORM_LABEL}>Outfit
            <input value={form.outfit} onChange={(e) => setForm({ ...form, outfit: e.target.value })}
              placeholder="Black crew neck, no logos" />
          </label>
          <label className={FORM_LABEL}>Background
            <input value={form.background} onChange={(e) => setForm({ ...form, background: e.target.value })}
              placeholder="Warm neutral studio" />
          </label>
          <label className={FORM_LABEL}>Framing
            <input value={form.framing} onChange={(e) => setForm({ ...form, framing: e.target.value })}
              placeholder="9:16, waist-up, centered" />
          </label>
          <label className={FORM_LABEL}>Notes
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Expression, lighting, continuity notes" />
          </label>
          <button className="primary justify-self-start self-end" onClick={save}
            disabled={!form.presenterId || !form.imageUrl.trim() || !form.outfit.trim() || !form.background.trim() || !form.framing.trim()}>
            <ImageIcon size={14} /> Save proof for approval
          </button>
        </div>
      ) : (
        <div className="notice"><Check /> No personal or fictional performer is castable yet. Stock avatars use the selected provider appearance.</div>
      )}

      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[11px] mt-[14px]">
        {workflow.appearances.map((proof) => (
          <article className={'grid grid-cols-[120px_1fr] border border-solid rounded-lg overflow-hidden bg-surface ' + proof.status + (PROOF_STATUS[proof.status] ?? ' border-line')} key={proof.id}>
            {/^https?:\/\//i.test(proof.imageUrl ?? '')
              ? <img className="w-[120px] h-[150px] object-cover bg-canvas" src={proof.imageUrl} alt={`${proof.presenterName} appearance proof`} />
              : <div className="w-[120px] h-[150px] object-cover bg-canvas grid place-items-center text-line-2"><ImageIcon /></div>}
            <div className="flex flex-col gap-[5px] p-[11px] min-w-0">
              <span className={'rstatus ' + proof.status}>{proof.status}</span>
              <b className="text-[12.5px]">{proof.presenterName} · {proof.label}</b>
              <small className={PROOF_SMALL}><strong className="text-ink-2 font-semibold">Outfit</strong> {proof.outfit || '—'}</small>
              <small className={PROOF_SMALL}><strong className="text-ink-2 font-semibold">Background</strong> {proof.background || '—'}</small>
              <small className={PROOF_SMALL}><strong className="text-ink-2 font-semibold">Framing</strong> {proof.framing || '—'}</small>
              {proof.notes && <p className="text-[11.5px] text-muted m-[2px_0]">{proof.notes}</p>}
              {proof.status === 'draft' && (
                <div className="flex gap-[6px] mt-auto">
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
