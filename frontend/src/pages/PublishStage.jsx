import React, { useState } from 'react';
import { Share2, Lock, Check, AlertCircle, ExternalLink } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';
import { useResource } from '../hooks/use-resource.js';
import LoadState from '../components/LoadState.jsx';

// The owntag keeps its class; only its placement under a card lived on the card.
const PUBLISHCARD = 'bg-surface border border-solid rounded-lg p-[15px] flex flex-col gap-[8px] items-stretch'
  + ' [&>svg]:w-[16px] [&>svg]:h-[16px] [&>svg]:text-muted'
  + ' [&_.owntag]:text-[10px] [&_.owntag]:tracking-[.05em] [&_.owntag]:font-semibold [&_.owntag]:uppercase'
  + ' [&_.owntag]:text-ink [&_.owntag]:bg-canvas [&_.owntag]:border [&_.owntag]:border-solid [&_.owntag]:border-line-2'
  + ' [&_.owntag]:rounded-sm [&_.owntag]:p-[2px_6px] [&_.owntag]:self-start';

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

  return (
    <div className="stagepane">
      <h2>Publish / Hand Off</h2>
      <p>
        Automation is optional. A complete platform package is prepared even when the final
        upload is manual — an unavailable connection degrades to Prepare only and never blocks you.
      </p>

      {!state.hasExport && (
        <div className="notice warn">
          <Lock /> Create an export in Edit before preparing a publication.
        </div>
      )}

      <div className="grid grid-cols-[repeat(3,1fr)] gap-[11px] m-[16px_0] lte960:grid-cols-[repeat(2,1fr)] lte800:grid-cols-[1fr]">
        {state.targets.map((t) => (
          <div className={PUBLISHCARD + (t.kind === 'owned' ? ' owned border-ink [box-shadow:var(--shadow)]' : ' border-line')} key={t.platform}>
            <Share2 />
            {t.kind === 'owned' && <span className="owntag">Owned channel</span>}
            <b className="text-[13.5px]">{t.platform}</b>
            <span className="text-[11.5px] text-muted">{t.domain ?? t.detail}</span>
            <span className={'conn ' + (t.connected ? 'on' : 'off')}>
              {t.connected
                ? <><Check size={12} /> Connected</>
                : t.canReallyPublish ? 'Not connected' : 'Manual handoff · connector not built'}
            </span>
            <select
              value={modes[t.platform] ?? t.mode}
              onChange={(e) => setModes((m) => ({ ...m, [t.platform]: e.target.value }))}
            >
              {t.availableModes.map((mode) => (
                <option value={mode} key={mode}>
                  {{ prepare: 'Prepare only', schedule: 'Schedule via connection', publish: 'Publish via connection' }[mode]}
                </option>
              ))}
            </select>
            <button
              className={(modes[t.platform] ?? t.mode) === 'publish' ? 'primary' : ''}
              disabled={!state.hasExport}
              onClick={() => run(t.platform)}
            >
              {(modes[t.platform] ?? t.mode) === 'publish'
                ? 'Publish now'
                : t.status === 'not_prepared' ? 'Prepare' : 'Re-prepare'}
            </button>

            {/* A published post is a real page. Showing only the word
                "published" was a claim with nothing to click. */}
            {t.postUrl && (
              <a className="postlink" href={t.postUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> View the post
              </a>
            )}
            {t.error && (
              <small className="pstatus err"><AlertCircle size={12} /> {t.error}</small>
            )}
            {t.status !== 'not_prepared' && !t.error && (
              <small className={'pstatus' + (t.status === 'published' && !t.verified ? ' text-warn' : '')}>
                {t.stale ? (
                  <><AlertCircle size={12} /> stale</>
                ) : t.status === 'published' && !t.verified ? (
                  <><AlertCircle size={12} /> recorded as published, but nothing was uploaded</>
                ) : (
                  <><Check size={12} /> {t.status}</>
                )}
              </small>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
