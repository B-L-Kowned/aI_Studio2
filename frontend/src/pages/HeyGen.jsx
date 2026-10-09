import React, { useState, useEffect, useCallback } from 'react';
import {
  Check, AlertCircle, ExternalLink, RefreshCw, Download, Play, Lock, Wallet,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import LoadState from '../components/LoadState.jsx';
import { Section } from '../components/Section.jsx';
import { useBudget, BudgetMeter, BudgetPicker } from '../components/Budget.jsx';
import { SectionHead } from '../components/SettingsUI.jsx';

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
  const { mutate, notify, workspace, reload: reloadWorkspace } = useStudio();
  const [reading, setReading] = useState(false);
  const [status, setStatus] = useState(null);
  const [videos, setVideos] = useState(null);
  const [assets, setAssets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetKind, setAssetKind] = useState('all');
  const [assetLimit, setAssetLimit] = useState(ASSET_PAGE);
  const [budget, , setBudget] = useBudget();
  const [editingBudget, setEditingBudget] = useState(false);

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
      {embedded ? <SectionHead title="HeyGen account" lead="Your HeyGen plan, its credits, and the looks and voices it holds." /> : <h1>HeyGen</h1>}
      {/* One line: whether you are signed in, and the one thing to do about it. */}
      <div className={`flex flex-wrap items-center gap-x-[12px] gap-y-[8px] rounded-lg p-[10px_14px] mb-[16px] ${POCKET_CLASS[status.pocket] ?? ''}`}>
        <b className="inline-flex items-center gap-[7px] text-[13.5px] font-[580]">
          {connected && <><Check size={15} className="text-ok" /> HeyGen connected</>}
          {!connected && status.pocket === 'key' && <><AlertCircle size={15} className="text-warn" /> Using an API key</>}
          {!connected && status.pocket === 'none' && <><Lock size={15} className="text-muted" /> HeyGen not connected</>}
        </b>
        <span className="text-[12.5px] text-muted min-w-0 flex-1"
          title={connected ? status.explanation : 'Opens a browser tab. Signing in only reads your account — nothing is charged. The consent screen reads “HeyGen MCP Default”; HeyGen overrides the name.'}>
          {connected ? 'Renders use the plan you already pay for.' : 'Sign in to use the plan you already pay for, see your videos and refresh avatar pictures.'}
          {status.recommendation && <span className="text-warn"> {status.recommendation}</span>}
        </span>
        {status.credits != null && <span className="credits" title={status.creditsResetAt ? `Premium credits reset on ${new Date(status.creditsResetAt).toLocaleDateString()}` : ''}><Wallet size={13} /> {status.credits} premium credits{status.creditsResetAt ? ` · reset ${new Date(status.creditsResetAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</span>}
        <span className="flex items-center gap-[6px]">
          <button className="ghostbtn p-[5px]" title="Refresh" aria-label="Refresh" onClick={load}><RefreshCw size={14} /></button>
          {connected
            ? <button onClick={() => mutate(() => api.heygenDisconnect(), null).then(load)}>Disconnect</button>
            : <button className="primary whitespace-nowrap" onClick={connect} disabled={busy}>{busy ? 'Opening…' : <><ExternalLink size={14} /> Sign in</>}</button>}
        </span>
      </div>

      {/* Signed in, but the studio is still set not to contact HeyGen: one click to read the account. */}
      {connected && workspace?.providerMode?.mode === 'fixtures' ? (
        <div className="flex flex-wrap items-center gap-[10px] m-[-6px_0_16px] p-[10px_14px] rounded-lg border border-solid border-line bg-surface">
          <span className="flex-1 min-w-[260px] text-[12.5px] text-ink-2">
            <b className="font-[600]">One more step: let the studio read your account.</b>{' '}
            <span className="text-muted">Loads your videos, looks, voices and credits. Reading is free; nothing renders until you choose to.</span>
          </span>
          <button className="primary" disabled={reading} onClick={async () => {
            setReading(true);
            try {
              await mutate(() => api.setProviderMode('live_read', false), null);
              await reloadWorkspace?.();
              await mutate(() => api.syncProvider('heygen'), null, { silent: true }).catch(() => {});
              setErr(null);
              await load();
            } catch { /* reported */ } finally { setReading(false); }
          }}>{reading ? 'Reading…' : 'Read my account'}</button>
        </div>
      ) : err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}

      {/* Your HeyGen account, your money: the studio spends only up to a limit you choose. */}
      {/* Signed in to a plan: renders spend its credits, so the plan is what to show. */}
      {connected && status.pocket !== 'key' && (
        <Section title="Your plan" meta={typeof status.plan === 'string' ? status.plan : (status.plan?.name ?? status.plan?.label ?? 'connected by sign-in')}>
          <p className="m-0 text-[12.5px] text-ink-2 leading-[1.55]">
            Renders use your plan’s credits{status.credits != null ? <> — <b className="font-[600]">{status.credits} premium credits left</b>{status.creditsResetAt ? `, back on ${new Date(status.creditsResetAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` : ''}</> : ''}. HeyGen stops when they run out, so nothing here can overspend.
            {status.credits === 0 && <span className="block mt-[6px] text-warn">With none left, avatar renders on your plan wait until they reset — or add credits in HeyGen.</span>}
            {' '}<span className="text-muted">A plan has no free test render; a free, watermarked test needs a pay-as-you-go API key (Settings → Connections), and a monthly dollar limit applies only to that.</span>
          </p>
        </Section>
      )}

      {budget && (!connected || status.pocket === 'key') && (
        <Section title="Monthly limit" meta={budget.set ? 'renders stop before passing it' : 'choose one before your first paid render'}>
          {!connected && status.pocket === 'none' && (
            <p className="m-[0_0_10px] text-[12.5px] text-muted leading-[1.5]">
              Two ways to connect HeyGen: <b className="text-ink font-[560]">sign in</b> above to use a web plan you pay for monthly, or paste an <b className="text-ink font-[560]">API key</b> under Settings → Connections to pay as you go. Either way it is your own account.
            </p>
          )}
          {budget.set && !editingBudget ? (
            <div className="flex flex-wrap items-center gap-[12px]">
              <div className="flex-1 min-w-[260px]"><BudgetMeter budget={budget} /></div>
              <button onClick={() => setEditingBudget(true)}>Change limit</button>
            </div>
          ) : (
            <BudgetPicker budget={budget} onSaved={(b) => { setBudget(b); setEditingBudget(false); }} />
          )}
          {budget.atLimit && <p className="sectionnote warn"><AlertCircle size={14} /> This month's limit is reached. Nothing more renders until {budget.resetsOn} unless you raise it.</p>}
        </Section>
      )}

      {/* Your videos only exist once signed in; until then the bar above says so. */}
      {connected && (
        <Section title="Your videos" meta={videos === null ? 'checking your account…' : `${videos.length} in your account${videos.length ? ` · ${videos.filter((v) => v.imported).length} in the studio` : ''}`}>
          {videos === null ? (
            <p className="sectionempty">Asking HeyGen about each of your videos…</p>
          ) : videos.length === 0 ? (
            <p className="sectionempty">No videos in this account yet.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-[12px]">
              {videos.map((v) => (
                <div className="flex flex-col gap-[6px]" key={v.id}>
                  <div className="aspect-[16/10] rounded [background-color:#17181a] bg-cover bg-no-repeat bg-[position:center_28%] grid place-items-center text-[rgba(255,255,255,.45)]" style={v.thumbnailUrl ? { backgroundImage: `url(${v.thumbnailUrl})` } : undefined}>
                    {!v.thumbnailUrl && <Play size={20} />}
                  </div>
                  <b className="text-[12.5px] leading-[1.35] line-clamp-2">{v.title}</b>
                  <div className="flex gap-[8px] items-center text-[11.5px] text-muted">
                    <span className={'vchip ' + (v.status === 'completed' ? 'complete' : v.status)}>{v.status}</span>
                    {v.duration && <span>{Math.round(v.duration)}s</span>}
                    {v.imported
                      ? <span className="ml-auto inline-flex items-center gap-[4px] text-[11.5px] text-ok"><Check size={12} /> In the studio</span>
                      : <button className="ml-auto ghostbtn p-[2px_4px] text-[11.5px] text-accent" disabled={v.status !== 'completed'}
                          onClick={() => mutate(() => api.importHeygenVideo(v.id), null).then(load)}>
                          <Download size={12} /> Import
                        </button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* A catalogue is something you look at: pictures, not rows of IDs. */}
      <section>
        <div className="flex flex-wrap items-center gap-[10px] mb-[10px]">
          <h3 className="m-0 text-[13.5px] font-[600]">Avatars &amp; voices</h3>
          <span className="flex gap-[4px]" role="group" aria-label="Show">
            {[['all', 'All', assets.length], ['avatar', 'Avatars', assets.filter((a) => a.kind === 'avatar').length], ['voice', 'Voices', assets.filter((a) => a.kind === 'voice').length]].map(([id, label, n]) => (
              <button key={id} type="button" onClick={() => { setAssetKind(id); setAssetLimit(ASSET_PAGE); }}
                className={'text-[12px] p-[3px_10px] rounded-full ' + (assetKind === id ? 'bg-ink text-white border-ink' : 'bg-surface')}>
                {label} <span className={assetKind === id ? 'opacity-70' : 'text-faint'}>{n}</span>
              </button>
            ))}
          </span>
          <input className="ml-auto w-[240px] text-[12.5px] p-[5px_9px]" placeholder="Search…" value={assetQuery}
            onChange={(e) => { setAssetQuery(e.target.value); setAssetLimit(ASSET_PAGE); }} />
          {connected && (
            <button onClick={() => mutate(() => api.syncProvider('heygen'), null).then(load)}><RefreshCw size={13} /> Sync</button>
          )}
        </div>

        {assets.length === 0 ? (
          <p className="sectionempty">Nothing synced yet.</p>
        ) : (() => {
          const q = assetQuery.trim().toLowerCase();
          const matched = assets.filter((a) =>
            (assetKind === 'all' || a.kind === assetKind) &&
            (!q || a.name.toLowerCase().includes(q) || a.remoteId.toLowerCase().includes(q)));
          const shown = matched.slice(0, assetLimit);
          if (!matched.length) return <p className="sectionempty">Nothing matches “{assetQuery}”.</p>;
          return (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[12px]">
                {shown.map((a) => <AssetTile key={a.id} asset={a} onHide={async () => { await mutate(() => api.hideAsset(a.id), null).catch(() => {}); await load(); }} />)}
              </div>
              {shown.length < matched.length && (
                <p className="sectionnote">
                  Showing {shown.length} of {matched.length} · <button className="ghostbtn p-0 text-accent text-[length:inherit]" onClick={() => setAssetLimit((n) => n + 200)}>Show more</button>
                </p>
              )}
            </>
          );
        })()}
      </section>

      {status.capabilities?.connected && (
        <Section title="What your MCP server exposes" meta="from tools/list — free to read">
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

/**
 * One avatar or voice: its picture (kept on this Mac, so it does not go blank
 * when HeyGen's link expires) or, for a voice, a play button for its sample.
 */
function AssetTile({ asset: a, onHide }) {
  const [broken, setBroken] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = React.useRef(null);
  const initials = a.name.split(/[\s—-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const voice = a.kind === 'voice';
  const toggle = () => {
    if (!a.previewUrl) return;
    const el = audio.current ?? (audio.current = new Audio(a.previewUrl));
    if (playing) { el.pause(); return; }
    el.onended = () => setPlaying(false);
    el.onpause = () => setPlaying(false);
    el.play().then(() => setPlaying(true)).catch(() => setBroken(true));
  };
  return (
    <figure className="group/tile m-0 flex flex-col gap-[6px] min-w-0" title={`${a.name}\n${a.remoteId}`}>
      <div className="relative aspect-[4/5] rounded-lg overflow-hidden bg-canvas border border-solid border-line grid place-items-center">
        {!voice && a.previewUrl && !broken
          ? <img src={a.previewUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover object-[center_25%]" />
          : voice
            ? <button type="button" onClick={toggle} disabled={!a.previewUrl || broken} aria-label={`Play ${a.name}`}
                className="w-[44px] h-[44px] p-0 rounded-full grid place-items-center">
                {playing ? <span className="w-[12px] h-[12px] bg-ink rounded-[2px]" /> : <Play size={16} className="ml-[2px]" />}
              </button>
            : <span className="text-[22px] font-[600] text-faint tracking-[.02em]" title="The preview link expired — sign in and Sync to refresh it">{initials}</span>}
        {a.isFixture && <span className="absolute top-[6px] left-[6px] text-[10px] bg-warn-soft text-warn rounded p-[1px_6px]">sample</span>}
        {/* An avatar in your account that is not you: hide it from the studio (it stays in HeyGen). */}
        {!voice && onHide && (
          <button type="button" onClick={onHide} title="Not you? Hide it from the studio — it stays in your HeyGen account"
            className="absolute top-[6px] right-[6px] text-[11px] p-[2px_8px] rounded-full opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100 [transition:opacity_.12s]">Not me</button>
        )}
      </div>
      <figcaption className="min-w-0">
        <b className="block text-[12.5px] font-[560] text-ink truncate">{a.name.trim() || 'Untitled'}</b>
        <span className="block text-[11px] text-faint capitalize">{a.kind}{voice && a.language ? ` · ${a.language}` : ''}</span>
      </figcaption>
    </figure>
  );
}
