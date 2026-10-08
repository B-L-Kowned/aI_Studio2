import React, { useState, useEffect, useCallback } from 'react';
import { Check, SkipForward, ExternalLink, Pencil, RefreshCw, ClipboardList, AlertCircle, Undo2, ChevronLeft, Square, Headphones, RotateCcw, Sparkles } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { useDialog } from '../components/Dialog.jsx';
import { api } from '../services/api.js';
import LineVoice from '../components/LineVoice.jsx';
import { EnhanceButton, Suggestion, modelLabel } from '../components/Enhance.jsx';
import { PageHead } from '../components/Section.jsx';
import { madeByLabel } from '../utils/made-by.js';

const CONFIRM = /\[CONFIRM:\s*[^\]]*\]\s*/gi;
const strip = (t) => t.replace(CONFIRM, '').replace(/\s{2,}/g, ' ').trim();
const wordCount = (ls) => ls.reduce((n, l) => n + strip(l.text).split(/\s+/).filter(Boolean).length, 0);
const secsOf = (rt) => { const [m, s] = String(rt ?? '').split(':').map(Number); return (m || 0) * 60 + (s || 0); };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const CHIP = 'text-[12.5px] p-[6px_13px] rounded-full border border-solid cursor-pointer whitespace-nowrap';
const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
const HOST = (url) => { try { return new URL(/^https?:/.test(url) ? url : `https://${url}`).host.replace(/^www\./, ''); } catch { return url; } };

/** The facts to judge a script against, beside it. */
// A brief value that is still the template's instruction is not a fact.
const INSTRUCTION = /^(confirm|verify|one verified|one audience|match the|tbd|to be confirmed)\b/i;

function BriefPanel({ item, onFit, fitting }) {
  const words = wordCount(item.lines);
  const est = Math.round((words / 150) * 60);
  const target = secsOf(item.target);
  const off = target ? est / target : null;
  const fit = off == null ? null : off < 0.8 ? 'short' : off > 1.2 ? 'long' : 'fits';
  const fact = (label, value) => value && (
    <div><dt className="text-[10.5px] tracking-[.07em] uppercase text-faint font-semibold">{label}</dt>
      {INSTRUCTION.test(value.trim())
        ? <dd className="m-[2px_0_0] text-[12.5px] text-faint italic leading-[1.45]" title={value}>Not set yet — Fill the gaps in the video’s brief</dd>
        : <dd className="m-[2px_0_0] text-[13px] text-ink-2 leading-[1.45]">{value}</dd>}
    </div>
  );
  return (
    <aside className="flex flex-col gap-[12px] p-[14px_16px] rounded-lg bg-surface-2 self-start lte960:order-first">
      <dl className="m-0 flex flex-col gap-[10px]">
        {fact('For', item.brief?.audience)}
        {fact('Goal', item.brief?.goal)}
        {fact('Call to action', item.brief?.cta)}
        {fact('Made by', madeByLabel(item.madeBy))}
        <div>
          <dt className="text-[10.5px] tracking-[.07em] uppercase text-faint font-semibold">Length</dt>
          <dd className="m-[2px_0_0] text-[13px] text-ink-2">
            about {clock(est)} at a typical pace{target ? <> · target {item.target} · <b className={fit === 'fits' ? 'text-ok' : 'text-warn'}>{fit === 'fits' ? 'fits' : fit === 'long' ? 'runs long' : 'runs short'}</b></> : ''}
          </dd>
          {onFit && fit && fit !== 'fits' && (
            fitting ? (
              <p className="m-[6px_0_0] text-[12px] text-muted"><RefreshCw size={11} className="inline animate-spin -mt-[2px]" /> Fitting to time on this Mac{fitting.total ? ` — section ${Math.max(1, fitting.section)} of ${fitting.total}` : ''}…</p>
            ) : (
              <button className="text-[12px] p-[4px_10px] mt-[6px]" onClick={() => onFit(item)} title="Rewrite it to the target length, section by section, from the brief — a new draft, nothing approved">
                <Sparkles size={12} className="text-accent" /> Fit to time first
              </button>
            )
          )}
        </div>
      </dl>
      {item.brief?.website && (
        <a className="text-[12.5px] text-accent underline self-start" href={/^https?:/.test(item.brief.website) ? item.brief.website : `https://${item.brief.website}`} target="_blank" rel="noreferrer">
          <ExternalLink size={12} className="inline -mt-[2px]" /> Open {HOST(item.brief.website)}
        </a>
      )}
    </aside>
  );
}

