import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Mic, User, Video, Check, AlertTriangle, ChevronDown, Minus, Headphones,
  Flag, Clapperboard, Layers, Building2, ArrowUpDown, X, Sparkles } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { useDialog } from '../components/Dialog.jsx';
import { api } from '../services/api.js';
import { PageHead } from '../components/Section.jsx';

// Where each video is: the furthest step that is actually true.
const STAGES = [
  { id: 'needs-script', label: 'Needs script', tone: 'bg-surface-2 text-muted border-line' },
  { id: 'draft-ready', label: 'Ready to approve', tone: 'bg-warn-soft text-warn border-warn-line' },
  { id: 'draft-checks', label: 'Has checks', tone: 'bg-warn-soft text-warn border-warn-line' },
  { id: 'script', label: 'Script approved', tone: 'bg-accent-soft text-accent border-accent-line' },
  { id: 'audio', label: 'Voice made', tone: 'bg-accent-soft text-accent border-accent-line' },
  { id: 'audio-approved', label: 'Voice approved', tone: 'bg-ok-soft text-ok border-[#c5e3d5]' },
  { id: 'final', label: 'Rendered', tone: 'bg-ok-soft text-ok border-[#c5e3d5]' },
  { id: 'done', label: 'Done', tone: 'bg-ink text-[#fff] border-ink' },
];
const stageOf = (id) => STAGES.find((s) => s.id === id) ?? STAGES[0];
const MAKE = { heygen: 'render', self: 'record', voice: 'add screen recordings' };
// What the app knows about where a video stands, and what is next. The
// workbook's own note can lag behind ("Draft — text approval needed" after
// you approved it), so it is kept for the hover text, not the line.
function nowLine(i) {
  if (i.stage === 'done') return i.completedAsset;
  const make = MAKE[i.madeBy] ?? 'render';
  const next = {
    'needs-script': 'No script yet',
    'draft-ready': 'Draft with no checks — ready for your yes',
    'draft-checks': `Draft — ${i.checks} check${i.checks === 1 ? '' : 's'} to answer`,
    script: i.madeBy === 'self' ? 'Script approved — next: record' : 'Script approved — next: voice',
    audio: `Voice ${i.heard} of ${i.lines} lines approved`,
    'audio-approved': `Voice approved — next: ${make}`,
    final: 'Rendered — next: edit and finish',
  }[i.stage];
  return [next, i.format, i.registerDuration].filter(Boolean).join(' · ');
}
const STAGE_RANK = Object.fromEntries(['needs-script', 'draft-checks', 'draft-ready', 'script', 'audio', 'audio-approved', 'final', 'done'].map((s, i) => [s, i]));
const SORTS = [
  ['release', 'Release order'],
  ['priority', 'Priority'],
  ['stage', 'Stage — closest to done'],
  ['runtime', 'Shortest runtime'],
];
const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2 };
const WORKSTREAMS = ['Company', 'Outreach', 'Training', 'Wrapper', 'Editions', 'Investor', 'GTM masters'];

// The four things that have to be true before a video exists, in order.
const MARKS = [
  ['script', 'Script'], ['audio', 'Voice'], ['look', 'Look'], ['video', 'Video'],
];
const MARK_TEXT = {
  done: 'done', draft: 'waiting for your approval', partial: 'started', none: 'not started', 'n/a': 'not needed',
};
// A step that is done, or that this video does not need, is not left to do.
const settled = (state) => state === 'done' || state === 'n/a';

// The view lives in the address, so opening a video and pressing back returns
// to it. The last view is also remembered for when you come back by the nav.
const FILTER_KEYS = ['q', 'stage', 'pri', 'fmt', 'ws', 'co', 'need', 'sort'];
const VIEW_KEY = 'register-view';
function initialView() {
  let search = window.location.search;
  if (!search) { try { search = sessionStorage.getItem(VIEW_KEY) ?? ''; } catch { /* storage blocked */ } }
  const p = new URLSearchParams(search);
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, p.get(k) ?? '']));
}

