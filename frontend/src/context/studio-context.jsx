import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../services/api.js';

const StudioContext = createContext(null);

export function StudioProvider({ children }) {
  const mutateRef = React.useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
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
    try {
      const [w, h] = await Promise.all([api.workspace(), api.health()]);
      setWorkspace(w);
      setHealth(h);

      // Nothing else is fetched until the workspace is licensed and set up —
      // an un-onboarded install has no business loading a production.
      if (w.onboarded) {
        const [prod, list, people, campaigns, library, calendar, setup, startSources, editorTools, publishTargets] =
          await Promise.all([
            api.currentProduction(), api.listProductions(), api.people(), api.campaigns(), api.library(),
            api.calendar(), api.setup(), api.startSources(), api.editorTools(), api.publishTargets(),
          ]);
        setProduction(prod);
        setProductions(list);
        setCollections({ people, campaigns, library, calendar });
        setMeta({ setup, startSources, editorTools, publishTargets });
      }
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
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
    status, error, reload: load,
    // Where to land when a production is opened from somewhere that knows which
    // stage the work is actually stuck at. Consumed once, then cleared, so it
    // never hijacks a later navigation.
    pendingStage, setPendingStage,
    // Which view to open inside Plan. Sending someone to a page that opens on
    // a different tab than the thing they clicked reads as the thing being gone.
    pendingView, setPendingView,
    // A date to open the calendar on, so a day you clicked lands on that day.
    pendingDate, setPendingDate,
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

export const toSeconds = (t) => {
  const [m, s] = String(t).split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};

export const toClock = (secs) =>
  `${Math.floor(secs / 60)}:${String(Math.max(0, secs) % 60).padStart(2, '0')}`;
