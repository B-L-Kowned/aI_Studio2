import React, { useState, useEffect, useCallback } from 'react';
import { Play, Scissors, Lock, AlertCircle, Check, Download, FolderOpen, Wand2, RefreshCw, Film } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { toSeconds, toClock } from '../utils/format.js';
import { api } from '../services/api.js';
import { useResource } from '../hooks/use-resource.js';
import LoadState from '../components/LoadState.jsx';
import { madeByOf, needsRender } from '../utils/made-by.js';
import HeyGenLook from '../components/HeyGenLook.jsx';
import UploadDrop from '../components/UploadDrop.jsx';
import PaidConfirm from '../components/PaidConfirm.jsx';

const SUPPORTED = new Set(['Trim / Cut', 'Create Short Clip']);
const KIT_LINK = 'inline-flex items-center gap-[6px] text-[12.5px] p-[6px_11px] rounded-md border border-solid border-line bg-surface text-ink no-underline hover:border-line-2';
const KIT_OFF = 'inline-flex items-center gap-[6px] text-[12.5px] p-[6px_11px] rounded-md border border-dashed border-line text-faint cursor-not-allowed';
const KIT_SUB = 'text-[10.5px] tracking-[.07em] uppercase text-faint font-semibold m-[14px_0_6px]';
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Everything the edit needs, on one clock: the approved audio, the script and
 * subtitles, the shot list with your screen recordings, and for HeyGen the
 * render and each line's clip. "Save to folder" puts it all in the video's own
 * folder with a timeline that already points at every file.
 */
