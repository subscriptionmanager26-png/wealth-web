/**
 * Final portfolio valuation: Pre/Post mfapi mark-to-market, then Portfolio NAV & Units
 * (starting NAV ₹10 on period first day; thereafter NAV = Pre / OldUnits, Units = Post / NAV).
 *
 * CAS amount/price are not used — only unit ledger deltas per AMFI.
 */

export const PORTFOLIO_NAV_START = 10;

export type NavSeriesPoint = { t: number; nav: number };

export type UnitLedgerEvent = { t: number; amfi: string; units: number; seq: number };

export type PortfolioDailyNavRow = {
  date: Date;
  pre: number;
  post: number;
  portfolioNav: number;
  portfolioUnits: number;
};

export function fmtDdMmYyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export function dayNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

/** mfapi series ascending by `t` (on-or-before walk). */
export function navOnOrBeforeSeries(series: NavSeriesPoint[], targetMs: number): number | null {
  if (!series.length) return null;
  let lo = 0;
  let hi = series.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = series[mid]!.t;
    if (t <= targetMs) {
      ans = series[mid]!.nav;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function markToMarket(
  pos: Record<string, number>,
  amfis: string[],
  navBy: Record<string, NavSeriesPoint[]>,
  dayNoonMs: number,
): number {
  let v = 0;
  for (const amfi of amfis) {
    const u = pos[amfi] ?? 0;
    if (u === 0) continue;
    const nav = navOnOrBeforeSeries(navBy[amfi] ?? [], dayNoonMs);
    if (nav == null || !Number.isFinite(nav) || nav <= 0) continue;
    v += u * nav;
  }
  return v;
}

/** mfapi.in NAV row dates are typically `DD-MM-YYYY`. */
function parseMfapiNavDateString(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]) - 1;
  const yyyy = Number(m[3]);
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) return null;
  return new Date(yyyy, mm, dd, 12, 0, 0, 0);
}

function toNumNav(s?: string | null): number {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convert mfapi `NavRecord[]` (any order) to ascending `NavSeriesPoint[]`.
 */
export function navRecordsToAscSeries(records: { date?: string; nav?: string }[]): NavSeriesPoint[] {
  const pts: NavSeriesPoint[] = [];
  for (const r of records) {
    const d = parseMfapiNavDateString(String(r.date ?? "").trim());
    if (!d) continue;
    const nav = toNumNav(r.nav);
    if (!Number.isFinite(nav) || nav <= 0) continue;
    pts.push({ t: d.getTime(), nav });
  }
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

function lastCalendarDayOfMonth(year: number, month0: number): Date {
  return new Date(year, month0 + 1, 0, 12, 0, 0, 0);
}

/** Month-end dates from first month in range through `pTo`, plus `pTo` when it is not a month-end. */
export function enumeratePortfolioSnapshotDates(pFrom: Date, pTo: Date): Date[] {
  const pFromNoon = dayNoon(pFrom);
  const pToNoon = dayNoon(pTo);
  if (pToNoon.getTime() < pFromNoon.getTime()) return [];

  const out: Date[] = [];
  let y = pFromNoon.getFullYear();
  let m = pFromNoon.getMonth();

  for (;;) {
    const last = lastCalendarDayOfMonth(y, m);
    if (last.getTime() >= pFromNoon.getTime() && last.getTime() <= pToNoon.getTime()) {
      out.push(last);
    }
    if (last.getTime() >= pToNoon.getTime()) break;

    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    const firstOfMonth = new Date(y, m, 1, 12, 0, 0, 0);
    if (firstOfMonth.getTime() > pToNoon.getTime()) break;
  }

  const lastPushed = out[out.length - 1];
  if (!lastPushed || lastPushed.getTime() !== pToNoon.getTime()) {
    out.push(pToNoon);
  }
  return out;
}

function buildPortfolioNavSeries(params: {
  events: UnitLedgerEvent[];
  amfis: string[];
  navBy: Record<string, NavSeriesPoint[]>;
  pFrom: Date;
  pTo: Date;
}): PortfolioDailyNavRow[] {
  const { events, amfis, navBy, pFrom, pTo } = params;
  const sorted = [...events].sort((a, b) => a.t - b.t || a.seq - b.seq);

  let eIdx = 0;
  const pos: Record<string, number> = {};
  let preCachedFromPriorDay: number | null = null;
  let newTotalUnits = 0;

  const rows: PortfolioDailyNavRow[] = [];

  const pFromNoon = dayNoon(pFrom);
  const pToNoon = dayNoon(pTo);

  for (
    let d = new Date(pFromNoon);
    d.getTime() <= pToNoon.getTime();
    d.setDate(d.getDate() + 1)
  ) {
    const tEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
    const noonMs = dayNoon(d).getTime();

    const pre =
      preCachedFromPriorDay != null
        ? preCachedFromPriorDay
        : markToMarket(pos, amfis, navBy, noonMs);

    while (eIdx < sorted.length && sorted[eIdx]!.t <= tEnd) {
      const ev = sorted[eIdx]!;
      pos[ev.amfi] = (pos[ev.amfi] ?? 0) + ev.units;
      eIdx += 1;
    }

    const post = markToMarket(pos, amfis, navBy, noonMs);

    const isStartingDate =
      d.getFullYear() === pFromNoon.getFullYear() &&
      d.getMonth() === pFromNoon.getMonth() &&
      d.getDate() === pFromNoon.getDate();

    const oldUnits = isStartingDate ? 0 : newTotalUnits;
    const portfolioNav =
      !isStartingDate && oldUnits > 0 && Number.isFinite(pre) && pre > 0 ? pre / oldUnits : PORTFOLIO_NAV_START;
    newTotalUnits =
      portfolioNav > 0 && Number.isFinite(post) && post >= 0 ? post / portfolioNav : 0;

    const dNext = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12, 0, 0, 0);
    if (dNext.getTime() <= pToNoon.getTime()) {
      preCachedFromPriorDay = markToMarket(pos, amfis, navBy, dayNoon(dNext).getTime());
    } else {
      preCachedFromPriorDay = null;
    }

    rows.push({
      date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0),
      pre,
      post,
      portfolioNav,
      portfolioUnits: newTotalUnits,
    });
  }

  return rows;
}

