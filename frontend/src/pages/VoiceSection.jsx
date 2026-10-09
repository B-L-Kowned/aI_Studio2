import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Check, AlertCircle, RefreshCw, Mic, Play, Upload, Plus, Trash2 } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Modal } from '../components/Dialog.jsx';

const H2 = 'm-[0_0_4px]';
const SUBHEAD = 'text-[11px] tracking-[.07em] text-faint font-[600] m-[26px_0_8px] uppercase';
const CARD = 'border border-solid border-line rounded-lg p-[14px_16px] bg-surface [&+&]:mt-[10px]';
const SLIDER = 'grid grid-cols-[minmax(0,1fr)_104px] items-center gap-[10px]';
const SLIDER_LABEL = 'block text-[12px] text-ink-2 mb-[4px]';

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
  const [switching, setSwitching] = useState(false);
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
      <p className="muted" title="Auditions are free in every mode, and the take you approve is the audio the video uses. Cast it on a presenter in Cast.">
        Your voice, made on this Mac — free, and the take you approve is what the video uses.
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

      <div className="flex items-center gap-[10px] m-[26px_0_8px]">
        <span className="text-[11px] tracking-[.07em] text-faint font-[600] uppercase">Voices</span>
        <button type="button" className="ml-auto text-[12px] p-[4px_11px]" onClick={() => setSwitching(true)}>Switch voice…</button>
      </div>
      {switching && <SwitchVoice local={data?.voices ?? []} onClose={() => setSwitching(false)} />}
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
          {voice.naturalWpm ? ` · natural pace ${voice.naturalWpm} wpm` : ''}
        </span>
        {dirty && <button className="primary ml-auto text-[12px] p-[4px_12px]" onClick={save}>Save delivery</button>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-[14px_28px] mt-[12px] lte860:grid-cols-[1fr]">
        {/* How it sounds */}
        <div className="grid gap-[12px] content-start">
          <label>
            <span className={SLIDER_LABEL}>Expressiveness <small className="text-faint">calm ↔ animated</small></span>
            <span className={SLIDER}>
              <input type="range" min="0.25" max="1" step="0.05" value={exaggeration}
                onChange={(e) => setExaggeration(Number(e.target.value))} aria-label="Expressiveness" />
              <code className="text-[11.5px] text-muted text-right">{exaggeration.toFixed(2)}</code>
            </span>
          </label>
          <label>
            <span className={SLIDER_LABEL}>Speed <small className="text-faint">default for every video · 1× = natural</small></span>
            <span className={SLIDER}>
              <input type="range" min="0.75" max="1.25" step="0.01" value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed" />
              <code className="text-[11.5px] text-muted text-right">{speed.toFixed(2)}×{voice.naturalWpm ? ` · ${Math.round(voice.naturalWpm * speed)}` : ''}</code>
            </span>
          </label>
          {advanced && (
            <label>
              <span className={SLIDER_LABEL}>Steadiness <small className="text-faint">looser ↔ steadier</small></span>
              <span className={SLIDER}>
                <input type="range" min="0" max="1" step="0.05" value={cfgWeight}
                  onChange={(e) => setCfgWeight(Number(e.target.value))} aria-label="Steadiness" />
                <code className="text-[11.5px] text-muted text-right">{cfgWeight.toFixed(2)}</code>
              </span>
            </label>
          )}
          <button type="button" className="ghostbtn justify-self-start text-[11.5px] text-muted p-0" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? 'Hide' : 'Show'} advanced
          </button>
        </div>

        {/* Hear it */}
        <div className="grid gap-[8px] content-start">
          <span className={SLIDER_LABEL}>Hear it</span>
          <div className="flex gap-[8px]">
            <input className="flex-1 min-w-0" placeholder="A sentence to try (optional)" value={text} onChange={(e) => setText(e.target.value)} />
            <button onClick={speak} disabled={!ready || speaking}>
              <Play size={13} /> {speaking ? 'Speaking…' : 'Play'}
            </button>
          </div>
          {sample && <audio className="w-full" src={sample} controls autoPlay />}
          <p className="text-faint text-[11px] m-0">
            Changes affect future takes only; approved takes keep their audio. Each video can set its own speed on its Script screen.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Switch the voice your personas speak in: your local clones (free) and, once
 * the account can be read, your own HeyGen voices. Applies to every persona at
 * once; a single persona can still differ under Cast → Edit → Look & voice.
 */
