import React, { useState, useEffect } from 'react';
import Presenters from './Presenters.jsx';
import PeoplePage from '../components/PeoplePage.jsx';
import { useStudio } from '../context/studio-context.jsx';
import { PageHead, Tabs } from '../components/Section.jsx';

/**
 * Cast — the same tabs in both programs: You (your likeness), Personas (who
 * you play, and which videos each presents by default), the
 * program's cast (Presenters in Content, Characters in Comedy — made here or
 * brought in from HeyGen), and Collaborators (people you invited).
 */
export default function Cast() {
  const { scopeMode } = useStudio();
  const comedy = scopeMode === 'comedy';
  // Each program opens where its work is: your looks in Content, the
  // characters in Comedy.
  const [view, setView] = useState(comedy ? 'cast' : 'you');
  useEffect(() => { setView(comedy ? 'cast' : 'you'); }, [comedy]);
  const bar = (
    <Tabs value={view} onChange={setView} items={[
      { id: 'you', label: 'You' },
      { id: 'personas', label: 'Personas' },
      { id: 'cast', label: comedy ? 'Characters' : 'Presenters' },
      { id: 'collaborators', label: 'Collaborators' },
    ]} />
  );
  if (view === 'collaborators') {
    return (
      <>
        <PageHead title="Cast" lead="People you invited, and what each has approved of their likeness and voice." tabs={bar} />
        <PeoplePage section />
      </>
    );
  }
  return <Presenters onePage show={view} tabs={bar} />;
}
