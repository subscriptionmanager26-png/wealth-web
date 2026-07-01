import type { ParsedCas } from "@mobile/utils/casParser";
import { diagLog } from "./diagnosticsLog";
import { safeLocalStorageSet } from "./safeLocalStorage";

export type SavedParsedCasFile = {
  id: string;
  name: string;
  addedAt: string;
};

const DB_NAME = "wealth-web-cas";
const DB_VERSION = 1;
const STORE = "docs";
const INDEX_KEY = "wealth_web_cas_index_v1";

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

type StoredDoc = {
  id: string;
  name: string;
  addedAt: string;
  parsed: ParsedCas;
  rawText?: string;
};

function loadIndex(): SavedParsedCasFile[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedParsedCasFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveIndex(rows: SavedParsedCasFile[]): boolean {
  return safeLocalStorageSet(INDEX_KEY, JSON.stringify(rows));
}

export async function listCasIndex(): Promise<SavedParsedCasFile[]> {
  return loadIndex();
}

export async function loadAllParsedDocs(): Promise<ParsedCas[]> {
  const index = loadIndex();
  const db = await openDb();
  const out: ParsedCas[] = [];
  for (const row of index) {
    const doc = await new Promise<StoredDoc | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(row.id);
      req.onsuccess = () => resolve((req.result as StoredDoc | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (doc?.parsed) out.push(doc.parsed);
  }
  db.close();
  return out;
}

export async function saveParsedCas(name: string, parsed: ParsedCas, rawText?: string): Promise<SavedParsedCasFile> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row: SavedParsedCasFile = { id, name, addedAt: new Date().toISOString() };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id, name, addedAt: row.addedAt, parsed, rawText } satisfies StoredDoc);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  const index = loadIndex();
  index.unshift(row);
  saveIndex(index);
  diagLog("storage", "saveParsedCas OK", { id, name, holdings: parsed.holdings?.length ?? 0 });
  return row;
}

export async function removeCasDoc(id: string): Promise<void> {
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

export async function updateParsedCas(id: string, parsed: ParsedCas): Promise<void> {
  const db = await openDb();
  const existing = await new Promise<StoredDoc | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as StoredDoc | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  if (!existing) {
    db.close();
    diagLog("storage", "updateParsedCas skipped — doc missing", { id });
    return;
  }
  const mapped = (parsed.holdings ?? []).filter((h) => String(h.mf_amfi_code ?? "").trim()).length;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...existing, parsed });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  diagLog("storage", "updateParsedCas OK", {
    id,
    holdings: parsed.holdings?.length ?? 0,
    mapped,
  });
}

export async function loadParsedCasById(id: string): Promise<{ parsed: ParsedCas; rawText?: string } | null> {
  const db = await openDb();
  const doc = await new Promise<StoredDoc | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as StoredDoc | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!doc?.parsed) return null;
  return { parsed: doc.parsed, rawText: doc.rawText };
}

export async function findDocIdByParsed(parsed: ParsedCas): Promise<string | null> {
  const index = loadIndex();
  const db = await openDb();
  for (const row of index) {
    const doc = await new Promise<StoredDoc | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(row.id);
      req.onsuccess = () => resolve((req.result as StoredDoc | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (doc?.parsed === parsed || JSON.stringify(doc?.parsed) === JSON.stringify(parsed)) {
      db.close();
      return row.id;
    }
  }
  db.close();
  return null;
}
