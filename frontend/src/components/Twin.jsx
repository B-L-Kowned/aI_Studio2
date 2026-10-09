import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, ExternalLink, Upload, UserRound } from 'lucide-react';
import { Modal, useDialog } from './Dialog.jsx';
import { api } from '../services/api.js';
import { useStudio } from '../context/studio-context.jsx';

const CARD = (on) => 'text-left p-[10px_12px] rounded-lg border border-solid ' + (on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-2');
const NOTE = 'm-[10px_0_0] text-[11.5px] text-faint leading-[1.5]';

export function useAccount() {
  const [account, setAccount] = useState(null);
  const reload = () => api.account().then(setAccount).catch(() => setAccount(null));
  useEffect(() => { reload(); }, []);
  return [account, reload];
}

/**
 * The AuthenTech account, explained before it is asked for. Nothing in the
 * studio needs it; it is what makes sharing a twin consented and revocable.
 */
export function AccountDialog({ account, onClose, onChanged }) {
  const { mutate } = useStudio();
  const [waiting, setWaiting] = useState(false);
  const poll = useRef(null);
  useEffect(() => () => clearInterval(poll.current), []);
  const open = async (createAccount) => {
    const r = await mutate(() => api.accountSignIn(createAccount), null).catch(() => null);
    if (!r) return;
    window.open(r.data.url, '_blank', 'noopener');
    setWaiting(true);
    // The browser comes back to this computer; watch for the account to appear.
    clearInterval(poll.current);
    let tries = 0;
    poll.current = setInterval(async () => {
      tries += 1;
      const a = await api.account().catch(() => null);
      if (a?.signedIn || tries > 120) { clearInterval(poll.current); setWaiting(false); onChanged?.(); }
    }, 2500);
  };
  if (account?.signedIn) {
    return (
      <Modal title="Your AuthenTech account" onClose={onClose}
        footer={<>
          <button onClick={async () => { await mutate(() => api.accountSignOut(), null).catch(() => {}); onChanged?.(); onClose(); }}>Sign out</button>
          <button className="primary" onClick={onClose}>Done</button>
        </>}>
        <p className="m-0 flex items-center gap-[8px]"><Check size={15} className="text-ok" /> Signed in{account.profile?.name ? ` as ${account.profile.name}` : ''}{account.profile?.email ? ` · ${account.profile.email}` : ''}</p>
        <p className={NOTE}>You can share your twins from Cast → You, and add twins people share with you under Presenters. Every share carries their consent, and either side can withdraw it.</p>
      </Modal>
    );
  }
  return (
    <Modal title="Share your twin, with consent" width={480} onClose={onClose}
      footer={<>
        <button onClick={onClose}>Not now</button>
        <button disabled={!account?.available || waiting} onClick={() => open(true)}>Create account</button>
        <button className="primary" disabled={!account?.available || waiting} onClick={() => open(false)}>{waiting ? 'Waiting for the browser…' : 'Sign in with AuthenTech'}</button>
      </>}>
      <p className="m-0 text-[13px] leading-[1.55]">Everything in the studio works without an account. An AuthenTech account is for one thing: letting someone use your twin — your look, voice and personality — or using theirs, with consent either of you can prove and withdraw.</p>
      <ul className="m-[10px_0_0] p-[0_0_0_18px] text-[12.5px] text-muted leading-[1.6]">
        <li>Your samples are never stored at AuthenTech — only the permission.</li>
        <li>Your HeyGen key and limit stay on this computer.</li>
      </ul>
      {!account?.available && (
        <p className="m-[12px_0_0] p-[8px_11px] rounded-md bg-surface-2 text-[12px] text-muted">Sign-in with AuthenTech is on its way. Until then you can still share a twin by downloading its card from Cast → You.</p>
      )}
    </Modal>
  );
}

/** A quiet entry in the header: the account, if you have one; an offer, if not. */
export function AccountChip() {
  const [account, reload] = useAccount();
  const [open, setOpen] = useState(false);
  if (!account) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-[6px] [border:0] bg-transparent p-[4px_6px] rounded-sm text-[11.5px] text-faint hover:bg-canvas hover:text-muted"
        title={account.signedIn ? 'Your AuthenTech account' : 'Optional: sign in to share twins with consent'}>
        <UserRound size={13} />
        <span>{account.signedIn ? (account.profile?.name ?? 'Signed in') : 'Sign in'}</span>
      </button>
      {open && <AccountDialog account={account} onClose={() => setOpen(false)} onChanged={reload} />}
    </>
  );
}

