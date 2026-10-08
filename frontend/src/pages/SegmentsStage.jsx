import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Check, AlertCircle, Play, Square, Volume2, RefreshCw, Lock, Film, User, Users, Headphones, X, Pencil, RotateCcw } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import PaidConfirm from '../components/PaidConfirm.jsx';
import { toSeconds, toClock } from '../utils/format.js';
import PresenterPick from '../components/PresenterPick.jsx';

/**
 * The segment is the unit of script, take, presenter, shot, quality and render.
 * Re-render one, not all.
 *
 * THE HARD GATE: nothing renders unheard. A take is an audition in the voice
 * that will actually ship, and editing the line revokes its approval — approving
 * a sound and then changing the words is not approval of the new words.
 */
const BLOCK_LABEL = {
  presenter: 'No presenter',
  avatar: 'Presenter has no avatar',
  audition: 'Never auditioned',
  unheard: 'Not approved',
};

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Your own voice, made free on this Mac: no casting per line, no render
 * settings, no paid confirmations — just each line, its take, and approval.
 * "Listen through" plays every take in order; once you have heard them all,
 * they can be approved together. Nothing is approved unheard.
 */
function LocalVoice({ data, optional, castable, run, production }) {
  const { segments, speakers } = data;
  const audio = useRef(null);
  const [playing, setPlaying] = useState(null);     // segment id now playing
  const [through, setThrough] = useState(null);     // index while listening through
  const [heardAll, setHeardAll] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [changing, setChanging] = useState(false);

  const made = segments.filter((s) => s.take?.audioUrl && !s.needsAudition);
  const approved = segments.filter((s) => s.heard);
  const missing = segments.filter((s) => s.needsAudition);
  const unapproved = made.filter((s) => !s.heard);
  const seconds = made.reduce((n, s) => n + (s.take?.duration ?? 0), 0);
  const voiceName = speakers[0]?.presenter?.name ?? 'not cast';

  const stop = () => { audio.current?.pause(); setPlaying(null); setThrough(null); };
  useEffect(() => () => audio.current?.pause(), []);
  const play = (s, onEnd) => {
    audio.current?.pause();
    const a = new Audio(s.take.audioUrl);
    audio.current = a;
    setPlaying(s.id);
    a.onended = () => { setPlaying(null); onEnd?.(); };
    a.play().catch(() => setPlaying(null));
  };
  const listenThrough = (i = 0) => {
    const list = made;
    if (i >= list.length) { setThrough(null); setHeardAll(true); return; }
    setThrough(i);
    document.getElementById(`line-${list[i].id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    play(list[i], () => listenThrough(i + 1));
  };
  const approveAll = () => run('approve-all', async () => {
    let last;
    for (const s of unapproved) last = await api.markHeard(production.id, s.id, s.take.id, true);
    return last;
  });

  return (
    <div className="stagepane">
      <div className="sectiontitle">
        <div>
          <h2>Voice</h2>
          <p>{optional
            ? 'Optional when you record it yourself — your AI read of each line is the pace guide in the teleprompter.'
            : 'Your voice for each line, made on this Mac for free. Listen, then approve — nothing goes into a video unheard.'}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[10px] p-[10px_12px] rounded-lg bg-surface-2 text-[13px]">
        <b className={approved.length === segments.length ? 'text-ok' : 'text-ink'}>
          {approved.length === segments.length ? <><Check size={14} className="inline -mt-[2px]" /> All {segments.length} lines approved</> : `${approved.length} of ${segments.length} lines approved`}
        </b>
        {seconds > 0 && <span className="text-muted">· {clock(seconds)} spoken</span>}
        <span className="text-muted">· Voice: {voiceName}</span>
        <button className="ghostbtn text-[12.5px] text-accent p-0" onClick={() => setChanging((c) => !c)}>{changing ? 'done' : 'change'}</button>
        <span className="ml-auto flex gap-[8px]">
          {missing.length > 0 && (
            <button className={made.length ? '' : 'primary'} onClick={() => run('all', () => api.auditionAll(production.id))}>
              <Volume2 size={14} /> Make {missing.length === segments.length ? 'all' : 'the missing'} {missing.length} line{missing.length === 1 ? '' : 's'}
            </button>
          )}
          {made.length > 0 && (through == null
            ? <button className={unapproved.length && !heardAll ? 'primary' : ''} onClick={() => { setHeardAll(false); listenThrough(0); }}><Headphones size={14} /> Listen through</button>
            : <button onClick={stop}><Square size={13} /> Stop</button>)}
          {unapproved.length > 0 && heardAll && (
            <button className="primary" onClick={approveAll}><Check size={14} /> Approve all {unapproved.length}</button>
          )}
        </span>
      </div>
      {changing && speakers.map((sp) => (
        <div key={sp.speaker} className="flex items-center gap-[8px] mt-[8px] text-[12.5px]">
          <span className="text-muted">Lines spoken by {sp.speaker} use</span>
          <PresenterPick items={castable} value={sp.mixed ? null : (sp.presenter?.id ?? null)} placeholder="not cast" clearLabel="Not cast"
            onChange={(id) => run(`sp${sp.speaker}`, () => api.updateSegment(production.id, sp.firstSegmentId, { presenterId: id, applyToSpeaker: true }), { tracksSave: true })} />
        </div>
      ))}

      <ol className="list-none p-0 m-[14px_0_0] flex flex-col gap-[6px]">
        {segments.map((s, i) => {
          const isMade = s.take?.audioUrl && !s.needsAudition;
          const now = playing === s.id;
          return (
            <li key={s.id} id={`line-${s.id}`}
              className={'grid grid-cols-[28px_minmax(0,1fr)_auto] gap-[12px] items-start p-[10px_12px] rounded-lg border border-solid '
                + (now ? 'border-accent bg-accent-soft' : s.heard ? 'border-line bg-surface' : 'border-line bg-surface')}>
              <button type="button" aria-label={now ? 'Stop' : `Play line ${i + 1}`} disabled={!isMade}
                onClick={() => (now ? stop() : play(s))}
                className={'w-[28px] h-[28px] p-0 grid place-items-center rounded-full ' + (isMade ? (now ? 'bg-accent text-[#fff] border-accent' : '') : 'opacity-40')}>
                {now ? <Square size={11} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
              </button>
              <div className="min-w-0">
                {editing === s.id ? (
                  <>
                    <textarea className="w-full min-h-[64px] text-[14px] leading-[1.55]" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                    <div className="flex gap-[6px] mt-[6px]">
                      <button className="primary text-[12px] p-[4px_10px]" onClick={() => { setEditing(null); run(`t${s.id}`, () => api.updateSegment(production.id, s.id, { text: draft }), { tracksSave: true }); }}>Save — remake this line</button>
                      <button className="text-[12px] p-[4px_10px]" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <p className="m-0 text-[14px] leading-[1.55] text-ink">{s.text}</p>
                )}
                {s.take && (!s.textMatchesTake || s.take.stale) && (
                  <small className="flex items-center gap-[4px] mt-[4px] text-warn text-[12px]"><AlertCircle size={12} /> The words changed since this take — remake it.</small>
                )}
              </div>
              <div className="flex items-center gap-[6px] whitespace-nowrap">
                {s.take?.duration ? <span className="text-faint text-[11.5px] [font-variant-numeric:tabular-nums]">{clock(s.take.duration)}</span> : null}
                {s.heard
                  ? <span className="text-ok text-[12px] inline-flex items-center gap-[3px]"><Check size={13} /> Approved</span>
                  : isMade
                    ? <button className="primary text-[12px] p-[4px_10px]" onClick={() => run(`h${s.id}`, () => api.markHeard(production.id, s.id, s.take.id, true))}><Check size={12} /> Approve</button>
                    : <span className="text-faint text-[12px]">Not made</span>}
                <button className="ghostbtn p-[4px] text-faint hover:text-ink" title={isMade ? 'Make this line again' : 'Make this line'}
                  onClick={() => run(`a${s.id}`, () => api.auditionSegment(production.id, s.id, {}))}><RotateCcw size={13} /></button>
                <button className="ghostbtn p-[4px] text-faint hover:text-ink" title="Edit the words" onClick={() => { setEditing(s.id); setDraft(s.text); }}><Pencil size={13} /></button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function SegmentsStage({ optional = false }) {
  const { production, mutate } = useStudio();
  const [data, setData] = useState(null);
  const [castable, setCastable] = useState([]);
  const [busy, setBusy] = useState(null);
  const [read, setRead] = useState(null);
  // One paid confirmation open at a time: { kind: 'audition' | 'render', id } or { kind: 'all' }.
  const [confirm, setConfirm] = useState(null);
  const [path, setPath] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // Anything that can charge the plan holds this lock. `busy` holds one key, so
  // a second action re-enabled the first one's button mid-request and a quick
  // double-click sent the same paid call twice. The ref blocks synchronously;
  // `paying` is its visible twin that disables every paid button.
  const payLock = useRef(false);
  const [paying, setPaying] = useState(null);

  const load = useCallback(async () => {
    const [d, c] = await Promise.all([api.segments(production.id), api.castablePresenters()]);
    setData(d);
    setCastable(c);
    setLoadError(null);
  }, [production.id]);

  useEffect(() => { load().catch(setLoadError); }, [load]);
  useEffect(() => { api.heygenStatus().then((h) => setPath(h.renderPath)).catch(() => {}); }, []);

  // A line render finishes at the provider; reloading is what polls it.
  const rendering = data?.segments.some((x) => ['queued', 'pending', 'processing'].includes(x.render?.status));
  useEffect(() => {
    if (!rendering) return;
    const t = setTimeout(() => { load().catch(() => {}); }, 4000);
    return () => clearTimeout(t);
  }, [rendering, data, load]);

  if (!data) return <LoadState error={loadError} retry={() => load().catch(setLoadError)} />;

  const { segments, gate, speakers } = data;
  // Your own voice gets the plain view; HeyGen and stock voices keep the full controls.
  const local = segments.length > 0 && segments.every((x) => x.presenter?.voice?.provider === 'local');
  // Cast, and needing a take — a stale take counts, because the only way past
  // it is a new one.
  const pendingAudition = segments.filter(
    (x) => x.needsAudition && x.presenter?.avatar && x.presenter?.voice
  ).length;
  // Editing a line is a save; auditioning and rendering are not. `mutate`
  // reports the outcome itself, so this must not report it a second time.
  // Returns the response. It used to swallow it, so a caller that needed the
  // result — the read-through, which IS its result — silently got undefined.
  const run = async (key, fn, { tracksSave = false } = {}) => {
    setBusy(key);
    try {
      const res = await mutate(fn, null, { tracksSave });
      await load();
      return res;
    } catch { return null; /* mutate has already said what went wrong */ }
    finally { setBusy(null); }
  };

  const runPaid = async (key, fn) => {
    if (payLock.current) return null;
    payLock.current = true;
    setPaying(key);
    setConfirm(null);
    try { return await run(key, fn); }
    finally { payLock.current = false; setPaying(null); }
  };
  const spends = data.auditionSpends;
  const auditionLine = (segId) => runPaid(`a${segId}`, () =>
    api.auditionSegment(production.id, segId, { confirmPaid: spends }));
  const renderLine = (segId) => runPaid(`r${segId}`, () => api.renderSegment(production.id, segId, true));
  if (local) return <LocalVoice data={data} optional={optional} castable={castable} run={run} production={production} />;

  return (
    <div className="stagepane">
      <div className="sectiontitle">
        <div>
          <h2>Voice</h2>
          <p>{optional
            ? 'Optional when you record it yourself: your AI read of each line, to hear the pace in the teleprompter.'
            : 'Your voice for each line, made on this Mac. Approve every line — nothing is made from audio you have not heard.'}</p>
        </div>
        <div className="sectionactions">
          {pendingAudition > 0 && (
            <button
              className="primary"
              disabled={!!paying}
              title={spends ? 'Real speech on your HeyGen plan — this uses credits' : 'Nothing is synthesised in Fixtures mode'}
              onClick={() => (spends
                ? setConfirm({ kind: 'all' })
                : runPaid('all', () => api.auditionAll(production.id)))}
            >
              <Volume2 size={14} /> {paying === 'all' ? 'Auditioning…' : `Audition ${pendingAudition} line${pendingAudition === 1 ? '' : 's'}`}
            </button>
          )}
          {segments.length > 0 && (
            <button
              onClick={async () => {
                const r = await run('read', () => api.readThrough(production.id));
                if (r?.data) setRead(r.data);
              }}
              disabled={busy === 'read'}
              title="Hear the words in a local voice. Costs nothing."
            >
              <Headphones size={14} /> {busy === 'read' ? 'Reading…' : 'Read aloud — free'}
            </button>
          )}
          <button onClick={() => run('build', () => api.buildSegments(production.id))}
            disabled={busy === 'build'}>
            <RefreshCw size={14} /> {segments.length ? 'Rebuild from script' : 'Build from script'}
          </button>
        </div>
      </div>

      {confirm?.kind === 'all' && (
        <PaidConfirm
          title={`Audition ${pendingAudition} line${pendingAudition === 1 ? '' : 's'} on your HeyGen plan?`}
          detail="Each line is real speech in the voice that will ship, and each one uses credits."
          confirmLabel="Yes — audition and charge my plan"
          busy={!!paying}
          onCancel={() => setConfirm(null)}
          onConfirm={() => runPaid('all', () =>
            api.auditionAll(production.id, { confirmPaid: true, limit: pendingAudition }))}
        />
      )}

      {read && (
        /* The free pass: what the words sound like and how long they actually
           run. Deliberately not the shipping voice, and deliberately unable to
           open the render gate — it answers "are these the right words", not
           "is this the right delivery". */
        <div className="flex items-center gap-[12px] flex-wrap m-[10px_0] p-[8px_12px] border border-solid border-line rounded-sm bg-canvas">
          <span className="inline-flex items-center gap-[6px] text-[12px] text-ink">
            <Headphones size={13} className="text-faint" />
            <b>Read-through</b>
            <i className="not-italic text-[11px] text-faint">local voice · nothing spent</i>
          </span>
          {(() => {
            // The target is "m:ss"; compare in seconds so "0:21 vs 2:00" is a
            // fact on screen rather than arithmetic you do in your head.
            const target = read.targetRuntime ? toSeconds(read.targetRuntime) : null;
            const off = target ? read.spokenSeconds / target : null;
            const tone = off == null ? 'text-muted' : off < 0.6 ? 'text-warn' : off > 1.15 ? 'text-[color:var(--bad,#b3261e)]' : 'text-ok';
            return (
              <span className={'text-[12px] ' + tone}>
                {toClock(read.spokenSeconds)} spoken
                {read.targetRuntime ? ` · target ${read.targetRuntime}` : ''}
              </span>
            );
          })()}
          {read.audio && <audio className="h-[30px] flex-1 min-w-[200px]" controls preload="none" src={read.audio} />}
          <button className="[border:0] [background:none] text-faint cursor-pointer p-[2px]" onClick={() => setRead(null)}><X size={13} /></button>
        </div>
      )}

      {segments.length > 0 && (
        <>
          {/* Casting is a decision about a SPEAKER. Making it per line meant the
              one line you missed was the one that blocked the render. */}
          <div className="flex items-center gap-[14px] flex-wrap m-[12px_0] p-[9px_12px] border border-solid border-line rounded bg-surface-2">
            <span className="inline-flex items-center gap-[5px] text-[11px] font-[600] tracking-[.04em] uppercase text-muted"><Users size={13} /> Casting</span>
            {speakers.map((sp) => (
              <span className="inline-flex items-center gap-[7px]" key={sp.speaker}>
                <b className="text-[12.5px] font-[550]">{sp.speaker}</b>
                <i className="not-italic text-[11px] text-faint">{sp.lines} line{sp.lines === 1 ? '' : 's'}</i>
                <PresenterPick
                  items={castable}
                  value={sp.mixed ? null : (sp.presenter?.id ?? null)}
                  placeholder={sp.mixed ? 'mixed — pick one' : 'not cast'}
                  clearLabel="Not cast"
                  onChange={(id) =>
                    run(`sp${sp.speaker}`, () => api.updateSegment(production.id, sp.firstSegmentId, {
                      presenterId: id,
                      applyToSpeaker: true,
                    }), { tracksSave: true })}
                />
              </span>
            ))}
            {castable.length === 0 && (
              <small className="text-warn text-[11.5px]">
                No presenter is cast to a real avatar and voice yet — do that on the Presenters page.
              </small>
            )}
          </div>
        </>
      )}

      {segments.length === 0 ? (
        <p className="sectionempty">
          <Film size={15} /> No segments yet. Build them from the accepted script.
        </p>
      ) : (
        <>
          <div className={'flex items-center gap-[8px] m-[14px_0_12px] p-[9px_12px] border border-solid rounded text-[13px] '
            + (gate.ready ? 'open border-[#c5e3d5] bg-ok-soft text-ok' : 'border-warn-line bg-warn-soft text-warn')}>
            {gate.ready
              ? <><Check size={15} className="flex-none" /> <b>All {gate.total} segments approved.</b> This production can render.</>
              : <><Lock size={15} className="flex-none" /> <b>{gate.heard} of {gate.total} approved.</b> {gate.blocked.length} still blocked — nothing renders unheard.</>}
          </div>

          <div className="flex flex-col gap-[1px] bg-line border border-solid border-line rounded overflow-hidden">
            {segments.map((s) => (
              <div className={'grid grid-cols-[30px_minmax(0,1fr)_132px_220px] lte980:grid-cols-[24px_minmax(0,1fr)] gap-[12px] [align-items:start] p-[11px_12px] '
                + (s.heard ? 'heard bg-surface-2' : 'bg-surface')} key={s.id}>
                <span className="font-mono text-[11px] leading-[1.9] font-normal text-faint text-right">{String(s.position + 1).padStart(2, '0')}</span>

                <div className="min-w-0">
                  <div className="flex items-center gap-[5px] text-[11.5px] font-[550] text-ink-2 uppercase tracking-[.04em] mb-[4px]">
                    <User size={12} /> {s.speaker}
                    {s.presenter && <em className="not-italic normal-case tracking-[0] text-muted font-[400]">as {s.presenter.name}</em>}
                  </div>
                  <textarea
                    className="w-full resize-y text-[13.5px] leading-[1.5] p-[6px_8px] border border-solid border-transparent rounded-sm bg-transparent text-ink [font-family:inherit] hover:border-line focus:border-accent-line focus:bg-surface"
                    defaultValue={s.text}
                    rows={2}
                    onBlur={(e) => {
                      if (e.target.value !== s.text) {
                        run(`t${s.id}`, () => api.updateSegment(production.id, s.id, { text: e.target.value }), { tracksSave: true });
                      }
                    }}
                  />
                  {s.take && (!s.textMatchesTake || s.take.stale) && (
                    <small className="flex items-center gap-[4px] mt-[3px] text-warn text-[11.5px]">
                      <AlertCircle size={11} />{' '}
                      {s.take.staleReason ?? 'The line changed after the last take'} — audition again.
                    </small>
                  )}
                </div>

                <div className="flex flex-col gap-[5px] lte980:col-[2] lte980:items-stretch lte980:flex-row">
                  <PresenterPick
                    items={castable}
                    value={s.presenter?.id ?? null}
                    onChange={(id) =>
                      run(`p${s.id}`, () => api.updateSegment(production.id, s.id, {
                        presenterId: id,
                      }), { tracksSave: true })}
                  />

                  <select
                    className="w-full text-[12px] p-[4px_6px]"
                    value={s.quality}
                    onChange={(e) =>
                      run(`q${s.id}`, () => api.updateSegment(production.id, s.id, { quality: e.target.value }), { tracksSave: true })}
                  >
                    <option value="draft">draft · 720p</option>
                    <option value="final">final · 1080p</option>
                  </select>
                </div>

                <div className="flex flex-col items-end gap-[6px] lte980:col-[2] lte980:items-start">
                  {s.heard ? (
                    <span className="okv inline-flex items-center gap-[4px] text-[11.5px]"><Check size={12} /> approved</span>
                  ) : (
                    <span className="unknownv inline-flex items-center gap-[4px] text-[11.5px]" title={BLOCK_LABEL[s.blockedBy]}>
                      <Lock size={12} /> {BLOCK_LABEL[s.blockedBy] ?? 'blocked'}
                    </span>
                  )}

                  {s.take?.audioUrl && (
                    <audio controls preload="none" src={s.take.audioUrl} className="w-full h-[30px]" />
                  )}

                  <div className="flex gap-[5px] flex-wrap justify-end [&_button]:text-[12px] [&_button]:p-[4px_8px]">
                    {confirm?.kind === 'audition' && confirm.id === s.id ? (
                      <>
                        <button onClick={() => setConfirm(null)}>Cancel</button>
                        <button className="primary" disabled={!!paying} onClick={() => auditionLine(s.id)}>
                          Charge my plan
                        </button>
                      </>
                    ) : (
                      <button
                        title={spends
                          ? 'Synthesise this line in the voice that will ship — uses credits'
                          : 'Nothing is synthesised in Fixtures mode'}
                        disabled={!!paying || !s.presenter}
                        onClick={() => (spends ? setConfirm({ kind: 'audition', id: s.id }) : auditionLine(s.id))}
                      >
                        <Volume2 size={13} /> {paying === `a${s.id}` ? 'Auditioning…' : 'Audition'}
                      </button>
                    )}

                    {s.take && !s.heard && s.textMatchesTake && !s.take.stale && (
                      <button
                        className="primary"
                        disabled={!s.take.audioUrl}
                        title={s.take.audioUrl ? 'Approve this take' : 'Nothing to hear yet'}
                        onClick={() => run(`h${s.id}`, () => api.markHeard(production.id, s.id, s.take.id, true))}
                      >
                        <Check size={13} /> Approve
                      </button>
                    )}

                    {s.heard && (confirm?.kind === 'render' && confirm.id === s.id ? (
                      <>
                        <button onClick={() => setConfirm(null)}>Cancel</button>
                        <button className="primary" disabled={!!paying} onClick={() => renderLine(s.id)}>
                          Charge my plan
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={!!paying}
                        title={path && !path.free ? 'Charged to your HeyGen plan' : path?.reason ?? ''}
                        onClick={() => (path && !path.free ? setConfirm({ kind: 'render', id: s.id }) : renderLine(s.id))}
                      >
                        <Play size={13} /> {paying === `r${s.id}` ? 'Rendering…' : 'Render line'}
                      </button>
                    ))}
                  </div>

                  {s.render && (
                    <span className={'vchip ' + (s.render.status === 'completed' ? 'complete' : s.render.status)
                      + (s.render.stale ? ' stale' : '')}>
                      v{s.render.version} · {s.render.status}{s.render.stale ? ' · stale' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
