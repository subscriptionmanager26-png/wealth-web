import {
  BENCHMARK_IDS_WITH_API,
  BENCHMARK_NIFTY_INDEX_NAMES,
  type BenchmarkDailyPoint,
  type BenchmarkDailySeries,
  type BenchmarkId,
  type BenchmarkMonthEndPoint,
} from "@mobile/utils/benchmarkTypes";
import {
  loadBenchmarkMeta,
  loadBenchmarkSeries,
  markBenchmarkSeedApplied,
  mergeBenchmarkDailyPoints,
  saveBenchmarkMeta,
  saveBenchmarkSeries,
  wasBenchmarkSeedApplied,
} from "@mobile/utils/benchmarkSeriesCache";
import { fetchNiftyTotalReturnIndex } from "./niftyBenchmarkApi.web";
import { singleFlight } from "../lib/singleFlight";

/** Web uses GitHub-hosted benchmark-seed.json (refreshed daily in CI) — no live Nifty calls in the browser. */
const WEB_USE_LIVE_NIFTY_REFRESH = false;
const SEED_VERSION_KEY = "wealth_web_benchmark_seed_version_v1";
const SEED_META_CHECK_KEY = "wealth_web_benchmark_seed_meta_checked_at_v1";
const SEED_META_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const BENCHMARK_STALE_MS = 12 * 60 * 60 * 1000;
const HISTORY_START = new Date(2000, 0, 1, 12, 0, 0, 0);
const REFRESH_OVERLAP_DAYS = 14;

type BenchmarkSeedFile = {
  version: 1;
  generatedAt: string;
  indices: Partial<Record<BenchmarkId, Array<[number, number]>>>;
};

type BenchmarkSeedMeta = {
  generatedAt: string;
  fetchedAt?: string;
  indexCount?: number;
  fetched?: number;
};

let benchmarkSeedCache: BenchmarkSeedFile | null = null;
let benchmarkSeedPromise: Promise<BenchmarkSeedFile | null> | null = null;

function readLocalSeedVersion(): string | null {
  try {
    return localStorage.getItem(SEED_VERSION_KEY);
  } catch {
    return null;
  }
}

function writeLocalSeedVersion(version: string): void {
  try {
    localStorage.setItem(SEED_VERSION_KEY, version);
  } catch {
    /* ignore */
  }
}

