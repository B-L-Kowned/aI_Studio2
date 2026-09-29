import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Building2, X, Archive, RotateCcw, ChevronRight } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { PageHead, Empty } from '../components/Section.jsx';

/**
 * Company → Track → Production.
 *
 * Campaigns were doing three jobs at once: "Artificial Funny" was a company,
 * "AI for Operators — Season 1" a series and "Product Launches" a theme, all
 * stored identically. That works at four and stops working at fifty, because
 * the only way to express "Fixology's investor track" is to flatten it into a
 * name and hope the list sorts.
 *
 * A TRACK is where the audience lives, and the audience is the thing that
 * actually changes the script: the same company says different things to
 * investors and to buyers.
 */
export default function Companies({ go }) {
  const { collections, mutate, setPendingView } = useStudio();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [editing, setEditing] = useState(null);   // campaign id being assigned
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(
    () => api.companies(showRetired).then(setData),
    [showRetired]
  );
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    try { await mutate(fn, null); await load(); }
    catch { /* mutate reports it */ }
  };

  if (!data) return <p className="muted">Loading…</p>;
  const { companies, purposes } = data;

  // Campaigns with no company yet — the thing to clean up.
  const claimed = new Set(companies.flatMap((c) => c.tracks.map((t) => t.id)));
  const loose = collections.campaigns.filter((c) => !claimed.has(c.id));

  return (
    <>
      <PageHead
        title="Companies"
        lead="Who the work is for, and what each track is trying to do for them."
        actions={
          <>
            <button onClick={() => setShowRetired((v) => !v)}>
              {showRetired ? 'Hide' : 'Show'} retired
            </button>
            <button className="primary" onClick={() => setAdding(true)}>
              <Plus size={14} /> Company
            </button>
          </>
        }
      />

      {adding && (
        <form
          className="parkform"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const body = { name, domain: domain.trim() || null };
            setName(''); setDomain(''); setAdding(false);
            await run(() => api.addCompany(body));
          }}
        >
          <input autoFocus placeholder="Company name" value={name}
            onChange={(e) => setName(e.target.value)} />
          <input placeholder="domain.com (optional)" value={domain}
            onChange={(e) => setDomain(e.target.value)} />
          <button className="primary" type="submit" disabled={!name.trim()}>Add</button>
          <button type="button" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}

      {companies.length === 0 && loose.length === 0 && !adding && (
        <Empty icon={Building2} action={
          <button className="primary" onClick={() => setAdding(true)}>Add the first company</button>
        }>
          No companies yet. A company holds tracks — promotion, GTM, investor — and each
          track knows who it is talking to.
        </Empty>
      )}

      {(companies.length > 0 || loose.length > 0) && (
        <section className="companyroster" aria-label="Companies and tracks">
          <div className="companycolumns" aria-hidden="true">
            <span>Company / track</span>
            <span>Audience / status</span>
            <span>Videos</span>
            <span />
          </div>

          {companies.map((c) => (
            <div className={'companygroup' + (c.isActive ? '' : ' retired')} key={c.id}>
              <div className="companyline">
                <span className="companymain">
                  <Building2 size={15} aria-hidden="true" />
                  <span>
                    <b>{c.name}</b>
                    {c.domain && <i>{c.domain}</i>}
                  </span>
                </span>
                <span className="companysummary">
                  {c.counts.tracks} track{c.counts.tracks === 1 ? '' : 's'}
                </span>
                <span className="companyvideos" aria-label={`${c.counts.productions} videos`}>
                  {c.counts.productions}
                </span>
                <button
                  className="ghostbtn companyretire"
                  aria-label={c.isActive ? `Retire ${c.name}` : `Restore ${c.name}`}
                  title={c.isActive ? 'Retire — keeps every video reachable' : 'Bring back'}
                  onClick={() => run(() => api.retireCompany(c.id, !c.isActive))}
                >
                  {c.isActive ? <Archive size={13} /> : <RotateCcw size={13} />}
                </button>
              </div>

              {c.tracks.length === 0 ? (
                <div className="companyempty">
                  <ChevronRight size={13} aria-hidden="true" />
                  <span>No tracks yet</span>
                  <i>Assign an unassigned campaign below, or create one in Campaigns.</i>
                </div>
              ) : c.tracks.map((t) => (
                <div className="companytrack" key={t.id}>
                  <span className="companytrackname">
                    <ChevronRight size={13} aria-hidden="true" />
                    <span className={'purposetag ' + (t.purpose ?? 'none')}>
                      {purposes.find((p) => p.id === t.purpose)?.label ?? 'no purpose'}
                    </span>
                    <b>{t.name}</b>
                  </span>
                  <span className={'trackaudience' + (t.audience ? '' : ' missing')}>
                    {t.audience || 'Audience not set'}
                  </span>
                  <span className="companyvideos" aria-label={`${t.productions} videos`}>
                    {t.productions}
                  </span>
                  <button onClick={() => setEditing(t.id)}>Edit</button>
                </div>
              ))}
            </div>
          ))}

          {/* The clean-up. Every campaign that predates this layer stays in
              the same roster until someone assigns its company and purpose. */}
          {loose.length > 0 && (
            <div className="companygroup unassigned">
              <div className="companyline">
                <span className="companymain">
                  <Building2 size={15} aria-hidden="true" />
                  <span><b>Not assigned</b></span>
                </span>
                <span className="companysummary">
                  {loose.length} campaign{loose.length === 1 ? '' : 's'} with no company
                </span>
                <span />
                <span />
              </div>
              {loose.map((t) => (
                <div className="companytrack" key={t.id}>
                  <span className="companytrackname">
                    <ChevronRight size={13} aria-hidden="true" />
                    <span className="purposetag none">unassigned</span>
                    <b>{t.name}</b>
                  </span>
                  <span className="trackaudience missing">Choose a company, purpose and audience</span>
                  <span />
                  <button className="primary" onClick={() => setEditing(t.id)}>Assign</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {editing && (
        <TrackDialog
          campaignId={editing}
          companies={companies}
          purposes={purposes}
          existing={[...companies.flatMap((c) => c.tracks), ...loose].find((t) => t.id === editing)}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </>
  );
}

function TrackDialog({ campaignId, companies, purposes, existing, onClose, onSaved }) {
  const { mutate } = useStudio();
  const [companyId, setCompanyId] = useState(
    companies.find((c) => c.tracks.some((t) => t.id === campaignId))?.id ?? ''
  );
  const [purpose, setPurpose] = useState(existing?.purpose ?? '');
  const [audience, setAudience] = useState(existing?.audience ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await mutate(() => api.setTrack(campaignId, {
        companyId: companyId ? Number(companyId) : null,
        purpose: purpose || null,
        audience: audience.trim() || null,
      }), null);
      onSaved();
    } catch { /* mutate reports it */ }
    finally { setBusy(false); }
  };

  const chosen = purposes.find((p) => p.id === purpose);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modalhead">
          <b>{existing?.name ?? 'Track'}</b>
          <button onClick={onClose}><X size={15} /></button>
        </div>

        <label className="oblabel">
          Company
          <select className="obinput" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">No company</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <label className="oblabel">
          What is this track for?
          <select className="obinput" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="">Not set</option>
            {purposes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {chosen && <small className="obhelp">{chosen.detail}</small>}
        </label>

        <label className="oblabel">
          Who is it talking to?
          <input
            className="obinput"
            placeholder="e.g. Seed-stage investors who have seen the deck"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          />
          <small className="obhelp">
            This reaches the script generator. It is the difference between an investor
            update and an advert for the same company.
          </small>
        </label>

        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>Save track</button>
        </div>
      </div>
    </>
  );
}
