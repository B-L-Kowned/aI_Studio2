import React, { useState, useEffect, useMemo } from 'react';
import { Search, Mic, User, Check, AlertTriangle, ChevronDown, Minus } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { PageHead } from '../components/Section.jsx';

// Where each video is: the furthest step that is actually true.
const STAGES = [
  { id: 'needs-script', label: 'Needs script', tone: 'bg-surface-2 text-muted border-line' },
  { id: 'draft', label: 'Draft to approve', tone: 'bg-warn-soft text-warn border-warn-line' },
  { id: 'script', label: 'Script approved', tone: 'bg-accent-soft text-accent border-accent-line' },
  { id: 'audio', label: 'Audio made', tone: 'bg-accent-soft text-accent border-accent-line' },
  { id: 'audio-approved', label: 'Audio approved', tone: 'bg-ok-soft text-ok border-[#c5e3d5]' },
  { id: 'final', label: 'Rendered', tone: 'bg-ok-soft text-ok border-[#c5e3d5]' },
  { id: 'done', label: 'Done', tone: 'bg-ink text-[#fff] border-ink' },
];
const stageOf = (id) => STAGES.find((s) => s.id === id) ?? STAGES[0];
const WORKSTREAMS = ['Company', 'Outreach', 'Training', 'Wrapper', 'Editions', 'Investor', 'GTM masters'];

// The four things that have to be true before a video exists, in order.
const MARKS = [
  ['script', 'Script'], ['audio', 'Audio'], ['look', 'Look'], ['video', 'Video'],
];
const MARK_TEXT = {
  done: 'done', draft: 'waiting for your approval', partial: 'started', none: 'not started', 'n/a': 'not needed',
};
const ROW = 'grid grid-cols-[86px_minmax(220px,1.7fr)_minmax(110px,.7fr)_34px_132px_repeat(4,46px)] gap-[10px] items-center p-[9px_14px] lte860:grid-cols-[64px_1fr_auto]';
const TAG = 'text-[10px] tracking-[.04em] uppercase font-semibold p-[3px_7px] rounded-[3px] whitespace-nowrap border border-solid text-center';
const CHIP = 'text-[12px] p-[5px_11px] rounded-full border border-solid cursor-pointer whitespace-nowrap [transition:background_.12s]';
const chipTone = (on) => (on ? 'bg-ink text-[#fff] border-ink' : 'bg-surface text-ink-2 border-line hover:border-line-2');

function Mark({ state, title }) {
  const base = 'mx-auto grid place-items-center w-[20px] h-[20px] rounded-full';
  if (state === 'done') return <span className={`${base} bg-ok text-[#fff]`} title={title}><Check size={12} strokeWidth={3} /></span>;
  if (state === 'draft' || state === 'partial') {
    return <span className={`${base} border-[2px] border-solid border-warn`} title={title}><span className="w-[8px] h-[8px] rounded-full bg-warn" /></span>;
  }
  if (state === 'n/a') return <span className={`${base} text-line-2`} title={title}><Minus size={12} /></span>;
  return <span className={`${base} border-[1.5px] border-solid border-line-2`} title={title} />;
}