function readLastSeedMetaCheckMs(): number | null {
  try {
    const raw = localStorage.getItem(SEED_META_CHECK_KEY);
    if (!raw) return null;
    const t = Number(raw);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function writeLastSeedMetaCheckMs(ms: number): void {
  try {
    localStorage.setItem(SEED_META_CHECK_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

function shouldCheckRemoteSeedMeta(now = Date.now()): boolean {
  const lastCheck = readLastSeedMetaCheckMs();
  if (lastCheck == null) return false;
  return now - lastCheck >= SEED_META_CHECK_INTERVAL_MS;
}

function ensureSeedMetaCheckSeeded(): void {
  if (readLastSeedMetaCheckMs() != null) return;
  writeLastSeedMetaCheckMs(Date.now());
}

async function fetchRemoteSeedMeta(): Promise<BenchmarkSeedMeta | null> {
  const res = await fetch("/benchmark-seed-meta.json", { cache: "no-cache" });
  if (!res.ok) return null;
  return (await res.json()) as BenchmarkSeedMeta;
}

function pointsFromSeedTuples(tuples: Array<[number, number]> | undefined): BenchmarkDailyPoint[] {
  if (!Array.isArray(tuples)) return [];
  return tuples
    .map(([t, tri]) => ({ t, tri }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.tri) && p.tri > 0)
    .sort((a, b) => a.t - b.t);
}

async function applySeedFile(seed: BenchmarkSeedFile): Promise<void> {
  for (const id of BENCHMARK_IDS_WITH_API) {
    const seedPts = pointsFromSeedTuples(seed.indices?.[id]);
    if (!seedPts.length) continue;
    const indexName = BENCHMARK_NIFTY_INDEX_NAMES[id] ?? id;
    await saveBenchmarkSeries(id, {
      version: 1,
      id,
      indexName,
      updatedAt: seed.generatedAt,
      points: seedPts,
    });
  }
  await saveBenchmarkMeta(seed.generatedAt);
  writeLocalSeedVersion(seed.generatedAt);
  benchmarkSeedCache = seed;
}

async function syncBenchmarkSeedFromStatic(force = false): Promise<void> {
  const seed = await loadBenchmarkSeed();
  if (!seed) return;
  const localVersion = readLocalSeedVersion();
  if (!force && localVersion === seed.generatedAt) return;
  await applySeedFile(seed);
}

async function refreshBenchmarkSeedIfRemoteChanged(): Promise<boolean> {
  if (!shouldCheckRemoteSeedMeta()) return false;
  writeLastSeedMetaCheckMs(Date.now());

  try {
    const remoteMeta = await fetchRemoteSeedMeta();
    if (!remoteMeta?.generatedAt) return false;
    if (readLocalSeedVersion() === remoteMeta.generatedAt) return false;

    const res = await fetch("/benchmark-seed.json", { cache: "no-cache" });
    if (!res.ok) return false;
    const seed = (await res.json()) as BenchmarkSeedFile;
    if (!seed?.generatedAt || seed.generatedAt !== remoteMeta.generatedAt) return false;

    await applySeedFile(seed);
    return true;
  } catch {
    return false;
  }
}

async function loadBenchmarkSeed(): Promise<BenchmarkSeedFile | null> {
  if (benchmarkSeedCache) return benchmarkSeedCache;
  if (!benchmarkSeedPromise) {
    benchmarkSeedPromise = fetch("/benchmark-seed.json")
      .then(async (res) => {
        if (!res.ok) throw new Error(`benchmark-seed.json fetch failed (${res.status})`);
        return (await res.json()) as BenchmarkSeedFile;
      })
      .then((seed) => {
        benchmarkSeedCache = seed;
        return seed;
      })
      .catch(() => null);
  }
  return benchmarkSeedPromise;
}

function dayNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

async function seedPointsFor(id: BenchmarkId): Promise<BenchmarkDailyPoint[]> {
  const seed = await loadBenchmarkSeed();
  const tuples = seed?.indices?.[id];
  if (!Array.isArray(tuples)) return [];
  return tuples
    .map(([t, tri]) => ({ t, tri }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.tri) && p.tri > 0)
    .sort((a, b) => a.t - b.t);
}

function triOnOrBefore(daily: BenchmarkDailyPoint[], targetMs: number): number | null {
  if (!daily.length) return null;
  let lo = 0;
  let hi = daily.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = daily[mid]!.t;
    if (t <= targetMs) {
      ans = daily[mid]!.tri;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function dailyTriToNav100Series(
  daily: BenchmarkDailyPoint[],
  monthEnds: BenchmarkMonthEndPoint[],
): BenchmarkMonthEndPoint[] {
  if (!daily.length || !monthEnds.length) return [];
  const baseTri = triOnOrBefore(daily, monthEnds[0]!.date.getTime());
  if (baseTri == null || baseTri <= 0) return [];
  return daily.map((p) => ({
    date: dayNoon(new Date(p.t)),
    nav100: (p.tri / baseTri) * 100,
  }));
}

export function dailyTriToMonthEndNav100(points: BenchmarkDailyPoint[]): BenchmarkMonthEndPoint[] {
  if (!points.length) return [];
  const byMonth = new Map<string, { date: Date; tri: number }>();
  for (const p of points) {
    const d = new Date(p.t);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const date = dayNoon(d);
    const prev = byMonth.get(key);
    if (!prev || p.t > prev.date.getTime()) {
      byMonth.set(key, { date, tri: p.tri });
    }
  }
  const months = [...byMonth.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  const baseTri = months[0]!.tri;
  if (baseTri <= 0) return [];
  return months.map((m) => ({
    date: m.date,
    nav100: (m.tri / baseTri) * 100,
  }));
}

export function isBenchmarkCacheStale(updatedAt: string | undefined, nowMs = Date.now()): boolean {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= BENCHMARK_STALE_MS;
}

async function applySeedIfNeeded(id: BenchmarkId): Promise<BenchmarkDailySeries | null> {
  const existing = await loadBenchmarkSeries(id);
  if (existing?.points.length) return existing;

  const seedPts = await seedPointsFor(id);
  if (!seedPts.length) return null;

  const indexName = BENCHMARK_NIFTY_INDEX_NAMES[id] ?? id;
  const seed = await loadBenchmarkSeed();
  if (!seed) return null;
  const series: BenchmarkDailySeries = {
    version: 1,
    id,
    indexName,
    updatedAt: seed.generatedAt,
    points: seedPts,
  };
  await saveBenchmarkSeries(id, series);
  return series;
}

async function fetchAndMergeBenchmark(id: BenchmarkId, from: Date, to: Date): Promise<BenchmarkDailySeries | null> {
  const indexName = BENCHMARK_NIFTY_INDEX_NAMES[id];
  if (!indexName) return null;

  const existing = (await loadBenchmarkSeries(id)) ?? (await applySeedIfNeeded(id));
  const incoming = await fetchNiftyTotalReturnIndex(indexName, from, to);
  if (!incoming.length && !existing?.points.length) return null;

  const merged = mergeBenchmarkDailyPoints(existing?.points, incoming);
  const series: BenchmarkDailySeries = {
    version: 1,
    id,
    indexName,
    updatedAt: new Date().toISOString(),
    points: merged,
  };
  await saveBenchmarkSeries(id, series);
  return series;
}

export async function ensureBenchmarkDataLoaded(): Promise<Partial<Record<BenchmarkId, BenchmarkDailySeries>>> {
  const out: Partial<Record<BenchmarkId, BenchmarkDailySeries>> = {};
  let seededAny = false;

  for (const id of BENCHMARK_IDS_WITH_API) {
    let series = await loadBenchmarkSeries(id);
    if (!series?.points.length) {
      series = await applySeedIfNeeded(id);
      if (series?.points.length) seededAny = true;
    }
    if (series) out[id] = series;
  }

  if (seededAny && !(await wasBenchmarkSeedApplied())) {
    await markBenchmarkSeedApplied();
  }

  return out;
}

async function refreshBenchmarkSeriesIfStaleInner(
  force = false,
): Promise<Partial<Record<BenchmarkId, BenchmarkDailySeries>> | null> {
  if (!WEB_USE_LIVE_NIFTY_REFRESH) {
    ensureSeedMetaCheckSeeded();
    if (shouldCheckRemoteSeedMeta()) {
      void refreshBenchmarkSeedIfRemoteChanged();
    }
    return null;
  }

  const meta = await loadBenchmarkMeta();
  if (!force && meta && !isBenchmarkCacheStale(meta.lastRefreshAt)) {
    return null;
  }

  const now = dayNoon(new Date());
  const out: Partial<Record<BenchmarkId, BenchmarkDailySeries>> = {};

  for (const id of BENCHMARK_IDS_WITH_API) {
    const existing = (await loadBenchmarkSeries(id)) ?? (await applySeedIfNeeded(id));
    const lastT = existing?.points[existing.points.length - 1]?.t;
    const from =
      lastT != null
        ? dayNoon(new Date(lastT - REFRESH_OVERLAP_DAYS * 86400000))
        : HISTORY_START;
    try {
      const series = await fetchAndMergeBenchmark(id, from, now);
      if (series) out[id] = series;
    } catch {
      if (existing) out[id] = existing;
    }
  }

  await saveBenchmarkMeta(new Date().toISOString());
  return out;
}

export async function loadBenchmarkMonthEndNav(): Promise<Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>> {
  const daily = await ensureBenchmarkDataLoaded();
  const out: Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>> = {};
  for (const id of BENCHMARK_IDS_WITH_API) {
    const pts = daily[id]?.points ?? [];
    const monthEnds = dailyTriToMonthEndNav100(pts);
    if (monthEnds.length) out[id] = monthEnds;
  }
  return out;
}

export async function loadBenchmarkDailyNav(): Promise<Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>> {
  const daily = await ensureBenchmarkDataLoaded();
  const out: Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>> = {};
  for (const id of BENCHMARK_IDS_WITH_API) {
    const pts = daily[id]?.points ?? [];
    const monthEnds = dailyTriToMonthEndNav100(pts);
    const series = dailyTriToNav100Series(pts, monthEnds);
    if (series.length) out[id] = series;
  }
  return out;
}

const refreshBenchmarkFlight: { current: Promise<Partial<Record<BenchmarkId, BenchmarkDailySeries>> | null> | null } =
  { current: null };

export function refreshBenchmarkSeriesIfStale(
  force = false,
): Promise<Partial<Record<BenchmarkId, BenchmarkDailySeries>> | null> {
  return singleFlight(refreshBenchmarkFlight, () => refreshBenchmarkSeriesIfStaleInner(force));
}

const warmBenchmarkFlight: {
  current: Promise<Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>> | null;
} = { current: null };

async function warmBenchmarkDataInner(): Promise<Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>> {
  await syncBenchmarkSeedFromStatic();
  await ensureBenchmarkDataLoaded();
  ensureSeedMetaCheckSeeded();
  if (shouldCheckRemoteSeedMeta()) {
    void refreshBenchmarkSeedIfRemoteChanged();
  }
  const daily = await ensureBenchmarkDataLoaded();
  const out: Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>> = {};
  for (const id of BENCHMARK_IDS_WITH_API) {
    const pts = daily[id]?.points ?? [];
    const monthEnds = dailyTriToMonthEndNav100(pts);
    if (monthEnds.length) out[id] = monthEnds;
  }
  return out;
}

export function warmBenchmarkData(): Promise<Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>> {
  return singleFlight(warmBenchmarkFlight, warmBenchmarkDataInner);
}
