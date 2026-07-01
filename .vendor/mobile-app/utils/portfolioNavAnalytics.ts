import type { ParsedCas } from "./casParser";
import { fetchNavSeriesForAmfi, type NavSeriesFetchRange } from "./amfiResolveCore";
import type { AmfiResolveTrace } from "./amfiResolveTrace";
import {
  buildPortfolioMonthEndNavSeries,
  dayNoon,
  type NavSeriesPoint,
  type UnitLedgerEvent,
} from "./portfolioNavCore";

const NAV_FETCH_CONCURRENCY = 16;
const NAV_RANGE_PAD_BEFORE_MS = 7 * 86400000;
const NAV_RANGE_PAD_AFTER_MS = 14 * 86400000;

type NavRangeEvent = { t: number; amfi: string };

function collectCasNavRangeEvents(docs: ParsedCas[]): NavRangeEvent[] {
  const out: NavRangeEvent[] = [];
  for (const doc of docs) {
    for (const h of doc.holdings ?? []) {
      const amfi = String(h.mf_amfi_code ?? "").trim();
      if (!/^\d+$/.test(amfi)) continue;
      for (const tx of h.transactions ?? []) {
        const d = parseCasDate(tx.date);
        if (!d) continue;
        out.push({ t: d.getTime(), amfi });
      }
    }
  }
  return out;
}

/** Per-scheme fetch window from first to last CAS transaction (+ padding), capped at `pTo`. */
export function collectAmfiNavFetchRanges(
  events: NavRangeEvent[],
  pTo: Date,
): Map<string, NavSeriesFetchRange> {
  const bounds = new Map<string, { lo: number; hi: number }>();
  for (const e of events) {
    const b = bounds.get(e.amfi) ?? { lo: e.t, hi: e.t };
    b.lo = Math.min(b.lo, e.t);
    b.hi = Math.max(b.hi, e.t);
    bounds.set(e.amfi, b);
  }
  const pToMs = pTo.getTime();
  const out = new Map<string, NavSeriesFetchRange>();
  for (const [amfi, { lo, hi }] of bounds) {
    out.set(amfi, {
      fromMs: lo - NAV_RANGE_PAD_BEFORE_MS,
      toMs: Math.max(hi, pToMs) + NAV_RANGE_PAD_AFTER_MS,
    });
  }
  return out;
}

async function fetchNavSeriesForRanges(
  ranges: Map<string, NavSeriesFetchRange>,
  trace?: AmfiResolveTrace,
): Promise<void> {
  const list = [...ranges.entries()];
  if (!list.length) return;
  const run = async () => {
    for (let i = 0; i < list.length; i += NAV_FETCH_CONCURRENCY) {
      const chunk = list.slice(i, i + NAV_FETCH_CONCURRENCY);
      await Promise.all(chunk.map(([amfi, range]) => fetchNavSeriesForAmfi(amfi, range)));
    }
  };
  if (trace) {
    await trace.runTimed(`NAV series fetch (${list.length} scheme(s), per-holding window)`, run);
  } else {
    await run();
  }
}

type Event = { t: number; amfi: string; units: number; profileId: string };

type MonthlyPoint = {
  date: Date;
  navRaw: number;
  nav100: number;
  units: number;
  value: number;
};

type MonthlyReturnPoint = {
  month: string;
  fromMonth: string;
  ret: number;
};

type YearReturnPoint = {
  year: number;
  ret: number;
};

/** Annual risk-free rate for Sharpe (excess return vs monthly equivalent). */
export const PORTFOLIO_RISK_FREE_ANNUAL = 0.055;

export type PortfolioAnalyticsSnapshot = {
  points: MonthlyPoint[];
  maxDrawdownAll: number | null;
  maxDrawdown3Y: number | null;
  maxDrawdown5Y: number | null;
  /** Drawdown from running peak on portfolio NAV index (nav100). */
  currentDrawdown: number | null;
  /** Month-to-date return on portfolio NAV (latest vs prior month-end). */
  mtdReturn: number | null;
  /** Calendar year-to-date return on portfolio NAV. */
  ytdReturn: number | null;
  /** Total return over the trailing 12 month-end NAV points (not annualized). */
  return1Y: number | null;
  /** Annualized Sharpe from monthly NAV returns vs {@link PORTFOLIO_RISK_FREE_ANNUAL} (36M window when available). */
  sharpeRatio: number | null;
  annualizedSinceInception: number | null;
  annualized3Y: number | null;
  annualized5Y: number | null;
  /** Annualized volatility of monthly portfolio NAV returns. */
  volatility: number | null;
  yearWiseReturns: YearReturnPoint[];
  monthlyReturns36M: MonthlyReturnPoint[];
};

