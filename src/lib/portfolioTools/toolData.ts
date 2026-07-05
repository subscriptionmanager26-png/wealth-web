import { BENCHMARK_OPTIONS } from "@mobile/utils/benchmarkTypes";
import type { BenchmarkId } from "@mobile/utils/benchmarkTypes";
import { getUpvalyFundReturn } from "@mobile/utils/upvalyMfApi";
import type { FundHolding } from "../buildHoldings";
import {
  computeDateRangeReturn,
  computePeriodReturn,
  navPointsFromSeries,
  TIME_FRAMES,
  type TimeFrame,
} from "../performanceUtils";
import { fmt, pct, viewLabel } from "./format";
import type { PortfolioSnapshot, PortfolioToolName } from "./types";

export type PortfolioSummaryData = {
  view: string;
  total: number;
  invested: number;
  gain: number;
  gainPct: number | null;
  xirr: string;
  dayChange?: number;
  dayChangePct?: number | null;
};

export type PeriodReturnRow = {
  frame: string;
  returnPct: number | null;
  kind?: "absolute" | "cagr";
};

export type PeriodReturnsData = {
  rows: PeriodReturnRow[];
  calendarYears?: { year: number; returnPct: number | null }[];
};

export type BenchmarkComparisonRow = {
  frame: string;
  portfolioPct: number | null;
  benchmarkPct: number | null;
  alphaPct: number | null;
};

export type BenchmarkComparisonData = {
  benchmarkId: string;
  benchmarkLabel: string;
  rows: BenchmarkComparisonRow[];
};

export type HoldingRowData = {
  name: string;
  assetClass: string;
  category: string;
  weightPct: number;
  value: number;
  invested: number;
  returnPct: number | null;
};

export type HoldingsData = {
  rows: HoldingRowData[];
};

export type AllocationSliceData = {
  type: string;
  weightPct: number;
  value: number;
};

export type AllocationData = {
  slices: AllocationSliceData[];
};

export type FundCardData = {
  name: string;
  weightPct: number;
  returnPct: number | null;
  value: number;
  category?: string;
  ter?: number;
  aumCr?: number;
  return1y?: number | null;
};

export type SectorRowData = {
  sector: string;
  weightPct: number;
};

export type SectorExposureData = {
  rows: SectorRowData[];
};

export type RiskMetricsData = {
  sharpe?: number | null;
  volatility?: number | null;
  maxDrawdown3Y?: number | null;
  maxDrawdown5Y?: number | null;
  currentDrawdown?: number | null;
};

export type PerformancePoint = { date: string; value: number };

export type PerformanceSeriesData = {
  points: PerformancePoint[];
  label?: string;
};

export type DiversificationData = {
  score: number;
  label: string;
  topHoldingPct?: number;
  topSectorPct?: number;
};

export type ToolDataPayload =
  | { kind: "portfolioSummary"; data: PortfolioSummaryData }
  | { kind: "periodReturns"; data: PeriodReturnsData }
  | { kind: "benchmarkComparison"; data: BenchmarkComparisonData }
  | { kind: "holdings"; data: HoldingsData }
  | { kind: "allocation"; data: AllocationData }
  | { kind: "fundDetails"; data: FundCardData }
  | { kind: "sectorExposure"; data: SectorExposureData }
  | { kind: "riskMetrics"; data: RiskMetricsData }
  | { kind: "performanceSeries"; data: PerformanceSeriesData }
  | { kind: "diversification"; data: DiversificationData };

export type ToolDataStore = {
  portfolioSummary?: PortfolioSummaryData;
  periodReturns?: PeriodReturnsData;
  benchmarkComparison?: BenchmarkComparisonData;
  holdings?: HoldingsData;
  allocation?: AllocationData;
  fundDetails?: FundCardData[];
  sectorExposure?: SectorExposureData;
  riskMetrics?: RiskMetricsData;
  performanceSeries?: PerformanceSeriesData;
  diversification?: DiversificationData;
};

const COMPARISON_FRAMES: TimeFrame[] = ["MTD", "1M", "3M", "6M", "1Y", "3Y", "5Y"];

function totalWeight(holdings: FundHolding[]): number {
  return holdings.reduce((a, h) => a + h.amount, 0) || 1;
}

