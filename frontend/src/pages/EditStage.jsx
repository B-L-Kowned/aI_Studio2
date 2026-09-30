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
        <div className="preview big">
          <Play size={56} />
          <span>{latest ? `Render v${latest.version} · ${latest.duration} · no playable file` : 'No render'}</span>
        </div>
      )}

      <div className="timeline">
        {production.outline.map((s, i) => (
          <div key={s.id} style={{ flex: toSeconds(s.runtime) || 1 }}>
            {i + 1}<small>{s.title}</small>
          </div>
        ))}
      </div>

      <div className="editorgrid">
        {meta.editorTools.map((tool) => {
          const built = SUPPORTED.has(tool);
          return (
          <button
            key={tool}
            className={built ? '' : 'roadmap'}
            disabled={!ready || !built}
            title={built ? 'Add a precise range to the edit decision list' : 'Roadmap — this tool is not built yet'}
            onClick={() => setEditingTool(tool)}
          >
            <Scissors size={14} /> {tool}
          </button>
          );
        })}
      </div>

      {editingTool && (
        <div className="editform">
          <label>Start
            <input value={range.from} placeholder="0:05" onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </label>
          <label>End
            <input value={range.to} placeholder="0:12" onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </label>
          <label>Decision note
            <input value={range.note} placeholder="Why this is the range to keep"
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
        <div className="edl">
          <b>Edit decision list — applied to v{latest.version}, non-destructive</b>
          {latest.editDecisions.map((d, i) => (
            <div key={d.id}><span>{i + 1}</span> {d.kind}{d.target ? ` · ${d.target}` : ''}</div>
          ))}
        </div>
      )}

      {/* An export is a file. Showing only a version chip made "ready" a word
          with nothing behind it — and for a long time there was nothing. */}
      {state.exports.length > 0 && (
        <div className="exportlist">
          {state.exports.map((e) => (
            <div className={'exportrow' + (e.stale ? ' stale' : '')} key={e.id}>
              <b>v{e.version}</b>
              {e.error ? (
                <span className="dangerv"><AlertCircle size={12} /> {e.error}</span>
              ) : e.filePath ? (
                <>
                  <span className="exmeta">
                    {(e.bytes / 1024 / 1024).toFixed(1)} MB
                    {e.durationSeconds ? ` · ${toClock(e.durationSeconds)}` : ''}
                    {e.editsApplied ? ` · ${e.editsApplied} edit${e.editsApplied === 1 ? '' : 's'} applied` : ''}
                  </span>
                  <code className="expath" title={e.filePath}>{e.filePath}</code>
                </>
              ) : (
                <span className="exmeta">no file — exported before this build wrote one</span>
              )}
              {e.stale && <span className="warnv">stale</span>}
              {e.note && <small className="exnote">{e.note}</small>}
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
