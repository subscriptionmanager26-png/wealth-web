import {
  parseUpvalyMetric,
  type UpvalyFundReturn,
  type UpvalyMfHolding,
  type UpvalySchemeDetail,
} from "@mobile/utils/upvalyMfApi";
import type { TimePeriod } from "../components/screenerTypes";

export type ScreenerSnapshot = {
  generatedAt: string;
  fetchedAt?: string;
  source: string;
  fundCount: number;
  fetched: number;
  failed: string[];
  funds: Record<string, UpvalySnapshotRawScheme>;
};

export type ScreenerSnapshotMeta = {
  generatedAt: string;
  fetchedAt?: string;
  source: string;
  fundCount: number;
  fetched: number;
  failedCount?: number;
};

/** Raw `data` object from Upvaly scheme-code API. */
export type UpvalySnapshotRawScheme = {
  schemeCode?: string;
  schemeName?: string;
  schemeCategory?: string;
  schemeCategoryLabel?: string;
  aum?: string | number;
  expenseRatio?: string | number;
  inceptionDate?: string;
  cagr?: Record<string, string | number>;
  fundamentals?: {
    pe?: string;
    pb?: string;
    priceToSale?: string;
  };
  holdings?: UpvalyMfHolding[];
  ranks?: { timeframe?: string; annualizedReturn?: number; rankInCategory?: string }[];
  rollingReturns?: {
    timeframe?: string;
    averageReturn?: number;
    medianReturn?: number;
  }[];
  riskMetrics?: {
    returns?: { timeframes?: { timeframe?: string; value?: string }[] };
    riskStandardDeviation?: {
      timeframes?: { timeframe?: string; value?: string; categoryAverage?: string }[];
    };
    sharpRatio?: {
      timeframes?: { timeframe?: string; value?: string; categoryAverage?: string }[];
    };
    sortinoRatio?: {
      timeframes?: { timeframe?: string; value?: string; categoryAverage?: string }[];
    };
  };
};

export type ScreenerSchemeMetrics = UpvalySchemeDetail & {
  rollingByPeriod: Partial<Record<TimePeriod, { average: number; median: number }>>;
  /** 3Y std dev (%). */
  volatility3y?: number | null;
  sharpe3y?: number | null;
  sortino3y?: number | null;
  categoryRank3y?: number | null;
};

const DB_NAME = "wealth-web-screener";
const DB_VERSION = 1;
const STORE = "snapshots";
const CACHE_KEY = "latest";
const VERSION_LOCAL_KEY = "wealth_web_screener_snapshot_version_v1";
const META_CHECK_KEY = "wealth_web_screener_meta_checked_at_v1";
const META_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const ROLLING_TF_MAP: Record<string, TimePeriod> = {
  "1M": "1m",
  "3M": "3m",
  "6M": "6m",
  "1Y": "1y",
  "3Y": "3y",
  "5Y": "5y",
  "10Y": "10y",
};

const ANNUALIZED_KEYS = new Set(["1y", "2y", "3y", "5y", "7y", "10y", "inception"]);

function normalizeTf(raw?: string | null): string | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === "ytd") return "ytd";
  if (s === "inception") return "inception";
  const m = s.match(/^(\d+)([wmy])$/);
  if (m) return `${m[1]}${m[2]}`;
  return s;
}

function tfLabel(key: string): string {
  if (key === "ytd") return "YTD";
  if (key === "inception") return "Since inception";
  const m = key.match(/^(\d+)([wmy])$/);
  if (!m) return key.toUpperCase();
  const unit = m[2] === "w" ? "W" : m[2] === "m" ? "M" : "Y";
  return `${m[1]}${unit}`;
}

function parseReturnsByTimeframe(data: UpvalySnapshotRawScheme): Record<string, UpvalyFundReturn> {
  const out: Record<string, UpvalyFundReturn> = {};
  for (const row of data.ranks ?? []) {
    const key = normalizeTf(row.timeframe);
    if (!key || row.annualizedReturn == null || !Number.isFinite(row.annualizedReturn)) continue;
    out[key] = {
      timeframe: key,
      label: tfLabel(key),
      valuePct: row.annualizedReturn,
      kind: ANNUALIZED_KEYS.has(key) ? "annualized" : "absolute",
    };
  }
  for (const row of data.riskMetrics?.returns?.timeframes ?? []) {
    const key = normalizeTf(row.timeframe);
    const valuePct = parseUpvalyMetric(row.value);
    if (!key || valuePct == null) continue;
    out[key] = {
      timeframe: key,
      label: tfLabel(key),
      valuePct,
      kind: ANNUALIZED_KEYS.has(key) ? "annualized" : "absolute",
    };
  }
  return out;
}

