import React, { useState, useEffect, useCallback } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import UploadDrop from '../components/UploadDrop.jsx';
import PublishStage from './PublishStage.jsx';
import PostCopy from '../components/PostCopy.jsx';
import { madeByOf } from '../utils/made-by.js';

/**
 * The last step, the same for every path: the finished mp4 goes up (that is
 * what marks the video done in the register, and its words become the script
 * of record), then it can be published. Publishing is optional.
 */
export default function FinishStage({ goToStage }) {
  const { production } = useStudio();
  const completedAsset = production.brief.find((b) => b.label === 'Completed asset')?.value || null;
  return (
    <div className="stagepane">
      <h2>Finish</h2>
      {completedAsset ? (
        <p>The finished video is on record — the register shows it done. Publish it below.</p>
      ) : (
        <>
          <p>Two ways to the finished video. Either one marks it done.</p>
          <div className="grid grid-cols-[1fr_1fr] gap-[12px] lte800:grid-cols-[1fr]">
            <div className="border border-solid border-line rounded-lg bg-surface p-[14px_16px] flex flex-col gap-[8px]">
              {madeByOf(production) === 'heygen' ? (
                <>
                  <b className="text-[13.5px]">Render it, then export it</b>
                  <span className="text-[12.5px] text-muted">Render your avatar on HeyGen, then export the render in Edit — it lands here by itself.</span>
                  <button className="primary self-start mt-auto" onClick={() => goToStage?.('Make')}>Go to Render</button>
                </>
              ) : (
                <>
                  <b className="text-[13.5px]">Put it together in the app</b>
                  <span className="text-[12.5px] text-muted">Clean-up, captions, music and export happen in Edit — the export lands here by itself.</span>
                  <button className="primary self-start mt-auto" onClick={() => goToStage?.('Edit')}>Go to Edit</button>
                </>
              )}
            </div>
            <div className="flex flex-col"><FinishedVideo production={production} completedAsset={completedAsset} compactUpload /></div>
          </div>
        </>
      )}
      {completedAsset && <FinishedVideo production={production} completedAsset={completedAsset} />}
      <PostCopy />
      <hr className="m-[24px_0] [border:0] [border-top:1px_solid_var(--line)]" />
      <PublishStage />
    </div>
  );
}

/**
 * The finished video, if there is one: upload it, watch it, and recover the
 * words spoken in it (transcribed on this Mac) as the script of record.
 */
function FinishedVideo({ production, completedAsset, compactUpload = false }) {
  const { reload } = useStudio();
  const [file, setFile] = useState(undefined); // undefined = loading, null = none
  const [tx, setTx] = useState(null);
  const load = useCallback(async () => {
    const [items, t] = await Promise.all([api.library(), api.transcription(production.id)]);
    setFile(items.filter((a) => a.productionId === production.id && a.fileUrl && !/^Recording — /.test(a.name)).pop() ?? null);
    setTx(t);
  }, [production.id]);
  useEffect(() => { load().catch(() => setFile(null)); }, [load]);
  // While the words are being recovered, check every few seconds.
  useEffect(() => {
    if (tx?.state !== 'running') return undefined;
    const t = setInterval(async () => {
      const next = await api.transcription(production.id).catch(() => null);
      if (next) setTx(next);
      if (next && next.state !== 'running') { clearInterval(t); reload?.(); }
    }, 3000);
    return () => clearInterval(t);
  }, [tx?.state, production.id, reload]);

  if (file === undefined) return null;
  const clock = (d) => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`;
  const drop = (label, hint) => (
    <UploadDrop label={label} hint={hint} upload={(f, onProgress) => api.uploadFinishedVideo(production.id, f, onProgress)}
      onDone={async () => { await load(); }} />
  );

  if (!file) {
    return (
      <section className={compactUpload ? 'h-full [&>div]:h-full' : 'mt-[14px]'}>
        {completedAsset && (
          <p className="text-[12.5px] text-ink-2 m-[0_0_8px]"><Check size={13} className="inline -mt-[2px] text-ok" /> <b>Already made:</b> {completedAsset}. Add the file to keep it with this video and recover its words.</p>
        )}
        {drop(compactUpload ? 'Cut it in CapCut? Upload it here' : completedAsset ? 'Upload the finished video' : 'Finished video? Upload it',
          compactUpload ? 'Drop the finished file here or click to choose it. It is filed with the video and marked done; the words in it are recovered as the script.'
            : 'Drop the file here or click to choose it. It is filed under Company / Track / Video, this video is marked done, and the words spoken in it are transcribed on this Mac as its script.')}
      </section>
    );
  }

  // Exported in the app: its words are the approved script already, so there
  // is nothing to recover from it.
  const exportedHere = /exported in the app|rendered from your recording/.test(production.brief.find((b) => b.label === 'Completed confirmed')?.value ?? '');
  const fileName = (file.localPath ?? '').split('/').pop();
  return (
    <section className="mt-[14px] border border-solid border-[#c5e3d5] bg-ok-soft rounded-lg p-[12px_14px] flex flex-wrap gap-[16px] items-start">
      <video className="w-[170px] rounded-md bg-ink" src={file.fileUrl} controls preload="metadata" />
      <div className="flex-1 min-w-[220px] flex flex-col gap-[6px] text-[12.5px]">
        <b className="text-[13.5px] text-ok flex items-center gap-[6px]"><Check size={15} /> Finished video</b>
        <span className="text-ink-2">{completedAsset ?? file.name}{file.duration ? ` · ${clock(file.duration)}` : ''}</span>
        <span className="text-muted text-[11.5px] truncate" title={file.localPath}>{fileName} — in the video's folder in your storage</span>
        {!exportedHere && <span className={tx?.state === 'failed' ? 'text-danger' : tx?.state === 'running' ? 'text-warn' : 'text-ink-2'}>
          {tx?.state === 'running' && <><RefreshCw size={12} className="inline animate-spin -mt-[2px]" /> Recovering the words spoken in it… (about 40 seconds a minute of video)</>}
          {tx?.state === 'done' && <>Script recovered from the video — {tx.detail.replace(/^Done — /, '')}. It is the accepted script.</>}
          {tx?.state === 'failed' && <>{tx.detail}</>}
          {!tx?.state && <>The words in it have not been recovered yet.</>}
        </span>}
        <span className="flex flex-wrap gap-[8px] mt-[4px]">
          {!exportedHere && tx?.state !== 'running' && (
            <button className="text-[12px] p-[4px_10px]" onClick={async () => { await api.retranscribe(production.id); setTx({ state: 'running' }); }}>
              {tx?.state === 'done' ? 'Transcribe again' : 'Recover the words'}
            </button>
          )}
          <UploadDrop compact label="Replace the file" upload={(f, onProgress) => api.uploadFinishedVideo(production.id, f, onProgress)}
            onDone={async () => { await load(); }} />
        </span>
      </div>
    </section>
  );
}
