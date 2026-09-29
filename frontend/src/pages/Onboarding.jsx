import React, { useState } from 'react';
import { KeyRound, HardDrive, Sparkles, Share2, Check, AlertCircle, ChevronRight, Lock } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';

const STEPS = ['License', 'Storage', 'Planning AI', 'Publishing', 'Finish'];

export default function Onboarding() {
  const { workspace, setWorkspace, mutate, reload } = useStudio();
  const [step, setStep] = useState(workspace.entitlement === 'none' ? 0 : 1);

  const apply = (res) => setWorkspace(res.data);
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));

  return (
    <div className="onboarding">
      <div className="obhead">
        <h1>Set up AI Video Studio</h1>
        <p>One application. Your license decides which modes are unlocked.</p>
      </div>

      <ol className="obsteps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <span>{i < step ? <Check size={14} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="obcard">
        {step === 0 && <LicenseStep apply={apply} next={next} mutate={mutate} />}
        {step === 1 && <StorageStep apply={apply} next={next} mutate={mutate} workspace={workspace} />}
        {step === 2 && <AiStep apply={apply} next={next} mutate={mutate} workspace={workspace} />}
        {step === 3 && <PublishingStep apply={apply} next={next} mutate={mutate} workspace={workspace} />}
        {step === 4 && <FinishStep workspace={workspace} mutate={mutate} reload={reload} />}
      </div>

      {step > 0 && (
        <button className="obback" onClick={() => setStep((s) => s - 1)}>← Back</button>
      )}
    </div>
  );
}

function LicenseStep({ apply, next, mutate }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await mutate(() => api.submitLicense(key), apply, { silent: true });
      next();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <form onSubmit={submit}>
      <h2><KeyRound /> Enter your license key</h2>
      <p className="muted">
        The Comedy, Content and Studio pages all download this same application. Your key
        decides what is unlocked — upgrading later never needs a reinstall.
      </p>
      <input
        className="obinput"
        placeholder="BOTH-A1B2-C3D4"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoFocus
      />
      {err && <p className="oberr"><AlertCircle size={15} /> {err}</p>}
      <div className="obdemo">
        <b>Demo keys</b>
        {['COMEDY-A1B2-C3D4', 'CONTENT-E5F6-G7H8', 'BOTH-9Z8Y-7X6W'].map((k) => (
          <button type="button" key={k} onClick={() => setKey(k)}>{k}</button>
        ))}
      </div>
      <button className="primary obnext" type="submit" disabled={!key.trim()}>
        Validate key <ChevronRight size={16} />
      </button>
    </form>
  );
}

function StorageStep({ apply, next, mutate, workspace }) {
  const [provider, setProvider] = useState(workspace.storageProvider ?? 'local');
  const [path, setPath] = useState(workspace.storagePath ?? '~/AI Video Studio');
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await mutate(() => api.saveStorage(provider, path), apply, { silent: true });
      next();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <form onSubmit={submit}>
      <h2><HardDrive /> Where should projects live?</h2>
      <p className="muted">
        Projects and media are addressed through a storage provider, never a raw path.
        You can change this later; files are never moved silently.
      </p>
      <div className="choicegrid">
        {[['local', 'Local disk'], ['google_drive', 'Google Drive'], ['dropbox', 'Dropbox']].map(([v, label]) => (
          <button type="button" key={v} className={provider === v ? 'chosen' : ''} onClick={() => setProvider(v)}>
            {label}
          </button>
        ))}
      </div>
      {provider === 'local' && (
        <label className="oblabel">
          Project root
          <input className="obinput" value={path} onChange={(e) => setPath(e.target.value)} />
        </label>
      )}
      {err && <p className="oberr"><AlertCircle size={15} /> {err}</p>}
      <button className="primary obnext" type="submit">Continue <ChevronRight size={16} /></button>
    </form>
  );
}

const PROVIDER_LABEL = { included: 'Included LLM', openai: 'OpenAI', anthropic: 'Claude', xai: 'Grok' };

