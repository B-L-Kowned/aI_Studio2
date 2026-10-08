import React, { useState } from 'react';
import { KeyRound, HardDrive, Sparkles, Share2, Check, AlertCircle, ChevronRight, Lock } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';

const STEPS = ['License', 'Storage', 'Planning AI', 'Publishing', 'Finish'];

const STEP_LI = 'flex-1 flex items-center gap-[6px] text-[11.5px] pt-[8px] ';
const STEP_STATE = {
  current: { li: 'current text-ink [border-top:2px_solid_var(--ink)] font-[540]', dot: 'bg-ink [color:#fff]' },
  done: { li: 'done text-ok [border-top:2px_solid_var(--ok)]', dot: 'bg-ok [color:#fff]' },
  todo: { li: 'text-faint [border-top:2px_solid_var(--line)]', dot: 'bg-line text-muted' },
};
const CARD_H2 = 'm-[0_0_8px] flex items-center gap-[8px] text-[16px] [&>svg]:w-[17px] [&>svg]:h-[17px] [&>svg]:text-muted';
const CARD_MUTED = 'muted mt-0';
const NEXT = 'primary mt-[20px] inline-flex items-center gap-[5px]';
const CHOICEGRID = 'grid grid-cols-[repeat(3,1fr)] gap-[7px] mt-[10px] lte800:grid-cols-[1fr]';
const choice = (chosen) =>
  'justify-center' + (chosen ? ' chosen border-ink bg-canvas font-[540] [&:hover:not(:disabled)]:bg-canvas [&:hover:not(:disabled)]:border-ink' : '');

