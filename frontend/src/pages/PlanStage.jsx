import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Users, Clock, Video, Upload, FileText, Link, FolderKanban,
  Lock, Check, AlertCircle, UserPlus, Trash2, X, RefreshCw, Image as ImageIcon,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { toSeconds, toClock } from '../utils/format.js';
import { api } from '../services/api.js';
import UploadDrop from '../components/UploadDrop.jsx';
import { SELF_RECORDED, isSelfRecorded } from '../utils/self-recorded.js';

// People and Appearance were two steps for one decision; they are one now.
const VIEWS = ['Brief', 'Outline', 'Visuals', 'People & look', 'Sources', 'Decisions'];

export default function PlanStage({ goToStage }) {
  const [view, setView] = useState('Outline');
  const [producer, setProducer] = useState(null);
  const { production, applyProduction, mutate } = useStudio();

  const askProducer = async () => {
    setProducer('loading');
    setProducer(await api.producer(production.id));
  };

  return (
    <div className="workspace planning">
      <aside>
        <b>PLAN</b>
        {VIEWS.map((v) => (
          <button key={v} className={view === v ? 'sel' : ''} onClick={() => setView(v)}>{v}</button>
        ))}
        <hr />
        <small>AI PRODUCER</small>
        <p className="muted">Runs a deterministic production check. It flags only decisions that still need you.</p>
        <button className="producer" onClick={askProducer}><Sparkles /> Review with Producer</button>
      </aside>

      <section>
        {producer && producer !== 'loading' && (
          <ProducerPanel
            result={producer}
            onClose={() => setProducer(null)}
            onAction={async (action) => {
              if (action === 'rebalance') await mutate(() => api.rebalance(production.id), applyProduction);
              if (action === 'develop_scenes') await mutate(() => api.developScenes(production.id), applyProduction);
              setProducer(await api.producer(production.id));
            }}
          />
        )}
        {view === 'Brief' && <Brief goToStage={goToStage} />}
        {view === 'Outline' && <Outline goToStage={goToStage} />}
        {view === 'Visuals' && <Visuals goToStage={goToStage} />}
        {view === 'People & look' && <PeopleAndLook />}
        {view === 'Sources' && <Sources />}
        {view === 'Decisions' && <Decisions />}
      </section>
    </div>
  );
}

const PP_LABEL = 'block text-[10px] tracking-[.07em] text-faint font-semibold mb-[7px]';
const PP_LINE = 'flex gap-[6px] items-start text-[12px] m-[0_0_6px] leading-[1.45]';