function toNum(s?: string | null): number {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseCasDate(input?: string | null): Date | null {
  if (!input) return null;
  const s = input.trim();
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime())) return d1;
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const day = Number(m[1]);
  const mon = months[m[2].toLowerCase()];
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (!Number.isFinite(day) || mon == null || !Number.isFinite(year)) return null;
  return new Date(year, mon, day, 12, 0, 0, 0);
}

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

function enumerateMonthKeys(from?: string | null, to?: string | null): string[] {
  const start = parseCasDate(from);
  const end = parseCasDate(to);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const keys: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1, 12, 0, 0, 0);
  const last = new Date(end.getFullYear(), end.getMonth(), 1, 12, 0, 0, 0);
  while (cur.getTime() <= last.getTime()) {
    keys.push(monthKeyFromDate(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return keys;
}

function maxDrawdown(points: MonthlyPoint[]): number | null {
  if (points.length < 2) return null;
  let peak = points[0]!.nav100;
  let worst = 0;
  for (const p of points) {
    if (p.nav100 > peak) peak = p.nav100;
    if (peak > 0) {
      const dd = p.nav100 / peak - 1;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

function annualizedBetween(first: MonthlyPoint, last: MonthlyPoint): number | null {
  if (first.nav100 <= 0 || last.nav100 <= 0 || last.date.getTime() <= first.date.getTime()) return null;
  const years = (last.date.getTime() - first.date.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  if (years <= 0) return null;
  return Math.pow(last.nav100 / first.nav100, 1 / years) - 1;
}

function annualizedWindow(points: MonthlyPoint[], months: number): number | null {
  if (points.length < months + 1) return null;
  const last = points[points.length - 1]!;
  const first = points[points.length - 1 - months]!;
  return annualizedBetween(first, last);
}

function stdDev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function navIndexReturn(latest: MonthlyPoint, base: MonthlyPoint | null): number | null {
  if (!base || base.nav100 <= 0 || latest.nav100 <= 0) return null;
  return latest.nav100 / base.nav100 - 1;
}

/** MTD on portfolio NAV index: latest point vs last month-end before current calendar month. */
function mtdReturnFromNav(points: MonthlyPoint[]): number | null {
  if (!points.length) return null;
  const latest = points[points.length - 1]!;
  const y = latest.date.getFullYear();
  const m = latest.date.getMonth();
  let base: MonthlyPoint | null = null;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const p = points[i]!;
    if (p.date.getFullYear() < y || (p.date.getFullYear() === y && p.date.getMonth() < m)) {
      base = p;
      break;
    }
  }
  if (!base) {
    const firstInMonth = points.find((p) => p.date.getFullYear() === y && p.date.getMonth() === m);
    return firstInMonth && firstInMonth !== latest ? navIndexReturn(latest, firstInMonth) : null;
  }
  return navIndexReturn(latest, base);
}

/** YTD on portfolio NAV index: latest vs last month-end of prior calendar year (or first point in year). */
function ytdReturnFromNav(points: MonthlyPoint[]): number | null {
  if (!points.length) return null;
  const latest = points[points.length - 1]!;
  const y = latest.date.getFullYear();
  let priorYearEnd: MonthlyPoint | null = null;
  for (const p of points) {
    if (p.date.getFullYear() < y) priorYearEnd = p;
  }
  if (priorYearEnd) return navIndexReturn(latest, priorYearEnd);
  const firstInYear = points.find((p) => p.date.getFullYear() === y);
  return firstInYear ? navIndexReturn(latest, firstInYear) : null;
}

/** Trailing 12-month total return on portfolio NAV index (month-end to month-end). */
function return1YFromNav(points: MonthlyPoint[]): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1]!;
  if (points.length >= 13) return navIndexReturn(latest, points[points.length - 13]!);
  const targetMs = new Date(
    latest.date.getFullYear(),
    latest.date.getMonth() - 12,
    latest.date.getDate(),
    12,
    0,
    0,
    0,
  ).getTime();
  let base: MonthlyPoint | null = null;
  for (const p of points) {
    if (p.date.getTime() <= targetMs) base = p;
  }
  return navIndexReturn(latest, base);
}

function sharpeFromMonthlyNavReturns(monthlyReturns: MonthlyReturnPoint[]): number | null {
  const rets = monthlyReturns.map((x) => x.ret);
  if (rets.length < 2) return null;
  const rfMonthly = Math.pow(1 + PORTFOLIO_RISK_FREE_ANNUAL, 1 / 12) - 1;
  const excess = rets.map((r) => r - rfMonthly);
  const std = stdDev(excess);
  if (std == null || std <= 0) return null;
  const meanExcess = excess.reduce((a, b) => a + b, 0) / excess.length;
  return (meanExcess / std) * Math.sqrt(12);
}

function buildSnapshot(points: MonthlyPoint[]): PortfolioAnalyticsSnapshot {
  const monthlyReturns: MonthlyReturnPoint[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (prev.nav100 <= 0) continue;
    monthlyReturns.push({
      month: monthLabel(cur.date),
      fromMonth: monthLabel(prev.date),
      ret: cur.nav100 / prev.nav100 - 1,
    });
  }

  const byYear = new Map<number, number[]>();
  for (const r of monthlyReturns) {
    const [mm, yy] = r.month.split("-");
    const year = Number(yy);
    const month = Number(mm);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(r.ret);
  }
  const yearWiseReturns = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, rets]) => ({
      year,
      ret: rets.reduce((acc, x) => acc * (1 + x), 1) - 1,
    }));

  const monthlyReturns36M = monthlyReturns.slice(-36);
  const vol = stdDev(monthlyReturns36M.map((x) => x.ret));
  const allDd = maxDrawdown(points);
  const dd3y = points.length >= 37 ? maxDrawdown(points.slice(points.length - 37)) : null;
  const dd5y = points.length >= 61 ? maxDrawdown(points.slice(points.length - 61)) : null;
  const currentDd = (() => {
    if (!points.length) return null;
    let peak = points[0]!.nav100;
    for (const p of points) peak = Math.max(peak, p.nav100);
    if (peak <= 0) return null;
    return points[points.length - 1]!.nav100 / peak - 1;
  })();

  return {
    points,
    maxDrawdownAll: allDd,
    maxDrawdown3Y: dd3y,
    maxDrawdown5Y: dd5y,
    currentDrawdown: currentDd,
    mtdReturn: mtdReturnFromNav(points),
    ytdReturn: ytdReturnFromNav(points),
    return1Y: return1YFromNav(points),
    sharpeRatio: sharpeFromMonthlyNavReturns(monthlyReturns36M),
    annualizedSinceInception: points.length >= 2 ? annualizedBetween(points[0]!, points[points.length - 1]!) : null,
    annualized3Y: annualizedWindow(points, 36),
    annualized5Y: annualizedWindow(points, 60),
    volatility: vol == null ? null : vol * Math.sqrt(12),
    yearWiseReturns,
    monthlyReturns36M,
  };
}

