import React, { useState } from 'react';
import {
  Sparkles, FileText, Video, Link, FolderKanban, Layers, Lock, X,
} from 'lucide-react';
import { useStudio } from '../context/studio-context.jsx';
import NewProduction from './NewProduction.jsx';
import NewSeries from './NewSeries.jsx';

/**
 * The one place a new thing gets made.
 *
 * There were three buttons — Campaign, New series, New production — which asked
 * you to know the difference between a container, a batch and a single video
 * before you had decided what you were making. Now there is one button, and the
 * choice happens here, where each option has room to say what it does.
 *
 * "Idea" was also a tab in the stage bar, which put a way to CREATE a production
 * inside the row describing the life of the one already open. There is no going
 * back to Idea for something that exists.
 */
const ICONS = { Sparkles, FileText, Video, Link, FolderKanban };

// Hover/disabled are compound variants so they out-specify the generic
// `button:hover:not(:disabled)` and `button:disabled`, as the old rules did.
const CARD = 'flex flex-col gap-[6px] items-start text-left p-[13px_14px] rounded-lg border border-solid border-line bg-surface cursor-pointer'
  + ' [&:hover:not(:disabled)]:border-line-2 [&:hover:not(:disabled)]:bg-surface-2 disabled:opacity-[.55] disabled:cursor-not-allowed';
const CARD_TOP = 'flex items-center gap-[7px] [&>svg]:text-muted';
const CARD_TEXT = 'text-muted text-[12px] leading-[1.5]';
const MARK = 'not-italic text-[10.5px] tracking-[.04em] uppercase p-[1px_6px] rounded-[3px]';

const SOURCE_FOR = {
  'An Idea': 'idea',
  'A Template': 'template',
  'Existing Video': 'existing_video',
  'Existing Script': 'existing_script',
  'Source / URL': 'url',
  'Existing Project': 'existing_project',
};

export default function NewProductionFlow({
  campaignId = null, canSeries = false, prefillTitle = '', onClose, onDone,
}) {
  const { meta } = useStudio();
  const [picked, setPicked] = useState(null);

  if (picked === 'series') {
    return <NewSeries onClose={onClose} onDone={onDone} onBack={() => setPicked(null)} />;
  }
  if (picked) {
    return (
      <NewProduction
        sourceType={picked}
        campaignId={campaignId}
        prefillTitle={prefillTitle}
        onClose={onClose}
        onDone={onDone}
        onBack={() => setPicked(null)}
      />
    );
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal w-[min(760px,calc(100vw_-_48px))]">
        <div className="modalhead">
          <b>What are we making?</b>
          <button onClick={onClose}><X size={15} /></button>
        </div>

        {/* Several at once is a different KIND of answer to the ones below, so
            it sits apart rather than being a seventh card of the same shape. */}
        {canSeries && (
          <button type="button" className={`${CARD} wide w-full mb-[4px]`} onClick={() => setPicked('series')}>
            <span className={CARD_TOP}>
              <Layers size={16} />
              <b className="text-[13.5px]">A series</b>
              <em className={`${MARK} text-accent bg-accent-soft`}>several at once</em>
            </span>
            <small className={CARD_TEXT}>
              A season, a course, a run of shorts. Creates the campaign and every episode in it,
              in the order you set — then each one is an ordinary production.
            </small>
          </button>
        )}

        <p className="flex items-center gap-[10px] m-[12px_0_8px] text-faint text-[11.5px] before:content-[''] before:flex-1 before:h-[1px] before:bg-line after:content-[''] after:flex-1 after:h-[1px] after:bg-line">
          <span>{canSeries ? 'or one video, starting from' : 'One video, starting from'}</span>
        </p>

        <div className="grid grid-cols-[repeat(2,1fr)] gap-[10px] mt-[4px]">
          {meta.startSources.map((s) => {
            const I = ICONS[s.icon] ?? Sparkles;
            return (
              <button
                type="button"
                className={CARD + (s.locked || s.available === false ? ' blocked' : '')}
                key={s.title}
                disabled={s.locked}
                onClick={() => setPicked(SOURCE_FOR[s.title] ?? 'idea')}
              >
                <span className={CARD_TOP}>
                  <I size={16} />
                  <b className="text-[13.5px]">{s.title}</b>
                  {s.locked && <Lock size={12} />}
                </span>
                <small className={CARD_TEXT}>{s.locked ? 'Not included in your current licence.' : s.body}</small>
                {s.available === false && <em className={`${MARK} text-warn bg-warn-soft`}>not built yet</em>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
