import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Flame, Archive, Trash2, ArrowUpRight, Check, Lightbulb } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section, PageHead, Empty } from '../components/Section.jsx';
import NewProductionFlow from '../components/NewProductionFlow.jsx';

/**
 * The parking lot.
 *
 * Capture has to be cheaper than the thing it captures. Recording "a video
 * about X for company Y" used to mean creating a whole production — a title, a
 * template, a campaign, five pipeline stages and a place in the schedule — so
 * the schedule filled with work nobody had decided to start.
 *
 * An idea here has no pipeline, no gate and no deadline. A parked thing with a
 * deadline is a production; that is the line between the two.
 */
const HEAT = {
  hot: { label: 'Hot', tone: 'hot' },
  normal: { label: 'Normal', tone: '' },
  low: { label: 'Someday', tone: 'low' },
};

export default function Ideas({ go }) {
  const { collections, mutate, production } = useStudio();
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [promoting, setPromoting] = useState(null);

  const load = useCallback(
    () => api.ideas(showArchived).then(setData),
    [showArchived]
  );
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    try { await mutate(fn, null); await load(); }
    catch { /* mutate reports it */ }
  };

  const park = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const body = { text, campaignId: campaignId ? Number(campaignId) : null };
    setText('');
    await run(() => api.addIdea(body));
  };

  if (!data) return <p className="muted">Loading…</p>;
  const { ideas, counts } = data;
  const live = ideas.filter((i) => !i.archivedAt);

  return (
    <>
      <PageHead
        title="Parking lot"
        lead="Things you might make. No pipeline, no deadline, no place in the schedule until you commit."
        actions={
          <button onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide' : 'Show'} archived
          </button>
        }
      />

      {/* One line, always in the same place. A capture box you have to go and
          find is a capture box nobody uses. */}
      <form className="parkform" onSubmit={park}>
        <input
          placeholder="Park an idea — a sentence is enough"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">No company</option>
          {collections.campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="primary" type="submit" disabled={!text.trim()}>
          <Plus size={14} /> Park it
        </button>
      </form>

      <Section
        title={showArchived ? 'Everything' : 'Parked'}
        meta={`${counts.total} open${counts.promoted ? ` · ${counts.promoted} became productions` : ''}`}
        flush
      >
        {ideas.length === 0 ? (
          <Empty icon={Lightbulb}>
            Nothing parked. This is where a thought goes when it is not yet a production.
          </Empty>
        ) : (
          <div className="parklist">
            {ideas.map((i) => (
              <div className={'parkrow' + (i.archivedAt ? ' archived' : '')} key={i.id}>
                <button
                  className={'heatbtn ' + (HEAT[i.heat]?.tone ?? '')}
                  title={`${HEAT[i.heat]?.label} — click to change`}
                  disabled={!!i.archivedAt}
                  onClick={() => run(() => api.updateIdea(i.id, {
                    heat: i.heat === 'hot' ? 'low' : i.heat === 'low' ? 'normal' : 'hot',
                  }))}
                >
                  <Flame size={13} />
                </button>

                <span className="parkmain">
                  <b>{i.text}</b>
                  <i>
                    {i.campaign ?? 'No company'} · parked {i.ageDays === 0 ? 'today' : `${i.ageDays}d ago`}
                    {i.promotedTitle && ` · became "${i.promotedTitle}"`}
                  </i>
                </span>

                {i.promotedTo ? (
                  <span className="okv"><Check size={12} /> made</span>
                ) : i.archivedAt ? (
                  <button onClick={() => run(() => api.updateIdea(i.id, { archived: false }))}>
                    Put back
                  </button>
                ) : (
                  <>
                    <button
                      className="primary"
                      title="Turn this into a production"
                      onClick={() => setPromoting(i)}
                    >
                      Make it <ArrowUpRight size={13} />
                    </button>
                    <button
                      className="ghostbtn"
                      title="Archive — keeps it, without it being in the way"
                      onClick={() => run(() => api.updateIdea(i.id, { archived: true }))}
                    >
                      <Archive size={13} />
                    </button>
                    <button
                      className="ghostbtn danger"
                      title="Delete for good"
                      onClick={() => run(() => api.deleteIdea(i.id))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Promoting opens the normal creation flow. The idea is marked as made
          only once a production actually exists, so a cancelled flow leaves the
          idea parked rather than quietly marking it done. */}
      {promoting && (
        <NewProductionFlow
          campaignId={promoting.campaignId}
          canSeries={false}
          prefillTitle={promoting.text}
          onClose={() => setPromoting(null)}
          onDone={async () => {
            const made = production?.id;
            if (made) await api.markIdeaPromoted(promoting.id, made).catch(() => {});
            setPromoting(null);
            await load();
          }}
        />
      )}
    </>
  );
}
