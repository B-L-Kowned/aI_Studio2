import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Check, AlertCircle, RefreshCw, Mic, Play, Upload, Plus, Trash2 } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';

const H2 = 'm-[0_0_4px]';
const SUBHEAD = 'text-[11px] tracking-[.07em] text-faint font-[600] m-[26px_0_8px] uppercase';
const CARD = 'border border-solid border-line rounded-lg p-[14px_16px] bg-surface [&+&]:mt-[10px]';
const SLIDER_ROW = 'grid grid-cols-[150px_1fr_44px] items-center gap-[12px] mt-[10px] lte860:grid-cols-[1fr_44px]';

/**
 * Your voice, made on this computer. The audition IS the shipping audio, so
 * approving a local take approves exactly what the video will say — and it
 * costs nothing, in every mode.
 */
export default function VoiceSection() {
  const { mutate } = useStudio();
  const [data, setData] = useState(null);
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const picker = useRef(null);

  const load = useCallback(() => api.localVoices().then(setData).catch(() => setData({ voices: [], service: null })), []);
  useEffect(() => { load(); }, [load]);

  const service = data?.service;
  const ready = service?.reachable && service?.loaded;

  const create = async (e) => {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setBusy(true);
    try {
      await mutate(() => api.createLocalVoice(name.trim(), file), null);
      setFile(null); setName('');
      await load();
    } catch { /* mutate reports it */ }
    finally { setBusy(false); }
  };

  return (
    <>
      <h2 className={H2}>Your voice</h2>
      <p className="muted">
        A copy of your voice that runs on this computer. Auditions in it are free in every
        mode, and the take you approve is the audio the video uses. Cast it on a presenter in Cast.
      </p>

      <div className={'notice ' + (ready ? '' : 'warn')}>
        {ready ? <Check /> : <AlertCircle />}
        <span>
          <b>Voice engine:</b>{' '}
          {!data ? 'checking…'
            : !service?.reachable ? 'not running — start it with pm2 start ecosystem.config.js --only ai-video-voice'
            : !service.loaded ? (service.error ?? 'loading the model (about 40 seconds)…')
            : `ready on ${service.device === 'mps' ? 'this Mac’s GPU' : 'the CPU'}${service.busy ? ' · speaking now' : ''}`}
        </span>
        <button onClick={load}><RefreshCw size={13} /> Re-check</button>
      </div>

      <div className={SUBHEAD}>Voices</div>
      {data?.voices?.length === 0 && <p className="muted">No voice yet — add a recording below.</p>}
      {data?.voices?.map((v) => <VoiceCard key={v.id} voice={v} ready={ready} onSaved={load} />)}

      <Pronunciations voiceId={data?.voices?.[0]?.id} ready={ready} />

      <div className={SUBHEAD}>New voice from a recording</div>
      <form className={CARD} onSubmit={create}>
        <p className="text-muted text-[12px] m-[0_0_10px]">
          10–30 seconds of you speaking normally, one voice, no music. A phone voice memo is fine;
          a raw recording beats a clip that was itself generated.
        </p>
        <div className="flex gap-[8px] flex-wrap items-center">
          <input className="flex-1 min-w-[180px]" placeholder="Name, e.g. Pat — studio mic" value={name}
            onChange={(e) => setName(e.target.value)} />
          <button type="button" onClick={() => picker.current?.click()}>
            <Upload size={13} /> {file ? file.name : 'Choose recording'}
          </button>
          <input ref={picker} type="file" accept="audio/*,video/*" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="primary" type="submit" disabled={!file || !name.trim() || busy}>
            <Mic size={13} /> {busy ? 'Creating…' : 'Create voice'}
          </button>
        </div>
      </form>
    </>
  );
}

