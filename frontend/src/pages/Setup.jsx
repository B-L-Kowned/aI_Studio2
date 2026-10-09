import React, { useState, useEffect, useCallback } from 'react';
import {
  Check, AlertCircle, Lock, RefreshCw, KeyRound, HardDrive,
  Sparkles, Video, Share2, Plug, Mic, Clapperboard, ChevronDown,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { useDialog } from '../components/Dialog.jsx';
import { api } from '../services/api.js';
import ConnectionsSection from './ConnectionsSection.jsx';
import VoiceSection from './VoiceSection.jsx';
import { PageHead } from '../components/Section.jsx';
import HeyGen from './HeyGen.jsx';
import { SectionHead, Card, Row, Pill } from '../components/SettingsUI.jsx';

const SECTIONS = [
  // What you touch while making videos first; the install's plumbing last.
  { id: 'voice', label: 'Your voice', icon: Mic },
  { id: 'heygen', label: 'HeyGen account', icon: Video },
  { id: 'generation', label: 'Rendering', icon: Clapperboard },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'publishing', label: 'Publishing', icon: Share2 },
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'ai', label: 'Writing model', icon: Sparkles },
  { id: 'license', label: 'Licence', icon: KeyRound },
];

export default function Setup() {
  const [section, setSection] = useState(() => {
    // Another page can send you straight to a section (e.g. the HeyGen limit).
    try { const s = sessionStorage.getItem('settings-section'); sessionStorage.removeItem('settings-section'); return s || 'voice'; } catch { return 'voice'; }
  });

  return (
    <>
      <PageHead title="Settings" lead="Your voice, HeyGen, where videos go, and what this install can do." />

      <div className="grid grid-cols-[200px_1fr] gap-[28px] items-start lte860:grid-cols-[1fr] lte860:gap-[14px]">
        {/* The rail is a list, not a column to be stretched. */}
        <nav className="self-start sticky top-[69px] grid gap-[2px] lte860:static lte860:flex lte860:flex-wrap lte860:gap-[4px]" aria-label="Settings sections">
          {SECTIONS.map((s) => {
            const I = s.icon;
            const on = section === s.id;
            return (
              <button key={s.id} type="button" aria-current={on ? 'page' : undefined} onClick={() => setSection(s.id)}
                className={'flex items-center gap-[9px] w-full [border:0] text-left p-[7px_10px] rounded-md text-[13px] lte860:w-auto '
                  + (on ? 'bg-surface text-ink font-[580] [box-shadow:var(--shadow)]' : 'bg-transparent text-muted hover:text-ink hover:bg-surface-2')}>
                <I size={14} className={'shrink-0 ' + (on ? 'text-ink' : 'text-faint')} /> {s.label}
              </button>
            );
          })}
        </nav>

        {/* One readable column: settings are read, not scanned across a wide screen. */}
        <div className="min-w-0 max-w-[880px]">
          {section === 'license' && <LicenseSection />}
          {section === 'connections' && <ConnectionsSection />}
          {section === 'ai' && <AiSection />}
          {section === 'generation' && <GenerationSection onHeyGen={() => setSection('heygen')} onConnections={() => setSection('connections')} />}
          {section === 'voice' && <VoiceSection />}
          {section === 'heygen' && <HeyGen embedded />}
          {section === 'storage' && <StorageSection />}
          {section === 'publishing' && <PublishingSection />}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ licence
function LicenseSection() {
  const { workspace, setWorkspace, mutate } = useStudio();
  const [key, setKey] = useState('');
  const [changing, setChanging] = useState(false);
  const [err, setErr] = useState(null);
  const programs = workspace.program?.programs ?? [];

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await mutate(() => api.submitLicense(key), (r) => setWorkspace(r.data));
      setKey(''); setChanging(false);
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <SectionHead title="Licence" lead="What this install unlocks. Upgrading only changes the key — nothing is reinstalled, and your work stays where it is." />
      <Card>
        <Row label="Programs" hint="The presenter you cast decides which one a video belongs to.">
          {['funny', 'content'].map((p) => {
            const has = programs.includes(p);
            return <Pill key={p} tone={has ? 'ok' : 'muted'}>{has ? <Check size={11} /> : <Lock size={11} />} {p === 'funny' ? 'Comedy' : 'Content'}</Pill>;
          })}
        </Row>
        <Row label="Who you can cast">
          {(workspace.program?.presenterTabs ?? []).map((t) => <Pill key={t.id} tone="ok"><Check size={11} /> {t.label}</Pill>)}
        </Row>
        <Row label="Licence key" hint={changing ? 'Paste the new key you were sent.' : null}>
          {changing ? (
            <form className="flex gap-[7px] items-center flex-1 min-w-0" onSubmit={submit}>
              <input className="flex-1 min-w-[180px] font-mono text-[12.5px]" value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoFocus />
              <button type="button" onClick={() => { setChanging(false); setKey(''); }}>Cancel</button>
              <button className="primary" type="submit" disabled={!key.trim()}>Apply</button>
            </form>
          ) : (
            <>
              <code className="text-[12.5px] text-ink-2">{workspace.licenseHint ?? 'No key'}</code>
              <button className="ml-auto text-[12.5px] p-[4px_11px]" onClick={() => setChanging(true)}>Change key</button>
            </>
          )}
        </Row>
      </Card>
      {err && <p className="oberr mt-[10px]"><AlertCircle size={14} /> {err}</p>}

      {/* Internal names, kept for support, folded away from everyday reading. */}
      <details className="mt-[14px] text-[12px] text-muted">
        <summary className="cursor-pointer select-none">Technical details for support</summary>
        <p className="m-[8px_0_4px]">A creation is called <b className="text-ink-2">{workspace.program?.noun?.one ?? 'Project'}</b>. Capabilities granted by this key:</p>
        <div className="flex gap-[5px] flex-wrap">
          {workspace.capabilities.map((c) => (
            <code key={c} className="text-[11px] bg-surface border border-solid border-line text-muted p-[3px_7px] rounded-sm">{c}</code>
          ))}
        </div>
      </details>
    </>
  );
}

// ------------------------------------------------------------ writing model
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
  const OPTION = (on) => 'flex flex-col gap-[4px] text-left p-[12px_14px] rounded-lg border border-solid bg-surface ' + (on ? 'border-ink [box-shadow:inset_0_0_0_1px_var(--ink)]' : 'border-line hover:border-line-2');
  const p = t.pulling;
  if (!t.ollama) {
    return (
      <Card>
        <Row label="Writing model" hint="Enhance and suggestions use a model on this Mac.">
          <Pill tone="warn"><AlertCircle size={11} /> Not running</Pill>
          <span className="text-[12.5px] text-muted">Open the Ollama app, then re-check. The plain checks still work without it.</span>
          <button className="ml-auto text-[12.5px] p-[4px_11px]" onClick={load}><RefreshCw size={12} /> Re-check</button>
        </Row>
      </Card>
    );
  }
  return (
    <>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-[10px] lte860:grid-cols-[1fr]">
        <button type="button" className={OPTION(t.tier === 'auto')} onClick={() => choose('auto')}>
          <span className="flex justify-between items-center"><b className="text-[13.5px] font-[600]">Auto</b>{t.tier === 'auto' && <Check size={14} />}</span>
          <span className="text-[12px] text-muted leading-[1.45]">Full when it is downloaded, Light otherwise.</span>
          <span className="text-[11.5px] text-accent font-[560] mt-auto pt-[4px]">Suggested</span>
        </button>
        {t.tiers.map((x) => (
          <div key={x.id} className={OPTION(t.tier === x.id)}>
            <button type="button" className="text-left [border:0] bg-transparent p-0" onClick={() => x.installed && choose(x.id)} disabled={!x.installed}>
              <span className="flex justify-between items-center"><b className="text-[13.5px] font-[600]">{x.label} <span className="font-normal text-muted text-[12px]">· {x.size}</span></b>{t.tier === x.id && <Check size={14} />}</span>
              <span className="block text-[12px] text-muted leading-[1.45] mt-[4px]">{x.good}</span>
            </button>
            <span className="mt-auto pt-[4px]">
              {x.installed
                ? <span className="text-[11.5px] text-ok font-[560]">Downloaded</span>
                : p && !p.done && p.tier === x.id
                  ? <span className="text-[11.5px] text-accent">Downloading… {p.percent}%</span>
                  : <button className="text-[12px] p-[3px_10px]" disabled={p && !p.done} onClick={() => download(x.id)}>Download {x.size}</button>}
            </span>
          </div>
        ))}
      </div>
      <p className="m-[10px_0_0] text-[12.5px] text-muted">
        {t.inUse ? <>Writing with <b className="text-ink font-[560]">{t.inUse}</b>. Nothing you write leaves this Mac.</> : 'No writing model yet — download Light to turn on Enhance.'}
        {p?.error && <span className="text-danger"> Download failed: {p.error}</span>}
      </p>
    </>
  );
}

