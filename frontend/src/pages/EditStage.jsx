import React, { useState } from 'react';
import { Play, Scissors, Lock, AlertCircle, Check } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { toSeconds, toClock } from '../utils/format.js';
import { api } from '../services/api.js';
import { useResource } from '../hooks/use-resource.js';
import LoadState from '../components/LoadState.jsx';

const SUPPORTED = new Set(['Trim / Cut', 'Create Short Clip']);

export default function EditStage() {
  const { production, meta, mutate } = useStudio();
  const [editingTool, setEditingTool] = useState(null);
  const [range, setRange] = useState({ from: '', to: '', note: '' });

  const { data: state, error, reload: load, setData: setState } =
    useResource(() => api.render(production.id), [production.id]);

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
