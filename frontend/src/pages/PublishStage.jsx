import React, { useState } from 'react';
import { Check, Download, ExternalLink, Link2, Undo2, Upload } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { useResource } from '../hooks/use-resource.js';
import LoadState from '../components/LoadState.jsx';

// Where each site wants which shape, so the right file is suggested.
const SHAPE_FOR = { YouTube: '16:9', LinkedIn: '16:9', Facebook: '16:9', X: '16:9', TikTok: '9:16', Instagram: '9:16', 'Artificial Funny': '16:9' };
const mb = (b) => `${(b / 1048576).toFixed(b > 104857600 ? 0 : 1)} MB`;

/**
 * Post it: the last thing you do with a finished video. Take the file, copy
 * the post text above, upload it where it goes, and say so here — no logins,
 * nothing posted for you. Your own site can be posted to directly.
 */
export default function PublishStage() {
  const { production, mutate } = useStudio();
  const [linking, setLinking] = useState(null);
  const [link, setLink] = useState('');
  const { data: state, error, reload: load } = useResource(() => api.publications(production.id), [production.id]);
  const { data: files } = useResource(() => api.postFiles(production.id), [production.id]);

  if (!state) return <LoadState error={error} retry={load} />;

  if (!state.hasExport) {
    return (
      <section aria-label="Post it">
        <h2>Post it</h2>
        <p className="text-muted text-[13px]">Once the finished video exists — exported in Edit, or uploaded above — its file and a checklist of where to post it appear here.</p>
      </section>
    );
  }

  const shapes = new Set((files?.files ?? []).map((f) => f.shape));
  const markPosted = async (platform, url) => {
    await mutate(() => api.markPosted(production.id, platform, url || null), null).catch(() => {});
    setLinking(null); setLink('');
    load();
  };
  const undo = async (platform) => { await mutate(() => api.markPosted(production.id, platform, null, true), null).catch(() => {}); load(); };
  const publishDirect = async (platform) => { await mutate(() => api.publish(production.id, platform, 'publish'), null).catch(() => {}); load(); };
  const posted = state.targets.filter((t) => t.status === 'published').length;

  return (
    <section aria-label="Post it">
      <div className="flex items-baseline gap-[10px] flex-wrap">
        <h2 className="m-0">Post it</h2>
        <span className="text-[12.5px] text-muted">{posted ? `Posted on ${posted} of ${state.targets.length}` : 'Not posted anywhere yet'}</span>
      </div>
      <p className="text-muted text-[13px] m-[4px_0_12px] max-w-[70ch]">Download the video, copy the post text above, and upload it to each site yourself — no logins needed. Then mark it posted here, with its link if you like, so Today and the calendar know it is live.</p>

      {/* 1. The files */}
      <div className="border border-solid border-line rounded-lg bg-surface overflow-clip mb-[12px]">
        {(files?.files ?? []).map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-[10px] p-[10px_14px] [&+&]:[border-top:1px_solid_var(--line)]">
            <span className="w-[44px] text-center text-[11px] font-[600] text-ink-2 bg-surface-2 rounded p-[3px_0]">{f.shape}</span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13px] font-[560] truncate">{f.name}</b>
              <span className="text-[11.5px] text-muted">{f.shape === '9:16' ? 'TikTok, Reels and Shorts' : f.shape === '1:1' ? 'Square feed posts' : 'YouTube, LinkedIn, Facebook, X'} · {mb(f.bytes)}</span>
            </span>
            <a className="inline-flex items-center gap-[5px] text-[12.5px] p-[5px_11px] rounded-md border border-solid border-line bg-surface text-ink no-underline hover:border-line-2" href={f.url} download>
              <Download size={13} /> Download
            </a>
          </div>
        ))}
        {files && !shapes.has('9:16') && (
          <p className="m-0 p-[9px_14px] text-[12px] text-muted [border-top:1px_solid_var(--line)] bg-surface-2">
            No vertical version yet. For TikTok, Reels and Shorts: in Edit → Picture, add 9:16 under “Also export”, then export again.
          </p>
        )}
      </div>

      {/* 2. Where it went */}
      <ul className="list-none p-0 m-0 border border-solid border-line rounded-lg bg-surface">
        {state.targets.map((t) => {
          const done = t.status === 'published';
          const want = SHAPE_FOR[t.platform];
          const missingShape = want && !shapes.has(want);
          const direct = t.canReallyPublish && t.connected;
          return (
            <li key={t.platform} className="p-[10px_14px] [&+&]:[border-top:1px_solid_var(--line)]">
              <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] gap-[10px] items-center">
                <span className={'w-[20px] h-[20px] rounded-full grid place-items-center ' + (done ? 'bg-ok text-white' : 'border border-solid border-line-2')}>{done && <Check size={12} />}</span>
                <div className="min-w-0">
                  <b className="text-[13.5px] font-[580]">{t.platform}</b>
                  <span className="block text-[12px] text-muted">
                    {done
                      ? <>Posted{t.postedAt ? ` ${new Date(`${t.postedAt.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}{t.postUrl ? '' : ' · no link saved'}</>
                      : direct ? 'Can be posted directly from here'
                        : missingShape && shapes.size ? `Upload the ${[...shapes][0]} file — ${t.platform} also accepts it` : `Upload the ${want ?? ''} file${missingShape ? ' (not exported yet)' : ''}`}
                  </span>
                  {t.postUrl && <a className="text-[12px] text-accent" href={t.postUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} className="inline -mt-[2px]" /> View the post</a>}
                </div>
                <span className="flex items-center gap-[6px]">
                  {done ? (
                    t.postedByHand && <button className="ghostbtn text-[12px] p-[4px_8px] text-muted" onClick={() => undo(t.platform)} title="Not posted after all"><Undo2 size={12} /> Undo</button>
                  ) : (
                    <>
                      {direct && <button className="primary text-[12.5px] p-[5px_11px]" onClick={() => publishDirect(t.platform)}><Upload size={12} /> Post now</button>}
                      {linking !== t.platform && <button className="text-[12.5px] p-[4px_11px]" onClick={() => { setLinking(t.platform); setLink(''); }}>Mark as posted</button>}
                    </>
                  )}
                </span>
              </div>
              {linking === t.platform && (
                <form className="flex flex-wrap gap-[7px] items-center mt-[8px] ml-[32px]" onSubmit={(e) => { e.preventDefault(); markPosted(t.platform, link.trim()); }}>
                  <Link2 size={13} className="text-faint" />
                  <input className="flex-1 min-w-[220px] text-[12.5px]" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder={`Link to the ${t.platform} post (optional)`} />
                  <button type="button" onClick={() => setLinking(null)}>Cancel</button>
                  <button className="primary" type="submit">Posted</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
