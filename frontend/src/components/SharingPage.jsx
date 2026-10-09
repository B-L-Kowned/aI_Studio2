import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, UserPlus, Upload, Clock, Check, Share2 } from 'lucide-react';
import { api } from '../services/api.js';
import { useStudio } from '../context/studio-context.jsx';
import { useDialog, Modal } from './Dialog.jsx';
import { Section } from './Section.jsx';
import { InviteDialog } from './PeoplePage.jsx';
import { ShareTwinDialog, ImportTwinDialog } from './Twin.jsx';

const PART = { appearance: 'Look', voice: 'Voice', personality: 'Personality' };
const HOW = { source: 'They make videos with it', render: 'They ask, you render' };
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

/** One line that says where a share stands, in words, with its colour. */
function standing(g) {
  if (g.status === 'active') {
    if (!g.endsAt) return ['text-ok', 'Active · until ended'];
    if (g.daysLeft === 0) return ['text-warn', `Ends today · ${day(g.endsAt)}`];
    return [g.endingSoon ? 'text-warn' : 'text-ok', `Active · ends in ${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'} (${day(g.endsAt)})`];
  }
  if (g.status === 'pending') return ['text-muted', g.direction === 'in' ? 'Waiting for their answer' : 'Not started'];
  if (g.status === 'done') return ['text-faint', `Finished ${g.endedAt ? day(g.endedAt) : ''}`];
  if (g.status === 'ended') return ['text-faint', `Ended ${day(g.endedAt ?? g.endsAt)} · time ran out`];
  if (g.status === 'declined') return ['text-faint', 'Declined'];
  return ['text-faint', `${g.endedBy === 'borrower' ? 'Invite withdrawn' : 'Withdrawn'} ${g.endedAt ? day(g.endedAt) : ''}`];
}