const PROVIDER_WORDS = { included: 'Built in (offline)', ollama: 'This Mac', openai: 'ChatGPT', anthropic: 'Claude', xai: 'Grok', groq: 'Groq' };

function AiSection() {
  const { workspace, setWorkspace, mutate } = useStudio();
  const llm = workspace.llm;
  const apply = (r) => setWorkspace(r.data);
  const cloud = llm.providers.filter((p) => p.kind === 'cloud');

  return (
    <>
      <SectionHead title="Writing model" lead="The model that powers Enhance, suggestions and fixes. It runs on this Mac, so it is free and private." />
      <LocalModel />

      {/* Per-task routing is rarely changed: kept, folded away. */}
      <details className="mt-[18px] group/adv">
        <summary className="cursor-pointer select-none list-none flex items-center gap-[6px] text-[12.5px] text-muted hover:text-ink">
          <ChevronDown size={13} className="transition-transform group-open/adv:rotate-180" /> Advanced: choose a model per task
        </summary>
        <Card className="mt-[10px]">
          {llm.capabilities.map((c) => (
            <Row key={c.key} label={c.label} hint={c.detail}>
              <select className="min-w-[200px] text-[12.5px]" value={llm.routing[c.key]} disabled={!c.active}
                onChange={(e) => mutate(() => api.setLlmRouting(c.key, e.target.value), apply)}>
                {llm.providers.map((p) => <option key={p.id} value={p.id}>{PROVIDER_WORDS[p.id] ?? p.label}</option>)}
              </select>
              {!c.active && <span className="text-[11.5px] text-faint">Not used yet</span>}
            </Row>
          ))}
        </Card>
        <p className="m-[8px_0_0] text-[11.5px] text-faint">
          {cloud.length ? `${cloud.length} cloud model${cloud.length === 1 ? '' : 's'} connected.` : 'Cloud models (ChatGPT, Claude, Groq, Grok) are optional — connect one under Connections to choose it here.'}
        </p>
      </details>
    </>
  );
}

