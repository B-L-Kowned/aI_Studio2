import React, { useState } from 'react';
import { Check, AlertCircle, RefreshCw, HelpCircle, ExternalLink, ChevronDown } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { useResource } from '../hooks/use-resource.js';
import LoadState from '../components/LoadState.jsx';
import { SectionHead, Card, Row, Pill } from '../components/SettingsUI.jsx';

// Every vendor connects the same way: paste a key, it is verified against that
// vendor's own free read endpoint, stored encrypted, and reported as one of
// three states. "unchecked" is a real state, not a nicer word for connected.
const STATUS = {
  connected:    { tone: 'ok',    icon: Check,      text: 'Connected' },
  unchecked:    { tone: 'accent', icon: HelpCircle, text: 'Saved, not checked yet' },
  disconnected: { tone: 'muted', icon: null,       text: 'Not connected' },
};

// The order a customer needs them in: HeyGen makes the videos; the rest are optional.
const ROLE_ORDER = ['video', 'voice', 'publish', 'llm'];
const ROLE_TITLE = { video: 'Video', voice: 'Voice', publish: 'Publishing', llm: 'Cloud writing models' };
const ROLE_META = {
  video: 'how your avatar videos are made',
  voice: 'optional — your own voice on this Mac is free',
  publish: 'post straight to your own site',
  llm: 'optional — the writing model on this Mac covers Enhance',
};

export default function ConnectionsSection() {
  const { mutate, workspace } = useStudio();
  const [editing, setEditing] = useState(null);
  const [key, setKey] = useState('');
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  const { data, error, reload: load } = useResource(() => api.connections(), []);
  if (!data) return <LoadState error={error} retry={load} />;
  const fixtures = workspace.providerMode?.mode === 'fixtures';

  const run = async (fn) => {
    setErr(null); setNote(null);
    try {
      const res = await fn();
      setNote(res?.message ?? null);
      setEditing(null); setKey('');
      await load();
    } catch (ex) { setErr(ex.message); }
  };

  const vendorRow = (c) => {
    const st = STATUS[c.status] ?? STATUS.disconnected;
    const Icon = st.icon;
    const isHeygen = c.id === 'heygen';
    return (
      <React.Fragment key={c.id}>
        <Row label={c.label} hint={c.detail}>
          {isHeygen && c.pockets ? (
            <>
              <Pill tone={c.pockets.mcp.connected ? 'ok' : 'muted'}>{c.pockets.mcp.connected && <Check size={11} />} Plan · {c.pockets.mcp.connected ? 'signed in' : 'not signed in'}</Pill>
              <Pill tone={c.pockets.key.connected ? 'accent' : 'muted'}>API key · {c.pockets.key.connected ? (c.pockets.key.verified ? 'checked' : 'saved') : 'none'}</Pill>
            </>
          ) : (
            <Pill tone={st.tone}>{Icon && <Icon size={11} />} {st.text}</Pill>
          )}
          {c.hint && !isHeygen && <code className="text-[11.5px] text-muted">{c.hint}</code>}
          <span className="ml-auto flex flex-wrap gap-[6px]">
            {isHeygen && !c.pockets?.mcp?.connected && <HeyGenSignIn onDone={load} />}
            {editing !== c.id && (
              <button className="text-[12.5px] p-[4px_11px]" onClick={() => { setEditing(c.id); setKey(''); setErr(null); }}>
                {isHeygen ? (c.pockets?.key?.connected ? 'Replace API key' : 'Add API key') : c.connected ? 'Replace key' : 'Add key'}
              </button>
            )}
            {c.connected && editing !== c.id && (
              <>
                <button className="text-[12.5px] p-[4px_10px]" title="Ask the service again" disabled={fixtures} onClick={() => run(() => api.recheckVendor(c.id))}><RefreshCw size={12} /> Check</button>
                <button className="text-[12.5px] p-[4px_10px] text-danger" onClick={() => run(() => api.disconnectVendor(c.id))}>Remove</button>
              </>
            )}
          </span>
        </Row>
        {editing === c.id && (
          <Row label="" hint="">
            <form className="flex gap-[7px] items-center flex-1 min-w-0" onSubmit={(e) => { e.preventDefault(); run(() => api.connectVendor(c.id, key)); }}>
              <input className="flex-1 min-w-[180px] text-[12.5px]" type="password" value={key} autoFocus onChange={(e) => setKey(e.target.value)} placeholder={`${c.label} API key`} />
              <button type="button" onClick={() => { setEditing(null); setErr(null); }}>Cancel</button>
              <button className="primary" type="submit" disabled={!key.trim()}>Save key</button>
            </form>
            {isHeygen && (
              <span className="basis-full text-[11.5px] text-muted leading-[1.5]">
                Optional. A key adds free, watermarked test renders and pay-as-you-go renders (covered by your monthly limit). Signing in already covers renders on your plan.
              </span>
            )}
          </Row>
        )}
        {c.lastError && <Row label="" hint=""><p className="oberr m-0"><AlertCircle size={13} /> {c.lastError}</p></Row>}
      </React.Fragment>
    );
  };

  return (
    <>
      <SectionHead title="Connections" lead="Accounts the studio can use. Each key is checked with a free read — an account lookup or a model list — and stored encrypted on this Mac. Nothing here can spend money." />
      {fixtures && (
        <p className="m-[0_0_12px] p-[9px_12px] rounded-md bg-surface-2 text-[12.5px] text-muted">
          Keys you add now are saved but not checked, because Rendering is set to Practice. They are checked when you switch to Test or Live.
        </p>
      )}
      {note && <p className="text-ok flex items-center gap-[6px] text-[12.5px] m-[0_0_10px]"><Check size={14} /> {note}</p>}
      {err && <p className="oberr m-[0_0_10px]"><AlertCircle size={14} /> {err}</p>}

      {ROLE_ORDER.filter((role) => data.items.some((i) => i.role === role)).map((role) => {
        const items = data.items.filter((i) => i.role === role);
        const card = <Card key={role} title={ROLE_TITLE[role] ?? data.roles[role]} meta={ROLE_META[role]}>{items.map(vendorRow)}</Card>;
        if (role !== 'llm') return card;
        // Optional and rarely needed: folded until wanted, unless one is already connected.
        return (
          <details key={role} className="mt-[14px] group/llm" open={items.some((i) => i.connected)}>
            <summary className="cursor-pointer select-none list-none flex items-center gap-[6px] text-[12.5px] text-muted hover:text-ink mb-[10px]">
              <ChevronDown size={13} className="transition-transform group-open/llm:rotate-180" /> Cloud writing models (optional): ChatGPT, Claude, Groq, Grok
            </summary>
            {card}
          </details>
        );
      })}
    </>
  );
}

/**
 * HeyGen's default path: sign-in over MCP, which spends the web plan the user
 * already pays for and reaches the avatars, outfits and cloned voices that
 * account owns. The API key is the alternative, not the front door.
 */
function HeyGenSignIn({ onDone }) {
  const { notify } = useStudio();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.heygenConnect();
      window.open(res.data.url, '_blank', 'noopener');
      notify('Sign in to HeyGen in the new tab, then come back here.', 'ok');
      setTimeout(onDone, 1500);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  return (
    <>
      <button className="primary text-[12.5px] p-[5px_12px]" onClick={go} disabled={busy}>
        {busy ? 'Opening…' : <><ExternalLink size={12} /> Sign in to HeyGen</>}
      </button>
      {err && <span className="oberr">{err}</span>}
    </>
  );
}
