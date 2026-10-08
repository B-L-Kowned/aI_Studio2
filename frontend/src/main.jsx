import React, { useState, useEffect, useCallback } from 'react';
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
import ErrorBoundary from './components/ErrorBoundary.jsx';
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
// Home is the day's work, so the header names it that; the route stays /home.
const NAV_LABEL = { Home: 'Today' };

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

/** A page name as it appears in the address bar, and back again. */
const toPath = (name) => '/' + String(name).toLowerCase();
const fromPath = (path) =>
  PAGES.find((p) => toPath(p) === String(path).replace(/\/+$/, '').toLowerCase()) ?? null;

function App() {
  // Seeded from the address so a deep link opens the page it names. Before
  // this, every URL rendered Home — the server answered /plan with the app
  // (correctly, it IS the app) and the app then ignored the path entirely.
  const [page, setPageState] = useState(() => fromPath(window.location.pathname));
  const { status, error, loadErrors, reload, workspace, toast } = useStudio();

  /**
   * Navigating pushes a history entry, which is the whole point: there was no
   * router and no history, so Cmd-[, the trackpad swipe and the View menu had
   * nothing to go back THROUGH. They did not fail — there was never anything
   * there.
   *
   * `replace` for the first paint so the landing page does not become an entry
   * you can go "back" to from itself.
   */
  const setPage = useCallback((name, { replace = false } = {}) => {
    setPageState(name);
    const url = toPath(name);
    if (window.location.pathname === url) return;
    try {
      window.history[replace ? 'replaceState' : 'pushState']({ page: name }, '', url);
    } catch { /* a packaged build may restrict this; navigation still works */ }
  }, []);

  // The browser moved: follow it. Without this, back changes the address and
  // leaves the app rendering the old page — worse than back doing nothing.
  useEffect(() => {
    const onPop = (e) => setPageState(e.state?.page ?? fromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // First paint lands somewhere the address does not name — "/" while the app
  // shows Home. REPLACE it so the landing page is not an entry you can press
  // back into from itself. This sits above the early returns below because a
  // hook cannot run conditionally; it no-ops until the workspace is loaded.
  const landedRef = React.useRef(false);
  useEffect(() => {
    if (landedRef.current || !workspace?.onboarded) return;
    if (fromPath(window.location.pathname)) { landedRef.current = true; return; }
    const allowedNow = pagesFor(workspace.program);
    const raw = workspace.program?.landing;
    const start = allowedNow.includes(raw)
      ? raw
      : (raw === 'Training' ? 'Plan' : 'Create');
    landedRef.current = true;
    setPage(start, { replace: true });
  }, [workspace, setPage]);

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
      {/* Only the app bar is sticky: section <header>s must not be, or they
          slide over it when a page scrolls. */}
      <header className="bg-surface [border-bottom:1px_solid_var(--line)] sticky top-0 z-20">
        {/* The bar spans the window, but its contents share the same centred
            column as <main> so the logo lines up with the page content.
            Three grid tracks, not a flex row: the equal side tracks keep the nav
            on the header's true centre however wide the licence badge is, and an
            empty third track keeps it centred with no licence. Below 880px the
            nav drops to its own row rather than squeezing the wordmark. */}
        <div className="max-w-[1520px] m-[0_auto] min-h-[52px] grid grid-cols-[1fr_auto_1fr] items-center p-[6px_28px] gap-[10px_26px] lte880:grid-cols-[auto_1fr]">
          <b className="text-[14px] font-[640] tracking-[-0.01em] whitespace-nowrap justify-self-start lte880:col-[1] lte880:row-[1]">◉ AI Video Studio</b>
          <nav className="justify-center lte880:col-[1/-1] lte880:row-[2]">
            {allowed.map((n) => (
              <button key={n} className={current === n ? 'on' : ''} onClick={() => setPage(n)}>{NAV_LABEL[n] ?? n}</button>
            ))}
          </nav>
          <ProgramBadge go={setPage} />
        </div>
      </header>
      <main>
        {loadErrors.length > 0 && (
          <div className="decisiongroup warning">
            <b>Part of the studio did not load</b>
            <div>
              <AlertCircle size={15} />{' '}
              {loadErrors.map((e) => `${e.name}: ${e.message}`).join(' · ')}
            </div>
            <div><button onClick={reload}>Retry</button></div>
          </div>
        )}
        <ErrorBoundary key={current}>
          {current === 'Home' && <Home go={setPage} />}
          {current === 'Plan' && <Plan go={setPage} />}
          {current === 'Create' && <Create go={setPage} />}
          {current === 'Cast' && <Cast />}
          {current === 'Library' && <Library go={setPage} />}
          {current === 'Settings' && <Setup />}
        </ErrorBoundary>
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
  const { workspace, scope, setScope, grantedPrograms } = useStudio();
  const program = workspace.program;
  if (!program?.info?.length) return null;

  // With one program there is nothing to choose, so this stays what it was: a
  // fact about the licence that opens where the licence is changed.
  if (grantedPrograms.length < 2) {
    return (
      <button
        className="inline-flex items-center gap-[6px] shrink-0 [border:0] bg-transparent p-[4px_6px] rounded-sm text-[11.5px] text-faint cursor-pointer justify-self-end [&:hover:not(:disabled)]:bg-canvas [&:hover:not(:disabled)]:text-muted [&>svg]:opacity-[.7] lte880:col-[2] lte880:row-[1] lte880:justify-self-end"
        onClick={() => go?.('Settings')}
        title={`Licence ${workspace.licenseHint ?? ''} — opens Settings`}
      >
        <KeyRound size={12} />
        <span>Licence</span>
        <b className="font-[600] text-ink-2">{program.info.map((p) => p.label).join(' + ')}</b>
      </button>
    );
  }

  // With two, the licence badge said "Comedy + Content" and did nothing but
  // link to Settings — it named the programs without letting you work in one.
  // These bubbles ARE that licence, made usable. There is no "Both": a
  // production whose mode is `both` belongs to each program and shows under
  // either bubble, which is a fact about the production, not a place to stand.
  return (
    <div className="inline-flex gap-[2px] p-[2px] border border-solid border-line rounded-sm bg-canvas shrink-0 justify-self-end lte880:col-[2] lte880:row-[1] lte880:justify-self-end" role="group" aria-label="Which program you are working in">
      {program.info.map((p) => (
        <button
          key={p.id}
          type="button"
          className={
            '[border:0] p-[4px_12px] rounded-[calc(var(--r-sm)_-_2px)] text-[12px] cursor-pointer whitespace-nowrap hover:text-ink ' +
            (p.id === scope
              ? 'on bg-surface text-ink font-[560] [box-shadow:0_1px_2px_rgb(0_0_0_/_0.06)] [&:hover:not(:disabled)]:bg-surface'
              : 'bg-transparent text-muted')
          }
          aria-pressed={p.id === scope}
          onClick={() => setScope(p.id)}
          title={p.detail}
        >
          {p.label}
        </button>
      ))}
    </div>
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