/**
 * Daily Pre/Post values and portfolio NAV & units (final agreed logic).
 */
export function buildPortfolioDailyNavSeries(params: {
  events: UnitLedgerEvent[];
  amfis: string[];
  navBy: Record<string, NavSeriesPoint[]>;
  pFrom: Date;
  pTo: Date;
}): PortfolioDailyNavRow[] {
  return buildPortfolioNavSeries(params);
}

/** Month-end (and current `pTo` if not month-end) portfolio NAV — no daily walk. */
export function buildPortfolioMonthEndNavSeries(params: {
  events: UnitLedgerEvent[];
  amfis: string[];
  navBy: Record<string, NavSeriesPoint[]>;
  pFrom: Date;
  pTo: Date;
}): PortfolioDailyNavRow[] {
  const { events, amfis, navBy, pFrom, pTo } = params;
  const sorted = [...events].sort((a, b) => a.t - b.t || a.seq - b.seq);
  const snapshotDates = enumeratePortfolioSnapshotDates(pFrom, pTo);
  if (!snapshotDates.length) return [];

  let eIdx = 0;
  const pos: Record<string, number> = {};
  let newTotalUnits = 0;
  const rows: PortfolioDailyNavRow[] = [];

  for (const d of snapshotDates) {
    const tEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
    const noonMs = dayNoon(d).getTime();

    const pre = markToMarket(pos, amfis, navBy, noonMs);

    while (eIdx < sorted.length && sorted[eIdx]!.t <= tEnd) {
      const ev = sorted[eIdx]!;
      pos[ev.amfi] = (pos[ev.amfi] ?? 0) + ev.units;
      eIdx += 1;
    }

    const post = markToMarket(pos, amfis, navBy, noonMs);

    const isStartingDate = rows.length === 0;
    const oldUnits = isStartingDate ? 0 : newTotalUnits;
    const portfolioNav =
      !isStartingDate && oldUnits > 0 && Number.isFinite(pre) && pre > 0 ? pre / oldUnits : PORTFOLIO_NAV_START;
    newTotalUnits =
      portfolioNav > 0 && Number.isFinite(post) && post >= 0 ? post / portfolioNav : 0;

    rows.push({
      date: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0),
      pre,
      post,
      portfolioNav,
      portfolioUnits: newTotalUnits,
    });
  }

  return rows;
}

/** Last row per calendar month (for month-end analytics). */
export function dailyRowsToMonthEndNavPoints(
  rows: PortfolioDailyNavRow[],
): { date: Date; portfolioNav: number; portfolioUnits: number; post: number }[] {
  const byKey = new Map<string, PortfolioDailyNavRow>();
  for (const r of rows) {
    const k = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`;
    const prev = byKey.get(k);
    if (!prev || r.date.getTime() >= prev.date.getTime()) byKey.set(k, r);
  }
  return [...byKey.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((r) => ({
      date: r.date,
      portfolioNav: r.portfolioNav,
      portfolioUnits: r.portfolioUnits,
      post: r.post,
    }));
}
