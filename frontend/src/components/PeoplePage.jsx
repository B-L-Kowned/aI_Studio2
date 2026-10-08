import React, { useState } from 'react';
import { UserPlus, Check, Clock, Lock, Copy, X, AlertCircle } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { useDialog } from '../components/Dialog.jsx';
import { api } from '../services/api.js';
import { Section, PageHead, Empty } from './Section.jsx';
import { Modal } from './Dialog.jsx';

const FLOW_STEP = 'flex items-center gap-[6px] text-[12px] text-ink-2 bg-surface-2 border border-solid border-line rounded-[20px] p-[5px_11px]'
  + ' before:[counter-increment:step] before:content-[counter(step)] before:w-[15px] before:h-[15px] before:rounded-[50%]'
  + ' before:bg-line before:text-muted before:grid before:place-items-center before:text-[9px]';

const SCOPES = [
  ['production', 'This production'],
  ['series', 'This series'],
  ['workspace', 'Workspace'],
];

const ROLE_OPTIONS = [
  ['camera', 'On camera', 'Their appearance and voice, as an avatar or in recordings.'],
  ['voice', 'Voice only', 'Their voice — recorded, or an AI voice from their sample.'],
  ['approve', 'Approves videos', 'Reviews the videos they appear in before they go out.'],
];
const SCOPE_OPTIONS = [['production', 'One video'], ['series', 'One series'], ['workspace', 'All your videos']];

/**
 * Invite someone by email. They get a page of their own to read exactly what
 * they would allow, agree or decline, and withdraw later; the answer comes
 * back here by itself.
 */
function InviteDialog({ onClose, onSent }) {
  const { productions, mutate } = useStudio();
  const [ready, setReady] = useState(null);
  const [f, setF] = useState({ name: '', email: '', role: 'camera', scope: 'production', productionId: '', note: '' });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);
  React.useEffect(() => { api.consentStatus().then((r) => setReady(r.ready)).catch(() => setReady(false)); }, []);
  const valid = f.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim());
  const send = async () => {
    setSending(true);
    try {
      const prod = (productions ?? []).find((p) => String(p.id) === String(f.productionId));
      const r = await mutate(() => api.sendInvite({ ...f, scopeLabel: f.scope === 'production' && prod ? prod.title : '' }), null);
      setDone(r.data); onSent?.();
    } catch { /* reported */ } finally { setSending(false); }
  };
  const CARD = (on) => 'text-left p-[9px_11px] rounded-lg border border-solid ' + (on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-2');
  if (done) {
    return (
      <Modal title={done.emailed ? 'Invite sent' : 'Invite ready'} onClose={onClose}
        footer={<button className="primary" onClick={onClose}>Done</button>}>
        <p className="m-0">{done.emailed
          ? `${f.name} has an email with their own page. Their answer appears here by itself.`
          : `Email is not set up on the consent service yet${done.emailError ? ` (${done.emailError})` : ''}. Send ${f.name} this link yourself:`}</p>
        <div className="flex gap-[6px] mt-[10px]">
          <input readOnly className="flex-1 text-[12.5px]" value={done.url} onFocus={(e) => e.target.select()} />
          <button onClick={() => navigator.clipboard?.writeText(done.url)}><Copy size={13} /> Copy</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Invite a collaborator" width={540} onClose={onClose}
      footer={<>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!valid || !ready || sending} onClick={send}>{sending ? 'Sending…' : 'Send invite'}</button>
      </>}>
      {ready === false && (
        <p className="m-[0_0_12px] p-[9px_11px] rounded-md bg-warn-soft text-warn text-[12.5px]">
          The consent page is not online yet, so an invite cannot be opened by anyone else. It goes live once the consent service is deployed and the studio is pointed at it.
        </p>
      )}
      <div className="grid grid-cols-[1fr_1fr] gap-[10px] lte620:grid-cols-[1fr]">
        <label className="flex flex-col gap-[4px] text-[11.5px] font-semibold text-muted">Name
          <input className="font-normal text-[13.5px] text-ink" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Christine Doe" />
        </label>
        <label className="flex flex-col gap-[4px] text-[11.5px] font-semibold text-muted">Email
          <input className="font-normal text-[13.5px] text-ink" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@example.com" />
        </label>
      </div>
      <p className="m-[14px_0_6px] text-[11.5px] font-semibold text-muted">What they will do</p>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-[8px] lte620:grid-cols-[1fr]">
        {ROLE_OPTIONS.map(([v, l, d]) => (
          <button key={v} type="button" className={CARD(f.role === v)} onClick={() => setF({ ...f, role: v })}>
            <b className="block text-[13px] font-[600] text-ink">{l}</b><span className="block text-[11.5px] text-muted leading-[1.4] mt-[2px]">{d}</span>
          </button>
        ))}
      </div>
      <p className="m-[14px_0_6px] text-[11.5px] font-semibold text-muted">For</p>
      <div className="flex flex-wrap gap-[6px]">
        {SCOPE_OPTIONS.map(([v, l]) => (
          <button key={v} type="button" onClick={() => setF({ ...f, scope: v })}
            className={'text-[12.5px] p-[5px_12px] rounded-full border border-solid ' + (f.scope === v ? 'bg-ink text-white border-ink' : 'bg-surface text-ink-2 border-line')}>{l}</button>
        ))}
      </div>
      {f.scope === 'production' && (
        <select className="w-full mt-[8px] text-[13px]" value={f.productionId} onChange={(e) => setF({ ...f, productionId: e.target.value })} aria-label="Which video">
          <option value="">Which video? (optional)</option>
          {(productions ?? []).slice(0, 400).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      )}
      <label className="flex flex-col gap-[4px] text-[11.5px] font-semibold text-muted mt-[14px]">A note for them (optional)
        <textarea className="font-normal text-[13px] text-ink min-h-[64px]" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}
          placeholder="We are making a short partner video for Fixology and would love you in it." />
      </label>
      <p className="m-[10px_0_0] text-[11.5px] text-faint">They choose what to allow on their own page and can withdraw at any time. Nothing of theirs is used until they agree.</p>
    </Modal>
  );
}

