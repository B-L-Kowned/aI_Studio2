import React, { useState, useEffect, useCallback } from 'react';
import {
  Check, AlertCircle, Lock, RefreshCw, Trash2, KeyRound, HardDrive,
  Sparkles, Video, Share2, X, Plug, Mic,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import ConnectionsSection from './ConnectionsSection.jsx';
import VoiceSection from './VoiceSection.jsx';
import { PageHead } from '../components/Section.jsx';
import HeyGen from './HeyGen.jsx';
import { useBudget } from '../components/Budget.jsx';

const SECTIONS = [
  // What you touch while making videos first; the install's plumbing last.
  { id: 'voice', label: 'Your voice', icon: Mic },
  { id: 'heygen', label: 'HeyGen account', icon: Video },
  { id: 'generation', label: 'Generation', icon: Video },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'publishing', label: 'Publishing', icon: Share2 },
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'ai', label: 'Model routing', icon: Sparkles },
  { id: 'license', label: 'License', icon: KeyRound },
];

/**
 * What a mode can cost. Three states, not two: Test renders are free but its
 * auditions are real speech on your plan, so calling it "$0" would be a claim
 * the credit balance disproves.
 */
const SPEND = {
  none:     { tone: 'free', label: '$0 — nothing can be charged' },
  metered:  { tone: 'meter', label: 'auditions use credits; renders are free' },
  billable: { tone: 'bill', label: 'can be billed' },
};

const TONE_CLASS = { free: 'free text-ok', meter: 'text-accent', bill: 'text-warn' };

// Section headings in the rail body.
const H2 = 'm-[0_0_4px]';

export default function Setup() {
  const [section, setSection] = useState(() => {
    // Another page can send you straight to a section (e.g. the HeyGen limit).
    try { const s = sessionStorage.getItem('settings-section'); sessionStorage.removeItem('settings-section'); return s || 'voice'; } catch { return 'voice'; }
  });
  const { workspace } = useStudio();

  return (
    <>
      <PageHead
        title="Settings"
        lead="Voice, HeyGen, storage and connections."
      />

      <div className="grid grid-cols-[186px_1fr] bg-surface border border-solid border-line rounded-lg overflow-clip lte860:grid-cols-[1fr]">
        {/* The rail is a list, not a column to be stretched: without
            align-self:start a long section made it 80,000px tall with its links
            marooned at the top. */}
        <nav className="p-[12px] bg-surface-2 [border-right:1px_solid_var(--line)] self-start sticky top-[69px] z-[1] lte860:static lte860:[border-right:0] lte860:[border-bottom:1px_solid_var(--line)] lte860:flex lte860:flex-wrap lte860:gap-[4px]">
          {SECTIONS.map((s) => {
            const I = s.icon;
            return (
              <button
                key={s.id}
                className={
                  'flex items-center gap-[8px] w-full [border:0] text-left p-[8px_10px] mb-[1px] lte860:w-auto ' +
                  (section === s.id
                    ? 'sel bg-ink [color:#fff] font-[540] [&:hover:not(:disabled)]:bg-ink [&:hover:not(:disabled)]:[color:#fff]'
                    : 'bg-transparent text-ink-2 [&:hover:not(:disabled)]:bg-canvas')
                }
                onClick={() => setSection(s.id)}
              >
                <I size={14} className="shrink-0" /> {s.label}
              </button>
            );
          })}
        </nav>

        <div className="p-[22px_24px] min-w-0 [&>.muted]:m-[0_0_18px] [&>.muted]:max-w-[62ch]">
          {section === 'license' && <LicenseSection />}
          {section === 'connections' && <ConnectionsSection />}
          {section === 'ai' && <AiSection />}
          {section === 'generation' && <GenerationSection onHeyGen={() => setSection('heygen')} />}
          {section === 'voice' && <VoiceSection />}
          {section === 'heygen' && <HeyGen embedded />}
          {section === 'storage' && <StorageSection />}
          {section === 'publishing' && <PublishingSection />}
        </div>
      </div>
    </>
  );
}

