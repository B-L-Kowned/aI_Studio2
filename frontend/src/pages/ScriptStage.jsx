import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Sparkles, Check, X, Lock, AlertCircle, FileText, Play, Pause, Minus, Plus, ChevronDown, Headphones, RefreshCw, MousePointerClick, AlertTriangle } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import MadeByChooser from '../components/MadeByChooser.jsx';
import PlanStage from './PlanStage.jsx';
import LineVoice from '../components/LineVoice.jsx';
import { madeByOf } from '../utils/made-by.js';
import { EnhanceButton, Suggestion, modelLabel } from '../components/Enhance.jsx';
import PersonaChooser from '../components/PersonaChooser.jsx';

const GENERATOR_LABELS = {
  included: 'Built-in deterministic',
  imported: 'Imported',
  ollama: 'Local Ollama',
  openai: 'ChatGPT (OpenAI)',
  anthropic: 'Claude (Anthropic)',
  groq: 'Groq',
  xai: 'Grok (xAI)',
};
const generatorLabel = (v) => {
  const provider = GENERATOR_LABELS[v.generatorProvider] ?? v.generatorProvider ?? 'Unknown engine';
  return v.generatorModel ? `${provider} · ${v.generatorModel}` : provider;
};

// Who speaks a line. The slate is PJB; the value stays "Pat" because that is
// what the speaker is cast from.
const SPEAKERS = [['Pat', 'PJB']];
const CONFIRM_RE = /\[CONFIRM:[^\]]*\]/g;
// Within this, a length change by speed sounds natural; beyond it, rewrite.
const NATURAL_SPEED = [0.88, 1.12];
const words = (t) => String(t).replace(CONFIRM_RE, ' ').split(/\s+/).filter(Boolean).length;
const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s) % 60)).padStart(2, '0')}`;
const signed = (s) => `${s >= 0 ? '+' : '−'}${clock(Math.abs(s))}`;

export default function ScriptStage({ goToStage }) {
  const { production, mutate } = useStudio();
  const [state, setState] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [timing, setTiming] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [drafts, setDrafts] = useState({});           // line id → unsaved text, for live timing
  const [listening, setListening] = useState(null);   // { id, url } | { id, busy }
  const [showVersions, setShowVersions] = useState(false);
  const [fullRead, setFullRead] = useState(null);     // the whole script in one track
  const [checks, setChecks] = useState(null);         // the plain rules, run on every change
  const [showChecks, setShowChecks] = useState(false);
  const [enh, setEnh] = useState(null);               // the local model's rewrite of the draft
  const [compare, setCompare] = useState(null);       // the version that rewrite came from
  const [suggest, setSuggest] = useState(null);       // one line reworded: { lineId, busy } | result
  const [details, setDetails] = useState(false);      // Plan details drawer
  const [segs, setSegs] = useState([]);               // production lines (an approved script's takes)
  const [hint, setHint] = useState(() => { try { return !localStorage.getItem('hint-fix-word'); } catch { return false; } });
  const lineRefs = useRef({});
  const draftPlayer = useRef(null);

  const load = useCallback(async () => {
    const [script, flow, t] = await Promise.all([
      api.script(production.id), api.workflow(production.id), api.scriptTiming(production.id),
    ]);
    setState(script); setWorkflow(flow); setTiming(t); setLoadError(null); setDrafts({});
  }, [production.id]);
  useEffect(() => { load().catch(setLoadError); }, [load]);

  const latest = state?.latest;

  // An approved script's lines have their own takes: those are what plays, and
  // what a clicked word fixes. A draft only has the Hear cache.
  const accepted = latest?.status === 'accepted';
  useEffect(() => {
    if (!accepted) { setSegs([]); return undefined; }
    let live = true;
    api.segments(production.id).then((r) => live && setSegs(r.segments ?? [])).catch(() => {});
    return () => { live = false; };
  }, [production.id, accepted, latest?.id]);

  // Make the lines ahead of time in the background, so Hear plays at once.
  // Re-run when the words change, since a changed line is a new read.
  const wordsKey = (latest?.segments ?? []).map((x) => x.text).join('\n');
  useEffect(() => {
    if (latest?.id) api.warmScript(production.id, latest.id).catch(() => {});
  }, [production.id, latest?.id, wordsKey]);

  useEffect(() => {
    if (!latest?.id) return undefined;
    let live = true;
    api.fullRead(production.id, latest.id).then((r) => live && setFullRead(r)).catch(() => {});
    return () => { live = false; };
  }, [production.id, latest?.id]);
  useEffect(() => {
    if (fullRead?.state !== 'running') return undefined;
    const t = setInterval(() => api.fullRead(production.id, latest.id).then(setFullRead).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [fullRead?.state, production.id, latest?.id]);
  const loadChecks = useCallback(() => api.scriptChecks(production.id).then(setChecks).catch(() => setChecks(null)), [production.id]);
  useEffect(() => { if (latest?.id) loadChecks(); }, [latest?.id, wordsKey, loadChecks]);
  useEffect(() => { api.enhanceState(production.id).then(setEnh).catch(() => {}); }, [production.id]);
  useEffect(() => {
    if (enh?.state !== 'running') return undefined;
    const t = setInterval(() => api.enhanceState(production.id).then((j) => {
      setEnh(j);
      if (j?.state === 'done') load().catch(() => {});
    }).catch(() => {}), 2500);
    return () => clearInterval(t);
  }, [enh?.state, production.id, load]);
  const brief = useMemo(() => Object.fromEntries(production.brief.map((b) => [b.label, b.value])), [production.brief]);

  // A finished video is the length it was published at; there is nothing left
  // to fit, so no speed or word-count advice. The file's own duration wins: the
  // transcript's figure is where the speech ends, not where the video does.
  const published = !!brief['Completed asset'];
  const recordedLength = /(\d+:\d{2}) as published/.exec(brief['Script length'] ?? '')?.[1] ?? null;
  const [fileSeconds, setFileSeconds] = useState(null);
  useEffect(() => {
    if (!published) return undefined;
    let live = true;
    api.library().then((items) => {
      const f = items.filter((a) => a.productionId === production.id && a.duration && !/^Recording — /.test(a.name)).pop();
      if (live) setFileSeconds(f?.duration ?? null);
    }).catch(() => {});
    return () => { live = false; };
  }, [published, production.id]);

  // ---- timing, recomputed as you type
  const lines = useMemo(() => (latest?.segments ?? []).map((s) => {
    const text = drafts[s.id] ?? s.text;
    return { ...s, text, words: words(text), checks: (text.match(CONFIRM_RE) ?? []).length };
  }), [latest, drafts]);
  const wpm = timing?.wpm ?? 150;
  const naturalSecs = (w) => (w / (timing?.naturalWpm ?? 150)) * 60;
  const secsAt = (w) => (w / wpm) * 60;
  const totalWords = lines.reduce((n, l) => n + l.words, 0);
  const total = secsAt(totalWords);
  const target = timing?.targetSeconds ?? 0;
  const delta = total - target;
  const openChecks = lines.reduce((n, l) => n + l.checks, 0);
  const fitSpeed = target ? Math.round((naturalSecs(totalWords) / target) * 100) / 100 : 1;
  const within = target && Math.abs(delta) <= target * 0.05;

  // ---- lines placed into outline sections by position (imported scripts carry no section tags)
  const grouped = useMemo(() => {
    const sections = timing?.sections ?? [];
    const planned = sections.reduce((n, s) => n + s.seconds, 0);
    if (!sections.length || !planned || !lines.length) return [{ title: null, seconds: 0, lines }];
    const bounds = []; let acc = 0;
    for (const s of sections) { acc += s.seconds / planned; bounds.push(acc); }
    const out = sections.map((s) => ({ ...s, lines: [] }));
    let start = 0;
    for (const l of lines) {
      const mid = totalWords ? (start + l.words / 2) / totalWords : 0;
      out[Math.min(bounds.findIndex((b) => mid <= b + 1e-9), out.length - 1)].lines.push(l);
      start += l.words;
    }
    return out;
  }, [timing, lines, totalWords]);

  if (!state || !workflow || !timing) return <LoadState error={loadError} retry={() => load().catch(setLoadError)} label="Loading script…" />;

  const researchGate = workflow.lock?.gates.find((g) => g.key === 'research');
  // Writing needs an approved structure; the shot list is planned beside the script, not before it.
  const ready = production.outlineApproved && researchGate?.status !== 'block';
  const apply = (res) => { setState(res.data); setDrafts({}); };
  const imported = latest?.generatorProvider === 'imported';
  const editable = latest?.status === 'proposed';

  const setSpeed = async (next) => {
    const s = Math.round(Math.min(timing.speedRange[1], Math.max(timing.speedRange[0], next)) * 100) / 100;
    setTiming((t) => ({ ...t, speed: s, wpm: Math.round(t.naturalWpm * s) }));
    try { await mutate(() => api.setVoiceSpeed(production.id, s), null, { silent: true }); } catch { load(); }
  };
  const saveLine = (s, patch) =>
    mutate(() => api.updateScriptSegment(production.id, latest.id, s.id, patch), apply).catch(() => {});
  // Hear a line: its take if it has one, else the cache (made now if need be).
  const hearLine = async (l) => {
    const r = await mutate(() => api.listenLine(production.id, latest.id, l.id), null, { silent: true });
    const url = r.data.url;
    return {
      url, duration: r.data.duration,
      takeId: Number(/\/takes\/(\d+)\/audio/.exec(url)?.[1]) || null,
      cacheKey: /[?&]k=([0-9a-f]{16})/.exec(url)?.[1] ?? null, lineId: l.id,
    };
  };
  // A draft line is a text box; its Hear plays in place, with no player bar.
  const playDraft = async (l) => {
    const a = draftPlayer.current ?? (draftPlayer.current = new Audio());
    if (listening?.id === l.id && listening.url && !a.paused) { a.pause(); return; }
    setListening({ id: l.id, busy: true });
    try {
      const { url } = await hearLine(l);
      a.src = url;
      a.onended = () => setListening(null);
      a.onpause = () => setListening((x) => (x?.id === l.id ? null : x));
      setListening({ id: l.id, url });
      await a.play();
    } catch { setListening(null); }
  };
  const dismissHint = () => { setHint(false); try { localStorage.setItem('hint-fix-word', '1'); } catch { /* storage blocked */ } };
  const hearAll = async () => {
    try {
      const r = await mutate(() => api.listenAll(production.id, latest.id), null, { silent: true });
      setFullRead(r.data);
    } catch { /* mutate reports it */ }
  };
  const runEnhance = (mode) => mutate(() => api.enhanceScript(production.id, mode), (r) => { setEnh(r.data); setCompare(null); }, { silent: true }).catch(() => {});
  const undoEnhance = async () => {
    try { await mutate(() => api.undoEnhance(production.id, enh.result.versionId), null); } catch { return; }
    setEnh(null); setCompare(null); load().catch(() => {});
  };
  const toggleCompare = async () => {
    if (compare) { setCompare(null); return; }
    const prev = state.versions.find((v) => v.version === enh.result.from);
    if (prev) setCompare(await api.scriptVersionLines(production.id, prev.id).catch(() => null));
  };
  const fixChecks = (ids = null) => mutate(() => api.fixScriptChecks(production.id, ids), (r) => setChecks(r.data.checks))
    .then(() => load()).catch(() => {});
  const improve = async (l, goal) => {
    setSuggest({ lineId: l.id, busy: true });
    try {
      const r = await mutate(() => api.improveLine(production.id, l.id, goal), null, { silent: true });
      setSuggest(r.data);
    } catch { setSuggest(null); }
  };
  const goLine = (id) => {
    const el = lineRefs.current[id];
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus();
  };
  const nextCheck = () => {
    const ids = lines.filter((l) => l.checks).map((l) => l.id);
    const el = lineRefs.current[ids[0]];
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus();
  };
  const accept = async () => {
    if (openChecks && !window.confirm(`${openChecks} [CONFIRM] check${openChecks === 1 ? ' is' : 's are'} still open. Those lines can't be voiced until resolved. Accept anyway?`)) return;
    await mutate(() => api.acceptScript(production.id, latest.id), apply);
    await mutate(() => api.buildSegments(production.id), null, { silent: true });
    // Your own recording does not need the AI voice first; everything else does.
    goToStage?.(madeByOf(production) === 'self' ? 'Make' : 'Voice');
  };

  // Length is shown, with its fix, in the header; the list is for everything else.
  const issues = (checks?.issues ?? []).filter((i) => i.kind !== 'length');
  const fixable = issues.filter((i) => i.fix).length;
  const lineIssues = (id) => issues.filter((i) => i.lineId === id && i.kind !== 'website');
  const enhRunning = enh?.state === 'running';
  const enhDone = enh?.state === 'done' && enh.result?.versionId === latest?.id;
  const tone = !target ? 'text-muted' : within ? 'text-ok' : 'text-warn';
  const fitLink = editable && !published && !enhRunning
    ? <> <button className="ghostbtn p-0 text-accent text-[12px]" onClick={() => runEnhance('fit')}><Sparkles size={11} className="inline -mt-[2px]" /> Fit to time</button></>
    : null;
  // One voice throughout: naming the speaker on every line says nothing.
  const oneSpeaker = new Set(lines.map((l) => l.speaker)).size <= 1;
  const barPct = target ? Math.min(100, (total / Math.max(total, target)) * 100) : 0;
  const targetPct = target ? Math.min(100, (target / Math.max(total, target)) * 100) : 0;

  return (
    <div className="stagepane">
      {/* One quiet line of facts: what it is, who it is for, how it is made. */}
      <div className="flex flex-wrap items-center gap-x-[6px] gap-y-[4px] text-[12.5px] text-muted mb-[8px]">
        {[
          brief.Priority && <span key="p" className={brief.Priority === 'P1' ? 'text-danger font-semibold' : 'font-[560] text-ink-2'}>{brief.Priority}</span>,
          brief.Format && <span key="f">{brief.Format}</span>,
          brief.Audience && !/^(confirm|verify|one verified|one audience|tbd)\b/i.test(brief.Audience) && <span key="a" className="truncate max-w-[340px]" title={`For: ${brief.Audience}`}>For {brief.Audience.charAt(0).toLowerCase()}{brief.Audience.slice(1)}</span>,
          <PersonaChooser key="pe" onChange={() => api.scriptTiming(production.id).then(setTiming).catch(() => {})} />,
          <MadeByChooser key="m" inline />,
        ].filter(Boolean).flatMap((x, i) => (i ? [<span key={`s${i}`} className="text-line-2" aria-hidden="true">·</span>, x] : [x]))}
        <button className="ghostbtn text-[12.5px] text-muted hover:text-ink p-[1px_4px] ml-auto" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
          Plan details <ChevronDown size={12} className={details ? 'rotate-180' : ''} />
        </button>
      </div>
      {brief['Verify first'] && !details && (
        <p className="m-[0_0_8px] text-[12.5px] text-warn flex items-center gap-[6px]"><AlertCircle size={13} className="flex-none" /> <span><b className="font-[600]">Verify before recording.</b> {brief['Verify first']}</span></p>
      )}
      {details && <div className="mb-[16px]"><PlanStage goToStage={goToStage} /></div>}

      {!latest && (
        <div className="sectiontitle mt-[18px]">
          <div>
            <h2>Script</h2>
            <p>No script yet</p>
          </div>
          <button className="primary" disabled={!ready} onClick={() => mutate(() => api.generateScript(production.id), apply)}>
            <Sparkles size={15} /> Generate script
          </button>
        </div>
      )}

      {!ready && !latest && (
        <div className="notice warn">
          <Lock /> Locked until source evidence and the outline are approved in Plan.
          {' '}Research: {researchGate?.status === 'pass' ? 'approved' : researchGate?.detail ?? 'not approved'} ·
          {' '}Outline: {production.outlineApproved ? 'approved' : 'not approved'}
        </div>
      )}

      {latest?.stale && (
        <div className="stalebar items-center">
          <AlertCircle size={15} />
          <span className="flex-1">The plan changed after this script was written ({latest.staleReason.toLowerCase()}). Nothing was overwritten.</span>
          <button onClick={() => mutate(() => api.keepScript(production.id, latest.id), null).then(load).catch(() => {})}>
            <Check size={13} /> Keep this script
          </button>
          <button disabled={!ready} onClick={() => mutate(() => api.generateScript(production.id), apply)}>
            <Sparkles size={13} /> New draft
          </button>
        </div>
      )}

      {!latest && ready && (
        <div className="empty"><FileText size={30} /><p>No script yet. Generate one from the approved plan.</p></div>
      )}

      {latest && (
        <section className="mt-[6px] bg-surface border border-solid border-line rounded-lg" aria-label="Script">
          {/* ---- the document's head: one row — what it is, how long it runs, hear it */}
          <header className="p-[10px_18px] [border-bottom:1px_solid_var(--line)]">
            <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
              <div className="min-w-0 mr-auto flex flex-wrap items-baseline gap-x-[10px]">
                <h2 className="m-0 text-[15px] tracking-[-0.01em]">Script</h2>
                <p className="m-0 text-[12px] text-muted flex flex-wrap items-center gap-x-[6px]">
                  <span className={accepted ? 'text-ok' : 'text-warn'}>{accepted ? `Approved v${latest.version}` : 'Draft'}</span>
                  <span className="text-faint">·</span>
                  {/^https?:\/\//.test(brief['Script source'] ?? '')
                    ? <a className="text-muted hover:text-ink underline decoration-dotted underline-offset-2" href={brief['Script source']} target="_blank" rel="noreferrer">{imported ? 'script pack' : 'source'}</a>
                    : <span>{imported ? 'script pack' : 'from the plan'}</span>}
                  {!published && timing.pace === 'own' && <>
                    <span className="text-faint">·</span>
                    <span title={timing.measured ? `Measured from ${timing.takes} of your takes` : 'A typical pace until you record a few lines'}>{timing.wpm} wpm{timing.measured ? '' : ' typical'}</span>
                  </>}
                </p>
              </div>

              {published ? (
                <div className="text-right">
                  <div className="text-[17px] font-[600] leading-none text-ink [font-variant-numeric:tabular-nums]">{fileSeconds ? clock(fileSeconds) : recordedLength ?? '—'}</div>
                  <div className="text-[11px] text-muted mt-[3px]">{recordedLength || fileSeconds ? 'as published' : 'no length on record'}</div>
                </div>
              ) : (
                <div className="w-[180px]" title={`${totalWords} words · ${lines.length} lines`}>
                  <div className="flex items-baseline gap-[8px] [font-variant-numeric:tabular-nums]">
                    <span className={`text-[17px] font-[600] leading-none ${tone}`}>{clock(total)}</span>
                    <span className="text-[12px] text-muted">of {clock(target)}</span>
                    {target > 0 && <span className={`ml-auto text-[11.5px] font-semibold ${tone}`}>{within ? 'On length' : signed(delta)}</span>}
                  </div>
                  <div className="relative h-[3px] rounded-full bg-canvas mt-[5px]" aria-hidden="true">
                    <div className={`h-full rounded-full ${within ? 'bg-ok' : 'bg-warn'}`} style={{ width: `${barPct}%` }} />
                    {target > 0 && <div className="absolute top-[-3px] w-[2px] h-[9px] bg-ink rounded-full" style={{ left: `calc(${targetPct}% - 1px)` }} />}
                  </div>
                </div>
              )}

              {editable && !published && (
                <span className="flex items-center gap-[10px] text-[12px]">
                  {issues.length > 0 ? (
                    <button className="ghostbtn p-0 text-[12px] text-ink-2" onClick={() => setShowChecks((v) => !v)} aria-expanded={showChecks}>
                      <AlertTriangle size={12} className="text-warn" /> {issues.length} to look at
                      <ChevronDown size={12} className={'text-muted ' + (showChecks ? 'rotate-180' : '')} />
                    </button>
                  ) : checks && <span className="text-ok inline-flex items-center gap-[4px]" title="Passes the checks"><Check size={12} /> Checks pass</span>}
                  {fixable > 0 && <button className="text-[12px] p-[3px_9px]" onClick={() => fixChecks()}>Fix {fixable}</button>}
                  <EnhanceButton busy={enhRunning} busyLabel={enh?.total ? `Section ${Math.max(1, enh.section)} of ${enh.total}…` : 'Enhancing…'} onPick={runEnhance} options={[
                    { id: 'fit', label: 'Fit to time', disabled: !target,
                      detail: `Bring it to ${clock(target)} — about ${checks?.targetWords ?? '…'} words — section by section, from the brief. No new facts.` },
                    { id: 'tighten', label: 'Tighten', detail: 'Cut filler and repetition. Every fact and the call to action stay.' },
                    { id: 'polish', label: 'Polish for speech', detail: 'Same length and facts, smoother to say aloud.' },
                  ]} />
                </span>
              )}

              {fullRead?.state === 'running' ? (
                <span className="text-[12px] text-ink-2 flex items-center gap-[6px]">
                  <RefreshCw size={12} className="animate-spin" /> Full read — line {Math.min(fullRead.done + 1, fullRead.total)} of {fullRead.total}
                </span>
              ) : (
                <button className="text-[12.5px] p-[5px_11px]" onClick={hearAll} disabled={!lines.length}
                  title="Every line in order, in your voice at this speed — free">
                  <Headphones size={13} /> {fullRead?.state === 'done' ? 'Rebuild full read' : 'Hear it all'}
                </button>
              )}
            </div>

            {!published && (timing.pace === 'own' ? null : (
              <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[4px] mt-[6px] text-[12px] text-muted">
                <span>Voice <b className="font-[560] text-ink-2">{timing.voice?.name ?? 'planning pace'}</b> · {timing.naturalWpm} wpm{timing.measured ? '' : ' (estimate)'}</span>
                <span className="flex items-center gap-[4px]">
                  Speed
                  <button className="ghostbtn p-[3px]" aria-label="Slower" onClick={() => setSpeed(timing.speed - 0.05)}><Minus size={12} /></button>
                  <input type="range" min={timing.speedRange[0]} max={timing.speedRange[1]} step="0.01" value={timing.speed}
                    aria-label="Narration speed" className="w-[110px] accent-[var(--ink)]"
                    onChange={(e) => setTiming((t) => ({ ...t, speed: Number(e.target.value), wpm: Math.round(t.naturalWpm * Number(e.target.value)) }))}
                    onMouseUp={(e) => setSpeed(Number(e.target.value))} onKeyUp={(e) => setSpeed(Number(e.target.value))} />
                  <button className="ghostbtn p-[3px]" aria-label="Faster" onClick={() => setSpeed(timing.speed + 0.05)}><Plus size={12} /></button>
                  <code className="text-[11.5px] text-ink-2">{timing.speed.toFixed(2)}×</code>
                </span>
                {target > 0 && !within && (
                  <span className="text-ink-2">
                    {fitSpeed >= NATURAL_SPEED[0] && fitSpeed <= NATURAL_SPEED[1] ? (
                      <>At {fitSpeed.toFixed(2)}× it lands on {clock(target)}. <button className="ghostbtn p-0 text-accent text-[12px]" onClick={() => setSpeed(fitSpeed)}>Use {fitSpeed.toFixed(2)}×</button></>
                    ) : delta < 0 ? (
                      <>Short by about <b className="font-[560]">{Math.round((target - total) / 60 * wpm)} words</b> at a natural pace.{fitLink}</>
                    ) : (
                      <>Long by about <b className="font-[560]">{Math.round((total - target) / 60 * wpm)} words</b> at a natural pace.{fitLink}</>
                    )}
                  </span>
                )}
              </div>
            ))}

            {fullRead?.state === 'done' && fullRead.url && (
              <div className="flex items-center gap-[10px] mt-[10px]">
                <audio key={fullRead.url} className="flex-1 h-[30px]" src={fullRead.url} controls />
                <span className="text-[11.5px] text-muted whitespace-nowrap [font-variant-numeric:tabular-nums]">
                  {fullRead.duration != null && <>runs {clock(fullRead.duration)}</>}
                  {fullRead.skipped > 0 && <span className="text-warn"> · {fullRead.skipped} skipped (open checks)</span>}
                </span>
              </div>
            )}
            {fullRead?.state === 'failed' && <p className="m-[8px_0_0] text-[12px] text-danger">{fullRead.error}</p>}
            {openChecks > 0 && (
              <p className="m-[10px_0_0] text-[12px] text-warn">
                {openChecks} check{openChecks === 1 ? '' : 's'} still open. <button className="ghostbtn p-0 text-warn text-[12px] underline" onClick={nextCheck}>Go to the next one</button>
              </p>
            )}
            {editable && !published && (
              <div>
                {showChecks && issues.length > 0 && (
                  <ul className="m-[8px_0_0] p-[8px_0_0] [border-top:1px_solid_var(--line)] list-none flex flex-col gap-[5px]">
                    {issues.map((i) => (
                      <li key={i.id} className="flex items-start gap-[8px] text-[12px] text-ink-2">
                        <span className={'mt-[6px] w-[6px] h-[6px] rounded-full flex-none ' + (i.fix ? 'bg-accent' : 'bg-warn')} aria-hidden="true" />
                        <span className="flex-1">{i.message}</span>
                        {i.lineId && <button className="ghostbtn p-0 text-[12px] text-accent" onClick={() => goLine(i.lineId)}>Show</button>}
                        {i.fix && <button className="ghostbtn p-0 text-[12px] text-accent" onClick={() => fixChecks([i.id])}>Fix</button>}
                      </li>
                    ))}
                  </ul>
                )}
                {enh?.state === 'failed' && <p className="m-[8px_0_0] text-[12px] text-danger">{enh.error}</p>}
              </div>
            )}
            {enhDone && (
              <div className="mt-[12px] rounded-md border border-solid border-accent-line bg-accent-soft p-[9px_12px] text-[12.5px] text-ink-2">
                <div className="flex flex-wrap items-center gap-[6px_14px]">
                  <span>
                    <Sparkles size={12} className="inline text-accent align-[-1px]" /> <b className="font-[560] text-ink">Enhanced draft v{enh.result.version}</b>
                    {' '}from v{enh.result.from} · {enh.result.before} → {enh.result.words} words{enh.result.target ? ` (target ${enh.result.target})` : ''} · {modelLabel(enh.model)} · free
                  </span>
                  <span className="ml-auto flex gap-[14px]">
                    <button className="ghostbtn p-0 text-[12px] text-accent" onClick={toggleCompare}>{compare ? 'Hide comparison' : `Compare with v${enh.result.from}`}</button>
                    <button className="ghostbtn p-0 text-[12px] text-accent" onClick={undoEnhance}>Undo</button>
                  </span>
                </div>
                {enh.result.flags.map((f) => <p key={f} className="m-[5px_0_0] text-[12px] text-warn flex items-center gap-[5px]"><AlertTriangle size={11} /> {f}</p>)}
                {compare && (
                  <div className="grid grid-cols-2 gap-[18px] mt-[10px] pt-[10px] [border-top:1px_solid_var(--accent-line)] lte800:grid-cols-1">
                    <div>
                      <b className="text-[10.5px] uppercase tracking-[.06em] text-muted font-semibold">v{compare.version} · before</b>
                      {compare.lines.map((x) => <p key={x.id} className="m-[5px_0] text-[12.5px] leading-[1.55] text-muted">{x.text}</p>)}
                    </div>
                    <div>
                      <b className="text-[10.5px] uppercase tracking-[.06em] text-accent font-semibold">v{enh.result.version} · enhanced</b>
                      {latest.segments.map((x) => <p key={x.id} className="m-[5px_0] text-[12.5px] leading-[1.55] text-ink">{x.text}</p>)}
                    </div>
                  </div>
                )}
              </div>
            )}
            {accepted && hint && (
              <p className="m-[12px_0_0] text-[12px] text-muted flex items-center gap-[6px]">
                <MousePointerClick size={13} className="text-accent" />
                Play a line, then click any word that sounds off to fix it.
                <button className="ghostbtn p-[0_4px] text-[12px] text-faint hover:text-ink" onClick={dismissHint}>Got it</button>
              </p>
            )}
          </header>

          {/* ---- the lines, by outline section */}
          <div className="p-[0_18px_4px]">
            {grouped.map((g, gi) => {
              const written = secsAt(g.lines.reduce((n, l) => n + l.words, 0));
              const off = g.seconds && (written < g.seconds * 0.7 || written > g.seconds * 1.3);
              return (
                // The section sits in the margin beside its lines, as in a printed script.
                <div key={gi} className={'grid grid-cols-[124px_minmax(0,1fr)] gap-x-[16px] p-[8px_0] lte800:grid-cols-[1fr] ' + (gi ? '[border-top:1px_solid_var(--line)]' : '')}>
                  <div className="pt-[7px]">
                    {g.title && <b className="block text-[10.5px] tracking-[.08em] uppercase text-ink-2 font-semibold leading-[1.4]">{g.title}</b>}
                    {g.title && !published && (
                      <span className={`block mt-[3px] text-[11.5px] [font-variant-numeric:tabular-nums] ${off ? 'text-warn' : 'text-faint'}`}
                        title={`Written ${clock(written)}, planned ${clock(g.seconds)}`}>
                        {clock(written)} of {clock(g.seconds)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                  {g.lines.length === 0 && <p className="text-faint text-[12px] m-[8px_0_4px] italic">Nothing written for this section yet.</p>}
                  {g.lines.map((l) => {
                    if (editable) return (
                      <div key={l.id} className={'grid gap-[10px] p-[5px_0] items-start ' + (oneSpeaker ? 'grid-cols-[30px_minmax(0,1fr)_auto]' : 'grid-cols-[30px_84px_minmax(0,1fr)_auto]')}>
                        <button type="button" onClick={() => playDraft(l)} disabled={l.checks > 0}
                          title={l.checks ? 'Resolve the check first' : 'Hear it in your voice — free'}
                          aria-label="Hear this line"
                          className={'w-[28px] h-[28px] mt-[2px] p-0 rounded-full grid place-items-center border border-solid '
                            + (listening?.id === l.id && listening.url ? 'bg-ink border-ink text-white' : 'bg-surface border-line text-ink hover:border-ink')}>
                          {listening?.id === l.id && listening.busy ? <RefreshCw size={12} className="animate-spin" />
                            : listening?.id === l.id ? <Pause size={12} /> : <Play size={12} className="ml-[1px]" />}
                        </button>
                        {!oneSpeaker && (
                          <select className="text-[12px] p-[6px_6px] mt-[3px]" value={SPEAKERS.some(([v]) => v === l.speaker) ? l.speaker : ''}
                            aria-label="Speaker" onChange={(e) => e.target.value && saveLine(l, { speaker: e.target.value })}>
                            {!SPEAKERS.some(([v]) => v === l.speaker) && <option value="">{l.speaker}</option>}
                            {SPEAKERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                          </select>
                        )}
                        <div className="min-w-0">
                          <textarea key={latest.segments.find((x) => x.id === l.id)?.text} ref={(el) => { lineRefs.current[l.id] = el; }}
                            className={'w-full min-h-0 resize-y text-[14px] leading-[1.55] p-[4px_8px] bg-transparent border-transparent hover:bg-surface-2 focus:bg-surface focus:border-line' + (l.checks ? ' !border-warn-line' : '')}
                            defaultValue={l.text} aria-label="Script line" rows={Math.max(1, Math.ceil(l.text.length / 150))}
                            onChange={(e) => setDrafts((d) => ({ ...d, [l.id]: e.target.value }))}
                            onBlur={(e) => e.target.value !== latest.segments.find((x) => x.id === l.id)?.text && saveLine(l, { text: e.target.value })} />
                          {l.checks > 0 && (
                            <div className="flex flex-wrap gap-[5px] mt-[4px]">
                              {(l.text.match(CONFIRM_RE) ?? []).map((m, i) => (
                                <span key={i} className="text-[11px] text-warn bg-warn-soft border border-solid border-warn-line rounded-[3px] p-[1px_6px]">
                                  Check: {m.slice(10, -1).trim()}
                                </span>
                              ))}
                            </div>
                          )}
                          {lineIssues(l.id).length > 0 && (
                            <div className="flex flex-wrap gap-[5px] mt-[4px]">
                              {lineIssues(l.id).map((i) => (
                                <span key={i.id} className="text-[11px] text-ink-2 bg-surface-2 border border-solid border-line rounded-[3px] p-[1px_6px]">
                                  {i.message}{i.fix && <button className="ghostbtn p-0 ml-[6px] text-[11px] text-accent" onClick={() => fixChecks([i.id])}>Fix</button>}
                                </span>
                              ))}
                            </div>
                          )}
                          {suggest?.lineId === l.id && suggest.busy && <p className="m-[3px_0_0] text-[11.5px] text-muted">Rewording on this Mac…</p>}
                          {suggest?.lineId === l.id && suggest.text && (
                            <Suggestion text={suggest.text} flags={suggest.flags}
                              meta={`${suggest.before} → ${suggest.words} words · ${modelLabel(suggest.model)}`}
                              onDismiss={() => setSuggest(null)}
                              onUse={() => { saveLine(l, { text: suggest.text }); setSuggest(null); }} />
                          )}
                          {listening?.id === l.id && listening.busy && (
                            <p className="m-[3px_0_0] text-[11.5px] text-muted">Making it in your voice — about 30 seconds for a new line, instant after.</p>
                          )}
                        </div>
                        <span className="pt-[6px] flex items-start gap-[8px]">
                          {!published && (
                            <EnhanceButton compact label="Improve this line" busy={suggest?.lineId === l.id && suggest.busy}
                              onPick={(goal) => improve(l, goal)} options={[
                                { id: 'speak', label: 'Say it more naturally', detail: 'Same meaning and length, easier to say.' },
                                { id: 'shorter', label: 'Shorter', detail: 'About a third fewer words.' },
                                { id: 'longer', label: 'Longer', detail: 'Explains what it already says, from the brief.' },
                              ]} />
                          )}
                          <span className="pt-[3px] text-[11.5px] text-muted [font-variant-numeric:tabular-nums] whitespace-nowrap">{clock(secsAt(l.words))}</span>
                        </span>
                      </div>
                    );
                    const i = latest.segments.findIndex((x) => x.id === l.id);
                    const seg = segs[i];
                    const own = seg?.take?.local && !seg.take.stale && seg.textMatchesTake ? seg : null;
                    return (
                      <LineVoice key={l.id} text={l.text}
                        audio={own ? { url: own.take.audioUrl, takeId: own.take.id, duration: own.take.duration } : null}
                        getAudio={own || l.checks ? null : () => hearLine(l)}
                        segmentId={own?.id ?? null} take={own?.take}
                        onChange={(line) => {
                          setSegs((all) => all.map((x) => (x.id === line?.id ? line : x)));
                          if (line && line.text !== l.text) load().catch(() => {});
                        }}
                        aside={<>
                          {!oneSpeaker && <b className="font-[560] text-muted">{l.speaker === 'Pat' ? 'PJB' : l.speaker}</b>}
                          <span>{published ? `${l.words} words` : clock(own?.take?.duration ?? secsAt(l.words))}</span>
                        </>} />
                    );
                  })}
                  </div>
                </div>
              );
            })}
          </div>

          <footer className="flex flex-wrap items-center gap-[10px] p-[10px_22px] [border-top:1px_solid_var(--line)] bg-surface-2 rounded-b-lg">
            <button className="ghostbtn text-[12px] text-muted p-[3px_0]" onClick={() => setShowVersions((v) => !v)}>
              <ChevronDown size={13} className={showVersions ? 'rotate-180' : ''} /> {state.versions.length} version{state.versions.length === 1 ? '' : 's'}
            </button>
            {showVersions && state.versions.map((v) => (
              <span key={v.id} className={'vchip ' + v.status + (v.stale ? ' stale' : '')}>
                v{v.version} · {v.status}{v.stale ? ' · stale' : ''} · {generatorLabel(v)}
              </span>
            ))}
            {latest && ready && (
              <button className="ghostbtn text-[12px] text-muted p-[3px_0]" title="Writes a new draft from the plan; this one is kept as a version"
                onClick={() => window.confirm('Write a new draft from the plan? This script is kept as a version, but the new draft becomes the one you edit.')
                  && mutate(() => api.generateScript(production.id), apply).catch(() => {})}>
                <Sparkles size={12} /> New draft from plan
              </button>
            )}
            <span className="ml-auto" />
            {editable ? (
              <>
                <button onClick={() => mutate(() => api.rejectScript(production.id, latest.id), apply)}><X size={15} /> Reject</button>
                <button className="primary" onClick={accept}><Check size={15} /> Approve script</button>
              </>
            ) : (
              <span className="statusnote text-[12.5px]"><Check size={14} /> Approved</span>
            )}
          </footer>
        </section>
      )}
    </div>
  );
}