function sortedHoldings(holdings: FundHolding[]): FundHolding[] {
  return [...holdings].sort((a, b) => b.amount - a.amount);
}

function matchFund(holdings: FundHolding[], query: string): FundHolding[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return holdings.filter((h) => h.name.toLowerCase().includes(q));
}

function schemeFor(h: FundHolding, snapshot: PortfolioSnapshot) {
  const code = h.amfiCode?.trim();
  return code ? snapshot.upvalySchemes?.[code] : undefined;
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function returnModeArg(value: unknown): "auto" | "absolute" | "cagr" {
  if (value === "absolute" || value === "cagr") return value;
  return "auto";
}

export function mergeToolData(store: ToolDataStore, payload: ToolDataPayload): ToolDataStore {
  const next = { ...store };
  switch (payload.kind) {
    case "portfolioSummary":
      next.portfolioSummary = payload.data;
      break;
    case "periodReturns":
      next.periodReturns = payload.data;
      break;
    case "benchmarkComparison":
      next.benchmarkComparison = payload.data;
      break;
    case "holdings":
      next.holdings = payload.data;
      break;
    case "allocation":
      next.allocation = payload.data;
      break;
    case "fundDetails":
      next.fundDetails = [...(next.fundDetails ?? []), payload.data];
      break;
    case "sectorExposure":
      next.sectorExposure = payload.data;
      break;
    case "riskMetrics":
      next.riskMetrics = payload.data;
      break;
    case "performanceSeries":
      next.performanceSeries = payload.data;
      break;
    case "diversification":
      next.diversification = payload.data;
      break;
    default:
      break;
  }
  return next;
}

export function buildPortfolioSummaryData(snapshot: PortfolioSnapshot): PortfolioSummaryData {
  const { hero, portfolioView } = snapshot;
  return {
    view: viewLabel(portfolioView),
    total: hero.total,
    invested: hero.invested,
    gain: hero.gain,
    gainPct: hero.invested > 0 ? (hero.gain / hero.invested) * 100 : null,
    xirr: hero.xirr,
    dayChange: hero.dayChange,
    dayChangePct: hero.dayChangePct ?? null,
  };
}

export function buildPeriodReturnsData(
  snapshot: PortfolioSnapshot,
  args: {
    frames?: string[];
    include_calendar_years?: boolean;
    start_date?: string;
    end_date?: string;
    return_mode?: string;
  },
): PeriodReturnsData | null {
  const perf = snapshot.perf;
  if (!perf?.points?.length) return null;

  const nav = navPointsFromSeries(perf.points.map((p) => ({ date: p.date, nav100: p.nav100 })));
  const start = parseIsoDate(args.start_date);
  const end = parseIsoDate(args.end_date);
  const returnMode = returnModeArg(args.return_mode);
  const requested = (args.frames?.length ? args.frames : ["MTD", "YTD", "1M", "3M", "6M", "1Y"]) as string[];
  const rows: PeriodReturnRow[] = [];

  if (start && end) {
    const custom = computeDateRangeReturn(nav, start, end, returnMode);
    rows.push({
      frame: "Custom",
      returnPct: custom.returnPct,
      kind: custom.kind,
    });
  }

  for (const frame of requested) {
    if (frame === "YTD") {
      rows.push({ frame: "YTD", returnPct: perf.ytdReturn ?? null });
      continue;
    }
    if (!(TIME_FRAMES as readonly string[]).includes(frame)) continue;
    const result = computePeriodReturn(nav, frame as TimeFrame);
    rows.push({
      frame,
      returnPct: result.returnPct,
      kind: result.kind,
    });
  }

  const calendarYears =
    args.include_calendar_years && perf.yearWiseReturns?.length
      ? perf.yearWiseReturns.slice(-6).map((r) => ({ year: r.year, returnPct: r.ret }))
      : undefined;

  return { rows, calendarYears };
}

export function buildBenchmarkComparisonData(
  snapshot: PortfolioSnapshot,
  args: {
    benchmark_id?: string;
    frames?: string[];
    start_date?: string;
    end_date?: string;
    return_mode?: string;
  },
): BenchmarkComparisonData | null {
  const benchmarkId = (args.benchmark_id?.trim() || "nifty500") as BenchmarkId;
  const label = BENCHMARK_OPTIONS.find((b) => b.id === benchmarkId)?.label ?? benchmarkId;
  const portfolioNav = navPointsFromSeries(snapshot.perf?.points?.map((p) => ({ date: p.date, nav100: p.nav100 })));
  const benchNav = navPointsFromSeries(snapshot.benchmarkMonthEnds?.[benchmarkId]);
  if (portfolioNav.length < 2 && benchNav.length < 2) return null;

  const returnMode = returnModeArg(args.return_mode);
  const start = parseIsoDate(args.start_date);
  const end = parseIsoDate(args.end_date);
  const rows: BenchmarkComparisonRow[] = [];

  if (start && end) {
    const port = computeDateRangeReturn(portfolioNav, start, end, returnMode);
    const bench = computeDateRangeReturn(benchNav, start, end, returnMode);
    rows.push({
      frame: "Custom",
      portfolioPct: port.returnPct,
      benchmarkPct: bench.returnPct,
      alphaPct:
        port.returnPct != null && bench.returnPct != null ? port.returnPct - bench.returnPct : null,
    });
  }

  const frameSet = new Set(
    (args.frames?.length ? args.frames : start && end ? [] : COMPARISON_FRAMES) as TimeFrame[],
  );
  for (const frame of COMPARISON_FRAMES) {
    if (!frameSet.has(frame)) continue;
    const port = computePeriodReturn(portfolioNav, frame);
    const bench = computePeriodReturn(benchNav, frame);
    if (!port.available && !bench.available) continue;
    rows.push({
      frame,
      portfolioPct: port.returnPct,
      benchmarkPct: bench.returnPct,
      alphaPct:
        port.returnPct != null && bench.returnPct != null ? port.returnPct - bench.returnPct : null,
    });
  }

  return rows.length ? { benchmarkId, benchmarkLabel: label, rows } : null;
}

export function buildHoldingsData(
  snapshot: PortfolioSnapshot,
  args: {
    sort_by?: string;
    order?: string;
    limit?: number;
    asset_class?: string;
    category?: string;
  },
): HoldingsData {
  let rows = [...snapshot.holdings];
  const ac = args.asset_class?.trim().toLowerCase();
  const cat = args.category?.trim().toLowerCase();
  if (ac) rows = rows.filter((h) => h.assetClass.toLowerCase().includes(ac));
  if (cat) rows = rows.filter((h) => h.category.toLowerCase().includes(cat));

  const sortBy = args.sort_by ?? "weight";
  const order = args.order === "asc" ? 1 : -1;
  const total = totalWeight(rows.length ? rows : snapshot.holdings);

  rows.sort((a, b) => {
    switch (sortBy) {
      case "return":
        return order * ((a.returnPct ?? 0) - (b.returnPct ?? 0));
      case "invested":
        return order * (a.invested - b.invested);
      case "value":
        return order * (a.current - b.current);
      case "name":
        return order * a.name.localeCompare(b.name);
      default:
        return order * (a.amount - b.amount);
    }
  });

  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
  return {
    rows: rows.slice(0, limit).map((h) => ({
      name: h.name,
      assetClass: h.assetClass,
      category: h.category,
      weightPct: (h.amount / total) * 100,
      value: h.current,
      invested: h.invested,
      returnPct: h.returnPct ?? null,
    })),
  };
}

export function buildAllocationData(snapshot: PortfolioSnapshot): AllocationData | null {
  if (!snapshot.assetSlices?.length) return null;
  const total = totalWeight(snapshot.holdings);
  return {
    slices: snapshot.assetSlices.map((slice) => ({
      type: slice.type,
      weightPct: total > 0 ? (slice.value / total) * 100 : 0,
      value: slice.value,
    })),
  };
}

export function buildFundCardData(
  snapshot: PortfolioSnapshot,
  args: { fund_name_query?: string; rank_by_weight?: number; limit?: number },
): FundCardData | null {
  const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);
  let funds: FundHolding[] = [];

  if (args.rank_by_weight != null && args.rank_by_weight >= 1) {
    const pick = sortedHoldings(snapshot.holdings)[args.rank_by_weight - 1];
    if (pick) funds = [pick];
  } else if (args.fund_name_query?.trim()) {
    funds = matchFund(snapshot.holdings, args.fund_name_query).slice(0, limit);
  } else {
    return null;
  }

  const h = funds[0];
  if (!h) return null;

  const scheme = schemeFor(h, snapshot);
  const total = totalWeight(snapshot.holdings);
  return {
    name: h.name,
    weightPct: (h.amount / total) * 100,
    returnPct: h.returnPct ?? null,
    value: h.current,
    category: scheme?.schemeCategoryLabel ?? scheme?.schemeCategory,
    ter: scheme?.expenseRatio,
    aumCr: scheme?.aumCr,
    return1y: getUpvalyFundReturn(scheme, "1y")?.valuePct ?? null,
  };
}

