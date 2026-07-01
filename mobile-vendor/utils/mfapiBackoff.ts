/**
 * mfapi.in retry schedule after a failed attempt (network, timeout, empty body).
 * Waits then retries: 1m → 5m → 10m → 30m → 1h → 2h → 4h → next day (24h).
 */

export const MFAPI_RETRY_WAIT_MS = [
  60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `tryOnce` until `isSuccess` or every wait in {@link MFAPI_RETRY_WAIT_MS} has been applied after failures.
 */
export async function fetchWithMfapiBackoff<T>(tryOnce: () => Promise<T>, isSuccess: (value: T) => boolean): Promise<T> {
  let result = await tryOnce();
  if (isSuccess(result)) return result;
  for (const waitMs of MFAPI_RETRY_WAIT_MS) {
    await sleep(waitMs);
    result = await tryOnce();
    if (isSuccess(result)) return result;
  }
  return result;
}
