import React, { useState, useEffect, useCallback } from 'react';
import {
  Check, AlertCircle, ExternalLink, RefreshCw, Download, Play, Lock, Wallet,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import { Section } from '../components/Section.jsx';

/**
 * Your actual HeyGen account: videos, avatars, credits.
 *
 * Two pockets, and they are not interchangeable — MCP spends the web plan you
 * already pay for; an API key spends a separate pay-as-you-go balance. The state
 * panel says which, once, at the top.
 *
 * Layout rule here: one fact, stated once. The disconnected page used to repeat
 * "not connected" across a banner, two notices and two empty states — 549px of
 * a 1212px page saying the same thing.
 */

const ASSET_PAGE = 40;

// The state panel's accent, by which pocket pays.
const POCKET_CLASS = {
  mcp: 'border-l-[3px] border-l-ok bg-ok-soft',
  key: 'border-l-[3px] border-l-warn bg-warn-soft',
  none: 'border-l-[3px] border-l-faint bg-surface-2',
};
const CONN_P = 'm-[6px_0_0] text-[12.5px] leading-[1.55]';

export default function HeyGen({ embedded }) {
  const { mutate, notify } = useStudio();
  const [status, setStatus] = useState(null);
  const [videos, setVideos] = useState(null);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetKind, setAssetKind] = useState('all');
  const [assetLimit, setAssetLimit] = useState(ASSET_PAGE);

  const load = useCallback(async () => {
    const s = await api.heygenStatus();
    setStatus(s);
    // The endpoint is a search now; default to what this account owns.
    setAssets((await api.providerAssets('heygen')).items ?? []);
    if (s.mcp.connected) {
      try { setVideos(await api.heygenVideos()); }
      catch (ex) { setVideos([]); setErr(ex.message); }
    }
  }, []);

  useEffect(() => { load().then(() => setLoadError(null), setLoadError); }, [load]);
  if (!status) return <LoadState error={loadError} retry={() => load().then(() => setLoadError(null), setLoadError)} />;

  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.heygenConnect();
      window.open(res.data.url, '_blank', 'noopener');
      notify('Sign in to HeyGen in the new tab, then press Refresh.', 'ok');
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  const connected = status.mcp.connected;
  const fixtures = assets.filter((a) => a.isFixture).length;
  const real = assets.length - fixtures;

  return (
    <>
      {/* Inside Settings the rail already names this section, so a second <h1>
          would be the page title repeated one line below itself. */}
      <div className={embedded ? 'flex items-center justify-between mb-[14px]' : 'title'}>
        {embedded ? <h2 className="m-0 text-[17px]">HeyGen account</h2> : <h1>HeyGen</h1>}
        <div className="quickrow">
          <button onClick={load}><RefreshCw size={14} /> Refresh</button>
          {connected && (
            <button onClick={() => mutate(() => api.heygenDisconnect(), null).then(load)}>
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* One state panel. It carries the action, so nothing below needs to. */}
      <div className={`flex gap-[20px] items-start border border-solid border-line rounded-lg p-[16px_18px] m-[14px_0] ${status.pocket} ${POCKET_CLASS[status.pocket] ?? ''}`}>
        <div className="flex-1 min-w-0">
          <b className="inline-flex items-center gap-[8px] text-[14px]">
            {connected && <><Check size={15} /> Signed in — using your HeyGen plan</>}
            {!connected && status.pocket === 'key' && <><AlertCircle size={15} /> Using an API key</>}
            {!connected && status.pocket === 'none' && <><Lock size={15} /> Not connected</>}
          </b>
          <p className={CONN_P}>{status.explanation}</p>
          {status.recommendation && <p className={CONN_P + ' !mt-[8px] font-[560] text-warn'}>{status.recommendation}</p>}
          {!connected && (
            <p className={CONN_P + ' text-muted'}>
              Opens a browser tab. Signing in only reads your account — nothing is charged.
              The consent screen reads <b className="inline-flex items-center gap-[8px] text-[14px]">“HeyGen MCP Default”</b>; HeyGen overrides the name.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-[8px] items-end shrink-0">
          {status.credits != null && (
            <span className="credits"><Wallet size={13} /> {status.credits} credits</span>
          )}
          {!connected && (
            <button className="primary whitespace-nowrap" onClick={connect} disabled={busy}>
              {busy ? 'Opening…' : <><ExternalLink size={15} /> Sign in to HeyGen</>}
            </button>
          )}
        </div>
      </div>

      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}

      <Section
        title="Your videos"
        meta={connected ? `${videos?.length ?? 0} in your account` : 'available once signed in'}
      >
        {!connected ? (
          <p className="sectionempty"><Play size={15} /> Your HeyGen videos appear here after you sign in.</p>
        ) : videos === null ? (
          <p className="sectionempty">Loading…</p>
        ) : videos.length === 0 ? (
          <p className="sectionempty">No videos in this account yet.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(228px,1fr))] gap-[12px] lte860:grid-cols-[repeat(2,1fr)] lte620:grid-cols-[1fr]">
            {videos.map((v) => (
              <div className="bg-surface border border-solid border-line rounded-lg p-[12px] flex flex-col gap-[7px]" key={v.id}>
                {/* HeyGen renders 9:16 portrait. `contain` letterboxed it on black and a
                    centred `cover` crop is a chin on a talking head: fill the frame,
                    biased upward to the face. */}
                <div className="aspect-[16/10] rounded [background-color:#17181a] bg-cover bg-no-repeat bg-[position:center_28%] grid place-items-center text-[rgba(255,255,255,.45)]" style={v.thumbnailUrl ? { backgroundImage: `url(${v.thumbnailUrl})` } : undefined}>
                  {!v.thumbnailUrl && <Play size={20} />}
                </div>
                <b className="text-[13px] leading-[1.35] min-h-[2.7em] line-clamp-2">{v.title}</b>
                <div className="flex gap-[8px] items-center text-[11.5px] text-muted mt-[-2px]">
                  <span className={'vchip ' + (v.status === 'completed' ? 'complete' : v.status)}>{v.status}</span>
                  {v.duration && <span>{Math.round(v.duration)}s</span>}
                </div>
                <button
                  className="text-[12px] p-[6px_10px] justify-center flex items-center gap-[6px]"
                  disabled={v.status !== 'completed'}
                  onClick={() => mutate(() => api.importHeygenVideo(v.id), null).then(load)}
                >
                  <Download size={13} /> Import to Library
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 2000 synced assets were all drawn as rows, which made this page 77,000
          pixels tall and pushed the settings rail off into nothing. A catalogue
          is something you search, not something you scroll. */}
      <Section
        title="Avatars & voices"
        meta={`${real} yours · ${fixtures} sample`}
        actions={connected && (
          <button onClick={() => mutate(() => api.syncProvider('heygen'), null).then(load)}>
            <RefreshCw size={13} /> Sync
          </button>
        )}
      >
        {assets.length === 0 ? (
          <p className="sectionempty">Nothing synced yet.</p>
        ) : (
          <>
            <div className="flex gap-[8px] mb-[10px]">
              <input
                className="flex-1 text-[13px] p-[6px_9px]"
                placeholder={`Search ${assets.length} avatars and voices…`}
                value={assetQuery}
                onChange={(e) => { setAssetQuery(e.target.value); setAssetLimit(ASSET_PAGE); }}
              />
              <select className="text-[13px] p-[6px_8px]" value={assetKind} onChange={(e) => { setAssetKind(e.target.value); setAssetLimit(ASSET_PAGE); }}>
                <option value="all">All kinds</option>
                <option value="avatar">Avatars</option>
                <option value="voice">Voices</option>
              </select>
            </div>

            {(() => {
              const q = assetQuery.trim().toLowerCase();
              const matched = assets.filter((a) =>
                (assetKind === 'all' || a.kind === assetKind) &&
                (!q || a.name.toLowerCase().includes(q) || a.remoteId.toLowerCase().includes(q)));
              const shown = matched.slice(0, assetLimit);

              if (!matched.length) {
                return <p className="sectionempty">Nothing matches “{assetQuery}”.</p>;
              }
              return (
                <>
                  <div className="assetlist">
                    {shown.map((a) => (
                      <div className="assetrow" key={a.id}>
                        <span className="akind">{a.kind}</span>
                        <b>{a.name.trim() || 'Untitled'}</b>
                        {a.isFixture
                          ? <em className="sample">sample</em>
                          : <em className="realmark"><Check size={11} /> yours</em>}
                        <code className="text-muted">{a.remoteId}</code>
                      </div>
                    ))}
                  </div>
                  <p className="sectionnote">
                    Showing {shown.length} of {matched.length}
                    {matched.length < assets.length ? ` (filtered from ${assets.length})` : ''}
                    {shown.length < matched.length && (
                      <> · <button className="[border:0] bg-transparent p-0 text-[length:inherit] text-accent underline rounded-none [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:text-accent" onClick={() => setAssetLimit((n) => n + 200)}>
                        Show 200 more
                      </button></>
                    )}
                  </p>
                </>
              );
            })()}
          </>
        )}
      </Section>

      {status.capabilities?.connected && (
        <Section
          title="What your MCP server exposes"
          meta="from tools/list — free to read"
        >
          <div className="flex gap-[5px] flex-wrap mt-[8px] max-h-[132px] overflow-auto pr-[4px]">
            {status.capabilities.tools.map((t) => (
              <code key={t} className="text-[11px] bg-canvas border border-solid border-line p-[3px_7px] rounded-sm text-muted">{t}</code>
            ))}
          </div>
          <p className={'sectionnote ' + (status.capabilities.canGenerateVideo ? 'ok' : 'warn')}>
            {status.capabilities.canGenerateVideo
              ? <><Check size={14} /> Renders can use your plan via <code>{status.capabilities.generateTool}</code>.</>
              : <><AlertCircle size={14} /> No video-generation tool here, so a render falls back to the API key — which bills separately from your plan.</>}
          </p>
        </Section>
      )}
    </>
  );
}
