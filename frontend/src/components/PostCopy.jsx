import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Check, AlertTriangle, RotateCcw } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { EnhanceButton, Suggestion, modelLabel } from './Enhance.jsx';

const FIELDS = [
  { key: 'title', label: 'Title', rows: 1 },
  { key: 'description', label: 'Description', rows: 5 },
  { key: 'chapters', label: 'Chapters', rows: 4, hint: 'Worked out from the outline at the video’s real length.' },
  { key: 'hashtags', label: 'Hashtags', rows: 1 },
];

/**
 * What is posted with the video. A first version is worked out from the
 * register name, the script, the outline and the website; edit any field and
 * it is kept. Enhance offers a title and description written from the script.
 */
export default function PostCopy() {
  const { production, mutate } = useStudio();
  const [copy, setCopy] = useState(null);
  const [copied, setCopied] = useState(null);
  const [suggest, setSuggest] = useState(null); // { busy } | result
  const load = useCallback(() => api.postCopy(production.id).then(setCopy).catch(() => setCopy(null)), [production.id]);
  useEffect(() => { load(); }, [load]);
  if (!copy) return null;

  const save = (patch) => mutate(() => api.savePostCopy(production.id, patch), (r) => setCopy(r.data), { silent: true }).catch(() => {});
  const copyText = async (key, text) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ }
  };
  const enhance = async () => {
    setSuggest({ busy: true });
    try { const r = await mutate(() => api.enhancePostCopy(production.id), null, { silent: true }); setSuggest(r.data); }
    catch { setSuggest(null); }
  };
  const all = FIELDS.map((f) => copy[f.key]).filter(Boolean).join('\n\n');

  return (
    <section className="mt-[18px] border border-solid border-line rounded-lg bg-surface" aria-label="Post copy">
      <header className="flex flex-wrap items-center gap-[8px_14px] p-[12px_16px] [border-bottom:1px_solid_var(--line)]">
        <div className="mr-auto">
          <h3 className="m-0 text-[14px]">Post copy</h3>
          <p className="m-[2px_0_0] text-[12px] text-muted">
            {copy.saved ? 'Your edits are kept.' : 'Worked out from the script, outline and website — edit anything and it is kept.'}
            {!copy.approved && <span className="text-warn"> The script is still a draft.</span>}
          </p>
        </div>
        {copy.saved && (
          <button className="ghostbtn text-[12px] text-muted p-[3px_4px]" title="Discard your edits and work it out again"
            onClick={() => mutate(() => api.resetPostCopy(production.id), (r) => setCopy(r.data)).catch(() => {})}>
            <RotateCcw size={12} /> Start over
          </button>
        )}
        <button className="text-[12px] p-[5px_11px]" onClick={() => copyText('all', all)}>
          {copied === 'all' ? <Check size={12} /> : <Copy size={12} />} Copy all
        </button>
        <EnhanceButton busy={suggest?.busy} busyLabel="Writing…" onPick={enhance} options={[
          { id: 'write', label: 'Write the title and description', detail: 'From the approved script only. Shown for you to use or not.' },
        ]} />
      </header>

      {suggest && !suggest.busy && (
        <div className="p-[10px_16px_0]">
          <Suggestion text={<><b className="block font-[600]">{suggest.title}</b><span className="whitespace-pre-line">{suggest.description}</span></>}
            flags={suggest.flags} meta={modelLabel(suggest.model)} useLabel="Use both"
            onDismiss={() => setSuggest(null)}
            onUse={() => { save({ title: suggest.title, description: suggest.description }); setSuggest(null); }} />
        </div>
      )}

      {copy.checks.length > 0 && (
        <ul className="m-0 p-[10px_16px_0] list-none flex flex-col gap-[3px]">
          {copy.checks.map((c) => (
            <li key={c.field + c.message} className="text-[12px] text-warn flex items-center gap-[6px]"><AlertTriangle size={12} /> {c.message}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-[12px] p-[12px_16px_16px]">
        {FIELDS.map((f) => (
          <label key={`${f.key}-${copy[f.key]}`} className="grid grid-cols-[110px_minmax(0,1fr)_auto] gap-[12px] items-start lte800:grid-cols-[1fr]">
            <span className="pt-[7px] text-[11px] tracking-[.06em] uppercase font-semibold text-ink-2">
              {f.label}
              {f.key === 'title' && <span className={'block normal-case tracking-normal font-normal text-[11px] ' + (copy.title.length > 70 ? 'text-warn' : 'text-faint')}>{copy.title.length}/70</span>}
            </span>
            <span>
              {f.rows === 1 ? (
                <input className="w-full text-[13px]" defaultValue={copy[f.key]} onBlur={(e) => e.target.value !== copy[f.key] && save({ [f.key]: e.target.value })} />
              ) : (
                <textarea className="w-full text-[13px] leading-[1.55] resize-y" rows={f.rows} defaultValue={copy[f.key]}
                  onBlur={(e) => e.target.value !== copy[f.key] && save({ [f.key]: e.target.value })} />
              )}
              {f.hint && <small className="block text-faint text-[11px] mt-[2px]">{f.hint}</small>}
            </span>
            <button type="button" className="ghostbtn p-[6px] text-muted" aria-label={`Copy the ${f.label.toLowerCase()}`} onClick={() => copyText(f.key, copy[f.key])}>
              {copied === f.key ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
            </button>
          </label>
        ))}
      </div>
    </section>
  );
}
