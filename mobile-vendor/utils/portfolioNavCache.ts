import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PortfolioAnalyticsSnapshot } from "./portfolioNavAnalytics";

const STORE_PORTFOLIO_NAV_CACHE = "cas_portfolio_nav_cache_v1";

export const PORTFOLIO_NAV_STALE_MS = 12 * 60 * 60 * 1000;

type SerializedMonthlyPoint = {
  date: string;
  navRaw: number;
  nav100: number;
  units: number;
  value: number;
};

type SerializedSnapshot = Omit<PortfolioAnalyticsSnapshot, "points"> & {
  points: SerializedMonthlyPoint[];
};

type NavCachePayload = {
  updatedAt: string;
  byProfile: Record<string, SerializedSnapshot>;
};

function serializeSnapshot(s: PortfolioAnalyticsSnapshot): SerializedSnapshot {
  return {
    ...s,
    points: s.points.map((p) => ({
      date: p.date.toISOString(),
      navRaw: p.navRaw,
      nav100: p.nav100,
      units: p.units,
      value: p.value,
    })),
  };
}

function deserializeSnapshot(s: SerializedSnapshot): PortfolioAnalyticsSnapshot {
  return {
    ...s,
    points: s.points.map((p) => ({
      date: new Date(p.date),
      navRaw: p.navRaw,
      nav100: p.nav100,
      units: p.units,
      value: p.value,
    })),
  };
}

export async function loadCachedPortfolioAnalytics(): Promise<{
  updatedAt: string;
  byProfile: Record<string, PortfolioAnalyticsSnapshot>;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(STORE_PORTFOLIO_NAV_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavCachePayload;
    if (!parsed?.updatedAt || !parsed.byProfile || typeof parsed.byProfile !== "object") return null;
    const byProfile: Record<string, PortfolioAnalyticsSnapshot> = {};
    for (const [k, v] of Object.entries(parsed.byProfile)) {
      byProfile[k] = deserializeSnapshot(v);
    }
    return { updatedAt: parsed.updatedAt, byProfile };
  } catch {
    return null;
  }
}

export async function saveCachedPortfolioAnalytics(
  byProfile: Record<string, PortfolioAnalyticsSnapshot>,
): Promise<string> {
  const updatedAt = new Date().toISOString();
  const payload: NavCachePayload = {
    updatedAt,
    byProfile: Object.fromEntries(
      Object.entries(byProfile).map(([k, v]) => [k, serializeSnapshot(v)]),
    ),
  };
  await AsyncStorage.setItem(STORE_PORTFOLIO_NAV_CACHE, JSON.stringify(payload));
  return updatedAt;
}

export function isPortfolioNavCacheStale(updatedAt: string | undefined, nowMs = Date.now()): boolean {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= PORTFOLIO_NAV_STALE_MS;
}
