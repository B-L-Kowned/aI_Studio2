import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Building2, X, Archive, RotateCcw, ChevronRight, Search } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { PageHead, Empty } from '../components/Section.jsx';

// One grid for the header, company lines and track lines, so the columns align.
const ROW = 'grid grid-cols-[minmax(260px,1.15fr)_minmax(240px,1fr)_64px_74px] items-center gap-[14px]';
// Narrow: lines and tracks fold to two columns; the column header just hides.
const ROW_NARROW = `${ROW} lte800:grid-cols-[minmax(0,1fr)_auto] lte800:gap-[7px_12px]`;
const COMPANY_LINE = `${ROW_NARROW} min-h-[50px] p-[7px_14px] [border-bottom:1px_solid_var(--line)]`;
const TRACK = `${ROW_NARROW} min-h-[54px] p-[7px_14px] [&+&]:[border-top:1px_solid_var(--line)]`;
const COMPANY_MAIN = 'min-w-0 flex items-center gap-[9px] [&>svg]:flex-none [&>svg]:text-muted';
const COMPANY_MAIN_TEXT = 'min-w-0 flex items-baseline gap-[9px]';
const COMPANY_NAME = 'text-[13.5px] font-[620]';
const COMPANY_SUMMARY = `text-muted text-[11.5px] lte800:[grid-column:1] lte800:[grid-row:2]`;
const VIDEOS = `text-right text-muted font-mono text-[11.5px] not-italic font-normal leading-[normal] lte800:[grid-column:2] lte800:[grid-row:1]`;
const TRACK_NAME = 'min-w-0 flex items-center gap-[9px] [&>svg]:flex-none [&>svg]:ml-[4px] [&>svg]:text-line-2';
const TRACK_TITLE = 'truncate text-[13px] font-[560]';
const AUDIENCE = `truncate text-[11.5px] lte800:[grid-column:1] lte800:[grid-row:2]`;
const TRACK_BUTTON = `justify-self-end lte800:[grid-column:2] lte800:[grid-row:2]`;
const HELP = 'block mt-[5px] text-faint text-[11.5px] leading-[1.5]';
const GROUP_HEAD = 'flex items-baseline gap-[10px] p-[14px_14px_8px] bg-surface [border-top:1px_solid_var(--line-2)] first:border-t-0';
const UNGROUPED = 'No group';

// "Goalzie — Go to market" under the Goalzie heading reads as "Go to market".
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const trackLabel = (track, company) => {
  const [head, ...rest] = track.split(' — ');
  return rest.length && squash(head) === squash(company) ? rest.join(' — ') : track;
};

