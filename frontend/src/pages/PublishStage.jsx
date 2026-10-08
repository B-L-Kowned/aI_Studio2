import React, { useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { useResource } from '../hooks/use-resource.js';
import LoadState from '../components/LoadState.jsx';

export default function PublishStage() {
  const { production, mutate } = useStudio();
  const [modes, setModes] = useState({});

  const { data: state, error, reload: load, setData: setState } =
    useResource(() => api.publications(production.id), [production.id]);

  if (!state) return <LoadState error={error} retry={load} />;

  const run = async (platform) => {
    // Same fallback the select uses. They disagreed, so a card showing "Publish
    // via connection" could send "prepare" and report success for the wrong act.
    const target = state.targets.find((t) => t.platform === platform);
    const requested = modes[platform] ?? target?.mode ?? 'prepare';
    const mode = target?.availableModes?.includes(requested) ? requested : 'prepare';
    try {
      await mutate(() => api.publish(production.id, platform, mode), null);
    } catch { /* mutate reports it */ }
    load();
  };

  if (!state.hasExport) {
    return (
      <section aria-label="Publish">
        <h2>Publish</h2>
        <p className="text-muted text-[13px]">Opens once the finished video exists — export it in Edit, or upload it above.</p>
      </section>
    );
  }

  return (
    <section aria-label="Publish">
      <h2>Publish</h2>
      <p className="text-muted text-[13px] m-[0_0_10px]">Each channel gets a ready package — the file, title, description and captions. Where there is no connection, you post it yourself.</p>
      <ul className="list-none p-0 m-0 border border-solid border-line rounded-lg bg-surface">
        {state.targets.map((t) => {
          const mode = modes[t.platform] ?? t.mode;
          return (
            <li key={t.platform} className="grid grid-cols-[minmax(0,1fr)_auto] gap-[12px] items-center p-[10px_14px] [&+&]:[border-top:1px_solid_var(--line)]">
              <div className="min-w-0">
                <b className="text-[13.5px] font-[580]">{t.platform}</b>
                {t.kind === 'owned' && <span className="ml-[8px] text-[10px] tracking-[.05em] uppercase font-semibold text-ink-2 bg-canvas border border-solid border-line-2 rounded-sm p-[1px_6px]">Yours</span>}
                <span className="block text-[12px] text-muted">
                  {t.connected ? <><Check size={11} className="inline -mt-[2px] text-ok" /> Connected</> : 'You post it — the package is prepared for you'}
                  {t.status !== 'not_prepared' && !t.error && (
                    <span className={t.status === 'published' && !t.verified ? 'text-warn' : 'text-ok'}>
                      {' · '}{t.stale ? 'out of date — prepare again' : t.status === 'published' && !t.verified ? 'recorded as published, but nothing was uploaded' : t.status}
                    </span>
                  )}
                  {t.error && <span className="text-danger"> · {t.error}</span>}
                </span>
                {t.postUrl && <a className="text-[12px] text-accent underline" href={t.postUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} className="inline" /> View the post</a>}
              </div>
              <span className="flex items-center gap-[6px]">
                {t.availableModes.length > 1 && (
                  <select className="text-[12px]" value={mode} onChange={(e) => setModes((m) => ({ ...m, [t.platform]: e.target.value }))}>
                    {t.availableModes.map((m) => <option value={m} key={m}>{{ prepare: 'Prepare only', schedule: 'Schedule', publish: 'Publish' }[m]}</option>)}
                  </select>
                )}
                <button className={mode === 'publish' ? 'primary' : ''} onClick={() => run(t.platform)}>
                  {mode === 'publish' ? 'Publish now' : t.status === 'not_prepared' ? 'Prepare' : 'Prepare again'}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