const ROW = 'grid grid-cols-[86px_minmax(220px,1.7fr)_minmax(110px,.7fr)_34px_132px_repeat(4,46px)] gap-[10px] items-center p-[9px_14px] lte860:grid-cols-[64px_1fr_auto]';
const TAG = 'text-[10px] tracking-[.04em] uppercase font-semibold p-[3px_7px] rounded-[3px] whitespace-nowrap border border-solid text-center';

function Mark({ state, title }) {
  const base = 'mx-auto grid place-items-center w-[20px] h-[20px] rounded-full';
  if (state === 'done') return <span className={`${base} bg-ok text-[#fff]`} title={title}><Check size={12} strokeWidth={3} /></span>;
  if (state === 'draft' || state === 'partial') {
    return <span className={`${base} border-[2px] border-solid border-warn`} title={title}><span className="w-[8px] h-[8px] rounded-full bg-warn" /></span>;
  }
  if (state === 'n/a') return <span className={`${base} text-line-2`} title={title}><Minus size={12} /></span>;
  return <span className={`${base} border-[1.5px] border-solid border-line-2`} title={title} />;
}

/**
 * A compact filter: icon and current value in a pill, its name floating on the
 * top border. Set to anything but its neutral value, it darkens so an active
 * filter is visible from across the page.
 */
