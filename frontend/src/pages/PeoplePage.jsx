import React, { useState } from 'react';
import { UserPlus, Check, Clock, Lock, Copy, X, AlertCircle } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section, PageHead, Empty } from '../components/Section.jsx';

const SCOPES = [
  ['production', 'This production'],
  ['series', 'This series'],
  ['workspace', 'Workspace'],
];

export default function PeoplePage({ compact }) {
  const { collections, refreshPeople, mutate } = useStudio();
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState(null);
  const [managing, setManaging] = useState(null);

  const people = collections.people;
  const approved = people.filter((p) => p.status === 'approved').length;

  const sendInvite = async (e) => {
    e.preventDefault();
    const res = await mutate(() => api.invitePerson(name, 'Guest'), null);
    setInvite(res.data.inviteUrl);
    setName('');
    setInviting(false);
    await refreshPeople();
  };

  const inviteBtn = (
    <button className="primary" onClick={() => setInviting((v) => !v)}>
      <UserPlus size={14} /> Invite collaborator
    </button>
  );

  const body = (
    <>
      {inviting && (
        <form className="inviteform" onSubmit={sendInvite}>
          <input placeholder="Collaborator name" value={name}
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
        <div className="peoplegrid">
          {people.map((p) => (
            <div className="person" key={p.id}>
              <div className="avatar">{p.name[0]}</div>
              <b>{p.name}</b>
              <span>{p.role}</span>
              <small>{p.representation}</small>
              <small className={p.status === 'approved' ? 'okv' : 'unknownv'}>
                {p.status === 'approved'
                  ? <><Check size={13} /> Approved: {p.consentScope}</>
                  : <><Clock size={13} /> Awaiting setup</>}
              </small>

              {managing === p.id ? (
                <div className="consentbox">
                  {p.status === 'approved' ? (
                    <button onClick={async () => {
                      await mutate(() => api.revokeConsent(p.id), null);
                      await refreshPeople(); setManaging(null);
                    }}>Revoke consent</button>
                  ) : (
                    <>
                      <small>Grant consent for:</small>
                      {SCOPES.map(([v, l]) => (
                        <button key={v} onClick={async () => {
                          await mutate(() => api.grantConsent(p.id, v), null);
                          await refreshPeople(); setManaging(null);
                        }}>{l}</button>
                      ))}
                    </>
                  )}
                  <button onClick={() => setManaging(null)}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setManaging(p.id)}>
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
  if (compact) {
    return (
      <>
        <div className="sectiontitle">
          <div>
            <h2>People in this production</h2>
            <p>Use approved avatars, real footage, or a hybrid.</p>
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
        title="People &amp; Collaborators"
        lead="Invite someone to approve their appearance and voice without giving them project access."
        actions={inviteBtn}
      />

      <Section title="Collaborators" meta={`${approved} of ${people.length} approved`}>
        {body}
      </Section>

      <Section title="How consent works">
        <ol className="flowlist">
          <li>Consent</li>
          <li>Appearance / avatar</li>
          <li>Voice</li>
          <li>Preview</li>
          <li>Usage scope</li>
          <li>Optional final-publication approval</li>
        </ol>
        <p className="sectionnote">
          <Lock size={14} /> Scope can be one production, a series, or the workspace until revoked.
        </p>
      </Section>
    </>
  );
}
