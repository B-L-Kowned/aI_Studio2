import React, { useState, useEffect } from 'react';
import Presenters from './Presenters.jsx';
import PeoplePage from '../components/PeoplePage.jsx';
import { useStudio } from '../context/studio-context.jsx';
import { Tabs } from '../components/Section.jsx';

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
  const { workspace, scope } = useStudio();
  const [tabs, setTabs] = useState([]);      // rosters, as the server describes them
  const [view, setView] = useState(null);    // a roster id, or 'collaborators'

  // The program bubble in the header decides which roster opens: Comedy lands
  // on Characters, Content on Presenters. The server already says which tab
  // belongs to which program (`presenterTab`), so the pairing is not repeated
  // here. "You" and Collaborators belong to every program and are never hidden
  // — the bubble chooses what you land on, it does not take people away.
  const tabForScope = workspace?.program?.info?.find((i) => i.id === scope)?.presenterTab ?? null;
  useEffect(() => {
    if (tabForScope && tabs.some((t) => t.id === tabForScope)) setView(tabForScope);
  }, [tabForScope, tabs.length]);

  const current = view ?? tabForScope ?? tabs[0]?.id ?? null;

  // Drawn by whichever view is showing, under that view's own title.
  const bar = (
    <Tabs
      items={[
        ...tabs.map((t) => ({ id: t.id, label: t.label, count: t.presenters.length })),
        { id: 'collaborators', label: 'Collaborators' },
      ]}
      value={current}
      onChange={setView}
    />
  );

  return (
    <>
      {/* Presenters stays mounted so its roster list survives switching to
          Collaborators and back, and so it keeps reporting the tabs. */}
      <div hidden={current === 'collaborators'}>
        <Presenters tab={current === 'collaborators' ? null : current} onTabs={setTabs} tabs={bar} />
      </div>
      {current === 'collaborators' && <PeoplePage tabs={bar} />}
    </>
  );
}