export default function PeoplePage({ compact, tabs, section = false }) {
  const { collections, refreshPeople, mutate } = useStudio();
  const dialog = useDialog();
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState(null);
  const [managing, setManaging] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const all = collections.people;
  // A revoked consent is history, not someone to act on: kept, folded away.
  const inactive = all.filter((p) => /revoked/i.test(p.representation ?? ''));
  const people = section && !showInactive ? all.filter((p) => !inactive.includes(p)) : all;
  const approved = all.filter((p) => p.status === 'approved').length;

  const sendInvite = async (e) => {
    e.preventDefault();
    const res = await mutate(() => api.invitePerson(name, 'Guest'), null);
    setInvite(res.data.inviteUrl);
    setName('');
    setInviting(false);
    await refreshPeople();
  };

  const inviteBtn = (
    <button className={section ? '' : 'primary'} onClick={() => setInviting(true)}>
      <UserPlus size={14} /> Invite collaborator
    </button>
  );

  const body = (
    <>
      {inviting && <InviteDialog onClose={() => setInviting(false)} onSent={refreshPeople} />}

      {invite && (
        <div className="notice">
          <Copy size={15} />
          <span>Invite link: <code>{invite}</code> — they approve appearance and voice without project access.</span>
          <button onClick={() => setInvite(null)}><X size={14} /></button>
        </div>
      )}

      {people.length === 0 ? (
        <Empty icon={UserPlus} action={inviteBtn}>No collaborators yet.</Empty>
      ) : (
        <div className="grid grid-cols-[repeat(3,1fr)] gap-[12px] lte800:grid-cols-[1fr]">
          {people.map((p) => (
            <div className="border border-solid border-line rounded-lg p-[15px] flex flex-col gap-[5px] bg-surface" key={p.id}>
              <div className="avatar">{p.name[0]}</div>
              <b className="text-[14px]">{p.name}</b>
              <span className="text-[12px] text-muted">{p.role}</span>
              <small className="flex gap-[5px] items-center text-muted text-[12px]">{p.representation}</small>
              <small className={(p.status === 'approved' ? 'okv' : 'unknownv') + ' flex gap-[5px] items-center text-muted text-[12px]'}>
                {p.status === 'approved'
                  ? <><Check size={13} /> Approved: {p.consentScope}</>
                  : <><Clock size={13} /> Awaiting setup</>}
              </small>

              {managing === p.id ? (
                <div className="flex flex-col gap-[4px] mt-[5px]">
                  {p.status === 'approved' ? (
                    <button className="text-[12px] p-[6px_9px] m-0" onClick={async () => {
                      await mutate(() => api.revokeConsent(p.id), null);
                      await refreshPeople(); setManaging(null);
                    }}>Revoke consent</button>
                  ) : (
                    <>
                      <small className="flex gap-[5px] items-center text-faint text-[11px]">Grant consent for:</small>
                      {SCOPES.map(([v, l]) => (
                        <button key={v} className="text-[12px] p-[6px_9px] m-0" onClick={async () => {
                          await mutate(() => api.grantConsent(p.id, v), null);
                          await refreshPeople(); setManaging(null);
                        }}>{l}</button>
                      ))}
                    </>
                  )}
                  {!/owner/i.test(p.role) && (
                    <button className="text-[12px] p-[6px_9px] m-0 text-danger" onClick={async () => {
                      if (!await dialog.confirm({ title: `Remove ${p.name}?`, tone: 'danger', confirmLabel: 'Remove',
                        body: 'Their consent record is deleted. Videos they already appear in are not affected.' })) return;
                      try { await mutate(() => api.removePerson(p.id), null); } catch { return; }
                      await refreshPeople(); setManaging(null);
                    }}>Remove {p.name}</button>
                  )}
                  <button className="text-[12px] p-[6px_9px] m-0" onClick={() => setManaging(null)}>Cancel</button>
                </div>
              ) : (
                <button className="mt-[7px]" onClick={() => setManaging(p.id)}>
                  {p.status === 'approved' ? 'Manage permissions' : 'Complete consent'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );

  // Inside the Plan workspace this is a panel, not a page.
  if (section) {
    return (
      <Section title="Collaborators" meta={`${approved} of ${all.length} approved`} actions={inviteBtn}>
        {inviting && <InviteDialog onClose={() => setInviting(false)} onSent={refreshPeople} />}
        {invite && (
          <div className="notice"><Copy size={15} /><span>Invite link: <code>{invite}</code> — they approve appearance and voice without project access.</span>
            <button onClick={() => setInvite(null)}><X size={14} /></button></div>
        )}
        <div className="border border-solid border-line rounded-lg bg-surface overflow-clip">
          {people.map((p) => (
            <div key={p.id} className="[&+&]:[border-top:1px_solid_var(--line)]">
              <div className="grid grid-cols-[32px_minmax(160px,1fr)_minmax(200px,1fr)_auto] gap-[12px] items-center p-[9px_14px]">
                <span className="w-[32px] h-[32px] rounded-full bg-surface-2 border border-solid border-line grid place-items-center text-[12px] text-ink-2 font-[600]">{p.name[0]}</span>
                <span className="min-w-0"><b className="block text-[13.5px] font-[580] truncate">{p.name}</b>
                  <span className="block text-[12px] text-muted truncate">{[p.inviteRole ?? p.role, p.email].filter(Boolean).join(' · ')}</span></span>
                <span className={'text-[12px] flex items-center gap-[5px] ' + (p.status === 'approved' ? 'text-ok' : 'text-muted')}>
                  {p.status === 'approved' ? <><Check size={13} /> Approved · {p.consentScope}</> : <><Clock size={13} /> {p.representation || 'Awaiting setup'}</>}
                </span>
                <button className="text-[12px] p-[4px_10px]" onClick={() => setManaging(managing === p.id ? null : p.id)}>
                  {p.status === 'approved' ? 'Permissions' : 'Complete consent'}
                </button>
              </div>
              {managing === p.id && (
                <div className="flex flex-wrap gap-[6px] p-[0_14px_10px_58px]">
                  {p.status === 'approved' ? (
                    <button className="text-[12px] p-[4px_10px]" onClick={async () => { await mutate(() => api.revokeConsent(p.id), null); await refreshPeople(); setManaging(null); }}>Revoke consent</button>
                  ) : SCOPES.map(([v, l]) => (
                    <button key={v} className="text-[12px] p-[4px_10px]" onClick={async () => { await mutate(() => api.grantConsent(p.id, v), null); await refreshPeople(); setManaging(null); }}>Grant for {l.toLowerCase()}</button>
                  ))}
                  {p.inviteUrl && <button className="text-[12px] p-[4px_10px]" onClick={() => navigator.clipboard?.writeText(p.inviteUrl)}><Copy size={12} /> Copy their link</button>}
                  {p.inviteUrl && !['revoked', 'declined'].includes(p.inviteStatus) && (
                    <button className="text-[12px] p-[4px_10px]" onClick={async () => { await mutate(() => api.withdrawInvite(p.id), null).catch(() => {}); await refreshPeople(); setManaging(null); }}>Withdraw invite</button>
                  )}
                  {!/owner/i.test(p.role) && (
                    <button className="text-[12px] p-[4px_10px] text-danger" onClick={async () => {
                      if (!await dialog.confirm({ title: `Remove ${p.name}?`, tone: 'danger', confirmLabel: 'Remove',
                        body: 'Their consent record is deleted. Videos they already appear in are not affected.' })) return;
                      try { await mutate(() => api.removePerson(p.id), null); } catch { return; }
                      await refreshPeople(); setManaging(null);
                    }}>Remove</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {inactive.length > 0 && (
          <button className="ghostbtn text-[12px] text-muted p-[8px_0_0]" onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? 'Hide' : 'Show'} {inactive.length} with consent revoked
          </button>
        )}
      </Section>
    );
  }

  if (compact) {
    return (
      <>
        <div className="sectiontitle">
          <div>
            <h2>People and consent</h2>
            <p>Shared across every production in this workspace.</p>
          </div>
          {inviteBtn}
        </div>
        {body}
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Collaborators"
        lead="Invite someone to approve their appearance and voice without giving them project access."
        actions={inviteBtn}
        tabs={tabs}
      />

      <Section title="Approvals" meta={`${approved} of ${people.length} approved`}>
        {body}
      </Section>

      <Section title="How consent works">
        <ol className="flex flex-wrap gap-[6px] list-none p-0 m-0 [counter-reset:step]">
          <li className={FLOW_STEP}>Consent</li>
          <li className={FLOW_STEP}>Appearance / avatar</li>
          <li className={FLOW_STEP}>Voice</li>
          <li className={FLOW_STEP}>Preview</li>
          <li className={FLOW_STEP}>Usage scope</li>
          <li className={FLOW_STEP}>Optional final-publication approval</li>
        </ol>
        <p className="sectionnote">
          <Lock size={14} /> Scope can be one production, a series, or the workspace until revoked.
        </p>
      </Section>
    </>
  );
}
