import type {
  MunshiDaySummary,
  MunshiLearning,
  MunshiMemoryJobState,
  MunshiRule,
} from "./munshiMemoryTypes";

const DB_NAME = "wealth-web-munshi-memory";
const DB_VERSION = 1;
const DAY_SUMMARIES = "daySummaries";
const LEARNINGS = "learnings";
const RULES = "rules";
const META = "meta";
const JOB_KEY = "jobs";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DAY_SUMMARIES)) {
        db.createObjectStore(DAY_SUMMARIES, { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains(LEARNINGS)) {
        db.createObjectStore(LEARNINGS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(RULES)) {
        db.createObjectStore(RULES, { keyPath: "id" });
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
  });
}

export async function memoryGetJobState(): Promise<MunshiMemoryJobState> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(META, "readonly");
      const req = tx.objectStore(META).get(JOB_KEY);
      req.onsuccess = () => {
        const v = req.result as MunshiMemoryJobState | undefined;
        resolve(v ?? { lastExtractAt: null, lastAutomaticExtractDay: null, lastConsolidationAt: null, processing: false });
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function memorySetJobState(patch: Partial<MunshiMemoryJobState>): Promise<void> {
  const db = await openDb();
  try {
    const current = await memoryGetJobState();
    const next = { ...current, ...patch };
    const tx = db.transaction(META, "readwrite");
    tx.objectStore(META).put(next, JOB_KEY);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function memoryListDaySummaries(): Promise<MunshiDaySummary[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DAY_SUMMARIES, "readonly");
      const req = tx.objectStore(DAY_SUMMARIES).getAll();
      req.onsuccess = () => {
        const rows = (req.result as MunshiDaySummary[]) ?? [];
        resolve(rows.sort((a, b) => b.date.localeCompare(a.date)));
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function memoryUpsertDaySummary(
  date: string,
  summary: string,
  sessionId: string,
): Promise<void> {
  const db = await openDb();
  try {
    const existing = await new Promise<MunshiDaySummary | undefined>((resolve, reject) => {
      const tx = db.transaction(DAY_SUMMARIES, "readonly");
      const req = tx.objectStore(DAY_SUMMARIES).get(date);
      req.onsuccess = () => resolve(req.result as MunshiDaySummary | undefined);
      req.onerror = () => reject(req.error);
    });
    const sessionIds = existing?.sessionIds?.includes(sessionId)
      ? existing.sessionIds
      : [...(existing?.sessionIds ?? []), sessionId];
    const mergedSummary = existing?.summary
      ? `${existing.summary}\n\n${summary}`.trim()
      : summary.trim();
    const row: MunshiDaySummary = {
      date,
      summary: mergedSummary,
      sessionIds,
      updatedAt: new Date().toISOString(),
    };
    const tx = db.transaction(DAY_SUMMARIES, "readwrite");
    tx.objectStore(DAY_SUMMARIES).put(row);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function memoryListLearnings(activeOnly = true): Promise<MunshiLearning[]> {
  const db = await openDb();
  try {
    const rows = await new Promise<MunshiLearning[]>((resolve, reject) => {
      const tx = db.transaction(LEARNINGS, "readonly");
      const req = tx.objectStore(LEARNINGS).getAll();
      req.onsuccess = () => resolve((req.result as MunshiLearning[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    return rows
      .filter((r) => !activeOnly || r.active)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}

export async function memoryListRules(activeOnly = true): Promise<MunshiRule[]> {
  const db = await openDb();
  try {
    const rows = await new Promise<MunshiRule[]>((resolve, reject) => {
      const tx = db.transaction(RULES, "readonly");
      const req = tx.objectStore(RULES).getAll();
      req.onsuccess = () => resolve((req.result as MunshiRule[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return rows
      .filter((r) => !activeOnly || r.active)
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function isDuplicate(existing: string[], text: string): boolean {
  const n = normalizeText(text);
  return existing.some((e) => normalizeText(e) === n || normalizeText(e).includes(n) || n.includes(normalizeText(e)));
}

export async function memoryAddLearnings(
  items: { text: string; confidence: number; sourceSessionId?: string }[],
): Promise<void> {
  if (!items.length) return;
  const db = await openDb();
  try {
    const existing = await memoryListLearnings(true);
    const texts = existing.map((e) => e.text);
    const now = new Date().toISOString();
    const tx = db.transaction(LEARNINGS, "readwrite");
    const store = tx.objectStore(LEARNINGS);
    for (const item of items) {
      const t = item.text.trim();
      if (!t || isDuplicate(texts, t)) continue;
      texts.push(t);
      store.put({
        id: newId(),
        text: t,
        confidence: Math.min(1, Math.max(0, item.confidence)),
        active: true,
        sourceSessionId: item.sourceSessionId,
        createdAt: now,
        updatedAt: now,
      } satisfies MunshiLearning);
    }
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function memoryAddRules(
  items: { text: string; priority: MunshiRule["priority"]; sourceSessionId?: string }[],
): Promise<void> {
  if (!items.length) return;
  const db = await openDb();
  try {
    const existing = await memoryListRules(true);
    const texts = existing.map((e) => e.text);
    const now = new Date().toISOString();
    const tx = db.transaction(RULES, "readwrite");
    const store = tx.objectStore(RULES);
    for (const item of items) {
      const t = item.text.trim();
      if (!t || isDuplicate(texts, t)) continue;
      texts.push(t);
      store.put({
        id: newId(),
        text: t,
        priority: item.priority,
        active: true,
        sourceSessionId: item.sourceSessionId,
        createdAt: now,
        updatedAt: now,
      } satisfies MunshiRule);
    }
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function memorySetLearningActive(id: string, active: boolean): Promise<void> {
  const db = await openDb();
  try {
    const row = await new Promise<MunshiLearning | undefined>((resolve, reject) => {
      const tx = db.transaction(LEARNINGS, "readonly");
      const req = tx.objectStore(LEARNINGS).get(id);
      req.onsuccess = () => resolve(req.result as MunshiLearning | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!row) return;
    const tx = db.transaction(LEARNINGS, "readwrite");
    tx.objectStore(LEARNINGS).put({ ...row, active, updatedAt: new Date().toISOString() });
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function memorySetRuleActive(id: string, active: boolean): Promise<void> {
  const db = await openDb();
  try {
    const row = await new Promise<MunshiRule | undefined>((resolve, reject) => {
      const tx = db.transaction(RULES, "readonly");
      const req = tx.objectStore(RULES).get(id);
      req.onsuccess = () => resolve(req.result as MunshiRule | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!row) return;
    const tx = db.transaction(RULES, "readwrite");
    tx.objectStore(RULES).put({ ...row, active, updatedAt: new Date().toISOString() });
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function memoryDeleteDaySummary(date: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(DAY_SUMMARIES, "readwrite");
    tx.objectStore(DAY_SUMMARIES).delete(date);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function memoryReplaceAllLearnings(learnings: MunshiLearning[]): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(LEARNINGS, "readwrite");
    const store = tx.objectStore(LEARNINGS);
    store.clear();
    for (const row of learnings) store.put(row);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function memoryReplaceAllRules(rules: MunshiRule[]): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(RULES, "readwrite");
    const store = tx.objectStore(RULES);
    store.clear();
    for (const row of rules) store.put(row);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function memoryTouchUsage(ids: { learningIds?: string[]; ruleIds?: string[] }): Promise<void> {
  const now = new Date().toISOString();
  const db = await openDb();
  try {
    if (ids.learningIds?.length) {
      const tx = db.transaction(LEARNINGS, "readwrite");
      const store = tx.objectStore(LEARNINGS);
      for (const id of ids.learningIds) {
        const row = await new Promise<MunshiLearning | undefined>((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result as MunshiLearning | undefined);
          req.onerror = () => reject(req.error);
        });
        if (row) store.put({ ...row, lastUsedAt: now });
      }
      await txDone(tx);
    }
    if (ids.ruleIds?.length) {
      const tx = db.transaction(RULES, "readwrite");
      const store = tx.objectStore(RULES);
      for (const id of ids.ruleIds) {
        const row = await new Promise<MunshiRule | undefined>((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result as MunshiRule | undefined);
          req.onerror = () => reject(req.error);
        });
        if (row) store.put({ ...row, lastUsedAt: now });
      }
      await txDone(tx);
    }
  } finally {
    db.close();
  }
}

export async function memoryPruneCaps(maxLearnings: number, maxRules: number): Promise<void> {
  const learnings = await memoryListLearnings(true);
  if (learnings.length > maxLearnings) {
    const keep = learnings
      .sort((a, b) => (b.confidence - a.confidence) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, maxLearnings);
    const drop = new Set(learnings.filter((l) => !keep.find((k) => k.id === l.id)).map((l) => l.id));
    const db = await openDb();
    try {
      const tx = db.transaction(LEARNINGS, "readwrite");
      for (const id of drop) tx.objectStore(LEARNINGS).delete(id);
      await txDone(tx);
    } finally {
      db.close();
    }
  }
  const rules = await memoryListRules(true);
  if (rules.length > maxRules) {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const keep = [...rules]
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, maxRules);
    const drop = new Set(rules.filter((r) => !keep.find((k) => k.id === r.id)).map((r) => r.id));
    const db = await openDb();
    try {
      const tx = db.transaction(RULES, "readwrite");
      for (const id of drop) tx.objectStore(RULES).delete(id);
      await txDone(tx);
    } finally {
      db.close();
    }
  }
}
