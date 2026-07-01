/**
 * Live NAV helpers for AMFI scheme codes: NAV on/before a target calendar date.
 * Uses the same AMFI-primary + mfapi-fallback series as `fetchNavSeriesForAmfi` in `amfiResolveCore`.
 */

import { fetchNavSeriesForAmfi, type NavPoint } from "./amfiResolveCore";

const NAV_FETCH_CONCURRENCY = 10;

export type LiveNavPoint = {
  nav: number;
  actualDate: string;
};

function ddMmYyyyFromDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

/** Last NAV point on or before end of target calendar day (local). */
function liveNavFromSeries(pts: NavPoint[], targetDate: Date): LiveNavPoint | null {
  const endOfDay = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    23,
    59,
    59,
    999,
  ).getTime();
  let best: NavPoint | null = null;
  for (const p of pts) {
    if (p.t > endOfDay) continue;
    if (!best || p.t > best.t) best = p;
  }
  if (!best || !Number.isFinite(best.nav) || best.nav <= 0) return null;
  const d = new Date(best.t);
  return { nav: best.nav, actualDate: ddMmYyyyFromDate(d) };
}

/**
 * Returns AMFI -> latest available NAV point for target date (default: today), with market-holiday fallback.
 * Missing/failed codes are omitted from the map.
 */
export async function fetchLiveNavByAmfi(
  amfiCodes: string[],
  targetDate: Date = new Date(),
): Promise<Record<string, LiveNavPoint>> {
  const out: Record<string, LiveNavPoint> = {};
  const uniq = [...new Set(amfiCodes.map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))];
  const endMs = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    23,
    59,
    59,
    999,
  ).getTime();
  const startMs = endMs - 450 * 86400000;

  for (let i = 0; i < uniq.length; i += NAV_FETCH_CONCURRENCY) {
    const chunk = uniq.slice(i, i + NAV_FETCH_CONCURRENCY);
    const rows = await Promise.all(
      chunk.map(async (amfi) => {
        const series = await fetchNavSeriesForAmfi(amfi, { fromMs: startMs, toMs: endMs });
        const p = liveNavFromSeries(series, targetDate);
        return p ? ([amfi, p] as const) : null;
      }),
    );
    for (const r of rows) {
      if (!r) continue;
      out[r[0]] = r[1];
    }
  }
  return out;
}
