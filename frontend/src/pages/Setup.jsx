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

export default function Setup() {
  const [section, setSection] = useState('license');
  const { workspace } = useStudio();

  return (
    <>
      <div className="title">
        <h1>Settings</h1>
      </div>

      <div className="settings">
        <nav className="setnav">
          {SECTIONS.map((s) => {
            const I = s.icon;
            return (
              <button key={s.id} className={section === s.id ? 'sel' : ''} onClick={() => setSection(s.id)}>
                <I size={14} /> {s.label}
              </button>
            );
          })}
        </nav>

        <div className="setbody">
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

function Row({ label, hint, children }) {
  return (
    <div className="setrow">
      <div className="setlabel">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div className="setcontrol">{children}</div>
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
      <h2>License</h2>
      <p className="muted">
        One application build. The key sets what is unlocked; upgrading never reinstalls
        anything or migrates a project.
      </p>

      <Row label="Entitlement">
        <span className="bigval">{workspace.entitlement}</span>
        <code className="dim">{workspace.licenseHint ?? 'no key'}</code>
      </Row>

      <Row label="Change key" hint="Paste an upgraded key to unlock more">
        <form className="inlineform" onSubmit={submit}>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="BOTH-A1B2-C3D4" />
          <button className="primary" type="submit" disabled={!key.trim()}>Validate</button>
        </form>
      </Row>
      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}

      <Row label="Programs" hint="What this key unlocks. Not a switch — the presenter you cast says which program you are in.">
        <div className="chiprow">
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
        <div className="chiprow">
          {(workspace.program?.presenterTabs ?? []).map((t) => (
            <span key={t.id} className="chip on"><Check size={11} /> {t.label}</span>
          ))}
        </div>
      </Row>

      <Row label="A creation is called" hint="Comedy makes Bits, Content makes Videos">
        <span className="bigval">{workspace.program?.noun?.one ?? 'Project'}</span>
      </Row>

      <Row label={`Capabilities (${workspace.capabilities.length})`} hint="Granted by this key">
        <div className="capgrid">
          {workspace.capabilities.map((c) => <code key={c}>{c}</code>)}
        </div>
      </Row>
    </>
  );
}

// ----------------------------------------------------------------- planning
function AiSection() {
  const { workspace, setWorkspace, mutate } = useStudio();
  const llm = workspace.llm;
  const apply = (r) => setWorkspace(r.data);

  return (
    <>
      <h2>Model routing</h2>
      <p className="muted">
        Which model does which job. Add or remove keys under Connections; anything routed to
        a model whose key is gone falls back to the included one rather than failing.
      </p>

      {llm.capabilities.map((c) => (
        <Row key={c.key} label={c.label} hint={c.detail}>
          <select
            value={llm.routing[c.key]}
            onChange={(e) => mutate(() => api.setLlmRouting(c.key, e.target.value), apply)}
          >
            {llm.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Row>
      ))}

      {llm.providers.length === 1 && (
        <div className="notice">
          <Sparkles />
          <span>
            Only the included model is available. Connect ChatGPT, Claude, Groq or Grok under
            Connections to route work to them.
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
      <h2>Generation</h2>
      <p className="muted">
        How far provider calls may go. Reading your catalogue and spending credits are
        separate decisions, so they are separate settings.
      </p>

      <div className="modepick">
        {pm.modes.map((m) => (
          <button
            key={m.id}
            className={'modecard' + (pm.mode === m.id ? ' sel' : '') + (m.spend === 'billable' ? ' billable' : '')}
            onClick={() => pickMode(m.id)}
          >
            <span className="modetop">
              <b>{m.label}</b>
              {pm.mode === m.id && <Check size={14} />}
            </span>
            <small>{m.detail}</small>
            <em className={SPEND[m.spend]?.tone ?? 'free'}>
              {SPEND[m.spend]?.label ?? m.spend}
            </em>
          </button>
        ))}
      </div>

      <label className="confirmline">
        <input type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} />
        I understand Live mode makes real, billable generation calls.
      </label>
      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}

      <h3 className="subhead">Catalogue</h3>
      {providers.map((p) => (
        <React.Fragment key={p.id}>
          <Row label={p.label} hint={p.status === 'connected' ? 'synced from your account' : 'connect it under Connections'}>
            <span className={p.status === 'connected' ? 'okv' : 'dim'}>
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
              <div className="provline">
                <span>quota <b>{p.quotaRemaining ?? '—'}</b></span>
                {Object.entries(p.assets).map(([k, n]) => <span key={k}>{k}s <b>{n}</b></span>)}
                <span>synced <b>{p.lastSyncAt ?? 'never'}</b></span>
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
      <h2>Storage</h2>
      <p className="muted">
        Projects are addressed through a storage provider, never a raw path. Changing this
        never moves existing files silently.
      </p>

      <Row label="Location">
        <div className="choicegrid">
          {[['local', 'Local disk'], ['google_drive', 'Google Drive'], ['dropbox', 'Dropbox']].map(([v, l]) => (
            <button key={v} className={provider === v ? 'chosen' : ''} onClick={() => setProvider(v)}>{l}</button>
          ))}
        </div>
      </Row>

      {provider === 'local' && (
        <Row label="Project root">
          <div className="inlineform">
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/AI Video Studio" />
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
      <h2>Publishing</h2>
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
