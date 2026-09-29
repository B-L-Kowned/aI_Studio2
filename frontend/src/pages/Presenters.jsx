import React, { useState, useEffect, useCallback } from 'react';
import { Check, AlertCircle, Plus, X, Archive, RotateCcw } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section, PageHead } from '../components/Section.jsx';

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

  const load = useCallback(async () => {
    const d = await api.presenters(showRetired);
    setData(d);
    setTab((t) => t ?? d.tabs[0]?.id ?? null);
    onTabs?.(d.tabs);
  }, [showRetired]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <p className="muted">Loading…</p>;
  const chosen = externalTab ?? tab;
  const active = data.tabs.find((t) => t.id === chosen) ?? data.tabs[0];

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
            <div className="presgrid">
              {active.presenters.map((p) => (
                <div className={'prescard' + (p.isActive ? '' : ' retired')} key={p.id}>
                  {/* The tile IS the taxonomy: art for characters, type for the rest. */}
                  {p.hasArtwork ? (
                    <div className="presart" style={{ backgroundImage: `url(${p.artworkUrl})` }}>
                      <span className="presartfallback">{p.name[0]}</span>
                    </div>
                  ) : (
                    // No artwork means the tile is only the name, which is
                    // already the next line down. A tall band of nothing is not
                    // a portrait, so it shrinks to a label.
                    <div className="prestype slim"><span>{p.name}</span></div>
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

function CastRow({ presenter, options, onSave }) {
  return (
    <div className="castrow">
      <select
        value={presenter.avatar?.id ?? ''}
        onChange={(e) => onSave({ avatarAssetId: e.target.value ? Number(e.target.value) : null })}
      >
        <option value="">avatar…</option>
        {options.avatars.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select
        value={presenter.voice?.id ?? ''}
        onChange={(e) => onSave({ voiceAssetId: e.target.value ? Number(e.target.value) : null })}
      >
        <option value="">voice…</option>
        {options.voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
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
