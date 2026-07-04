import type { ParsedCas } from "@mobile/utils/casParser";
import type {
  ParsedCdslStatement,
  ParsedMfCentralStatement,
  ParsedNpsStatement,
  StatementKind,
} from "@mobile/utils/statementParser";
import { safeLocalStorageSet } from "./safeLocalStorage";

export type TrackerStatementKind = Exclude<StatementKind, "unknown">;

export type StoredTrackerPayload =
  | { kind: "cams_kfin_cas"; data: ParsedCas }
  | { kind: "mf_central"; data: ParsedMfCentralStatement }
  | { kind: "cdsl_cas"; data: ParsedCdslStatement }
  | { kind: "nps"; data: ParsedNpsStatement };

export type SavedTrackerFile = {
  id: string;
  name: string;
  addedAt: string;
  statementKind: TrackerStatementKind;
  investorName: string | null;
  investorPan: string | null;
  periodFrom: string | null;
  periodTo: string | null;
};

const DB_NAME = "wealth-web-tracker";
const DB_VERSION = 1;
const STORE = "docs";
const INDEX_KEY = "wealth_web_tracker_index_v1";

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
  statementKind: TrackerStatementKind;
  payload: StoredTrackerPayload;
  rawText?: string;
};

function loadIndex(): SavedTrackerFile[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTrackerFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveIndex(rows: SavedTrackerFile[]): boolean {
  return safeLocalStorageSet(INDEX_KEY, JSON.stringify(rows));
}

function metaFromPayload(payload: StoredTrackerPayload): Pick<
  SavedTrackerFile,
  "statementKind" | "investorName" | "investorPan" | "periodFrom" | "periodTo"
> {
  switch (payload.kind) {
    case "cams_kfin_cas":
      return {
        statementKind: payload.kind,
        investorName: payload.data.investor_name ?? null,
        investorPan: payload.data.investor_pan ?? null,
        periodFrom: payload.data.period_from ?? null,
        periodTo: payload.data.period_to ?? null,
      };
    case "mf_central":
      return {
        statementKind: payload.kind,
        investorName: payload.data.investor_name ?? null,
        investorPan: payload.data.investor_pan ?? null,
        periodFrom: payload.data.period_from ?? null,
        periodTo: payload.data.period_to ?? null,
      };
    case "cdsl_cas":
      return {
        statementKind: payload.kind,
        investorName: payload.data.investor_name ?? null,
        investorPan: payload.data.investor_pan ?? null,
        periodFrom: payload.data.period_from ?? null,
        periodTo: payload.data.period_to ?? null,
      };
    case "nps":
      return {
        statementKind: payload.kind,
        investorName: payload.data.investor_name ?? null,
        investorPan: payload.data.investor_pan ?? null,
        periodFrom: payload.data.period_from ?? null,
        periodTo: payload.data.period_to ?? null,
      };
  }
}

export async function listTrackerIndex(): Promise<SavedTrackerFile[]> {
  return loadIndex();
}

export async function loadAllTrackerPayloads(): Promise<StoredTrackerPayload[]> {
  const entries = await loadAllTrackerEntries();
  return entries.map((e) => e.payload);
}

export type TrackerEntry = { file: SavedTrackerFile; payload: StoredTrackerPayload };

export async function loadAllTrackerEntries(): Promise<TrackerEntry[]> {
  const index = loadIndex();
  const db = await openDb();
  const out: TrackerEntry[] = [];
  for (const row of index) {
    const doc = await new Promise<StoredDoc | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(row.id);
      req.onsuccess = () => resolve((req.result as StoredDoc | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (doc?.payload) out.push({ file: row, payload: doc.payload });
  }
  db.close();
  return out;
}


export async function saveTrackerStatement(
  name: string,
  payload: StoredTrackerPayload,
  rawText?: string,
): Promise<SavedTrackerFile> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const addedAt = new Date().toISOString();
  const meta = metaFromPayload(payload);
  const row: SavedTrackerFile = { id, name, addedAt, ...meta };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      id,
      name,
      addedAt,
      statementKind: meta.statementKind,
      payload,
      rawText,
    } satisfies StoredDoc);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  const index = loadIndex();
  index.unshift(row);
  saveIndex(index);
  return row;
}

export async function removeTrackerDoc(id: string): Promise<void> {
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

export async function loadTrackerPayloadById(id: string): Promise<StoredTrackerPayload | null> {
  const db = await openDb();
  const doc = await new Promise<StoredDoc | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as StoredDoc | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return doc?.payload ?? null;
}
