import type { NavPoint } from "@mobile/utils/amfiResolveCore";

type RollingAggMethod = "average" | "median" | "percentile";

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

/** Monthly period returns (%) between consecutive NAV points in range. */
function monthlyReturnsInRange(series: NavPoint[], startMs: number, endMs: number): number[] {
  const pts = series
    .filter((p) => p.t >= startMs && p.t <= endMs)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return [];

  const byMonth = new Map<string, NavPoint>();
  for (const pt of pts) {
    const d = new Date(pt.t);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth.set(key, pt);
  }
  const monthKeys = [...byMonth.keys()].sort();
  const returns: number[] = [];
  for (let i = 1; i < monthKeys.length; i += 1) {
    const prev = byMonth.get(monthKeys[i - 1]!)!;
    const cur = byMonth.get(monthKeys[i]!)!;
    if (prev.nav <= 0) continue;
    const r = ((cur.nav / prev.nav) - 1) * 100;
    if (Number.isFinite(r)) returns.push(r);
  }
  return returns;
}

export function aggregateRollingReturns(
  returns: number[],
  method: RollingAggMethod,
  percentileValue: number,
): number | null {
  if (!returns.length) return null;
  if (method === "average") {
    return returns.reduce((a, b) => a + b, 0) / returns.length;
  }
  const sorted = [...returns].sort((a, b) => a - b);
  if (method === "median") {
    return percentile(sorted, 50);
  }
  return percentile(sorted, percentileValue);
}

export function computeRollingReturnFromNav(
  series: NavPoint[],
  startDateIso: string,
  method: RollingAggMethod,
  percentileValue: number,
): number | null {
  const startMs = new Date(`${startDateIso}T12:00:00`).getTime();
  if (!Number.isFinite(startMs)) return null;
  const endMs = Date.now();
  if (startMs >= endMs) return null;

  const returns = monthlyReturnsInRange(series, startMs, endMs);
  return aggregateRollingReturns(returns, method, percentileValue);
}
