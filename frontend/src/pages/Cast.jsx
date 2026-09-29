import React, { useState } from 'react';
import Presenters from './Presenters.jsx';
import PeoplePage from './PeoplePage.jsx';

/**
 * Cast — everyone involved, in ONE bar.
 *
 * "Presenters" and "People" were two top-level tabs both meaning people, and
 * Presenters then had its own roster tabs inside. Nesting those under a Cast
 * sub-nav made three strips of tabs stacked down the page for what is really a
 * single choice: which group of people am I looking at.
 *
 * The roster tabs come from the server (`presenterTabs`, derived from the
 * licence), so a plan that grants no Characters never draws that option.
 */
export default function Cast() {
  const [tabs, setTabs] = useState([]);      // rosters, as the server describes them
  const [view, setView] = useState(null);    // a roster id, or 'collaborators'
  const current = view ?? tabs[0]?.id ?? null;

  return (
    <>
      <div className="subnav">
        {tabs.map((t) => (
          <button key={t.id} className={current === t.id ? 'on' : ''} onClick={() => setView(t.id)}>
            {t.label} <span className="tabcount">{t.presenters.length}</span>
          </button>
        ))}
        <button
          className={current === 'collaborators' ? 'on' : ''}
          onClick={() => setView('collaborators')}
        >
          Collaborators
        </button>
      </div>

      {/* Presenters stays mounted so its roster list survives switching to
          Collaborators and back, and so it keeps reporting the tabs. */}
      <div hidden={current === 'collaborators'}>
        <Presenters tab={current === 'collaborators' ? null : current} onTabs={setTabs} />
      </div>
      {current === 'collaborators' && <PeoplePage />}
    </>
  );
}
