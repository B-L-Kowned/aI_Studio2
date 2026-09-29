import React, { useState, useEffect, useCallback } from 'react';
import { Check, AlertCircle, Plus, X, Archive, RotateCcw, ChevronDown, Search } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section } from '../components/Section.jsx';

const ROSTER_PAGE_SIZE = 24;

function searchablePresenter(presenter) {
  const persona = presenter.persona ?? {};
  return [
    presenter.name,
    presenter.tagline,
    presenter.description,
    presenter.avatar?.name,
    presenter.voice?.name,
    persona.voice,
    persona.signatureOpening,
    persona.signOff,
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toLocaleUpperCase() || '?';
}

/**
 * Who appears on screen — and the actual comedy/content gate.
 *
 * Characters have artwork. The stock roster and your own likeness do not, and
 * must not: a stock photo standing in for "a real presenter" is a claim about a
 * person who does not exist. They render as typographic tiles, and the visual
 * difference IS the taxonomy.
 */
export default function Presenters({ tab: externalTab, onTabs }) {
  const { mutate } = useStudio();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(ROSTER_PAGE_SIZE);

  const load = useCallback(async () => {
    const d = await api.presenters(showRetired);
    setData(d);
    setTab((t) => t ?? d.tabs[0]?.id ?? null);
    onTabs?.(d.tabs);
  }, [showRetired]);

  useEffect(() => { load(); }, [load]);

  const chosen = externalTab ?? tab;
  const normalizedQuery = query.trim().toLocaleLowerCase();

  useEffect(() => {
    setQuery('');
    setVisibleCount(ROSTER_PAGE_SIZE);
  }, [chosen]);

  useEffect(() => {
    setVisibleCount(ROSTER_PAGE_SIZE);
  }, [normalizedQuery, showRetired]);

  if (!data) return <p className="muted">Loading…</p>;
  const active = data.tabs.find((t) => t.id === chosen) ?? data.tabs[0];
  const matches = active?.presenters.filter((p) =>
    !normalizedQuery || searchablePresenter(p).includes(normalizedQuery)
  ) ?? [];
  const visiblePresenters = matches.slice(0, visibleCount);

  const run = async (fn) => {
    setErr(null);
    try { await mutate(fn, null); await load(); }
    catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <div className="title">
        {/* Under Cast the bar above names the roster, so repeating "Presenters"
            here would label the page with one of its own tabs. */}
        <h1>{externalTab === undefined ? 'Presenters' : 'Cast'}</h1>
        <div className="quickrow">
          <button onClick={() => setShowRetired((v) => !v)}>
            {showRetired ? 'Hide retired' : 'Show retired'}
          </button>
          {active?.id !== 'personal' && (
            <button className="primary" onClick={() => setAdding(true)}>
              <Plus size={14} /> New {active?.id === 'characters' ? 'character' : 'presenter'}
            </button>
          )}
        </div>
      </div>

      {/* The "funny"/"content" badges that used to sit here restated the licence,
          which the program bubbles in the header now say once, in words, and
          act on. Under Cast the roster bar above already names what you are
          looking at, so this whole strip was the third header in a row. */}
      {externalTab === undefined && (
        <div className="prodmeta">
          <span className="path">Who appears on screen.</span>
        </div>
      )}

      {/* When Cast supplies the roster, it draws the bar too. */}
      {externalTab === undefined && (
        <div className="stagebar">
          {data.tabs.map((t) => (
            <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
              <span className="tabcount">{t.presenters.length}</span>
            </button>
          ))}
        </div>
      )}

      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}

      {active && (
        <>
          {active.presenters.length === 0 ? (
            <Section title={active.label} meta={active.detail}>
              <p className="sectionempty">Nothing here yet.</p>
            </Section>
          ) : (
            <Section title={active.label} meta={active.detail}>
            <div className="rostertools">
              <label className="rostersearch">
                <Search size={14} aria-hidden="true" />
                <span className="sr-only">Search {active.label}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${active.label.toLocaleLowerCase()}…`}
                />
              </label>
              <span className="rostercount" aria-live="polite">
                {matches.length === active.presenters.length
                  ? `${active.presenters.length} total`
                  : `${matches.length} of ${active.presenters.length}`}
              </span>
            </div>

            {matches.length === 0 ? (
              <p className="sectionempty">No {active.label.toLocaleLowerCase()} match “{query.trim()}”.</p>
            ) : (
              <>
            <div className="presgrid">
              {visiblePresenters.map((p) => (
                <div className={'prescard' + (p.isActive ? '' : ' retired')} key={p.id}>
                  {/* The tile IS the taxonomy: art for characters, type for the rest. */}
                  {p.hasArtwork ? (
                    <div className="presart" style={{ backgroundImage: `url(${p.artworkUrl})` }}>
                      <span className="presartfallback">{p.name[0]}</span>
                    </div>
                  ) : (
                    // No artwork must not become a fabricated face. Initials
                    // create a useful visual anchor without repeating the name
                    // or making a false identity claim.
                    <div className="prestype slim" aria-hidden="true">
                      <span>{initials(p.name)}</span>
                      <em>{active.id === 'characters' ? 'character' : active.id === 'personal' ? 'you' : 'presenter'}</em>
                    </div>
                  )}

                  <b>{p.name}</b>
                  <small>{p.tagline || p.description}</small>

                  {/* A persona that only shows a name is decoration. These are
                      the lines that actually steer the script. */}
                  {p.persona && (p.persona.voice || p.persona.signatureOpening) && (
                    <dl className="persona">
                      {p.persona.voice && (
                        <><dt>Voice</dt><dd>{p.persona.voice}</dd></>
                      )}
                      {p.persona.signatureOpening && (
                        <><dt>Opens</dt><dd>{p.persona.signatureOpening}</dd></>
                      )}
                      {p.persona.signOff && (
                        <><dt>Signs off</dt><dd>{p.persona.signOff}</dd></>
                      )}
                      {p.persona.neverClaim && (
                        <><dt className="warn">Never claims</dt><dd className="warn">{p.persona.neverClaim}</dd></>
                      )}
                    </dl>
                  )}

                  {/* Casting is the same action on every card, so it sits in
                      the same place on every card — pinned to the bottom rather
                      than floating wherever the text above happens to end. */}
                  <div className="prescardfoot">
                    <div className="presstate">
                      {p.ready
                        ? <span className="okv"><Check size={12} /> {p.avatar.name} · {p.voice.name}</span>
                        : <span className="unknownv"><AlertCircle size={12} /> not cast yet</span>}
                    </div>

                    <CastRow presenter={p} options={data.options} onSave={(body) =>
                      run(() => api.castPresenter(p.id, body))} />

                    <button
                      className="ghostbtn"
                      onClick={() => run(() => api.retirePresenter(p.id, !p.isActive))}
                    >
                      {p.isActive ? <><Archive size={12} /> Retire</> : <><RotateCcw size={12} /> Restore</>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {visiblePresenters.length < matches.length && (
              <div className="rosterload">
                <span>Showing {visiblePresenters.length} of {matches.length}</span>
                <button onClick={() => setVisibleCount((count) => count + ROSTER_PAGE_SIZE)}>
                  Show {Math.min(ROSTER_PAGE_SIZE, matches.length - visiblePresenters.length)} more
                </button>
              </div>
            )}
              </>
            )}
            </Section>
          )}

          {!active.presenters.some((p) => p.ready) && (
            <div className="notice warn">
              <AlertCircle />
              <span>
                None of these are cast to a real avatar and voice yet. Connect HeyGen under
                Settings → Connections and sync, then pick one for each.
              </span>
            </div>
          )}
        </>
      )}

      {adding && (
        <NewPresenter
          kind={active.id === 'characters' ? 'character' : 'avatar'}
          onClose={() => setAdding(false)}
          onDone={load}
        />
      )}
    </>
  );
}

/**
 * Pick one provider asset.
 *
 * This was a <select> holding whatever the page had been handed — 25 avatars
 * of 9,967 and 200 voices of 2,943. The other 99.7% could not be cast to at
 * all, because a roster of ten thousand cannot be shipped as option nodes.
 *
 * The server was already built for this: /providers/:id/assets takes `q` and
 * returns {items, matched, total}. Only the input was missing, so the whole
 * catalogue was sitting one query away from a page that never asked.
 *
 * Empty box = yours first, which is the useful default. Type and it searches
 * everything, and says how many it searched so the number is never a mystery.
 */
function AssetPicker({ kind, label, current, fallback, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBusy(true);
    // Debounced: a keystroke per request would queue ten searches for one word,
    // and the answers can arrive out of order.
    const timer = setTimeout(async () => {
      try {
        const r = await api.providerAssets('heygen', { kind, q: q.trim(), limit: 40 });
        if (alive) setRes(r);
      } catch { if (alive) setRes(null); }
      finally { if (alive) setBusy(false); }
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, q, kind]);

  const items = res?.items ?? fallback ?? [];

  return (
    <div className={'apick' + (current ? ' set' : '')}>
      <button type="button" className="apickbtn" onClick={() => setOpen((v) => !v)}>
        {current ? current.name : `${label}…`}
        <ChevronDown size={12} />
      </button>

      {open && (
        <>
          <div className="apickscrim" onClick={() => setOpen(false)} />
          <div className="apickpanel">
            <input
              className="apicksearch"
              placeholder={`Search ${label}s…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              autoFocus
            />
            <div className="apickmeta">
              {busy ? 'searching…'
                : res
                  ? `${res.matched} of ${res.total}${q.trim() ? '' : ' · yours first'}`
                  : 'could not search'}
            </div>
            <div className="apicklist">
              {current && (
                <button type="button" className="apickclear" onClick={() => { onPick(null); setOpen(false); }}>
                  Clear {label}
                </button>
              )}
              {items.length === 0 && !busy && <p className="muted">Nothing matches.</p>}
              {items.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className={a.id === current?.id ? 'cur' : ''}
                  onClick={() => { onPick(a.id); setOpen(false); }}
                >
                  {a.name?.trim() || '(unnamed)'}
                  {a.owned && <em>yours</em>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CastRow({ presenter, options, onSave }) {
  return (
    <div className="castrow">
      <AssetPicker
        kind="avatar" label="avatar"
        current={presenter.avatar}
        fallback={options.avatars}
        onPick={(id) => onSave({ avatarAssetId: id })}
      />
      <AssetPicker
        kind="voice" label="voice"
        current={presenter.voice}
        fallback={options.voices}
        onPick={(id) => onSave({ voiceAssetId: id })}
      />
    </div>
  );
}

function NewPresenter({ kind, onClose, onDone }) {
  const { mutate } = useStudio();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [artworkUrl, setArtworkUrl] = useState('');
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await mutate(() => api.createPresenter({
        kind, name, description,
        artworkUrl: kind === 'character' ? (artworkUrl || null) : null,
      }), null);
      await onDone();
      onClose();
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modalhead">
          <b>New {kind}</b>
          <button onClick={onClose}><X size={15} /></button>
        </div>
        <form onSubmit={submit}>
          <label className="oblabel">
            Name
            <input className="obinput" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'character' ? 'e.g. Marv the Consultant' : 'e.g. Daniel — Business Casual'} />
          </label>
          <label className="oblabel">
            Description
            <input className="obinput" value={description}
              onChange={(e) => setDescription(e.target.value)} />
          </label>

          {kind === 'character' ? (
            <label className="oblabel">
              Artwork URL
              <input className="obinput" value={artworkUrl}
                onChange={(e) => setArtworkUrl(e.target.value)} placeholder="/art/name.png" />
              <small className="muted">Characters are invented, so they get artwork.</small>
            </label>
          ) : (
            <div className="notice">
              <AlertCircle />
              <span>
                A stock presenter gets no artwork on purpose — a photo standing in for a
                real person is a claim about someone who does not exist. It renders as a
                typographic tile.
              </span>
            </div>
          )}

          {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}
          <div className="actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" type="submit" disabled={!name.trim()}>Create</button>
          </div>
        </form>
      </div>
    </>
  );
}
