/**
 * Browser key-value storage with localStorage → sessionStorage → in-memory fallback.
 * Surfaces write failures instead of swallowing them (quota / private mode).
 */

const memory = new Map<string, string>();

function canUse(storage: Storage): boolean {
  try {
    const probe = "__wealth_web_storage_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const localOk = typeof localStorage !== "undefined" && canUse(localStorage);
const sessionOk = typeof sessionStorage !== "undefined" && canUse(sessionStorage);

export type StorageWriteResult = { ok: true } | { ok: false; error: string };

export function deviceStorageGet(key: string): string | null {
  if (localOk) {
    try {
      const v = localStorage.getItem(key);
      if (v != null) return v;
    } catch {
      /* fall through */
    }
  }
  if (sessionOk) {
    try {
      const v = sessionStorage.getItem(key);
      if (v != null) return v;
    } catch {
      /* fall through */
    }
  }
  return memory.get(key) ?? null;
}

export function deviceStorageSet(key: string, value: string): StorageWriteResult {
  let lastError = "Storage unavailable";

  if (localOk) {
    try {
      localStorage.setItem(key, value);
      memory.set(key, value);
      if (sessionOk) {
        try {
          sessionStorage.setItem(key, value);
        } catch {
          /* session mirror is best-effort */
        }
      }
      return { ok: true };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (sessionOk) {
    try {
      sessionStorage.setItem(key, value);
      memory.set(key, value);
      return { ok: true };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  memory.set(key, value);
  return { ok: false, error: lastError };
}

export function deviceStorageRemove(key: string): StorageWriteResult {
  if (localOk) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (sessionOk) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  memory.delete(key);
  return { ok: true };
}

export function deviceStorageStatus(): { local: boolean; session: boolean } {
  return { local: localOk, session: sessionOk };
}
