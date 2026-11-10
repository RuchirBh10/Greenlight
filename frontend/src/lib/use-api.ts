"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "./session";

/**
 * Loads one API resource for the signed-in user.
 * Refetches when the user changes, when `reload()` is called, or when `refreshKey` changes
 * (pass something that changes when the data does, for example a review's updatedAt).
 */
export function useAsync<T>(load: () => Promise<T>, enabled = true, refreshKey?: unknown) {
  const user = useSession();
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const userId = user?.id;

  useEffect(() => {
    if (!userId || !enabled) { setState({ loading: false }); return; }
    let live = true;
    setState(s => ({ ...s, loading: true }));
    load().then(
      data => { if (live) setState({ data, loading: false }); },
      (e: unknown) => { if (live) setState({ error: e instanceof Error ? e.message : "Something went wrong.", loading: false }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, enabled, tick, refreshKey]);

  return { ...state, reload: useCallback(() => setTick(t => t + 1), []) };
}
