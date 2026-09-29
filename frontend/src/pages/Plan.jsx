import React, { useState, useEffect } from 'react';
import { useStudio } from '../context/studio-context.jsx';
import Campaigns from './Campaigns.jsx';
import Ideas from './Ideas.jsx';
import Companies from './Companies.jsx';
import CalendarPage from './CalendarPage.jsx';
import Training from './Training.jsx';

/**
 * Plan — what is being made, and when.
 *
 * Campaigns, Calendar and Training were three top-level tabs answering one
 * question in three vocabularies: a campaign IS a course, and the calendar is
 * the same productions on a date axis. Ten tabs across the top made the header
 * a list of screens rather than a map of the work.
 *
 * Training stays program-gated here exactly as it was as a route: the tab is
 * built from the server's map, never from a copy of it.
 */
const VIEWS = [
  // The lot comes first: it is where work starts, before it is work.
  { id: 'Ideas', label: 'Parking lot' },
  { id: 'Companies', label: 'Companies' },
  { id: 'Campaigns', label: 'Campaigns' },
  { id: 'Calendar', label: 'Calendar' },
  { id: 'Training', label: 'Training' },
];

export default function Plan({ go, routes, programs }) {
  const { workspace, pendingView, setPendingView } = useStudio();
  const map = routes ?? workspace.program?.routes ?? {};
  const granted = programs ?? workspace.program?.programs ?? [];
  const allowed = VIEWS.filter((v) => !map[v.id] || granted.includes(map[v.id]));

  const [view, setView] = useState('Campaigns');

  // Opened from somewhere that knows which view it meant.
  useEffect(() => {
    if (pendingView && VIEWS.some((v) => v.id === pendingView)) {
      setView(pendingView);
      setPendingView(null);
    }
  }, [pendingView, setPendingView]);
  const current = allowed.some((v) => v.id === view) ? view : allowed[0]?.id;

  return (
    <>
      <div className="subnav">
        {allowed.map((v) => (
          <button key={v.id} className={current === v.id ? 'on' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      {current === 'Ideas' && <Ideas go={go} />}
      {current === 'Companies' && <Companies go={go} />}
      {current === 'Campaigns' && <Campaigns go={go} />}
      {current === 'Calendar' && <CalendarPage />}
      {/* Training's "new course" is a sibling view, not another page. */}
      {current === 'Training' && <Training go={go} goView={setView} />}
    </>
  );
}