function Row({ g, people, onChanged }) {
  const { mutate } = useStudio();
  const dialog = useDialog();
  const [tone, words] = standing(g);
  const person = people.find((p) => p.id === g.personId);
  const live = g.status === 'active' || g.status === 'pending';
  const end = async () => {
    const mine = g.direction === 'out';
    const ok = await dialog.confirm({
      title: mine ? `End ${g.counterpart}'s access now?` : `Finished with ${g.counterpart}'s likeness?`,
      confirmLabel: mine ? 'End now' : 'I’m finished', tone: 'warn',
      body: mine
        ? `${g.counterpart} can no longer make anything new with ${g.presenter?.name ?? 'your twin'}. Videos already made stay as they are; a copy they downloaded cannot be recalled.${g.authentech ? ' AuthenTech opens next — press Withdraw there so their app hears it ended too.' : ''}`
        : `It ends now, before ${g.endsAt ? day(g.endsAt) : 'its end'}. ${g.counterpart} sees it has ended, and nothing new can be made with their likeness here.`,
    });
    if (!ok) return;
    // Opened before the await, so the browser treats it as the click's own window.
    // ('noopener' would make window.open return null even when it worked.)
    const withdraw = mine && g.authentech?.withdrawUrl ? window.open(g.authentech.withdrawUrl, '_blank') : null;
    if (withdraw) withdraw.opener = null;
    await mutate(() => api.endGrant(g.id), null).catch(() => {});
    // A blocked pop-up still gets the person there: a link they can press.
    if (mine && g.authentech && !withdraw) await dialog.notice({ title: 'Withdraw it on AuthenTech too', body: `Your browser blocked the new tab. Open ${g.authentech.withdrawUrl} and press Withdraw.` });
    onChanged();
  };
  const extend = async (days) => { await mutate(() => api.extendGrant(g.id, days), null).catch(() => {}); onChanged(); };
  return (
    <div className={'grid grid-cols-[34px_minmax(180px,1.2fr)_minmax(150px,1fr)_minmax(220px,1.1fr)_250px] gap-[12px] items-center p-[10px_14px] [&+&]:[border-top:1px_solid_var(--line)] lte960:grid-cols-[34px_1fr] ' + (live ? '' : 'opacity-70')}>
      <b className="w-[34px] h-[34px] grid place-items-center rounded-full bg-surface-2 border border-solid border-line text-[12px] text-ink-2">{(g.counterpart || '?')[0].toUpperCase()}</b>
      <div className="min-w-0">
        <b className="block text-[13.5px] font-[580] truncate">{g.direction === 'out' ? `${g.presenter?.name ?? 'Your twin'} → ${g.counterpart}` : g.counterpart}</b>
        <span className="block text-[12px] text-muted truncate">{g.email ?? (g.direction === 'in' && g.presenter ? g.presenter.name : '')}</span>
      </div>
      <div className="text-[12px] text-ink-2 lte960:col-start-2">
        {g.scopes.map((s) => PART[s]).join(' · ')}
        <span className="block text-faint">{HOW[g.mode]}</span>
      </div>
      <div className={`text-[12.5px] font-[540] inline-flex items-center gap-[6px] lte960:col-start-2 ${tone}`}>
        {g.status === 'active' ? <Clock size={13} /> : g.status === 'done' ? <Check size={13} /> : null}{words}
        {g.authentech?.verified && <span className="ml-[6px] text-[11px] font-[600] rounded-full p-[1px_8px] bg-accent-soft text-accent" title="Consent recorded on AuthenTech">AuthenTech ✓</span>}
      </div>
      <div className="flex flex-wrap gap-[6px] justify-end lte960:col-start-2 lte960:justify-start">
        {g.status === 'pending' && person?.inviteUrl && (
          <button className="text-[12px] p-[4px_10px]" onClick={() => navigator.clipboard?.writeText(person.inviteUrl)}><Copy size={12} /> Copy their link</button>
        )}
        {g.status === 'pending' && person?.inviteUrl && (
          <button className="text-[12px] p-[4px_10px]" onClick={async () => { await mutate(() => api.withdrawInvite(person.id), null).catch(() => {}); onChanged(); }}>Withdraw invite</button>
        )}
        {g.status === 'pending' && !person?.inviteUrl && (
          <button className="text-[12px] p-[4px_10px]" title="An invite from before the consent page existed: it has no link to send" onClick={async () => { await mutate(() => api.endGrant(g.id), null).catch(() => {}); onChanged(); }}>Cancel invite</button>
        )}
        {g.canExtend && (
          <select className="text-[12px] p-[4px_8px]" value="" aria-label="Extend" onChange={(e) => e.target.value && extend(e.target.value === 'open' ? null : Number(e.target.value))}>
            <option value="">{g.status === 'ended' ? 'Share again…' : 'Extend…'}</option>
            <option value="7">+7 days</option>
            <option value="30">+30 days</option>
            <option value="open">Until I end it</option>
          </select>
        )}
        {g.status === 'active' && (
          <button className={'text-[12px] p-[4px_10px] ' + (g.direction === 'out' ? 'text-danger' : '')} onClick={end}>
            {g.direction === 'out' ? 'End now' : 'I’m finished'}
          </button>
        )}
      </div>
    </div>
  );
}

function List({ title, meta, actions, rows, people, empty, onChanged }) {
  const [showEnded, setShowEnded] = useState(false);
  const live = rows.filter((g) => g.status === 'active' || g.status === 'pending');
  const ended = rows.filter((g) => !live.includes(g));
  const shown = showEnded ? rows : live;
  return (
    <Section title={title} meta={meta} actions={actions}>
      {shown.length ? (
        <div className="border border-solid border-line rounded-lg bg-surface overflow-clip">
          {shown.map((g) => <Row key={g.id} g={g} people={people} onChanged={onChanged} />)}
        </div>
      ) : <p className="sectionempty">{empty}</p>}
      {ended.length > 0 && (
        <button type="button" className="ghostbtn mt-[8px] p-0 text-[12px] text-muted hover:text-ink" onClick={() => setShowEnded((v) => !v)}>
          {showEnded ? 'Hide ended' : `Show ${ended.length} ended`}
        </button>
      )}
    </Section>
  );
}

/**
 * Sharing — likeness lent for a while, both ways. Every share has an end:
 * a date it ends by itself, or "until ended". It also ends when the person
 * using it says they are finished, or when its owner ends it. Nothing new is
 * made with a twin once its share has ended.
 */
