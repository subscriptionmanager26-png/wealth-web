/**
 * Per-scheme NAV history cache for web — IndexedDB (localStorage quota is too small for full histories).
 */
type NavPoint = { t: number; nav: number };

const DB_NAME = "wealth-web-nav-series";
const DB_VERSION = 1;
const STORE = "series";
const EDGE_SLACK_MS = 2 * 86400000;

type StoredNavSeries = {
  version: 1;
  amfi: string;
  updatedAt: string;
  points: NavPoint[];
};

function storageKey(amfi: string): string {
  return `nav:${amfi}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
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
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function idbSet(key: string, value: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function seriesCoversRange(pts: NavPoint[], fromMs: number, toMs: number): boolean {
  if (!pts.length) return false;
  return pts[0]!.t <= fromMs + EDGE_SLACK_MS && pts[pts.length - 1]!.t >= toMs - EDGE_SLACK_MS;
}

function parseSeries(raw: string | null, amfi: string): NavPoint[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredNavSeries;
    if (parsed?.version !== 1 || parsed.amfi !== amfi || !Array.isArray(parsed.points)) return null;
    const points = parsed.points
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.nav) && p.nav > 0)
      .sort((a, b) => a.t - b.t);
    return points.length ? points : null;
  } catch {
    return null;
  }
}

export async function loadPersistedNavSeries(amfi: string): Promise<NavPoint[] | null> {
  const id = String(amfi ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  const raw = await idbGet(storageKey(id));
  return parseSeries(raw, id);
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

  const existing = await loadPersistedNavSeries(id);
  const merged = mergePersistedNavPoints(existing, sorted);

  const payload: StoredNavSeries = {
    version: 1,
    amfi: id,
    updatedAt: new Date().toISOString(),
    points: merged,
  };
  try {
    await idbSet(storageKey(id), JSON.stringify(payload));
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
