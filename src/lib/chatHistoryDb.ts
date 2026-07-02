import type { ChatMessage } from "./portfolioChat";
import { safeLocalStorageRemove } from "./safeLocalStorage";

export type ChatSessionRecord = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  memoryProcessedAt?: string | null;
};

type StoreMeta = {
  activeSessionId: string | null;
  version: 2;
  migratedFromLocalStorage?: boolean;
};

const DB_NAME = "wealth-web-munshi-chats";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const META = "meta";
const META_KEY = "store";
const LEGACY_STORAGE_KEY = "wealth_web_munshi_chats_v1";
export const MAX_SESSIONS = 200;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
    };
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function readMeta(db: IDBDatabase): Promise<StoreMeta> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, "readonly");
    const req = tx.objectStore(META).get(META_KEY);
    req.onsuccess = () => {
      const v = req.result as StoreMeta | undefined;
      resolve(v ?? { activeSessionId: null, version: 2 });
    };
    req.onerror = () => reject(req.error);
  });
}

async function writeMeta(db: IDBDatabase, meta: StoreMeta): Promise<void> {
  const tx = db.transaction(META, "readwrite");
  tx.objectStore(META).put(meta, META_KEY);
  await txDone(tx);
}

async function getSession(db: IDBDatabase, id: string): Promise<ChatSessionRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS, "readonly");
    const req = tx.objectStore(SESSIONS).get(id);
    req.onsuccess = () => resolve((req.result as ChatSessionRecord | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function putSession(db: IDBDatabase, session: ChatSessionRecord): Promise<void> {
  const tx = db.transaction(SESSIONS, "readwrite");
  tx.objectStore(SESSIONS).put(session);
  await txDone(tx);
}

async function deleteSession(db: IDBDatabase, id: string): Promise<void> {
  const tx = db.transaction(SESSIONS, "readwrite");
  tx.objectStore(SESSIONS).delete(id);
  await txDone(tx);
}

async function listAllSessions(db: IDBDatabase): Promise<ChatSessionRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS, "readonly");
    const req = tx.objectStore(SESSIONS).getAll();
    req.onsuccess = () => resolve((req.result as ChatSessionRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

type LegacyStore = {
  version: 1;
  activeSessionId: string | null;
  sessions: ChatSessionRecord[];
};

function readLegacyLocalStorage(): LegacyStore | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LegacyStore;
    if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

let migratePromise: Promise<void> | null = null;

export async function ensureChatHistoryMigrated(): Promise<void> {
  if (migratePromise) return migratePromise;
  migratePromise = (async () => {
    const db = await openDb();
    const meta = await readMeta(db);
    if (meta.migratedFromLocalStorage) {
      db.close();
      return;
    }
    const legacy = readLegacyLocalStorage();
    if (legacy?.sessions?.length) {
      const tx = db.transaction(SESSIONS, "readwrite");
      const store = tx.objectStore(SESSIONS);
      for (const s of legacy.sessions) {
        store.put(s);
      }
      await txDone(tx);
      await writeMeta(db, {
        version: 2,
        activeSessionId: legacy.activeSessionId,
        migratedFromLocalStorage: true,
      });
    } else {
      await writeMeta(db, { ...meta, version: 2, migratedFromLocalStorage: true });
    }
    safeLocalStorageRemove(LEGACY_STORAGE_KEY);
    db.close();
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch {
      /* best-effort */
    }
  })();
  return migratePromise;
}

export type ChatStorageResult = { ok: true } | { ok: false; error: string };

export async function dbLoadActiveSessionId(): Promise<string | null> {
  await ensureChatHistoryMigrated();
  const db = await openDb();
  try {
    const meta = await readMeta(db);
    return meta.activeSessionId;
  } finally {
    db.close();
  }
}

export async function dbSetActiveSessionId(id: string | null): Promise<void> {
  await ensureChatHistoryMigrated();
  const db = await openDb();
  try {
    const meta = await readMeta(db);
    await writeMeta(db, { ...meta, activeSessionId: id });
  } finally {
    db.close();
  }
}

export async function dbLoadSession(id: string): Promise<ChatSessionRecord | null> {
  await ensureChatHistoryMigrated();
  const db = await openDb();
  try {
    return await getSession(db, id);
  } finally {
    db.close();
  }
}

export async function dbLoadAllSessions(): Promise<ChatSessionRecord[]> {
  await ensureChatHistoryMigrated();
  const db = await openDb();
  try {
    return await listAllSessions(db);
  } finally {
    db.close();
  }
}

export async function dbSaveSession(session: ChatSessionRecord): Promise<ChatStorageResult> {
  await ensureChatHistoryMigrated();
  const db = await openDb();
  try {
    await putSession(db, session);
    const all = await listAllSessions(db);
    const meta = await readMeta(db);
    const sorted = [...all].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (sorted.length > MAX_SESSIONS) {
      for (const drop of sorted.slice(MAX_SESSIONS)) {
        if (drop.id !== session.id) await deleteSession(db, drop.id);
      }
    }
    await writeMeta(db, { ...meta, activeSessionId: session.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    db.close();
  }
}

export async function dbDeleteSession(id: string): Promise<string | null> {
  await ensureChatHistoryMigrated();
  const db = await openDb();
  try {
    await deleteSession(db, id);
    const meta = await readMeta(db);
    let nextActive = meta.activeSessionId;
    if (nextActive === id) {
      const remaining = await listAllSessions(db);
      nextActive = remaining.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null;
    }
    await writeMeta(db, { ...meta, activeSessionId: nextActive });
    return nextActive;
  } finally {
    db.close();
  }
}

export async function dbMarkSessionMemoryProcessed(sessionId: string, at = new Date().toISOString()): Promise<void> {
  await ensureChatHistoryMigrated();
  const db = await openDb();
  try {
    const session = await getSession(db, sessionId);
    if (!session) return;
    await putSession(db, { ...session, memoryProcessedAt: at });
  } finally {
    db.close();
  }
}

export async function dbListUnprocessedSessions(): Promise<ChatSessionRecord[]> {
  const all = await dbLoadAllSessions();
  return all.filter(
    (s) =>
      s.messages.some((m) => m.content.trim()) &&
      (!s.memoryProcessedAt || new Date(s.updatedAt) > new Date(s.memoryProcessedAt)),
  );
}
