import AsyncStorage from "@react-native-async-storage/async-storage";

import type { BenchmarkDailyPoint, BenchmarkDailySeries, BenchmarkId } from "./benchmarkTypes";

const STORE_BENCHMARK_PREFIX = "cas_benchmark_tri_v1:";
const STORE_BENCHMARK_META = "cas_benchmark_tri_meta_v1";
const STORE_BENCHMARK_SEED_APPLIED = "cas_benchmark_seed_applied_v1";

type BenchmarkMeta = {
  version: 1;
  lastRefreshAt: string;
};

function storageKey(id: BenchmarkId): string {
  return `${STORE_BENCHMARK_PREFIX}${id}`;
}

export async function loadBenchmarkSeries(id: BenchmarkId): Promise<BenchmarkDailySeries | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BenchmarkDailySeries;
    if (parsed?.version !== 1 || !Array.isArray(parsed.points)) return null;
    const points = parsed.points
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.tri) && p.tri > 0)
      .sort((a, b) => a.t - b.t);
    if (!points.length) return null;
    return { ...parsed, points };
  } catch {
    return null;
  }
}

export async function saveBenchmarkSeries(id: BenchmarkId, series: BenchmarkDailySeries): Promise<void> {
  const points = [...series.points]
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.tri) && p.tri > 0)
    .sort((a, b) => a.t - b.t);
  if (!points.length) return;
  const payload: BenchmarkDailySeries = {
    version: 1,
    id,
    indexName: series.indexName,
    updatedAt: series.updatedAt,
    points,
  };
  try {
    await AsyncStorage.setItem(storageKey(id), JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
}

export function mergeBenchmarkDailyPoints(
  existing: BenchmarkDailyPoint[] | null | undefined,
  incoming: BenchmarkDailyPoint[],
): BenchmarkDailyPoint[] {
  const byT = new Map<number, number>();
  for (const p of existing ?? []) byT.set(p.t, p.tri);
  for (const p of incoming) byT.set(p.t, p.tri);
  return [...byT.entries()].map(([t, tri]) => ({ t, tri })).sort((a, b) => a.t - b.t);
}

export async function loadBenchmarkMeta(): Promise<BenchmarkMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(STORE_BENCHMARK_META);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BenchmarkMeta;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveBenchmarkMeta(lastRefreshAt: string): Promise<void> {
  const payload: BenchmarkMeta = { version: 1, lastRefreshAt };
  try {
    await AsyncStorage.setItem(STORE_BENCHMARK_META, JSON.stringify(payload));
  } catch {
    /* best-effort */
  }
}

export async function wasBenchmarkSeedApplied(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORE_BENCHMARK_SEED_APPLIED)) === "1";
  } catch {
    return false;
  }
}

export async function markBenchmarkSeedApplied(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORE_BENCHMARK_SEED_APPLIED, "1");
  } catch {
    /* best-effort */
  }
}
