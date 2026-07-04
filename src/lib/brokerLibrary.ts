import type { ParsedBrokerHoldings } from "./brokerHoldings/types";
import type { BrokerId } from "./brokers";
import { safeLocalStorageSet } from "./safeLocalStorage";

export type SavedBrokerSync = {
  id: string;
  brokerId: BrokerId;
  syncedAt: string;
  label: string;
  data: ParsedBrokerHoldings;
};

const DB_NAME = "wealth-web-broker";
const DB_VERSION = 1;
const STORE = "syncs";
const INDEX_KEY = "wealth_web_broker_index_v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
  });
}

type StoredDoc = SavedBrokerSync;

function loadIndex(): Omit<SavedBrokerSync, "data">[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Omit<SavedBrokerSync, "data">[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveIndex(rows: Omit<SavedBrokerSync, "data">[]): boolean {
  return safeLocalStorageSet(INDEX_KEY, JSON.stringify(rows));
}

export async function listBrokerSyncs(): Promise<SavedBrokerSync[]> {
  const index = loadIndex();
  const db = await openDb();
  const out: SavedBrokerSync[] = [];
  for (const row of index) {
    const doc = await new Promise<StoredDoc | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(row.id);
      req.onsuccess = () => resolve((req.result as StoredDoc | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (doc) out.push(doc);
  }
  db.close();
  return out;
}

export async function saveBrokerSync(
  brokerId: BrokerId,
  label: string,
  data: ParsedBrokerHoldings,
): Promise<SavedBrokerSync> {
  const existing = loadIndex().find((r) => r.brokerId === brokerId);
  const id = existing?.id ?? `${brokerId}-${Date.now()}`;
  const syncedAt = new Date().toISOString();
  const row: SavedBrokerSync = { id, brokerId, syncedAt, label, data };
  const meta = { id, brokerId, syncedAt, label };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  const index = loadIndex().filter((r) => r.brokerId !== brokerId);
  index.unshift(meta);
  saveIndex(index);
  return row;
}

export async function removeBrokerSync(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  saveIndex(loadIndex().filter((r) => r.id !== id));
}