export function buildSectorExposureData(
  snapshot: PortfolioSnapshot,
  args: { limit?: number; sector_query?: string },
): SectorExposureData | null {
  if (!snapshot.sectorRows?.length) return null;
  let rows = snapshot.sectorRows;
  const q = args.sector_query?.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.sector.toLowerCase().includes(q));
  const limit = Math.min(Math.max(args.limit ?? 12, 1), 30);
  return {
    rows: rows.slice(0, limit).map((r) => ({ sector: r.sector, weightPct: r.weightPct })),
  };
}

export function buildRiskMetricsData(snapshot: PortfolioSnapshot): RiskMetricsData | null {
  const perf = snapshot.perf;
  if (!perf) return null;
  return {
    sharpe: perf.sharpeRatio ?? null,
    volatility: perf.volatility ?? null,
    maxDrawdown3Y: perf.maxDrawdown3Y ?? null,
    maxDrawdown5Y: perf.maxDrawdown5Y ?? null,
    currentDrawdown: perf.currentDrawdown ?? null,
  };
}

export function buildPerformanceSeriesData(snapshot: PortfolioSnapshot): PerformanceSeriesData | null {
  const points = snapshot.perf?.points;
  if (!points?.length) return null;
  const sampled =
    points.length > 120
      ? points.filter((_, i) => i % Math.ceil(points.length / 120) === 0 || i === points.length - 1)
      : points;
  return {
    label: "Portfolio value",
    points: sampled.map((p) => ({
      date: p.date,
      value: p.nav100,
    })),
  };
}