function FilterPill({ label, icon: Icon, value, onChange, options, groups = [], neutral = '', short = {} }) {
  const on = value !== neutral && value !== '';
  // A native select is as wide as its longest option; laid invisibly over a
  // label of the current value, the pill is only as wide as what it shows.
  const current = short[value] ?? options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <label className={'relative inline-flex items-center h-[32px] rounded-full border border-solid p-[0_26px_0_29px] text-[12.5px] whitespace-nowrap cursor-pointer max-w-[200px] '
      + (on ? 'bg-ink text-[#fff] border-ink' : 'bg-surface text-ink-2 border-line hover:border-line-2')}>
      <span className={'absolute left-[12px] top-[-6px] px-[4px] text-[9px] leading-[11px] font-semibold tracking-[.07em] uppercase pointer-events-none rounded-[3px] '
        + (on ? 'bg-ink text-[#fff]' : 'text-faint [background:linear-gradient(var(--canvas)_50%,var(--surface)_50%)]')}>
        {label}
      </span>
      <Icon size={13} className={`absolute left-[11px] pointer-events-none ${on ? 'text-[#fff]' : 'text-muted'}`} aria-hidden="true" />
      <span className="truncate">{current}</span>
      <ChevronDown size={12} className={`absolute right-[10px] pointer-events-none ${on ? 'text-[#fff]' : 'text-muted'}`} aria-hidden="true" />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer appearance-none">
        {options.map(([v, l]) => <option key={v || 'all'} value={v}>{l}</option>)}
        {groups.map(([g, names]) => (
          <optgroup key={g} label={g}>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/** Search as an icon until it is wanted; open while it holds a query. */
function SearchPill({ value, onChange }) {
  const [open, setOpen] = useState(!!value);
  const input = useRef(null);
  useEffect(() => { if (open && !value) input.current?.focus(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open && !value) {
    return (
      <button type="button" aria-label="Search the register" title="Search ID, title, company" onClick={() => setOpen(true)}
        className="w-[32px] h-[32px] p-0 rounded-full grid place-items-center border border-solid border-line bg-surface text-muted hover:border-line-2">
        <Search size={13} />
      </button>
    );
  }
  return (
    <label className="relative w-[200px]">
      <Search size={13} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
      <input ref={input} className="w-full text-[12.5px] h-[32px] p-[0_10px_0_29px] rounded-full" placeholder="ID, title, company"
        value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => !value && setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && (onChange(''), setOpen(false))} aria-label="Search the register" />
    </label>
  );
}

/**
 * The video register: every Video ID, where it really is, in release order.
 * What the workbook claims is kept beside what the app knows, so a "Reported
 * complete" with nothing behind it stays visible.
 */
export default function Register({ go, tabs }) {
  const { openProduction, mutate } = useStudio();
  const dialog = useDialog();
  const [batch, setBatch] = useState(null);
  const [data, setData] = useState(null);
  const [view, setView] = useState(initialView);
  const { q, stage, pri: priority, fmt: format, ws: stream, co: company, need } = view;
  const sort = view.sort || 'release';
  const set = (k) => (v) => setView((cur) => ({ ...cur, [k]: v }));
  const [setQ, setStage, setPriority, setFormat, setStream, setCompany, setNeed, setSort] =
    ['q', 'stage', 'pri', 'fmt', 'ws', 'co', 'need', 'sort'].map(set);

  useEffect(() => { api.register().then(setData).catch(() => setData({ items: [], totals: null })); }, []);

  // The overnight voice queue: checked every few seconds while it has work.
  const loadBatch = useCallback(() => api.voiceBatch().then(setBatch).catch(() => {}), []);
  useEffect(() => { loadBatch(); }, [loadBatch]);
  const batchBusy = batch && (batch.running || batch.queued > 0);
  // The Fit-to-time batch: drafts whose length is off, rewritten one at a time on this Mac.
  const [fit, setFit] = useState(null);
  const loadFit = useCallback(() => api.enhanceBatch().then(setFit).catch(() => {}), []);
  useEffect(() => { loadFit(); }, [loadFit]);
  useEffect(() => {
    if (!fit?.running) return undefined;
    const t = setInterval(loadFit, 5000);
    return () => clearInterval(t);
  }, [fit?.running, loadFit]);
  useEffect(() => {
    if (!batchBusy) return undefined;
    const t = setInterval(loadBatch, 5000);
    return () => clearInterval(t);
  }, [batchBusy, loadBatch]);

  useEffect(() => {
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) if (view[k] && !(k === 'sort' && view[k] === 'release')) p.set(k, view[k]);
    const search = p.toString() ? `?${p}` : '';
    try { sessionStorage.setItem(VIEW_KEY, search); } catch { /* storage blocked */ }
    if (window.location.search !== search) {
      try { window.history.replaceState(window.history.state, '', window.location.pathname + search); } catch { /* restricted */ }
    }
  }, [view]);
  // Leaving for another tab of this page: take the register's view out of the address.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const path = window.location.pathname;
      // A remount (StrictMode, or this tab chosen again) cancels it.
      setTimeout(() => {
        if (!mounted.current && window.location.pathname === path && window.location.search) {
          try { window.history.replaceState(window.history.state, '', path); } catch { /* restricted */ }
        }
      }, 0);
    };
  }, []);

  // Every filter except stage — the stage chips count within these.
  const base = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.items.filter((i) =>
      (!priority || i.priority === priority)
      && (!stream || i.workstream === stream)
      && (!company || i.company === company)
      && (!format || i.madeBy === (format === 'camera' ? 'heygen' : format))
      && (!need || !settled(i.marks?.[need]))
      && (!needle || [i.videoId, i.name, i.company, i.group, i.format].some((v) => v && v.toLowerCase().includes(needle))));
  }, [data, q, priority, stream, company, format, need]);

  const shown = useMemo(() => {
    const rows = base.filter((i) => !stage || i.stage === stage);
    if (sort === 'release') return rows;
    const at = new Map(rows.map((r, n) => [r.id, n]));
    const by = {
      priority: (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9),
      stage: (a, b) => STAGE_RANK[b.stage] - STAGE_RANK[a.stage],
      runtime: (a, b) => (a.runtimeSeconds || Infinity) - (b.runtimeSeconds || Infinity),
    }[sort];
    return by ? [...rows].sort((a, b) => by(a, b) || at.get(a.id) - at.get(b.id)) : rows;
  }, [base, stage, sort]);

  // Companies by vertical, as the Companies tab groups them.
  const companies = useMemo(() => {
    const groups = new Map();
    for (const i of data?.items ?? []) {
      if (!i.company) continue;
      const g = i.group || 'No group';
      if (!groups.has(g)) groups.set(g, new Set());
      groups.get(g).add(i.company);
    }
    return [...groups].sort(([a], [b]) => (a === 'No group') - (b === 'No group') || a.localeCompare(b))
      .map(([g, set]) => [g, [...set].sort((a, b) => a.localeCompare(b))]);
  }, [data]);

  const open = async (id) => { await openProduction(id); go('Create'); };
  const filtered = stage || priority || stream || company || format || need || q.trim();

  if (!data) return <><PageHead title="Register" tabs={tabs} /><p className="muted">Loading…</p></>;
  // Approved script, voice not finished, and the AI voice is part of how it is made.
  const voiceable = shown.filter((i) => ['script', 'audio'].includes(i.stage) && i.madeBy !== 'self');
  const queueVoice = async () => {
    if (!await dialog.confirm({ title: `Make the voice for ${voiceable.length} video${voiceable.length === 1 ? '' : 's'}?`,
      body: 'It is made on this Mac, free, a few seconds a line. You still listen to and approve every line.', confirmLabel: 'Make the voice' })) return;
    mutate(() => api.queueVoice(voiceable.map((i) => i.id)), (r) => setBatch(r.data)).catch(() => {});
  };
  const thin = new Set(fit?.thin ?? []);
  const fittable = shown.filter((i) => thin.has(i.id));
  const queueFit = async () => {
    if (!await dialog.confirm({ title: `Fit ${fittable.length} draft${fittable.length === 1 ? '' : 's'} to time?`,
      body: 'Each is rewritten on this Mac, about a minute a video, and kept as a new draft you can compare, keep or undo. Nothing is approved.', confirmLabel: 'Fit to time' })) return;
    mutate(() => api.queueEnhance(fittable.map((i) => i.id)), (r) => setFit((f) => ({ ...f, ...r.data })), { silent: true }).catch(() => {});
  };
  const fitNow = fit?.items.find((b) => b.state === 'running');
  const now = batch?.items.find((b) => b.state === 'running');
  const t = data.totals;
  const count = (key) => shown.filter((i) => settled(i.marks?.[key])).length;
  const stageCount = (id) => base.filter((i) => i.stage === id).length;

  return (
    <>
      <PageHead
        title="Register"
        tabs={tabs}
        lead="Every video and where it really stands."
      />

      {/* One row: the stage as a segmented queue, then search and compact
          filters whose names float on their borders, then the count. */}
      <div className="flex flex-wrap items-center gap-[12px_8px] mt-[6px]">
        {t && (
          <div className="inline-flex rounded-full border border-solid border-line bg-surface p-[2px]" role="group" aria-label="Filter by stage">
            {[{ id: '', label: 'All', n: base.length }, ...STAGES.filter((s) => t.stages[s.id] || stage === s.id).map((s) => ({ ...s, n: stageCount(s.id) }))].map((s) => (
              <button key={s.id || 'all'} type="button" aria-pressed={stage === s.id}
                onClick={() => setStage(stage === s.id || !s.id ? '' : s.id)}
                className={'text-[12px] leading-none h-[26px] p-[0_10px] rounded-full [border:0] cursor-pointer whitespace-nowrap [transition:background_.12s] '
                  + (stage === s.id ? 'bg-ink text-[#fff]' : 'bg-transparent text-ink-2 hover:bg-surface-2')}>
                {s.label} <span className={'[font-variant-numeric:tabular-nums] ' + (stage === s.id ? 'opacity-75' : 'text-faint')}>{s.n}</span>
              </button>
            ))}
          </div>
        )}
        <span className="w-[4px]" aria-hidden="true" />
        <SearchPill value={q} onChange={setQ} />
        <FilterPill label="Priority" icon={Flag} value={priority} onChange={setPriority}
          options={[['', 'All'], ['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3']]} />
        <FilterPill label="Made by" icon={Clapperboard} value={format === 'camera' ? 'heygen' : format} onChange={setFormat}
          options={[['', 'All'], ['heygen', 'HeyGen'], ['self', 'Recorded by me'], ['voice', 'Voice-over']]} short={{ self: 'By me' }} />
        <FilterPill label="Stream" icon={Layers} value={stream} onChange={setStream}
          options={[['', 'All'], ...WORKSTREAMS.map((w) => [w, w])]} />
        <FilterPill label="Company" icon={Building2} value={company} onChange={setCompany}
          options={[['', 'All']]} groups={companies} />
        <FilterPill label="Sort" icon={ArrowUpDown} value={sort} onChange={setSort} neutral="release" options={SORTS}
          short={{ release: 'Release', stage: 'Closest to done', runtime: 'Shortest' }} />
        {filtered && (
          <button className="ghostbtn text-[12px] text-accent p-[2px_4px]" title="Clear every filter (keeps the sort)"
            onClick={() => setView((cur) => ({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])), sort: cur.sort }))}>
            <X size={12} /> Clear
          </button>
        )}
        <span className="flex items-center gap-[10px] ml-auto">
          <span className="text-faint text-[11.5px] [font-variant-numeric:tabular-nums] whitespace-nowrap">{shown.length} of {data.items.length}</span>
          {fittable.length > 0 && !fit?.running && (
            <button className="text-[12px] p-[5px_11px]" onClick={queueFit}
              title="Drafts shown here whose length is off for their target — rewritten section by section on this Mac, kept as new drafts">
              <Sparkles size={13} className="text-accent" /> Fit {fittable.length === 1 ? 'this draft' : `${fittable.length} drafts`} to time
            </button>
          )}
          {/* An action, not a filter: only offered when there is voice to make. */}
          {voiceable.length > 0 && !batchBusy && (
            <button className="text-[12px] p-[5px_11px]" onClick={queueVoice}
              title="Videos shown here with an approved script whose voice is not finished — made free on this Mac">
              <Headphones size={13} /> Make the voice for {voiceable.length === 1 ? 'this video' : `these ${voiceable.length}`}
            </button>
          )}
        </span>
      </div>

      {fit?.items.length > 0 && (
        <p className="flex flex-wrap items-center gap-[10px] text-[12px] m-[10px_0_0] text-ink-2">
          <Sparkles size={13} className="text-accent" />
          {fit.running ? (
            <span>Fitting drafts to time: {fit.items.filter((b) => ['done', 'failed', 'skipped'].includes(b.state)).length} of {fit.items.filter((b) => b.state !== 'cancelled').length}
              {fitNow && <> · now {fitNow.title.split(' — ')[0]}</>}</span>
          ) : (
            <span>Fit to time finished: {fit.items.filter((b) => b.state === 'done').length} new drafts to compare and approve in Review
              {fit.items.some((b) => b.state === 'failed') && <span className="text-warn"> · {fit.items.filter((b) => b.state === 'failed').length} could not reach the length</span>}</span>
          )}
          {fit.running && <button className="ghostbtn text-[12px] text-danger p-0" onClick={() => mutate(() => api.stopEnhanceBatch(), (r) => setFit((f) => ({ ...f, ...r.data }))).catch(() => {})}>Stop</button>}
        </p>
      )}
      {batch?.items.length > 0 && (
        <p className="flex flex-wrap items-center gap-[10px] text-[12px] m-[10px_0_0] text-ink-2">
          <Headphones size={13} className="text-muted" />
          {batchBusy ? (
            <span>Voice batch: {batch.items.filter((b) => ['done', 'failed', 'skipped'].includes(b.state)).length} of {batch.items.filter((b) => b.state !== 'cancelled').length} videos done
              {now && <> · now {now.title.split(' — ')[0]}, line {Math.min(now.done + 1, now.total)} of {now.total}</>}</span>
          ) : (
            <span>Voice batch finished: {batch.items.filter((b) => b.state === 'done').length} made, ready to listen to and approve
              {batch.items.some((b) => b.state === 'skipped') && <> · {batch.items.filter((b) => b.state === 'skipped').length} skipped</>}
              {batch.items.some((b) => b.failed) && <span className="text-warn"> · {batch.items.reduce((n, b) => n + b.failed, 0)} lines failed</span>}</span>
          )}
          {batchBusy && <button className="ghostbtn text-[12px] text-danger p-0" onClick={() => mutate(() => api.stopVoiceBatch(), (r) => setBatch(r.data)).catch(() => {})}>Stop</button>}
        </p>
      )}

      <section className="overflow-clip mt-[12px] border border-solid border-line rounded-lg bg-surface [box-shadow:var(--shadow)]"
        aria-label="Video register">
        <div className={`${ROW} sticky top-[var(--appbar-h,53px)] z-[5] rounded-t-lg min-h-[36px] bg-surface-2 lte880:static [border-bottom:1px_solid_var(--line)] text-faint text-[10px] font-semibold tracking-[.06em] uppercase lte860:hidden`}>
          <span>ID</span><span>Video</span><span>Company</span><span>Pri</span><span>Stage</span>
          {MARKS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={need === k} onClick={() => setNeed(need === k ? '' : k)}
              title={need === k ? `Showing videos whose ${l.toLowerCase()} is not done — click to show all` : `${count(k)} of ${shown.length} done — click to show only the ones left`}
              className={'text-center p-[3px_0] rounded-[4px] [border:0] text-[10px] font-semibold tracking-[.06em] uppercase cursor-pointer '
                + (need === k ? 'bg-ink text-[#fff]' : 'bg-transparent text-faint hover:bg-surface hover:text-ink-2')}>
              {l}<span className={'block text-[9.5px] font-normal tracking-normal normal-case ' + (need === k ? 'text-[#fff] opacity-80' : 'text-faint')}>
                {need === k ? 'not done' : `${count(k)}/${shown.length}`}
              </span>
            </button>
          ))}
        </div>

        {shown.length === 0 && <p className="p-[18px_14px] text-muted text-[12.5px]">Nothing matches these filters.</p>}

        {shown.map((i) => {
          const s = stageOf(i.stage);
          // The workbook says done but the app has no evidence of it.
          const claimed = /complete/i.test(i.register.overall ?? '') && i.stage !== 'done';
          const sub = nowLine(i);
          const subTitle = i.scriptStatus ? `${sub}\nWorkbook: ${i.scriptStatus}` : sub;
          return (
            <button key={i.id} type="button" onClick={() => open(i.id)}
              className={`${ROW} w-full text-left bg-transparent [border:0] rounded-none [&+&]:[border-top:1px_solid_var(--line)] hover:bg-surface-2`}>
              <code className="text-[11.5px] font-[600] text-ink-2 break-all" title={i.inRegister ? '' : 'From the script pack — not a register row'}>
                {i.videoId}{!i.inRegister && <sup className="text-faint font-normal"> pack</sup>}
              </code>
              <span className="min-w-0">
                <b className="flex items-center gap-[6px] text-[13px] font-[560] min-w-0">
                  <span className="truncate" title={i.name}>{i.name}</span>
                  <span className="flex-none text-faint" title={i.selfRecorded ? 'Recorded by you' : i.voiceOnly ? 'Voice-over — no one on screen' : 'HeyGen avatar'}>
                    {i.selfRecorded ? <Video size={12} /> : i.voiceOnly ? <Mic size={12} /> : <User size={12} />}
                  </span>
                </b>
                <small className="block truncate text-faint text-[11px]" title={subTitle}>{sub}</small>
              </span>
              <span className="truncate text-[12px] text-ink-2 lte860:hidden" title={i.group ?? ''}>{i.company}</span>
              <span className={`text-[11.5px] font-[600] lte860:hidden ${i.priority === 'P1' ? 'text-danger' : 'text-muted'}`}>{i.priority}</span>
              <span className="flex items-center gap-[5px]">
                <span className={`${TAG} ${s.tone}`}>{s.label}</span>
                {i.checks > 0 && i.stage !== 'done' && (
                  <span className="text-[11px] text-warn font-[600] [font-variant-numeric:tabular-nums]" title={`${i.checks} open [CONFIRM] check${i.checks === 1 ? '' : 's'}`}>
                    {i.checks}
                  </span>
                )}
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
        <span className="flex items-center gap-[5px]"><Mark state="n/a" /> not needed (voice-over or recorded by you)</span>
        <span>Click Script, Audio, Look or Video to see only what is left.</span>
      </p>
    </>
  );
}
