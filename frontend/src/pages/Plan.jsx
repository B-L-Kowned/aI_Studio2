import React, { useState, useEffect } from 'react';
import { useStudio } from '../context/studio-context.jsx';
import { Tabs } from '../components/Section.jsx';
import Campaigns from './Campaigns.jsx';
import Ideas from './Ideas.jsx';
import Companies from './Companies.jsx';
import CalendarPage from './CalendarPage.jsx';
import Training from './Training.jsx';
import Register from './Register.jsx';
import Review from './Review.jsx';

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
  // The end-to-end register: every Video ID and where it really stands.
  { id: 'Register', label: 'Register' },
  // Reading work across the register: drafts to approve, checks to answer.
  { id: 'Review', label: 'Review' },
  // Ideas not yet videos.
  { id: 'Ideas', label: 'Parking lot' },
  // Set up once and rarely visited: set apart so the daily three stand out.
  { id: 'Companies', label: 'Companies', setup: true },
  { id: 'Campaigns', label: 'Campaigns', setup: true },
  { id: 'Calendar', label: 'Calendar', setup: true },
  { id: 'Training', label: 'Training', setup: true },
];

export default function Plan({ go, routes, programs }) {
  const { workspace, pendingView, setPendingView } = useStudio();
  const map = routes ?? workspace.program?.routes ?? {};
  const granted = programs ?? workspace.program?.programs ?? [];
  const allowed = VIEWS.filter((v) => !map[v.id] || granted.includes(map[v.id]));

  // The tab you were on, so opening a video and coming back lands you there.
  const [view, setViewState] = useState(() => { try { return sessionStorage.getItem('plan-view') || 'Register'; } catch { return 'Register'; } });
  const setView = (v) => { setViewState(v); try { sessionStorage.setItem('plan-view', v); } catch { /* storage blocked */ } };

  // Opened from somewhere that knows which view it meant.
  useEffect(() => {
    if (pendingView && VIEWS.some((v) => v.id === pendingView)) {
      setView(pendingView);
      setPendingView(null);
    }
  }, [pendingView, setPendingView]);
  const current = allowed.some((v) => v.id === view) ? view : allowed[0]?.id;
  const tabs = <Tabs items={allowed} value={current} onChange={setView} />;

  return (
    <>
      {/* The view draws the header, so its title sits above these tabs. */}
      {current === 'Ideas' && <Ideas go={go} tabs={tabs} />}
      {current === 'Register' && <Register go={go} tabs={tabs} />}
      {current === 'Review' && <Review go={go} tabs={tabs} />}
      {current === 'Companies' && <Companies go={go} tabs={tabs} />}
      {current === 'Campaigns' && <Campaigns go={go} tabs={tabs} />}
      {current === 'Calendar' && <CalendarPage tabs={tabs} />}
      {/* Training's "new course" is a sibling view, not another page. */}
      {current === 'Training' && <Training go={go} goView={setView} tabs={tabs} />}
    </>
  );
}
