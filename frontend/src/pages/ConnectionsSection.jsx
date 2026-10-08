import React, { useState } from 'react';
import { Check, AlertCircle, RefreshCw, X, HelpCircle, ExternalLink } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { useResource } from '../hooks/use-resource.js';
import LoadState from '../components/LoadState.jsx';

// Every vendor connects the same way: paste a key, it is verified against that
// vendor's own free read endpoint, stored encrypted, and reported as one of
// three states. "unchecked" is a real state, not a nicer word for connected.
const STATUS = {
  connected:    { icon: Check,       cls: 'okv',     text: 'connected' },
  unchecked:    { icon: HelpCircle,  cls: 'unknownv', text: 'stored, not checked' },
  disconnected: { icon: null,        cls: 'text-muted', text: 'not connected' },
};

// Same row anatomy as Setup's <Row>, which these rows sit alongside.
const SETROW = 'grid grid-cols-[210px_1fr] gap-[16px] items-center p-[11px_0] [border-bottom:1px_solid_var(--line)] last:[border-bottom:0] lte860:grid-cols-[1fr] lte860:gap-[6px]';
const PROV_B = 'text-ink [font-variant-numeric:tabular-nums]';
// A plan chip is green; the key chip is accent. Neither is a status colour.
const POCKETCHIP = 'not-italic text-[10.5px] bg-ok-soft border border-solid rounded-[20px] p-[2px_9px] whitespace-nowrap';

