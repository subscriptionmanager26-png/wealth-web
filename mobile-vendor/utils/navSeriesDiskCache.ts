import AsyncStorage from "@react-native-async-storage/async-storage";

type NavPoint = { t: number; nav: number };

const STORE_NAV_PREFIX = "cas_scheme_nav_v1:";
const EDGE_SLACK_MS = 2 * 86400000;

type StoredNavSeries = {
  version: 1;
  amfi: string;
  updatedAt: string;
  points: NavPoint[];
};

function storageKey(amfi: string): string {
  return `${STORE_NAV_PREFIX}${amfi}`;
}

function seriesCoversRange(pts: NavPoint[], fromMs: number, toMs: number): boolean {
  if (!pts.length) return false;
  return pts[0]!.t <= fromMs + EDGE_SLACK_MS && pts[pts.length - 1]!.t >= toMs - EDGE_SLACK_MS;
}

export async function loadPersistedNavSeries(amfi: string): Promise<NavPoint[] | null> {
  const id = String(amfi ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  try {
    const raw = await AsyncStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredNavSeries;
    if (parsed?.version !== 1 || !Array.isArray(parsed.points)) return null;
    const points = parsed.points
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.nav) && p.nav > 0)
      .sort((a, b) => a.t - b.t);
    return points.length ? points : null;
  } catch {
    return null;
  }
}

export async function loadPersistedNavSeriesForRange(
  amfi: string,
  fromMs: number,
  toMs: number,
): Promise<NavPoint[] | null> {
  const pts = await loadPersistedNavSeries(amfi);
  if (!pts?.length || !seriesCoversRange(pts, fromMs, toMs)) return null;
  return pts.filter((p) => p.t >= fromMs - EDGE_SLACK_MS && p.t <= toMs + EDGE_SLACK_MS);
}

export async function savePersistedNavSeries(amfi: string, points: NavPoint[]): Promise<void> {
  const id = String(amfi ?? "").trim();
  if (!/^\d+$/.test(id) || !points.length) return;
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.nav) && p.nav > 0)
    .sort((a, b) => a.t - b.t);
  if (!sorted.length) return;
  const payload: StoredNavSeries = {
    version: 1,
    amfi: id,
    updatedAt: new Date().toISOString(),
    points: sorted,
  };
  try {
    await AsyncStorage.setItem(storageKey(id), JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
}

export function mergePersistedNavPoints(existing: NavPoint[] | null, incoming: NavPoint[]): NavPoint[] {
  const byT = new Map<number, number>();
  for (const p of existing ?? []) byT.set(p.t, p.nav);
  for (const p of incoming) byT.set(p.t, p.nav);
  return [...byT.entries()].map(([t, nav]) => ({ t, nav })).sort((a, b) => a.t - b.t);
}
