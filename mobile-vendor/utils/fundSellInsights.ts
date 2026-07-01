import type { BenchmarkMonthEndPoint } from "./benchmarkTypes";
import { parseUpvalyMetric, type UpvalySchemeDetail } from "./upvalyMfApi";

const SMALL_AUM_CR_THRESHOLD = 100;
const INDEX_MIN_VINTAGE_YEARS = 1;
const NON_INDEX_MIN_VINTAGE_YEARS = 3;
const PERF_GAP_1Y = 10;
const PERF_GAP_3Y = 5;
const PERF_GAP_5Y = 5;
const RISK_GAP = 5;
const HIGH_EXPENSE_RATIO_THRESHOLD = 2;

export type Nifty500CagrSnapshot = {
  cagr1y: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
};

export type FundSellInsight = {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  returnPct: number;
  reasons: string[];
};

export type FundHoldInsight = {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  returnPct: number;
  reason: string;
};

type InsightHolding = {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  returnPct: number;
  amount: number;
  amfiCode?: string;
};

type NavPoint = { date: Date; nav100: number };

function previousMonthEndDate(ref = new Date()): Date {
  return new Date(ref.getFullYear(), ref.getMonth(), 0, 12, 0, 0, 0);
}

function clipToPreviousMonthEnd(points: NavPoint[]): NavPoint[] {
  const cutoff = previousMonthEndDate().getTime();
  return [...points]
    .filter((p) => p.date.getTime() <= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function yearsBetween(first: Date, last: Date): number {
  return (last.getTime() - first.getTime()) / (365.2425 * 86400000);
}

function computeCagrWindow(window: NavPoint[]): number | null {
  if (window.length < 2) return null;
  const first = window[0]!;
  const last = window[window.length - 1]!;
  if (first.nav100 <= 0 || last.nav100 <= 0) return null;
  const years = yearsBetween(first.date, last.date);
  if (years <= 0) return null;
  return (Math.pow(last.nav100 / first.nav100, 1 / years) - 1) * 100;
}

export function computeNifty500CagrSnapshot(monthEnds: BenchmarkMonthEndPoint[]): Nifty500CagrSnapshot {
  const points = clipToPreviousMonthEnd(monthEnds.map((p) => ({ date: p.date, nav100: p.nav100 })));
  const cagrForMonths = (months: number): number | null => {
    if (points.length < months + 1) return null;
    return computeCagrWindow(points.slice(points.length - months - 1));
  };
  return {
    cagr1y: cagrForMonths(12),
    cagr3y: cagrForMonths(36),
    cagr5y: cagrForMonths(60),
  };
}

export function isIndexFund(scheme: UpvalySchemeDetail): boolean {
  const hay = `${scheme.schemeCategory ?? ""} ${scheme.schemeCategoryLabel ?? ""} ${scheme.schemeName ?? ""}`.toLowerCase();
  return hay.includes("index");
}

function vintageYears(inceptionDate?: string): number | null {
  if (!inceptionDate) return null;
  const d = new Date(inceptionDate);
  if (!Number.isFinite(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (365.2425 * 86400000);
}

function fundCagr(scheme: UpvalySchemeDetail, period: "1y" | "3y" | "5y"): number | null {
  const fromCagr = scheme.cagrByPeriod?.[period];
  if (fromCagr != null && Number.isFinite(fromCagr)) return fromCagr;
  const row = scheme.returnsByTimeframe?.[period];
  return row?.valuePct ?? null;
}

function evaluateSellReasons(
  scheme: UpvalySchemeDetail,
  nifty500: Nifty500CagrSnapshot,
): string[] {
  const reasons: string[] = [];

  if (scheme.aumCr != null && scheme.aumCr < SMALL_AUM_CR_THRESHOLD) {
    reasons.push(`Small size — AUM is ₹${scheme.aumCr.toFixed(1)} Cr (below ₹${SMALL_AUM_CR_THRESHOLD} Cr).`);
  }

  const years = vintageYears(scheme.inceptionDate);
  const indexFund = isIndexFund(scheme);
  const minVintage = indexFund ? INDEX_MIN_VINTAGE_YEARS : NON_INDEX_MIN_VINTAGE_YEARS;
  if (years != null && years < minVintage) {
    const label = indexFund ? "index fund" : "active fund";
    reasons.push(
      `Short vintage — ${(years * 12).toFixed(0)} months since launch; ${label}s need at least ${minVintage} year${minVintage > 1 ? "s" : ""} of track record.`,
    );
  }

  const perfChecks: Array<{ period: "1y" | "3y" | "5y"; fund: number | null; bench: number | null; gap: number }> = [
    { period: "1y", fund: fundCagr(scheme, "1y"), bench: nifty500.cagr1y, gap: PERF_GAP_1Y },
    { period: "3y", fund: fundCagr(scheme, "3y"), bench: nifty500.cagr3y, gap: PERF_GAP_3Y },
    { period: "5y", fund: fundCagr(scheme, "5y"), bench: nifty500.cagr5y, gap: PERF_GAP_5Y },
  ];
  for (const check of perfChecks) {
    if (check.fund == null || check.bench == null) continue;
    if (check.fund < check.bench - check.gap) {
      const label = check.period.toUpperCase();
      reasons.push(
        `Adverse performance — ${label} CAGR is ${check.fund.toFixed(2)}% vs Nifty 500 TRI ${check.bench.toFixed(2)}% (more than ${check.gap}% behind).`,
      );
    }
  }

  for (const period of ["1y", "3y"] as const) {
    const row = scheme.riskStdDevByTimeframe?.[period];
    if (row?.value == null || row.categoryAverage == null) continue;
    if (row.value > row.categoryAverage + RISK_GAP) {
      reasons.push(
        `Very high risk — ${period.toUpperCase()} volatility is ${row.value.toFixed(2)}% vs category average ${row.categoryAverage.toFixed(2)}% (>${RISK_GAP}% higher).`,
      );
    }
  }

  if (scheme.expenseRatio != null && scheme.expenseRatio > HIGH_EXPENSE_RATIO_THRESHOLD) {
    reasons.push(
      `High fees — expense ratio is ${scheme.expenseRatio.toFixed(2)}% (above ${HIGH_EXPENSE_RATIO_THRESHOLD}%).`,
    );
  }

  return reasons;
}

export function buildFundSellInsights(
  holdings: InsightHolding[],
  schemes: Record<string, UpvalySchemeDetail>,
  nifty500MonthEnds: BenchmarkMonthEndPoint[],
): { sellFunds: FundSellInsight[]; holdFunds: FundHoldInsight[] } {
  const nifty500 = computeNifty500CagrSnapshot(nifty500MonthEnds);
  const sellFunds: FundSellInsight[] = [];
  const sellIds = new Set<string>();

  for (const h of holdings) {
    const code = String(h.amfiCode ?? "").trim();
    if (!/^\d+$/.test(code)) continue;
    const scheme = schemes[code];
    if (!scheme) continue;

    const reasons = evaluateSellReasons(scheme, nifty500);
    if (!reasons.length) continue;

    sellIds.add(h.id);
    sellFunds.push({
      id: h.id,
      name: h.name,
      category: h.category,
      subCategory: h.subCategory ?? h.category,
      returnPct: h.returnPct,
      reasons,
    });
  }

  sellFunds.sort((a, b) => a.returnPct - b.returnPct);

  const holdFunds: FundHoldInsight[] = [...holdings]
    .filter((h) => !sellIds.has(h.id) && h.returnPct >= 12)
    .sort((a, b) => b.returnPct - a.returnPct)
    .slice(0, 4)
    .map((h) => ({
      id: h.id,
      name: h.name,
      category: h.category,
      subCategory: h.subCategory ?? h.category,
      returnPct: h.returnPct,
      reason: `No sell flags on size, vintage, benchmark lag, or excess risk. Trailing return +${h.returnPct.toFixed(1)}% on ₹${(h.amount / 1_00_000).toFixed(2)}L.`,
    }));

  return { sellFunds, holdFunds };
}
