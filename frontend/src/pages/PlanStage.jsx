import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Clock, Video, Upload, FileText, Link, FolderKanban,
  Lock, Check, AlertCircle, Trash2, RefreshCw,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { toSeconds, toClock } from '../utils/format.js';
import { api } from '../services/api.js';
import ShotList from '../components/ShotList.jsx';
import { SELF_RECORDED, madeByOf, madeByLabel } from '../utils/made-by.js';

// Plan details: the brief, the outline, the shot list and the sources. Opened
// from the Script step; most videos never need more than the brief line there.
const VIEWS = ['Brief', 'Outline', 'Visuals', 'Sources'];

export default function PlanStage({ goToStage, initialView = 'Brief' }) {
  const [view, setView] = useState(initialView);
  const { production } = useStudio();

  return (
    <div className="workspace planning">
      <aside>
        <b>PLAN DETAILS</b>
        {VIEWS.map((v) => (
          <button key={v} className={view === v ? 'sel' : ''} onClick={() => setView(v)}>{v}</button>
        ))}
      </aside>

      <section>
        {view === 'Brief' && <Brief goToStage={goToStage} />}
        {view === 'Outline' && <Outline goToStage={goToStage} />}
        {view === 'Visuals' && <><StaleNote stale={production.stale} goToStage={goToStage} /><ShotList /></>}
        {view === 'Sources' && <Sources />}
      </section>
    </div>
  );
}

// Not an error: the expected result of editing a plan that already has work
// downstream. It states what is affected and offers the next step.
const STALE_STAGE = { script: 'Script', render: 'Render', export: 'Edit', publication: 'Publish' };
const STALE_ORDER = ['script', 'render', 'export', 'publication'];

function StaleNote({ stale, goToStage }) {
  const keys = STALE_ORDER.filter((k) => stale?.[k]);
  if (!keys.length) return null;

  const first = keys[0];
  const list = keys
    .map((k) => `${stale[k].count} ${k}${stale[k].count > 1 ? 's' : ''}`)
    .join(', ');

  return (
    <div className="stalebar">
      <RefreshCw size={15} />
      <span>
        <b>Plan changed since this work was made.</b>{' '}
        {list} now {keys.length === 1 && stale[first].count === 1 ? 'reflects' : 'reflect'} an
        older plan. Nothing was deleted — regenerate whenever you are ready.
      </span>
      {goToStage && (
        <button onClick={() => goToStage(STALE_STAGE[first])}>
          Go to {STALE_STAGE[first]}
        </button>
      )}
    </div>
  );
}

// The brief is read in three parts: what the video says (editable, and what
// the script is written from), what the register and script pack record about
// it (read here, changed at their source), and template plumbing (folded away).
const BRIEF_GROUPS = [
  { key: 'video', title: 'The video', labels: ['Audience', 'Goal', 'CTA', 'Format', 'Target runtime'] },
  { key: 'facts', title: 'What we know', labels: ['Company', 'Website', 'Tagline', 'Source summary', 'Proposed demonstration', 'Competitive advantage', 'Core offer', 'Problems solved', 'Who we are reaching', 'Objections to expect'] },
];
const RECORD = /^(Register ID|Register duration|Priority|Status: .*|Existing asset|Script link|Audio link|Final link|Owner \/ next action|Completed asset|Completed confirmed|Final file|Transcript|Script status|Script source|Script review notes|Script length|Script pack ID|Script pack only|Checks pending|Visual plan|Pre-voiceover notes)$/;
const PLUMBING = /^(Template|Type|Primary output|Clip extraction)$/;
const LONG = 90;
const STATUS_TONE = (v) => (/complete|approved|verified|published|done/i.test(v) && !/not /i.test(v) ? 'text-ok' : /needs|pending|not /i.test(v) ? 'text-warn' : 'text-ink-2');

function BriefField({ f, onSave }) {
  const long = (f.value ?? '').length > LONG || /summary|advantage|demonstration|objections|offer|problems/i.test(f.label);
  const Tag = long ? 'textarea' : 'input';
  return (
    <label className={'flex flex-col gap-[4px] text-muted text-[11.5px] font-semibold' + (long ? ' col-span-2 lte800:col-span-1' : '')}>
      {f.label}
      <Tag
        className={'font-normal text-[13.5px] text-ink' + (long ? ' min-h-[64px] resize-y leading-[1.5]' : '')}
        rows={long ? Math.min(6, Math.ceil((f.value ?? '').length / 110) + 1) : undefined}
        defaultValue={f.value}
        onBlur={(e) => e.target.value !== f.value && onSave(f, e.target.value)}
      />
    </label>
  );
}

