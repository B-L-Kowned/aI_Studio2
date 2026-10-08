import React, { useState, useEffect, useCallback } from 'react';
import { Check, SkipForward, ExternalLink, Pencil, RefreshCw } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { PageHead } from '../components/Section.jsx';
import { madeByLabel } from '../utils/made-by.js';

const CONFIRM = /\[CONFIRM:\s*[^\]]*\]\s*/gi;
const strip = (t) => t.replace(CONFIRM, '').replace(/\s{2,}/g, ' ').trim();
const words = (ls) => ls.reduce((n, l) => n + strip(l.text).split(/\s+/).filter(Boolean).length, 0);
const CHIP = 'text-[12px] p-[5px_11px] rounded-full border border-solid cursor-pointer whitespace-nowrap';
const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

/** A line with each [CONFIRM: …] shown as the question it is. */
function Marked({ text }) {
  return String(text).split(/(\[CONFIRM:[^\]]*\])/gi).map((p, i) => (/^\[CONFIRM:/i.test(p)
    ? <mark key={i} className="bg-warn-soft text-warn rounded-[3px] px-[4px] text-[12.5px]">check: {p.replace(/^\[CONFIRM:\s*|\]$/gi, '')}</mark>
    : <React.Fragment key={i}>{p}</React.Fragment>));
}

/**
 * Reading work across the whole register, one thing at a time: drafts that
 * only need your yes, and the [CONFIRM] checks that need you to look at the
 * real product. Keyboard: A approves, S skips.
 */
