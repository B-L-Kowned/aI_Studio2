import React, { useState, useEffect, useCallback } from 'react';
import { Check, AlertCircle, Plus, X, Archive, RotateCcw, ChevronDown, Search } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section, PageHead } from '../components/Section.jsx';

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
export default function Presenters({ tab: externalTab, onTabs, tabs: tabsNode, onePage = false, after = null, show = null }) {
  const { mutate, scopeMode } = useStudio();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(ROSTER_PAGE_SIZE);
  const [browsing, setBrowsing] = useState(false);

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

  if (!data) return <><PageHead title="Cast" tabs={tabsNode} /><p className="muted">Loading…</p></>;
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
  // In Comedy a HeyGen avatar becomes a character's performer; in Content, a presenter.
  const comedy = scopeMode === 'comedy';
  const useAvatar = async (a) => {
    setErr(null);
    try {
      const r = await mutate(() => api.createPresenter(comedy
        ? { kind: 'character', name: a.name, description: 'Performed by a HeyGen avatar' }
        : { kind: 'avatar', name: a.name, description: 'From your HeyGen account' }), null);
      await mutate(() => api.castPresenter(r.data.id, { avatarAssetId: a.id }), null, { silent: true });
      await load();
    } catch (ex) { setErr(ex.message); }
  };
  const rowsOf = (list) => (
    <div className="border border-solid border-line rounded-lg bg-surface overflow-clip">
      {list.map((p) => (
        <PresenterRow key={p.id} presenter={p} options={data.options}
          onSave={(body) => run(() => api.castPresenter(p.id, body))}
          onRetire={() => run(() => api.retirePresenter(p.id, !p.isActive))}
          onChanged={load} />
      ))}
    </div>
  );

  // Who is in your videos, on one page, the same shape in both programs: you,
  // the program's cast (presenters in Content, characters in Comedy — made
  // here or brought in from HeyGen), and the people you invited.
  if (onePage) {
    const you = data.tabs.find((t) => t.id === 'personal');
    const others = data.tabs.find((t) => t.id === (comedy ? 'characters' : 'avatars'));
    const word = comedy ? 'character' : 'presenter';
    return (
      <>
        <PageHead title="Cast" lead={comedy
          ? 'Who appears in your comedy — you, your characters, and who has approved their likeness.'
          : 'Who appears in your videos — you, anyone else on camera, and who has approved their likeness.'}
          actions={<button onClick={() => setShowRetired((v) => !v)}>{showRetired ? 'Hide retired' : 'Show retired'}</button>}
          tabs={tabsNode} />
        {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}
        {you && (!show || show === 'you') && (
          <Section title="You" meta={`${you.presenters.length} look${you.presenters.length === 1 ? '' : 's'}`}>
            {you.presenters.length ? rowsOf(you.presenters) : <p className="sectionempty">No looks of you yet.</p>}
          </Section>
        )}
        {others && (!show || show === 'cast') && (
          <Section title={comedy ? 'Characters' : 'Other presenters'} meta={others.presenters.length ? `${others.presenters.length}` : 'none'}
            actions={<>
              {others.presenters.length > 12 && (
                <label className="flex items-center gap-[6px] border border-solid border-line-2 rounded p-[0_8px] bg-surface text-faint">
                  <Search size={13} />
                  <input className="[border:0] p-[5px_0] w-[150px] text-[12.5px] text-ink focus:[outline:0] focus:[box-shadow:none]" placeholder={`Search ${word}s…`}
                    value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${word}s`} />
                </label>
              )}
              <button onClick={() => setBrowsing((b) => !b)}>{browsing ? 'Close HeyGen avatars' : <><Plus size={14} /> Add from HeyGen</>}</button>
              <button onClick={() => setAdding(true)}><Plus size={14} /> New {word}</button>
            </>}>
            {others.presenters.length ? (() => {
              const found = others.presenters.filter((p) => !normalizedQuery || searchablePresenter(p).includes(normalizedQuery));
              return (
                <>
                  {found.length ? rowsOf(found.slice(0, visibleCount)) : <p className="sectionempty">No {word} matches “{query.trim()}”.</p>}
                  {found.length > visibleCount && (
                    <div className="flex items-center gap-[10px] pt-[10px] text-[12px] text-muted">
                      Showing {visibleCount} of {found.length}
                      <button className="text-[12px] p-[4px_10px]" onClick={() => setVisibleCount((n) => n + ROSTER_PAGE_SIZE)}>Show {Math.min(ROSTER_PAGE_SIZE, found.length - visibleCount)} more</button>
                    </div>
                  )}
                </>
              );
            })()
              : <p className="sectionempty">{comedy
                ? 'No characters yet. Create one, or bring in a HeyGen avatar to perform one.'
                : 'Every video in your register is presented by you. Add someone here only when another person appears on camera.'}</p>}
          </Section>
        )}
        {browsing && (!show || show === 'cast') && <HeyGenBrowser onUse={useAvatar} />}
        {after}
        {adding && <NewPresenter kind={comedy ? 'character' : 'avatar'} onClose={() => setAdding(false)} onDone={load} />}
      </>
    );
  }

  return (
    <>
      {/* The title is the roster you are looking at; the tabs below it are
          Cast's. The roster's name and description used to appear three times
          — tab, page title "Cast", and a section header. */}
      <PageHead
        title={active?.label ?? 'Cast'}
        lead={active?.detail}
        actions={
          <>
            <button onClick={() => setShowRetired((v) => !v)}>
              {showRetired ? 'Hide retired' : 'Show retired'}
            </button>
            {active?.id !== 'personal' && (
              <button className="primary" onClick={() => setAdding(true)}>
                <Plus size={14} /> New {active?.id === 'characters' ? 'character' : 'presenter'}
              </button>
            )}
          </>
        }
        tabs={tabsNode}
      />

      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}
      {active?.id === 'avatars' && <HeyGenBrowser onUse={useAvatar} />}

      {active && (
        <>
          {active.presenters.length === 0 ? (
            <Section>
              <p className="sectionempty">
                {active.id === 'avatars'
                  ? 'No other presenters. Every video in your register is presented by you — your looks and voice are under You. Add one here only for someone else on camera.'
                  : 'Nothing here yet.'}
              </p>
            </Section>
          ) : (
            <Section>
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
                  {active.id !== 'characters' ? (
                    // People read as a list: who, the look and voice they are
                    // cast to, whether they are ready. One row each; the persona
                    // and Retire are there when wanted, not on every visit.
                    <div className="border border-solid border-line rounded-lg bg-surface overflow-clip">
                      {visiblePresenters.map((p) => (
                        <PresenterRow key={p.id} presenter={p} options={data.options}
                          onSave={(body) => run(() => api.castPresenter(p.id, body))}
                          onRetire={() => run(() => api.retirePresenter(p.id, !p.isActive))} />
                      ))}
                    </div>
                  ) : (
                  <div className="grid grid-cols-[repeat(3,1fr)] gap-[12px] lte860:grid-cols-[repeat(2,1fr)] lte620:grid-cols-[1fr]">
                    {visiblePresenters.map((p) => (
                      <article
                        className={'min-w-0 overflow-hidden bg-surface border border-solid border-line rounded-lg p-0 flex flex-col [box-shadow:var(--shadow)]'
                          + (p.isActive ? '' : ' retired opacity-50')}
                        key={p.id}
                      >
                        <PresenterHead presenter={p} tabId={active.id} />

                  {/* A persona that only shows a name is decoration. These are
                      the lines that actually steer the script. */}
                  {p.persona && (p.persona.voice || p.persona.signatureOpening) && (
                    <details className="m-[2px_14px_0] text-[12px] group/persona">
                    <summary className="cursor-pointer text-muted hover:text-ink select-none list-none [&::-webkit-details-marker]:hidden">
                      <span className="inline-block transition-transform group-open/persona:rotate-90">›</span> How they speak
                    </summary>
                    <dl className="m-[6px_0_2px] grid grid-cols-[auto_1fr] gap-[3px_8px]">
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
                    </details>
                  )}

                  {/* Casting is the same action on every card, so it sits in
                      the same place on every card — pinned to the bottom rather
                      than floating wherever the text above happens to end. */}
                  <div className="mt-auto p-[8px_14px_11px] flex flex-col gap-[6px]">
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
                  )}
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

          {active.presenters.length > 0 && !active.presenters.some((p) => p.ready) && (
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
 * Picture when there is one, a compact identity row when there is not.
 *
 * Every card used to open with a 16:9 tile. With no artwork on any of 166
 * characters that tile was two letters in a grey box — most of each card, and
 * three characters to a screen. The tile now appears only for a real image.
 * The kind badge ("CHARACTER") went too: the page title already says it.
 */
/**
 * Every avatar HeyGen holds for you — your own first, the whole catalogue a
 * search away. The roster above is the presenters you cast; this is what they
 * can be cast from. Nine thousand rows are searched, never shipped.
 */
const PAGE = 48;
function HeyGenBrowser({ onUse }) {
  const [pool, setPool] = useState('mine');
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.providerAssets('heygen', { kind: 'avatar', q: q.trim(), pool, limit: PAGE }).then((r) => {
        if (!live) return;
        setRes(r); setItems(r.items);
      }).catch(() => live && setRes({ items: [], matched: 0, total: 0, owned: 0 }));
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [pool, q]);
  const more = () => api.providerAssets('heygen', { kind: 'avatar', q: q.trim(), pool, limit: PAGE, offset: items.length })
    .then((r) => setItems((cur) => [...cur, ...r.items])).catch(() => {});
  if (!res) return null;
  const chip = (id, label) => (
    <button type="button" onClick={() => setPool(id)}
      className={'text-[12px] p-[4px_11px] rounded-full border border-solid ' + (pool === id ? 'bg-ink text-white border-ink' : 'bg-surface text-ink-2 border-line')}>
      {label}
    </button>
  );
  return (
    <Section title="HeyGen avatars" meta={`${res.matched.toLocaleString()} ${q ? 'match' : pool === 'mine' ? 'yours' : 'in the catalogue'}`}
      actions={<>
        {chip('mine', `Yours ${res.owned ?? ''}`)}
        {chip('all', `All ${res.total?.toLocaleString() ?? ''}`)}
        <label className="flex items-center gap-[6px] border border-solid border-line-2 rounded p-[0_8px] bg-surface text-faint">
          <Search size={13} />
          <input className="[border:0] p-[5px_0] w-[180px] text-[12.5px] focus:[outline:0] focus:[box-shadow:none] text-ink" placeholder="Search avatars…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search HeyGen avatars" />
        </label>
      </>}>
      {items.length === 0 ? (
        <p className="sectionempty">{res.total ? 'No avatar matches that.' : 'No HeyGen avatars synced yet — connect HeyGen under Settings → HeyGen account.'}</p>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[10px]">
            {items.map((a) => (
              <figure key={a.id} className="m-0 group relative border border-solid border-line rounded-md overflow-hidden bg-surface">
                <img className="block w-full aspect-square object-cover object-[center_22%] bg-surface-2" src={a.previewUrl} alt={a.name} loading="lazy" />
                <figcaption className="p-[6px_8px] text-[11.5px] leading-[1.35] text-ink-2 truncate" title={a.name}>{a.name}</figcaption>
                <button type="button" disabled={busy === a.id}
                  className="absolute left-[8px] right-[8px] bottom-[34px] text-[11.5px] p-[5px_8px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [transition:opacity_.12s]"
                  onClick={async () => { setBusy(a.id); await onUse(a); setBusy(null); }}>
                  <Plus size={12} /> {busy === a.id ? 'Adding…' : 'Use as presenter'}
                </button>
              </figure>
            ))}
          </div>
          {items.length < res.matched && (
            <div className="flex items-center gap-[10px] mt-[12px] text-[12px] text-muted">
              Showing {items.length.toLocaleString()} of {res.matched.toLocaleString()}
              <button type="button" className="text-[12px] p-[4px_10px]" onClick={more}>Show {Math.min(PAGE, res.matched - items.length)} more</button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/**
 * A persona's outfits and pace. Tick the looks it wears — the first ticked is
 * its default, the one a new video starts with — and set how fast it speaks.
 */
function PersonaStyle({ presenter, onSaved }) {
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState([]);
  const [speed, setSpeed] = useState(presenter.speed ?? 1);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.presenterPersona(presenter.id).then((d) => { setData(d); setPicked(d.looks.map((l) => l.id)); setSpeed(d.speed ?? 1); }).catch(() => {});
  }, [presenter.id]);
  if (!data) return <p className="m-0 p-[0_14px_12px_72px] text-[12px] text-muted">Loading looks…</p>;
  const toggle = (id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const changed = picked.join() !== data.looks.map((l) => l.id).join() || speed !== (data.speed ?? 1);
  const save = async () => {
    setSaving(true);
    try {
      await api.savePresenterPersona(presenter.id, { assetIds: picked, speed: Math.abs(speed - 1) < 0.005 ? null : speed });
      onSaved?.();
    } finally { setSaving(false); }
  };
  return (
    <div className="p-[2px_14px_14px_72px] lte960:p-[2px_14px_14px]">
      <p className="m-[0_0_8px] text-[12px] text-muted">Tick the outfits {presenter.name} wears. The first one ticked is the default for new videos; any of them can be chosen per video in Render.</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-[8px]">
        {data.wearable.map((l) => {
          const n = picked.indexOf(l.id);
          return (
            <button key={l.id} type="button" onClick={() => toggle(l.id)} title={l.name}
              className={'relative p-0 rounded-md overflow-hidden border-[2px] border-solid bg-surface ' + (n >= 0 ? 'border-accent' : 'border-transparent opacity-80 hover:opacity-100')}>
              <img className="block w-full aspect-square object-cover object-[center_22%] bg-surface-2" src={l.previewUrl} alt={l.name} loading="lazy" />
              {n >= 0 && (
                <span className="absolute top-[4px] left-[4px] text-[10px] font-semibold rounded-full p-[1px_6px] bg-accent text-white">{n === 0 ? 'Default' : n + 1}</span>
              )}
              <span className="block p-[3px_4px] text-[10.5px] text-ink-2 truncate">{l.name}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-[10px] mt-[12px] text-[12px]">
        <span className="text-muted">Pace</span>
        <input type="range" min="0.85" max="1.15" step="0.01" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
          className="w-[160px] accent-[var(--ink)]" aria-label={`${presenter.name}'s pace`} />
        <code className="text-ink-2">{speed.toFixed(2)}×</code>
        <span className="text-faint">{Math.abs(speed - 1) < 0.005 ? 'natural' : speed < 1 ? 'more measured' : 'brisker'} — the starting speed of every video {presenter.name} presents</span>
        <span className="ml-auto flex gap-[8px]">
          <button className="primary text-[12px] p-[4px_12px]" disabled={!changed || saving || !picked.length} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
    </div>
  );
}

/** One person in the cast, on one line: portrait, who, look and voice, ready. */
function PresenterRow({ presenter: p, options, onSave, onRetire, onChanged }) {
  const [open, setOpen] = useState(false);
  const [styling, setStyling] = useState(false); // the Looks & pace panel
  const [imageFailed, setImageFailed] = useState(false);
  const image = (p.artworkUrl || p.avatar?.previewUrl) && !imageFailed ? (p.artworkUrl || p.avatar?.previewUrl) : null;
  const persona = p.persona && (p.persona.voice || p.persona.signatureOpening) ? p.persona : null;
  return (
    <div className={'[&+&]:[border-top:1px_solid_var(--line)] ' + (p.isActive ? '' : 'opacity-50')}>
      <div className="grid grid-cols-[44px_minmax(200px,1.2fr)_minmax(340px,1.4fr)_240px] gap-[14px] items-center p-[10px_14px] lte960:grid-cols-[44px_1fr]">
        {image ? (
          <img className="w-[44px] h-[44px] rounded-[8px] object-cover object-[center_22%] bg-surface-2" src={image} alt="" loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          <b className="w-[44px] h-[44px] grid place-items-center rounded-[8px] bg-surface-2 border border-solid border-line text-ink-2 text-[12px] font-mono" aria-hidden="true">{initials(p.name)}</b>
        )}
        <div className="min-w-0">
          <b className="flex items-center gap-[6px] text-[13.5px] font-[580]">
            <span className="truncate">{p.name}</span>
            {p.ready
              ? <Check size={13} className="flex-none text-ok" aria-label="Ready to produce" />
              : <span className="flex-none text-[11px] font-normal text-warn">needs casting</span>}
          </b>
          <span className="block truncate text-[12px] text-muted" title={p.tagline || p.description}>{p.tagline || p.description || ' '}</span>
        </div>
        <div className="min-w-0 lte960:col-span-2"><CastRow presenter={p} options={options} onSave={onSave} /></div>
        <span className="flex items-center justify-end gap-[2px] lte960:col-span-2">
          {p.kind === 'personal' && (
            <button type="button" className={'ghostbtn text-[12px] p-[4px_8px] ' + (styling ? 'text-ink' : 'text-muted')} aria-expanded={styling}
              onClick={() => setStyling((o) => !o)} title="The outfits this persona wears and how fast they speak">
              {p.looks?.length || 0} look{p.looks?.length === 1 ? '' : 's'}{p.speed ? ` · ${p.speed.toFixed(2)}×` : ''} <ChevronDown size={12} className={styling ? 'rotate-180' : ''} />
            </button>
          )}
          {persona && (
            <button type="button" className={'ghostbtn text-[12px] p-[4px_8px] ' + (open ? 'text-ink' : 'text-muted')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              How they speak <ChevronDown size={12} className={open ? 'rotate-180' : ''} />
            </button>
          )}
          <button type="button" className="ghostbtn p-[6px] text-faint hover:text-ink" title={p.isActive ? 'Retire — kept, out of the way' : 'Restore'} onClick={onRetire}>
            {p.isActive ? <Archive size={13} /> : <RotateCcw size={13} />}
          </button>
        </span>
      </div>
      {styling && <PersonaStyle presenter={p} onSaved={onChanged} />}
      {open && persona && (
        <dl className="m-0 p-[0_14px_12px_72px] grid grid-cols-[auto_1fr] gap-[3px_10px] text-[12px] lte960:p-[0_14px_12px]">
          {persona.voice && <><dt className={PERSONA_DT + ' text-faint'}>Voice</dt><dd className={PERSONA_DD + ' text-ink-2'}>{persona.voice}</dd></>}
          {persona.signatureOpening && <><dt className={PERSONA_DT + ' text-faint'}>Opens</dt><dd className={PERSONA_DD + ' text-ink-2'}>{persona.signatureOpening}</dd></>}
          {persona.signOff && <><dt className={PERSONA_DT + ' text-faint'}>Signs off</dt><dd className={PERSONA_DD + ' text-ink-2'}>{persona.signOff}</dd></>}
          {persona.neverClaim && <><dt className={PERSONA_DT + ' text-warn'}>Never claims</dt><dd className={PERSONA_DD + ' text-warn'}>{persona.neverClaim}</dd></>}
        </dl>
      )}
    </div>
  );
}

function PresenterHead({ presenter, tabId }) {
  const [imageFailed, setImageFailed] = useState(false);
  const isCharacter = tabId === 'characters';
  const imageUrl = isCharacter ? presenter.artworkUrl : (presenter.artworkUrl || presenter.avatar?.previewUrl);
  const hasImage = !!imageUrl && !imageFailed;
  // A character's avatar is its performer, never its likeness — so it is named,
  // with a thumbnail, rather than shown as the character.
  const performer = isCharacter && presenter.avatar;
  const caption = isCharacter ? null : (presenter.artworkUrl ? 'Custom artwork' : presenter.avatar?.name);

  // You and presenters are people: a portrait beside the name reads as who it
  // is. Only a character keeps the wide artwork, because the art is the point.
  if (!isCharacter) {
    return (
      <div className="p-[12px_14px_6px] flex gap-[12px] items-start">
        {hasImage ? (
          <img className="flex-none w-[56px] h-[56px] rounded-[10px] object-cover object-[center_22%] bg-surface-2 border border-solid border-line"
            src={imageUrl} alt={caption ? `${presenter.name} — ${caption}` : presenter.name} loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          <b className="flex-none w-[56px] h-[56px] grid place-items-center border border-solid border-line-2 rounded-[10px] bg-surface-2 text-ink-2 font-[620] text-[13px] font-mono" aria-hidden="true">
            {initials(presenter.name)}
          </b>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] leading-[1.3] m-0">{presenter.name}</h3>
          <p className="m-[2px_0_0] text-muted text-[12px] leading-[1.45] line-clamp-2">{presenter.tagline || presenter.description || 'No note yet.'}</p>
          {caption && <p className="m-[3px_0_0] text-faint text-[11px] truncate" title={caption}>Look: {caption}</p>}
        </div>
      </div>
    );
  }

  return (
    <>
      {hasImage && (
        <div className="relative aspect-[16/9] overflow-hidden bg-surface-2 [border-bottom:1px_solid_var(--line)] after:content-[''] after:absolute after:inset-[48%_0_0] after:bg-[linear-gradient(transparent,rgba(0,0,0,.58))] after:pointer-events-none">
          <img
            className="w-full h-full block object-cover object-[center_22%]"
            src={imageUrl}
            alt={caption ? `${presenter.name} — ${caption}` : presenter.name}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
          {caption && (
            <span className="absolute z-[1] max-w-[calc(100%-20px)] overflow-hidden text-ellipsis whitespace-nowrap left-[10px] bottom-[8px] text-white text-[10.5px] [text-shadow:0_1px_2px_rgba(0,0,0,.7)]">{caption}</span>
          )}
        </div>
      )}

      <div className="p-[13px_14px_5px] flex gap-[11px] items-start">
        {!hasImage && (
          <b
            className="flex-none w-[38px] h-[38px] grid place-items-center border border-solid border-line-2 rounded-[50%] bg-surface-2 text-ink-2 font-[620] text-[12px] leading-[1] font-mono tracking-[.03em]"
            aria-hidden="true"
          >
            {initials(presenter.name)}
          </b>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] leading-[1.3] m-0">{presenter.name}</h3>
          <p className="m-[3px_0_0] text-muted text-[12px] leading-[1.45] line-clamp-2">
            {presenter.tagline || presenter.description || 'No character note yet.'}
          </p>
          {performer && (
            <span className="inline-flex items-center gap-[6px] mt-[7px] max-w-full p-[2px_8px_2px_2px] border border-solid border-line rounded-[999px] bg-surface text-muted text-[11px]">
              {performer.previewUrl && <img className="block flex-none object-[center_22%] w-[18px] h-[18px] rounded-[50%] object-cover" src={performer.previewUrl} alt="" loading="lazy" />}
              <span className="truncate">Performed by {performer.name}</span>
            </span>
          )}
        </div>
      </div>
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
