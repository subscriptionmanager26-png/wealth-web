import type { StorageWriteResult } from "./deviceStorage";

const STORAGE_KEY = "wealth_web_mistral_api_key_v1";
const IDB_NAME = "wealth-web-settings";
const IDB_VERSION = 1;
const IDB_STORE = "kv";

function readLocalStorage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeLocalStorage(key: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, key);
    return localStorage.getItem(STORAGE_KEY) === key;
  } catch {
    return false;
  }
}

function removeLocalStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function migrateFromSessionStorage(): string {
  try {
    const legacy = sessionStorage.getItem(STORAGE_KEY)?.trim();
    if (!legacy) return "";
    if (writeLocalStorage(legacy)) {
      sessionStorage.removeItem(STORAGE_KEY);
      return legacy;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function readIndexedDb(): Promise<string> {
  try {
    const db = await openDb();
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(STORAGE_KEY);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
      req.onsuccess = () => resolve(((req.result as string | undefined) ?? "").trim());
    });
  } catch {
    return "";
  }
}

async function writeIndexedDb(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.objectStore(IDB_STORE).put(key, STORAGE_KEY);
  });
}

async function removeIndexedDb(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB remove failed"));
      tx.objectStore(IDB_STORE).delete(STORAGE_KEY);
    });
  } catch {
    /* ignore */
  }
}

/** Synchronous read for initial render — localStorage + one-time session migration. */
export function loadMistralApiKey(): string {
  const local = readLocalStorage();
  if (local) return local;
  return migrateFromSessionStorage();
}

/** Restore from durable storage on startup (IndexedDB backup when localStorage was cleared). */
export async function hydrateMistralApiKey(): Promise<string> {
  const local = loadMistralApiKey();
  if (local) {
    void writeIndexedDb(local).catch(() => {});
    return local;
  }

  const fromIdb = await readIndexedDb();
  if (fromIdb) {
    writeLocalStorage(fromIdb);
    return fromIdb;
  }

  return migrateFromSessionStorage();
}

export function saveMistralApiKey(key: string): StorageWriteResult {
  const trimmed = key.trim();
  if (!trimmed) return clearMistralApiKey();

  if (writeLocalStorage(trimmed)) {
    void writeIndexedDb(trimmed).catch(() => {});
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  return { ok: false, error: "Could not save API key to browser storage." };
}

export async function saveMistralApiKeyPersisted(key: string): Promise<StorageWriteResult> {
  const trimmed = key.trim();
  if (!trimmed) return clearMistralApiKeyPersisted();

  if (writeLocalStorage(trimmed)) {
    await writeIndexedDb(trimmed).catch(() => {});
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  try {
    await writeIndexedDb(trimmed);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function clearMistralApiKey(): StorageWriteResult {
  removeLocalStorage();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  void removeIndexedDb();
  return { ok: true };
}

export async function clearMistralApiKeyPersisted(): Promise<StorageWriteResult> {
  removeLocalStorage();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  await removeIndexedDb();
  return { ok: true };
}

export function maskMistralApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
