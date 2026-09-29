import React, { useState } from 'react';
import { Search, FileText, User, Mic, Image, Film, Video, Package, Trash2, Check, X } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { Section, PageHead, Empty } from '../components/Section.jsx';

// A library row should say what the thing IS. The old tiles were a 100px empty
// box containing one letter, six to a screen — mostly whitespace, and the kind
// was printed underneath in grey as an afterthought.
const KIND = {
  template:     { label: 'Template',   icon: FileText },
  avatar:       { label: 'Avatar',     icon: User },
  voice:        { label: 'Voice',      icon: Mic },
  background:   { label: 'Background', icon: Image },
  footage:      { label: 'Footage',    icon: Film },
  render:       { label: 'Render',     icon: Video },
  heygen_video: { label: 'HeyGen',     icon: Video },
};

const clock = (sec) =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export default function Library() {
  const { collections, refreshLibrary, mutate, notify } = useStudio();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  // Removing is destructive, so it asks once in place rather than firing on a
  // single click of a small icon.
  const [confirming, setConfirming] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [watching, setWatching] = useState(null);

  // The playable URL is signed and expires, so it is fetched at the moment you
  // ask to watch rather than stored and served later as a broken link.
  const play = async (a) => {
    setPlaying(a.id);
    try {
      const r = await api.playLibraryItem(a.id);
      setWatching({ ...a, url: r.url });
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setPlaying(null);
    }
  };

  const items = collections.library;
  const kinds = [...new Set(items.map((a) => a.kind))];

  const shown = items.filter(
    (a) =>
      (kind === 'all' || a.kind === kind) &&
      (!q.trim() || a.name.toLowerCase().includes(q.trim().toLowerCase()))
  );

  return (
    <>
      <PageHead
        title="Library"
        lead="Avatars, voices, footage, backgrounds, templates, renders and exports — everything reusable across productions."
      />

      <Section
        title="Assets"
        meta={`${shown.length}${shown.length !== items.length ? ` of ${items.length}` : ''}`}
        actions={
          <>
            <div className="searchbox">
              <Search size={13} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
            </div>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">All kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>{KIND[k]?.label ?? k}</option>
              ))}
            </select>
          </>
        }
        flush
      >
        {shown.length === 0 ? (
          <Empty icon={Package}>
            {items.length === 0
              ? 'Nothing in the library yet. Renders, exports and imported videos land here.'
              : 'Nothing matches that filter.'}
          </Empty>
        ) : (
          <div className="assetlist">
            {shown.map((a) => {
              const k = KIND[a.kind] ?? { label: a.kind, icon: Package };
              const Icon = k.icon;
              return (
                <div className={'assetrow libraryrow' + (a.playable ? ' playable' : '')} key={a.id}>
                  <span className="libicon"><Icon size={15} /></span>
                  {/* A video you cannot play is a filename. These rows listed
                      seventeen real videos and did nothing when clicked. */}
                  {a.playable ? (
                    <button className="libplay" onClick={() => play(a)} title="Play">
                      {a.name}
                      {playing === a.id && <em className="libloading">opening…</em>}
                    </button>
                  ) : (
                    <b>{a.name}</b>
                  )}
                  <em className="libkind">{k.label}</em>
                  {a.duration ? <em className="libmeta">{clock(a.duration)}</em> : null}
                  {a.kind === 'heygen_video' && !a.playable && (
                    <em className="libmeta warn" title="Imported before the Library stored the video itself">
                      nothing behind it
                    </em>
                  )}
                  {confirming === a.id ? (
                    <span className="rowconfirm">
                      Remove?
                      <button
                        className="danger"
                        onClick={async () => {
                          await mutate(() => api.deleteAsset(a.id), null);
                          setConfirming(null);
                          await refreshLibrary();
                        }}
                      >
                        <Check size={12} /> Yes
                      </button>
                      <button onClick={() => setConfirming(null)}><X size={12} /></button>
                    </span>
                  ) : (
                    <button className="rowdel" title="Remove from Library"
                      onClick={() => setConfirming(a.id)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {watching && (
        <>
          <div className="scrim" onClick={() => setWatching(null)} />
          <div className="modal wide">
            <div className="modalhead">
              <b>{watching.name}</b>
              <button onClick={() => setWatching(null)}><X size={15} /></button>
            </div>
            <video className="renderplayer" controls autoPlay src={watching.url} />
            <div className="actions">
              <a className="postlink" href={watching.url} target="_blank" rel="noreferrer">
                Open in a new tab
              </a>
            </div>
          </div>
        </>
      )}
    </>
  );
}