export default function Onboarding() {
  const { workspace, setWorkspace, mutate, reload } = useStudio();
  const [step, setStep] = useState(workspace.entitlement === 'none' ? 0 : 1);

  const apply = (res) => setWorkspace(res.data);
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));

  return (
    <div className="onboarding">
      <div>
        <h1 className="mb-[3px]">Set up AI Video Studio</h1>
        <p className="text-muted mt-0 text-[13.5px]">One application. Your license decides which modes are unlocked.</p>
      </div>

      <ol className="list-none flex gap-[5px] p-0 m-[26px_0]">
        {STEPS.map((label, i) => {
          const st = STEP_STATE[i === step ? 'current' : i < step ? 'done' : 'todo'];
          return (
            <li key={label} className={STEP_LI + st.li}>
              <span className={'w-[17px] h-[17px] rounded-[50%] grid place-items-center text-[10px] ' + st.dot}>
                {i < step ? <Check size={14} /> : i + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      <div className="bg-surface border border-solid border-line rounded-lg p-[24px]">
        {step === 0 && <LicenseStep apply={apply} next={next} mutate={mutate} />}
        {step === 1 && <StorageStep apply={apply} next={next} mutate={mutate} workspace={workspace} />}
        {step === 2 && <AiStep apply={apply} next={next} mutate={mutate} workspace={workspace} />}
        {step === 3 && <PublishingStep apply={apply} next={next} mutate={mutate} workspace={workspace} />}
        {step === 4 && <FinishStep workspace={workspace} mutate={mutate} reload={reload} />}
      </div>

      {step > 0 && (
        <button className="m-[14px_auto_0] block [border:0] bg-transparent text-muted" onClick={() => setStep((s) => s - 1)}>← Back</button>
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
      <h2 className={CARD_H2}><KeyRound /> Enter your license key</h2>
      <p className={CARD_MUTED}>
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
      <div className="mt-[14px] p-[11px_13px] bg-surface-2 border border-solid border-line rounded text-[12px]">
        <b className="block mb-[7px] text-faint text-[10px] tracking-[.07em]">Demo keys</b>
        {['COMEDY-A1B2-C3D4', 'CONTENT-E5F6-G7H8', 'BOTH-9Z8Y-7X6W'].map((k) => (
          <button type="button" className="m-[0_5px_5px_0] font-mono text-[11px] p-[5px_8px]" key={k} onClick={() => setKey(k)}>{k}</button>
        ))}
      </div>
      <button className={NEXT} type="submit" disabled={!key.trim()}>
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
      <h2 className={CARD_H2}><HardDrive /> Where should projects live?</h2>
      <p className={CARD_MUTED}>
        Projects and media are addressed through a storage provider, never a raw path.
        You can change this later; files are never moved silently.
      </p>
      <div className={CHOICEGRID}>
        {[['local', 'Local disk'], ['google_drive', 'Google Drive'], ['dropbox', 'Dropbox']].map(([v, label]) => (
          <button type="button" key={v} className={choice(provider === v)} onClick={() => setProvider(v)}>
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
      <button className={NEXT} type="submit">Continue <ChevronRight size={16} /></button>
    </form>
  );
}

const PROVIDER_LABEL = {
  included: 'Built-in deterministic', openai: 'OpenAI', anthropic: 'Claude', xai: 'Grok',
};

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
      <h2 className={CARD_H2}><Sparkles /> Planning AI</h2>
      <p className={CARD_MUTED}>
        The built-in deterministic engine works offline by default. Bring your own key if you
        want cloud scripting through your account — it is tested before it is saved, encrypted
        at rest, and never displayed again. Local Ollama can be selected later under Settings.
      </p>
      <div className={CHOICEGRID}>
        {Object.entries(PROVIDER_LABEL).map(([v, label]) => (
          <button type="button" key={v} className={choice(provider === v)}
            onClick={() => { setProvider(v); setTest(null); setErr(null); }}>
            {label}
          </button>
        ))}
      </div>

      {provider !== 'included' && (
        <>
          <label className="oblabel">
            {PROVIDER_LABEL[provider]} API key
            <div className="flex gap-[7px] items-center mt-[4px]">
              <input className="obinput flex-1" type="password" value={key} placeholder="sk-…"
                onChange={(e) => { setKey(e.target.value); setTest(null); }} />
              <button type="button" onClick={runTest} disabled={!key.trim()}>Test</button>
            </div>
          </label>
          {test && <p className="text-ok flex items-center gap-[6px] text-[12.5px] mt-[9px]"><Check size={15} /> {test}</p>}
        </>
      )}

      {workspace.credentials?.length > 0 && (
        <div className="mt-[12px] flex gap-[8px] flex-wrap">
          {workspace.credentials.map((c) => (
            <span key={c.provider} className="flex items-center gap-[5px] text-[11.5px] bg-canvas border border-solid border-line text-muted p-[5px_9px] rounded-sm font-mono"><Lock size={12} /> {PROVIDER_LABEL[c.provider]} {c.hint}</span>
          ))}
        </div>
      )}

      {err && <p className="oberr"><AlertCircle size={15} /> {err}</p>}
      <button className={NEXT} type="submit">Continue <ChevronRight size={16} /></button>
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
      <h2 className={CARD_H2}><Share2 /> Publishing connections</h2>
      <p className={CARD_MUTED}>
        Entirely optional. Every platform still supports <b>Prepare only</b>, which builds a
        complete upload package even with nothing connected.
      </p>
      <div className="grid grid-cols-[1fr_1fr] gap-[7px] m-[12px_0] lte800:grid-cols-[1fr]">
        {platforms.map((p) => (
          <button key={p} className="flex justify-between items-center" onClick={() => toggle(p)}>
            {p}
            <span className="text-muted text-[12px] flex items-center gap-[4px]">{state[p] === 'connected' ? <><Check size={14} /> Connected</> : 'Connect'}</span>
          </button>
        ))}
      </div>
      <button className={NEXT} onClick={next}>Continue <ChevronRight size={16} /></button>
      <button className="ml-[9px] [border:0] bg-transparent text-muted underline" onClick={next}>Skip — I will connect later</button>
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
      <h2 className={CARD_H2}><Check /> Ready</h2>
      <p className={CARD_MUTED}>Everything below can be changed later from Setup.</p>
      <div className="m-[16px_0]">
        {rows.map(([label, value, ok]) => (
          <div key={label} className="flex justify-between p-[9px_0] [border-bottom:1px_solid_var(--line)] text-[13px] last:[border-bottom:0]">
            <span className="text-muted">{label}</span>
            <b className={'font-[540]' + (ok ? '' : ' missing text-danger')}>{value}</b>
          </div>
        ))}
      </div>
      <div className="notice">
        <Lock /> Dry Run is on. Nothing in this application will spend generation credits until
        you explicitly turn it off and confirm a paid render.
      </div>
      {err && <p className="oberr"><AlertCircle size={15} /> {err}</p>}
      <button className={NEXT} onClick={finish}>Open the studio <ChevronRight size={16} /></button>
    </div>
  );
}