const HOW = [
  ['source', 'They make videos with it', 'They build your twin in their own HeyGen from the source you share, and render on their account. You see each video they make with it.'],
  ['render', 'They ask, you render', 'They send you scripts; you approve and render them on your HeyGen, within your monthly limit. Nothing of yours leaves this computer.'],
];
const PARTS = [['appearance', 'Look'], ['voice', 'Voice'], ['personality', 'Personality']];
const HOW_LONG = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['', 'Until I end it']];

/**
 * Share one of your personas. Three plain choices — how they use it, what of
 * it, for how long — then either send it through AuthenTech or, until that is
 * available, download its card to send yourself.
 */
export function ShareTwinDialog({ presenter, onClose }) {
  const [account, reload] = useAccount();
  const [signIn, setSignIn] = useState(false);
  const { mutate } = useStudio();
  const [f, setF] = useState({ name: '', email: '', how: 'source', parts: ['appearance', 'voice', 'personality'], days: '7' });
  const [shared, setShared] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const poll = useRef(null);
  useEffect(() => () => clearInterval(poll.current), []);
  // Record the share here, confirm it on AuthenTech's own screen, then the
  // package (downloaded after) carries AuthenTech's proof and their accept link.
  const sendWithConsent = async () => {
    const g = shared ?? (await mutate(() => api.shareTwin({ presenterId: presenter.id, counterpart: f.name.trim(), email: f.email.trim(),
      scopes: f.parts, mode: f.how, days: f.days ? Number(f.days) : null }), null).catch(() => null))?.data;
    if (!g) return;
    setShared(g);
    const r = await mutate(() => api.startAuthentechShare(g.id), null).catch(() => null);
    if (!r) return;
    window.open(r.data.url, '_blank', 'noopener');
    setConfirming(true);
    let tries = 0;
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      tries += 1;
      const list = await api.grants().catch(() => null);
      const mine = list?.out.find((x) => x.id === g.id);
      if (mine?.authentech?.verified || tries > 120) {
        clearInterval(poll.current); setConfirming(false);
        if (mine?.authentech?.verified) setConfirmed(mine);
      }
    }, 2500);
  };
  const toggle = (p) => setF((x) => ({ ...x, parts: x.parts.includes(p) ? x.parts.filter((y) => y !== p) : [...x.parts, p] }));
  // Downloading is sharing: the share is recorded first, with its end date,
  // and the card carries it, so it ends on both sides at the same moment.
  const download = async () => {
    const g = await mutate(() => api.shareTwin({ presenterId: presenter.id, counterpart: f.name.trim(), email: f.email.trim() || null,
      scopes: f.parts, mode: f.how, days: f.days ? Number(f.days) : null }), null).catch(() => null);
    if (!g) return;
    setShared(g.data);
    // The package: the card plus a picture of each look and the voice sample,
    // each fingerprinted — what the other person's app rebuilds the twin from.
    const a = document.createElement('a');
    a.href = `/api/presenters/${presenter.id}/twin-package?grant=${g.data.id}`;
    a.download = '';
    a.click();
  };
  if (signIn) return <AccountDialog account={account} onClose={() => setSignIn(false)} onChanged={reload} />;
  const canSend = account?.signedIn && account.canShare;
  return (
    <Modal title={`Share ${presenter.name}`} width={560} onClose={onClose}
      footer={<>
        <button onClick={onClose}>Cancel</button>
        <button disabled={!f.parts.length || !f.name.trim()} onClick={download} title={f.name.trim() ? 'One file: the card, a picture of each look and the voice sample — send it to them yourself' : 'Say who it is for first'}><Download size={13} /> Download twin package</button>
        <button className="primary" disabled={!f.parts.length || !f.email.trim() || !f.name.trim() || confirming}
          onClick={() => (canSend ? sendWithConsent() : setSignIn(true))}
          title={canSend ? 'You confirm on AuthenTech; then the package carries the proof and their link to accept' : 'Sharing with consent uses an AuthenTech account'}>
          {confirming ? 'Waiting for AuthenTech…' : 'Send with consent…'}
        </button>
      </>}>
      <div className="grid grid-cols-[1fr_1fr] gap-[10px] lte620:grid-cols-[1fr]">
        <label className="flex flex-col gap-[4px] text-[11.5px] font-semibold text-muted">Who it is for
          <input className="font-normal text-[13.5px] text-ink" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Christine Doe" />
        </label>
        <label className="flex flex-col gap-[4px] text-[11.5px] font-semibold text-muted">Their email
          <input className="font-normal text-[13.5px] text-ink" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@example.com" />
        </label>
      </div>
      <p className="m-[14px_0_6px] text-[11.5px] font-semibold text-muted">How they use it</p>
      <div className="grid grid-cols-[1fr_1fr] gap-[8px] lte620:grid-cols-[1fr]">
        {HOW.map(([v, l, d]) => (
          <button key={v} type="button" className={CARD(f.how === v)} onClick={() => setF({ ...f, how: v })}>
            <b className="block text-[13px] font-[600] text-ink">{l}</b><span className="block text-[11.5px] text-muted leading-[1.45] mt-[2px]">{d}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-[18px] mt-[14px]">
        <div>
          <p className="m-[0_0_6px] text-[11.5px] font-semibold text-muted">What of it</p>
          <div className="flex gap-[6px]">
            {PARTS.map(([v, l]) => (
              <button key={v} type="button" onClick={() => toggle(v)} aria-pressed={f.parts.includes(v)}
                className={'text-[12.5px] p-[4px_11px] rounded-full border border-solid ' + (f.parts.includes(v) ? 'bg-ink text-white border-ink' : 'bg-surface text-ink-2 border-line')}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="m-[0_0_6px] text-[11.5px] font-semibold text-muted">For how long</p>
          <div className="flex gap-[6px]">
            {HOW_LONG.map(([v, l]) => (
              <button key={l} type="button" onClick={() => setF({ ...f, days: v })}
                className={'text-[12.5px] p-[4px_11px] rounded-full border border-solid ' + (f.days === v ? 'bg-ink text-white border-ink' : 'bg-surface text-ink-2 border-line')}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      {confirmed && (
        <p className="m-[12px_0_0] p-[8px_11px] rounded-md bg-ok-soft text-ok text-[12.5px]">
          <Check size={13} className="inline -mt-[2px]" /> Confirmed on AuthenTech. Now download the twin package and send it to {confirmed.counterpart} — it carries the proof and their link to accept.
        </p>
      )}
      {shared && !confirmed && (
        <p className="m-[12px_0_0] p-[8px_11px] rounded-md bg-ok-soft text-ok text-[12.5px]">
          Shared with {shared.counterpart} {shared.endsAt ? `until ${new Date(shared.endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'until you end it'}. Send them the card; you can extend or end it under Cast → Sharing.
        </p>
      )}
      <p className={NOTE}>
        {canSend
          ? 'You confirm the share on AuthenTech, and they accept it there. You can withdraw it at any time; videos already published stay published, and a copy they downloaded cannot be recalled.'
          : 'The twin package works now: one file with the card, a picture of each look and the voice sample, each fingerprinted. Send it to them yourself; their app rebuilds the twin on their side and it ends on the date you chose. Sending through AuthenTech adds proof of consent once it is live.'}
      </p>
    </Modal>
  );
}

/** Add a twin someone shared: see what it brings and what is still needed, then add it. */
export function ImportTwinDialog({ onClose, onAdded }) {
  const { mutate } = useStudio();
  const dialog = useDialog();
  const [file, setFile] = useState(null);
  const [card, setCard] = useState(null);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(null);
  const [made, setMade] = useState({});
  const pick = async (f) => {
    setErr(null); setPreview(null); setCard(null); setFile(null);
    try {
      const head = new Uint8Array(await f.slice(0, 2).arrayBuffer());
      if (head[0] === 0x50 && head[1] === 0x4b) { setFile(f); setPreview({ name: f.name.replace(/\.twin$/, ''), packaged: true }); return; }
      const c = JSON.parse(await f.text());
      setCard(c);
      setPreview(await api.previewTwinCard(c));
    } catch (e) { setErr(e instanceof SyntaxError ? 'That file is not a twin package.' : e.message); }
  };
  const add = async () => {
    const r = await mutate(() => (file ? api.importTwinPackage(file) : api.importTwinCard(card)), null).catch(() => null);
    if (r) { setDone(r.data); onAdded?.(); }
  };
  const voice = async () => {
    setBusy('voice');
    const r = await mutate(() => api.makeTwinVoice(done.presenterId), null).catch(() => null);
    setBusy(null); if (r) setMade((m) => ({ ...m, voice: true }));
  };
  const look = async () => {
    if (!await dialog.confirm({ title: `Build ${done.name}'s look in your HeyGen?`, confirmLabel: 'Build look', tone: 'warn',
      body: 'Their picture is uploaded to your HeyGen account and made into a photo avatar. It uses your account, and HeyGen may ask them to confirm it is them.' })) return;
    setBusy('look');
    const r = await mutate(() => api.buildTwinLook(done.presenterId), null).catch(() => null);
    setBusy(null); if (r) setMade((m) => ({ ...m, look: true }));
  };
  if (done) {
    return (
      <Modal title={`${done.name} added`} width={520} onClose={onClose} footer={<button className="primary" onClick={onClose}>Done</button>}>
        <p className="m-0 text-[13px]">
          {done.name} is under Presenters{done.grant?.endsAt ? `, shared with you until ${new Date(done.grant.endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}.
          {done.looks || done.voice ? ' Build them on your side:' : ''}
        </p>
        {(done.looks || done.voice) && (
          <div className="grid gap-[8px] mt-[12px]">
            {done.voice && (
              <div className="flex items-center gap-[10px] p-[10px_12px] rounded-lg border border-solid border-line">
                <span className="flex-1 text-[12.5px]"><b className="block text-[13px] font-[580]">Their voice</b><span className="text-muted">Made on this Mac from their sample — free.</span></span>
                {made.voice ? <span className="text-ok text-[12.5px] inline-flex items-center gap-[4px]"><Check size={13} /> Ready</span>
                  : <button disabled={busy} onClick={voice}>{busy === 'voice' ? 'Making…' : 'Make their voice'}</button>}
              </div>
            )}
            {done.looks > 0 && (
              <div className="flex items-center gap-[10px] p-[10px_12px] rounded-lg border border-solid border-line">
                <span className="flex-1 text-[12.5px]"><b className="block text-[13px] font-[580]">Their look</b><span className="text-muted">Built in your HeyGen from their picture.</span></span>
                {made.look ? <span className="text-ok text-[12.5px] inline-flex items-center gap-[4px]"><Check size={13} /> Building in HeyGen</span>
                  : <button disabled={busy} onClick={look}>{busy === 'look' ? 'Uploading…' : 'Build in HeyGen…'}</button>}
              </div>
            )}
          </div>
        )}
        {done.needs?.length > 0 && <p className={NOTE}>Still to do: {done.needs.join('; ')}.</p>}
      </Modal>
    );
  }
  return (
    <Modal title="Add a shared twin" width={500} onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!preview} onClick={add}>Add to presenters</button></>}>
      <label className="flex items-center justify-center gap-[8px] p-[18px] rounded-lg border border-dashed border-line-2 bg-surface-2 text-[13px] text-muted cursor-pointer hover:border-accent">
        <Upload size={15} /> {preview ? 'Choose a different file' : 'Choose the twin package they sent (.twin)'}
        <input type="file" accept=".twin,.json,application/zip,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </label>
      {err && <p className="oberr m-[10px_0_0]">{err}</p>}
      {preview && (
        <div className="mt-[12px] text-[12.5px]">
          <b className="block text-[14px] font-[600]">{preview.name}</b>
          {preview.packaged
            ? <span className="text-muted">A twin package. Its files are checked against their fingerprints when you add it.</span>
            : <>
                <span className="text-muted">{preview.owner ? `Shared by ${preview.owner}` : 'Shared twin'}{preview.tagline ? ` · ${preview.tagline}` : ''}</span>
                <p className="m-[10px_0_4px] font-semibold text-[11.5px] text-muted">Still needed before a video</p>
                <ul className="m-0 p-[0_0_0_18px] text-muted leading-[1.6]">{preview.needs.map((n) => <li key={n}>{n}</li>)}</ul>
              </>}
        </div>
      )}
      <p className={NOTE}>A package describes a twin and carries what it is built from; the share inside it says until when.</p>
    </Modal>
  );
}