function EditorKit({ production }) {
  const { mutate } = useStudio();
  const [kit, setKit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const load = useCallback(() => api.editorKit(production.id).then(setKit).catch(() => setKit(null)), [production.id]);
  useEffect(() => { load(); }, [load]);
  if (!kit) return null;

  const url = (f) => api.editorKitUrl(production.id, f);
  const link = (on, file, label, title) => (on
    ? <a className={KIT_LINK} href={url(file)} download title={title}><Download size={13} /> {label}</a>
    : <span className={KIT_OFF} title={title}><Download size={13} /> {label}</span>);
  const heygen = kit.madeBy === 'heygen';
  const save = async () => {
    setSaving(true);
    try {
      const r = await mutate(() => api.saveEditorKit(production.id), null);
      setSaved(r.data);
      load();
    } catch { /* mutate reports it */ } finally { setSaving(false); }
  };
  const folder = saved?.path ?? kit.folder;

  return (
    <section className="border border-solid border-line rounded-lg bg-surface p-[14px_16px] mt-[12px]" aria-label="Editor kit">
      <div className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[4px]">
        <b className="text-[13.5px]">Editor kit</b>
        <span className="text-muted text-[12px]">
          {kit.lines
            ? <>{kit.approved} of {kit.lines} lines with approved audio{kit.allApproved ? ` · ${clock(kit.seconds)}` : ''}
              {' · '}{kit.recordings} of {kit.sections} sections with a screen recording</>
            : 'No script yet'}
        </span>
      </div>

      <div className={KIT_SUB}>Everything in one folder</div>
      <div className="flex flex-wrap items-center gap-[8px]">
        <button className="primary text-[12.5px] p-[6px_12px]" onClick={save} disabled={saving || !kit.lines}>
          <FolderOpen size={13} /> {saving ? 'Saving…' : folder ? 'Update the kit folder' : 'Save kit to folder'}
        </button>
        {folder && <button className="text-[12.5px] p-[6px_12px]" onClick={() => mutate(() => api.revealEditorKit(production.id), null, { silent: true }).catch(() => {})}>Open folder</button>}
      </div>
      {folder && <p className="text-muted text-[11.5px] m-[6px_0_0] break-all">{folder}</p>}
      <p className="text-faint text-[11.5px] m-[6px_0_0]">
        Audio, script, subtitles, shot list and recordings{heygen ? ', the HeyGen render and a clip per line' : ''}, plus a
        {' '}<b className="font-[560]">timeline.fcpxml</b> with them laid out — it opens in DaVinci Resolve or Final Cut.
        {!kit.allApproved && ' The timeline and full read need every line approved in Segments.'}
      </p>

      <div className={KIT_SUB}>Or download for CapCut / Descript</div>
      <div className="flex flex-wrap gap-[8px]">
        {heygen && link(!!kit.render, 'render.mp4', kit.render?.standIn ? 'Render (stand-in) .mp4' : 'HeyGen render (.mp4)',
          kit.render ? `Render v${kit.render.version}` : 'Render the video first')}
        {link(kit.allApproved, 'full-read.wav', 'Full read (.wav)', kit.allApproved ? 'Every line in order, one file' : 'Approve the audio for every line in Segments first')}
        {link(kit.approved > 0, 'lines.zip', `Each line (${kit.approved} .wav, zip)`, 'One wav per approved line, numbered in script order')}
        {link(kit.lines > 0, 'script.srt', 'Subtitles (.srt)', kit.timedTo === 'audio' ? 'Timed to the full read' : `Estimated at ${kit.wpm} wpm`)}
        {link(kit.lines > 0, 'script.txt', 'Script (.txt)', 'Plain text, one line per paragraph')}
        {link(kit.sections > 0, 'shot-list.csv', 'Shot list (.csv)', 'Each section: when it starts, the shot, on-screen text, which recording')}
      </div>
      <p className="text-faint text-[11.5px] m-[8px_0_0]">
        {kit.timedTo === 'audio'
          ? `Subtitles and shot list are timed to the full read${heygen ? ' — the render is lip-synced to it, so they match the render too' : ''}; drop everything in at 0:00.`
          : `Times are estimated at ${kit.wpm} words a minute until every line has approved audio.`}
      </p>
    </section>
  );
}

const CHIP_ON = 'text-[11.5px] p-[2px_8px] rounded-full border border-solid cursor-pointer bg-warn-soft text-warn border-warn-line line-through decoration-[1.5px]';
const CHIP_OFF = 'text-[11.5px] p-[2px_8px] rounded-full border border-solid cursor-pointer bg-surface text-muted border-line';
const KIND = { filler: 'filler', gap: 'pause', head: 'start', tail: 'end' };
const secs = (n) => `${n.toFixed(1)}s`;

/**
 * Your recording, re-performed by your HeyGen avatar: the cleaned-up sound of
 * your takes (fillers cut, pauses tightened) drives the avatar you choose. It
 * renders on your HeyGen plan, so it asks before spending.
 */
function AvatarFromRecording({ production, onFinished }) {
  const { mutate } = useStudio();
  const [path, setPath] = useState(null);
  const [render, setRender] = useState(null);
  const [showLook, setShowLook] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const load = useCallback(() => api.render(production.id).then(setRender).catch(() => {}), [production.id]);
  useEffect(() => { load(); api.heygenStatus().then((h) => setPath(h.renderPath)).catch(() => setPath(null)); }, [load]);
  const latest = render?.latest;
  const moving = latest && ['queued', 'processing'].includes(latest.status);
  useEffect(() => {
    if (!moving) return undefined;
    const t = setTimeout(load, 1500);
    return () => clearTimeout(t);
  }, [moving, render, load]);

  const start = async () => {
    setStarting(true); setConfirming(false);
    try { await mutate(() => api.startRender(production.id, true, { fromRecording: true }), (r) => setRender(r.data)); }
    catch { /* mutate reports it */ } finally { setStarting(false); }
  };
  const playable = latest?.videoUrl && /^https?:|^\/api\//.test(latest.videoUrl);

  return (
    <section className="border border-solid border-line rounded-lg bg-surface p-[12px_14px] mt-[10px]" aria-label="Avatar from your recording">
      <div className="flex flex-wrap items-baseline gap-x-[12px]">
        <b className="text-[13.5px]">Turn it into an avatar video</b>
        <span className="text-muted text-[12px]">Your avatar, speaking with your recorded voice — cleaned up as above. Renders on HeyGen.</span>
      </div>
      <div className="flex flex-wrap items-center gap-[10px] mt-[10px]">
        <button onClick={() => setShowLook((v) => !v)}>{showLook ? 'Hide' : 'Choose'} the avatar look</button>
        <button className="primary" disabled={starting || moving || path?.path === 'none'} title={path?.reason ?? ''}
          onClick={() => (path && !path.free ? setConfirming(true) : start())}>
          {starting ? 'Starting…' : 'Render with my avatar'}
        </button>
        {path && <span className="text-[12px] text-muted">{path.free ? 'Free here — ' : 'Charged to your plan — '}{path.reason}</span>}
      </div>
      {confirming && (
        <PaidConfirm title="This render is charged to your HeyGen plan." detail={path.reason}
          confirmLabel="Yes — render and charge my plan" busy={starting} onCancel={() => setConfirming(false)} onConfirm={start} />
      )}
      {showLook && <div className="mt-[14px]"><HeyGenLook /></div>}
      {latest && (
        <div className="mt-[12px] text-[12.5px]">
          <span className={latest.status === 'complete' ? 'text-ok' : latest.status === 'failed' ? 'text-danger' : 'text-warn'}>
            Render v{latest.version}: {latest.status}{moving ? ` ${latest.progress ?? 0}%` : ''}{latest.error ? ` — ${latest.error}` : ''}
          </span>
          {latest.status === 'complete' && (
            <div className="flex flex-wrap items-center gap-[10px] mt-[8px]">
              {playable ? <video className="w-[280px] rounded-md bg-ink" src={latest.videoUrl} controls preload="metadata" />
                : <span className="text-muted">Simulated render (fixtures mode) — a stand-in file is used.</span>}
              <button onClick={() => mutate(() => api.useRender(production.id), null).then(onFinished).catch(() => {})}>
                <Check size={14} /> Use as the finished video
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Finish a video you recorded (or narrated over screen recordings) without
 * leaving the app: listen for fillers and pauses, choose the take and the in
 * and out of each line, decide how it looks and sounds, preview, export. The
 * export is the finished video: it marks the video done and can be published.
 */
function FinishInApp({ production, goToStage }) {
  const { mutate } = useStudio();
  const [st, setSt] = useState(null);
  const [open, setOpen] = useState(null);
  const [tracks, setTracks] = useState([]);
  const player = React.useRef({});
  useEffect(() => { api.musicTracks().then(setTracks).catch(() => setTracks([])); }, []);
  const load = useCallback(() => api.editState(production.id).then(setSt).catch(() => {}), [production.id]);
  useEffect(() => { load(); }, [load]);
  const busy = st?.analysis?.state === 'running' || st?.job?.state === 'running';
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [busy, load]);
  if (!st) return null;

  const self = st.madeBy === 'self';
  const s = st.settings;
  const set = (patch) => mutate(() => api.saveEditSettings(production.id, patch), (r) => setSt(r.data), { silent: true }).catch(() => {});
  const act = (fn) => mutate(fn, (r) => setSt(r.data)).catch(() => {});
  const lines = st.lines ?? [];
  const chosen = (l) => l.takes.find((t) => t.chosen);
  const recorded = lines.filter(chosen).length;
  const cutsOn = lines.flatMap((l) => chosen(l)?.cuts ?? []).filter((c) => c.on);
  const saving = cutsOn.reduce((n, c) => n + (c.end - c.start), 0);
  const analyzed = lines.some((l) => chosen(l)?.analyzed);
  const toggle = (t, i, on) => mutate(() => api.toggleCut(production.id, t.id, i, on), (r) => setSt(r.data), { silent: true }).catch(() => {});
  const setPoint = (t, which) => {
    const v = player.current[t.id];
    if (!v) return;
    mutate(() => api.updateLineTake(production.id, t.id, { [which]: Number(v.currentTime.toFixed(2)) }), null, { silent: true }).then(load).catch(() => {});
  };
  // Most settings are on/off; look and reframe are stored by name.
  const NAMED = { look: ['auto', 'off'], reframe: ['face', 'center'] };
  const check = (key, label, title) => (
    <label className="flex items-center gap-[5px] text-[12.5px] cursor-pointer" title={title}>
      <input type="checkbox" checked={NAMED[key] ? s[key] === NAMED[key][0] : !!s[key]}
        onChange={(e) => set({ [key]: NAMED[key] ? NAMED[key][e.target.checked ? 0 : 1] : e.target.checked })} /> {label}
    </label>
  );

  return (
    <section className="border border-solid border-line rounded-lg bg-surface p-[12px_14px]" aria-label="Finish in the app">
      {/* One header line: what this is, where it stands, and the one action that
          starts it. The action used to sit alone on a row of its own. */}
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
        <b className="text-[13.5px]">Finish it here</b>
        <span className="text-muted text-[12px]">
          {self ? `${recorded} of ${lines.length} lines recorded` : 'Your approved audio, with each section\'s recording or a title card'}
        </span>
        {self && st.analysis?.state === 'running' && <span className="text-warn text-[12.5px]"><RefreshCw size={12} className="inline animate-spin" /> Listening to {st.analysis.total} takes…</span>}
        {self && st.analysis?.state === 'failed' && <span className="text-danger text-[12.5px]">{st.analysis.error}</span>}
        {self && analyzed && st.analysis?.state !== 'running' && (
          <span className="text-[12.5px] text-ink-2">{cutsOn.length} cuts on — saves {secs(saving)}. Click a cut to keep that bit.</span>
        )}
        {self && (
          <button className="ml-auto text-[12.5px] p-[4px_10px]" onClick={() => act(() => api.analyzeTakes(production.id))} disabled={busy || !recorded}>
            <Wand2 size={13} /> {analyzed ? 'Listen again' : 'Listen for fillers and pauses'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-x-[16px] gap-y-[6px] mt-[10px] p-[8px_12px] rounded-md bg-surface-2">
        {self && check('removeFillers', 'Cut fillers', 'um, uh, hmm…')}
        {self && check('tightenGaps', 'Shorten long pauses')}
        {self && check('trimEnds', 'Trim dead air at each end')}
        {check('cleanAudio', 'Clean audio', 'Noise reduction and broadcast loudness (−14 LUFS)')}
        {self && check('look', 'Auto light and colour')}
        {check('captions', 'Burn in captions')}
        <span className="flex items-center gap-[5px] text-[12.5px]">
          Frame
          {['16:9', '9:16', '1:1'].map((a) => (
            <button key={a} type="button" onClick={() => set({ aspect: a })}
              className={'text-[11.5px] p-[2px_9px] rounded-full ' + (s.aspect === a ? 'bg-ink text-[#fff] border-ink' : '')}>{a}</button>
          ))}
        </span>
        {self && check('reframe', 'Keep my face centred', 'Crop around your face when the frame changes shape')}
        <span className="flex items-center gap-[5px] text-[12.5px]">
          Also export
          {['16:9', '9:16', '1:1'].filter((a) => a !== s.aspect).map((a) => {
            const on = (s.alsoExport ?? []).includes(a);
            return (
              <button key={a} type="button" title={a === '9:16' ? 'Shorts, Reels, TikTok' : a === '1:1' ? 'Feeds' : 'YouTube'}
                onClick={() => set({ alsoExport: on ? s.alsoExport.filter((x) => x !== a) : [...(s.alsoExport ?? []), a] })}
                className={'text-[11.5px] p-[2px_9px] rounded-full ' + (on ? 'bg-ink text-[#fff] border-ink' : '')}>{on ? '✓ ' : '+ '}{a}</button>
            );
          })}
        </span>
        <span className="flex flex-wrap items-center gap-[6px] text-[12.5px]">
          Music
          <select className="text-[12px] max-w-[220px]" value={s.music ?? ''} aria-label="Background music"
            onChange={(e) => set({ music: e.target.value || null })}>
            <option value="">None</option>
            {tracks.map((t) => <option key={t.name} value={t.name}>{t.name}{t.seconds ? ` (${Math.round(t.seconds)}s)` : ''}</option>)}
          </select>
          {s.music && ['low', 'medium', 'high'].map((l) => (
            <button key={l} type="button" onClick={() => set({ musicLevel: l })}
              className={'text-[11.5px] p-[2px_9px] rounded-full ' + (s.musicLevel === l ? 'bg-ink text-[#fff] border-ink' : '')}>{l}</button>
          ))}
          <UploadDrop compact accept="audio/*" label="Add a track"
            upload={(f, p) => api.uploadMusic(f, p)} onDone={(r) => { setTracks(r.data.tracks); set({ music: r.data.saved }); }} />
        </span>
      </div>
      <p className="text-faint text-[11px] m-[4px_0_0]">Music sits under your voice and dips while you speak. Use tracks you have the rights to — they are kept in your storage's Music folder for every video.</p>

      {self && (
        <ol className="list-none p-0 m-[10px_0_0] border border-solid border-line rounded-md">
          {lines.map((l) => {
            const t = chosen(l);
            return (
              <li key={l.segmentId} className="[&+&]:[border-top:1px_solid_var(--line)] p-[7px_10px]">
                <div className="grid grid-cols-[24px_1fr_auto] gap-[8px] items-start">
                  <code className="text-[11px] text-faint pt-[2px]">{String(l.n).padStart(2, '0')}</code>
                  <div className="min-w-0">
                    <button type="button" className="ghostbtn text-left text-[12.5px] leading-[1.4] p-0 text-ink line-clamp-2" onClick={() => setOpen(open === l.segmentId ? null : l.segmentId)}>{l.text}</button>
                    {t && t.cuts.length > 0 && (
                      <div className="flex flex-wrap gap-[4px] mt-[4px]">
                        {t.cuts.map((c, i) => (
                          <button key={i} type="button" className={c.on ? CHIP_ON : CHIP_OFF} title={`${secs(c.start)}–${secs(c.end)} · ${c.on ? 'cut — click to keep' : 'kept — click to cut'}`}
                            onClick={() => toggle(t, i, !c.on)}>{KIND[c.kind]}: {c.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  {t ? (
                    <select className="text-[12px]" value={t.id} aria-label={`Take for line ${l.n}`}
                      onChange={(e) => mutate(() => api.updateLineTake(production.id, Number(e.target.value), { chosen: true }), null, { silent: true }).then(load).catch(() => {})}>
                      {l.takes.map((x) => <option key={x.id} value={x.id}>Take {x.version}{x.analyzed ? '' : ' ·'}</option>)}
                    </select>
                  ) : <span className="text-[12px] text-warn">not recorded</span>}
                </div>
                {open === l.segmentId && t && (
                  <div className="p-[8px_0_2px_32px] flex flex-wrap items-center gap-[8px]">
                    <video ref={(el) => { player.current[t.id] = el; }} className="w-[260px] rounded-md bg-ink" controls preload="metadata"
                      src={`${t.url}#t=${t.inPoint.toFixed(2)}`} />
                    <div className="flex flex-col gap-[6px] text-[12px]">
                      <span className="text-muted">In {secs(t.inPoint)} · Out {secs(t.outPoint)} of {secs(t.duration ?? t.outPoint)}</span>
                      <span className="flex gap-[6px]">
                        <button className="text-[12px] p-[3px_9px]" onClick={() => setPoint(t, 'inPoint')}>Set in here</button>
                        <button className="text-[12px] p-[3px_9px]" onClick={() => setPoint(t, 'outPoint')}>Set out here</button>
                      </span>
                      <span className="text-faint">Play to the spot, then set it.</span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-[10px] mt-[12px]">
        <button onClick={() => act(() => api.previewEdit(production.id))} disabled={busy}><Film size={14} /> Preview</button>
        <button className="primary" onClick={() => act(() => api.exportEdit(production.id))} disabled={busy}><Check size={14} /> Export the finished video</button>
        {st.job?.state === 'running' && <span className="text-warn text-[12.5px]"><RefreshCw size={12} className="inline animate-spin" /> {st.job.preview ? 'Building a preview…' : st.job.step ?? 'Exporting at full size…'}</span>}
        {st.job?.state === 'failed' && <span className="text-danger text-[12.5px]">{st.job.error}</span>}
        {st.job?.state === 'done' && !st.job.preview && (
          <span className="text-ok text-[12.5px]"><Check size={13} className="inline" /> Exported "{st.job.name}" ({secs(st.job.duration ?? 0)}){st.job.extras?.length ? ` + ${st.job.extras.length} more shape${st.job.extras.length === 1 ? '' : 's'}` : ''} — marked done.
            {' '}<button className="ghostbtn text-[12.5px] text-accent p-0 underline" onClick={() => goToStage?.('Finish')}>Publish it</button></span>
        )}
      </div>
      {st.preview && (
        <video key={st.preview.url} className="w-full max-w-[560px] mt-[10px] rounded-md bg-ink" src={st.preview.url} controls preload="metadata" />
      )}
      {st.job?.state === 'done' && st.job.preview && (
        <p className="text-faint text-[11.5px] m-[6px_0_0]">Preview: {secs(st.job.duration ?? 0)}, {st.job.pieces} pieces{st.job.cutaways ? `, ${st.job.cutaways} screen cutaway${st.job.cutaways === 1 ? '' : 's'}` : ''}{st.job.captions ? `, ${st.job.captions} captions` : ''}{st.job.music ? ', music' : ''}{st.job.missing?.length ? ` — line ${st.job.missing.join(', ')} not recorded yet` : ''}.</p>
      )}
    </section>
  );
}

export default function EditStage({ goToStage }) {
  const { production, meta, mutate } = useStudio();
  const [editingTool, setEditingTool] = useState(null);
  const [range, setRange] = useState({ from: '', to: '', note: '' });

  const { data: state, error, reload: load, setData: setState } =
    useResource(() => api.render(production.id), [production.id]);

  if (!needsRender(production)) {
    return (
      <div className="stagepane">
        <h2>Edit</h2>
        <p>Finish it here, or take the kit to CapCut and upload the result in Finish — either way marks it done.</p>
        <FinishInApp production={production} goToStage={goToStage} />
        {madeByOf(production) === 'self' && <AvatarFromRecording production={production} onFinished={() => goToStage?.('Finish')} />}
        <EditorKit production={production} />
      </div>
    );
  }
  if (!state) return <LoadState error={error} retry={load} />;
  const latest = state.latest;
  const apply = (res) => setState(res.data);
  const ready = latest?.status === 'complete';

  return (
    <div className="stagepane">
      <h2>Post-render Editor</h2>
      <p>
        Render is an intermediate asset. Edits are non-destructive — each one is recorded as a
        decision and the render itself is never modified.
      </p>

      <EditorKit production={production} />

      {!ready && (
        <div className="notice warn">
          <Lock /> Complete a render before editing. {latest ? `v${latest.version} is ${latest.status}.` : 'No render yet.'}
        </div>
      )}

      {/* The actual render, not a drawing of a play button. You are about to
          make cuts against it, so you need to be able to watch it. */}
      {latest?.videoUrl ? (
        <video className="renderplayer" controls preload="metadata"
          poster={latest.thumbnailUrl ?? undefined} src={latest.videoUrl} />
      ) : (
        <div className="preview h-[300px]">
          <Play size={56} />
          <span>{latest ? `Render v${latest.version} · ${latest.duration} · no playable file` : 'No render'}</span>
        </div>
      )}

      <div className="flex gap-[3px] m-[14px_0]">
        {production.outline.map((s, i) => (
          <div key={s.id} className="flex-1 bg-canvas border border-solid border-line p-[13px_4px] text-center rounded-sm text-[11px] text-muted overflow-hidden"
            style={{ flex: toSeconds(s.runtime) || 1 }}>
            {i + 1}<small className="block text-[9px] mt-[4px] text-faint">{s.title}</small>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(4,1fr)] lte960:grid-cols-[repeat(2,1fr)] gap-[6px] mt-[16px]">
        {meta.editorTools.map((tool) => {
          const built = SUPPORTED.has(tool);
          return (
          <button
            key={tool}
            // Roadmap buttons are always disabled; the disabled: twin out-ranks button:disabled's .42.
            className={'flex gap-[6px] items-center justify-start text-[12px]'
              + (built ? '' : ' opacity-50 disabled:opacity-50 cursor-not-allowed')}
            disabled={!ready || !built}
            title={built ? 'Add a precise range to the edit decision list' : 'Roadmap — this tool is not built yet'}
            onClick={() => setEditingTool(tool)}
          >
            <Scissors size={14} className="text-muted shrink-0" /> {tool}
          </button>
          );
        })}
      </div>

      {editingTool && (
        <div className="grid grid-cols-[1fr_1fr_2fr_auto] gap-[8px] items-end p-[12px] mt-[10px] border border-solid border-line rounded bg-surface-2">
          <label className="flex flex-col gap-[4px] text-muted text-[10.5px] font-[600]">Start
            <input className="min-w-0" value={range.from} placeholder="0:05" onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-[4px] text-muted text-[10.5px] font-[600]">End
            <input className="min-w-0" value={range.to} placeholder="0:12" onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </label>
          <label className="flex flex-col gap-[4px] text-muted text-[10.5px] font-[600]">Decision note
            <input className="min-w-0" value={range.note} placeholder="Why this is the range to keep"
              onChange={(e) => setRange({ ...range, note: e.target.value })} />
          </label>
          <button className="primary" disabled={!range.from.trim() || !range.to.trim()}
            onClick={async () => {
              try {
                await mutate(
                  () => api.applyEdit(production.id, latest.id, {
                    kind: editingTool,
                    target: `${range.from.trim()}-${range.to.trim()}`,
                    note: range.note.trim(),
                  }),
                  apply
                );
                setEditingTool(null);
                setRange({ from: '', to: '', note: '' });
              } catch { /* mutate reports it */ }
            }}>
            Apply range
          </button>
        </div>
      )}

      {ready && latest.editDecisions.length > 0 && (
        <div className="border border-solid border-line rounded p-[13px_15px] mt-[16px]">
          <b className="block text-[11px] text-muted mb-[8px] font-[600]">Edit decision list — applied to v{latest.version}, non-destructive</b>
          {latest.editDecisions.map((d, i) => (
            <div key={d.id} className="grid grid-cols-[18px_minmax(0,1fr)_auto_auto] gap-[10px] items-center p-[7px_0] [border-top:1px_solid_var(--line)] text-[13px]">
              <span className="w-[18px] h-[18px] rounded-sm bg-canvas border border-solid border-line text-muted grid place-items-center text-[10px]">{i + 1}</span> {d.kind}{d.target ? ` · ${d.target}` : ''}</div>
          ))}
        </div>
      )}

      {/* An export is a file. Showing only a version chip made "ready" a word
          with nothing behind it — and for a long time there was nothing. */}
      {state.exports.length > 0 && (
        <div className="flex flex-col gap-[1px] m-[14px_0] border border-solid border-line rounded overflow-hidden bg-line">
          {state.exports.map((e) => (
            <div className={'grid grid-cols-[34px_auto_minmax(0,1fr)_auto] gap-[10px] items-center p-[8px_12px] text-[13px] '
              + (e.stale ? 'stale bg-warn-soft' : 'bg-surface')} key={e.id}>
              <b className="font-mono text-[12px] leading-[normal] font-normal text-muted">v{e.version}</b>
              {e.error ? (
                <span className="dangerv"><AlertCircle size={12} /> {e.error}</span>
              ) : e.filePath ? (
                <>
                  <span className="text-[12px] text-ink-2 whitespace-nowrap">
                    {(e.bytes / 1024 / 1024).toFixed(1)} MB
                    {e.durationSeconds ? ` · ${toClock(e.durationSeconds)}` : ''}
                    {e.editsApplied ? ` · ${e.editsApplied} edit${e.editsApplied === 1 ? '' : 's'} applied` : ''}
                  </span>
                  <code className="font-mono text-[11px] leading-[normal] font-normal text-faint overflow-hidden text-ellipsis whitespace-nowrap [direction:rtl] text-left" title={e.filePath}>{e.filePath}</code>
                </>
              ) : (
                <span className="text-[12px] text-ink-2 whitespace-nowrap">no file — exported before this build wrote one</span>
              )}
              {e.stale && <span className="text-warn text-[11.5px]">stale</span>}
              {e.note && <small className="col-[2/-1] text-warn text-[11.5px]">{e.note}</small>}
            </div>
          ))}
        </div>
      )}

      {state.exports.some((e) => e.stale) && (
        <div className="stalebar">
          <AlertCircle size={15} />
          <span>An export is out of date after your edits — export again when you are ready.</span>
        </div>
      )}

      <div className="actions">
        <button
          className="primary"
          disabled={!ready}
          onClick={() => mutate(() => api.createExport(production.id), apply)}
        >
          <Check size={15} /> Export new version
        </button>
      </div>
    </div>
  );
}