function SwitchVoice({ local, onClose }) {
  const { mutate, notify } = useStudio();
  const [heygen, setHeygen] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [pick, setPick] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.providerAssets('heygen', { kind: 'voice', pool: 'mine', limit: 100 }).then((r) => setHeygen(r.items ?? [])).catch(() => setHeygen([]));
    api.presenters().then((r) => {
      const list = r?.tabs?.find((t) => t.id === 'personal')?.presenters ?? [];
      setPersonas(list);
      setPick(list[0]?.voice?.id ?? null);
    }).catch(() => {});
  }, []);
  const current = personas[0]?.voice?.id ?? null;
  const apply = async () => {
    setSaving(true);
    try {
      for (const p of personas) await mutate(() => api.castPresenter(p.id, { voiceAssetId: pick }), null, { silent: true });
      notify(`All ${personas.length} personas now speak in this voice.`, 'ok');
      onClose();
    } catch { /* reported */ } finally { setSaving(false); }
  };
  const OPTION = (on) => 'flex items-center gap-[10px] w-full text-left p-[9px_11px] rounded-lg border border-solid ' + (on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-2');
  const row = (v, sub) => (
    <button key={v.id} type="button" className={OPTION(pick === v.id)} onClick={() => setPick(v.id)}>
      <span className="min-w-0 flex-1"><b className="block text-[13px] font-[560] text-ink truncate">{v.name}</b><span className="block text-[11.5px] text-muted">{sub}</span></span>
      {current === v.id && <span className="text-[11px] text-ok font-[600]">In use</span>}
    </button>
  );
  return (
    <Modal title="Switch voice" width={520} onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!pick || pick === current || saving} onClick={apply}>{saving ? 'Switching…' : `Use for all ${personas.length} personas`}</button></>}>
      <p className="m-[0_0_10px] text-[12.5px] text-muted">The voice every persona speaks in. Takes already approved keep their audio; new takes use this voice.</p>
      <p className="m-[0_0_6px] text-[11px] font-[600] tracking-[.06em] uppercase text-faint">On this Mac · free</p>
      <div className="grid gap-[6px]">{local.map((v) => row(v, `${v.referenceSeconds ?? '?'}s sample · ${v.naturalWpm ?? '—'} wpm`))}</div>
      <p className="m-[14px_0_6px] text-[11px] font-[600] tracking-[.06em] uppercase text-faint">Your HeyGen voices · uses credits</p>
      {heygen === null ? <p className="m-0 text-[12.5px] text-muted">Loading…</p>
        : heygen.length ? <div className="grid gap-[6px] max-h-[220px] overflow-auto">{heygen.map((v) => row(v, [v.language, v.gender].filter(Boolean).join(' · ') || 'HeyGen voice'))}</div>
        : <p className="m-0 text-[12.5px] text-muted">None read yet. Your HeyGen voices appear here once Generation is set to Test or Live, so the studio may read your account.</p>}
      <p className="m-[12px_0_0] text-[11.5px] text-faint">To add another free voice, record one under “New voice from a recording” below.</p>
    </Modal>
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
  const [made, setMade] = useState({});            // id → clip already made (plays at once)
  const [show, setShow] = useState('todo');         // todo | done | all
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [sayAs, setSayAs] = useState('');
  const [playing, setPlaying] = useState(null);     // id
  const [busy, setBusy] = useState(null);           // id being made
  const player = useRef(null);
  const load = useCallback(() => api.pronunciations().then(setRows).catch(() => setRows([])), []);
  const loadMade = useCallback(() => api.pronunciationsReady(voiceId).then(setMade).catch(() => {}), [voiceId]);
  useEffect(() => { load(); }, [load]);
  // Make every term in the background so Hear plays at once; check progress meanwhile.
  useEffect(() => {
    if (!ready || !voiceId) return undefined;
    api.warmPronunciations(voiceId).catch(() => {});
    loadMade();
    const t = setInterval(loadMade, 6000);
    return () => clearInterval(t);
  }, [ready, voiceId, loadMade]);
  useEffect(() => () => player.current?.pause(), []);

  const save = async (p) => { try { await mutate(() => api.savePronunciation(p), null, { silent: true }); await load(); loadMade(); } catch { /* reported */ } };
  const hear = async (r) => {
    const a = player.current ?? (player.current = new Audio());
    if (playing === r.id) { a.pause(); setPlaying(null); return; }
    a.pause();
    setBusy(r.id);
    try {
      const res = await mutate(() => api.hearPronunciation(r.id, voiceId), null, { silent: true });
      a.src = res.data.url;
      a.onended = () => setPlaying(null);
      setPlaying(r.id);
      setMade((m) => ({ ...m, [r.id]: true }));
      await a.play();
    } catch { setPlaying(null); } finally { setBusy(null); }
  };
  if (!rows) return null;

  const todo = rows.filter((r) => !r.checked);
  const ql = q.trim().toLowerCase();
  const list = (show === 'todo' ? todo : show === 'done' ? rows.filter((r) => r.checked) : rows)
    .filter((r) => !ql || r.term.toLowerCase().includes(ql) || r.sayAs.toLowerCase().includes(ql));
  const madeCount = rows.filter((r) => made[r.id]).length;

  return (
    <section className="mt-[26px]">
      <div className="flex flex-wrap items-center gap-[10px] mb-[10px]">
        <h3 className="m-0 text-[15px] font-[600]">Pronunciation</h3>
        <span className="flex gap-[4px]" role="group" aria-label="Show">
          {[['todo', 'To check', todo.length], ['done', 'Checked', rows.length - todo.length], ['all', 'All', rows.length]].map(([id, label, n]) => (
            <button key={id} type="button" onClick={() => setShow(id)}
              className={'text-[12px] p-[3px_10px] rounded-full ' + (show === id ? 'bg-ink text-white border-ink' : 'bg-surface')}>
              {label} <span className={show === id ? 'opacity-70' : 'text-faint'}>{n}</span>
            </button>
          ))}
        </span>
        {ready && madeCount < rows.length && (
          <span className="text-[11.5px] text-faint flex items-center gap-[5px]"><RefreshCw size={11} className="animate-spin" /> Preparing clips · {madeCount} of {rows.length} ready</span>
        )}
        <input className="ml-auto w-[200px] text-[12.5px] p-[5px_9px]" placeholder="Search terms…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="border border-solid border-line rounded-lg bg-surface overflow-hidden">
        {list.length === 0 && (
          <p className="m-0 p-[16px] text-[12.5px] text-muted">
            {show === 'todo' ? <><Check size={13} className="inline -mt-[2px] text-ok" /> Every term has been checked by ear.</> : 'Nothing here.'}
          </p>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(460px,1fr))] overflow-hidden">
          {list.map((r) => {
            const on = playing === r.id;
            return (
              <div key={r.id} className="group grid grid-cols-[30px_minmax(0,1fr)_14px_minmax(0,1.1fr)_auto] gap-[10px] items-center p-[8px_14px] [box-shadow:1px_0_0_var(--line),0_1px_0_var(--line)]">
                <button type="button" onClick={() => hear(r)} disabled={!ready || !voiceId || busy === r.id}
                  aria-label={`Hear ${r.term}`} title={made[r.id] ? 'Plays at once' : 'Being made — a few seconds'}
                  className={'w-[28px] h-[28px] p-0 rounded-full grid place-items-center border border-solid '
                    + (on ? 'bg-ink border-ink text-white' : 'bg-surface border-line text-ink hover:border-ink')}>
                  {busy === r.id ? <RefreshCw size={12} className="animate-spin" /> : on ? <span className="w-[9px] h-[9px] bg-white rounded-[1px]" /> : <Play size={12} className="ml-[1px]" />}
                </button>
                <span className="min-w-0">
                  <b className="block truncate text-[13.5px] font-[600] text-ink">{r.term}</b>
                  {r.note && <small className="block truncate text-faint text-[11px]" title={r.note}>{r.note}</small>}
                </span>
                <span className="text-faint text-[12px]" aria-hidden="true">→</span>
                {/* Reads as text; becomes a field on hover or focus. */}
                <input className="min-w-0 text-[13px] p-[5px_8px] bg-transparent border-transparent hover:border-line focus:bg-surface text-ink-2"
                  defaultValue={r.sayAs} aria-label={`Say ${r.term} as`}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.sayAs && save({ term: r.term, sayAs: e.target.value.trim() })} />
                <span className="flex items-center gap-[4px]">
                  {r.checked ? (
                    <button type="button" className="ghostbtn p-[3px_8px] text-[12px] text-ok" title="Checked by ear — click to undo"
                      onClick={() => save({ term: r.term, sayAs: r.sayAs, checked: false })}><Check size={13} /> Checked</button>
                  ) : (
                    <button type="button" className="text-[12px] p-[3px_9px]" title="It sounds right"
                      onClick={() => save({ term: r.term, sayAs: r.sayAs, checked: true })}>Sounds right</button>
                  )}
                  <button className="ghostbtn p-[5px] text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger" aria-label={`Remove ${r.term}`}
                    onClick={async () => { try { await mutate(() => api.deletePronunciation(r.id), null, { silent: true }); await load(); } catch { /* reported */ } }}>
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <form className="flex gap-[8px] flex-wrap items-center p-[10px_14px] bg-surface-2 [border-top:1px_solid_var(--line)]"
          onSubmit={async (e) => { e.preventDefault(); if (!term.trim() || !sayAs.trim()) return; await save({ term: term.trim(), sayAs: sayAs.trim() }); setTerm(''); setSayAs(''); }}>
          <Plus size={14} className="text-faint" />
          <input className="flex-1 min-w-[140px] text-[13px]" placeholder="Word as written, e.g. Bialko" value={term} onChange={(e) => setTerm(e.target.value)} />
          <span className="text-faint text-[12px]">→</span>
          <input className="flex-1 min-w-[140px] text-[13px]" placeholder="How it sounds, e.g. Bee-AL-ko" value={sayAs} onChange={(e) => setSayAs(e.target.value)} />
          <button type="submit" disabled={!term.trim() || !sayAs.trim()}>Add</button>
        </form>
      </div>
      <p className="m-[8px_0_0] text-[11.5px] text-faint">Spell it how it sounds — hyphens between beats, capitals on the stressed one. Every video uses these.</p>
    </section>
  );
}
