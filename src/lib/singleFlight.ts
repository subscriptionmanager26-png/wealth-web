/** Coalesce concurrent async work — callers share one in-flight promise. */
export function singleFlight<T>(store: { current: Promise<T> | null }, fn: () => Promise<T>): Promise<T> {
  if (store.current) return store.current;
  store.current = fn().finally(() => {
    store.current = null;
  });
  return store.current;
}
