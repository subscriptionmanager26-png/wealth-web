/**
 * localStorage writes that never throw. On quota, evicts bulky non-critical keys first.
 */

const EVICT_ON_QUOTA = [
  "wealth_web_diag_log_v1",
  "wealth_web_portfolio_nav_backup_v1",
  "cas_portfolio_nav_cache_v1",
  "wealth_web_munshi_chats_v1",
] as const;

export function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    for (const evictKey of EVICT_ON_QUOTA) {
      if (evictKey === key) continue;
      try {
        localStorage.removeItem(evictKey);
      } catch {
        /* ignore */
      }
    }
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

export function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
