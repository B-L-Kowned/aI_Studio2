import React, { useState, useEffect, useCallback } from 'react';
import { Check, AlertCircle, RefreshCw, X, HelpCircle, ExternalLink } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';

// Every vendor connects the same way: paste a key, it is verified against that
// vendor's own free read endpoint, stored encrypted, and reported as one of
// three states. "unchecked" is a real state, not a nicer word for connected.
const STATUS = {
  connected:    { icon: Check,       cls: 'okv',     text: 'connected' },
  unchecked:    { icon: HelpCircle,  cls: 'unknownv', text: 'stored, not checked' },
  disconnected: { icon: null,        cls: 'dim',     text: 'not connected' },
};

export default function ConnectionsSection() {
  const { mutate, workspace } = useStudio();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [key, setKey] = useState('');
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => setData(await api.connections()), []);
  useEffect(() => { load(); }, [load]);

  if (!data) return <p className="muted">Loading…</p>;

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
      <h2>Connections</h2>
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

      {note && <p className="obok"><Check size={14} /> {note}</p>}
      {err && <p className="oberr"><AlertCircle size={14} /> {err}</p>}

      {Object.entries(data.roles).map(([role, label]) => {
        const items = data.items.filter((i) => i.role === role);
        if (!items.length) return null;
        return (
          <React.Fragment key={role}>
            <h3 className="subhead">{label}</h3>
            {items.map((c) => {
              const st = STATUS[c.status];
              const Icon = st.icon;
              return (
                <div className="setrow" key={c.id}>
                  <div className="setlabel">
                    <b>{c.label}</b>
                    <small>{c.detail}</small>
                  </div>
                  <div className="setcontrol">
                    <span className={st.cls + ' statusv'}>
                      {Icon && <Icon size={13} />} {st.text}
                    </span>
                    {c.hint && <code className="dim">{c.hint}</code>}

                    {/* HeyGen has TWO pockets and they are not alternatives.
                        The plan (MCP) renders on your subscription and has no
                        test mode — its only render is a real one. The API key
                        renders watermarked test videos for free. Having both
                        is what lets you prove a production end to end without
                        spending, then render it for real. This used to report
                        whichever one won and hide the other. */}
                    {c.id === 'heygen' && c.pockets && (
                      <span className="pockets">
                        <em className={'pocketchip' + (c.pockets.mcp.connected ? '' : ' off')}>
                          plan {c.pockets.mcp.connected ? '· signed in' : '· not signed in'}
                        </em>
                        <em className={'pocketchip key' + (c.pockets.key.connected ? '' : ' off')}>
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
                        className="inlineform"
                        onSubmit={(e) => { e.preventDefault(); run(() => api.connectVendor(c.id, key)); }}
                      >
                        <input type="password" value={key} autoFocus
                          onChange={(e) => setKey(e.target.value)} placeholder={`${c.label} API key`} />
                        <button className="primary" type="submit" disabled={!key.trim()}>Save</button>
                        <button type="button" onClick={() => { setEditing(null); setErr(null); }}>
                          <X size={13} />
                        </button>
                      </form>
                    ) : (
                      <>
                        {/* Always offered for HeyGen, signed in or not. It was
                            hidden whenever MCP was connected, so the free test
                            render path could not be reached at all — and the
                            label said "instead", which is the wrong idea. */}
                        <button onClick={() => { setEditing(c.id); setKey(''); setErr(null); }}>
                          {c.id === 'heygen'
                            ? (c.pockets?.key?.connected ? 'Replace API key' : 'Add an API key')
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
                      <div className="provline">
                        {c.quotaRemaining != null && <span>quota <b>{c.quotaRemaining}</b></span>}
                        {Object.entries(c.assets).map(([k, n]) => <span key={k}>{k}s <b>{n}</b></span>)}
                        {c.lastSyncAt && <span>synced <b>{c.lastSyncAt}</b></span>}
                      </div>
                    </>
                  )}

                  {c.id === 'heygen' && editing === c.id && (
                    <>
                      <div />
                      <p className="keywarn">
                        <AlertCircle size={13} /> An API key is billed against a separate
                        pay-as-you-go balance. Your HeyGen web subscription funds none of it,
                        so this charges a second time for capacity you already own. Sign in
                        instead unless you specifically need un-watermarked or high-volume work.
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
