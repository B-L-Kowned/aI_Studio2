import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Circle, Square, ChevronLeft, ChevronRight, Headphones, Check, Trash2, Play, AlertCircle, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import UploadDrop from '../components/UploadDrop.jsx';

// What this browser can record, best first. Chrome and Electron record webm;
// the server converts every take to mp4 on arrival, so the choice is only
// about what the recorder accepts.
const TYPES = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const recorderType = () => TYPES.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? '';
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/**
 * Record the video yourself, one script line at a time, reading from a
 * teleprompter that sits at the top of the window — under your camera, so your
 * eyes stay on the lens. Space records and stops; the next line comes up.
 * Recorded it elsewhere? Upload the whole thing and it is split into lines by
 * what you said.
 */
export default function RecordStage({ goToStage }) {
  const { production, mutate } = useStudio();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [at, setAt] = useState(0);
  const [stream, setStream] = useState(null);
  const [camError, setCamError] = useState(null);
  const [devices, setDevices] = useState({ video: [], audio: [] });
  const [cam, setCam] = useState('');
  const [mic, setMic] = useState('');
  const [state, setState] = useState('idle'); // idle | countdown | recording | saving
  const [count, setCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [useCountdown, setUseCountdown] = useState(true);
  const [level, setLevel] = useState(0);
  const [open, setOpen] = useState(null); // segmentId whose takes are shown
  const [lastTake, setLastTake] = useState(null); // { lineIndex, n, take } — the one you just recorded
  const [showUpload, setShowUpload] = useState(false);
  const [watching, setWatching] = useState(false);
  // Prompter size, remembered: reading distance differs per setup.
  const [size, setSizeState] = useState(() => { try { return Number(localStorage.getItem('prompter-size')) || 30; } catch { return 30; } });
  const setSize = (n) => { const v = Math.min(52, Math.max(20, n)); setSizeState(v); try { localStorage.setItem('prompter-size', String(v)); } catch { /* storage blocked */ } };
  const video = useRef(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const startedAt = useRef(0);

  const load = useCallback(async () => {
    const d = await api.lineTakes(production.id);
    setData(d); setLoadError(null);
    return d;
  }, [production.id]);
  useEffect(() => { load().catch(setLoadError); }, [load]);

  // While a whole recording is being split, check in every few seconds.
  useEffect(() => {
    if (data?.split?.state !== 'running') return undefined;
    const t = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [data?.split?.state, load]);

  // The camera: asked for once, released when you leave the page.
  useEffect(() => {
    let live = true; let s = null;
    (async () => {
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { ...(cam ? { deviceId: { exact: cam } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        if (!live) { s.getTracks().forEach((t) => t.stop()); return; }
        setStream(s); setCamError(null);
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices({ video: all.filter((d) => d.kind === 'videoinput'), audio: all.filter((d) => d.kind === 'audioinput') });
      } catch (err) {
        if (live) setCamError(err.name === 'NotAllowedError' ? 'Camera or microphone access was refused. Allow it for this app, then reload.' : `No camera available (${err.message}).`);
      }
    })();
    return () => { live = false; s?.getTracks().forEach((t) => t.stop()); };
  }, [cam, mic]);

  // The camera can be ready before the lines load, when there is no preview to
  // attach it to yet; a callback ref attaches it whenever the preview appears.
  const attach = useCallback((el) => {
    video.current = el;
    if (el && stream && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  // A level meter, so a muted or wrong microphone shows before a take, not after.
  useEffect(() => {
    if (!stream?.getAudioTracks().length) return undefined;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let raf;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 100));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); ctx.close(); };
  }, [stream]);

  useEffect(() => {
    if (state !== 'recording') return undefined;
    const t = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 200);
    return () => clearInterval(t);
  }, [state]);

  const lines = data?.lines ?? [];
  const line = lines[at];

  const begin = useCallback(() => {
    if (!stream || !line) return;
    chunks.current = [];
    const type = recorderType();
    const r = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 8_000_000 });
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = async () => {
      setState('saving');
      const base = (r.mimeType || 'video/webm').split(';')[0];
      const file = new File(chunks.current, `line-${line.n}.${base.endsWith('mp4') ? 'mp4' : 'webm'}`, { type: base });
      try {
        const saved = await mutate(() => api.uploadLineTake(production.id, line.segmentId, file), null, { silent: true });
        setLastTake({ lineIndex: at, n: line.n, take: saved.data });
        const d = await load();
        // On to the next line that has no take yet.
        const next = d.lines.findIndex((l, i) => i > at && !l.takes.length);
        if (next !== -1) setAt(next);
      } catch { /* mutate reports it */ }
      setState('idle');
    };
    recorder.current = r;
    r.start(1000);
    startedAt.current = Date.now();
    setElapsed(0);
    setState('recording');
  }, [stream, line, at, production.id, mutate, load]);

  const record = useCallback(() => {
    if (state === 'recording') { recorder.current?.stop(); return; }
    if (state !== 'idle') return;
    if (!useCountdown) { begin(); return; }
    setState('countdown'); setCount(3);
    let n = 3;
    const t = setInterval(() => {
      n -= 1; setCount(n);
      if (n === 0) { clearInterval(t); begin(); }
    }, 700);
  }, [state, useCountdown, begin]);

  useEffect(() => {
    const onKey = (e) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space') { e.preventDefault(); record(); }
      else if (state === 'idle' && e.key === 'ArrowRight') setAt((i) => Math.min(lines.length - 1, i + 1));
      else if (state === 'idle' && e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [record, state, lines.length]);

  if (!data) return <LoadState error={loadError} retry={() => load().catch(setLoadError)} label="Loading lines…" />;

  if (!lines.length) {
    return (
      <div className="stagepane">
        <h2>Record</h2>
        <div className="notice warn"><AlertCircle /> <span>Nothing to record yet — accept the script first; each line becomes a take to record.</span></div>
        <button className="mt-[10px]" onClick={() => goToStage?.('Script')}>Go to Script</button>
      </div>
    );
  }

  const done = lines.filter((l) => l.takes.length).length;
  const choose = (t) => mutate(() => api.updateLineTake(production.id, t.id, { chosen: true }), null, { silent: true }).then(load).catch(() => {});
  const discard = (t) => window.confirm(`Discard take ${t.version}? Its file moves to Takes/Discarded.`)
    && mutate(() => api.discardLineTake(production.id, t.id), null).then(load).catch(() => {});
  const split = data.split;

  return (
    <div className="stagepane">
      {/* The teleprompter: first thing on the page, nearest the camera. */}
      <section aria-label="Teleprompter" className="relative rounded-lg bg-ink p-[18px_56px_20px] text-center">
        <div className="text-[11px] tracking-[.08em] uppercase text-[rgba(255,255,255,.55)] mb-[10px]">
          Line {line.n} of {lines.length}{state === 'recording' && <span className="text-[#ff8a80]"> · recording</span>}
        </div>
        {/* Colours are explicit: the page's paragraph colour would grey this out. */}
        <p className="m-0 font-[540] text-[#fff] mx-auto max-w-[34ch]" style={{ fontSize: size, lineHeight: 1.32 }}>{line.text}</p>
        {lines[at + 1] && <p className="m-[14px_auto_0] max-w-[60ch] text-[rgba(255,255,255,.42)]" style={{ fontSize: Math.round(size * 0.5), lineHeight: 1.4 }}>Next: {lines[at + 1].text}</p>}
        <span className="absolute top-[10px] right-[10px] flex flex-col gap-[4px]">
          <button type="button" aria-label="Larger text" onClick={() => setSize(size + 3)}
            className="w-[30px] h-[26px] p-0 grid place-items-center rounded-md bg-[rgba(255,255,255,.08)] text-[#fff] [border:0] text-[13px] font-semibold">A+</button>
          <button type="button" aria-label="Smaller text" onClick={() => setSize(size - 3)}
            className="w-[30px] h-[26px] p-0 grid place-items-center rounded-md bg-[rgba(255,255,255,.08)] text-[#fff] [border:0] text-[11px] font-semibold">A−</button>
        </span>
      </section>

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)] gap-[16px] mt-[14px] lte960:grid-cols-[1fr]">
        <div>
          <div className="relative rounded-lg overflow-hidden bg-ink aspect-video">
            {camError
              ? <p className="absolute inset-0 grid place-items-center text-[#fff] text-[13px] p-[20px] text-center">{camError}</p>
              : <video ref={attach} autoPlay muted playsInline className="w-full h-full object-cover [transform:scaleX(-1)]" />}
            {state === 'countdown' && <span className="absolute inset-0 grid place-items-center text-[#fff] text-[72px] font-[650] bg-[rgba(0,0,0,.35)]">{count}</span>}
            {state === 'recording' && (
              <span className="absolute top-[10px] left-[10px] flex items-center gap-[6px] bg-danger text-[#fff] text-[12px] font-semibold rounded-full p-[3px_10px]">
                <Circle size={9} fill="currentColor" /> REC {clock(elapsed)}
              </span>
            )}
            {state === 'saving' && <span className="absolute top-[10px] left-[10px] bg-ink text-[#fff] text-[12px] rounded-full p-[3px_10px]"><RefreshCw size={11} className="inline animate-spin" /> Saving take…</span>}
            <span className="absolute bottom-[10px] left-[10px] right-[10px] h-[4px] rounded-full bg-[rgba(255,255,255,.2)]" aria-label="Microphone level">
              <span className="block h-full rounded-full bg-ok [transition:width_.08s]" style={{ width: `${Math.round(level * 100)}%` }} />
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-[8px] mt-[10px]">
            <button className="ghostbtn p-[6px]" aria-label="Previous line" disabled={state !== 'idle' || at === 0} onClick={() => setAt(at - 1)}><ChevronLeft size={16} /></button>
            <button className={state === 'recording' ? 'primary bg-danger border-danger' : 'primary'} disabled={!stream || state === 'saving' || state === 'countdown'} onClick={record}>
              {state === 'recording' ? <><Square size={13} fill="currentColor" /> Stop</> : <><Circle size={13} fill="currentColor" /> {line.takes.length ? 'Record another take' : 'Record this line'}</>}
            </button>
            <button className="ghostbtn p-[6px]" aria-label="Next line" disabled={state !== 'idle' || at === lines.length - 1} onClick={() => setAt(at + 1)}><ChevronRight size={16} /></button>
            {line.guideAudio && (
              <button className="text-[12px] p-[5px_10px]" title="Your approved AI read of this line — for pace" onClick={() => new Audio(line.guideAudio).play()}>
                <Headphones size={13} /> Hear the pace
              </button>
            )}
            <label className="flex items-center gap-[5px] text-[12px] text-muted ml-auto">
              <input type="checkbox" checked={useCountdown} onChange={(e) => setUseCountdown(e.target.checked)} /> 3-2-1
            </label>
          </div>
          {lastTake && state === 'idle' && (
            <div className="flex flex-wrap items-center gap-[8px] mt-[10px] p-[8px_10px] rounded-md bg-surface-2 text-[12.5px]">
              <Check size={14} className="text-ok" />
              <span>Line {lastTake.n}, take {lastTake.take?.version} saved{lastTake.take?.duration ? ` (${clock(lastTake.take.duration)})` : ''}.</span>
              <button className="text-[12px] p-[3px_9px]" onClick={() => setWatching((w) => !w)}>
                <Play size={12} /> {watching ? 'Hide' : 'Watch it'}
              </button>
              <button className="text-[12px] p-[3px_9px]" onClick={() => { setAt(lastTake.lineIndex); setLastTake(null); }}>
                <RotateCcw size={12} /> Retake line {lastTake.n}
              </button>
              <button className="ghostbtn text-[12px] text-muted p-0 ml-auto" onClick={() => { setLastTake(null); setWatching(false); }}>Dismiss</button>
              {watching && lastTake.take?.url && (
                <video key={lastTake.take.id} className="basis-full w-full max-w-[420px] rounded-md bg-ink mt-[4px]" src={lastTake.take.url} controls autoPlay />
              )}
            </div>
          )}
          <p className="text-faint text-[11.5px] m-[6px_0_0]">Space records and stops · ← → change line · keep this window at the top of the screen, under your camera.</p>

          <div className="flex flex-wrap gap-[8px] mt-[10px]">
            <select className="text-[12px] max-w-[260px]" value={cam} aria-label="Camera" onChange={(e) => setCam(e.target.value)}>
              <option value="">Default camera</option>
              {devices.video.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
            </select>
            <select className="text-[12px] max-w-[260px]" value={mic} aria-label="Microphone" onChange={(e) => setMic(e.target.value)}>
              <option value="">Default microphone</option>
              {devices.audio.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <b className="text-[13px]">Lines</b>
            <span className="text-muted text-[12px]">{done} of {lines.length} recorded</span>
          </div>
          <ol className="list-none p-0 m-[8px_0_0] max-h-[440px] overflow-y-auto border border-solid border-line rounded-lg">
            {lines.map((l, i) => {
              const chosen = l.takes.find((t) => t.chosen);
              return (
                <li key={l.segmentId} className={'[&+&]:[border-top:1px_solid_var(--line)] ' + (i === at ? 'bg-accent-soft' : '')}>
                  <button type="button" disabled={state !== 'idle'} onClick={() => { setAt(i); setOpen(open === l.segmentId ? null : l.segmentId); }}
                    className="w-full grid grid-cols-[24px_1fr_auto] gap-[8px] items-start text-left p-[7px_10px] bg-transparent [border:0] rounded-none">
                    <code className="text-[11px] text-faint pt-[1px]">{String(l.n).padStart(2, '0')}</code>
                    <span className="text-[12.5px] leading-[1.4] line-clamp-2">{l.text}</span>
                    <span className={'text-[11px] font-semibold whitespace-nowrap ' + (l.takes.length ? 'text-ok' : 'text-faint')}>
                      {l.takes.length ? <><Check size={11} className="inline" /> {l.takes.length}</> : '—'}
                    </span>
                  </button>
                  {open === l.segmentId && (
                    <div className="p-[0_10px_10px_42px] flex flex-col gap-[6px]">
                      {chosen && <video key={chosen.id} className="w-full rounded-md bg-ink" controls preload="metadata"
                        src={`${chosen.url}#t=${chosen.inPoint.toFixed(2)},${chosen.outPoint.toFixed(2)}`} />}
                      {l.takes.map((t) => (
                        <div key={t.id} className="flex items-center gap-[6px] text-[12px]">
                          <span className={t.chosen ? 'font-semibold text-ink' : 'text-muted'}>Take {t.version}</span>
                          <span className="text-faint">{clock(t.outPoint - t.inPoint)} · {t.source === 'split' ? 'from recording' : t.source}</span>
                          {t.outdated && <span className="text-warn" title="The line's words changed after this take">older wording</span>}
                          {t.missing && <span className="text-danger">file missing</span>}
                          <span className="ml-auto flex gap-[4px]">
                            {!t.chosen && <button className="text-[11.5px] p-[2px_7px]" onClick={() => choose(t)}><Play size={11} /> Use</button>}
                            <button className="ghostbtn p-[3px] text-faint hover:text-danger" aria-label={`Discard take ${t.version}`} onClick={() => discard(t)}><Trash2 size={13} /></button>
                          </span>
                        </div>
                      ))}
                      <UploadDrop compact label="Upload a take for this line"
                        upload={(f, p) => api.uploadLineTake(production.id, l.segmentId, f, p, 'upload')} onDone={() => load()} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <section className="mt-[18px]">
        {!showUpload && split?.state !== 'running' && !split ? (
          <button className="ghostbtn text-[12.5px] text-accent p-0" onClick={() => setShowUpload(true)}>
            <Upload size={13} /> Recorded it on your phone or camera instead? Upload the whole recording
          </button>
        ) : <b className="text-[13px]">Recorded it somewhere else?</b>}
        {(showUpload || split) && (split?.state === 'running' ? (
          <p className="text-[12.5px] text-warn m-[6px_0_0]"><RefreshCw size={12} className="inline animate-spin" /> {split.step}…</p>
        ) : (
          <div className="mt-[6px]">
            <UploadDrop label="Upload the whole recording"
              hint="Phone, camera or screen — read the script straight through, retakes and all. It's matched to the script by what you said; each line gets a take, and where you said a line twice, the last reading is used."
              upload={(f, p) => api.splitRecording(production.id, f, p)} onDone={() => load()} />
          </div>
        ))}
        {split?.state === 'done' && (
          <p className="text-[12.5px] m-[6px_0_0] text-ink-2">
            Split {split.name ? `"${split.name}"` : 'your recording'}: found {split.found} of {split.lines} lines
            {split.missing?.length ? <span className="text-warn"> — not found: line {split.missing.join(', ')}</span> : ''}.
          </p>
        )}
        {split?.state === 'failed' && <p className="text-[12.5px] text-danger m-[6px_0_0]">{split.error}</p>}
      </section>

      {done === lines.length && (
        <div className="notice mt-[16px]"><Check /> <span>Every line has a take. Next: Edit, to tighten and assemble them (or take the kit to CapCut).</span>
          <button className="ml-auto" onClick={() => goToStage?.('Edit')}>Go to Edit</button></div>
      )}
    </div>
  );
}
