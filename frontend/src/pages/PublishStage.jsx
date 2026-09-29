import React, { useEffect, useState, useCallback } from 'react';
import { Share2, Lock, Check, AlertCircle, ExternalLink } from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import { api } from '../services/api.js';

export default function PublishStage() {
  const { production, mutate } = useStudio();
  const [state, setState] = useState(null);
  const [modes, setModes] = useState({});

  const load = useCallback(async () => setState(await api.publications(production.id)), [production.id]);
  useEffect(() => { load(); }, [load]);

  if (!state) return <p className="muted">Loading…</p>;

  const run = async (platform) => {
    // Same fallback the select uses. They disagreed, so a card showing "Publish
    // via connection" could send "prepare" and report success for the wrong act.
    const target = state.targets.find((t) => t.platform === platform);
    const mode = modes[platform] ?? target?.mode ?? 'prepare';
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

      <div className="publishgrid">
        {state.targets.map((t) => (
          <div className={'publishcard' + (t.kind === 'owned' ? ' owned' : '')} key={t.platform}>
            <Share2 />
            {t.kind === 'owned' && <span className="owntag">Owned channel</span>}
            <b>{t.platform}</b>
            <span className="chandetail">{t.domain ?? t.detail}</span>
            <span className={'conn ' + (t.connected ? 'on' : 'off')}>
              {t.connected ? <><Check size={12} /> Connected</> : 'Not connected'}
            </span>
            <select
              value={modes[t.platform] ?? t.mode}
              onChange={(e) => setModes((m) => ({ ...m, [t.platform]: e.target.value }))}
            >
              <option value="prepare">Prepare only</option>
              <option value="schedule">Schedule via connection</option>
              <option value="publish">Publish via connection</option>
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
              <small className={'pstatus' + (t.status === 'published' && !t.verified ? ' unverified' : '')}>
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