const SETROW = 'grid grid-cols-[210px_1fr] gap-[16px] items-center p-[11px_0] [border-bottom:1px_solid_var(--line)] last:[border-bottom:0] lte860:grid-cols-[1fr] lte860:gap-[6px]';
const SUBHEAD = 'text-[11px] tracking-[.07em] text-faint font-[600] m-[26px_0_4px] uppercase';
const SETCONTROL = 'flex items-center gap-[8px] flex-wrap min-w-0';

function Row({ label, hint, children }) {
  return (
    <div className={SETROW}>
      <div>
        <b className="text-[13px] font-[540] block">{label}</b>
        {hint && <small className="block text-[11.5px] text-muted mt-[2px]">{hint}</small>}
      </div>
      <div className={SETCONTROL}>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ license
function LicenseSection() {
  const { workspace, setWorkspace, mutate } = useStudio();
  const [key, setKey] = useState('');
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await mutate(() => api.submitLicense(key), (r) => setWorkspace(r.data));
      setKey('');
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <h2 className={H2}>License</h2>
      <p className="muted">
        One application build. The key sets what is unlocked; upgrading never reinstalls
        anything or migrates a project.
      </p>

      <Row label="Entitlement">
        <span className="text-[14px] font-[600] capitalize">{workspace.entitlement}</span>
        <code className="text-muted">{workspace.licenseHint ?? 'no key'}</code>
      </Row>

      <Row label="Change key" hint="Paste an upgraded key to unlock more">
        <form className="flex gap-[7px] items-center flex-1 min-w-0" onSubmit={submit}>
          <input className="flex-1 min-w-[150px]" value={key} onChange={(e) => setKey(e.target.value)} placeholder="BOTH-A1B2-C3D4" />
          <button className="primary" type="submit" disabled={!key.trim()}>Validate</button>
        </form>
      </Row>
      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}

      <Row label="Programs" hint="What this key unlocks. Not a switch — the presenter you cast says which program you are in.">
        <div className="flex gap-[6px] flex-wrap">
          {['funny', 'content'].map((p) => {
            const has = (workspace.program?.programs ?? []).includes(p);
            return (
              <span key={p} className={'chip' + (has ? ' on' : '')}>
                {has ? <Check size={11} /> : <Lock size={11} />} {p === 'funny' ? 'Comedy' : 'Content'}
              </span>
            );
          })}
        </div>
      </Row>

      <Row label="Presenter rosters" hint="Who you can put on screen">
        <div className="flex gap-[6px] flex-wrap">
          {(workspace.program?.presenterTabs ?? []).map((t) => (
            <span key={t.id} className="chip on"><Check size={11} /> {t.label}</span>
          ))}
        </div>
      </Row>

      <Row label="A creation is called" hint="Comedy makes Bits, Content makes Videos">
        <span className="text-[14px] font-[600] capitalize">{workspace.program?.noun?.one ?? 'Project'}</span>
      </Row>

      {/* Internal names, kept for support, folded away from everyday reading. */}
      <details className="mt-[14px] text-[12px] text-muted">
        <summary className="cursor-pointer select-none">Technical details · {workspace.capabilities.length} capabilities granted by this key</summary>
        <div className="flex gap-[5px] flex-wrap mt-[8px]">
          {workspace.capabilities.map((c) => (
            <code key={c} className="text-[11px] bg-surface border border-solid border-line text-muted p-[4px_8px] rounded-sm">{c}</code>
          ))}
        </div>
      </details>
    </>
  );
}

// ----------------------------------------------------------------- planning
/**
 * The model on this Mac that Enhance and the suggestions use. Light comes with
 * the app; Full is an optional bigger download for whole-script rewrites. Auto
 * uses Full when it is there and Light otherwise, so most people never choose.
 */