function ProducerPanel({ result, onClose, onAction }) {
  return (
    <div className="border border-solid border-line bg-surface-2 rounded-lg p-[15px] mb-[18px]">
      <div className="flex justify-between items-center mb-[11px]">
        <b className="flex items-center gap-[7px] text-[12.5px]"><Sparkles size={16} /> Producer assessment</b>
        <button className="border-0 border-none border-current bg-transparent p-[3px] text-muted" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="grid grid-cols-[repeat(3,1fr)] gap-[15px] lte800:grid-cols-[1fr] [&_svg]:shrink-0 [&_svg]:mt-[2px] [&_svg]:w-[12px] [&_svg]:h-[12px] [&_svg]:text-muted">
        <div>
          <small className={PP_LABEL}>KNOWN</small>
          {result.known.map((k) => <p className={PP_LINE} key={k}><Check size={13} /> {k}</p>)}
        </div>
        <div>
          <small className={PP_LABEL}>INFERRED</small>
          {result.inferred.length
            ? result.inferred.map((k) => <p className={PP_LINE} key={k}><Sparkles size={13} /> {k}</p>)
            : <p className={'muted ' + PP_LINE}>Nothing inferred.</p>}
        </div>
        <div>
          <small className={PP_LABEL}>NEEDS YOU</small>
          {result.decisionsNeeded.length
            ? result.decisionsNeeded.map((k) => <p className={PP_LINE} key={k}><AlertCircle size={13} /> {k}</p>)
            : <p className={'muted ' + PP_LINE}>Nothing blocking.</p>}
        </div>
      </div>
      {result.proposals.length > 0 && (
        <div className="mt-[13px] flex gap-[7px] flex-wrap border-t border-t-line [border-top-style:solid] pt-[12px]">
          {result.proposals.map((p) => (
            <button className="text-[12px]" key={p.action} onClick={() => onAction(p.action)} title={p.detail}>{p.label}</button>
          ))}
        </div>
      )}
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

/**
 * The finished video, if there is one: upload it, watch it, and recover the
 * words spoken in it (transcribed on this Mac) as the script of record.
 */
function FinishedVideo({ production, completedAsset }) {
  const { reload } = useStudio();
  const [file, setFile] = useState(undefined); // undefined = loading, null = none
  const [tx, setTx] = useState(null);
  const load = useCallback(async () => {
    const [items, t] = await Promise.all([api.library(), api.transcription(production.id)]);
    setFile(items.filter((a) => a.productionId === production.id && a.fileUrl && !/^Recording — /.test(a.name)).pop() ?? null);
    setTx(t);
  }, [production.id]);
  useEffect(() => { load().catch(() => setFile(null)); }, [load]);
  // While the words are being recovered, check every few seconds.
  useEffect(() => {
    if (tx?.state !== 'running') return undefined;
    const t = setInterval(async () => {
      const next = await api.transcription(production.id).catch(() => null);
      if (next) setTx(next);
      if (next && next.state !== 'running') { clearInterval(t); reload?.(); }
    }, 3000);
    return () => clearInterval(t);
  }, [tx?.state, production.id, reload]);

  if (file === undefined) return null;
  const clock = (d) => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`;
  const drop = (label, hint) => (
    <UploadDrop label={label} hint={hint} upload={(f, onProgress) => api.uploadFinishedVideo(production.id, f, onProgress)}
      onDone={async () => { await load(); }} />
  );

  if (!file) {
    return (
      <section className="mt-[14px]">
        {completedAsset && (
          <p className="text-[12.5px] text-ink-2 m-[0_0_8px]"><Check size={13} className="inline -mt-[2px] text-ok" /> <b>Already made:</b> {completedAsset}. Add the file to keep it with this video and recover its words.</p>
        )}
        {drop(completedAsset ? 'Upload the finished video' : 'Finished video? Upload it',
          'Drop the file here or click to choose it. It is filed under Company / Track / Video, this video is marked done, and the words spoken in it are transcribed on this Mac as its script.')}
      </section>
    );
  }

  return (
    <section className="mt-[14px] border border-solid border-[#c5e3d5] bg-ok-soft rounded-lg p-[12px_14px] flex flex-wrap gap-[16px] items-start">
      <video className="w-[170px] rounded-md bg-ink" src={file.fileUrl} controls preload="metadata" />
      <div className="flex-1 min-w-[220px] flex flex-col gap-[6px] text-[12.5px]">
        <b className="text-[13.5px] text-ok flex items-center gap-[6px]"><Check size={15} /> Finished video</b>
        <span className="text-ink-2">{completedAsset ?? file.name}{file.duration ? ` · ${clock(file.duration)}` : ''}</span>
        <span className="text-muted text-[11.5px] break-all">{file.localPath}</span>
        <span className={tx?.state === 'failed' ? 'text-danger' : tx?.state === 'running' ? 'text-warn' : 'text-ink-2'}>
          {tx?.state === 'running' && <><RefreshCw size={12} className="inline animate-spin -mt-[2px]" /> Recovering the words spoken in it… (about 40 seconds a minute of video)</>}
          {tx?.state === 'done' && <>Script recovered from the video — {tx.detail.replace(/^Done — /, '')}. It is the accepted script.</>}
          {tx?.state === 'failed' && <>{tx.detail}</>}
          {!tx?.state && <>The words in it have not been recovered yet.</>}
        </span>
        <span className="flex flex-wrap gap-[8px] mt-[4px]">
          {tx?.state !== 'running' && (
            <button className="text-[12px] p-[4px_10px]" onClick={async () => { await api.retranscribe(production.id); setTx({ state: 'running' }); }}>
              {tx?.state === 'done' ? 'Transcribe again' : 'Recover the words'}
            </button>
          )}
          <UploadDrop compact label="Replace the file" upload={(f, onProgress) => api.uploadFinishedVideo(production.id, f, onProgress)}
            onDone={async () => { await load(); }} />
        </span>
      </div>
    </section>
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

      <FinishedVideo production={production} completedAsset={rec('Completed asset')} />

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
  ['Pat', 'PJB — on camera'],
  ['Pat (voice only)', 'PJB — voice only'],
  [SELF_RECORDED, 'PJB — recorded myself'],
  ['Pat + Guest', 'PJB + guest'],
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

// What a section looks like on screen, and what the editor needs to make it.
const SHOT_HINT = {
  camera: 'PJB speaking to camera in the approved look',
  screen: 'What to record, step by step — e.g. Sign in → create a goal → invite a partner',
  diagram: 'What the graphic shows — e.g. three layers: parent → verticals → city',
  broll: 'Footage to use — e.g. a homeowner at the front door',
  title: 'Words on the card',
};
const SHOT_TONE = {
  camera: 'bg-accent-soft text-accent border-accent-line', screen: 'bg-ok-soft text-ok border-[#c5e3d5]',
  diagram: 'bg-warn-soft text-warn border-warn-line', broll: 'bg-surface-2 text-ink-2 border-line', title: 'bg-surface-2 text-ink-2 border-line',
};

/**
 * Visuals: the shot list. For each section of the outline — what is on
 * screen while those lines are spoken. For screen-recording videos it is
 * also the recording checklist.
 */
function Visuals({ goToStage }) {
  const { production, mutate } = useStudio();
  const [v, setV] = useState(null);
  const load = useCallback(() => api.visuals(production.id).then(setV), [production.id]);
  useEffect(() => { load(); }, [load]);

  if (!v) return <p className="muted">Loading…</p>;
  const save = (row, patch) => mutate(() => api.updateVisual(production.id, row.id, patch), (r) => setV(r.data), { silent: true }).catch(() => {});
  const recordable = v.rows.filter((r) => r.shotType === 'screen');
  const captured = recordable.filter((r) => r.captured).length;

  return (
    <>
      <div className="sectiontitle">
        <div>
          <h2>Visuals</h2>
          <p>What is on screen while each part of the script plays. Sections follow the outline.</p>
        </div>
        {recordable.length > 0 && (
          <span className={`text-[12px] ${captured === recordable.length ? 'text-ok' : 'text-muted'}`}>
            Screens recorded: <b>{captured} of {recordable.length}</b>
          </span>
        )}
      </div>

      <StaleNote stale={production.stale} goToStage={goToStage} />
      {!production.outlineApproved && (
        <div className="notice warn"><Lock /> Approve the outline first — the shot list follows its sections.</div>
      )}

      {v.rows.map((r) => (
        <section key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-[16px] border border-solid border-line rounded-lg bg-surface p-[12px_14px] mb-[10px] lte800:grid-cols-[1fr]">
          <div className="min-w-0">
            <div className="flex items-baseline gap-[8px] mb-[6px]">
              <code className="text-[11px] text-faint">{String(r.ref).padStart(2, '0')}</code>
              <b className="text-[13.5px] font-[580]">{r.title}</b>
              <span className="text-[11.5px] text-muted [font-variant-numeric:tabular-nums]">{r.runtime}</span>
            </div>
            {r.lines.length ? (
              <ol className="m-0 p-0 list-none flex flex-col gap-[4px]">
                {r.lines.map((l) => (
                  <li key={l.id} className="text-[12.5px] leading-[1.5] text-ink-2 [border-left:2px_solid_var(--line)] pl-[8px]">{l.text}</li>
                ))}
              </ol>
            ) : (
              <p className="text-faint text-[12px] m-0">No script lines here yet.</p>
            )}
          </div>

          <div className="flex flex-col gap-[8px] min-w-0">
            <div className="flex flex-wrap gap-[5px]" role="group" aria-label={`What is on screen in ${r.title}`}>
              {v.shots.map((s) => (
                <button key={s.id} type="button" onClick={() => r.shotType !== s.id && save(r, { shotType: s.id })}
                  className={'text-[11.5px] p-[4px_10px] rounded-full border border-solid ' + (r.shotType === s.id ? SHOT_TONE[s.id] + ' font-semibold' : 'bg-surface text-muted border-line hover:border-line-2')}>
                  {s.label}
                </button>
              ))}
            </div>
            <textarea className="w-full min-h-[58px] text-[12.5px] leading-[1.5] resize-y" defaultValue={r.detail}
              key={`${r.id}-${r.shotType}`} placeholder={SHOT_HINT[r.shotType]} aria-label="What is shown"
              onBlur={(e) => e.target.value !== r.detail && save(r, { detail: e.target.value })} />
            <input className="text-[12px]" defaultValue={r.onscreenText} placeholder="On-screen text or caption (optional)"
              aria-label="On-screen text" onBlur={(e) => e.target.value !== r.onscreenText && save(r, { onscreenText: e.target.value })} />
            {r.shotType === 'screen' && (
              <div className="flex flex-wrap items-center gap-[10px]">
                {r.recording ? (
                  <>
                    <video className="w-[150px] rounded bg-ink" src={r.recording.fileUrl} controls preload="metadata" />
                    <span className="text-[12px] text-ok flex items-center gap-[5px]"><Check size={13} /> Recorded</span>
                    <UploadDrop compact label="Replace" upload={(f, p) => api.uploadRecording(production.id, r.id, f, p)}
                      onDone={(res) => setV(res.data.visuals)} />
                  </>
                ) : (
                  <>
                    <UploadDrop compact label="Upload screen recording" upload={(f, p) => api.uploadRecording(production.id, r.id, f, p)}
                      onDone={(res) => setV(res.data.visuals)} />
                    <label className="flex items-center gap-[6px] text-[12px] text-muted cursor-pointer">
                      <input type="checkbox" checked={r.captured} onChange={(e) => save(r, { captured: e.target.checked })} />
                      recorded elsewhere
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      ))}

      <div className="actions">
        <button className="primary" disabled={v.approved || !v.rows.length || !production.outlineApproved}
          onClick={() => mutate(() => api.approveVisuals(production.id), (r) => setV(r.data)).catch(() => {})}>
          {v.approved ? <><Check size={15} /> Visuals approved</> : 'Approve visuals'}
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

const FORM_LABEL = 'flex flex-col gap-[4px] text-muted text-[11px] font-semibold';
const PROOF_SMALL = 'text-muted text-[11px]';
// A proof keeps its status class; the status only recolours or fades the card.
const PROOF_STATUS = { approved: ' border-[#c5e3d5]', rejected: ' border-line opacity-[.65]' };

// Background swatches: the plain light grey the finished PJB videos use, then white and dark.
const SUBHEAD_PLAN = 'text-[11px] tracking-[.07em] text-faint font-[600] m-[20px_0_8px] uppercase';
const SWATCHES = ['#f6f6fc', '#ffffff', '#1f2230'];
const LOOK_TILE = 'relative border border-solid rounded-lg overflow-hidden bg-canvas text-left p-0 cursor-pointer [&>img]:w-full [&>img]:h-[118px] [&>img]:object-cover [&>img]:block';

/**
 * Who appears in this video, and exactly how — one step. The performer is
 * PJB unless the outline says otherwise; the look (outfit and setting),
 * background, frame and motion direction are chosen here and, once approved,
 * are what the render uses. Consent for people lives in Cast → Collaborators.
 */
function PeopleAndLook() {
  const { production, mutate } = useStudio();
  const [opts, setOpts] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [form, setForm] = useState(null);
  const [showMotion, setShowMotion] = useState(false);
  const [defaultNote, setDefaultNote] = useState(null);

  const load = useCallback(async () => {
    const [o, flow] = await Promise.all([api.appearanceOptions(production.id), api.workflow(production.id)]);
    setOpts(o);
    setWorkflow(flow);
    const performer = o.performers[0];
    if (!performer) return;
    // Start from what is approved for this video, else the default, else the house look.
    const approved = flow.appearances.find((a) => a.presenterId === performer.id && a.status === 'approved' && a.look);
    const draft = flow.appearances.find((a) => a.presenterId === performer.id && a.status === 'draft' && a.look);
    const base = approved ?? draft;
    const d = o.default;
    setForm({
      presenterId: performer.id,
      avatarAssetId: base?.look?.id ?? d?.avatarAssetId ?? performer.looks.find((l) => /sweatshirt/i.test(l.name))?.id ?? performer.looks[0]?.id,
      backgroundKind: base?.backgroundKind ?? d?.backgroundKind ?? o.settings.backgroundKind,
      backgroundValue: base?.backgroundValue ?? d?.backgroundValue ?? o.settings.backgroundValue,
      aspect: base?.aspect ?? d?.aspect ?? o.settings.aspect,
      resolution: base?.resolution ?? d?.resolution ?? o.settings.resolution,
      motionPrompt: base?.motionPrompt ?? d?.motionPrompt ?? o.settings.motionPrompt,
    });
  }, [production.id]);
  useEffect(() => { load(); }, [load]);

  if (isSelfRecorded(production)) {
    return (
      <>
        <h2>People &amp; look</h2>
        <div className="notice"><Check /> <span><b>PJB — recorded myself.</b> You film and edit this one, so it needs no HeyGen look and no render.
          Approve the audio in Segments, take the editor kit from Edit, and upload the finished video in Brief — that marks it done.</span></div>
        <p className="text-faint text-[11.5px] mt-[12px]">To use an avatar instead, change who appears in the Outline.</p>
      </>
    );
  }
  if (!opts || !workflow) return <p className="muted">Loading…</p>;
  const performer = opts.performers[0];
  if (!performer || !form) {
    return (
      <>
        <h2>People &amp; look</h2>
        <div className="notice warn"><AlertCircle /> No performer with looks yet. Cast a presenter with your HeyGen avatar in Cast.</div>
      </>
    );
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const proofs = workflow.appearances.filter((a) => a.presenterId === performer.id);
  const approved = proofs.find((a) => a.status === 'approved');
  const template = opts.template?.name;
  const templateId = opts.template?.id;
  const chosen = performer.looks.find((l) => l.id === form.avatarAssetId);

  const saveLook = async (approve) => {
    try {
      const res = await mutate(() => api.createAppearance(production.id, { ...form, label: chosen?.name }), (r) => setWorkflow(r.data));
      if (approve) {
        const newest = res.data.appearances.find((a) => a.presenterId === performer.id && a.status === 'draft');
        if (newest) await mutate(() => api.updateAppearance(production.id, newest.id, { status: 'approved' }), (r) => setWorkflow(r.data));
      }
    } catch { /* mutate reports it */ }
  };
  const setStatus = (proof, status) =>
    mutate(() => api.updateAppearance(production.id, proof.id, { status }), (r) => setWorkflow(r.data)).catch(() => {});
  const makeDefault = async (scope) => {
    try {
      await mutate(() => api.saveAppearanceDefault(scope, form), null, { silent: true });
      const r = await mutate(() => api.applyAppearanceDefault(scope), null);
      setDefaultNote(r.message);
      await load();
    } catch { /* reported */ }
  };

  return (
    <>
      <div className="sectiontitle">
        <div>
          <h2>People &amp; look</h2>
          <p>Who appears in this video and exactly how. The approved look is what the render uses.</p>
        </div>
      </div>

      <div className={'notice ' + (approved ? '' : 'warn')}>
        {approved ? <Check /> : <AlertCircle />}
        <span>
          <b>{performer.name.replace(/ \(your likeness\)/, '')} — PJB</b> · voice: your local voice ·{' '}
          {approved ? `approved look: ${approved.look?.name ?? approved.outfit}` : 'no approved look yet — choose one below and approve it'}
        </span>
      </div>

      <div className={SUBHEAD_PLAN}>Look — outfit and setting ({performer.looks.length})</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-[8px]">
        {performer.looks.map((l) => (
          <button key={l.id} type="button" onClick={() => set({ avatarAssetId: l.id })}
            className={LOOK_TILE + (l.id === form.avatarAssetId ? ' border-accent [box-shadow:0_0_0_2px_var(--accent)]' : ' border-line hover:border-line-2')}
            title={l.name}>
            {l.previewUrl ? <img src={l.previewUrl} alt="" loading="lazy" /> : <div className="h-[118px] grid place-items-center text-faint"><ImageIcon /></div>}
            <span className="block p-[5px_7px] text-[11px] leading-[1.3] truncate text-ink-2">{l.name}</span>
            {l.avatarType === 'digital_twin' && <span className="absolute top-[5px] left-[5px] text-[9.5px] bg-ink text-[#fff] rounded-[3px] p-[1px_5px]">VIDEO TWIN</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[1fr_1fr_1fr] gap-[12px] mt-[16px] lte800:grid-cols-[1fr]">
        <label className={FORM_LABEL}>Background
          <span className="flex items-center gap-[6px]">
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={`Background ${c}`} onClick={() => set({ backgroundKind: 'color', backgroundValue: c })}
                className={'w-[26px] h-[26px] p-0 rounded-full border border-solid ' + (form.backgroundKind === 'color' && form.backgroundValue === c ? 'border-accent [box-shadow:0_0_0_2px_var(--accent)]' : 'border-line')}
                style={{ background: c }} />
            ))}
            <input type="color" aria-label="Custom background colour" className="w-[34px] h-[28px] p-[2px]"
              value={form.backgroundKind === 'color' ? form.backgroundValue : '#f6f6fc'}
              onChange={(e) => set({ backgroundKind: 'color', backgroundValue: e.target.value })} />
          </span>
          <input className="mt-[6px] font-normal" placeholder="…or an https image URL"
            value={form.backgroundKind === 'image' ? form.backgroundValue : ''}
            onChange={(e) => set(e.target.value ? { backgroundKind: 'image', backgroundValue: e.target.value } : { backgroundKind: 'color', backgroundValue: '#f6f6fc' })} />
        </label>
        <label className={FORM_LABEL}>Framing
          <select value={form.aspect} onChange={(e) => set({ aspect: e.target.value })}>
            {opts.settings.aspects.map((a) => <option key={a} value={a}>{a}{a === '9:16' ? ' — vertical (social)' : a === '16:9' ? ' — widescreen' : ' — square'}</option>)}
          </select>
          {chosen?.orientation && ((chosen.orientation === 'portrait') !== (form.aspect === '9:16')) && (
            <small className="font-normal text-warn">This look was shot {chosen.orientation}; it may be cropped in {form.aspect}.</small>
          )}
        </label>
        <label className={FORM_LABEL}>Resolution
          <select value={form.resolution} onChange={(e) => set({ resolution: e.target.value })}>
            {opts.settings.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      <button type="button" className="ghostbtn mt-[10px] text-[12px] p-[3px_0]" onClick={() => setShowMotion((v) => !v)}>
        {showMotion ? 'Hide' : 'Edit'} motion direction
      </button>
      {showMotion && (
        <textarea className="w-full min-h-[90px] text-[12.5px] mt-[6px]" value={form.motionPrompt}
          onChange={(e) => set({ motionPrompt: e.target.value })} aria-label="Motion direction" />
      )}

      <div className="flex flex-wrap gap-[8px] mt-[14px] items-center">
        <button className="primary" onClick={() => saveLook(true)} disabled={!form.avatarAssetId}>
          <Check size={13} /> Approve this look for this video
        </button>
        <button onClick={() => saveLook(false)} disabled={!form.avatarAssetId}>Save as draft</button>
        <span className="text-faint text-[11.5px]">or set it as the starting look for</span>
        {templateId && <button onClick={() => makeDefault(`template:${templateId}`)}>All {template} videos</button>}
        <button onClick={() => makeDefault('all')}>Every video</button>
      </div>
      {defaultNote && <p className="text-[12px] text-muted m-[8px_0_0]">{defaultNote} — each still needs its own approval.</p>}

      {proofs.length > 0 && (
        <>
          <div className={SUBHEAD_PLAN}>Looks for this video</div>
          <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-[10px] lte800:grid-cols-[1fr]">
            {proofs.map((proof) => (
              <article key={proof.id} className={'grid grid-cols-[84px_1fr] border border-solid rounded-lg overflow-hidden bg-surface ' + (PROOF_STATUS[proof.status] ?? ' border-line')}>
                {/^https?:\/\//i.test(proof.imageUrl ?? '')
                  ? <img className="w-[84px] h-[104px] object-cover bg-canvas" src={proof.imageUrl} alt="" />
                  : <div className="w-[84px] h-[104px] bg-canvas grid place-items-center text-line-2"><ImageIcon /></div>}
                <div className="flex flex-col gap-[3px] p-[9px] min-w-0">
                  <span className={'rstatus ' + proof.status}>{proof.status}</span>
                  <b className="text-[12.5px] truncate">{proof.look?.name ?? proof.label}</b>
                  <small className={PROOF_SMALL}>{proof.background} · {proof.framing}</small>
                  {proof.status === 'draft' && (
                    <div className="flex gap-[6px] mt-auto">
                      <button className="text-[12px] p-[4px_8px]" onClick={() => setStatus(proof, 'rejected')}>Reject</button>
                      <button className="primary text-[12px] p-[4px_8px]" onClick={() => setStatus(proof, 'approved')}><Check size={12} /> Approve</button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <p className="text-faint text-[11.5px] mt-[16px]">
        People and consent for the whole workspace are managed in Cast → Collaborators.
      </p>
    </>
  );
}

function Decisions() {
  const { production, applyProduction, mutate } = useStudio();
  const ICON = { locked: Lock, ok: Check, warning: AlertCircle };

  return (
    <>
      <h2>Decisions</h2>
      <p>The Producer separates what needs you from what it can decide and what is locked.</p>
      {production.decisions.map((g) => {
        const I = ICON[g.kind];
        return (
          <div className={'decisiongroup ' + g.kind} key={g.kind}>
            <b>{g.label}</b>
            {g.items.map((item) => (
              <div key={item.id}>
                <I size={15} />
                <span className={item.resolution ? 'resolved' : ''}>{item.text}</span>
                {g.kind === 'warning' && (
                  item.resolution
                    ? <em>{item.resolution}</em>
                    : <button onClick={() => mutate(
                        () => api.resolveDecision(production.id, item.id, 'Resolved by you'),
                        applyProduction
                      )}>Resolve</button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
