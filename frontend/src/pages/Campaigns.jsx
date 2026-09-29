import React, { useState, useEffect } from 'react';
import { Plus, AlertCircle, Check, Lock, X, Trash2, Pencil, CalendarDays } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import NewProductionFlow from './NewProductionFlow.jsx';
import { Section, PageHead } from '../components/Section.jsx';

const STEP_LABEL = { plan: 'Plan', script: 'Script', render: 'Render', export: 'Export', publish: 'Publish' };

function relTime(iso) {
  if (!iso) return '';
  const secs = Math.max(0, (Date.now() - Date.parse(iso.replace(' ', 'T') + 'Z')) / 1000);
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function Campaigns({ go }) {
  const {
    collections, workspace, productions, production,
    openProduction, refreshProductions, reload, mutate,
    pendingCampaign, setPendingCampaign, inScope,
  } = useStudio();

  const [creatingIn, setCreatingIn] = useState(undefined); // undefined = closed
  const [newCampaign, setNewCampaign] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [dating, setDating] = useState(null);
  // `plan.series` is sold separately; the server refuses it too.
  const canSeries = workspace.capabilities.includes('plan.series');
  // A campaign's mode is comedy/content/both; a licence grants funny/content.
  // With the lane picker gone, visibility follows the licence alone.
  const programs = workspace.program?.programs ?? [];
  const covers = (campaignMode) =>
    campaignMode === 'both'
    || (campaignMode === 'comedy' && programs.includes('funny'))
    || (campaignMode === 'content' && programs.includes('content'));

  const open = async (id) => { await openProduction(id); go('Create'); };

  // Arrived by going UP from a production. Landing at the top of a list of
  // every campaign is not arriving anywhere, so scroll to the one we came from
  // and mark it — the answer has to be visible, not merely present.
  const [cameFrom, setCameFrom] = useState(null);
  useEffect(() => {
    if (pendingCampaign == null) return;
    setCameFrom(pendingCampaign);
    setPendingCampaign(null);
  }, [pendingCampaign, setPendingCampaign]);

  useEffect(() => {
    if (cameFrom == null) return;
    const el = document.querySelector(`[data-campaign="${cameFrom}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => setCameFrom(null), 2400);
    return () => clearTimeout(t);
  }, [cameFrom, collections.campaigns.length]);

  // Scoped by the program bubble in the header, the same way Home is. Without
  // this the bubble changed the dashboard's counts and left Plan showing all
  // fifteen productions — the two pages describing different slates while
  // claiming to be the same workspace.
  //
  // `inScope` keeps `both` rows in BOTH programs; see the note on it.
  const inView = productions.filter((p) => inScope(p.mode));

  const groups = [
    ...collections.campaigns
      .map((c) => ({
        ...c,
        items: inView.filter((p) => p.campaignId === c.id),
        real: true,
      }))
      // A campaign belonging to the other program goes away entirely. An empty
      // campaign that IS in this program stays: it is real, and hiding it is
      // how a container you meant to fill gets forgotten.
      .filter((g) => inScope(g.mode) || g.items.length > 0),
    {
      id: null, name: 'One-offs', mode: 'both', real: false,
      items: inView.filter((p) => !p.campaignId),
    },
  ].filter((g) => g.real || g.items.length > 0);

  const needsAttention = inView.filter((p) => p.stale > 0).length;

  return (
    <>
      <PageHead
        title="Campaigns"
        lead="A campaign holds multiple productions — series and one-offs."
        // ONE button. There were three — Campaign, New series, New production —
        // which asked you to know the difference between a container, a batch
        // and a single video before you had decided what you were making. The
        // modal is where that choice belongs, because that is where the options
        // can explain themselves.
        actions={
          <button className="primary" onClick={() => setCreatingIn(null)}>
            <Plus size={14} /> New
          </button>
        }
      />



      {creatingIn !== undefined && (
        <NewProductionFlow
          campaignId={creatingIn}
          canSeries={canSeries}
          onClose={() => setCreatingIn(undefined)}
          onDone={reload}
        />
      )}

      {newCampaign && <NewCampaign onClose={() => setNewCampaign(false)} onDone={reload} />}

      {deleting && (
        <>
          <div className="scrim" onClick={() => setDeleting(null)} />
          <div className="modal">
            <div className="modalhead">
              <b>Delete "{deleting.title}"?</b>
              <button onClick={() => setDeleting(null)}><X size={15} /></button>
            </div>
            <p className="muted">
              Its plan, script, segments, renders and publications go with it. Videos already
              rendered at HeyGen stay in your HeyGen account — this only removes the production
              from this app.
            </p>
            <div className="actions">
              <button onClick={() => setDeleting(null)}>Cancel</button>
              <button
                className="danger"
                onClick={async () => {
                  const target = deleting;
                  setDeleting(null);
                  try {
                    await mutate(() => api.deleteProduction(target.id), null);
                    await refreshProductions();
                    reload();
                  } catch { /* mutate reports it */ }
                }}
              >
                <Trash2 size={14} /> Delete production
              </button>
            </div>
          </div>
        </>
      )}

      <Section
        title="All productions"
        meta={`${groups.filter((g) => g.real).length} campaign${groups.filter((g) => g.real).length === 1 ? '' : 's'} · ${inView.length} production${inView.length === 1 ? '' : 's'}${needsAttention ? ` · ${needsAttention} need${needsAttention === 1 ? 's' : ''} attention` : ''}`}
        flush
      >
      <div className="camptable">
        {groups.map((g) => {
          const visible = covers(g.mode);
          return (
            <section
              className={'campgroup' + (visible ? '' : ' dimmed')
                + (cameFrom != null && g.id === cameFrom ? ' cameFrom' : '')}
              data-campaign={g.id ?? 'oneoff'}
              key={g.id ?? 'oneoff'}
            >
              <header>
                <b>{g.name}</b>
                {/* The track. `purpose` is a closed set so "investor" means the
                    same thing across fifty companies; `audience` is free text
                    because no enum survives fifty companies — and it is the one
                    that actually reaches generateScript. Both were in the
                    database and reached this page as null. */}
                {g.purpose && <span className="ctrack">{g.purpose}</span>}
                <span className="cmode">{g.mode}</span>
                <span className="ccount">{g.items.length}</span>
                {g.audience && <span className="caudience" title={g.audience}>{g.audience}</span>}
                {!visible && <span className="conn off"><Lock size={11} /> {g.mode} only</span>}
                <span className="spacer" />
                {/* "Add" lived here on every campaign, next to a "New" button
                    that does the same thing, above an empty campaign that also
                    said "add the first production" — three routes to one modal.
                    The empty state already offers it where it is actually
                    needed, so the header keeps only what is unique to it. */}
                {g.real && g.items.length === 0 && (
                  <button
                    className="ghostbtn danger"
                    title="Delete this empty campaign"
                    onClick={() => mutate(() => api.deleteCampaign(g.id), null).then(reload)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </header>

              {g.items.length === 0 ? (
                <p className="campempty">
                  Empty — <button className="linkbtn" onClick={() => setCreatingIn(g.id)}>
                    add the first production
                  </button> to "{g.name}".
                </p>
              ) : (
                g.items.map((p) => (
                  <div className={'prow' + (p.id === production.id ? ' cur' : '')} key={p.id}>
                    <button className="prowmain" onClick={() => open(p.id)} disabled={!visible}>
                      <span className="ptitle">
                        {p.title}
                        {p.id === production.id && <em className="openmark"><Check size={11} /> open</em>}
                      </span>
                      <span className="psub">
                        {p.counts.sections} sections · {p.counts.scenes} scenes · {p.targetRuntime}
                        {p.updatedAt && ` · ${relTime(p.updatedAt)}`}
                      </span>
                    </button>

                    <div className="pips" title={p.steps.map((s) => `${STEP_LABEL[s.key]}: ${s.state}`).join('\n')}>
                      {p.steps.map((s) => <i key={s.key} className={s.state} />)}
                      <span className="pipstage">{p.stage}/5</span>
                    </div>

                    <div className="prowactions">
                      {p.stale > 0 && (
                        <em className="stalemark" title={Object.values(p.staleDetail)[0]?.reason}>
                          <AlertCircle size={12} /> {p.stale} stale
                        </em>
                      )}
                      {/* The schedule tells you to set deadlines here, so they
                          are settable here. A date is what makes a production
                          schedulable rather than just present. */}
                      {dating === p.id ? (
                        <input
                          type="date"
                          className="rowdate"
                          autoFocus
                          defaultValue={p.dueAt ?? ''}
                          onChange={async (e) => {
                            setDating(null);
                            await mutate(() => api.setDueDate(p.id, e.target.value || null), null);
                            refreshProductions();
                          }}
                          onKeyDown={(e) => e.key === 'Escape' && setDating(null)}
                        />
                      ) : (
                        <button
                          className={'ghostbtn' + (p.dueAt ? ' hasdate' : '')}
                          title={p.dueAt ? `Due ${p.dueAt}` : 'Set a deadline'}
                          onClick={() => setDating(p.id)}
                        >
                          <CalendarDays size={13} />
                          {p.dueAt && <span className="rowdue">{p.dueAt.slice(5)}</span>}
                        </button>
                      )}
                      <button className="ghostbtn" title="Rename" onClick={() => setRenaming(p)}>
                        <Pencil size={13} />
                      </button>
                      {/* A list you cannot remove anything from fills up with
                          everything you ever tried. The endpoint existed the
                          whole time; nothing in the UI reached it. */}
                      <button
                        className="ghostbtn danger"
                        title={`Delete "${p.title}"`}
                        onClick={() => setDeleting(p)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>
          );
        })}
      </div>
      </Section>

      {renaming && (
        <RenameProduction
          production={renaming}
          campaigns={collections.campaigns}
          onClose={() => setRenaming(null)}
          onDone={refreshProductions}
        />
      )}
    </>
  );
}

function NewCampaign({ onClose, onDone }) {
  const { mutate, workspace } = useStudio();
  const [name, setName] = useState('');
  const programs = workspace.program?.programs ?? [];
  const usable = ['both', ...(programs.includes('funny') ? ['comedy'] : []),
                  ...(programs.includes('content') ? ['content'] : [])];
  const [mode, setMode] = useState(usable[0] ?? 'both');
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await mutate(() => api.createCampaign({ name, mode }), null);
      await onDone();
      onClose();
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modalhead">
          <b>New campaign</b>
          <button onClick={onClose}><X size={15} /></button>
        </div>
        <form onSubmit={submit}>
          <label className="oblabel">
            Name
            <input className="obinput" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Operator Playbooks" autoFocus />
          </label>
          <label className="oblabel">
            Mode
            <select className="obinput" value={mode} onChange={(e) => setMode(e.target.value)}>
              {usable.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}
          <div className="actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" type="submit" disabled={!name.trim()}>Create campaign</button>
          </div>
        </form>
      </div>
    </>
  );
}

function RenameProduction({ production, campaigns, onClose, onDone }) {
  const { mutate } = useStudio();
  const [title, setTitle] = useState(production.title);
  const [campaignId, setCampaignId] = useState(production.campaignId ?? '');
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await mutate(
        () => api.updateProduction(production.id, {
          title,
          campaignId: campaignId === '' ? null : Number(campaignId),
        }),
        null
      );
      await onDone();
      onClose();
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modalhead">
          <b>Edit production</b>
          <button onClick={onClose}><X size={15} /></button>
        </div>
        <form onSubmit={submit}>
          <label className="oblabel">
            Title
            <input className="obinput" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="oblabel">
            Campaign
            <select className="obinput" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">One-off — no campaign</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}
          <div className="actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" type="submit" disabled={!title.trim()}>Save</button>
          </div>
        </form>
      </div>
    </>
  );
}