function LocalModel({ onChange }) {
  const { mutate } = useStudio();
  const [t, setT] = useState(null);
  const load = useCallback(() => api.modelTier().then(setT).catch(() => setT(null)), []);
  useEffect(() => { load(); }, [load]);
  // Poll while a download runs.
  useEffect(() => {
    if (!t?.pulling || t.pulling.done) return undefined;
    const h = setTimeout(load, 1500);
    return () => clearTimeout(h);
  }, [t, load]);
  if (!t) return null;
  const choose = (tier) => mutate(() => api.setModelTier(tier), (r) => { setT(r.data); onChange?.(); });
  const download = (tier) => mutate(() => api.downloadModelTier(tier), (r) => setT(r.data));
  const CARD = (on) => 'flex flex-col gap-[4px] text-left p-[11px_13px] rounded-lg border border-solid ' + (on ? 'border-ink [box-shadow:inset_0_0_0_1px_var(--ink)]' : 'border-line');
  const p = t.pulling;
  return (
    <div className="m-[6px_0_16px]">
      <h3 className={SUBHEAD}>Local model</h3>
      {!t.ollama ? (
        <div className="notice warn"><AlertCircle /><span>Ollama is not running on this Mac, so Enhance and suggestions are off. The plain checks still work. Open the Ollama app, then re-check.</span>
          <button onClick={load}><RefreshCw size={13} /> Re-check</button></div>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-[10px] lte860:grid-cols-[1fr]">
            <button type="button" className={CARD(t.tier === 'auto')} onClick={() => choose('auto')}>
              <span className="flex justify-between"><b className="text-[13px]">Auto</b>{t.tier === 'auto' && <Check size={14} />}</span>
              <small className="text-[11.5px] text-muted leading-[1.45]">Full when it is downloaded, Light otherwise. Suggested.</small>
            </button>
            {t.tiers.map((x) => (
              <div key={x.id} className={CARD(t.tier === x.id)}>
                <button type="button" className="text-left [border:0] bg-transparent p-0" onClick={() => x.installed && choose(x.id)} disabled={!x.installed}>
                  <span className="flex justify-between"><b className="text-[13px]">{x.label} <span className="font-normal text-muted">· {x.size}</span></b>{t.tier === x.id && <Check size={14} />}</span>
                  <small className="block text-[11.5px] text-muted leading-[1.45] mt-[4px]">{x.good}</small>
                </button>
                {x.installed
                  ? <small className="text-[11px] text-ok">Downloaded</small>
                  : p && !p.done && p.tier === x.id
                    ? <small className="text-[11px] text-accent">Downloading… {p.percent}%</small>
                    : <button className="self-start text-[12px] p-[3px_10px] mt-[2px]" disabled={p && !p.done} onClick={() => download(x.id)}>Download {x.size}</button>}
              </div>
            ))}
          </div>
          <p className="m-[8px_0_0] text-[12px] text-muted">
            {t.inUse ? <>Writing with <b className="text-ink font-[560]">{t.inUse}</b> ({t.inUseTier}). Nothing leaves this Mac.</> : 'No writing model yet — download Light to turn on Enhance.'}
            {p?.error && <span className="text-danger"> Download failed: {p.error}</span>}
          </p>
        </>
      )}
    </div>
  );
}

