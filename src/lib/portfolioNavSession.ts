const IST = "Asia/Kolkata";
const NAV_DAY_KEY = "wealth_web_nav_day_v1";
const AMFI_HYDRATE_DAY_KEY = "wealth_web_amfi_hydrate_day_v1";

function sessionDayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(now);
}

function readDay(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDay(key: string, day: string): void {
  try {
    localStorage.setItem(key, day);
  } catch {
    /* ignore */
  }
}

export function markPortfolioNavComputedToday(now = new Date()): void {
  writeDay(NAV_DAY_KEY, sessionDayKey(now));
}

export function wasPortfolioNavComputedToday(now = new Date()): boolean {
  return readDay(NAV_DAY_KEY) === sessionDayKey(now);
}

export function clearPortfolioNavComputedToday(): void {
  try {
    localStorage.removeItem(NAV_DAY_KEY);
  } catch {
    /* ignore */
  }
}

export function markAmfiHydrateAttemptedToday(now = new Date()): void {
  writeDay(AMFI_HYDRATE_DAY_KEY, sessionDayKey(now));
}

export function wasAmfiHydrateAttemptedToday(now = new Date()): boolean {
  return readDay(AMFI_HYDRATE_DAY_KEY) === sessionDayKey(now);
}
