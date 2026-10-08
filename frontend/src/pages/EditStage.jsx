import React, { useState, useEffect, useCallback } from 'react';
import { Play, Scissors, Lock, AlertCircle, Check, Download, FolderOpen } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { toSeconds, toClock } from '../utils/format.js';
import { api } from '../services/api.js';
import { useResource } from '../hooks/use-resource.js';
import LoadState from '../components/LoadState.jsx';
import { madeByOf, needsRender } from '../utils/made-by.js';

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

export default function EditStage() {
  const { production, meta, mutate } = useStudio();
  const [editingTool, setEditingTool] = useState(null);
  const [range, setRange] = useState({ from: '', to: '', note: '' });

  const { data: state, error, reload: load, setData: setState } =
    useResource(() => api.render(production.id), [production.id]);

  if (!needsRender(production)) {
    return (
      <div className="stagepane">
        <h2>Edit</h2>
        <p>{madeByOf(production) === 'self' ? 'You record and cut this video yourself.' : 'Your voice over your screen recordings.'}
          {' '}Everything the edit needs is here; the finished file goes up in Plan → Brief, which marks it done.</p>
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
