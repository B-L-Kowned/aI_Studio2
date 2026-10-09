import React, { useState } from 'react';
import { Search, FileText, User, Mic, Image, Film, Video, Package, Trash2, Check, X, ExternalLink, Copy } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { toClock } from '../utils/format.js';
import { Section, PageHead, Empty } from '../components/Section.jsx';
import { Modal } from '../components/Dialog.jsx';

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
  video:        { label: 'Video',      icon: Video },
};
const SOURCE = { heygen: 'HeyGen', local: 'This Mac' };


export default function Library({ go }) {
  const { collections, refreshLibrary, mutate, notify, scopeMode, openProduction } = useStudio();
  const [open, setOpen] = useState(null); // the asset whose details are showing
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

  // Only what belongs to the program chosen at the top: your business videos in
  // Content, the sample podcast pieces in Comedy.
  const items = collections.library.filter((a) => !scopeMode || !a.program || a.program === scopeMode || a.program === 'both');
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
                  role="button" tabIndex={0} onClick={(e) => { if (!e.target.closest('button')) setOpen(a); }}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(a)}
                  className={'group flex items-center gap-[10px] bg-surface [box-shadow:1px_0_0_var(--line),0_1px_0_var(--line)] p-[8px_14px] text-[13px] min-w-0 cursor-pointer hover:bg-surface-2' + (open?.id === a.id ? ' bg-accent-soft' : '')}
                  key={a.id}
                >
                  <span className="w-[26px] h-[26px] rounded-sm bg-canvas border border-solid border-line grid place-items-center text-muted"><Icon size={15} /></span>
                  {/* A video you cannot play is a filename. These rows listed
                      seventeen real videos and did nothing when clicked. */}
                  <b className="flex-1 min-w-0 truncate text-[13.5px] font-[550]" title={a.name}>{a.name}</b>
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

      {open && (
        <Modal side width={440} title={open.name} onClose={() => setOpen(null)}>
            <div className="rounded-md overflow-hidden bg-canvas border border-solid border-line">
              {open.fileUrl ? (
                <video className="block w-full max-h-[260px] bg-ink" src={open.fileUrl} controls preload="metadata" />
              ) : open.thumbnailUrl ? (
                <img className="block w-full" src={open.thumbnailUrl} alt="" />
              ) : (
                <p className="m-0 p-[22px] text-center text-[12.5px] text-muted">
                  {open.playable ? 'Kept on HeyGen, not downloaded to this Mac.' : 'Nothing to preview.'}
                </p>
              )}
            </div>
            {!open.fileUrl && open.playable && (
              <button className="mt-[8px] text-[12.5px]" disabled={playing === open.id} onClick={() => play(open)}>
                <Video size={13} /> {playing === open.id ? 'Opening…' : 'Play from HeyGen'}
              </button>
            )}
            <dl className="m-[14px_0_0] grid grid-cols-[96px_1fr] gap-[6px_10px] text-[12.5px]">
              <dt className="text-muted">Type</dt><dd className="m-0">{KIND[open.kind]?.label ?? open.kind}</dd>
              {open.duration ? <><dt className="text-muted">Length</dt><dd className="m-0 [font-variant-numeric:tabular-nums]">{toClock(open.duration)}</dd></> : null}
              <dt className="text-muted">From</dt><dd className="m-0">{SOURCE[open.provider] ?? (open.program === 'comedy' ? 'Sample, came with the app' : 'Added here')}</dd>
              <dt className="text-muted">Used in</dt>
              <dd className="m-0">{open.productionTitle ?? <span className="text-faint">No video yet</span>}</dd>
              {open.localPath && (
                <>
                  <dt className="text-muted">File</dt>
                  <dd className="m-0 min-w-0">
                    <span className="block truncate text-ink-2" title={open.localPath}>{open.localPath.split('/').pop()}</span>
                    <button className="ghostbtn p-0 text-[12px] text-accent" onClick={() => navigator.clipboard?.writeText(open.localPath).then(() => notify('Path copied'), () => {})}>
                      <Copy size={11} /> Copy where it is
                    </button>
                  </dd>
                </>
              )}
            </dl>
            <div className="flex flex-wrap gap-[8px] mt-[16px]">
              {open.productionId && (
                <button className="primary text-[12.5px]" onClick={async () => { await openProduction(open.productionId); go?.('Create'); }}>
                  <ExternalLink size={13} /> Open the video
                </button>
              )}
              {open.fileUrl && <a className="text-[12.5px] self-center text-accent" href={open.fileUrl} target="_blank" rel="noreferrer">Open the file</a>}
            </div>
        </Modal>
      )}

      {watching && (
        <Modal width={720} title={watching.name} onClose={() => setWatching(null)}
          footer={<a className="text-[12.5px] text-accent" href={watching.url} target="_blank" rel="noreferrer">Open in a new tab</a>}>
          <video className="block w-full rounded-md bg-ink" controls autoPlay src={watching.url} />
        </Modal>
      )}
    </>
  );
}