function AiSection() {
  const { workspace, setWorkspace, mutate } = useStudio();
  const llm = workspace.llm;
  const [runtime, setRuntime] = useState(null);
  const loadRuntime = useCallback(() => api.llmStatus().then(setRuntime).catch(() => setRuntime(null)), []);
  useEffect(() => { loadRuntime(); }, [loadRuntime]);
  const apply = (r) => setWorkspace(r.data);

  return (
    <>
      <h2 className={H2}>Model routing</h2>
      <p className="muted">
        Which engine does which job. Built-in deterministic is the offline $0 fallback;
        Local Ollama is a real on-device model; cloud models use your connected provider account.
      </p>

      <LocalModel onChange={loadRuntime} />

      {workspace.providerMode?.mode !== 'live' && llm.routing.script !== 'included'
        && llm.routing.script !== 'ollama' && (
        <div className="notice warn">
          <Lock />
          <span>
            Cloud scripting is held at the billing boundary. Enable <b>Live</b> under Generation
            before this route can call {llm.routing.script}.
          </span>
        </div>
      )}

      {llm.capabilities.map((c) => (
        <Row key={c.key} label={c.label} hint={c.detail}>
          <select
            className="min-w-[190px]"
            value={llm.routing[c.key]}
            disabled={!c.active}
            onChange={(e) => mutate(() => api.setLlmRouting(c.key, e.target.value), apply)}
          >
            {llm.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {!c.active && <span className="text-muted basis-full text-[11.5px]">route reserved · deterministic today</span>}
          {c.active && <span className="text-muted basis-full text-[11.5px]">active in script generation</span>}
        </Row>
      ))}

      {llm.providers.filter((p) => p.kind === 'cloud').length === 0 && (
        <div className="notice">
          <Sparkles />
          <span>
            No cloud model is connected. Built-in deterministic still works offline; start Ollama
            for local generation or connect ChatGPT, Claude, Groq or Grok under Connections.
          </span>
        </div>
      )}
    </>
  );
}

// --------------------------------------------------------------- generation
function GenerationSection({ onHeyGen }) {
  const { workspace, setWorkspace, mutate, reload } = useStudio();
  const pm = workspace.providerMode;
  const [providers, setProviders] = useState([]);
  const [confirmLive, setConfirmLive] = useState(false);
  const [err, setErr] = useState(null);

  const [hg, setHg] = useState(null);
  const [budget] = useBudget();
  const load = useCallback(async () => {
    setProviders(await api.providers());
    setHg(await api.heygenStatus().catch(() => null));
  }, []);
  useEffect(() => { load(); }, [load]);
  // The account row only records the last sync that worked. Whether HeyGen can
  // be reached NOW is the sign-in (or API key) — the same answer the HeyGen
  // account page gives, so the two pages never disagree.
  const live = (p) => (p.id === 'heygen' ? !!hg && (hg.mcp?.connected || hg.pocket === 'key') : p.status === 'connected');

  const pickMode = async (mode) => {
    setErr(null);
    if (mode === 'live' && !confirmLive) {
      setErr('Tick the billing confirmation before enabling Live.');
      return;
    }
    try {
      await mutate(() => api.setProviderMode(mode, mode === 'live'), (r) => setWorkspace(r.data));
      await load();
      await reload();
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <h2 className={H2}>Generation</h2>
      <p className="muted">
        How far provider calls may go. Reading your catalogue and spending credits are
        separate decisions, so they are separate settings.
      </p>

      <div className="grid grid-cols-[repeat(3,1fr)] gap-[10px] m-[6px_0_14px] lte860:grid-cols-[1fr]">
        {pm.modes.map((m) => (
          <button
            key={m.id}
            className={
              'flex flex-col gap-[6px] items-stretch text-left p-[13px] rounded-lg border border-solid ' +
              (pm.mode !== m.id
                ? 'border-line'
                : m.spend === 'billable'
                  ? 'sel border-warn [box-shadow:inset_0_0_0_1px_var(--warn)] [&:hover:not(:disabled)]:border-warn'
                  : 'sel border-ink [box-shadow:inset_0_0_0_1px_var(--ink)]')
            }
            onClick={() => pickMode(m.id)}
          >
            <span className="flex justify-between items-center">
              <b className="text-[13px]">{m.label}</b>
              {pm.mode === m.id && <Check size={14} />}
            </span>
            <small className="text-[11.5px] text-muted leading-[1.45]">{m.detail}</small>
            <em className={'not-italic text-[11px] ' + TONE_CLASS[SPEND[m.spend]?.tone ?? 'free']}>
              {SPEND[m.spend]?.label ?? m.spend}
            </em>
          </button>
        ))}
      </div>

      <label className="flex items-center gap-[8px] text-[12.5px] text-muted mb-[6px]">
        <input className="w-auto" type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} />
        I understand Live mode makes real, billable generation calls.
      </label>
      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}
      {budget && (
        <p className="m-[4px_0_0] text-[12.5px] text-muted">
          {budget.set
            ? <>Paid renders stop at your monthly limit: <b className="text-ink font-[560]">${budget.spent.toFixed(2)} of ${budget.monthlyCap}</b> used.</>
            : <>Before Live can render, choose a monthly limit for your HeyGen account.</>}{' '}
          <button className="ghostbtn p-0 text-accent text-[12.5px]" onClick={() => onHeyGen?.()}>{budget.set ? 'Change it' : 'Choose a limit'}</button>
        </p>
      )}

      <h3 className={SUBHEAD}>Catalogue</h3>
      {providers.map((p) => (
        <React.Fragment key={p.id}>
          <Row label={p.label} hint={live(p) ? 'signed in — catalogue syncs from your account' : p.lastSyncAt ? `not signed in · last synced ${p.lastSyncAt.slice(0, 10)}` : 'not signed in'}>
            <span className={live(p) ? 'okv' : 'text-warn'}>
              {live(p) ? <><Check size={13} /> connected</> : <><AlertCircle size={13} className="inline -mt-[2px]" /> not connected</>}
            </span>
            {live(p)
              ? <button onClick={() => mutate(() => api.syncProvider(p.id), null).then(load)}><RefreshCw size={13} /> Sync now</button>
              : p.id === 'heygen' && <button onClick={() => onHeyGen?.()}>Sign in…</button>}
          </Row>
          {p.lastSyncAt && (
            <div className="m-[-4px_0_8px]">
              <div className="flex gap-[16px] flex-wrap text-[12px] text-muted">
                <span>quota <b className="text-ink [font-variant-numeric:tabular-nums]">{p.quotaRemaining ?? '—'}</b></span>
                {Object.entries(p.assets).map(([k, n]) => <span key={k}>{k}s <b className="text-ink [font-variant-numeric:tabular-nums]">{n}</b></span>)}
                <span>synced <b className="text-ink [font-variant-numeric:tabular-nums]">{p.lastSyncAt.slice(0, 16).replace('T', ' ')}</b></span>
              </div>
            </div>
          )}
          {!p.endpointsVerified && pm.mode !== 'fixtures' && (
            <div className="notice warn">
              <AlertCircle />
              <span>
                One {p.label} path (templates) is still unconfirmed against its docs. Avatars,
                voices, quota, generate and status all match the working client.
              </span>
            </div>
          )}
        </React.Fragment>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ storage
function StorageSection() {
  const { workspace, setWorkspace, mutate } = useStudio();
  const [provider, setProvider] = useState(workspace.storageProvider ?? 'local');
  const [path, setPath] = useState(workspace.storagePath ?? '');
  const [err, setErr] = useState(null);

  const save = async () => {
    setErr(null);
    try {
      await mutate(() => api.saveStorage(provider, path), (r) => setWorkspace(r.data));
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <h2 className={H2}>Storage</h2>
      <p className="muted">
        Where finished videos and exports are saved. Changing it does not move videos
        already saved.
      </p>

      <Row label="Location">
        <div className="grid grid-cols-[repeat(3,1fr)] gap-[7px] mt-[10px] lte800:grid-cols-[1fr]">
          {[['local', 'Local disk'], ['google_drive', 'Google Drive'], ['dropbox', 'Dropbox']].map(([v, l]) => (
            <button
              key={v}
              className={'justify-center' + (provider === v ? ' chosen border-ink bg-canvas font-[540] [&:hover:not(:disabled)]:bg-canvas [&:hover:not(:disabled)]:border-ink' : '')}
              onClick={() => setProvider(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </Row>

      {provider === 'local' && (
        <Row label="Folder">
          <div className="flex gap-[7px] items-center flex-1 min-w-0">
            <input className="flex-1 min-w-[150px]" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/AI Video Studio" />
          </div>
        </Row>
      )}

      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}
      <div className="actions"><button className="primary" onClick={save}>Save storage</button></div>
    </>
  );
}

// --------------------------------------------------------------- publishing
function PublishingSection() {
  const { meta } = useStudio();

  return (
    <>
      <h2 className={H2}>Publishing</h2>
      <p className="muted">
        Where finished videos go. Artificial Funny posts directly; for the others the
        studio prepares a complete upload package and you post it.
      </p>

      {meta.publishTargets.map((c) => (
        <Row key={c.platform} label={c.platform} hint={c.domain ?? c.detail}>
          {c.kind === 'owned' && <span className="owntag">Owned</span>}
          <span className="text-[12px] text-muted" title="Finish builds the upload package: the video, captions, title, description and hashtags">
            {c.direct
              ? 'Posts directly once its key is added under Connections'
              : 'Prepare only · you post it, the package is ready in Finish'}
          </span>
        </Row>
      ))}
    </>
  );
}