function VoiceCard({ voice, ready, onSaved }) {
  const { mutate } = useStudio();
  const [exaggeration, setExaggeration] = useState(voice.exaggeration);
  const [cfgWeight, setCfgWeight] = useState(voice.cfgWeight);
  const [speed, setSpeed] = useState(voice.speed ?? 1);
  const [advanced, setAdvanced] = useState(false);
  const [text, setText] = useState('');
  const [sample, setSample] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const dirty = exaggeration !== voice.exaggeration || cfgWeight !== voice.cfgWeight || speed !== (voice.speed ?? 1);

  const save = async () => {
    try {
      await mutate(() => api.updateLocalVoice(voice.id, { exaggeration, cfgWeight, speed }), null);
      onSaved();
    } catch { /* reported */ }
  };
  const speak = async () => {
    setSpeaking(true);
    try {
      if (dirty) await api.updateLocalVoice(voice.id, { exaggeration, cfgWeight, speed });
      const r = await mutate(() => api.sampleLocalVoice(voice.id, text.trim()), null);
      setSample(r?.data?.url ?? null);
      if (dirty) onSaved();
    } catch { /* reported */ }
    finally { setSpeaking(false); }
  };

  return (
    <div className={CARD}>
      <div className="flex items-baseline gap-[10px] flex-wrap">
        <b className="text-[13.5px]">{voice.name}</b>
        <span className="text-faint text-[11.5px]">
          from {voice.referenceSeconds ?? '?'}s of audio · local · free
          {voice.naturalWpm ? ` · natural pace ${voice.naturalWpm} wpm (measured over ${Math.round(voice.paceSeconds)}s)` : ''}
        </span>
      </div>

      <div className={SLIDER_ROW}>
        <span className="text-[12px] text-ink-2 lte860:col-span-2">Expressiveness <small className="text-faint">calm ↔ animated</small></span>
        <input type="range" min="0.25" max="1" step="0.05" value={exaggeration}
          onChange={(e) => setExaggeration(Number(e.target.value))} aria-label="Expressiveness" />
        <code className="text-[11.5px] text-muted text-right">{exaggeration.toFixed(2)}</code>
      </div>
      <div className={SLIDER_ROW}>
        <span className="text-[12px] text-ink-2 lte860:col-span-2">Speed <small className="text-faint">default for every video · 1× = natural</small></span>
        <input type="range" min="0.75" max="1.25" step="0.01" value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed" />
        <code className="text-[11.5px] text-muted text-right">
          {speed.toFixed(2)}×{voice.naturalWpm ? <span className="block">{Math.round(voice.naturalWpm * speed)} wpm</span> : null}
        </code>
      </div>
      <button type="button" className="ghostbtn text-[11.5px] text-muted p-[2px_0] mt-[6px]" onClick={() => setAdvanced((v) => !v)}>
        {advanced ? 'Hide' : 'Show'} advanced
      </button>
      {advanced && (
        <div className={SLIDER_ROW}>
          <span className="text-[12px] text-ink-2 lte860:col-span-2">Steadiness <small className="text-faint">looser ↔ steadier</small></span>
          <input type="range" min="0" max="1" step="0.05" value={cfgWeight}
            onChange={(e) => setCfgWeight(Number(e.target.value))} aria-label="Steadiness" />
          <code className="text-[11.5px] text-muted text-right">{cfgWeight.toFixed(2)}</code>
        </div>
      )}

      <div className="flex gap-[8px] flex-wrap items-center mt-[12px]">
        <input className="flex-1 min-w-[220px]" placeholder="Test sentence (optional)" value={text}
          onChange={(e) => setText(e.target.value)} />
        <button onClick={speak} disabled={!ready || speaking}>
          <Play size={13} /> {speaking ? 'Speaking… (~20s)' : 'Hear it'}
        </button>
        {dirty && <button className="primary" onClick={save}>Save delivery</button>}
      </div>
      {sample && <audio className="w-full mt-[10px]" src={sample} controls autoPlay />}
      <p className="text-faint text-[11px] m-[8px_0_0]">
        Changing delivery affects future auditions only; takes you already approved keep their audio.
        Each video can set its own speed on its Script screen to fit its target length.
      </p>
    </div>
  );
}

