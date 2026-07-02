/**
 * Web portfolio NAV cache — IndexedDB (large payloads exceed localStorage quota).
 * Migrates legacy localStorage key `cas_portfolio_nav_cache_v1` on first read.
 */
import type { PortfolioAnalyticsSnapshot } from "@mobile/utils/portfolioNavAnalytics";

const LEGACY_LOCAL_KEY = "cas_portfolio_nav_cache_v1";
const LOCAL_BACKUP_KEY = "wealth_web_portfolio_nav_backup_v1";
const LOCAL_META_KEY = "wealth_web_portfolio_nav_meta_v1";
const DB_NAME = "wealth-web-portfolio-nav";
const DB_VERSION = 1;
const STORE = "cache";
const CACHE_KEY = "v1";

export const PORTFOLIO_NAV_STALE_MS = 24 * 60 * 60 * 1000;

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

type NavCacheMeta = {
  updatedAt: string;
  familyPoints: number;
  profileIds: string[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

function idbGet(key: string): Promise<string | null> {
  return openDb().then(
    (db) =>
      new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        let result: string | null = null;
        req.onsuccess = () => {
          result = (req.result as string | undefined) ?? null;
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      }),
  );
}

async function idbSet(key: string, value: string): Promise<void> {
  await openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
      }),
  );
  const readBack = await idbGet(key);
  if (readBack !== value) {
    throw new Error("IndexedDB read-back verification failed");
  }
}

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

function parsePayload(raw: string): NavCachePayload | null {
  try {
    const parsed = JSON.parse(raw) as NavCachePayload;
    if (!parsed?.updatedAt || !parsed.byProfile || typeof parsed.byProfile !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function payloadFromProfiles(byProfile: Record<string, PortfolioAnalyticsSnapshot>, updatedAt: string): NavCachePayload {
  return {
    updatedAt,
    byProfile: Object.fromEntries(
      Object.entries(byProfile).map(([k, v]) => [k, serializeSnapshot(v)]),
    ),
  };
}

function writeMeta(payload: NavCachePayload): void {
  try {
    const meta: NavCacheMeta = {
      updatedAt: payload.updatedAt,
      familyPoints: payload.byProfile.family?.points.length ?? 0,
      profileIds: Object.keys(payload.byProfile),
    };
    localStorage.setItem(LOCAL_META_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

function readMeta(): NavCacheMeta | null {
  try {
    const raw = localStorage.getItem(LOCAL_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavCacheMeta;
    if (!parsed?.updatedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readLegacyLocalStorage(): Promise<string | null> {
  try {
    return localStorage.getItem(LEGACY_LOCAL_KEY);
  } catch {
    return null;
  }
}

async function readLocalBackup(): Promise<string | null> {
  try {
    return localStorage.getItem(LOCAL_BACKUP_KEY);
  } catch {
    return null;
  }
}

async function writeLocalBackup(raw: string): Promise<boolean> {
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, raw);
    return localStorage.getItem(LOCAL_BACKUP_KEY) === raw;
  } catch {
    return false;
  }
}

async function writeLegacyLocalStorage(raw: string): Promise<boolean> {
  try {
    localStorage.setItem(LEGACY_LOCAL_KEY, raw);
    return localStorage.getItem(LEGACY_LOCAL_KEY) === raw;
  } catch {
    return false;
  }
}

async function loadRawPayload(): Promise<string | null> {
  try {
    const fromIdb = await idbGet(CACHE_KEY);
    if (fromIdb) return fromIdb;
  } catch {
    /* fall through */
  }

  const backup = await readLocalBackup();
  if (backup) {
    try {
      await idbSet(CACHE_KEY, backup);
    } catch {
      /* still return backup */
    }
    return backup;
  }

  const legacy = await readLegacyLocalStorage();
  if (!legacy) return null;

  try {
    await idbSet(CACHE_KEY, legacy);
    localStorage.removeItem(LEGACY_LOCAL_KEY);
    await writeLocalBackup(legacy);
  } catch {
    /* keep legacy in localStorage if IDB write fails */
  }
  return legacy;
}

export async function loadCachedPortfolioAnalytics(): Promise<{
  updatedAt: string;
  byProfile: Record<string, PortfolioAnalyticsSnapshot>;
} | null> {
  try {
    const raw = await loadRawPayload();
    if (!raw) {
      const meta = readMeta();
      if (meta) {
        console.warn("[portfolioNavCache] meta exists but payload missing", meta);
      }
      return null;
    }
    const parsed = parsePayload(raw);
    if (!parsed) return null;
    const byProfile: Record<string, PortfolioAnalyticsSnapshot> = {};
    for (const [k, v] of Object.entries(parsed.byProfile)) {
      byProfile[k] = deserializeSnapshot(v);
    }
    writeMeta(parsed);
    return { updatedAt: parsed.updatedAt, byProfile };
  } catch (e) {
    console.warn("[portfolioNavCache] load failed", e);
    return null;
  }
}

export async function saveCachedPortfolioAnalytics(
  byProfile: Record<string, PortfolioAnalyticsSnapshot>,
): Promise<string> {
  const updatedAt = new Date().toISOString();
  const payload = payloadFromProfiles(byProfile, updatedAt);
  const raw = JSON.stringify(payload);

  let idbOk = false;
  try {
    await idbSet(CACHE_KEY, raw);
    idbOk = true;
  } catch (e) {
    console.warn("[portfolioNavCache] IndexedDB save failed", e);
  }

  if (idbOk) {
    try {
      localStorage.removeItem(LEGACY_LOCAL_KEY);
      localStorage.removeItem(LOCAL_BACKUP_KEY);
    } catch {
      /* ignore */
    }
  } else {
    const backupOk = await writeLocalBackup(raw);
    if (!backupOk) {
      throw new Error("Could not save portfolio NAV to device storage");
    }
    console.warn("[portfolioNavCache] saved to localStorage backup only — IndexedDB unavailable");
  }

  writeMeta(payload);
  return updatedAt;
}

export function readPortfolioNavCacheMeta(): NavCacheMeta | null {
  return readMeta();
}

export function isPortfolioNavCacheStale(updatedAt: string | undefined, nowMs = Date.now()): boolean {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= PORTFOLIO_NAV_STALE_MS;
}