function AiStep({ apply, next, mutate, workspace }) {
  const [provider, setProvider] = useState(workspace.llmProvider ?? 'included');
  const [key, setKey] = useState('');
  const [test, setTest] = useState(null);
  const [err, setErr] = useState(null);

  const runTest = async () => {
    setTest(null);
    setErr(null);
    try {
      const res = await api.testAiKey(provider, key);
      setTest(res.message);
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await mutate(() => api.saveAi(provider, key), apply, { silent: true });
      next();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <form onSubmit={submit}>
      <h2><Sparkles /> Planning AI</h2>
      <p className="muted">
        The included model handles planning by default. Bring your own key if you would rather
        route planning through your own account — it is tested before it is saved, encrypted at
        rest, and never displayed again.
      </p>
      <div className="choicegrid">
        {Object.entries(PROVIDER_LABEL).map(([v, label]) => (
          <button type="button" key={v} className={provider === v ? 'chosen' : ''}
            onClick={() => { setProvider(v); setTest(null); setErr(null); }}>
            {label}
          </button>
        ))}
      </div>

      {provider !== 'included' && (
        <>
          <label className="oblabel">
            {PROVIDER_LABEL[provider]} API key
            <div className="keyrow">
              <input className="obinput" type="password" value={key} placeholder="sk-…"
                onChange={(e) => { setKey(e.target.value); setTest(null); }} />
              <button type="button" onClick={runTest} disabled={!key.trim()}>Test</button>
            </div>
          </label>
          {test && <p className="obok"><Check size={15} /> {test}</p>}
        </>
      )}

      {workspace.credentials?.length > 0 && (
        <div className="obcreds">
          {workspace.credentials.map((c) => (
            <span key={c.provider}><Lock size={12} /> {PROVIDER_LABEL[c.provider]} {c.hint}</span>
          ))}
        </div>
      )}

      {err && <p className="oberr"><AlertCircle size={15} /> {err}</p>}
      <button className="primary obnext" type="submit">Continue <ChevronRight size={16} /></button>
    </form>
  );
}

function PublishingStep({ apply, next, mutate, workspace }) {
  const platforms = ['YouTube', 'LinkedIn', 'TikTok', 'Instagram', 'Facebook', 'X'];
  const state = Object.fromEntries((workspace.connections ?? []).map((c) => [c.platform, c.status]));

  const toggle = (platform) =>
    mutate(
      () => api.setConnection(platform, state[platform] === 'connected' ? 'disconnected' : 'connected'),
      apply,
      { silent: true }
    );

  return (
    <div>
      <h2><Share2 /> Publishing connections</h2>
      <p className="muted">
        Entirely optional. Every platform still supports <b>Prepare only</b>, which builds a
        complete upload package even with nothing connected.
      </p>
      <div className="platforms">
        {platforms.map((p) => (
          <button key={p} onClick={() => toggle(p)}>
            {p}
            <span>{state[p] === 'connected' ? <><Check size={14} /> Connected</> : 'Connect'}</span>
          </button>
        ))}
      </div>
      <button className="primary obnext" onClick={next}>Continue <ChevronRight size={16} /></button>
      <button className="obskip" onClick={next}>Skip — I will connect later</button>
    </div>
  );
}

function FinishStep({ workspace, mutate, reload }) {
  const [err, setErr] = useState(null);

  const finish = async () => {
    setErr(null);
    try {
      await mutate(() => api.completeOnboarding(), null, { silent: true });
      await reload();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const rows = [
    ['Entitlement', workspace.entitlement, true],
    ['License', workspace.licenseHint ?? '—', !!workspace.licenseHint],
    ['Storage', workspace.storageProvider ?? 'not set', !!workspace.storageProvider],
    ['Planning AI', PROVIDER_LABEL[workspace.llmProvider] ?? '—', true],
    [
      'Connections',
      `${(workspace.connections ?? []).filter((c) => c.status === 'connected').length} connected`,
      true,
    ],
  ];

  return (
    <div>
      <h2><Check /> Ready</h2>
      <p className="muted">Everything below can be changed later from Setup.</p>
      <div className="obsummary">
        {rows.map(([label, value, ok]) => (
          <div key={label}>
            <span>{label}</span>
            <b className={ok ? '' : 'missing'}>{value}</b>
          </div>
        ))}
      </div>
      <div className="notice">
        <Lock /> Dry Run is on. Nothing in this application will spend generation credits until
        you explicitly turn it off and confirm a paid render.
      </div>
      {err && <p className="oberr"><AlertCircle size={15} /> {err}</p>}
      <button className="primary obnext" onClick={finish}>Open the studio <ChevronRight size={16} /></button>
    </div>
  );
}
