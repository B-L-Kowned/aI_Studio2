import React, { useState, useEffect } from 'react';
import { Layers, X, Plus, Trash2, ArrowLeft } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import TemplatePicker from './TemplatePicker.jsx';

/**
 * Plan a whole series at once.
 *
 * A series is a campaign whose productions carry an explicit order — the same
 * hierarchy Training reads. Generated titles are marked as placeholders here
 * and on the episode itself, because a season filled with "Episode 4" is a
 * form someone filled in, not a plan anyone made.
 */
export default function NewSeries({ onClose, onDone, onBack }) {
  const { mutate } = useStudio();
  const [meta, setMeta] = useState(null);
  const [name, setName] = useState('');
  const [premise, setPremise] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [numbering, setNumbering] = useState('episode');
  const [count, setCount] = useState(4);
  const [titles, setTitles] = useState([]);
  const [busy, setBusy] = useState(false);

  // Without the catch a failure was an unhandled rejection; the form still works on defaults.
  useEffect(() => { api.seriesMeta().then(setMeta).catch(() => setMeta(null)); }, []);

  const propose = async () => {
    // `post` returns the whole envelope while `get` unwraps to data — reading
    // r.episodes here silently produced undefined and the list never appeared.
    const r = await api.previewSeries({ premise: premise || name, count: Number(count), numbering });
    setTitles((r.data?.episodes ?? []).map((e) => e.title));
  };

  const create = async () => {
    setBusy(true);
    try {
      await mutate(() => api.createSeries({
        name, premise, templateId: templateId || null,
        episodes: titles.length ? titles : undefined,
        count: titles.length ? undefined : Number(count),
        numbering,
      }), null);
      onDone?.();
      onClose();
    } catch { /* mutate reports it */ }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal wide">
        <div className="modalhead">
          <b>
            {/* `.modalhead button` sets border, fill, padding and colour; only the margin is ours. */}
            {onBack && (
              <button className="mr-[2px]" type="button" onClick={onBack} title="Choose something else">
                <ArrowLeft size={14} />
              </button>
            )}
            <Layers size={15} /> Plan a series
          </b>
          <button onClick={onClose}><X size={14} /></button>
        </div>

        <label>Series name
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="AI for Operators — Season 1" />
        </label>

        <label>What is it about?
          <input value={premise} onChange={(e) => setPremise(e.target.value)}
            placeholder="Practical AI for people who run things" />
        </label>

        <div className="formgrid">
          <div className="flex flex-col gap-[4px] text-[12px] text-muted">Template
            {/* Same picker as a single production. It was "{name} · {runtime}"
                crammed into an <option> here too, and a series commits the
                choice to every episode at once — so it is the one place worth
                seeing the format and section count before you pick. */}
            <TemplatePicker
              templates={meta?.templates ?? []}
              value={templateId}
              allowBlank
              onChange={setTemplateId}
            />
          </div>
          <label>Each one is a
            <select value={numbering} onChange={(e) => setNumbering(e.target.value)}>
              {(meta?.numbering ?? ['episode']).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>How many
            <input type="number" min="1" max="60" value={count}
              onChange={(e) => setCount(e.target.value)} />
          </label>
        </div>

        <div className="flex items-center gap-[12px] m-[4px_0_2px]">
          <button onClick={propose}>Suggest {count} titles</button>
          <small className="text-faint text-[11.5px]">Suggestions are placeholders — rename them before you build.</small>
        </div>

        {titles.length > 0 && (
          <div className="flex flex-col gap-[6px] m-[10px_0] max-h-[260px] overflow-y-auto">
            {titles.map((t, i) => (
              <div className="grid grid-cols-[22px_1fr_auto] gap-[8px] items-center" key={i}>
                <span className="font-mono text-[11px] not-italic font-normal leading-[normal] text-faint text-right">{i + 1}</span>
                <input className="text-[13px] p-[5px_8px]" value={t} onChange={(e) =>
                  setTitles((list) => list.map((x, n) => (n === i ? e.target.value : x)))} />
                <button title="Remove this episode"
                  onClick={() => setTitles((list) => list.filter((_, n) => n !== i))}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button className="self-start text-[12px]" onClick={() => setTitles((l) => [...l, ''])}>
              <Plus size={13} /> Add an episode
            </button>
          </div>
        )}

        <div className="modalfoot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !name} onClick={create}>
            Create {titles.length || count} {numbering}{(titles.length || count) === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </>
  );
}