function parseCagrByPeriod(cagr?: Record<string, string | number>) {
  if (!cagr || typeof cagr !== "object") return undefined;
  const out: NonNullable<UpvalySchemeDetail["cagrByPeriod"]> = {};
  for (const key of ["1y", "3y", "5y", "7y", "10y"] as const) {
    const value = parseUpvalyMetric(cagr[key]);
    if (value != null) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseRiskStdDev(data: UpvalySnapshotRawScheme) {
  const out: NonNullable<UpvalySchemeDetail["riskStdDevByTimeframe"]> = {};
  for (const row of data.riskMetrics?.riskStandardDeviation?.timeframes ?? []) {
    const key = normalizeTf(row.timeframe);
    if (!key) continue;
    out[key] = {
      timeframe: key,
      value: parseUpvalyMetric(row.value),
      categoryAverage: parseUpvalyMetric(row.categoryAverage),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

function parseRollingByPeriod(data: UpvalySnapshotRawScheme): ScreenerSchemeMetrics["rollingByPeriod"] {
  const out: ScreenerSchemeMetrics["rollingByPeriod"] = {};
  for (const row of data.rollingReturns ?? []) {
    const period = ROLLING_TF_MAP[String(row.timeframe ?? "").toUpperCase()];
    if (!period) continue;
    if (row.averageReturn == null || !Number.isFinite(row.averageReturn)) continue;
    out[period] = {
      average: row.averageReturn,
      median: row.medianReturn ?? row.averageReturn,
    };
  }
  return out;
}

function parseRiskMetric3y(
  timeframes?: { timeframe?: string; value?: string }[],
): number | null {
  const row = timeframes?.find((t) => normalizeTf(t.timeframe) === "3y");
  return parseUpvalyMetric(row?.value);
}

function parseCategoryRank3y(data: UpvalySnapshotRawScheme): number | null {
  const row = data.ranks?.find((r) => String(r.timeframe ?? "").toUpperCase() === "3Y");
  if (!row?.rankInCategory) return null;
  const n = Number(String(row.rankInCategory).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function parseSchemeFromSnapshot(
  amfiCode: string,
  raw: UpvalySnapshotRawScheme | undefined,
): ScreenerSchemeMetrics | null {
  if (!raw) return null;
  return {
    schemeCode: String(raw.schemeCode ?? amfiCode),
    schemeName: String(raw.schemeName ?? ""),
    schemeCategory: raw.schemeCategory,
    schemeCategoryLabel: raw.schemeCategoryLabel,
    aumCr: parseUpvalyMetric(raw.aum),
    expenseRatio: parseUpvalyMetric(raw.expenseRatio),
    inceptionDate: raw.inceptionDate ? String(raw.inceptionDate) : undefined,
    cagrByPeriod: parseCagrByPeriod(raw.cagr),
    riskStdDevByTimeframe: parseRiskStdDev(raw),
    fundamentals: raw.fundamentals,
    holdings: raw.holdings,
    returnsByTimeframe: parseReturnsByTimeframe(raw),
    rollingByPeriod: parseRollingByPeriod(raw),
    volatility3y: parseRiskStdDev(raw)?.["3y"]?.value ?? null,
    sharpe3y: parseRiskMetric3y(raw.riskMetrics?.sharpRatio?.timeframes),
    sortino3y: parseRiskMetric3y(raw.riskMetrics?.sortinoRatio?.timeframes),
    categoryRank3y: parseCategoryRank3y(raw),
  };
}

export function buildMetricsIndex(snapshot: ScreenerSnapshot): Record<string, ScreenerSchemeMetrics> {
  const out: Record<string, ScreenerSchemeMetrics> = {};
  for (const [code, raw] of Object.entries(snapshot.funds)) {
    const parsed = parseSchemeFromSnapshot(code, raw);
    if (parsed) out[code] = parsed;
  }
  return out;
}

function versionKey(meta: ScreenerSnapshotMeta): string {
  return `${meta.generatedAt}|${meta.fetched}|${meta.fundCount}`;
}

function versionKeyFromSnapshot(snapshot: ScreenerSnapshot): string {
  return `${snapshot.generatedAt}|${snapshot.fetched}|${snapshot.fundCount}`;
}

function metaFromSnapshot(snapshot: ScreenerSnapshot): ScreenerSnapshotMeta {
  return {
    generatedAt: snapshot.generatedAt,
    fetchedAt: snapshot.fetchedAt,
    source: snapshot.source,
    fundCount: snapshot.fundCount,
    fetched: snapshot.fetched,
    failedCount: snapshot.failed?.length ?? 0,
  };
}

function readLocalVersion(): string | null {
  try {
    return localStorage.getItem(VERSION_LOCAL_KEY);
  } catch {
    return null;
  }
}

function writeLocalVersion(meta: ScreenerSnapshotMeta): void {
  try {
    localStorage.setItem(VERSION_LOCAL_KEY, versionKey(meta));
  } catch {
    /* ignore */
  }
}

function readLastMetaCheckMs(): number | null {
  try {
    const raw = localStorage.getItem(META_CHECK_KEY);
    if (!raw) return null;
    const t = Number(raw);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function writeLastMetaCheckMs(ms: number): void {
  try {
    localStorage.setItem(META_CHECK_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

function shouldCheckRemoteMeta(now = Date.now()): boolean {
  const lastCheck = readLastMetaCheckMs();
  if (lastCheck == null) return false;
  return now - lastCheck >= META_CHECK_INTERVAL_MS;
}

function ensureMetaCheckSeededFromCache(snapshot: ScreenerSnapshot): void {
  if (readLastMetaCheckMs() != null) return;
  writeLastMetaCheckMs(Date.now());
  const meta = metaFromSnapshot(snapshot);
  if (!readLocalVersion()) writeLocalVersion(meta);
}

async function refreshScreenerSnapshotIfRemoteChanged(cached: ScreenerSnapshot): Promise<void> {
  if (!shouldCheckRemoteMeta()) return;

  writeLastMetaCheckMs(Date.now());

  try {
    const remoteMeta = await fetchRemoteMeta();
    const remoteVersion = versionKey(remoteMeta);
    const localVersion = readLocalVersion();
    if (localVersion === remoteVersion) return;
    if (
      cached.generatedAt === remoteMeta.generatedAt &&
      cached.fetched === remoteMeta.fetched &&
      cached.fundCount === remoteMeta.fundCount
    ) {
      writeLocalVersion(remoteMeta);
      return;
    }
    const remote = await fetchRemoteSnapshot();
    await writeCachedSnapshot(remote);
  } catch {
    /* background check is best-effort; next attempt after META_CHECK_INTERVAL_MS */
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function readCachedSnapshot(): Promise<ScreenerSnapshot | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(CACHE_KEY);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
      req.onsuccess = () => resolve((req.result as ScreenerSnapshot | undefined) ?? null);
    });
  } catch {
    return null;
  }
}

async function writeCachedSnapshot(snapshot: ScreenerSnapshot): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
      tx.objectStore(STORE).put(snapshot, CACHE_KEY);
    });
    writeLocalVersion({
      generatedAt: snapshot.generatedAt,
      fetchedAt: snapshot.fetchedAt,
      source: snapshot.source,
      fundCount: snapshot.fundCount,
      fetched: snapshot.fetched,
      failedCount: snapshot.failed?.length ?? 0,
    });
  } catch {
    /* cache is best-effort */
  }
}

async function fetchRemoteMeta(): Promise<ScreenerSnapshotMeta> {
  const res = await fetch("/screener-snapshot-meta.json", { cache: "no-cache" });
  if (res.ok) {
    return (await res.json()) as ScreenerSnapshotMeta;
  }

  const res2 = await fetch("/screener-snapshot.json", {
    headers: { Range: "bytes=0-4095" },
    cache: "no-cache",
  });
  if (!res2.ok) throw new Error(`Failed to load screener snapshot meta (${res2.status})`);
  const prefix = await res2.text();
  const generatedAt = prefix.match(/"generatedAt"\s*:\s*"([^"]+)"/)?.[1];
  const fetchedAt = prefix.match(/"fetchedAt"\s*:\s*"([^"]+)"/)?.[1];
  const fundCount = Number(prefix.match(/"fundCount"\s*:\s*(\d+)/)?.[1]);
  const fetched = Number(prefix.match(/"fetched"\s*:\s*(\d+)/)?.[1]);
  const source = prefix.match(/"source"\s*:\s*"([^"]+)"/)?.[1];
  if (!generatedAt || !Number.isFinite(fundCount) || !Number.isFinite(fetched)) {
    throw new Error("Failed to parse screener snapshot version");
  }
  return {
    generatedAt,
    fetchedAt,
    fundCount,
    fetched,
    source: source ?? "",
  };
}

async function fetchRemoteSnapshot(): Promise<ScreenerSnapshot> {
  const res = await fetch("/screener-snapshot.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load screener snapshot (${res.status})`);
  return (await res.json()) as ScreenerSnapshot;
}

export async function loadScreenerSnapshot(): Promise<ScreenerSnapshot> {
  const cached = await readCachedSnapshot();
  if (cached && Object.keys(cached.funds ?? {}).length > 0) {
    ensureMetaCheckSeededFromCache(cached);
    if (shouldCheckRemoteMeta()) {
      void refreshScreenerSnapshotIfRemoteChanged(cached);
    }
    return cached;
  }

  const remoteMeta = await fetchRemoteMeta();
  writeLastMetaCheckMs(Date.now());
  const remoteVersion = versionKey(remoteMeta);
  const localVersion = readLocalVersion();

  if (cached && localVersion === remoteVersion) {
    return cached;
  }

  if (
    cached &&
    cached.generatedAt === remoteMeta.generatedAt &&
    cached.fetched === remoteMeta.fetched &&
    cached.fundCount === remoteMeta.fundCount
  ) {
    writeLocalVersion(remoteMeta);
    return cached;
  }

  const remote = await fetchRemoteSnapshot();
  await writeCachedSnapshot(remote);
  return remote;
}

export function formatSnapshotDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