export default function SharingPage() {
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [dlg, setDlg] = useState(null); // 'invite' | 'import' | 'pick' | {share: presenter}
  const load = useCallback(async () => {
    const [g, p, pr] = await Promise.all([api.grants(), api.people().catch(() => []), api.presenters().catch(() => null)]);
    setData(g); setPeople(p);
    setPersonas(pr?.tabs?.find((t) => t.id === 'personal')?.presenters ?? []);
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  if (!data) return null;
  const count = (rows) => rows.filter((g) => g.status === 'active').length;
  return (
    <>
      {data.endingSoon.length > 0 && (
        <p className="m-[0_0_12px] p-[9px_12px] rounded-md bg-warn-soft text-warn text-[12.5px]">
          {data.endingSoon.map((g) => `${g.direction === 'out' ? `${g.counterpart}'s access to ${g.presenter?.name ?? 'your twin'}` : `Your access to ${g.counterpart}`} ends ${g.daysLeft === 0 ? 'today' : `in ${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'}`}`).join(' · ')}
        </p>
      )}
      {data.offers?.length > 0 && (
        <Section title="Sent to you on AuthenTech" meta={`${data.offers.length} waiting`}>
          <div className="border border-solid border-line rounded-lg bg-surface overflow-clip">
            {data.offers.map((o) => (
              <div key={o.shareId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-[12px] items-center p-[10px_14px] [&+&]:[border-top:1px_solid_var(--line)]">
                <span className="min-w-0">
                  <b className="block text-[13.5px] font-[580] truncate">{o.label ?? `${o.from}'s twin`}</b>
                  <span className="block text-[12px] text-muted">From {o.from} · {o.scopes.map((x) => PART[x] ?? x).join(' · ')}{o.expiresAt ? ` · until ${day(o.expiresAt)}` : ''}</span>
                </span>
                <span className="text-[12px] text-ink-2">
                  {o.status === 'offered' ? 'Waiting for you to accept'
                    : o.status === 'active' ? 'Accepted — open the twin package they send you'
                    : o.status === 'revoked' ? 'Withdrawn' : o.status === 'expired' ? 'Ended' : o.status}
                </span>
                <span className="flex gap-[6px]">
                  {o.status === 'offered' && <a className="inline-flex items-center gap-[5px] text-[12.5px] p-[5px_11px] rounded-md bg-ink text-white no-underline" href={o.acceptUrl} target="_blank" rel="noreferrer">Accept on AuthenTech</a>}
                  {o.status === 'active' && <button className="text-[12.5px] p-[4px_11px]" onClick={() => setDlg('import')}><Upload size={12} /> Open their package</button>}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <List title="Shared with you" meta={`${count(data.in)} active`} rows={data.in} people={people} onChanged={load}
        empty="No one has shared their likeness with you yet."
        actions={<>
          <button onClick={() => setDlg('invite')}><UserPlus size={14} /> Invite someone</button>
          <button className="ghostbtn text-muted" onClick={() => setDlg('import')}><Upload size={13} /> Add a shared twin</button>
        </>} />
      <List title="Shared by you" meta={`${count(data.out)} active`} rows={data.out} people={people} onChanged={load}
        empty="You have not shared any of your personas. Share one for a set time — it ends by itself."
        actions={<button onClick={() => setDlg('pick')}><Share2 size={13} /> Share a persona</button>} />

      {dlg === 'invite' && <InviteDialog onClose={() => { setDlg(null); load(); }} onSent={load} />}
      {dlg === 'import' && <ImportTwinDialog onClose={() => { setDlg(null); load(); }} onAdded={load} />}
      {dlg === 'pick' && (
        <Modal title="Which persona?" width={420} onClose={() => setDlg(null)} footer={<button onClick={() => setDlg(null)}>Cancel</button>}>
          <div className="grid gap-[6px]">
            {personas.map((p) => (
              <button key={p.id} type="button" className="flex items-center gap-[10px] text-left p-[8px_10px]" onClick={() => setDlg({ share: p })}>
                {p.avatar?.previewUrl
                  ? <img src={p.avatar.previewUrl} alt="" className="w-[32px] h-[32px] rounded-[6px] object-cover object-[center_22%]" />
                  : <span className="w-[32px] h-[32px] rounded-[6px] bg-surface-2" />}
                <span className="min-w-0"><b className="block text-[13px] font-[560] truncate">{p.name}</b><span className="block text-[11.5px] text-muted truncate">{p.tagline || p.description}</span></span>
                <Plus size={13} className="ml-auto text-muted" />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {dlg?.share && <ShareTwinDialog presenter={dlg.share} onClose={() => { setDlg(null); load(); }} />}
    </>
  );
}