// The purpose is a closed set so the same track means the same thing across
// fifty companies. Colour reinforces that they are comparable.
const PURPOSE_TAG = 'text-[10px] tracking-[.04em] uppercase font-semibold p-[3px_7px] rounded-[3px] whitespace-nowrap min-w-[74px] text-center border border-solid';
const PURPOSE_TONE = {
  promotion: 'bg-accent-soft text-accent border-accent-line',
  gtm: 'bg-ok-soft text-ok border-[#c5e3d5]',
  investor: 'bg-warn-soft text-warn border-warn-line',
  training: 'bg-surface-2 text-ink-2 border-line',
  recruiting: 'bg-surface-2 text-ink-2 border-line',
  internal: 'bg-surface-2 text-faint border-line',
  none: 'bg-danger-soft text-danger border-[#f2ccc9]',
};
const purposeTag = (purpose) =>
  `${PURPOSE_TAG} ${PURPOSE_TONE[purpose] ?? 'bg-canvas text-muted border-line'}`;

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
export default function Companies({ go, tabs }) {
  const { collections, mutate, setPendingView } = useStudio();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [editing, setEditing] = useState(null);   // campaign id being assigned
  const [showRetired, setShowRetired] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(
    () => api.companies(showRetired).then(setData),
    [showRetired]
  );
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    try { await mutate(fn, null); await load(); }
    catch { /* mutate reports it */ }
  };

  if (!data) return <><PageHead title="Companies" tabs={tabs} /><p className="muted">Loading…</p></>;
  const { companies, purposes } = data;

  // Campaigns with no company yet — the thing to clean up.
  const claimed = new Set(companies.flatMap((c) => c.tracks.map((t) => t.id)));
  const loose = collections.campaigns.filter((c) => !claimed.has(c.id));

  const q = query.trim().toLowerCase();
  const matches = (c) => !q || [c.name, c.domain, c.group, c.notes, ...c.tracks.map((t) => t.name)]
    .some((v) => v && v.toLowerCase().includes(q));
  const shown = companies.filter(matches);
  const looseShown = loose.filter((t) => !q || t.name.toLowerCase().includes(q));
  // Groups A–Z with ungrouped last; the API already sorts companies A–Z.
  const groups = [...new Set(shown.map((c) => c.group || UNGROUPED))]
    .sort((a, b) => (a === UNGROUPED) - (b === UNGROUPED) || a.localeCompare(b))
    .map((g) => ({ name: g, companies: shown.filter((c) => (c.group || UNGROUPED) === g) }));

  return (
    <>
      <PageHead
        title="Companies"
        tabs={tabs}
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
          className="flex gap-[8px] m-[4px_0_18px]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const body = { name, domain: domain.trim() || null };
            setName(''); setDomain(''); setAdding(false);
            await run(() => api.addCompany(body));
          }}
        >
          <input className="flex-1 text-[13.5px] p-[9px_11px]" autoFocus placeholder="Company name" value={name}
            onChange={(e) => setName(e.target.value)} />
          <input className="flex-1 text-[13.5px] p-[9px_11px]" placeholder="domain.com (optional)" value={domain}
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

      {companies.length > 0 && (
        <div className="flex items-center gap-[10px] mt-[14px]">
          <label className="relative flex-1 max-w-[380px]">
            <Search size={14} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              className="w-full text-[13px] p-[8px_10px_8px_30px]"
              placeholder="Search companies, domains, groups"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search companies"
            />
          </label>
          <span className="text-faint text-[11.5px]">
            {q ? `${shown.length} of ${companies.length}` : companies.length} compan{companies.length === 1 ? 'y' : 'ies'}
            {' · '}{groups.length} group{groups.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {(companies.length > 0 || loose.length > 0) && (
        <section
          className="overflow-hidden mt-[16px] border border-solid border-line rounded-lg bg-surface [box-shadow:var(--shadow)]" aria-label="Companies and tracks">
          <div
            className={`${ROW} min-h-[34px] p-[0_14px] bg-surface-2 [border-bottom:1px_solid_var(--line)] text-faint text-[10px] font-semibold tracking-[.06em] uppercase lte800:hidden`}
            aria-hidden="true"
          >
            <span>Company / track</span>
            <span>Audience / status</span>
            <span className="text-right">Videos</span>
            <span />
          </div>

          {q && shown.length === 0 && looseShown.length === 0 && (
            <p className="p-[18px_14px] text-muted text-[12.5px]">No company matches “{query}”.</p>
          )}

          {groups.map((g) => (
            <div key={g.name}>
              <div className={GROUP_HEAD}>
                <b className="text-[11px] font-semibold tracking-[.06em] uppercase text-ink-2">{g.name}</b>
                <span className="text-faint text-[11px]">
                  {g.companies.length} compan{g.companies.length === 1 ? 'y' : 'ies'}
                  {' · '}{g.companies.reduce((n, c) => n + c.counts.productions, 0)} videos
                </span>
              </div>
          {g.companies.map((c) => (
            <div
              className={'[&+&]:[border-top:1px_solid_var(--line-2)]' + (c.isActive ? '' : ' retired opacity-[.55]')}
              key={c.id}
            >
              <div className={`${COMPANY_LINE} bg-surface-2`}>
                <span className={COMPANY_MAIN}>
                  <Building2 size={15} aria-hidden="true" />
                  <span className={COMPANY_MAIN_TEXT}>
                    <b className={COMPANY_NAME}>{c.name}</b>
                    {c.domain && (
                      <i className="truncate text-faint not-italic font-normal text-[10.5px] leading-[normal] font-mono">
                        {c.domain}
                      </i>
                    )}
                  </span>
                </span>
                <span className={COMPANY_SUMMARY}>
                  {c.counts.tracks} track{c.counts.tracks === 1 ? '' : 's'}
                </span>
                <span className={VIDEOS} aria-label={`${c.counts.productions} videos`}>
                  {c.counts.productions}
                </span>
                <button
                  className={`ghostbtn justify-self-end p-[6px] text-faint lte800:[grid-column:2] lte800:[grid-row:2]`}
                  aria-label={c.isActive ? `Retire ${c.name}` : `Restore ${c.name}`}
                  title={c.isActive ? 'Retire — keeps every video reachable' : 'Bring back'}
                  onClick={() => run(() => api.retireCompany(c.id, !c.isActive))}
                >
                  {c.isActive ? <Archive size={13} /> : <RotateCcw size={13} />}
                </button>
              </div>

              {c.tracks.length === 0 ? (
                <div className="min-h-[42px] p-[8px_14px_8px_18px] flex items-center gap-[9px] text-faint text-[11.5px] [&_svg]:flex-none [&_svg]:text-line-2">
                  <ChevronRight size={13} aria-hidden="true" />
                  <span className="text-muted font-[550]">No tracks yet</span>
                  <i className="not-italic">Assign an unassigned campaign below, or create one in Campaigns.</i>
                </div>
              ) : c.tracks.map((t) => (
                <div className={TRACK} key={t.id}>
                  <span className={TRACK_NAME}>
                    <ChevronRight size={13} aria-hidden="true" />
                    <span className={purposeTag(t.purpose ?? 'none')}>
                      {purposes.find((p) => p.id === t.purpose)?.label ?? 'no purpose'}
                    </span>
                    <b className={TRACK_TITLE} title={t.name}>{trackLabel(t.name, c.name)}</b>
                  </span>
                  <span className={AUDIENCE + (t.audience ? ' text-ink-2' : ' missing text-warn')} title={t.audience || undefined}>
                    {t.audience || 'Audience not set'}
                  </span>
                  <span className={VIDEOS} aria-label={`${t.productions} videos`}>
                    {t.productions}
                  </span>
                  <button className={`${TRACK_BUTTON} ghostbtn text-[12px] p-[3px_9px] text-muted hover:text-ink`} onClick={() => setEditing(t.id)}>Edit</button>
                </div>
              ))}
            </div>
          ))}
            </div>
          ))}

          {/* The clean-up. Every campaign that predates this layer stays in
              the same roster until someone assigns its company and purpose. */}
          {looseShown.length > 0 && (
            <div className="[&+&]:[border-top:1px_solid_var(--line-2)]">
              <div className={`${COMPANY_LINE} bg-warn-soft`}>
                <span className={COMPANY_MAIN}>
                  <Building2 size={15} aria-hidden="true" />
                  <span className={COMPANY_MAIN_TEXT}><b className={COMPANY_NAME}>Not assigned</b></span>
                </span>
                <span className={COMPANY_SUMMARY}>
                  {looseShown.length} campaign{looseShown.length === 1 ? '' : 's'} with no company
                </span>
                <span />
                <span />
              </div>
              {looseShown.map((t) => (
                <div className={TRACK} key={t.id}>
                  <span className={TRACK_NAME}>
                    <ChevronRight size={13} aria-hidden="true" />
                    <span className={purposeTag('none')}>unassigned</span>
                    <b className={TRACK_TITLE}>{t.name}</b>
                  </span>
                  <span className={`${AUDIENCE} missing text-warn`}>Choose a company, purpose and audience</span>
                  <span />
                  <button className={`primary ${TRACK_BUTTON}`} onClick={() => setEditing(t.id)}>Assign</button>
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
          {chosen && <small className={HELP}>{chosen.detail}</small>}
        </label>

        <label className="oblabel">
          Who is it talking to?
          <input
            className="obinput"
            placeholder="e.g. Seed-stage investors who have seen the deck"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
          />
          <small className={HELP}>
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
