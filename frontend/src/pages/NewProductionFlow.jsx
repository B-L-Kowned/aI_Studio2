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
      <div className="modal widest">
        <div className="modalhead">
          <b>What are we making?</b>
          <button onClick={onClose}><X size={15} /></button>
        </div>

        {/* Several at once is a different KIND of answer to the ones below, so
            it sits apart rather than being a seventh card of the same shape. */}
        {canSeries && (
          <button type="button" className="sourcecard wide" onClick={() => setPicked('series')}>
            <span className="sourcetop">
              <Layers size={16} />
              <b>A series</b>
              <em className="countmark">several at once</em>
            </span>
            <small>
              A season, a course, a run of shorts. Creates the campaign and every episode in it,
              in the order you set — then each one is an ordinary production.
            </small>
          </button>
        )}

        <p className="sourcedivider">
          <span>{canSeries ? 'or one video, starting from' : 'One video, starting from'}</span>
        </p>

        <div className="sourcegrid">
          {meta.startSources.map((s) => {
            const I = ICONS[s.icon] ?? Sparkles;
            return (
              <button
                type="button"
                className={'sourcecard' + (s.locked || s.available === false ? ' blocked' : '')}
                key={s.title}
                disabled={s.locked}
                onClick={() => setPicked(SOURCE_FOR[s.title] ?? 'idea')}
              >
                <span className="sourcetop">
                  <I size={16} />
                  <b>{s.title}</b>
                  {s.locked && <Lock size={12} />}
                </span>
                <small>{s.locked ? 'Not included in your current licence.' : s.body}</small>
                {s.available === false && <em className="notbuilt">not built yet</em>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