/** Prefetch historical NAV for mapped schemes so portfolio analytics can reuse the merged cache. */
export async function warmPortfolioNavHistoryCache(
  parsedDocs: ParsedCas[],
  asOfDate: Date = new Date(),
  trace?: AmfiResolveTrace,
): Promise<void> {
  const docs = [...parsedDocs].sort((a, b) => {
    const af = parseCasDate(a.period_from)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bf = parseCasDate(b.period_from)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return af - bf;
  });
  if (!docs.length) {
    trace?.appendNow("Portfolio NAV warm-up skipped — no CAS files");
    return;
  }

  const pTo = dayNoon(asOfDate);
  const navEvents = collectCasNavRangeEvents(docs);
  const ranges = collectAmfiNavFetchRanges(navEvents, pTo);
  trace?.appendNow(
    `Portfolio NAV warm-up: ${ranges.size} scheme(s) with CAS transactions across ${docs.length} file(s)`,
  );
  if (!ranges.size) return;
  await fetchNavSeriesForRanges(ranges, trace);
}

export async function buildPortfolioAnalyticsForParsedDocs(
  parsedDocs: ParsedCas[],
  asOfDate: Date = new Date(),
  trace?: AmfiResolveTrace,
): Promise<Record<string, PortfolioAnalyticsSnapshot>> {
  const docs = [...parsedDocs].sort((a, b) => {
    const af = parseCasDate(a.period_from)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bf = parseCasDate(b.period_from)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return af - bf;
  });
  if (!docs.length) {
    trace?.appendNow("Portfolio NAV build skipped — no CAS files");
    return {};
  }

  trace?.appendNow(
    `Portfolio NAV build begin: ${docs.length} CAS file(s), as of ${asOfDate.toISOString().slice(0, 10)}`,
  );

  const ownerByMonth = new Map<string, number>();
  for (let i = 0; i < docs.length; i += 1) {
    const d = docs[i];
    const keys = enumerateMonthKeys(d.period_from, d.period_to);
    for (const k of keys) {
      if (!ownerByMonth.has(k)) ownerByMonth.set(k, i);
    }
  }

  const profileByName = new Map<string, string>();
  const allProfileIds = new Set<string>(["family"]);
  const events: Event[] = [];

  const ensureProfile = (name: string): string => {
    const k = name.trim().toLowerCase() || "member";
    if (!profileByName.has(k)) {
      const id = `p:${k}`;
      profileByName.set(k, id);
      allProfileIds.add(id);
    }
    return profileByName.get(k)!;
  };

  let pFrom: Date | null = null;
  for (const doc of docs) {
    const pf = parseCasDate(doc.period_from);
    if (pf && (!pFrom || pf.getTime() < pFrom.getTime())) pFrom = pf;
  }
  if (!pFrom) {
    trace?.appendNow("Portfolio NAV build skipped — no CAS period start");
    return {};
  }

  const pTo = dayNoon(asOfDate);

  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    const profileId = ensureProfile(doc.investor_name ?? "Member");
    for (const h of doc.holdings ?? []) {
      const amfi = String(h.mf_amfi_code ?? "").trim();
      if (!/^\d+$/.test(amfi)) continue;

      for (const tx of h.transactions ?? []) {
        const mk = (() => {
          const d = parseCasDate(tx.date);
          return d ? monthKeyFromDate(d) : null;
        })();
        if (!mk || ownerByMonth.get(mk) !== i) continue;
        const d = parseCasDate(tx.date);
        if (!d) continue;
        const units = toNum(tx.units);
        if (!Number.isFinite(units) || units === 0) continue;

        events.push({ t: d.getTime(), amfi, units, profileId });
        events.push({ t: d.getTime(), amfi, units, profileId: "family" });
      }
    }
  }

  events.sort((a, b) => a.t - b.t);

  const allAmfis = [...new Set(events.map((e) => e.amfi))];
  const familyEvents = events.filter((e) => e.profileId === "family");
  trace?.appendNow(
    `Portfolio NAV ledger: ${familyEvents.length} family transaction event(s), ${allAmfis.length} scheme code(s), ${allProfileIds.size} profile bucket(s)`,
  );
  const navRangeByAmfi = collectAmfiNavFetchRanges(collectCasNavRangeEvents(docs), pTo);
  const fallbackRange: NavSeriesFetchRange = {
    fromMs: pFrom.getTime() - NAV_RANGE_PAD_BEFORE_MS,
    toMs: pTo.getTime() + NAV_RANGE_PAD_AFTER_MS,
  };

  const navBy: Record<string, NavSeriesPoint[]> = {};
  const fetchNavSeries = async () => {
    for (let i = 0; i < allAmfis.length; i += NAV_FETCH_CONCURRENCY) {
      const chunk = allAmfis.slice(i, i + NAV_FETCH_CONCURRENCY);
      const part = await Promise.all(
        chunk.map((amfi) => fetchNavSeriesForAmfi(amfi, navRangeByAmfi.get(amfi) ?? fallbackRange)),
      );
      chunk.forEach((amfi, j) => {
        navBy[amfi] = (part[j] ?? []) as NavSeriesPoint[];
      });
    }
  };
  if (trace) {
    await trace.runTimed(
      `Portfolio NAV series fetch (${allAmfis.length} scheme(s), per-holding window)`,
      fetchNavSeries,
    );
  } else {
    await fetchNavSeries();
  }

  const out: Record<string, PortfolioAnalyticsSnapshot> = {};

  for (const profileId of allProfileIds) {
    const amfis = [...new Set(events.filter((e) => e.profileId === profileId).map((e) => e.amfi))];
    if (!amfis.length) {
      out[profileId] = buildSnapshot([]);
      continue;
    }

    const profileEvents: UnitLedgerEvent[] = events
      .filter((e) => e.profileId === profileId)
      .sort((a, b) => a.t - b.t)
      .map((e, i) => ({ t: e.t, amfi: e.amfi, units: e.units, seq: i }));

    const monthEnds = buildPortfolioMonthEndNavSeries({
      events: profileEvents,
      amfis,
      navBy,
      pFrom,
      pTo,
    });
    if (!monthEnds.length) {
      trace?.appendNow(`Profile ${profileId}: no month-end NAV points`);
      out[profileId] = buildSnapshot([]);
      continue;
    }

    const baseNavPt = monthEnds.find((p) => p.portfolioNav > 0) ?? monthEnds[0]!;
    const baseNav = baseNavPt.portfolioNav > 0 ? baseNavPt.portfolioNav : 1;

    const points: MonthlyPoint[] = monthEnds.map((p) => ({
      date: p.date,
      navRaw: p.portfolioNav,
      units: p.portfolioUnits,
      value: p.post,
      nav100: baseNav > 0 ? (100 * p.portfolioNav) / baseNav : 0,
    }));

    const snapshot = buildSnapshot(points);
    out[profileId] = snapshot;
    const latest = points[points.length - 1];
    trace?.appendNow(
      `Profile ${profileId}: ${amfis.length} scheme(s), ${profileEvents.length} event(s), ${points.length} month-end point(s)${latest ? `, latest NAV ${latest.navRaw.toFixed(4)}` : ""}`,
    );
  }

  trace?.appendNow(`Portfolio NAV build end: ${Object.keys(out).length} profile snapshot(s)`);
  return out;
}
