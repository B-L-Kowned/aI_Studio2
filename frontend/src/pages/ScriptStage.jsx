import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Sparkles, Check, X, Lock, AlertCircle, FileText, Play, Minus, Plus, ChevronDown, Headphones } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import MadeByChooser from '../components/MadeByChooser.jsx';
import PlanStage from './PlanStage.jsx';
import { madeByOf } from '../utils/made-by.js';

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

/** Text with each [CONFIRM: …] marked, for reading (accepted scripts). */
function Marked({ text }) {
  const parts = String(text).split(/(\[CONFIRM:[^\]]*\])/g);
  return parts.map((p, i) => (/^\[CONFIRM:/.test(p)
    ? <mark key={i} className="bg-warn-soft text-warn rounded-[3px] px-[3px]">{p}</mark>
    : <React.Fragment key={i}>{p}</React.Fragment>));
}

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
  const [details, setDetails] = useState(false);      // Plan details drawer
  const lineRefs = useRef({});

  const load = useCallback(async () => {
    const [script, flow, t] = await Promise.all([
      api.script(production.id), api.workflow(production.id), api.scriptTiming(production.id),
    ]);
    setState(script); setWorkflow(flow); setTiming(t); setLoadError(null); setDrafts({});
  }, [production.id]);
  useEffect(() => { load().catch(setLoadError); }, [load]);

  const latest = state?.latest;

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
  const listen = async (l) => {
    setListening({ id: l.id, busy: true });
    try {
      const r = await mutate(() => api.listenLine(production.id, latest.id, l.id), null, { silent: true });
      setListening({ id: l.id, url: r.data.url });
    } catch { setListening(null); }
  };
  const hearAll = async () => {
    try {
      const r = await mutate(() => api.listenAll(production.id, latest.id), null, { silent: true });
      setFullRead(r.data);
    } catch { /* mutate reports it */ }
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

  const tone = !target ? 'text-muted' : within ? 'text-ok' : 'text-warn';
  // One voice throughout: naming the speaker on every line says nothing.
  const oneSpeaker = new Set(lines.map((l) => l.speaker)).size <= 1;
  const barPct = target ? Math.min(100, (total / Math.max(total, target)) * 100) : 0;
  const targetPct = target ? Math.min(100, (target / Math.max(total, target)) * 100) : 0;

  return (
    <div className="stagepane">
      {/* The few facts that matter while reading, then how it is made. */}
      <div className="flex flex-wrap items-baseline gap-x-[14px] gap-y-[4px] text-[12.5px] text-muted mb-[12px]">
        {brief['Register ID'] && <code className="text-[11.5px] font-semibold text-ink-2">{brief['Register ID']}</code>}
        {brief.Priority && <span className={brief.Priority === 'P1' ? 'text-danger font-semibold' : ''}>{brief.Priority}</span>}
        {brief.Format && <span>{brief.Format}</span>}
        {brief.Audience && <span className="truncate max-w-[420px]" title={brief.Audience}>For: {brief.Audience}</span>}
        <button className="ghostbtn text-[12.5px] text-accent p-0 ml-auto" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
          <ChevronDown size={13} className={details ? 'rotate-180' : ''} /> Plan details
        </button>
      </div>
      {brief['Verify first'] && (
        <div className="notice warn items-start"><AlertCircle /> <span><b>Verify before recording.</b> {brief['Verify first']}</span></div>
      )}
      {details && <div className="mb-[16px]"><PlanStage goToStage={goToStage} /></div>}
      <MadeByChooser />

      <div className="sectiontitle mt-[18px]">
        <div>
          <h2>Script</h2>
          <p>
            {imported ? 'Imported from your script pack' : 'Written from the plan'}
            {/^https?:\/\//.test(brief['Script source'] ?? '') && <> · <a className="text-accent underline" href={brief['Script source']} target="_blank" rel="noreferrer">source</a></>}
            {' · '}<span className={latest?.status === 'accepted' ? 'text-ok' : 'text-warn'}>
              {!latest ? 'no script yet' : latest.status === 'accepted' ? 'approved' : 'draft — approve when it reads right'}
            </span>
          </p>
        </div>
        {!latest && (
          <button className="primary" disabled={!ready} onClick={() => mutate(() => api.generateScript(production.id), apply)}>
            <Sparkles size={15} /> Generate script
          </button>
        )}
      </div>

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
        <>
          {/* ---- timing: what this will run, at the voice it will be read in */}
          <section className="border border-solid border-line rounded-lg bg-surface p-[14px_16px] mt-[12px]" aria-label="Timing">
            <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-[6px]">
              {published ? (
                <div>
                  <span className="text-[26px] font-[620] [font-variant-numeric:tabular-nums] text-ink">
                    {fileSeconds ? clock(fileSeconds) : recordedLength ?? '—'}
                  </span>
                  <span className="text-muted text-[13px]">
                    {recordedLength || fileSeconds ? ' as published' : ' — the finished video has no length on record'}
                  </span>
                  {target > 0 && <span className="text-faint text-[12px] ml-[8px]">planned {clock(target)}</span>}
                </div>
              ) : (
              <div>
                <span className={`text-[26px] font-[620] [font-variant-numeric:tabular-nums] ${tone}`}>{clock(total)}</span>
                <span className="text-muted text-[13px]"> of {clock(target)} target</span>
                {target > 0 && <span className={`ml-[8px] text-[12px] font-semibold ${tone}`}>{within ? 'fits' : signed(delta)}</span>}
              </div>
              )}
              <span className="text-muted text-[12px]">
                {totalWords} words · {lines.length} lines
                {openChecks > 0 && <> · <button className="ghostbtn p-0 text-warn text-[12px] underline" onClick={nextCheck}>{openChecks} check{openChecks === 1 ? '' : 's'} open — next</button></>}
              </span>
            </div>

            {!published && <>
            <div className="relative h-[6px] rounded-full bg-canvas mt-[10px] overflow-visible" aria-hidden="true">
              <div className={`h-full rounded-full ${within ? 'bg-ok' : 'bg-warn'}`} style={{ width: `${barPct}%` }} />
              {target > 0 && <div className="absolute top-[-4px] w-[2px] h-[14px] bg-ink" style={{ left: `calc(${targetPct}% - 1px)` }} title={`Target ${clock(target)}`} />}
            </div>

            {timing.pace === 'own' ? (
              <p className="m-[12px_0_0] text-[12.5px] text-ink-2">
                Your pace: <b className="font-[560]">{timing.wpm} words a minute</b>
                <span className="text-muted">{timing.measured ? ` — measured from ${timing.takes} of your takes` : ' — a typical pace until you record a few lines'}</span>
              </p>
            ) : (
            <div className="flex flex-wrap items-center gap-[10px] mt-[12px] text-[12.5px]">
              <span className="text-ink-2">
                Voice: <b className="font-[560]">{timing.voice?.name ?? 'planning pace'}</b>
                {' · '}natural {timing.naturalWpm} wpm{timing.measured ? ' (measured)' : ' (estimate)'}
              </span>
              <span className="flex items-center gap-[4px] ml-auto">
                Speed
                <button className="ghostbtn p-[4px]" aria-label="Slower" onClick={() => setSpeed(timing.speed - 0.05)}><Minus size={13} /></button>
                <input type="range" min={timing.speedRange[0]} max={timing.speedRange[1]} step="0.01" value={timing.speed}
                  aria-label="Narration speed" className="w-[120px]"
                  onChange={(e) => setTiming((t) => ({ ...t, speed: Number(e.target.value), wpm: Math.round(t.naturalWpm * Number(e.target.value)) }))}
                  onMouseUp={(e) => setSpeed(Number(e.target.value))} onKeyUp={(e) => setSpeed(Number(e.target.value))} />
                <button className="ghostbtn p-[4px]" aria-label="Faster" onClick={() => setSpeed(timing.speed + 0.05)}><Plus size={13} /></button>
                <code className="text-[12px] w-[44px] text-right">{timing.speed.toFixed(2)}×</code>
                <span className="text-muted">{timing.wpm} wpm</span>
              </span>
            </div>
            )}
            </>}

            <div className="flex flex-wrap items-center gap-[10px] mt-[12px] pt-[12px] [border-top:1px_solid_var(--line)] text-[12.5px]">
              {fullRead?.state === 'running' ? (
                <span className="text-ink-2">
                  <Headphones size={13} className="inline mr-[4px] align-[-2px]" />
                  Preparing the full read — line {Math.min(fullRead.done + 1, fullRead.total)} of {fullRead.total}…
                  <span className="text-muted"> (your voice is made on this Mac at about 2× real time)</span>
                </span>
              ) : (
                <button className="text-[12.5px] p-[5px_11px]" onClick={hearAll} disabled={!lines.length}
                  title="Every line in order, in your voice at this speed — free">
                  <Headphones size={13} /> {fullRead?.state === 'done' ? 'Rebuild the full read' : 'Hear the whole script'}
                </button>
              )}
              {fullRead?.state === 'done' && fullRead.duration != null && (
                <span className="text-ink-2">
                  Runs <b className="font-[560] [font-variant-numeric:tabular-nums]">{clock(fullRead.duration)}</b> spoken
                  {target > 0 && <span className="text-muted"> · target {clock(target)}</span>}
                  {fullRead.skipped > 0 && <span className="text-warn"> · {fullRead.skipped} line{fullRead.skipped === 1 ? '' : 's'} with open checks left out</span>}
                </span>
              )}
              {fullRead?.state === 'failed' && <span className="text-danger">{fullRead.error}</span>}
            </div>
            {fullRead?.state === 'done' && fullRead.url && (
              <audio key={fullRead.url} className="w-full h-[34px] mt-[8px]" src={fullRead.url} controls />
            )}

            {target > 0 && !within && !published && timing.pace === 'own' && (
              <p className="m-[10px_0_0] text-[12.5px] text-ink-2">
                At your pace this runs {clock(total)} — about <b>{Math.abs(Math.round(delta / 60 * wpm))} words {delta > 0 ? 'over' : 'under'}</b> the {clock(target)} target.
              </p>
            )}
            {target > 0 && !within && !published && timing.pace !== 'own' && (
              <p className="m-[10px_0_0] text-[12.5px] text-ink-2">
                {fitSpeed >= NATURAL_SPEED[0] && fitSpeed <= NATURAL_SPEED[1] ? (
                  <>At {fitSpeed.toFixed(2)}× it lands on {clock(target)} and still sounds natural.{' '}
                    <button className="text-[12px] p-[3px_9px]" onClick={() => setSpeed(fitSpeed)}>Use {fitSpeed.toFixed(2)}×</button></>
                ) : delta < 0 ? (
                  <>Too short for a natural pace: about <b>{Math.round((target - total) / 60 * wpm)} more words</b> are needed
                    {' '}(slowing the voice past {NATURAL_SPEED[0]}× starts to sound dragged).</>
                ) : (
                  <>Too long for a natural pace: cut about <b>{Math.round((total - target) / 60 * wpm)} words</b>
                    {' '}(speeding past {NATURAL_SPEED[1]}× starts to sound rushed).</>
                )}
              </p>
            )}
          </section>

          {/* ---- the lines, by outline section */}
          <div className="mt-[14px]">
            {grouped.map((g, gi) => {
              const written = secsAt(g.lines.reduce((n, l) => n + l.words, 0));
              const off = g.seconds && (written < g.seconds * 0.7 || written > g.seconds * 1.3);
              return (
                <section key={gi} className="mb-[14px]">
                  {g.title && (
                    <header className="flex items-baseline gap-[10px] pb-[6px] mb-[6px] [border-bottom:1px_solid_var(--line)]">
                      <b className="text-[11px] tracking-[.06em] uppercase text-ink-2">{g.title}</b>
                      {/* Estimates mean nothing beside a finished video's real length. */}
                      {!published && (
                        <span className={`text-[11.5px] [font-variant-numeric:tabular-nums] ${off ? 'text-warn' : 'text-muted'}`}>
                          {clock(written)} of {clock(g.seconds)}
                        </span>
                      )}
                      {gi === 0 && !latest.segments.some((s) => s.sceneRef) && (
                        <span className="text-faint text-[11px] ml-auto" title="Imported lines carry no section; they are placed by where they fall in the running time.">≈ placed by timing</span>
                      )}
                    </header>
                  )}
                  {g.lines.length === 0 && <p className="text-faint text-[12px] m-[4px_0_8px]">Nothing written for this section yet.</p>}
                  {g.lines.map((l) => (
                    <div key={l.id} className={'grid gap-[10px] p-[4px_0] items-start lte800:grid-cols-[1fr] ' + (oneSpeaker && !editable ? 'grid-cols-[1fr_92px]' : 'grid-cols-[84px_1fr_92px]')}>
                      {oneSpeaker && !editable ? null : editable ? (
                        <select className="text-[12px] p-[6px_6px]" value={SPEAKERS.some(([v]) => v === l.speaker) ? l.speaker : ''}
                          aria-label="Speaker" onChange={(e) => e.target.value && saveLine(l, { speaker: e.target.value })}>
                          {!SPEAKERS.some(([v]) => v === l.speaker) && <option value="">{l.speaker}</option>}
                          {SPEAKERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        </select>
                      ) : (
                        <b className="text-[12px] text-muted text-right font-[560] pt-[2px] lte800:text-left">{l.speaker === 'Pat' ? 'PJB' : l.speaker}</b>
                      )}
                      <div className="min-w-0">
                        {editable ? (
                          <textarea ref={(el) => { lineRefs.current[l.id] = el; }}
                            className={'w-full min-h-[54px] resize-y text-[13.5px] leading-[1.55]' + (l.checks ? ' border-warn-line' : '')}
                            defaultValue={l.text} aria-label="Script line" rows={2}
                            onChange={(e) => setDrafts((d) => ({ ...d, [l.id]: e.target.value }))}
                            onBlur={(e) => e.target.value !== latest.segments.find((x) => x.id === l.id)?.text && saveLine(l, { text: e.target.value })} />
                        ) : (
                          <p className="m-0 leading-[1.6] text-[13.5px] text-ink"><Marked text={l.text} /></p>
                        )}
                        {l.checks > 0 && (
                          <div className="flex flex-wrap gap-[5px] mt-[4px]">
                            {(l.text.match(CONFIRM_RE) ?? []).map((m, i) => (
                              <span key={i} className="text-[11px] text-warn bg-warn-soft border border-solid border-warn-line rounded-[3px] p-[1px_6px]">
                                Check: {m.slice(10, -1).trim()}
                              </span>
                            ))}
                          </div>
                        )}
                        {listening?.id === l.id && listening.url && <audio className="w-full h-[30px] mt-[4px]" src={listening.url} controls autoPlay />}
                      </div>
                      <div className="flex flex-col items-end gap-[3px] text-[11px] text-muted [font-variant-numeric:tabular-nums] lte800:flex-row lte800:justify-start">
                        <span>{published ? `${l.words} words` : `${clock(secsAt(l.words))} · ${l.words}w`}</span>
                        <button className="ghostbtn text-[11px] p-[2px_6px]" disabled={l.checks > 0 || listening?.busy}
                          title={l.checks ? 'Resolve the check first' : 'Hear it in your voice — free'} onClick={() => listen(l)}>
                          <Play size={11} /> {listening?.id === l.id && listening.busy ? '…' : 'Hear'}
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-[10px] mt-[6px]">
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
              <span className="statusnote"><Check size={15} /> v{latest.version} {latest.status}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
