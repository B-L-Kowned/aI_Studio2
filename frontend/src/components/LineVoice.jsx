import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Play, Pause, RefreshCw, Check, X, Undo2, Wand2, Type, Repeat } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { tokens, estimateTimes, termOf, clock } from '../utils/line-words.js';

// One line plays at a time, across the whole page.
let playingNow = null;
const claim = (audio) => { if (playingNow && playingNow !== audio) playingNow.pause(); playingNow = audio; };

/**
 * A line you can hear word by word. The words light up as they are spoken;
 * clicking one (or selecting a few) opens the fixer on it, right there.
 *
 *   audio      { url, takeId?, cacheKey?, lineId?, duration? } — what plays now
 *   getAudio   async () => audio, for a line with nothing made yet (Hear)
 *   segmentId  set when the line has its own take that can be fixed in place
 *   take       the take ({ fixed, fixNote }) for the "fixed — undo" note
 *   onChange   called with the updated line after a fix or an undo
 *   aside      what sits to the right (length, approve, …)
 */
export default function LineVoice({ text, audio: given, getAudio, segmentId, take, onChange, onPlayed, aside, dim, making, current: lit }) {
  const toks = useMemo(() => tokens(text), [text]);
  const [audio, setAudio] = useState(given ?? null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(given?.duration ?? 0);
  const [timed, setTimed] = useState(null);           // words with Whisper's times
  const [fix, setFix] = useState(null);               // { index, term }
  const [after, setAfter] = useState(null);           // others still saying a term the old way
  const el = useRef(null);
  const wordsAsked = useRef(null);

  useEffect(() => { setAudio(given ?? null); setTimed(null); wordsAsked.current = null; }, [given?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const times = timed ?? estimateTimes(toks, duration);
  const current = playing && times ? times.findIndex((t) => now >= t.start && now < t.end + 0.08) : -1;

  const askWords = useCallback((a) => {
    if (!a || wordsAsked.current === a.url) return;
    wordsAsked.current = a.url;
    const req = a.takeId ? api.takeWords(a.takeId) : a.cacheKey && a.lineId ? api.cacheWords(a.cacheKey, a.lineId) : null;
    req?.then((r) => r.words?.length === toks.length && setTimed(r.words)).catch(() => {});
  }, [toks.length]);

  const start = (a) => {
    const node = el.current;
    if (!node || !a) return;
    askWords(a);
    if (node.getAttribute('src') !== a.url) node.src = a.url;
    claim(node);
    node.play().catch(() => {});
  };
  const make = async () => {
    setBusy(true);
    try { const a = await getAudio(); setAudio(a); return a; } catch { return null; } finally { setBusy(false); }
  };
  const play = async () => {
    if (playing) { el.current?.pause(); return; }
    start(audio ?? (getAudio ? await make() : null));
  };

  const openFix = (index, term) => {
    el.current?.pause();
    setAfter(null);
    setFix({ index, term: term ?? termOf(toks[index]?.w ?? '') });
  };

  // Selecting several words ("DomusLogic ERP") fixes them as one term.
  const onMouseUp = (e) => {
    const sel = window.getSelection();
    const picked = sel?.toString().trim();
    if (!picked || !/\s/.test(picked) || !e.currentTarget.contains(sel.anchorNode)) return;
    const span = sel.anchorNode.parentElement?.closest('[data-i]');
    openFix(Number(span?.dataset.i ?? 0), picked.replace(/^[^\w]+|[^\w]+$/g, ''));
    sel.removeAllRanges();
  };

  const undo = async () => {
    try {
      const r = await api.revertLineFix(segmentId);
      onChange?.(r.data.line, r.message);
    } catch { /* the line stays as it is */ }
  };

  return (
    <div className={'group/line grid grid-cols-[30px_minmax(0,1fr)_auto] gap-x-[10px] items-start p-[7px_0] lte800:grid-cols-[30px_minmax(0,1fr)] ' + (dim ? 'opacity-60 ' : '') + (lit ? 'bg-accent-soft rounded-lg px-[8px] mx-[-8px]' : '')}>
      <audio ref={el} preload="none" className="hidden"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setNow(0); onPlayed?.(); }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />

      <button type="button" onClick={play} disabled={busy || making || (!audio && !getAudio)}
        aria-label={playing ? 'Pause' : 'Play this line'}
        title={audio || getAudio ? 'Play — then click any word to fix it' : 'No voice yet'}
        className={'w-[28px] h-[28px] mt-[1px] p-0 rounded-full grid place-items-center border border-solid transition-colors '
          + (playing ? 'bg-ink border-ink text-white' : 'bg-surface border-line text-ink hover:border-ink')}>
        {busy || making ? <RefreshCw size={12} className="animate-spin" /> : playing ? <Pause size={12} /> : <Play size={12} className="ml-[1px]" />}
      </button>

      <div className="min-w-0">
        <p className="m-0 max-w-[68ch] text-[15px] leading-[1.7] text-ink [text-wrap:pretty]" onMouseUp={onMouseUp}>
          {toks.map((t, i) => {
            const on = i === current;
            const chosen = fix && (fix.term.includes(' ') ? toks[i].s === toks[fix.index].s && fix.term.toLowerCase().includes(termOf(t.w).toLowerCase()) : i === fix.index);
            return (
              <React.Fragment key={i}>
                <span data-i={i} onClick={() => !window.getSelection()?.toString().trim() && openFix(i)}
                  className={'cursor-pointer rounded-[3px] px-[1px] mx-[-1px] transition-colors duration-75 '
                    + (on ? 'bg-ink text-white ' : chosen ? 'bg-accent-soft text-accent [box-shadow:inset_0_-2px_0_var(--accent)] '
                      // The sentence the fix will remake, so you can see how much changes.
                      : fix && t.s === toks[fix.index]?.s ? '[box-shadow:inset_0_-1px_0_var(--accent-line)] hover:bg-accent-soft ' : 'hover:bg-accent-soft ')
                    + (playing && current > i ? 'text-ink' : playing && !on ? 'text-ink-2' : '')}>
                  {t.w}
                </span>{' '}
              </React.Fragment>
            );
          })}
        </p>
        {playing && duration > 0 && (
          <div className="h-[2px] bg-line rounded-full mt-[3px] overflow-hidden" aria-hidden="true">
            <div className="h-full bg-ink" style={{ width: `${Math.min(100, (now / duration) * 100)}%` }} />
          </div>
        )}
        {!fix && take?.fixed && segmentId && (
          <p className="m-[2px_0_0] text-[11.5px] text-ok flex items-center gap-[6px]">
            <Check size={12} /> Fixed — {take.fixNote}
            <button type="button" className="ghostbtn p-0 text-[11.5px] text-muted underline decoration-dotted" onClick={undo}>
              <Undo2 size={11} /> Undo
            </button>
          </p>
        )}
        {after && <OthersBar after={after} segmentId={segmentId} onDone={() => setAfter(null)} />}
        {fix && (
          <LineFixer text={text} toks={toks} at={fix.index} term={fix.term} segmentId={segmentId}
            onClose={() => setFix(null)}
            onApplied={(line, others, message) => { setFix(null); if (others?.lines) setAfter(others); onChange?.(line, message); }}
            onPronounced={async () => { setFix(null); setTimed(null); wordsAsked.current = null; if (getAudio) start(await make()); }} />
        )}
      </div>

      {aside && <div className="flex items-center gap-[8px] pt-[3px] text-[11.5px] text-muted [font-variant-numeric:tabular-nums] lte800:col-[2] lte800:pt-[4px]">{aside}</div>}
    </div>
  );
}

/** After a pronunciation fix: the other lines that still say it the old way. */
function OthersBar({ after, segmentId, onDone }) {
  const { mutate } = useStudio();
  const remake = async () => {
    try { await mutate(() => api.remakePronunciationUses(after.term, segmentId), null); } catch { /* reported */ }
    onDone();
  };
  return (
    <div className="flex flex-wrap items-center gap-[8px] mt-[6px] text-[12px] text-ink-2">
      <span>“{after.term}” is still said the old way in <b className="font-[580]">{after.lines} other line{after.lines === 1 ? '' : 's'}</b>
        {' '}across {after.videos.length} video{after.videos.length === 1 ? '' : 's'}.</span>
      <button type="button" className="text-[12px] p-[3px_10px]" onClick={remake}>Remake them in the background</button>
      <button type="button" className="ghostbtn text-[12px] text-muted p-0" onClick={onDone}>Not now</button>
    </div>
  );
}

const MODES = [
  { id: 'say', label: 'Say it differently', icon: Wand2 },
  { id: 'words', label: 'Change the words', icon: Type },
  { id: 'again', label: 'Read it again', icon: Repeat },
];
const DELIVERIES = [['calmer', 'Calmer'], ['natural', 'Same feel'], ['energy', 'More energy']];

/**
 * Fix the word you clicked. The server remakes the smallest piece that blends —
 * the sentence around it — and cuts it in at the pauses; you choose a reading
 * by hearing each in place, a second either side.
 */
function LineFixer({ text, toks, at, term: initialTerm, segmentId, onClose, onApplied, onPronounced }) {
  const { mutate } = useStudio();
  const fixable = !!segmentId;
  const [mode, setMode] = useState('say');
  const [term, setTerm] = useState(initialTerm);
  const [sayAs, setSayAs] = useState('');
  const [words, setWords] = useState(text);
  const [job, setJob] = useState(null);
  const [heard, setHeard] = useState(null);           // which reading was last played
  const [playingKey, setPlayingKey] = useState(null);
  const player = useRef(null);
  const stopAt = useRef(null);
  const sentence = toks[at]?.s ?? 0;

  useEffect(() => { setTerm(initialTerm); setSayAs(''); }, [initialTerm]);
  // What you said it as last time, if this term has been fixed before.
  useEffect(() => {
    let live = true;
    api.pronunciations().then((list) => {
      const p = list.find((x) => x.term.toLowerCase() === initialTerm.toLowerCase());
      if (live && p) setSayAs(p.sayAs);
    }).catch(() => {});
    return () => { live = false; };
  }, [initialTerm]);

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') close();
      if (!job || e.target.closest?.('input,textarea')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= job.variants.length) playVariant(job.variants[n - 1], true);
      if (e.key === 'Enter' && heard) use(heard);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  useEffect(() => {
    if (job?.state !== 'running') return undefined;
    const t = setInterval(() => api.lineFix(segmentId).then((j) => j && setJob(j)).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [job?.state, segmentId]);

  const stop = () => { player.current?.pause(); setPlayingKey(null); };
  const playRange = (url, from, to, key) => {
    const a = player.current ?? (player.current = new Audio());
    claim(a);
    if (playingKey === key) { stop(); return; }
    a.src = url;
    a.currentTime = 0;
    stopAt.current = to;
    a.ontimeupdate = () => { if (stopAt.current != null && a.currentTime >= stopAt.current) stop(); };
    a.onended = () => setPlayingKey(null);
    a.onloadedmetadata = () => { a.currentTime = from; a.play().catch(() => {}); };
    setPlayingKey(key);
    if (a.readyState >= 1) { a.currentTime = from; a.play().catch(() => {}); }
  };
  const playVariant = (v, inContext) => {
    setHeard(v.n);
    if (inContext && job.scope === 'sentence') playRange(v.url, Math.max(0, v.from - 1.2), v.to + 1.0, `v${v.n}c`);
    else playRange(v.url, 0, null, `v${v.n}`);
  };
  const playOriginal = () => {
    if (!job?.base) return;
    playRange(job.base.url, job.scope === 'sentence' ? Math.max(0, job.base.from - 1.2) : 0,
      job.scope === 'sentence' ? job.base.to + 1.0 : null, 'orig');
  };

  const start = async (body) => {
    stop();
    try {
      const r = await mutate(() => api.startLineFix(segmentId, body), null, { silent: true });
      setJob(r.data); setHeard(null);
    } catch { /* mutate reports it */ }
  };
  const use = async (n) => {
    stop();
    try {
      const r = await mutate(() => api.applyLineFix(segmentId, n), null);
      onApplied(r.data.line, r.data.others, r.message);
    } catch { /* reported */ }
  };
  const close = () => {
    stop();
    if (job) api.discardLineFix(segmentId).catch(() => {});
    onClose();
  };

  // Without its own take (a draft, heard from the cache), the only fix is the
  // dictionary: save how it is said, then hear the line again.
  const savePronunciation = async () => {
    try {
      await mutate(() => api.savePronunciation({ term, sayAs, checked: true }), null);
      onPronounced();
    } catch { /* reported */ }
  };

  const sentenceToks = toks.filter((t) => t.s === sentence);
  const ready = job?.variants ?? [];
  const pending = job?.state === 'running' ? Math.max(0, job.total - ready.length) : 0;

  return (
    <div className="mt-[8px] mb-[4px] border border-solid border-line rounded-lg bg-surface [box-shadow:0_6px_24px_-12px_rgba(0,0,0,.18)] overflow-hidden"
      role="dialog" aria-label="Fix this line">
      <header className="flex items-center gap-[2px] p-[6px_6px_6px_10px] [border-bottom:1px_solid_var(--line)] bg-surface-2">
        {(fixable ? MODES : MODES.slice(0, 1)).map((m) => {
          const I = m.icon;
          return (
            <button key={m.id} type="button" disabled={job?.state === 'running'}
              onClick={() => { setMode(m.id); setJob(null); }}
              className={'border-0 text-[12.5px] p-[5px_10px] rounded flex items-center gap-[6px] '
                + (mode === m.id ? 'bg-surface text-ink font-[560] [box-shadow:0_0_0_1px_var(--line)]' : 'bg-transparent text-muted hover:text-ink')}>
              <I size={13} /> {m.label}
            </button>
          );
        })}
        <button type="button" className="ml-auto ghostbtn p-[5px] text-muted" aria-label="Close" onClick={close}><X size={14} /></button>
      </header>

      <div className="p-[12px_14px]">
        {!job && mode === 'say' && (
          <div className="grid gap-[10px]">
            <div className="flex flex-wrap items-end gap-[10px]">
              <label className="grid gap-[4px] text-[11px] uppercase tracking-[.06em] text-faint font-semibold">
                Word
                <input className="text-[13.5px] w-[180px] font-normal normal-case tracking-normal text-ink" value={term} onChange={(e) => setTerm(e.target.value)} />
              </label>
              <label className="grid gap-[4px] text-[11px] uppercase tracking-[.06em] text-faint font-semibold flex-1 min-w-[200px]">
                Sounds like
                <input autoFocus className="text-[13.5px] font-normal normal-case tracking-normal text-ink" value={sayAs} placeholder={`e.g. ${hint(term)}`}
                  onChange={(e) => setSayAs(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sayAs.trim() && (fixable ? start({ kind: 'pronounce', term, sayAs }) : savePronunciation())} />
              </label>
              <button type="button" className="primary" disabled={!term.trim() || !sayAs.trim()}
                onClick={() => (fixable ? start({ kind: 'pronounce', term, sayAs }) : savePronunciation())}>
                {fixable ? 'Remake it' : 'Save and hear again'}
              </button>
            </div>
            <p className="m-0 text-[12px] text-muted">
              Spell it the way it sounds — hyphens between beats, capitals on the stressed one. It is saved to your
              {' '}pronunciations, so every video says it this way from now on.
            </p>
          </div>
        )}

        {!job && mode === 'words' && (
          <div className="grid gap-[8px]">
            <textarea autoFocus className="w-full min-h-[64px] text-[14px] leading-[1.6]" value={words} onChange={(e) => setWords(e.target.value)} />
            <div className="flex items-center gap-[10px]">
              <span className="text-[12px] text-muted flex-1">Only the sentence you change is remade; the script stays approved.</span>
              <button type="button" className="primary" disabled={!words.trim() || words.trim() === text.trim()}
                onClick={() => start({ kind: 'words', text: words })}>Remake it</button>
            </div>
          </div>
        )}

        {!job && mode === 'again' && (
          <div className="grid gap-[8px]">
            <p className="m-0 text-[13px] text-ink-2">
              New readings of <span className="text-ink">“{sentenceToks.map((t) => t.w).join(' ')}”</span>
            </p>
            <div className="flex flex-wrap gap-[6px]">
              {DELIVERIES.map(([id, label]) => (
                <button key={id} type="button" className={id === 'natural' ? 'primary' : ''}
                  onClick={() => start(id === 'natural' ? { kind: 'retry', sentence } : { kind: 'delivery', delivery: id, sentence })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {job && (
          <div className="grid gap-[6px]">
            <p className="m-0 text-[12px] text-muted">
              {job.scope === 'sentence'
                ? 'Just this sentence is remade and blended in at the pauses either side. Each plays with a second around it.'
                : 'This sentence runs straight into the next, so the whole line is remade.'}
              {job.error && <span className="text-danger"> {job.error}</span>}
            </p>
            <Reading label="Original" sub="as it is now" playing={playingKey === 'orig'} onPlay={playOriginal} />
            {ready.map((v) => (
              <Reading key={v.n} label={`Reading ${v.n}`} sub={`${clock(v.duration)} · press ${v.n}`}
                playing={playingKey === `v${v.n}c` || playingKey === `v${v.n}`} picked={heard === v.n}
                onPlay={() => playVariant(v, true)}
                onWhole={job.scope === 'sentence' ? () => playVariant(v, false) : null}
                onUse={() => use(v.n)} />
            ))}
            {Array.from({ length: pending }, (_, i) => (
              <div key={`p${i}`} className="flex items-center gap-[10px] p-[8px_10px] rounded text-[12.5px] text-faint">
                <RefreshCw size={13} className="animate-spin" /> Making reading {ready.length + i + 1}…
                {i === 0 && <span className="text-[11.5px]">{job.scope === 'sentence' ? 'about 10 seconds' : 'about 30 seconds'}</span>}
              </div>
            ))}
            <div className="flex items-center gap-[10px] pt-[6px]">
              <button type="button" className="ghostbtn text-[12px] text-muted p-0" disabled={job.state === 'running'} onClick={() => setJob(null)}>
                Try something else
              </button>
              <span className="ml-auto text-[11.5px] text-faint">{heard ? 'Enter uses the one you just heard · ' : ''}Esc keeps the original</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Reading({ label, sub, playing, picked, onPlay, onWhole, onUse }) {
  return (
    <div className={'flex items-center gap-[10px] p-[6px_8px] rounded border border-solid '
      + (picked ? 'border-accent-line bg-accent-soft' : 'border-transparent hover:bg-surface-2')}>
      <button type="button" onClick={onPlay} aria-label={`Play ${label} in place`}
        className={'w-[26px] h-[26px] p-0 rounded-full grid place-items-center border border-solid '
          + (playing ? 'bg-ink border-ink text-white' : 'bg-surface border-line text-ink hover:border-ink')}>
        {playing ? <Pause size={11} /> : <Play size={11} className="ml-[1px]" />}
      </button>
      <span className="text-[13px] text-ink font-[540]">{label}</span>
      <span className="text-[11.5px] text-faint">{sub}</span>
      <span className="ml-auto flex items-center gap-[8px]">
        {onWhole && <button type="button" className="ghostbtn text-[12px] text-muted p-0" onClick={onWhole}>whole line</button>}
        {onUse && <button type="button" className="text-[12px] p-[4px_10px]" onClick={onUse}><Check size={12} /> Use this</button>}
      </span>
    </div>
  );
}

// A respelling to start from: the word broken into its capitalised parts.
function hint(term) {
  const parts = String(term).split(/(?=[A-Z])|[\s-]+/).filter(Boolean);
  return parts.length > 1 ? parts.join(' ') : `${term.slice(0, Math.ceil(term.length / 2))}-${term.slice(Math.ceil(term.length / 2))}`;
}
