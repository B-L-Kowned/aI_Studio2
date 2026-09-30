import React, { useState, useEffect, useCallback } from 'react';
import {
  Check, AlertCircle, Lock, RefreshCw, Trash2, KeyRound, HardDrive,
  Sparkles, Video, Share2, X, Plug,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import ConnectionsSection from './ConnectionsSection.jsx';
import HeyGen from './HeyGen.jsx';

const SECTIONS = [
  { id: 'license', label: 'License', icon: KeyRound },
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'ai', label: 'Model routing', icon: Sparkles },
  { id: 'generation', label: 'Generation', icon: Video },
  { id: 'heygen', label: 'HeyGen account', icon: Video },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'publishing', label: 'Publishing', icon: Share2 },
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
  const [section, setSection] = useState('license');
  const { workspace } = useStudio();

  return (
    <>
      <div className="title">
        <h1>Settings</h1>
      </div>

      <div className="grid grid-cols-[186px_1fr] bg-surface border border-solid border-line rounded-lg overflow-hidden min-h-[560px] lte860:grid-cols-[1fr]">
        {/* The rail is a list, not a column to be stretched: without
            align-self:start a long section made it 80,000px tall with its links
            marooned at the top. */}
        <nav className="p-[12px] bg-surface-2 [border-right:1px_solid_var(--line)] self-start sticky top-[16px] lte860:[border-right:0] lte860:[border-bottom:1px_solid_var(--line)] lte860:flex lte860:flex-wrap lte860:gap-[4px]">
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
          {section === 'generation' && <GenerationSection />}
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

      <Row label={`Capabilities (${workspace.capabilities.length})`} hint="Granted by this key">
        <div className="flex gap-[5px] flex-wrap mt-[10px]">
          {workspace.capabilities.map((c) => (
            <code key={c} className="text-[11px] bg-surface border border-solid border-line text-muted p-[4px_8px] rounded-sm">{c}</code>
          ))}
        </div>
      </Row>
    </>
  );
}

// ----------------------------------------------------------------- planning
function AiSection() {
  const { workspace, setWorkspace, mutate } = useStudio();
  const llm = workspace.llm;
  const [runtime, setRuntime] = useState(null);
  const loadRuntime = useCallback(() => api.llmStatus().then(setRuntime).catch(() => setRuntime(null)), []);
  useEffect(() => { loadRuntime(); }, [loadRuntime]);
  const apply = (r) => setWorkspace(r.data);
  const local = runtime?.ollama;

  return (
    <>
      <h2 className={H2}>Model routing</h2>
      <p className="muted">
        Which engine does which job. Built-in deterministic is the offline $0 fallback;
        Local Ollama is a real on-device model; cloud models use your connected provider account.
      </p>

      <div className={'notice ' + (local?.connected && local?.installed ? '' : 'warn')}>
        {local?.connected && local?.installed ? <Check /> : <AlertCircle />}
        <span>
          <b>Local Ollama:</b>{' '}
          {!runtime ? 'checking…' : local.connected
            ? local.installed
              ? `ready · ${local.model}`
              : `${local.issue} Run: ollama pull ${local.model}`
            : `${local.issue} Run: ollama serve`}
        </span>
        <button onClick={loadRuntime}><RefreshCw size={13} /> Re-check</button>
      </div>

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
function GenerationSection() {
  const { workspace, setWorkspace, mutate, reload } = useStudio();
  const pm = workspace.providerMode;
  const [providers, setProviders] = useState([]);
  const [confirmLive, setConfirmLive] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => setProviders(await api.providers()), []);
  useEffect(() => { load(); }, [load]);

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

      <h3 className={SUBHEAD}>Catalogue</h3>
      {providers.map((p) => (
        <React.Fragment key={p.id}>
          <Row label={p.label} hint={p.status === 'connected' ? 'synced from your account' : 'connect it under Connections'}>
            <span className={p.status === 'connected' ? 'okv' : 'text-muted'}>
              {p.status === 'connected' ? <><Check size={13} /> connected</> : 'not connected'}
            </span>
            {p.status === 'connected' && (
              <button onClick={() => mutate(() => api.syncProvider(p.id), null).then(load)}>
                <RefreshCw size={13} /> Sync now
              </button>
            )}
          </Row>
          {p.status === 'connected' && (
            <Row label="" hint="">
              <div className="flex gap-[16px] flex-wrap text-[12px] text-muted">
                <span>quota <b className="text-ink [font-variant-numeric:tabular-nums]">{p.quotaRemaining ?? '—'}</b></span>
                {Object.entries(p.assets).map(([k, n]) => <span key={k}>{k}s <b className="text-ink [font-variant-numeric:tabular-nums]">{n}</b></span>)}
                <span>synced <b className="text-ink [font-variant-numeric:tabular-nums]">{p.lastSyncAt ?? 'never'}</b></span>
              </div>
            </Row>
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
        Projects are addressed through a storage provider, never a raw path. Changing this
        never moves existing files silently.
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
        <Row label="Project root">
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
  const { workspace, setWorkspace, meta, mutate } = useStudio();
  const state = Object.fromEntries((workspace.connections ?? []).map((c) => [c.platform, c.status]));

  return (
    <>
      <h2 className={H2}>Publishing</h2>
      <p className="muted">
        All optional. Every channel supports <b>Prepare only</b>, which builds a complete
        upload package with nothing connected.
      </p>

      {meta.publishTargets.map((c) => (
        <Row key={c.platform} label={c.platform} hint={c.domain ?? c.detail}>
          {c.kind === 'owned' && <span className="owntag">Owned</span>}
          <button
            className={state[c.platform] === 'connected' ? '' : 'primary'}
            onClick={() =>
              mutate(
                () => api.setConnection(c.platform, state[c.platform] === 'connected' ? 'disconnected' : 'connected'),
                (r) => setWorkspace(r.data)
              )
            }
          >
            {state[c.platform] === 'connected' ? <><Check size={13} /> Connected</> : 'Connect'}
          </button>
        </Row>
      ))}
    </>
  );
}