function Brief({ goToStage }) {
  const { production, applyProduction, mutate } = useStudio();
  const [showPlumbing, setShowPlumbing] = useState(false);
  const save = (f, value) => mutate(() => api.updateBrief(production.id, f.id, value), applyProduction).catch(() => {});
  const byLabel = Object.fromEntries(production.brief.map((f) => [f.label, f]));
  const grouped = new Set(BRIEF_GROUPS.flatMap((g) => g.labels));
  const record = production.brief.filter((f) => RECORD.test(f.label) && f.value);
  const plumbing = production.brief.filter((f) => PLUMBING.test(f.label));
  const other = production.brief.filter((f) => !grouped.has(f.label) && f.label !== 'Verify first' && !RECORD.test(f.label) && !PLUMBING.test(f.label));
  const verify = byLabel['Verify first']?.value;
  const rec = (l) => byLabel[l]?.value;
  const statuses = production.brief.filter((f) => /^Status: /.test(f.label));

  return (
    <>
      <div className="sectiontitle">
        <div>
          <h2>Brief</h2>
          <p>What this video has to say, and to whom. The script is written from this.</p>
        </div>
        {rec('Register ID') && (
          <span className="flex items-center gap-[8px] text-[12px] text-muted">
            <code className="text-[11.5px] font-semibold text-ink-2 bg-canvas border border-solid border-line rounded-[4px] p-[2px_7px]">{rec('Register ID')}</code>
            {rec('Priority') && <span className={rec('Priority') === 'P1' ? 'text-danger font-semibold' : ''}>{rec('Priority')}</span>}
            {rec('Register duration') && <span>· {rec('Register duration')}</span>}
          </span>
        )}
      </div>
      <StaleNote stale={production.stale} goToStage={goToStage} />

      {verify && (
        <div className="notice warn items-start">
          <AlertCircle />
          <span><b>Verify before recording.</b> {verify}</span>
        </div>
      )}


      {BRIEF_GROUPS.map((g) => {
        const fields = g.labels.map((l) => byLabel[l]).filter(Boolean);
        if (!fields.length) return null;
        return (
          <section key={g.key} className="mt-[18px]">
            <h3 className="text-[11px] tracking-[.07em] uppercase text-faint font-semibold m-[0_0_8px]">{g.title}</h3>
            <div className="grid grid-cols-[1fr_1fr] gap-[12px_14px] lte800:grid-cols-[1fr]">
              {fields.map((f) => <BriefField key={f.id} f={f} onSave={save} />)}
            </div>
          </section>
        );
      })}

      {other.length > 0 && (
        <section className="mt-[18px]">
          <h3 className="text-[11px] tracking-[.07em] uppercase text-faint font-semibold m-[0_0_8px]">More</h3>
          <div className="grid grid-cols-[1fr_1fr] gap-[12px_14px] lte800:grid-cols-[1fr]">
            {other.map((f) => <BriefField key={f.id} f={f} onSave={save} />)}
          </div>
        </section>
      )}

      {record.length > 0 && (
        <section className="mt-[22px] border border-solid border-line rounded-lg bg-surface-2 p-[12px_14px]">
          <h3 className="text-[11px] tracking-[.07em] uppercase text-faint font-semibold m-[0_0_10px]">On record</h3>
          {statuses.length > 0 && (
            <div className="flex flex-wrap gap-x-[18px] gap-y-[6px] mb-[10px] text-[12px]">
              {statuses.map((f) => (
                <span key={f.id} className="whitespace-nowrap">
                  <span className="text-muted">{f.label.replace('Status: ', '')}:</span>{' '}
                  <b className={`font-[560] ${STATUS_TONE(f.value)}`}>{f.value}</b>
                </span>
              ))}
            </div>
          )}
          <dl className="grid grid-cols-[150px_1fr] gap-[5px_12px] m-0 text-[12.5px] lte800:grid-cols-[1fr]">
            {record.filter((f) => !/^(Status: |Register ID|Priority|Register duration|Completed )/.test(f.label)).map((f) => (
              <React.Fragment key={f.id}>
                <dt className="text-muted">{f.label}</dt>
                <dd className="m-0 text-ink-2 min-w-0 break-words">
                  {/^https?:\/\//.test(f.value)
                    ? <a href={f.value} target="_blank" rel="noreferrer" className="text-accent underline">{f.value.length > 70 ? `${f.value.slice(0, 70)}…` : f.value}</a>
                    : f.value}
                </dd>
              </React.Fragment>
            ))}
          </dl>
          <p className="text-faint text-[11px] m-[10px_0_0]">Kept from the register and the script pack. Change these at their source and re-import.</p>
        </section>
      )}

      {plumbing.length > 0 && (
        <>
          <button type="button" className="ghostbtn text-[12px] text-muted p-[3px_0] mt-[14px]" onClick={() => setShowPlumbing((v) => !v)}>
            {showPlumbing ? 'Hide' : 'Show'} template settings ({plumbing.map((f) => f.value).filter(Boolean).join(' · ')})
          </button>
          {showPlumbing && (
            <div className="grid grid-cols-[1fr_1fr] gap-[12px_14px] mt-[8px] lte800:grid-cols-[1fr]">
              {plumbing.map((f) => <BriefField key={f.id} f={f} onSave={save} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}

// Outline rows and scene rows share one grid shape: a trailing delete button
// and meta spans that drop out at narrow widths. The button rules sit on the
// row (not the button) so they keep out-ranking the generic button:hover.
const ROW = 'grid items-center lte800:grid-cols-[26px_1fr]'
  + ' [&>button:last-child]:border-0 [&>button:last-child]:border-none [&>button:last-child]:border-current'
  + ' [&>button:last-child]:bg-transparent [&>button:last-child]:text-faint [&>button:last-child]:p-[5px]'
  + ' [&>button:last-child:hover]:text-danger [&>button:last-child:hover]:bg-danger-soft';
const OUTLINE_ROW = 'group/row grid-cols-[24px_minmax(0,1fr)_auto_auto_28px] gap-[10px] border border-solid border-line rounded m-[4px_0] bg-surface hover:border-line-2';
const ROW_META = 'flex items-center gap-[5px] text-[12px] text-muted lte800:hidden [&_svg]:w-[13px] [&_svg]:h-[13px]';

// Who appears in a section. Every video in this slate is PJB — an avatar on
// camera, the voice over a screen recording, or filmed by you; the label is
// what the script's speaker ("Pat") is cast from, so it is chosen, never typed.
const WHO = [
  // The same words as How it's made, so one choice never reads as two.
  ['Pat', 'You — HeyGen avatar'],
  ['Pat (voice only)', 'You — voice-over'],
  [SELF_RECORDED, 'You — recorded yourself'],
  ['Pat + Guest', 'You + a guest'],
  ['Avatar', 'Avatar presenter'],
  ['Avatar + Avatar', 'Two avatar presenters'],
  ['Visuals only', 'No one — visuals only'],
];
function WhoAppears({ value, onChange }) {
  const known = WHO.some(([v]) => v === value);
  return (
    <label className={ROW_META + ' whitespace-nowrap !flex'}>
      <Users aria-hidden="true" />
      <select
        className={'text-[12px] p-[3px_6px] min-w-[150px]' + (value && known ? '' : ' text-warn')}
        value={known ? value : ''}
        aria-label="Who appears in this section"
        onChange={(e) => e.target.value && onChange(e.target.value)}
      >
        <option value="">{value ? `${value} — choose who` : 'Choose who appears'}</option>
        {WHO.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </label>
  );
}

function Outline({ goToStage }) {
  const { production, applyProduction, mutate } = useStudio();
  const planned = production.outline.reduce((n, s) => n + toSeconds(s.runtime), 0);
  const target = toSeconds(production.targetRuntime);
  const drift = planned - target;

  return (
    <>
      <div className="sectiontitle">
        <div>
          <h2>Outline</h2>
          <p>Structure and allocate runtime before writing dialogue.</p>
        </div>
        <button onClick={() => mutate(() => api.addSection(production.id, {}), applyProduction)}>+ Section</button>
      </div>

      <StaleNote stale={production.stale} goToStage={goToStage} />

      <p className="text-[12.5px] text-muted m-[0_0_10px]">
        Made by: <b className="text-ink-2 font-[560]">{madeByLabel(madeByOf(production))}</b>
        {' '}— chosen under How it's made; set a single section differently here.
      </p>

      <div className={'runtime' + (drift ? ' off' : '')}>
        <Clock /> Target {production.targetRuntime}
        <b>
          Planned {toClock(planned)}
          {drift !== 0 && <em>{drift > 0 ? '+' : '−'}{toClock(Math.abs(drift))}</em>}
        </b>
      </div>

      {production.outline.map((s, i) => (
        <div className={ROW + ' ' + OUTLINE_ROW + (s.purpose ? ' p-[9px_10px]' : ' p-[6px_10px]')} key={s.id}>
          <b className="font-mono text-[11px] text-faint font-medium">{String(i + 1).padStart(2, '0')}</b>
          <div className="min-w-0">
            <input
              className="w-full [font-variant-numeric:tabular-nums] text-left border-transparent bg-transparent font-[560] text-[13.5px] p-[3px_5px] m-[-3px_0_0_-5px] hover:border-line focus:border-accent focus:bg-surface"
              defaultValue={s.title}
              onBlur={(e) => {
                if (e.target.value !== s.title) {
                  mutate(() => api.updateSection(production.id, s.id, { title: e.target.value }), applyProduction);
                }
              }}
            />
            {/* Only a real purpose earns a second line. The placeholder sentence
                said the same nothing on every row and made each one 67px tall. */}
            {s.purpose && <small className="block text-muted text-[12px] mt-[2px]">{s.purpose}</small>}
          </div>
          <WhoAppears
            value={s.participants}
            onChange={(v) => mutate(() => api.updateSection(production.id, s.id, { participants: v }), applyProduction)}
          />
          {/* The row's width:100% always beat the old 62px here, so 100% it is. */}
          <input
            className="w-full [font-variant-numeric:tabular-nums] text-center p-[5px_6px] lte800:hidden"
            defaultValue={s.runtime}
            aria-label="Runtime"
            onBlur={(e) => {
              if (e.target.value !== s.runtime) {
                mutate(() => api.updateSection(production.id, s.id, { runtime: e.target.value }), applyProduction);
              }
            }}
          />
          <button
            className="opacity-0 [transition:opacity_.12s] group-hover/row:opacity-100 focus-visible:opacity-100"
            title="Remove section"
            onClick={() => mutate(() => api.deleteSection(production.id, s.id), applyProduction)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div className="actions">
        <button onClick={() => mutate(() => api.rebalance(production.id), applyProduction)}>
          Rebalance timings
        </button>
        <button
          className="primary"
          disabled={production.outlineApproved}
          onClick={() => mutate(() => api.approveOutline(production.id), applyProduction)}
        >
          {production.outlineApproved ? <><Check size={15} /> Outline approved</> : 'Approve outline'}
        </button>
      </div>
    </>
  );
}

const ANALYSER_INPUT = 'flex-1 font-mono text-[12.5px] font-normal not-italic leading-[normal] p-[7px_9px]';

// Finding rows keep their level class; the level only picks a colour.
const findingClass = (level) => level
  + ' flex items-start gap-[7px] text-[13px] [&>svg]:flex-none [&>svg]:mt-[2px]'
  + (level === 'warn' ? ' text-warn' : ' text-ink-2')
  + (level === 'info' ? ' [&>svg]:text-ok' : '');

function Sources() {
  const { production, applyProduction, mutate, workspace } = useStudio();
  const canImportVideo = workspace.capabilities.includes('source.existing_video');

  const [state, setState] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [path, setPath] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  // The desktop shell exposes exactly one thing here: a native file picker.
  const desktop = typeof window !== 'undefined' && window.studio?.desktop;

  const choose = async () => {
    const picked = await window.studio.pickVideo();
    if (picked) setPath(picked);
  };

  const load = useCallback(async () => {
    const [analysis, flow] = await Promise.all([
      api.analysis(production.id),
      api.workflow(production.id),
    ]);
    setState(analysis);
    setWorkflow(flow);
  }, [production.id]);
  useEffect(() => { load(); }, [load]);

  const add = (name, kind) =>
    mutate(() => api.addSource(production.id, { name, detail: 'Added by hand', kind }), applyProduction);

  const measure = async () => {
    setBusy(true);
    try { await mutate(() => api.analyseVideo(production.id, path), null); await load(); }
    catch { /* mutate reports it */ }
    finally { setBusy(false); }
  };

  const research = async () => {
    setBusy(true);
    try {
      await mutate(() => api.researchWebsite(production.id, website), (res) => setWorkflow(res.data));
      setWebsite('');
      const opened = await api.openProduction(production.id);
      applyProduction(opened);
    } catch { /* mutate reports it */ }
    finally { setBusy(false); }
  };

  const approveResearch = async (item) => {
    try {
      await mutate(
        () => api.reviewResearch(production.id, item.id, true),
        (res) => setWorkflow(res.data)
      );
      // Research may have filled empty brief fields, so refresh the production
      // rather than leaving Brief one save behind the evidence on this page.
      applyProduction(await api.openProduction(production.id));
    } catch { /* mutate reports it */ }
  };

  const analysed = state?.sources.find((s) => s.analysis);
  const a = analysed?.analysis;

  return (
    <>
      <h2>Sources</h2>
      <p>Everything the Producer may use to plan this production, with the website claims preserved for review.</p>

      <div className="border border-solid border-line rounded-lg p-[14px] m-[14px_0] bg-surface-2">
        <label className="block text-[12px] font-semibold mb-[7px]">Research a website</label>
        <div className="flex gap-[8px]">
          <input
            className={ANALYSER_INPUT}
            type="text"
            inputMode="url"
            placeholder="https://example.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && website.trim() && !busy && research()}
          />
          <button className="primary" onClick={research} disabled={!website.trim() || busy}>
            <Link size={13} /> {busy ? 'Researching…' : 'Research website'}
          </button>
        </div>
        <small className="block text-faint text-[11.5px] mt-[7px] leading-[1.5]">The app reads the public page, stores the evidence it used, and proposes brief fields. You approve it before it can unlock production.</small>
      </div>

      {workflow?.research.map((item) => (
        <div className={'border border-solid rounded-lg p-[14px] m-[12px_0] bg-surface ' + item.status + (item.status === 'failed' ? ' border-line border-l-[3px] border-l-danger' : ' border-line')} key={item.id}>
          <div className="flex justify-between gap-[16px] items-start">
            <div className="min-w-0 flex flex-col gap-[3px]">
              <b className="text-[13.5px]">{item.title || item.url}</b>
              <a className="font-mono text-[11px] font-normal not-italic leading-[normal] text-muted overflow-hidden text-ellipsis" href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
            </div>
            <span className={'rstatus ' + (item.reviewed ? 'complete' : item.status)}>
              {item.reviewed ? 'approved' : item.status}
            </span>
          </div>
          {item.error && <p className="dangerv text-[12.5px] leading-[1.55] flex items-start gap-[6px] text-danger"><AlertCircle size={13} /> {item.error}</p>}
          {item.evidence?.summary && <p className="text-[12.5px] leading-[1.55] text-ink-2">{item.evidence.summary}</p>}
          {item.evidence?.headings?.length > 0 && (
            <div className="flex flex-wrap gap-[5px] m-[9px_0]">
              {item.evidence.headings.slice(0, 8).map((heading, i) => <span className="p-[3px_7px] border border-solid border-line rounded-[20px] text-muted text-[10.5px]" key={`${heading}-${i}`}>{heading}</span>)}
            </div>
          )}
          {Object.keys(item.suggestedBrief ?? {}).length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-[5px_10px] p-[10px_0] m-0">
              {Object.entries(item.suggestedBrief).map(([label, value]) => (
                <React.Fragment key={label}><dt className="text-faint text-[10px] uppercase tracking-[.04em]">{label}</dt><dd className="m-0 text-[12px] text-ink-2">{value}</dd></React.Fragment>
              ))}
            </dl>
          )}
          {item.status === 'complete' && !item.reviewed && (
            <button className="primary" onClick={() => approveResearch(item)}>
              <Check size={13} /> Approve evidence + fill empty brief fields
            </button>
          )}
          {item.status === 'failed' && (
            <button onClick={async () => {
              try {
                await mutate(
                  () => api.deleteResearch(production.id, item.id),
                  (res) => setWorkflow(res.data)
                );
                applyProduction(await api.openProduction(production.id));
              } catch { /* mutate reports it */ }
            }}>
              <Trash2 size={13} /> Remove failed source
            </button>
          )}
        </div>
      ))}

      {/* Measuring a video you already have. Every number below comes from
          ffmpeg on this machine — nothing is uploaded and no key is used. */}
      <div className="m-[16px_0] p-[14px] border border-solid border-line rounded bg-surface-2">
        <label className="block text-[11px] font-semibold tracking-[.04em] uppercase text-muted mb-[8px]">Analyse a video you already have</label>
        <div className="flex gap-[8px]">
          {/* In the desktop build the user picks the file in a native dialog.
              In a browser there is no such thing: a file input reports a name,
              never a location, so the path has to be typed. */}
          {desktop ? (
            <button onClick={choose}>
              <Upload size={13} /> {path ? 'Choose a different file' : 'Choose a video…'}
            </button>
          ) : (
            <input
              className={ANALYSER_INPUT}
              placeholder="/Users/you/Movies/interview.mp4"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && path && canImportVideo && measure()}
            />
          )}
          <button className="primary" onClick={measure}
            disabled={!path || busy || !canImportVideo}
            title={canImportVideo ? '' : 'Requires a Content or Studio licence'}>
            {canImportVideo
              ? (busy ? 'Measuring…' : 'Measure')
              : <><Lock size={13} /> Not licensed</>}
          </button>
        </div>
        {desktop && path && <code className="block mt-[7px] font-mono text-[11px] font-normal not-italic leading-[normal] text-muted overflow-hidden text-ellipsis whitespace-nowrap">{path}</code>}
        <small className="block mt-[7px] text-faint text-[11.5px]">
          {desktop ? 'Read in place — the file is not copied.' : 'A full path.'}
          {' '}Measured locally with ffmpeg — nothing leaves this machine.
          {state && !state.transcriber && ' No local transcriber is installed, so there will be no transcript.'}
        </small>
      </div>

      {a && (
        <div className="analysis">
          <div className="flex flex-wrap gap-[14px] p-[10px_14px] bg-surface-2 border-b border-b-line [border-bottom-style:solid] text-[12.5px] text-ink-2">
            <span><b>{a.facts.name}</b></span>
            {a.facts.video && <span>{a.facts.video.width}×{a.facts.video.height} · {a.facts.video.fps}fps</span>}
            <span>{a.facts.duration ? `${Math.round(a.facts.duration)}s` : 'unknown length'}</span>
            <span>{a.facts.audio ? `${a.facts.audio.codec} ${a.facts.audio.channels}ch` : 'no audio'}</span>
            {a.facts.bytes && <span>{(a.facts.bytes / 1024 / 1024).toFixed(1)} MB</span>}
          </div>

          <ul className="list-none m-0 p-[10px_14px] flex flex-col gap-[6px]">
            {a.findings.map((f, i) => (
              <li key={i} className={findingClass(f.level)}>
                {f.level === 'warn' ? <AlertCircle size={13} /> : <Check size={13} />} {f.text}
              </li>
            ))}
            <li className={findingClass(a.transcript ? 'info' : 'warn')}>
              <AlertCircle size={13} /> {a.transcriptNote}
            </li>
          </ul>

          {a.outline.length > 0 && (
            <div className="flex flex-col gap-[5px] items-start p-[12px_14px] border-t border-t-line [border-top-style:solid]">
              <b className="text-[12.5px]">{a.outline.length} section{a.outline.length === 1 ? '' : 's'} measured from the shot changes</b>
              {a.outline.map((o) => (
                <span className="font-mono text-[11.5px] font-normal not-italic leading-[normal] text-muted" key={o.position}>{o.title} · {o.startsAt} · {o.runtime}</span>
              ))}
              <button className="mt-[6px]" onClick={() => mutate(() => api.adoptAnalysisOutline(production.id), null)
                .then(() => window.location.reload())}>
                Replace the outline with this
              </button>
              <small className="text-faint text-[11px]">This overwrites the outline you have now.</small>
            </div>
          )}
        </div>
      )}

      <div className="cards">
        {[[Upload, 'Upload file / video', 'file'],
          [FileText, 'Paste text', 'text'], [FolderKanban, 'Choose from Library', 'library']]
          .map(([I, t, kind]) => (
            <div className="card cursor-pointer hover:border-ink" key={t} onClick={() => add(t, kind)}>
              <I /><b>{t}</b>
            </div>
          ))}
      </div>

      {production.sources.map((s) => (
        <div className="source" key={s.id}>
          <Video />
          <div>
            <b>{s.name}</b>
            <small>{s.detail}</small>
          </div>
        </div>
      ))}
    </>
  );
}