/**
 * How names are SAID. The script keeps "Bialkowned"; only what the voice is
 * given changes. Changing a pronunciation un-checks it — the tick was for a
 * different sound.
 */
function Pronunciations({ voiceId, ready }) {
  const { mutate } = useStudio();
  const [rows, setRows] = useState(null);
  const [term, setTerm] = useState('');
  const [sayAs, setSayAs] = useState('');
  const [playing, setPlaying] = useState(null); // { id, url }
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => api.pronunciations().then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const save = async (p) => { try { await mutate(() => api.savePronunciation(p), null, { silent: true }); await load(); } catch { /* reported */ } };
  const hear = async (id) => {
    setBusy(id);
    try {
      const r = await mutate(() => api.hearPronunciation(id, voiceId), null, { silent: true });
      setPlaying({ id, url: r?.data?.url });
    } catch { /* reported */ } finally { setBusy(null); }
  };
  if (!rows) return null;
  const unchecked = rows.filter((r) => !r.checked).length;

  return (
    <>
      <div className={SUBHEAD}>Pronunciation · {rows.length} terms{unchecked ? ` · ${unchecked} not yet checked by ear` : ' · all checked'}</div>
      <div className={CARD + ' p-0 overflow-hidden'}>
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[minmax(130px,1fr)_minmax(150px,1.2fr)_auto_auto_auto] gap-[10px] items-center p-[7px_14px] [&+&]:[border-top:1px_solid_var(--line)] lte860:grid-cols-[1fr_auto]">
            <span className="min-w-0">
              <b className="block truncate text-[13px] font-[560]">{r.term}</b>
              {r.note && <small className="block truncate text-faint text-[11px]" title={r.note}>{r.note}</small>}
            </span>
            <input className="text-[12.5px] p-[6px_9px] lte860:col-span-2" defaultValue={r.sayAs} aria-label={`Say ${r.term} as`}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.sayAs && save({ term: r.term, sayAs: e.target.value.trim() })} />
            <button onClick={() => hear(r.id)} disabled={!ready || !voiceId || busy === r.id} title="Say it in your voice">
              <Play size={12} /> {busy === r.id ? '…' : 'Hear'}
            </button>
            <label className="flex items-center gap-[5px] text-[12px] text-ink-2 cursor-pointer">
              <input type="checkbox" checked={r.checked} onChange={(e) => save({ term: r.term, sayAs: r.sayAs, checked: e.target.checked })} /> Checked
            </label>
            <button className="ghostbtn p-[5px] text-faint" aria-label={`Remove ${r.term}`}
              onClick={async () => { try { await mutate(() => api.deletePronunciation(r.id), null, { silent: true }); await load(); } catch { /* reported */ } }}>
              <Trash2 size={13} />
            </button>
            {playing?.id === r.id && playing.url && <audio className="col-span-full w-full" src={playing.url} controls autoPlay />}
          </div>
        ))}
        <form className="flex gap-[8px] flex-wrap p-[10px_14px] bg-surface-2 [border-top:1px_solid_var(--line)]"
          onSubmit={async (e) => { e.preventDefault(); if (!term.trim() || !sayAs.trim()) return; await save({ term: term.trim(), sayAs: sayAs.trim() }); setTerm(''); setSayAs(''); }}>
          <input className="flex-1 min-w-[140px]" placeholder="Word as written, e.g. Bialko" value={term} onChange={(e) => setTerm(e.target.value)} />
          <input className="flex-1 min-w-[140px]" placeholder="Say it as, e.g. Bee-AL-ko" value={sayAs} onChange={(e) => setSayAs(e.target.value)} />
          <button type="submit" disabled={!term.trim() || !sayAs.trim()}><Plus size={13} /> Add</button>
        </form>
      </div>
    </>
  );
}
