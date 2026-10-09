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
  // The tab lives in the address (?tab=sharing), so a refresh keeps it. Today
  // can still send you straight to Sharing.
  const TABS = ['you', 'cast', 'sharing'];
  const [view, setViewState] = useState(() => {
    try {
      const sent = sessionStorage.getItem('cast-view');
      sessionStorage.removeItem('cast-view');
      const pick = sent || new URLSearchParams(window.location.search).get('tab');
      if (TABS.includes(pick)) return pick;
    } catch { /* storage blocked */ }
    return comedy ? 'cast' : 'you';
  });
  const setView = React.useCallback((v) => {
    setViewState(v);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', v);
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
    } catch { /* restricted */ }
  }, []);
  // Switching program opens its own default tab; the first render keeps the address's.
  const first = React.useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; setView(view); return; }
    setView(comedy ? 'cast' : 'you');
  }, [comedy]); // eslint-disable-line react-hooks/exhaustive-deps
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
