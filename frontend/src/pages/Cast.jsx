import React, { useState, useEffect } from 'react';
import Presenters from './Presenters.jsx';
import SharingPage from '../components/SharingPage.jsx';
import { useStudio } from '../context/studio-context.jsx';
import { PageHead, Tabs } from '../components/Section.jsx';

/**
 * Cast — the same tabs in both programs: You (yourself and the personas you
 * play — one list, each with its outfits, pace and default videos), the
 * program's cast (Presenters in Content, Characters in Comedy — made here or
 * brought in from HeyGen), and Sharing: likeness lent for a while, both ways.
 */
export default function Cast() {
  const { scopeMode } = useStudio();
  const comedy = scopeMode === 'comedy';
  // Each program opens where its work is: your looks in Content, the
  // characters in Comedy.
  const [view, setView] = useState(() => {
    // Today can send you straight to Sharing.
    try { const v = sessionStorage.getItem('cast-view'); sessionStorage.removeItem('cast-view'); if (v) return v; } catch { /* storage blocked */ }
    return comedy ? 'cast' : 'you';
  });
  useEffect(() => { setView(comedy ? 'cast' : 'you'); }, [comedy]);
  const bar = (
    <Tabs value={view} onChange={setView} items={[
      { id: 'you', label: 'You' },
      { id: 'cast', label: comedy ? 'Characters' : 'Presenters' },
      { id: 'sharing', label: 'Sharing' },
    ]} />
  );
  if (view === 'sharing') {
    return (
      <>
        <PageHead title="Cast" lead="Likeness shared for a set time, both ways. Each share ends by itself, or when either side ends it." tabs={bar} />
        <SharingPage />
      </>
    );
  }
  return <Presenters onePage show={view} tabs={bar} />;
}
