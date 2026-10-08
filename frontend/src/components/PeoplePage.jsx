import React, { useState } from 'react';
import { UserPlus, Check, Clock, Lock, Copy, X, AlertCircle } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section, PageHead, Empty } from './Section.jsx';

const FLOW_STEP = 'flex items-center gap-[6px] text-[12px] text-ink-2 bg-surface-2 border border-solid border-line rounded-[20px] p-[5px_11px]'
  + ' before:[counter-increment:step] before:content-[counter(step)] before:w-[15px] before:h-[15px] before:rounded-[50%]'
  + ' before:bg-line before:text-muted before:grid before:place-items-center before:text-[9px]';

const SCOPES = [
  ['production', 'This production'],
  ['series', 'This series'],
  ['workspace', 'Workspace'],
];

export default function PeoplePage({ compact, tabs, section = false }) {
  const { collections, refreshPeople, mutate } = useStudio();
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
    <button className={section ? '' : 'primary'} onClick={() => setInviting((v) => !v)}>
      <UserPlus size={14} /> Invite collaborator
    </button>
  );

  const body = (
    <>
      {inviting && (
        <form className="flex gap-[8px] m-[13px_0]" onSubmit={sendInvite}>
          <input className="flex-1" placeholder="Collaborator name" value={name}
            onChange={(e) => setName(e.target.value)} autoFocus />
          <button className="primary" type="submit" disabled={!name.trim()}>Create invite</button>
          <button type="button" onClick={() => setInviting(false)}><X size={15} /></button>
        </form>
      )}

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
                      if (!window.confirm(`Remove ${p.name}? Their consent record is deleted; productions are not affected.`)) return;
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
        {inviting && (
          <form className="flex gap-[8px] m-[0_0_12px]" onSubmit={sendInvite}>
            <input className="flex-1" placeholder="Collaborator name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="primary" type="submit" disabled={!name.trim()}>Create invite</button>
            <button type="button" onClick={() => setInviting(false)}><X size={15} /></button>
          </form>
        )}
        {invite && (
          <div className="notice"><Copy size={15} /><span>Invite link: <code>{invite}</code> — they approve appearance and voice without project access.</span>
            <button onClick={() => setInvite(null)}><X size={14} /></button></div>
        )}
        <div className="border border-solid border-line rounded-lg bg-surface overflow-clip">
          {people.map((p) => (
            <div key={p.id} className="[&+&]:[border-top:1px_solid_var(--line)]">
              <div className="grid grid-cols-[32px_minmax(160px,1fr)_minmax(200px,1fr)_auto] gap-[12px] items-center p-[9px_14px]">
                <span className="w-[32px] h-[32px] rounded-full bg-surface-2 border border-solid border-line grid place-items-center text-[12px] text-ink-2 font-[600]">{p.name[0]}</span>
                <span className="min-w-0"><b className="block text-[13.5px] font-[580] truncate">{p.name}</b><span className="text-[12px] text-muted">{p.role}</span></span>
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
                  {!/owner/i.test(p.role) && (
                    <button className="text-[12px] p-[4px_10px] text-danger" onClick={async () => {
                      if (!window.confirm(`Remove ${p.name}? Their consent record is deleted; productions are not affected.`)) return;
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
