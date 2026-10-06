import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Sparkles, Check, X, Lock, AlertCircle, FileText, Play, Minus, Plus, ChevronDown } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';

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
  const lineRefs = useRef({});

  const load = useCallback(async () => {
    const [script, flow, t] = await Promise.all([
      api.script(production.id), api.workflow(production.id), api.scriptTiming(production.id),
    ]);
    setState(script); setWorkflow(flow); setTiming(t); setLoadError(null); setDrafts({});
  }, [production.id]);
  useEffect(() => { load().catch(setLoadError); }, [load]);

  const latest = state?.latest;
  const brief = useMemo(() => Object.fromEntries(production.brief.map((b) => [b.label, b.value])), [production.brief]);

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
  const ready = production.outlineApproved && production.scenesApproved && researchGate?.status !== 'block';
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
    goToStage?.('Segments');
  };

  const tone = !target ? 'text-muted' : within ? 'text-ok' : 'text-warn';
  const barPct = target ? Math.min(100, (total / Math.max(total, target)) * 100) : 0;
  const targetPct = target ? Math.min(100, (target / Math.max(total, target)) * 100) : 0;

  return (
    <div className="stagepane">
      <div className="sectiontitle">
        <div>
          <h2>Script</h2>
          <p>
            {imported
              ? <>Imported{brief['Script source'] ? <> · <span className="text-ink-2">{brief['Script source']}</span></> : ''}{brief['Script status'] ? ` · ${brief['Script status']}` : ''}</>
              : 'Generated from the approved plan. Dialogue never precedes an approved outline and scenes.'}
          </p>
        </div>
        <button className={imported ? '' : 'primary'} disabled={!ready}
          title={imported ? 'Writes a new draft from the plan; this one is kept as a version' : undefined}
          onClick={() => mutate(() => api.generateScript(production.id), apply)}>
          <Sparkles size={15} /> {latest ? 'New draft from plan' : 'Generate script'}
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
              <div>
                <span className={`text-[26px] font-[620] [font-variant-numeric:tabular-nums] ${tone}`}>{clock(total)}</span>
                <span className="text-muted text-[13px]"> of {clock(target)} target</span>
                {target > 0 && <span className={`ml-[8px] text-[12px] font-semibold ${tone}`}>{within ? 'fits' : signed(delta)}</span>}
              </div>
              <span className="text-muted text-[12px]">
                {totalWords} words · {lines.length} lines
                {openChecks > 0 && <> · <button className="ghostbtn p-0 text-warn text-[12px] underline" onClick={nextCheck}>{openChecks} check{openChecks === 1 ? '' : 's'} open — next</button></>}
              </span>
            </div>

            <div className="relative h-[6px] rounded-full bg-canvas mt-[10px] overflow-visible" aria-hidden="true">
              <div className={`h-full rounded-full ${within ? 'bg-ok' : 'bg-warn'}`} style={{ width: `${barPct}%` }} />
              {target > 0 && <div className="absolute top-[-4px] w-[2px] h-[14px] bg-ink" style={{ left: `calc(${targetPct}% - 1px)` }} title={`Target ${clock(target)}`} />}
            </div>

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

            {target > 0 && !within && (
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
                      <span className={`text-[11.5px] [font-variant-numeric:tabular-nums] ${off ? 'text-warn' : 'text-muted'}`}>
                        {clock(written)} of {clock(g.seconds)}
                      </span>
                      {gi === 0 && !latest.segments.some((s) => s.sceneRef) && (
                        <span className="text-faint text-[11px] ml-auto" title="Imported lines carry no section; they are placed by where they fall in the running time.">≈ placed by timing</span>
                      )}
                    </header>
                  )}
                  {g.lines.length === 0 && <p className="text-faint text-[12px] m-[4px_0_8px]">Nothing written for this section yet.</p>}
                  {g.lines.map((l) => (
                    <div key={l.id} className="grid grid-cols-[84px_1fr_92px] gap-[10px] p-[4px_0] items-start lte800:grid-cols-[1fr]">
                      {editable ? (
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
                        <span>{clock(secsAt(l.words))} · {l.words}w</span>
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
            <span className="ml-auto" />
            {editable ? (
              <>
                <button onClick={() => mutate(() => api.rejectScript(production.id, latest.id), apply)}><X size={15} /> Reject</button>
                <button className="primary" onClick={accept}><Check size={15} /> Accept v{latest.version} → Segments</button>
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