export default function Review({ go, tabs }) {
  const { openProduction, mutate } = useStudio();
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('ready');
  const [sort, setSort] = useState('release');
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState(null); // line id
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.review(sort).then(setData).catch(() => setData({ ready: [], checks: [], totals: {} })), [sort]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setAt(0); setEditing(null); }, [mode, sort]);

  const list = data ? (mode === 'ready' ? data.ready : data.checks) : [];
  const item = list[Math.min(at, Math.max(0, list.length - 1))];

  const approve = useCallback(async () => {
    if (!item || busy) return;
    setBusy(true);
    try {
      await mutate(() => api.acceptScript(item.productionId, item.versionId), null, { silent: true });
      await mutate(() => api.buildSegments(item.productionId), null, { silent: true });
      await load(); // the approved draft leaves the list; the next one moves up
    } catch { /* mutate reports it */ } finally { setBusy(false); }
  }, [item, busy, mutate, load]);
  const skip = useCallback(() => setAt((i) => Math.min(i + 1, list.length - 1)), [list.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey) return;
      if (mode === 'ready' && e.key.toLowerCase() === 'a') { e.preventDefault(); approve(); }
      if (e.key.toLowerCase() === 's' || e.key === 'ArrowRight') { e.preventDefault(); skip(); }
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, approve, skip]);

  const saveLine = async (it, line, text) => {
    setBusy(true);
    try {
      await mutate(() => api.updateScriptSegment(it.productionId, it.versionId, line.id, { text }), null, { silent: true });
      setEditing(null);
      await load();
    } catch { /* mutate reports it */ } finally { setBusy(false); }
  };
  const confirmAll = async (it) => {
    if (!window.confirm(`Confirm all ${it.lines.length} checked lines in ${it.videoId} as written?`)) return;
    setBusy(true);
    try {
      for (const l of it.lines) await mutate(() => api.updateScriptSegment(it.productionId, it.versionId, l.id, { text: strip(l.text) }), null, { silent: true });
      await load();
    } catch { /* mutate reports it */ } finally { setBusy(false); }
  };
  const open = async (id) => { await openProduction(id); go('Create'); };

  if (!data) return <><PageHead title="Review" tabs={tabs} /><p className="muted">Loading…</p></>;
  const t = data.totals;

  return (
    <>
      <PageHead title="Review" tabs={tabs} lead="Reading work across the register, one video at a time." />

      <div className="flex flex-wrap items-center gap-[6px] mt-[4px]">
        <button className={`${CHIP} ${mode === 'ready' ? 'bg-ink text-[#fff] border-ink' : 'bg-surface text-ink-2 border-line'}`} onClick={() => setMode('ready')}>
          Ready to approve <span className="opacity-70">{t.ready}</span>
        </button>
        <button className={`${CHIP} ${mode === 'checks' ? 'bg-ink text-[#fff] border-ink' : 'bg-surface text-ink-2 border-line'}`} onClick={() => setMode('checks')}>
          Checks <span className="opacity-70">{t.checks} in {t.videosWithChecks} videos</span>
        </button>
        <label className="text-[12px] text-muted flex items-center gap-[6px] ml-auto">
          Order
          <select className="text-[12px]" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="release">Release order</option>
            <option value="priority">Priority first</option>
          </select>
        </label>
      </div>

      {!item ? (
        <p className="mt-[24px] text-muted text-[13px]">{mode === 'ready' ? 'No drafts waiting — every draft is approved or has checks.' : 'No open checks.'}</p>
      ) : (
        <section className="mt-[14px] border border-solid border-line rounded-lg bg-surface p-[16px_18px] [box-shadow:var(--shadow)]" aria-label="Review item">
          <div className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[4px]">
            <code className="text-[12px] font-semibold text-ink-2">{item.videoId}</code>
            <b className="text-[15px] font-[600]">{item.name}</b>
            <span className="text-[12px] text-muted">{item.company}{item.priority ? ` · ${item.priority}` : ''} · {madeByLabel(item.madeBy)}{item.target ? ` · target ${item.target}` : ''}</span>
            <span className="text-[12px] text-faint ml-auto">{Math.min(at, list.length - 1) + 1} of {list.length}</span>
          </div>

          {mode === 'ready' ? (
            <>
              <div className="mt-[12px] flex flex-col gap-[8px] max-h-[52vh] overflow-y-auto pr-[6px]">
                {item.lines.map((l) => <p key={l.id} className="m-0 text-[14px] leading-[1.6] text-ink">{l.text}</p>)}
              </div>
              <p className="text-faint text-[11.5px] m-[10px_0_0]">{item.lines.length} lines · {words(item.lines)} words · about {Math.round(words(item.lines) / 150 * 60)}s at a typical pace</p>
            </>
          ) : (
            <div className="mt-[12px] flex flex-col gap-[12px]">
              {item.lines.map((l) => (
                <div key={l.id} className="border-l-[3px] border-solid border-warn-line pl-[12px]">
                  {editing === l.id ? (
                    <>
                      <textarea className="w-full min-h-[70px] text-[13.5px] leading-[1.55]" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                      <div className="flex gap-[6px] mt-[6px]">
                        <button className="primary text-[12.5px]" disabled={busy || !draft.trim()} onClick={() => saveLine(item, l, draft)}><Check size={13} /> Save the line</button>
                        <button className="text-[12.5px]" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="m-0 text-[13.5px] leading-[1.6]"><Marked text={l.text} /></p>
                      <div className="flex flex-wrap gap-[6px] mt-[6px]">
                        <button className="text-[12px] p-[4px_10px]" disabled={busy} onClick={() => saveLine(item, l, strip(l.text))}><Check size={12} /> Confirmed as written</button>
                        <button className="text-[12px] p-[4px_10px]" disabled={busy} onClick={() => { setEditing(l.id); setDraft(strip(l.text)); }}><Pencil size={12} /> Edit the line</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-[8px] mt-[16px] pt-[12px] [border-top:1px_solid_var(--line)]">
            {mode === 'ready' && <button className="primary" disabled={busy} onClick={approve}><Check size={14} /> Approve <kbd className="opacity-60 text-[10.5px]">A</kbd></button>}
            {mode === 'checks' && item.lines.length > 1 && <button disabled={busy} onClick={() => confirmAll(item)}><Check size={14} /> Confirm all {item.lines.length} as written</button>}
            <button disabled={busy || at >= list.length - 1} onClick={skip}><SkipForward size={14} /> Skip <kbd className="opacity-60 text-[10.5px]">S</kbd></button>
            {busy && <RefreshCw size={13} className="animate-spin text-muted" />}
            <button className="ghostbtn text-[12.5px] text-accent ml-auto" onClick={() => open(item.productionId)}><ExternalLink size={13} /> Open the video</button>
          </div>
        </section>
      )}
    </>
  );
}
