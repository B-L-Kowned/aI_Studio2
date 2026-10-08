import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../services/api.js';

const StudioContext = createContext(null);

export function StudioProvider({ children }) {
  const mutateRef = React.useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  // Sections that failed to load, as [{ name, message }]. Non-fatal by design.
  const [loadErrors, setLoadErrors] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [production, setProduction] = useState(null);
  const [productions, setProductions] = useState([]);
  const [collections, setCollections] = useState({ people: [], campaigns: [], library: [], calendar: null });
  const [meta, setMeta] = useState({ setup: null, startSources: [], editorTools: [], publishTargets: [] });
  const [health, setHealth] = useState(null);
  // idle | saving | saved | failed. 'saved' self-clears so a permanent tick
  // does not sit in the header when nothing is happening; 'failed' sticks.
  const [saveState, setSaveState] = useState('idle');
  const [toast, setToast] = useState(null);
  const [pendingStage, setPendingStage] = useState(null);
  const [pendingView, setPendingView] = useState(null);
  const [pendingDate, setPendingDate] = useState(null);
  const [pendingCampaign, setPendingCampaign] = useState(null);

  // ── Which program you are working in ───────────────────────────────────────
  // Comedy or Content. There is deliberately NO "both" button: `both` is a
  // property a production HAS (it belongs to comedy and to content), not a
  // third place to stand. Such a production appears under BOTH bubbles.
  //
  // This lives in the WORKSPACE, not localStorage. The desktop build binds
  // PORT=0, so every launch serves from a different origin and per-origin
  // browser storage starts empty every time — a preference kept there survives
  // a reload and is silently lost on restart, which is the worst of both.
  // `workspace.active_mode` already existed for exactly this and was never
  // wired to anything.
  const activeMode = workspace?.activeMode ?? null;
  const grantedPrograms = workspace?.program?.programs ?? [];
  const info = workspace?.program?.info ?? [];

  // Stored 'both' predates this control and is not a choice the UI can make,
  // so it reads as "not chosen yet" and falls back to the first granted program.
  const scope =
    info.find((i) => i.mode === activeMode)?.id ?? grantedPrograms[0] ?? null;
  const scopeMode = info.find((i) => i.id === scope)?.mode ?? null;

  const setScope = useCallback(async (program) => {
    const mode = info.find((i) => i.id === program)?.mode;
    if (!mode) return;
    // The server validates against the licence and returns the whole workspace,
    // so the new scope arrives the same way every other workspace fact does.
    const res = await api.setMode(mode);
    if (res?.data) setWorkspace(res.data);
  }, [info.map((i) => i.id).join(',')]);

  /**
   * Does a thing carrying `mode` belong to the program in view?
   *
   * `mode === scopeMode` ALONE IS WRONG: it hides every `both` row from both
   * bubbles. 5 of 15 productions are `both`, so that bug would quietly drop a
   * third of the slate while looking like it worked.
   */
  const inScope = useCallback((mode) => {
    if (!scopeMode) return true;
    return mode === scopeMode || mode === 'both';
  }, [scopeMode]);

  const notify = useCallback((message, tone = 'info') => {
    setToast({ message, tone, at: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const t = setTimeout(() => setSaveState('idle'), 1800);
    return () => clearTimeout(t);
  }, [saveState]);

  const loadWorkspace = useCallback(async () => {
    const w = await api.workspace();
    setWorkspace(w);
    return w;
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setLoadErrors([]);
    // Only the workspace is fatal: without it there is no licence, no program
    // and no onboarding state to render. Everything else loads on its own, so
    // one failing endpoint (a calendar, an editor-tools list) degrades one
    // section instead of replacing the whole studio with "Could not reach the API".
    let w;
    try {
      w = await api.workspace();
    } catch (err) {
      setError(err.message);
      setStatus('error');
      return;
    }
    setWorkspace(w);
    api.health().then(setHealth).catch(() => setHealth(null));

    // Nothing else is fetched until the workspace is licensed and set up —
    // an un-onboarded install has no business loading a production.
    if (w.onboarded) {
      const parts = {
        production: [api.currentProduction, null],
        productions: [api.listProductions, []],
        people: [api.people, []],
        campaigns: [api.campaigns, []],
        library: [api.library, []],
        calendar: [api.calendar, null],
        setup: [api.setup, null],
        startSources: [api.startSources, []],
        editorTools: [api.editorTools, []],
        publishTargets: [api.publishTargets, []],
      };
      const names = Object.keys(parts);
      const settled = await Promise.allSettled(names.map((n) => parts[n][0]()));
      const got = {};
      const failed = [];
      settled.forEach((r, i) => {
        const name = names[i];
        if (r.status === 'fulfilled') got[name] = r.value;
        else { got[name] = parts[name][1]; failed.push({ name, message: r.reason?.message ?? 'failed' }); }
      });
      setProduction(got.production);
      setProductions(got.productions);
      setCollections({ people: got.people, campaigns: got.campaigns, library: got.library, calendar: got.calendar });
      setMeta({ setup: got.setup, startSources: got.startSources, editorTools: got.editorTools, publishTargets: got.publishTargets });
      setLoadErrors(failed);
    }
    setStatus('ready');
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Runs a mutation with the Saving/Saved/Failed indicator the handoff requires.
   * `apply` receives the unwrapped response so callers can update local state.
   */
  /**
   * `tracksSave: false` for actions that are not edits — an audition or a render
   * that fails is not unsaved work, and putting "Not saved" in the header for
   * one tells you to worry about something that was never being written.
   */
  const mutate = useCallback(async (fn, apply, { silent, tracksSave = true } = {}) => {
    if (tracksSave) setSaveState('saving');
    try {
      const res = await fn();
      apply?.(res);
      if (tracksSave) setSaveState('saved');
      if (!silent && res?.message) notify(res.message, 'ok');
      return res;
    } catch (err) {
      if (tracksSave) setSaveState('failed');
      notify(err.message, 'error');
      throw err;
    }
  }, [notify]);

  // Every production mutation returns the whole production, so one setter covers them all.
  const applyProduction = useCallback((res) => {
    if (res?.data) setProduction(res.data);
  }, []);

  const refreshProductions = useCallback(async () => {
    setProductions(await api.listProductions());
  }, []);

  /** Switch the open production. The backend remembers it across restarts. */
  const openProduction = useCallback(async (id) => {
    const res = await api.openProduction(id);
    setProduction(res.data);
    setProductions(await api.listProductions());
    return res.data;
  }, []);

  const createProduction = useCallback(async (body) => {
    const res = await mutateRef.current(() => api.createProduction(body), null);
    setProduction(res.data);
    setProductions(await api.listProductions());
    return res.data;
  }, []);

  const refreshLibrary = useCallback(async () => {
    const library = await api.library();
    setCollections((c) => ({ ...c, library }));
  }, []);

  const refreshPeople = useCallback(async () => {
    const people = await api.people();
    setCollections((c) => ({ ...c, people }));
  }, []);

  // createProduction needs mutate, which is defined below it; a ref keeps the
  // callback stable without reordering the file.
  mutateRef.current = mutate;

  const value = {
    status, error, loadErrors, reload: load,
    // Where to land when a production is opened from somewhere that knows which
    // stage the work is actually stuck at. Consumed once, then cleared, so it
    // never hijacks a later navigation.
    pendingStage, setPendingStage,
    // Which view to open inside Plan. Sending someone to a page that opens on
    // a different tab than the thing they clicked reads as the thing being gone.
    pendingView, setPendingView,
    // A date to open the calendar on, so a day you clicked lands on that day.
    pendingDate, setPendingDate,
    // A campaign to open Plan on. Going UP from a production has to land on
    // that production's campaign, not at the top of a list of all of them.
    pendingCampaign, setPendingCampaign,
    // The program in view, the mode it maps to, and the predicate every
    // list must use to filter by it.
    scope, setScope, scopeMode, inScope, grantedPrograms,
    productions, refreshProductions, openProduction, createProduction,
    workspace, setWorkspace, loadWorkspace,
    production, setProduction, applyProduction,
    collections, refreshPeople, refreshLibrary,
    meta, health,
    saveState, mutate, notify, toast,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used inside StudioProvider');
  return ctx;
}

