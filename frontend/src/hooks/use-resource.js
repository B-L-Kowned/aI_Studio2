import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Load something for a page, and keep it loadable.
 *
 * Every page did `useEffect(() => { load(); }, [load])` with no catch, so a
 * failed request became an unhandled rejection and the page said "Loading…"
 * forever. This keeps the error, and only the NEWEST request may set state:
 * a slow response to an old request can no longer overwrite a newer one.
 *
 * `reload` never throws — the error is in `error` — so it is safe to call
 * after a mutation or from a timer.
 */
export function useResource(fetcher, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const n = ++latest.current;
    try {
      const value = await fetcher();
      if (n === latest.current) { setData(value); setError(null); }
      return value;
    } catch (err) {
      if (n === latest.current) setError(err);
      return undefined;
    }
  }, deps);

  useEffect(() => { reload(); }, [reload]);

  return { data, error, reload, setData };
}