/** One group of mutually exclusive options as chips — quicker than a dropdown for 2–4 choices. */
function ChipGroup({ label, value, options, onChange }) {
  return (
    <div className="flex items-center gap-[5px]" role="group" aria-label={label}>
      <span className="text-[11px] text-faint uppercase tracking-[.05em] mr-[2px]">{label}</span>
      {options.map(([v, l]) => (
        <button key={v || 'all'} type="button" className={`${CHIP} ${chipTone(value === v)}`} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

/**
 * The video register: every Video ID, where it really is, in release order.
 * What the workbook claims is kept beside what the app knows, so a "Reported
 * complete" with nothing behind it stays visible.
 */
export default function Register({ go, tabs }) {
  const { openProduction } = useStudio();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [priority, setPriority] = useState('');
  const [stream, setStream] = useState('');
  const [format, setFormat] = useState('');

  useEffect(() => { api.register().then(setData).catch(() => setData({ items: [], totals: null })); }, []);

  const shown = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.items.filter((i) =>
      (!stage || i.stage === stage)
      && (!priority || i.priority === priority)
      && (!stream || i.workstream === stream)
      && (!format || (format === 'voice') === i.voiceOnly)
      && (!needle || [i.videoId, i.name, i.company, i.group, i.format].some((v) => v && v.toLowerCase().includes(needle))));
  }, [data, q, stage, priority, stream, format]);

  const open = async (id) => { await openProduction(id); go('Create'); };
  const filtered = stage || priority || stream || format || q.trim();

  if (!data) return <><PageHead title="Register" tabs={tabs} /><p className="muted">Loading…</p></>;
  const t = data.totals;
  const count = (key) => shown.filter((i) => i.marks?.[key] === 'done').length;

  return (
    <>
      <PageHead
        title="Register"
        tabs={tabs}
        lead="Every video in the register and the script pack, where each really stands, in release order."
      />

      {t && (
        <div className="flex flex-wrap gap-[6px] mt-[4px]" role="group" aria-label="Filter by stage">
          <button className={`${CHIP} ${chipTone(!stage)}`} onClick={() => setStage('')}>All {t.all}</button>
          {STAGES.filter((s) => t.stages[s.id] || stage === s.id).map((s) => (
            <button key={s.id} className={`${CHIP} ${chipTone(stage === s.id)}`} onClick={() => setStage(stage === s.id ? '' : s.id)}>
              {s.label} <span className={stage === s.id ? 'opacity-80' : 'text-muted'}>{t.stages[s.id]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-[10px] mt-[14px]">
        <label className="relative flex-[1_1_240px] max-w-[320px]">
          <Search size={14} className="absolute left-[11px] top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input className="w-full text-[13px] p-[8px_10px_8px_32px] rounded-full" placeholder="Search ID, title, company"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the register" />
        </label>
        <ChipGroup label="Priority" value={priority} onChange={setPriority}
          options={[['', 'All'], ['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3']]} />
        <ChipGroup label="Format" value={format} onChange={setFormat}
          options={[['', 'All'], ['camera', 'On camera'], ['voice', 'Voice-over']]} />
        <label className="relative flex items-center">
          <select value={stream} onChange={(e) => setStream(e.target.value)} aria-label="Workstream"
            className={'appearance-none text-[12px] rounded-full p-[5px_30px_5px_12px] cursor-pointer border border-solid '
              + (stream ? 'bg-ink text-[#fff] border-ink' : 'bg-surface text-ink-2 border-line')}>
            <option value="">All workstreams</option>
            {WORKSTREAMS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <ChevronDown size={13} className={`absolute right-[10px] pointer-events-none ${stream ? 'text-[#fff]' : 'text-muted'}`} />
        </label>
        {filtered && (
          <button className="ghostbtn text-[12px] text-accent p-[2px_4px]"
            onClick={() => { setStage(''); setPriority(''); setStream(''); setFormat(''); setQ(''); }}>
            Clear filters
          </button>
        )}
        <span className="text-faint text-[11.5px] ml-auto">{shown.length} of {data.items.length}</span>
      </div>

      <section className="overflow-hidden mt-[12px] border border-solid border-line rounded-lg bg-surface [box-shadow:var(--shadow)]"
        aria-label="Video register">
        <div className={`${ROW} min-h-[36px] bg-surface-2 [border-bottom:1px_solid_var(--line)] text-faint text-[10px] font-semibold tracking-[.06em] uppercase lte860:hidden`}>
          <span>ID</span><span>Video</span><span>Company</span><span>Pri</span><span>Stage</span>
          {MARKS.map(([k, l]) => (
            <span key={k} className="text-center" title={`${count(k)} of ${shown.length} done`}>
              {l}<span className="block text-[9.5px] font-normal tracking-normal normal-case text-faint">{count(k)}/{shown.length}</span>
            </span>
          ))}
        </div>

        {shown.length === 0 && <p className="p-[18px_14px] text-muted text-[12.5px]">Nothing matches these filters.</p>}

        {shown.map((i) => {
          const s = stageOf(i.stage);
          // The workbook says done but the app has no evidence of it.
          const claimed = /complete/i.test(i.register.overall ?? '') && i.stage !== 'done';
          const sub = i.completedAsset ?? i.scriptStatus ?? `${i.format}${i.registerDuration ? ` · ${i.registerDuration}` : ''}`;
          return (
            <button key={i.id} type="button" onClick={() => open(i.id)}
              className={`${ROW} w-full text-left bg-transparent [border:0] rounded-none [&+&]:[border-top:1px_solid_var(--line)] hover:bg-surface-2`}>
              <code className="text-[11.5px] font-[600] text-ink-2 break-all" title={i.inRegister ? '' : 'From the script pack — not a register row'}>
                {i.videoId}{!i.inRegister && <sup className="text-faint font-normal"> pack</sup>}
              </code>
              <span className="min-w-0">
                <b className="flex items-center gap-[6px] text-[13px] font-[560] min-w-0">
                  <span className="truncate" title={i.name}>{i.name}</span>
                  <span className="flex-none text-faint" title={i.voiceOnly ? 'Voice-over — no avatar' : 'On camera'}>
                    {i.voiceOnly ? <Mic size={12} /> : <User size={12} />}
                  </span>
                </b>
                <small className="block truncate text-faint text-[11px]" title={sub}>{sub}</small>
              </span>
              <span className="truncate text-[12px] text-ink-2 lte860:hidden" title={i.group ?? ''}>{i.company}</span>
              <span className={`text-[11.5px] font-[600] lte860:hidden ${i.priority === 'P1' ? 'text-danger' : 'text-muted'}`}>{i.priority}</span>
              <span className="flex items-center gap-[5px]">
                <span className={`${TAG} ${s.tone}`}>{s.label}</span>
                {claimed && <AlertTriangle size={13} className="text-warn" aria-label="Register says complete; nothing here yet" />}
              </span>
              {MARKS.map(([k, l]) => (
                <span key={k} className="lte860:hidden">
                  <Mark state={i.marks?.[k]}
                    title={`${l}: ${MARK_TEXT[i.marks?.[k]] ?? 'not started'}${k === 'audio' && i.lines ? ` (${i.heard}/${i.lines} lines approved)` : ''}${k === 'look' && i.marks?.lookName ? ` — ${i.marks.lookName}` : ''}`} />
                </span>
              ))}
            </button>
          );
        })}
      </section>

      <p className="flex flex-wrap items-center gap-[14px] text-[11px] text-faint mt-[10px]">
        <span className="flex items-center gap-[5px]"><Mark state="done" /> done</span>
        <span className="flex items-center gap-[5px]"><Mark state="draft" /> waiting for approval / started</span>
        <span className="flex items-center gap-[5px]"><Mark state="none" /> not started</span>
        <span className="flex items-center gap-[5px]"><Mark state="n/a" /> not needed (voice-over has no look)</span>
      </p>
    </>
  );
}