/**
 * One video's voice, to hear and approve in one pass. Approve all opens once
 * every made line has been played — by Listen through or one at a time.
 */
function VoiceItem({ item, onApproveAll, onApproveLine, onRemake, onChanged, busy }) {
  const audio = React.useRef(null);
  const [playing, setPlaying] = useState(null);
  const [heard, setHeard] = useState(() => new Set());
  const [through, setThrough] = useState(false);
  useEffect(() => { setHeard(new Set()); setThrough(false); audio.current?.pause(); setPlaying(null); }, [item.productionId]);
  useEffect(() => () => audio.current?.pause(), []);
  const made = item.lines.filter((l) => l.audioUrl);
  const play = (l, onEnd) => {
    audio.current?.pause();
    const a = new Audio(l.audioUrl);
    audio.current = a;
    setPlaying(l.segmentId);
    a.onended = () => { setPlaying(null); setHeard((h) => new Set(h).add(l.segmentId)); onEnd?.(); };
    a.play().catch(() => setPlaying(null));
  };
  const listen = (i = 0) => {
    if (i >= made.length) { setThrough(false); return; }
    setThrough(true);
    play(made[i], () => listen(i + 1));
  };
  const stop = () => { audio.current?.pause(); setPlaying(null); setThrough(false); };
  const unapproved = made.filter((l) => !l.heard);
  const allHeard = unapproved.every((l) => heard.has(l.segmentId));
  const missing = item.lines.filter((l) => !l.audioUrl).length;
  useEffect(() => {
    const onKey = (e) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey) return;
      if (e.key.toLowerCase() === 'a' && allHeard && unapproved.length) { e.preventDefault(); onApproveAll(item, unapproved); }
      if (e.code === 'Space') { e.preventDefault(); through || playing ? stop() : listen(0); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="flex flex-col gap-[8px] min-w-0">
      <div className="flex flex-wrap items-center gap-[8px]">
        {through || playing
          ? <button onClick={stop}><Square size={13} /> Stop</button>
          : <button className={allHeard ? '' : 'primary'} onClick={() => listen(0)}><Headphones size={14} /> Listen through <kbd className="opacity-60 text-[10.5px]">Space</kbd></button>}
        <span className="text-[12.5px] text-muted">{heard.size} of {made.length} heard{missing ? ` · ${missing} not made yet` : ''}</span>
      </div>
      {/* Already inside the review card: rules between lines, not another box. */}
      <div className="[border-top:1px_solid_var(--line)]">
        {item.lines.map((l) => (
          <div key={l.segmentId} className="[border-bottom:1px_solid_var(--line)] last:[border-bottom:0]">
            <LineVoice text={l.text} current={playing === l.segmentId} dim={!l.audioUrl}
              audio={l.audioUrl ? { url: l.audioUrl, takeId: l.takeId, duration: l.duration } : null}
              segmentId={l.audioUrl ? l.segmentId : null}
              onPlayed={() => setHeard((h) => new Set(h).add(l.segmentId))}
              onChange={() => onChanged?.()}
              aside={<>
                {l.heard ? <span className="text-ok text-[12px]"><Check size={13} className="inline" /> Approved</span>
                  : l.audioUrl ? <button className="text-[12px] p-[3px_9px]" disabled={busy} onClick={() => onApproveLine(item, l)}><Check size={12} /> Approve</button>
                  : <span className="text-faint text-[12px]">Not made</span>}
                <button className="ghostbtn p-[4px] text-faint hover:text-ink" title="A whole new reading of this line" disabled={busy} onClick={() => onRemake(item, l)}><RotateCcw size={13} /></button>
              </>} />
          </div>
        ))}
      </div>
      {unapproved.length > 0 && (
        <button className="primary self-start" disabled={!allHeard || busy} title={allHeard ? '' : 'Listen to every line first'} onClick={() => onApproveAll(item, unapproved)}>
          <Check size={14} /> Approve all {unapproved.length} <kbd className="opacity-60 text-[10.5px]">A</kbd>
        </button>
      )}
    </div>
  );
}

/**
 * Reading work across the whole register, one video at a time: drafts that
 * only need your yes, and the [CONFIRM] checks that need you to look at the
 * real product. Keyboard: A approves, S skips, ← goes back.
 */
export default function Review({ go, tabs }) {
  const { openProduction, mutate } = useStudio();
  const dialog = useDialog();
  const [data, setData] = useState(null);
  // Home can send you straight to the checks.
  const [mode, setMode] = useState(() => { try { const m = sessionStorage.getItem('review-mode'); sessionStorage.removeItem('review-mode'); return m === 'checks' || m === 'voice' ? m : 'ready'; } catch { return 'ready'; } });
  const [sort, setSort] = useState('priority');
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState(null); // line id
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [approvedHere, setApprovedHere] = useState(0);
  const [undo, setUndo] = useState(null); // { productionId, versionId, videoId }

  const load = useCallback(() => api.review(sort).then(setData).catch(() => setData({ ready: [], checks: [], totals: {} })), [sort]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setAt(0); setEditing(null); }, [mode, sort]);

  const list = data ? (mode === 'ready' ? data.ready : mode === 'voice' ? data.voices : data.checks) : [];
  const item = list[Math.min(at, Math.max(0, list.length - 1))];

  // Fit a draft to time without leaving the queue: { productionId, section, total } while running.
  const [fitting, setFitting] = useState(null); // { productionId, section, total } while running
  const approve = useCallback(async () => {
    if (!item || busy || editing || fitting?.productionId === item?.productionId) return;
    setBusy(true);
    try {
      const r = await mutate(() => api.acceptScript(item.productionId, item.versionId), null, { silent: true });
      setUndo({ productionId: item.productionId, versionId: item.versionId, videoId: item.videoId, madeBy: item.madeBy, queued: r?.data?.voice === 'queued' || r?.data?.voice === 'already queued' });
      setApprovedHere((n) => n + 1);
      await load(); // the approved draft leaves the list; the next one moves up
    } catch { /* mutate reports it */ } finally { setBusy(false); }
  }, [item, busy, editing, fitting, mutate, load]);
  const skip = useCallback(() => setAt((i) => Math.min(i + 1, list.length - 1)), [list.length]);
  const takeBack = async () => {
    if (!undo) return;
    await mutate(() => api.reopenScript(undo.productionId, undo.versionId), null).catch(() => {});
    setUndo(null); setApprovedHere((n) => Math.max(0, n - 1));
    await load();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey) return;
      if (mode === 'ready' && e.key.toLowerCase() === 'a') { e.preventDefault(); approve(); }
      if (e.key.toLowerCase() === 's' || e.key === 'ArrowRight') { e.preventDefault(); skip(); }
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, approve, skip]);

  const fitItem = async (it) => {
    try {
      const r = await mutate(() => api.enhanceScript(it.productionId, 'fit'), null, { silent: true });
      setFitting({ productionId: it.productionId, ...r.data });
    } catch { /* reported */ }
  };
  useEffect(() => {
    if (!fitting) return undefined;
    const t = setInterval(async () => {
      const j = await api.enhanceState(fitting.productionId).catch(() => null);
      if (!j || j.state !== 'running') { setFitting(null); await load(); if (j?.state === 'failed') dialog.notice({ title: 'Could not fit it to time', body: j.error }); }
      else setFitting({ productionId: fitting.productionId, ...j });
    }, 2500);
    return () => clearInterval(t);
  }, [fitting, load]);

  // A suggested answer to one line's check, from the company's own material.
  const [answer, setAnswer] = useState(null); // { lineId, busy } | result
  const suggest = async (it, line) => {
    setAnswer({ lineId: line.id, busy: true });
    try {
      const r = await mutate(() => api.suggestAnswer(it.productionId, line.id), null, { silent: true });
      setAnswer(r.data);
    } catch { setAnswer(null); }
  };
  const saveLine = async (it, line, text) => {
    setBusy(true);
    try {
      await mutate(() => api.updateScriptSegment(it.productionId, it.versionId, line.id, { text }), null, { silent: true });
      setEditing(null);
      await load();
    } catch { /* mutate reports it */ } finally { setBusy(false); }
  };
  const toNote = async (it, line) => {
    setBusy(true);
    try { await mutate(() => api.checkToNote(it.productionId, line.id), null); await load(); } catch { /* reported */ } finally { setBusy(false); }
  };
  const confirmAll = async (it) => {
      if (!await dialog.confirm({ title: `Confirm all ${it.lines.length} lines as written?`, confirmLabel: 'Confirm all',
        body: `Every checked line in ${it.videoId} is kept as it is and its [CONFIRM] marker removed.` })) return;
    setBusy(true);
    try {
      for (const l of it.lines) await mutate(() => api.updateScriptSegment(it.productionId, it.versionId, l.id, { text: strip(l.text) }), null, { silent: true });
      await load();
    } catch { /* mutate reports it */ } finally { setBusy(false); }
  };
  const open = async (id) => { await openProduction(id); go('Create'); };

  if (!data) return <><PageHead title="Review" tabs={tabs} /><p className="muted">Loading…</p></>;
  const t = data.totals;
  const tab = (id, label, n) => (
    <button className={`${CHIP} ${mode === id ? 'bg-ink text-[#fff] border-ink' : 'bg-surface text-ink-2 border-line hover:border-line-2'}`} onClick={() => setMode(id)}>
      {label} <span className={mode === id ? 'opacity-70' : 'text-muted'}>{n}</span>
    </button>
  );

  return (
    <>
      <PageHead title="Review" tabs={tabs} lead="Reading work across the register, one video at a time." />

      <div className="flex flex-wrap items-center gap-[8px] mt-[4px]">
        {tab('ready', 'Ready to approve', t.ready)}
        {tab('checks', 'Checks to answer', `${t.checks} in ${t.videosWithChecks} videos`)}
        {tab('voice', 'Voices to approve', t.voices ?? 0)}
        {approvedHere > 0 && <span className="text-[12.5px] text-ok ml-[6px]"><Check size={13} className="inline -mt-[2px]" /> {approvedHere} approved this session</span>}
        <label className="text-[12px] text-muted flex items-center gap-[6px] ml-auto">
          Order
          <select className="text-[12px]" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="priority">Priority first</option>
            <option value="release">Release order</option>
          </select>
        </label>
      </div>

      {undo && (
        <div className="flex items-center gap-[10px] mt-[12px] p-[8px_12px] rounded-md bg-ok-soft text-ok text-[12.5px]">
          <Check size={14} /> Approved {undo.videoId} — its lines are ready for Voice.
          {undo.madeBy !== 'self' && (undo.queued
            ? <span className="text-ink-2">Its voice is being made on this Mac — it will be in Voices to approve.</span>
            : <button className="text-[12px] p-[3px_10px]" onClick={async () => { await mutate(() => api.queueVoice([undo.productionId]), null).catch(() => {}); setUndo((u) => u && { ...u, queued: true }); }}>
                <Headphones size={12} /> Make its voice tonight
              </button>)}
          <button className="ghostbtn text-[12.5px] text-ink-2 p-0 underline" onClick={takeBack}><Undo2 size={12} className="inline" /> Undo</button>
          <button className="ghostbtn text-[12px] text-muted p-0 ml-auto" onClick={() => setUndo(null)}>Dismiss</button>
        </div>
      )}

      {!item ? (
        <div className="mt-[28px] text-center p-[32px] border border-dashed border-line-2 rounded-lg">
          <Check size={22} className="block mx-auto text-ok mb-[6px]" />
          <b className="text-[14px]">{{ ready: 'No drafts waiting', checks: 'No checks left', voice: 'No voices waiting' }[mode]}</b>
          <p className="text-muted text-[13px] m-[4px_0_0]">{{ ready: 'Every draft is approved or still has checks to answer.', checks: 'Every check is answered.', voice: 'Every made voice is approved. Voices to make run overnight from Today or the Register.' }[mode]}</p>
        </div>
      ) : (
        <section className="mt-[14px] border border-solid border-line rounded-lg bg-surface [box-shadow:var(--shadow)]" aria-label="Review item">
          <header className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[4px] p-[14px_18px] [border-bottom:1px_solid_var(--line)]">
            <code className="text-[12px] font-semibold text-ink-2">{item.videoId}</code>
            <b className="text-[16px] font-[620]">{item.name}</b>
            <span className="text-[12.5px] text-muted">{item.company}{item.priority ? ` · ${item.priority}` : ''}</span>
            <span className="ml-auto flex items-center gap-[6px] text-[12px] text-faint">
              <button className="ghostbtn p-[2px] text-faint" aria-label="Previous" disabled={at === 0} onClick={() => setAt((i) => Math.max(0, i - 1))}><ChevronLeft size={14} /></button>
              {Math.min(at, list.length - 1) + 1} of {list.length}
            </span>
          </header>

          <div className={'grid gap-[22px] p-[18px] lte960:grid-cols-[1fr] ' + (mode === 'voice' ? 'grid-cols-[1fr]' : 'grid-cols-[minmax(0,1fr)_280px]')}>
            {mode === 'voice' ? (
              <VoiceItem item={item} busy={busy}
                onApproveAll={async (it, ls) => {
                  setBusy(true);
                  try { for (const l of ls) await mutate(() => api.markHeard(it.productionId, l.segmentId, l.takeId, true), null, { silent: true }); await load(); }
                  catch { /* reported */ } finally { setBusy(false); }
                }}
                onApproveLine={async (it, l) => { setBusy(true); try { await mutate(() => api.markHeard(it.productionId, l.segmentId, l.takeId, true), null, { silent: true }); await load(); } catch { /* reported */ } finally { setBusy(false); } }}
                onRemake={async (it, l) => { setBusy(true); try { await mutate(() => api.auditionSegment(it.productionId, l.segmentId, {}), null); await load(); } catch { /* reported */ } finally { setBusy(false); } }}
                onChanged={load} />
            ) : mode === 'ready' ? (
              <article className="max-w-[66ch] flex flex-col gap-[12px]">
                {item.lines.map((l) => (editing === l.id ? (
                  <div key={l.id}>
                    <textarea className="w-full min-h-[90px] text-[15.5px] leading-[1.7]" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                    <div className="flex gap-[6px] mt-[6px]">
                      <button className="primary text-[12.5px]" disabled={busy || !draft.trim()} onClick={() => saveLine(item, l, draft)}><Check size={13} /> Save</button>
                      <button className="text-[12.5px]" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p key={l.id} title="Click to edit" onClick={() => { setEditing(l.id); setDraft(l.text); }}
                    className="m-0 text-[15.5px] leading-[1.7] text-ink cursor-text rounded-[4px] -mx-[6px] px-[6px] hover:bg-surface-2">{l.text}</p>
                )))}
                <p className="text-faint text-[12px] m-0">Click any paragraph to fix it before you approve.</p>
              </article>
            ) : (
              <div className="flex flex-col gap-[14px] min-w-0">
                {item.lines.map((l) => (
                  <div key={l.id} className="rounded-lg border border-solid border-line p-[12px_14px]">
                    <div className="flex items-start gap-[8px] text-[13px] text-warn font-[560]">
                      <AlertCircle size={15} className="flex-none mt-[2px]" />
                      <span>Check against the product: {l.checks.join(' · ')}</span>
                    </div>
                    {editing === l.id ? (
                      <>
                        <textarea className="w-full min-h-[80px] text-[14.5px] leading-[1.65] mt-[8px]" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                        <div className="flex gap-[6px] mt-[6px]">
                          <button className="primary text-[12.5px]" disabled={busy || !draft.trim()} onClick={() => saveLine(item, l, draft)}><Check size={13} /> Save the line</button>
                          <button className="text-[12.5px]" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="m-[8px_0_0] text-[14.5px] leading-[1.65] text-ink max-w-[66ch]">{strip(l.text)}</p>
                        <div className="flex flex-wrap gap-[6px] mt-[10px]">
                          <button className="text-[12.5px] p-[5px_11px]" disabled={busy} onClick={() => saveLine(item, l, strip(l.text))}><Check size={13} /> Confirmed as written</button>
                          <button className="text-[12.5px] p-[5px_11px]" disabled={busy} onClick={() => { setEditing(l.id); setDraft(strip(l.text)); }}><Pencil size={13} /> Edit the line</button>
                          <button className="text-[12.5px] p-[5px_11px]" disabled={busy} title="Remove it from the script and add it to the shot list, to check while you record that screen"
                            onClick={() => toNote(item, l)}><ClipboardList size={13} /> Make it a recording note</button>
                          <EnhanceButton label="Suggest an answer" busy={answer?.lineId === l.id && answer.busy} busyLabel="Looking…"
                            onPick={() => suggest(item, l)} options={[{ id: 'answer', label: 'Find the answer in what the company has said',
                              detail: 'Searches its published videos, approved scripts and website. Only suggests an answer it can quote.' }]} />
                        </div>
                        {answer?.lineId === l.id && answer.found === false && (
                          <div className="mt-[8px] text-[12.5px] text-ink-2 bg-surface-2 rounded-md p-[8px_11px]">
                            <b className="font-[560]">Not found — yours to answer.</b> Searched {answer.searched.join(', ')}.{answer.why ? ` ${answer.why}` : ''}
                            {/\b(current|route|workflow|navigation|fields?|screen|step|action|state|view|process|flow|setting|button)\b/i.test(answer.question) && (
                              <span className="block mt-[5px]">
                                It reads like a check of the product’s screens — confirm it while you record that screen.
                                <button className="text-[12px] p-[3px_9px] ml-[8px]" disabled={busy} onClick={() => { toNote(item, l); setAnswer(null); }}>
                                  <ClipboardList size={12} /> Make it a recording note
                                </button>
                              </span>
                            )}
                            {answer.nearest?.length > 0 && (
                              <span className="block mt-[4px] text-muted">Closest: “{answer.nearest[0].text}” <i>({answer.nearest[0].source})</i></span>
                            )}
                            <button className="ghostbtn p-0 ml-[8px] text-[12px] text-muted" onClick={() => setAnswer(null)}>Dismiss</button>
                          </div>
                        )}
                        {answer?.lineId === l.id && answer.found && (
                          <>
                            <Suggestion text={answer.text} flags={answer.flags} meta={modelLabel(answer.model)} useLabel="Use this answer"
                              onDismiss={() => setAnswer(null)} onUse={() => { saveLine(item, l, answer.text); setAnswer(null); }} />
                            <ul className="m-[6px_0_0] p-0 list-none">
                              {answer.quotes.map((q) => (
                                <li key={q.text} className="text-[12px] text-muted leading-[1.5]">“{q.text}” <i className="text-faint">— {q.source}</i></li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {mode !== 'voice' && <BriefPanel item={item} onFit={mode === 'ready' ? fitItem : null}
              fitting={fitting?.productionId === item.productionId ? fitting : null} />}
          </div>

          {/* Stays in view on a long script, so Approve is always one key or click away. */}
          <footer className="sticky bottom-0 z-[2] flex flex-wrap items-center gap-[8px] p-[12px_18px] [border-top:1px_solid_var(--line)] bg-surface-2 rounded-b-lg [box-shadow:0_-6px_14px_-10px_rgba(0,0,0,.25)]">
            {mode === 'ready' && <button className="primary" disabled={busy || !!editing || fitting?.productionId === item.productionId} onClick={approve}><Check size={14} /> Approve <kbd className="opacity-60 text-[10.5px] ml-[2px]">A</kbd></button>}
            {mode === 'checks' && item.lines.length > 1 && <button disabled={busy} onClick={() => confirmAll(item)}><Check size={14} /> Confirm all {item.lines.length} as written</button>}
            <button disabled={busy || at >= list.length - 1} onClick={skip}><SkipForward size={14} /> Skip <kbd className="opacity-60 text-[10.5px] ml-[2px]">S</kbd></button>
            {busy && <RefreshCw size={13} className="animate-spin text-muted" />}
            <button className="ghostbtn text-[12.5px] text-accent ml-auto" onClick={() => open(item.productionId)}><ExternalLink size={13} /> Open the video</button>
          </footer>
        </section>
      )}
    </>
  );
}
