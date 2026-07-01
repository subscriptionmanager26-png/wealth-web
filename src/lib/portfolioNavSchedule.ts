import type { PortfolioAnalyticsSnapshot } from "@mobile/utils/portfolioNavAnalytics";
import type { CasPipelineMilestones } from "./casPipeline";
import { wasAmfiHydrateAttemptedToday } from "./portfolioNavSession";

const IST = "Asia/Kolkata";
const MAX_AMFI_AUTO_RETRIES_PER_DAY = 3;
const MIN_HOURS_BETWEEN_AMFI_AUTO_RETRIES = 6;

/** Minimum time between automatic portfolio NAV recomputes (hydrate / background). */
export const PORTFOLIO_NAV_MIN_REFRESH_MS = 24 * 60 * 60 * 1000;

export type PortfolioNavRefreshDecision = {
  refresh: boolean;
  reason: string;
};

export type AmfiRetryDecision = {
  retry: boolean;
  reason: string;
};

export function istDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(now);
}

export function isWeekendIST(now = new Date()): boolean {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: IST, weekday: "short" }).format(now);
  return day === "Sat" || day === "Sun";
}

export function istHour24(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "numeric", hour12: false }).format(now),
  );
}

export function portfolioNavCacheAgeMs(cacheUpdatedAt: string | undefined, now = new Date()): number | null {
  if (!cacheUpdatedAt) return null;
  const updated = new Date(cacheUpdatedAt);
  if (!Number.isFinite(updated.getTime())) return null;
  return now.getTime() - updated.getTime();
}

/** True when a cached portfolio NAV snapshot is still within the 24h refresh window. */
export function isPortfolioNavCacheWithinRefreshWindow(
  cacheUpdatedAt: string | undefined,
  now = new Date(),
): boolean {
  const ageMs = portfolioNavCacheAgeMs(cacheUpdatedAt, now);
  if (ageMs == null) return false;
  return ageMs < PORTFOLIO_NAV_MIN_REFRESH_MS;
}

/** When to recompute portfolio NAV on hydrate (not upload / manual). */
export function shouldRefreshPortfolioNav(
  cacheUpdatedAt: string | undefined,
  now = new Date(),
): PortfolioNavRefreshDecision {
  if (isWeekendIST(now)) {
    return { refresh: false, reason: "weekend — MF NAV not updated" };
  }
  if (!cacheUpdatedAt) {
    return { refresh: true, reason: "no cached portfolio NAV" };
  }

  const ageMs = portfolioNavCacheAgeMs(cacheUpdatedAt, now);
  if (ageMs == null) {
    return { refresh: true, reason: "invalid cache timestamp" };
  }

  if (ageMs < PORTFOLIO_NAV_MIN_REFRESH_MS) {
    const hours = (ageMs / (60 * 60 * 1000)).toFixed(1);
    return { refresh: false, reason: `portfolio NAV cached ${hours}h ago — refresh after 24h` };
  }

  if (istHour24(now) < 22) {
    return { refresh: false, reason: "cache older than 24h but before 10 PM IST — today's NAV not published yet" };
  }

  return { refresh: true, reason: "cache older than 24h and after 10 PM IST" };
}

/** Limited automatic AMFI remapping on hydrate when mapping is incomplete. */
export function shouldRetryAmfiMapping(
  milestones: CasPipelineMilestones,
  pendingCount: number,
  now = new Date(),
): AmfiRetryDecision {
  if (pendingCount <= 0) {
    return { retry: false, reason: "all scheme lines mapped" };
  }

  if (wasAmfiHydrateAttemptedToday(now)) {
    return { retry: false, reason: "AMFI auto-retry already attempted today" };
  }

  const todayKey = istDateKey(now);
  const retryDay = milestones.amfiAutoRetryDay;
  const retryCount = milestones.amfiAutoRetryCount ?? 0;

  if (retryDay !== todayKey) {
    return { retry: true, reason: "incomplete mapping — first auto-retry today" };
  }

  if (retryCount >= MAX_AMFI_AUTO_RETRIES_PER_DAY) {
    return { retry: false, reason: "daily auto-retry limit reached — use Retry source mapping" };
  }

  if (!milestones.amfiCheckedAt) {
    return { retry: true, reason: "mapping never checked" };
  }

  const checked = new Date(milestones.amfiCheckedAt);
  if (!Number.isFinite(checked.getTime())) {
    return { retry: true, reason: "invalid last mapping timestamp" };
  }

  const hoursSince = (now.getTime() - checked.getTime()) / (60 * 60 * 1000);
  if (hoursSince < MIN_HOURS_BETWEEN_AMFI_AUTO_RETRIES) {
    return {
      retry: false,
      reason: `last mapping ${hoursSince.toFixed(1)}h ago — wait ${MIN_HOURS_BETWEEN_AMFI_AUTO_RETRIES}h between auto-retries`,
    };
  }

  return { retry: true, reason: "incomplete mapping — scheduled auto-retry" };
}

export function nextAmfiAutoRetryMilestones(
  milestones: CasPipelineMilestones,
  now = new Date(),
): CasPipelineMilestones {
  const todayKey = istDateKey(now);
  const prevDay = milestones.amfiAutoRetryDay;
  const count = prevDay === todayKey ? (milestones.amfiAutoRetryCount ?? 0) + 1 : 1;
  return {
    ...milestones,
    amfiAutoRetryDay: todayKey,
    amfiAutoRetryCount: count,
  };
}

export function familyNavLooksReady(byProfile: Record<string, PortfolioAnalyticsSnapshot> | null | undefined): boolean {
  const fam = byProfile?.family;
  return !!(fam && fam.points.length >= 2);
}

export function portfolioNavCacheIsFresh(cacheUpdatedAt: string | undefined, now = new Date()): boolean {
  return !shouldRefreshPortfolioNav(cacheUpdatedAt, now).refresh;
}
