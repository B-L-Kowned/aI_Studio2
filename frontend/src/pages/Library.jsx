import React, { useState } from 'react';
import { Search, FileText, User, Mic, Image, Film, Video, Package, Trash2, Check, X } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { toClock } from '../utils/format.js';
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
        lead="Avatars, voices, footage, renders and exports — reusable across videos."
      />

      <Section
        title="Assets"
        meta={`${shown.length}${shown.length !== items.length ? ` of ${items.length}` : ''}`}
        actions={
          <>
            <div className="flex items-center gap-[6px] border border-solid border-line-2 rounded p-[0_8px] bg-surface [&_svg]:text-faint [&_svg]:shrink-0">
              <Search size={13} />
              <input
                className="[border:0] p-[5px_0] w-[130px] focus:[outline:0] focus:[box-shadow:none]"
                aria-label="Search assets" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
            </div>
            {/* Kinds as chips with counts: what is here, at a glance, one click to narrow. */}
            <span className="flex flex-wrap gap-[4px]" role="group" aria-label="Filter assets by kind">
              {[['all', 'All', items.length], ...kinds.map((k) => [k, KIND[k]?.label ?? k, items.filter((a) => a.kind === k).length])].map(([id, label, n]) => (
                <button key={id} type="button" onClick={() => setKind(id)}
                  className={'text-[12px] p-[3px_10px] rounded-full ' + (kind === id ? 'bg-ink text-white border-ink' : 'bg-surface')}>
                  {label} <span className={kind === id ? 'opacity-70' : 'text-faint'}>{n}</span>
                </button>
              ))}
            </span>
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
          // Columns on a wide screen: a one-column list of short names was
          // mostly empty row. Hairline gaps make the grid read as one table.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(440px,1fr))] overflow-hidden mb-[-1px] mr-[-1px]">
            {shown.map((a) => {
              const k = KIND[a.kind] ?? { label: a.kind, icon: Package };
              const Icon = k.icon;
              return (
                // Flex, not grid: a row carries a duration, a warning or neither.
                <div
                  className={'group flex items-center gap-[10px] bg-surface [box-shadow:1px_0_0_var(--line),0_1px_0_var(--line)] p-[8px_14px] text-[13px] min-w-0 hover:bg-surface-2' + (a.playable ? ' playable cursor-default' : '')}
                  key={a.id}
                >
                  <span className="w-[26px] h-[26px] rounded-sm bg-canvas border border-solid border-line grid place-items-center text-muted"><Icon size={15} /></span>
                  {/* A video you cannot play is a filename. These rows listed
                      seventeen real videos and did nothing when clicked. */}
                  {a.playable ? (
                    <button
                      className="flex-1 min-w-0 [border:0] [background:none] p-0 text-left text-[13.5px] font-[550] text-ink rounded-none truncate [&:hover:not(:disabled)]:[background:none] [&:hover:not(:disabled)]:text-accent [&:hover:not(:disabled)]:underline"
                      onClick={() => play(a)} title="Play">
                      {a.name}
                      {playing === a.id && <em className="not-italic ml-[8px] text-[11px] text-faint">opening…</em>}
                    </button>
                  ) : (
                    <b className="flex-1 min-w-0 truncate text-[13.5px] font-[550]" title={a.name}>{a.name}</b>
                  )}
                  <em className="not-italic text-[10.5px] text-muted border border-solid border-line rounded-[20px] p-[2px_9px]">{k.label}</em>
                  {a.duration ? <em className="not-italic font-mono text-[11.5px] font-normal leading-[normal] text-faint">{toClock(a.duration)}</em> : null}
                  {a.kind === 'heygen_video' && !a.playable && (
                    <em
                      className="warn not-italic [font-family:inherit] text-[11px] font-normal leading-[normal] text-warn"
                      title="Imported before the Library stored the video itself">
                      re-sync required
                    </em>
                  )}
                  {confirming === a.id ? (
                    <span className="inline-flex items-center gap-[6px] text-[11.5px] text-danger whitespace-nowrap">
                      Remove?
                      <button
                        className="danger p-[3px_8px] text-[11px] inline-flex items-center gap-[4px] border-danger text-danger [&:hover:not(:disabled)]:border-danger [&:hover:not(:disabled)]:bg-danger-soft"
                        onClick={async () => {
                          await mutate(() => api.deleteAsset(a.id), null);
                          setConfirming(null);
                          await refreshLibrary();
                        }}
                      >
                        <Check size={12} /> Yes
                      </button>
                      <button
                        className="p-[3px_8px] text-[11px] inline-flex items-center gap-[4px]"
                        onClick={() => setConfirming(null)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ) : (
                    <button
                      className="[border:0] bg-transparent text-faint p-[4px_6px] opacity-0 [transition:opacity_.12s] group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger hover:bg-danger-soft"
                      title="Remove from Library"
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
