import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, ExternalLink, Upload, UserRound } from 'lucide-react';
import { Modal } from './Dialog.jsx';
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
  const toggle = (p) => setF((x) => ({ ...x, parts: x.parts.includes(p) ? x.parts.filter((y) => y !== p) : [...x.parts, p] }));
  // Downloading is sharing: the share is recorded first, with its end date,
  // and the card carries it, so it ends on both sides at the same moment.
  const download = async () => {
    const g = await mutate(() => api.shareTwin({ presenterId: presenter.id, counterpart: f.name.trim(), email: f.email.trim() || null,
      scopes: f.parts, mode: f.how, days: f.days ? Number(f.days) : null }), null).catch(() => null);
    if (!g) return;
    setShared(g.data);
    const card = await api.twinCard(presenter.id, g.data.id);
    const keep = new Set(f.parts);
    const shared = {
      ...card,
      wardrobe: keep.has('appearance') ? card.wardrobe : [],
      voice: keep.has('voice') ? card.voice : null,
      personality: keep.has('personality') ? card.personality : { voice: '', signatureOpening: '', signOff: '', neverClaim: '' },
      sharing: { mode: f.how, for: f.name || null, expires_in_days: f.days ? Number(f.days) : null },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(shared, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${presenter.name.replace(/[^\w-]+/g, '-').toLowerCase()}.twin.json`; a.click();
    URL.revokeObjectURL(url);
  };
  if (signIn) return <AccountDialog account={account} onClose={() => setSignIn(false)} onChanged={reload} />;
  const canSend = account?.signedIn && account.canShare;
  return (
    <Modal title={`Share ${presenter.name}`} width={560} onClose={onClose}
      footer={<>
        <button onClick={onClose}>Cancel</button>
        <button disabled={!f.parts.length || !f.name.trim()} onClick={download} title={f.name.trim() ? 'A file with the personality, outfits and voice settings — never your samples' : 'Say who it is for first'}><Download size={13} /> Download twin card</button>
        <button className="primary" disabled={!f.parts.length || !f.email.trim() || (account?.signedIn && !canSend)}
          onClick={() => (account?.signedIn ? null : setSignIn(true))}
          title={account?.signedIn ? 'Opens once AuthenTech twin sharing is live — download the card meanwhile' : 'Sharing with consent uses an AuthenTech account'}>
          {account?.signedIn ? 'Send with consent (soon)' : 'Send with consent…'}
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
      {shared && (
        <p className="m-[12px_0_0] p-[8px_11px] rounded-md bg-ok-soft text-ok text-[12.5px]">
          Shared with {shared.counterpart} {shared.endsAt ? `until ${new Date(shared.endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'until you end it'}. Send them the card; you can extend or end it under Cast → Sharing.
        </p>
      )}
      <p className={NOTE}>
        {canSend
          ? 'You confirm the share on AuthenTech, and they accept it there. You can withdraw it at any time; videos already published stay published, and a copy they downloaded cannot be recalled.'
          : 'Sending with consent needs a free AuthenTech account, so the permission can be proved and withdrawn. The twin card works now: it holds the personality, outfits and voice settings, never your recordings, and grants nothing by itself.'}
      </p>
    </Modal>
  );
}

/** Add a twin someone shared: see what it brings and what is still needed, then add it. */
export function ImportTwinDialog({ onClose, onAdded }) {
  const { mutate } = useStudio();
  const [card, setCard] = useState(null);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const pick = async (file) => {
    setErr(null); setPreview(null);
    try {
      const c = JSON.parse(await file.text());
      setCard(c);
      setPreview(await api.previewTwinCard(c));
    } catch (e) { setErr(e instanceof SyntaxError ? 'That file is not a twin card.' : e.message); }
  };
  const add = async () => {
    const r = await mutate(() => api.importTwinCard(card), null).catch(() => null);
    if (r) { setDone(r.data); onAdded?.(); }
  };
  if (done) {
    return (
      <Modal title={`${done.name} added`} onClose={onClose} footer={<button className="primary" onClick={onClose}>Done</button>}>
        <p className="m-0 text-[13px]">They are under Presenters, and {done.owner} is under Collaborators. Before they can appear in a video:</p>
        <ul className="m-[8px_0_0] p-[0_0_0_18px] text-[12.5px] text-muted leading-[1.6]">{done.needs.map((n) => <li key={n}>{n}</li>)}</ul>
      </Modal>
    );
  }
  return (
    <Modal title="Add a shared twin" width={500} onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!preview} onClick={add}>Add to presenters</button></>}>
      <label className="flex items-center justify-center gap-[8px] p-[18px] rounded-lg border border-dashed border-line-2 bg-surface-2 text-[13px] text-muted cursor-pointer hover:border-accent">
        <Upload size={15} /> {card ? 'Choose a different card' : 'Choose a twin card (.twin.json)'}
        <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </label>
      {err && <p className="oberr m-[10px_0_0]">{err}</p>}
      {preview && (
        <div className="mt-[12px] text-[12.5px]">
          <b className="block text-[14px] font-[600]">{preview.name}</b>
          <span className="text-muted">{preview.owner ? `Shared by ${preview.owner}` : 'Shared twin'}{preview.tagline ? ` · ${preview.tagline}` : ''}</span>
          <p className="m-[10px_0_4px] font-semibold text-[11.5px] text-muted">It brings</p>
          <span className="text-ink-2">{[preview.personality?.voice && 'personality', preview.wardrobe?.length && `${preview.wardrobe.length} outfit${preview.wardrobe.length === 1 ? '' : 's'}`, preview.voice && 'voice settings'].filter(Boolean).join(' · ') || 'a name only'}</span>
          <p className="m-[10px_0_4px] font-semibold text-[11.5px] text-muted">Still needed before a video</p>
          <ul className="m-0 p-[0_0_0_18px] text-muted leading-[1.6]">{preview.needs.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
      <p className={NOTE}>A card describes a twin; it is not permission to use one. <a href="https://theauthentech.app" target="_blank" rel="noopener noreferrer">AuthenTech <ExternalLink size={10} className="inline" /></a> records that.</p>
    </Modal>
  );
}
