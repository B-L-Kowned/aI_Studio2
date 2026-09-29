import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lock, AlertCircle, Check, X, KeyRound } from 'lucide-react';
import { StudioProvider, useStudio } from './context/studio-context.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Home from './pages/Home.jsx';
import Create from './pages/Create.jsx';
import Plan from './pages/Plan.jsx';
import Cast from './pages/Cast.jsx';
import Library from './pages/Library.jsx';
import Setup from './pages/Setup.jsx';
import { api } from './services/api.js';
import './style.css';

/**
 * Six destinations, not ten.
 *
 * Campaigns, Calendar and Training all answer "what am I making and when", so
 * they are views inside Plan. Presenters and People are both people, split by
 * whether they appear on screen, so they are views inside Cast. HeyGen is an
 * account you configure, so it lives in Settings next to the other connections.
 * A header is a map of the work, not an index of every screen that exists.
 */
const PAGES = ['Home', 'Plan', 'Create', 'Cast', 'Library', 'Settings'];

// Which program owns a page, for the ones the header itself can hide. Plan's
// own sub-tabs are gated the same way, from the same server map.
const PAGE_PROGRAM = {};

/**
 * Which pages this licence may see.
 *
 * The map comes from the server (`program.routes`) and is never restated here —
 * "a second copy of a table the server already owns is only ever one edit away
 * from disagreeing with it." Pages absent from the map belong to everyone.
 */
function pagesFor(program) {
  const routes = { ...(program?.routes ?? {}), ...PAGE_PROGRAM };
  const granted = program?.programs ?? [];
  return PAGES.filter((p) => !routes[p] || granted.includes(routes[p]));
}

function App() {
  const [page, setPage] = useState(null);
  const { status, error, reload, workspace, toast } = useStudio();

  if (status === 'loading') {
    return <main><p className="muted">Loading studio…</p></main>;
  }

  if (status === 'error') {
    return (
      <main>
        <div className="decisiongroup warning">
          <b>Could not reach the API</b>
          <div><AlertCircle size={15} /> {error}</div>
          <div><button onClick={reload}>Retry</button></div>
        </div>
      </main>
    );
  }

  // Gate 2: first run is onboarding, not the studio.
  if (!workspace.onboarded) {
    return (
      <>
        <main><Onboarding /></main>
        <Toast toast={toast} />
      </>
    );
  }

  const allowed = pagesFor(workspace.program);
  // The server says where to land. Falling back to Create would put a
  // content-only account on a page about a production it has not opened.
  // The server's landing names a view ("Training") that may now live inside a
  // page, so resolve it to the page that holds it.
  const landingRaw = workspace.program?.landing;
  const landing = allowed.includes(landingRaw)
    ? landingRaw
    : (landingRaw === 'Training' ? 'Plan' : 'Create');
  // A page the licence no longer grants must not stay selected after a downgrade.
  const current = page && allowed.includes(page) ? page : landing;

  return (
    <>
      <header>
        {/* The bar spans the window, but its contents share the same centred
            column as <main> so the logo lines up with the page content. */}
        <div className="headerinner">
          <b>◉ AI Video Studio</b>
          <nav>
            {allowed.map((n) => (
              <button key={n} className={current === n ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>
            ))}
          </nav>
          <ProgramBadge go={setPage} />
        </div>
      </header>
      <main>
        {current === 'Home' && <Home go={setPage} />}
        {current === 'Plan' && <Plan go={setPage} />}
        {current === 'Create' && <Create />}
        {current === 'Cast' && <Cast />}
        {current === 'Library' && <Library />}
        {current === 'Settings' && <Setup />}
      </main>
      <Toast toast={toast} />
    </>
  );
}

/**
 * What this licence grants — a statement, not a switch.
 *
 * This was a Comedy/Content/Both toggle. It is gone on purpose: the lane picker
 * "disappears: choosing a character already says comedy". Which program you are
 * working in follows from the presenter you cast, so a separate control for it
 * asked the same question twice in two vocabularies.
 */
function ProgramBadge({ go }) {
  const { workspace } = useStudio();
  const program = workspace.program;
  if (!program?.info?.length) return null;

  // Two pills in the top-right corner is where a segmented CONTROL lives, and
  // this used to be one — a Comedy/Content switch. The switch is gone because
  // casting a presenter already says which program you are in, but the shape
  // stayed and kept inviting clicks. So: one line, labelled, that reads as a
  // fact about the licence and opens the place where the licence is changed.
  return (
    <button
      className="licencebadge"
      onClick={() => go?.('Settings')}
      title={`Licence ${workspace.licenseHint ?? ''} — opens Settings`}
    >
      <KeyRound size={12} />
      <span>Licence</span>
      <b>{program.info.map((p) => p.label).join(' + ')}</b>
    </button>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={'toast ' + toast.tone}>
      {toast.tone === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
      <span>{toast.message}</span>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StudioProvider>
    <App />
  </StudioProvider>
);