// ---------------------------------------------------------------- rendering
const MODE_COPY = {
  fixtures: { title: 'Practice', body: 'Nothing is sent to HeyGen. Renders are simulated, so you can try every step for free.', note: 'Free', tone: 'ok' },
  live_read: { title: 'Test', body: 'Reads your HeyGen account — looks, voices, credits. Renders are free and watermarked when an API key is added.', note: 'Free to read', tone: 'accent' },
  live: { title: 'Live', body: 'Real renders on your HeyGen plan, with no watermark. Every render asks before it starts.', note: 'Uses your plan', tone: 'warn' },
};

function GenerationSection({ onHeyGen, onConnections }) {
  const { workspace, setWorkspace, mutate, reload } = useStudio();
  const dialog = useDialog();
  const pm = workspace.providerMode;
  const [hg, setHg] = useState(null);
  const [providers, setProviders] = useState([]);
  const [err, setErr] = useState(null);
  const load = useCallback(async () => {
    setProviders(await api.providers().catch(() => []));
    setHg(await api.heygenStatus().catch(() => null));
  }, []);
  useEffect(() => { load(); }, [load]);
  const heygen = providers.find((p) => p.id === 'heygen');
  const connected = !!hg && (hg.mcp?.connected || hg.pocket === 'key');

  const pickMode = async (mode) => {
    setErr(null);
    if (mode === pm.mode) return;
    if (mode === 'live' && !await dialog.confirm({
      title: 'Turn on Live rendering?', confirmLabel: 'Turn on Live', tone: 'warn',
      body: hg?.pocket === 'key'
        ? 'Renders will be real and charged to your API key, up to your monthly limit. Each render still asks before it starts.'
        : 'Renders will be real and use your HeyGen plan’s credits. Each render still asks before it starts.',
    })) return;
    try {
      await mutate(() => api.setProviderMode(mode, mode === 'live'), (r) => setWorkspace(r.data));
      await load();
      await reload();
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <SectionHead title="Rendering" lead="How far the studio may go with HeyGen. You can switch at any time; nothing renders without asking." />
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-[10px] lte860:grid-cols-[1fr]" role="radiogroup" aria-label="Rendering mode">
        {pm.modes.map((m) => {
          const c = MODE_COPY[m.id] ?? { title: m.label, body: m.detail, note: '', tone: 'muted' };
          const on = pm.mode === m.id;
          return (
            <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => pickMode(m.id)}
              className={'flex flex-col gap-[6px] text-left p-[13px_14px] rounded-lg border border-solid bg-surface '
                + (on ? (m.id === 'live' ? 'border-warn [box-shadow:inset_0_0_0_1px_var(--warn)]' : 'border-ink [box-shadow:inset_0_0_0_1px_var(--ink)]') : 'border-line hover:border-line-2')}>
              <span className="flex justify-between items-center"><b className="text-[13.5px] font-[600]">{c.title}</b>{on && <Check size={14} />}</span>
              <span className="text-[12px] text-muted leading-[1.5]">{c.body}</span>
              <span className="mt-auto pt-[4px]"><Pill tone={c.tone}>{c.note}</Pill></span>
            </button>
          );
        })}
      </div>
      {err && <p className="oberr mt-[10px]"><AlertCircle size={14} /> {err}</p>}

      <Card title="HeyGen" className="mt-[18px]"
        meta={connected ? (hg.pocket === 'key' ? 'API key · pay as you go' : `Signed in${typeof hg.plan === 'string' ? ` · ${hg.plan.charAt(0).toUpperCase()}${hg.plan.slice(1)} plan` : ''}`) : 'Not connected'}
        actions={connected
          ? <button className="text-[12.5px] p-[4px_11px]" onClick={() => mutate(() => api.syncProvider('heygen'), null).then(load)}><RefreshCw size={12} /> Sync now</button>
          : <button className="primary text-[12.5px] p-[5px_12px]" onClick={onHeyGen}>Connect HeyGen</button>}>
        {connected ? (
          <Row label="From your account" hint={heygen?.lastSyncAt ? `Last synced ${new Date(`${heygen.lastSyncAt.replace(' ', 'T')}Z`).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet'}>
            <span className="text-[12.5px] text-ink-2">
              {hg.credits != null && <><b className="font-[600]">{hg.credits}</b> premium credits{hg.creditsResetAt ? ` (back ${new Date(hg.creditsResetAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})` : ''} · </>}
              Looks, voices and pictures stay up to date in Cast and HeyGen account.
            </span>
          </Row>
        ) : (
          <Row label="Not connected" hint="Sign in to use the plan you already pay for, or add an API key to pay as you go.">
            <button className="text-[12.5px] p-[4px_11px]" onClick={onConnections}>Add an API key instead</button>
          </Row>
        )}
        {hg?.pocket === 'key' && (
          <Row label="Monthly limit" hint="Pay-as-you-go renders stop before passing it.">
            <button className="text-[12.5px] p-[4px_11px]" onClick={onHeyGen}>Set or change the limit</button>
          </Row>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ storage
function StorageSection() {
  const { workspace, setWorkspace, mutate } = useStudio();
  const [path, setPath] = useState(workspace.storagePath ?? '');
  const [err, setErr] = useState(null);
  const changed = path.trim() !== (workspace.storagePath ?? '');

  const save = async () => {
    setErr(null);
    try { await mutate(() => api.saveStorage('local', path.trim()), (r) => setWorkspace(r.data)); }
    catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <SectionHead title="Storage" lead="Where finished videos and exports are saved. Changing the folder does not move videos already saved." />
      <Card>
        <Row label="Save to">
          <Pill tone="ok"><HardDrive size={11} /> This Mac</Pill>
          <span className="text-[11.5px] text-faint">Google Drive and Dropbox are coming later.</span>
        </Row>
        <Row label="Folder" hint="A folder on this Mac.">
          <input className="flex-1 min-w-[220px] text-[12.5px] font-mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Movies/AI Video Studio" />
          {changed && <button className="primary text-[12.5px] p-[5px_12px]" onClick={save}>Save</button>}
        </Row>
      </Card>
      {err && <p className="oberr mt-[10px]"><AlertCircle size={14} /> {err}</p>}
    </>
  );
}

// --------------------------------------------------------------- publishing
function PublishingSection() {
  const { meta } = useStudio();
  return (
    <>
      <SectionHead title="Publishing" lead="Where finished videos go. Artificial Funny can post directly; for the others, Finish prepares the whole package — video, captions, title, description and hashtags — and you post it." />
      <Card>
        {meta.publishTargets.map((c) => (
          <Row key={c.platform} label={c.platform} hint={c.domain ?? c.detail}>
            {c.direct
              ? <><Pill tone="accent">Posts directly</Pill><span className="text-[11.5px] text-faint">once its key is added under Connections</span></>
              : <Pill>You post it · package ready in Finish</Pill>}
          </Row>
        ))}
      </Card>
    </>
  );
}