export function buildDiversificationData(snapshot: PortfolioSnapshot): DiversificationData | null {
  const holdings = snapshot.holdings;
  if (!holdings.length) return null;
  const total = holdings.reduce((a, h) => a + h.amount, 0) || 1;
  const weights = holdings.map((h) => (h.amount / total) * 100).sort((a, b) => b - a);
  const topHoldingPct = weights[0] ?? 0;
  const hhi = weights.reduce((s, w) => s + (w / 100) ** 2, 0);
  const score = Math.round(Math.max(0, Math.min(100, (1 - hhi) * 100)));
  let label = "Well diversified";
  if (score < 40) label = "Highly concentrated";
  else if (score < 65) label = "Moderately diversified";
  const topSectorPct = snapshot.sectorRows?.[0]?.weightPct;
  return { score, label, topHoldingPct, topSectorPct };
}

export function buildToolData(
  snapshot: PortfolioSnapshot,
  name: string,
  args: Record<string, unknown> = {},
): ToolDataPayload | null {
  const tool = name as PortfolioToolName;
  switch (tool) {
    case "get_portfolio_summary":
      return { kind: "portfolioSummary", data: buildPortfolioSummaryData(snapshot) };
    case "get_portfolio_performance": {
      const data = buildPeriodReturnsData(snapshot, {
        include_calendar_years: Boolean(args.include_calendar_years),
        frames: Array.isArray(args.frames) ? args.frames.map(String) : undefined,
        start_date: typeof args.start_date === "string" ? args.start_date : undefined,
        end_date: typeof args.end_date === "string" ? args.end_date : undefined,
        return_mode: typeof args.return_mode === "string" ? args.return_mode : undefined,
      });
      return data ? { kind: "periodReturns", data } : null;
    }
    case "get_benchmark_comparison": {
      const data = buildBenchmarkComparisonData(snapshot, {
        benchmark_id: typeof args.benchmark_id === "string" ? args.benchmark_id : undefined,
        frames: Array.isArray(args.frames) ? args.frames.map(String) : undefined,
        start_date: typeof args.start_date === "string" ? args.start_date : undefined,
        end_date: typeof args.end_date === "string" ? args.end_date : undefined,
        return_mode: typeof args.return_mode === "string" ? args.return_mode : undefined,
      });
      return data ? { kind: "benchmarkComparison", data } : null;
    }
    case "get_holdings":
      return {
        kind: "holdings",
        data: buildHoldingsData(snapshot, {
          sort_by: typeof args.sort_by === "string" ? args.sort_by : undefined,
          order: typeof args.order === "string" ? args.order : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
          asset_class: typeof args.asset_class === "string" ? args.asset_class : undefined,
          category: typeof args.category === "string" ? args.category : undefined,
        }),
      };
    case "get_asset_allocation": {
      const data = buildAllocationData(snapshot);
      return data ? { kind: "allocation", data } : null;
    }
    case "get_fund_details": {
      const data = buildFundCardData(snapshot, {
        fund_name_query: typeof args.fund_name_query === "string" ? args.fund_name_query : undefined,
        rank_by_weight: typeof args.rank_by_weight === "number" ? args.rank_by_weight : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return data ? { kind: "fundDetails", data } : null;
    }
    case "get_sector_exposure": {
      const data = buildSectorExposureData(snapshot, {
        limit: typeof args.limit === "number" ? args.limit : undefined,
        sector_query: typeof args.sector_query === "string" ? args.sector_query : undefined,
      });
      return data ? { kind: "sectorExposure", data } : null;
    }
    case "get_risk_metrics": {
      const data = buildRiskMetricsData(snapshot);
      return data ? { kind: "riskMetrics", data } : null;
    }
    default:
      return null;
  }
}

/** Extra toolData emitted alongside primary payload for Generative UI charts. */
export function buildSupplementalToolData(
  snapshot: PortfolioSnapshot,
  name: string,
): ToolDataPayload[] {
  const tool = name as PortfolioToolName;
  const out: ToolDataPayload[] = [];
  if (tool === "get_portfolio_performance" || tool === "get_portfolio_summary") {
    const series = buildPerformanceSeriesData(snapshot);
    if (series) out.push({ kind: "performanceSeries", data: series });
    if (tool === "get_portfolio_summary") {
      const pr = buildPeriodReturnsData(snapshot, { frames: ["MTD", "YTD", "1M", "1Y"] });
      if (pr.rows.length) out.push({ kind: "periodReturns", data: pr });
    }
  }
  if (tool === "get_asset_allocation" || tool === "get_holdings" || tool === "get_portfolio_summary") {
    const div = buildDiversificationData(snapshot);
    if (div) out.push({ kind: "diversification", data: div });
  }
  if (tool === "get_portfolio_summary") {
    if (snapshot.holdings?.length) {
      out.push({
        kind: "holdings",
        data: buildHoldingsData(snapshot, { sort_by: "weight", limit: 8 }),
      });
    }
    const alloc = buildAllocationData(snapshot);
    if (alloc?.slices.length) out.push({ kind: "allocation", data: alloc });
    if (snapshot.sectorRows?.length) {
      const sectors = buildSectorExposureData(snapshot, { limit: 8 });
      if (sectors) out.push({ kind: "sectorExposure", data: sectors });
    }
    const risk = buildRiskMetricsData(snapshot);
    if (risk) out.push({ kind: "riskMetrics", data: risk });
  }
  if (tool === "get_risk_metrics") {
    const series = buildPerformanceSeriesData(snapshot);
    if (series) out.push({ kind: "performanceSeries", data: series });
  }
  return out;
}

export function buildAllToolData(
  snapshot: PortfolioSnapshot,
  name: string,
  args: Record<string, unknown> = {},
): ToolDataPayload[] {
  const payloads: ToolDataPayload[] = [];
  const primary = buildToolData(snapshot, name, args);
  if (primary) payloads.push(primary);
  for (const extra of buildSupplementalToolData(snapshot, name)) {
    payloads.push(extra);
  }
  return payloads;
}

export function formatInr(n: number): string {
  return `₹${fmt(n)}`;
}

export function formatPct(n: number | null | undefined): string {
  return pct(n);
}
