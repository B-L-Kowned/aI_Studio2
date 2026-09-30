import React, { useState, useEffect, useCallback } from 'react';
import { Check, AlertCircle, Plus, X, Archive, RotateCcw, ChevronDown, Search } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section } from '../components/Section.jsx';

const ROSTER_PAGE_SIZE = 24;

const PERSONA_DT = 'text-[10px] tracking-[.04em] uppercase whitespace-nowrap pt-[2px]';
const PERSONA_DD = 'm-0 text-[11.5px] leading-[1.5]';

// Asset picker rows. Hover/selected backgrounds are doubled-class (`&&`) so they
// still beat the generic `button:hover:not(:disabled)` rule, as the old
// `.apicklist button:hover` did by coming later at equal specificity.
const APICK_ROW = 'flex items-center justify-between gap-[8px] w-full text-left [border:0] cursor-pointer p-[5px_7px] rounded-sm text-[12px]';
const apickRowState = (cur) => (cur
  ? ' bg-accent-soft text-accent [&&:hover]:bg-accent-soft'
  : ' bg-transparent text-ink [&&:hover]:bg-canvas');

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
 * A character card shows the CHARACTER: its own artwork, or its monogram until
 * artwork exists. The avatar that performs it is a stock human face borrowed
 * for the voice and lip-sync, so putting that photo on the card made Marv the
 * Consultant look like a woman called Ailsa. The performer is still named, with
 * a small thumbnail, so a cast roster never reads as a list of bare names.
 * Presenter and personal cards ARE people, so they keep the avatar photo.
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
        <div className="flex items-center gap-[7px] flex-nowrap mb-[9px] min-h-[22px]">
          <span className="path text-[11.5px] text-muted whitespace-nowrap overflow-hidden text-ellipsis flex-[0_1_auto] min-w-[48px]">Who appears on screen.</span>
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
              <div className="flex items-center gap-[10px] mb-[12px] lte620:items-stretch lte620:flex-col">
                <label className="w-[min(360px,100%)] flex items-center gap-[7px] border border-solid border-line-2 bg-surface rounded p-[0_9px] text-muted focus-within:border-accent focus-within:[box-shadow:0_0_0_3px_var(--accent-soft)]">
                  <Search size={14} aria-hidden="true" />
                  <span className="sr-only">Search {active.label}</span>
                  <input
                    className="w-full min-w-0 [border:0] p-[8px_0] [box-shadow:none] focus:[border:0] focus:[box-shadow:none]"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${active.label.toLocaleLowerCase()}…`}
                  />
                </label>
                <span className="ml-auto text-muted text-[12px] whitespace-nowrap lte620:ml-0" aria-live="polite">
                  {matches.length === active.presenters.length
                    ? `${active.presenters.length} total`
                    : `${matches.length} of ${active.presenters.length}`}
                </span>
              </div>

              {matches.length === 0 ? (
                <p className="sectionempty">No {active.label.toLocaleLowerCase()} match “{query.trim()}”.</p>
              ) : (
                <>
                  <div className="grid grid-cols-[repeat(3,1fr)] gap-[12px] lte860:grid-cols-[repeat(2,1fr)] lte620:grid-cols-[1fr]">
                    {visiblePresenters.map((p) => (
                      <article
                        className={'min-w-0 overflow-hidden bg-surface border border-solid border-line rounded-lg p-0 flex flex-col [box-shadow:var(--shadow)]'
                          + (p.isActive ? '' : ' retired opacity-50')}
                        key={p.id}
                      >
                        <PresenterVisual presenter={p} tabId={active.id} />

                        <div className="p-[13px_14px_5px]">
                          <h3 className="text-[14px] leading-[1.3]">{p.name}</h3>
                          <p className="min-h-[2.9em] m-[5px_0_0] text-muted text-[12px] leading-[1.45]">{p.tagline || p.description || 'No character note yet.'}</p>
                        </div>

                  {/* A persona that only shows a name is decoration. These are
                      the lines that actually steer the script. */}
                  {p.persona && (p.persona.voice || p.persona.signatureOpening) && (
                    // Capped and scrolling: a long persona must not make its whole row as tall as itself.
                    <dl className="m-[5px_14px_2px] grid grid-cols-[auto_1fr] gap-[3px_8px] max-h-[190px] overflow-y-auto pr-[4px] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:bg-line-2 [&::-webkit-scrollbar-thumb]:rounded-[3px]">
                      {p.persona.voice && (
                        <><dt className={PERSONA_DT + ' text-faint'}>Voice</dt><dd className={PERSONA_DD + ' text-ink-2'}>{p.persona.voice}</dd></>
                      )}
                      {p.persona.signatureOpening && (
                        <><dt className={PERSONA_DT + ' text-faint'}>Opens</dt><dd className={PERSONA_DD + ' text-ink-2'}>{p.persona.signatureOpening}</dd></>
                      )}
                      {p.persona.signOff && (
                        <><dt className={PERSONA_DT + ' text-faint'}>Signs off</dt><dd className={PERSONA_DD + ' text-ink-2'}>{p.persona.signOff}</dd></>
                      )}
                      {p.persona.neverClaim && (
                        <><dt className={'warn ' + PERSONA_DT + ' text-warn'}>Never claims</dt><dd className={'warn ' + PERSONA_DD + ' text-warn'}>{p.persona.neverClaim}</dd></>
                      )}
                    </dl>
                  )}

                  {/* Casting is the same action on every card, so it sits in
                      the same place on every card — pinned to the bottom rather
                      than floating wherever the text above happens to end. */}
                  <div className="mt-auto p-[10px_14px_13px] flex flex-col gap-[7px]">
                    <div className="text-[11.5px] min-h-[1.4em]">
                      {p.ready
                        ? <span className="okv inline-flex items-center gap-[4px]"><Check size={12} /> Ready to produce</span>
                        : <span className="unknownv inline-flex items-center gap-[4px]"><AlertCircle size={12} /> Needs casting</span>}
                    </div>

                    <CastRow presenter={p} options={data.options} onSave={(body) =>
                      run(() => api.castPresenter(p.id, body))} />

                    <button
                      className="ghostbtn self-start"
                      onClick={() => run(() => api.retirePresenter(p.id, !p.isActive))}
                    >
                      {p.isActive ? <><Archive size={12} /> Retire</> : <><RotateCcw size={12} /> Restore</>}
                    </button>
                  </div>
                      </article>
                    ))}
                  </div>
                  {visiblePresenters.length < matches.length && (
                    <div className="flex justify-center items-center gap-[12px] pt-[16px] text-muted text-[12px]">
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

function PresenterVisual({ presenter, tabId }) {
  const [imageFailed, setImageFailed] = useState(false);
  const isCharacter = tabId === 'characters';
  const imageUrl = isCharacter ? presenter.artworkUrl : (presenter.artworkUrl || presenter.avatar?.previewUrl);
  const kind = isCharacter ? 'Character' : tabId === 'personal' ? 'You' : 'Presenter';
  const imageLabel = isCharacter
    ? (presenter.avatar ? `Performed by ${presenter.avatar.name}` : null)
    : (presenter.artworkUrl ? 'Custom artwork' : presenter.avatar?.name);

  return (
    <div
      className={'relative aspect-[16/9] overflow-hidden bg-surface-2 [border-bottom:1px_solid_var(--line)]'
        + (imageUrl && !imageFailed
          ? " after:content-[''] after:absolute after:inset-[48%_0_0] after:bg-[linear-gradient(transparent,rgba(0,0,0,.58))] after:pointer-events-none"
          : '')}
    >
      {imageUrl && !imageFailed ? (
        <img
          className="w-full h-full block object-cover object-[center_22%]"
          src={imageUrl}
          alt={`${presenter.name} — ${imageLabel}`}
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="h-full grid place-content-center justify-items-center gap-[8px] text-faint [&_span]:text-[11px]">
          <b
            className="w-[48px] h-[48px] grid place-items-center border border-solid border-line-2 rounded-[50%] bg-surface text-ink-2 font-[620] text-[13px] leading-[1] font-mono tracking-[.03em]"
            aria-hidden="true"
          >
            {initials(presenter.name)}
          </b>
          {isCharacter ? (
            presenter.avatar ? (
              <span className="inline-flex items-center gap-[6px] p-[2px_8px_2px_2px] border border-solid border-line rounded-[999px] bg-surface text-muted">
                {/* display/object-position carry over from the card image rule it used to share. */}
                {presenter.avatar.previewUrl && <img className="block object-[center_22%] w-[20px] h-[20px] rounded-[50%] object-cover" src={presenter.avatar.previewUrl} alt="" loading="lazy" />}
                Performed by {presenter.avatar.name}
              </span>
            ) : <span>No avatar assigned</span>
          ) : (
            <span>{presenter.avatar ? 'Preview unavailable' : 'No avatar assigned'}</span>
          )}
        </div>
      )}
      <span className="absolute z-[1] max-w-[calc(100%-20px)] overflow-hidden text-ellipsis whitespace-nowrap top-[10px] left-[10px] p-[3px_7px] bg-[rgba(255,255,255,.92)] border border-solid border-[rgba(255,255,255,.7)] rounded-sm text-ink-2 text-[9.5px] font-[650] tracking-[.08em] uppercase [box-shadow:0_1px_3px_rgba(0,0,0,.08)]">{kind}</span>
      {imageUrl && !imageFailed && imageLabel && (
        <span className="absolute z-[1] max-w-[calc(100%-20px)] overflow-hidden text-ellipsis whitespace-nowrap left-[10px] bottom-[8px] text-white text-[10.5px] [text-shadow:0_1px_2px_rgba(0,0,0,.7)]">{imageLabel}</span>
      )}
    </div>
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
    <div className={'relative flex-1 min-w-0' + (current ? ' set' : '')}>
      <button
        type="button"
        className={'flex items-center justify-between gap-[6px] w-full p-[5px_8px] border border-solid border-line rounded-sm bg-surface text-[12px] cursor-pointer text-left overflow-hidden whitespace-nowrap text-ellipsis hover:border-line-2 [&_svg]:shrink-0 [&_svg]:text-faint'
          + (current ? ' text-ink' : ' text-muted')}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? current.name : `${label}…`}
        <ChevronDown size={12} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Anchored to its row and spanning it, above the scrim. */}
          <div className="absolute top-[calc(100%+3px)] left-0 right-0 z-[41] min-w-[230px] bg-surface border border-solid border-line-2 rounded-sm [box-shadow:var(--shadow-pop)] p-[6px]">
            <input
              className="w-full p-[5px_7px] text-[12px] border border-solid border-line rounded-sm bg-canvas"
              placeholder={`Search ${label}s…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              autoFocus
            />
            <div className="p-[4px_3px_5px] text-[10.5px] text-faint">
              {busy ? 'searching…'
                : res
                  ? `${res.matched} of ${res.total}${q.trim() ? '' : ' · yours first'}`
                  : 'could not search'}
            </div>
            <div className="flex flex-col max-h-[240px] overflow-y-auto [&_button_em]:not-italic [&_button_em]:text-[10px] [&_button_em]:text-faint [&_button_em]:shrink-0">
              {current && (
                <button
                  type="button"
                  className={APICK_ROW + apickRowState(false) + ' !text-muted ![border-bottom:1px_solid_var(--line)] !rounded-none'}
                  onClick={() => { onPick(null); setOpen(false); }}
                >
                  Clear {label}
                </button>
              )}
              {items.length === 0 && !busy && <p className="muted m-0 p-[5px_3px] text-[11.5px]">Nothing matches.</p>}
              {items.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className={APICK_ROW + (a.id === current?.id ? ' cur' : '') + apickRowState(a.id === current?.id)}
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
    <div className="grid grid-cols-[1fr_1fr] gap-[6px]">
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
              <small className="muted">
                Optional custom art. Otherwise the card shows the avatar you assign after creating it.
              </small>
            </label>
          ) : (
            <div className="notice">
              <AlertCircle />
              <span>
                Presenter roles do not accept unrelated custom artwork. Once cast, the card
                shows the exact synced avatar that will appear in the finished video.
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