export default function ConnectionsSection() {
  const { mutate, workspace } = useStudio();
  const [editing, setEditing] = useState(null);
  const [key, setKey] = useState('');
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  const { data, error, reload: load, setData } = useResource(() => api.connections(), []);

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

  return (
    <>
      <h2 className="m-[0_0_4px]">Connections</h2>
      <p className="muted">
        Each key is checked against the service that owns it, using a free read —
        a model list or an account lookup. Nothing here can spend credits.
      </p>

      {fixtures && (
        <div className="notice warn">
          <AlertCircle />
          <span>
            Provider mode is <b>Fixtures</b>, so keys are stored but not checked — nothing
            leaves this machine. Switch to <b>Test</b> in Generation to verify them against each service.
          </span>
        </div>
      )}

      {note && <p className="text-ok flex items-center gap-[6px] text-[12.5px] mt-[9px]"><Check size={14} /> {note}</p>}
      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}

      {Object.entries(data.roles).map(([role, label]) => {
        const items = data.items.filter((i) => i.role === role);
        if (!items.length) return null;
        return (
          <React.Fragment key={role}>
            <h3 className="text-[11px] tracking-[.07em] text-faint font-[600] m-[26px_0_4px] uppercase">{label}</h3>
            {items.map((c) => {
              const st = STATUS[c.status];
              const Icon = st.icon;
              return (
                <div className={SETROW} key={c.id}>
                  <div>
                    <b className="text-[13px] font-[540] block">{c.label}</b>
                    <small className="block text-[11.5px] text-muted mt-[2px]">{c.detail}</small>
                  </div>
                  <div className="flex items-center gap-[8px] flex-wrap min-w-0">
                    <span className={st.cls + ' inline-flex items-center gap-[5px] text-[12.5px]'}>
                      {Icon && <Icon size={13} />} {st.text}
                    </span>
                    {c.hint && <code className="text-muted">{c.hint}</code>}

                    {/* HeyGen has two independent ways in. MCP is sufficient
                        for normal Live production. The API key is optional and
                        adds the free watermarked Test-render path. This used to
                        report whichever one won and hide the other. */}
                    {c.id === 'heygen' && c.pockets && (
                      <span className="inline-flex gap-[4px]">
                        <em className={POCKETCHIP + ' text-ok [border-color:#c5e3d5]' + (c.pockets.mcp.connected ? '' : ' off opacity-[.45]')}>
                          plan {c.pockets.mcp.connected ? '· signed in' : '· not signed in'}
                        </em>
                        <em className={POCKETCHIP + ' key text-accent border-accent-line' + (c.pockets.key.connected ? '' : ' off opacity-[.45]')}>
                          key {c.pockets.key.connected
                            ? (c.pockets.key.verified ? '· verified' : '· unchecked')
                            : '· none'}
                        </em>
                      </span>
                    )}
                    {c.id === 'heygen' && !c.pockets?.mcp?.connected && (
                      <HeyGenSignIn onDone={load} />
                    )}

                    {editing === c.id ? (
                      <form
                        className="flex gap-[7px] items-center flex-1 min-w-0"
                        onSubmit={(e) => { e.preventDefault(); run(() => api.connectVendor(c.id, key)); }}
                      >
                        <input className="flex-1 min-w-[150px]" type="password" value={key} autoFocus
                          onChange={(e) => setKey(e.target.value)} placeholder={`${c.label} API key`} />
                        <button className="primary" type="submit" disabled={!key.trim()}>Save</button>
                        <button type="button" onClick={() => { setEditing(null); setErr(null); }}>
                          <X size={13} />
                        </button>
                      </form>
                    ) : (
                      <>
                        {/* The optional key remains addable after MCP sign-in so
                            Test mode can be enabled without implying that Live
                            production needs both connections. */}
                        <button onClick={() => { setEditing(c.id); setKey(''); setErr(null); }}>
                          {c.id === 'heygen'
                            ? (c.pockets?.key?.connected ? 'Replace API key' : 'Add optional API key')
                            : c.connected ? 'Replace key' : 'Connect'}
                        </button>
                        {c.connected && (
                          <>
                            <button title="Ask the service again" disabled={fixtures}
                              onClick={() => run(() => api.recheckVendor(c.id))}>
                              <RefreshCw size={13} /> Re-check
                            </button>
                            <button onClick={() => run(() => api.disconnectVendor(c.id))}>Remove</button>
                          </>
                        )}
                      </>
                    )}
                  </div>

                  {c.connected && (c.quotaRemaining != null || Object.keys(c.assets).length > 0) && (
                    <>
                      <div />
                      <div className="flex gap-[16px] flex-wrap text-[12px] text-muted">
                        {c.quotaRemaining != null && <span>quota <b className={PROV_B}>{c.quotaRemaining}</b></span>}
                        {Object.entries(c.assets).map(([k, n]) => <span key={k}>{k}s <b className={PROV_B}>{n}</b></span>)}
                        {c.lastSyncAt && <span>synced <b className={PROV_B}>{c.lastSyncAt}</b></span>}
                      </div>
                    </>
                  )}

                  {c.id === 'heygen' && editing === c.id && (
                    <>
                      <div />
                      <p className="flex gap-[7px] items-start m-[4px_0_0] text-[11.5px] leading-[1.5] text-warn bg-warn-soft border border-solid border-warn-line rounded p-[9px_11px]">
                        <AlertCircle size={13} className="shrink-0 mt-[2px]" /> Optional: Test uses this key for free,
                        watermarked renders. Live may bill its separate API balance if MCP is
                        unavailable. Your MCP sign-in already covers normal Live production.
                      </p>
                    </>
                  )}

                  {c.lastError && (
                    <>
                      <div />
                      <p className="oberr"><AlertCircle size={13} /> {c.lastError}</p>
                    </>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

/**
 * HeyGen's default path: OAuth over MCP, which spends the web plan the user
 * already pays for and reaches the avatars, outfits and cloned voices that
 * account owns. The API key is the fallback, not the front door.
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
      notify('Sign in to HeyGen in the new tab, then press Re-check.', 'ok');
      setTimeout(onDone, 1500);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <button className="primary" onClick={go} disabled={busy}>
        {busy ? 'Opening…' : <><ExternalLink size={13} /> Sign in — uses your plan</>}
      </button>
      {err && <span className="oberr">{err}</span>}
    </>
  );
}
