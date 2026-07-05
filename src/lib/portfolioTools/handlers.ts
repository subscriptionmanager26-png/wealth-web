import { BENCHMARK_OPTIONS } from "@mobile/utils/benchmarkTypes";
import type { BenchmarkId } from "@mobile/utils/benchmarkTypes";
import {
  getUpvalyFundReturn,
  listUpvalyFundReturns,
} from "@mobile/utils/upvalyMfApi";
import type { FundHolding } from "../buildHoldings";
import { computeDateRangeReturn, computePeriodReturn, navPointsFromSeries, type TimeFrame } from "../performanceUtils";
import { fmt, pct, viewLabel } from "./format";
import {
  formatPortfolioPeriodReturns,
  getBenchmarkReturns,
  getMarketFundDetails,
  listBenchmarkIndices,
  searchMarketFunds,
} from "./marketHandlers";
import type { PortfolioSnapshot, PortfolioToolName } from "./types";

const COMPARISON_FRAMES: TimeFrame[] = ["MTD", "1M", "3M", "6M", "1Y", "3Y", "5Y"];

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

export function listAvailableData(snapshot: PortfolioSnapshot): string {
  const lines = ["=== DATA AVAILABILITY ===", `View: ${viewLabel(snapshot.portfolioView)}`];
  lines.push(`Holdings: ${snapshot.holdings.length} fund(s)`);
  lines.push(`Portfolio NAV series: ${snapshot.perf?.points?.length ? `${snapshot.perf.points.length} points` : "not loaded"}`);
  lines.push(`Scheme metrics (Upvaly): ${Object.keys(snapshot.upvalySchemes ?? {}).length} scheme(s)`);
  lines.push(`Asset allocation slices: ${snapshot.assetSlices?.length ? "yes" : "not loaded"}`);
  lines.push(`Portfolio fundamentals: ${snapshot.fundamentals?.weighted ? "yes" : "not loaded"}`);
  lines.push(`Sector look-through: ${snapshot.sectorRows?.length ? `${snapshot.sectorRows.length} sectors` : "not loaded"}`);
  lines.push(`Stock look-through: ${snapshot.stockRows?.length ? `${snapshot.stockRows.length} stocks` : "not loaded"}`);
  const benches = snapshot.benchmarkMonthEnds
    ? Object.entries(snapshot.benchmarkMonthEnds)
        .filter(([, v]) => (v?.length ?? 0) >= 2)
        .map(([id]) => id)
    : [];
  lines.push(`Benchmarks loaded: ${benches.length ? benches.join(", ") : "none"}`);
  const screenerCount = Object.keys(snapshot.screenerFunds ?? {}).length;
  lines.push(`Market screener (Equity DG): ${screenerCount ? `${screenerCount} funds` : "not loaded"}`);
  if (screenerCount) {
    lines.push("  → search_market_funds / get_market_fund_details for non-portfolio funds");
    lines.push("  → list_benchmark_indices / get_benchmark_returns for Nifty TRI indices");
  }
  return lines.join("\n");
}

export function getPortfolioSummary(snapshot: PortfolioSnapshot): string {
  const { hero, portfolioView } = snapshot;
  const lines = [
    `=== PORTFOLIO SUMMARY (${viewLabel(portfolioView)}) ===`,
    `Current value: ₹${fmt(hero.total)}`,
    `Invested: ₹${fmt(hero.invested)}`,
    `Gain/Loss: ₹${fmt(hero.gain)} (${pct(hero.invested > 0 ? (hero.gain / hero.invested) * 100 : null)})`,
    `XIRR: ${hero.xirr}`,
  ];
  if (hero.dayChange != null && Number.isFinite(hero.dayChange)) {
    lines.push(`Day change: ₹${fmt(hero.dayChange)} (${pct(hero.dayChangePct ?? null)})`);
  }
  return lines.join("\n");
}

export function getPortfolioPerformance(
  snapshot: PortfolioSnapshot,
  args: {
    include_calendar_years?: boolean;
    frames?: string[];
    start_date?: string;
    end_date?: string;
    return_mode?: string;
  },
): string {
  return formatPortfolioPeriodReturns(snapshot, args);
}

export function getBenchmarkComparison(
  snapshot: PortfolioSnapshot,
  args: {
    benchmark_id?: string;
    frames?: string[];
    start_date?: string;
    end_date?: string;
    return_mode?: string;
  },
): string {
  const benchmarkId = (args.benchmark_id?.trim() || "nifty500") as BenchmarkId;
  const label = BENCHMARK_OPTIONS.find((b) => b.id === benchmarkId)?.label ?? benchmarkId;
  const portfolioNav = navPointsFromSeries(snapshot.perf?.points?.map((p) => ({ date: p.date, nav100: p.nav100 })));
  const benchNav = navPointsFromSeries(snapshot.benchmarkMonthEnds?.[benchmarkId]);
  const returnMode = returnModeArg(args.return_mode);
  const start = parseIsoDate(args.start_date);
  const end = parseIsoDate(args.end_date);

  if (portfolioNav.length < 2 && benchNav.length < 2) {
    return `Benchmark comparison vs ${label}: insufficient NAV/benchmark data.`;
  }

  const lines = [`=== BENCHMARK COMPARISON (vs ${label} TRI) ===`];

  if (start && end) {
    const port = computeDateRangeReturn(portfolioNav, start, end, returnMode);
    const bench = computeDateRangeReturn(benchNav, start, end, returnMode);
    const portText = port.returnPct != null ? pct(port.returnPct) : "NA";
    const benchText = bench.returnPct != null ? pct(bench.returnPct) : "NA";
    let alpha = "NA";
    if (port.returnPct != null && bench.returnPct != null) {
      alpha = pct(port.returnPct - bench.returnPct);
    }
    lines.push(`Custom range: Portfolio ${portText} | Benchmark ${benchText} | Alpha ${alpha}`);
  }

  const frameSet = new Set(
    (args.frames?.length ? args.frames : start && end ? [] : COMPARISON_FRAMES) as TimeFrame[],
  );
  for (const frame of COMPARISON_FRAMES) {
    if (!frameSet.has(frame)) continue;
    const port = computePeriodReturn(portfolioNav, frame);
    const bench = computePeriodReturn(benchNav, frame);
    if (!port.available && !bench.available) continue;
    const portText = port.returnPct != null ? pct(port.returnPct) : "NA";
    const benchText = bench.returnPct != null ? pct(bench.returnPct) : "NA";
    let alpha = "NA";
    if (port.returnPct != null && bench.returnPct != null) {
      alpha = pct(port.returnPct - bench.returnPct);
    }
    lines.push(`${frame}: Portfolio ${portText} | Benchmark ${benchText} | Alpha ${alpha}`);
  }
  return lines.join("\n");
}

export function getAssetAllocation(snapshot: PortfolioSnapshot): string {
  if (!snapshot.assetSlices?.length) return "Asset allocation: not loaded.";
  const total = totalWeight(snapshot.holdings);
  const lines = ["=== ASSET ALLOCATION ==="];
  for (const slice of snapshot.assetSlices) {
    const w = total > 0 ? (slice.value / total) * 100 : 0;
    lines.push(`- ${slice.type}: ${w.toFixed(1)}% (₹${fmt(slice.value)})`);
  }
  return lines.join("\n");
}

export function getPortfolioFundamentals(snapshot: PortfolioSnapshot): string {
  const w = snapshot.fundamentals?.weighted;
  if (!w) return "Portfolio fundamentals: not loaded.";
  const lines = ["=== PORTFOLIO FUNDAMENTALS (value-weighted) ==="];
  if (w.expenseRatio.value != null) lines.push(`TER: ${w.expenseRatio.value.toFixed(2)}%`);
  if (w.pe.value != null) lines.push(`P/E: ${w.pe.value.toFixed(1)}`);
  if (w.pb.value != null) lines.push(`P/B: ${w.pb.value.toFixed(2)}`);
  if (w.yieldToMaturity.value != null) lines.push(`Yield to maturity: ${w.yieldToMaturity.value.toFixed(2)}%`);
  if (w.modifiedDuration.value != null) lines.push(`Modified duration: ${w.modifiedDuration.value.toFixed(2)} yrs`);
  return lines.join("\n");
}

export function getHoldings(
  snapshot: PortfolioSnapshot,
  args: {
    sort_by?: string;
    order?: string;
    limit?: number;
    asset_class?: string;
    category?: string;
  },
): string {
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
  const lines = ["=== HOLDINGS ==="];
  for (const h of rows.slice(0, limit)) {
    const weight = (h.amount / total) * 100;
    lines.push(
      `- ${h.name} | ${h.assetClass}/${h.category} | Weight ${weight.toFixed(1)}% | ` +
        `Value ₹${fmt(h.current)} | Invested ₹${fmt(h.invested)} | Return ${pct(h.returnPct)} | ` +
        `Plan ${h.planTag ?? "—"}`,
    );
  }
  if (!rows.length) lines.push("No holdings match filters.");
  return lines.join("\n");
}

export function getBestWorstFunds(
  snapshot: PortfolioSnapshot,
  args: { mode?: string; limit?: number; sort_by?: string },
): string {
  const mode = args.mode ?? "both";
  const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);
  const rows = snapshot.holdings.filter((h) => h.amount > 0);
  const sortBy = args.sort_by ?? "return";

  const sorted = [...rows].sort((a, b) => {
    if (sortBy === "weight") return b.amount - a.amount;
    return (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity);
  });

  const lines = ["=== FUND PERFORMANCE RANKING ==="];
  const total = totalWeight(rows);

  if (mode === "best" || mode === "both") {
    lines.push("", `Top ${limit} by ${sortBy}:`);
    for (const h of sorted.slice(0, limit)) {
      const weight = (h.amount / total) * 100;
      lines.push(`- ${h.name}: Return ${pct(h.returnPct)} | Weight ${weight.toFixed(1)}%`);
    }
  }
  if (mode === "worst" || mode === "both") {
    lines.push("", `Bottom ${limit} by ${sortBy}:`);
    for (const h of [...sorted].reverse().slice(0, limit)) {
      const weight = (h.amount / total) * 100;
      lines.push(`- ${h.name}: Return ${pct(h.returnPct)} | Weight ${weight.toFixed(1)}%`);
    }
  }
  return lines.join("\n");
}

export function getFundDetails(
  snapshot: PortfolioSnapshot,
  args: { fund_name_query?: string; rank_by_weight?: number; limit?: number },
): string {
  const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);
  let funds: FundHolding[] = [];

  if (args.rank_by_weight != null && args.rank_by_weight >= 1) {
    const sorted = sortedHoldings(snapshot.holdings);
    const pick = sorted[args.rank_by_weight - 1];
    if (pick) funds = [pick];
  } else if (args.fund_name_query?.trim()) {
    funds = matchFund(snapshot.holdings, args.fund_name_query).slice(0, limit);
  } else {
    return "Provide fund_name_query or rank_by_weight.";
  }

  if (!funds.length) return `No fund matched "${args.fund_name_query ?? ""}".`;

  const lines = ["=== FUND DETAILS (your portfolio holdings) ==="];
  for (const h of funds) {
    const scheme = schemeFor(h, snapshot);
    lines.push("", `Fund: ${h.name}`);
    lines.push(`  Weight: ${((h.amount / totalWeight(snapshot.holdings)) * 100).toFixed(1)}%`);
    lines.push(`  Your return: ${pct(h.returnPct)} | Value ₹${fmt(h.current)}`);
    if (!scheme) {
      lines.push("  Scheme metrics: not loaded");
      continue;
    }
    if (scheme.schemeCategoryLabel || scheme.schemeCategory) {
      lines.push(`  Category: ${scheme.schemeCategoryLabel ?? scheme.schemeCategory}`);
    }
    if (scheme.aumCr != null) lines.push(`  AUM: ₹${scheme.aumCr.toLocaleString("en-IN")} Cr`);
    if (scheme.expenseRatio != null) lines.push(`  TER: ${scheme.expenseRatio.toFixed(2)}%`);
    if (scheme.inceptionDate) lines.push(`  Inception: ${scheme.inceptionDate}`);

    for (const tf of ["1y", "3y", "5y"] as const) {
      const ret = getUpvalyFundReturn(scheme, tf);
      if (ret) lines.push(`  Scheme ${tf.toUpperCase()} return: ${pct(ret.valuePct)}`);
    }

    const risk3y = scheme.riskStdDevByTimeframe?.["3y"];
    if (risk3y?.value != null) {
      const cat = risk3y.categoryAverage != null ? ` (category avg ${risk3y.categoryAverage.toFixed(2)}%)` : "";
      lines.push(`  Volatility (3Y): ${risk3y.value.toFixed(2)}%${cat}`);
    }

    const f = scheme.fundamentals;
    if (f) {
      const parts: string[] = [];
      if (f.pe) parts.push(`P/E ${f.pe}`);
      if (f.pb) parts.push(`P/B ${f.pb}`);
      if (f.yieldToMaturity) parts.push(`YTM ${f.yieldToMaturity}%`);
      if (parts.length) lines.push(`  Fundamentals: ${parts.join(" | ")}`);
    }

    const topHoldings = scheme.holdings?.slice(0, 5) ?? [];
    if (topHoldings.length) {
      lines.push("  Top underlying holdings:");
      for (const row of topHoldings) {
        lines.push(`    - ${row.name}: ${row.weightage}%${row.sector ? ` (${row.sector})` : ""}`);
      }
    }

    const allReturns = listUpvalyFundReturns(scheme);
    if (allReturns.length > 3) {
      const extra = allReturns
        .filter((r) => !["1y", "3y", "5y"].includes(r.timeframe))
        .slice(0, 4)
        .map((r) => `${r.label} ${pct(r.valuePct)}`);
      if (extra.length) lines.push(`  Other returns: ${extra.join(" | ")}`);
    }
  }
  return lines.join("\n");
}

export function getSectorExposure(
  snapshot: PortfolioSnapshot,
  args: { limit?: number; sector_query?: string },
): string {
  if (!snapshot.sectorRows?.length) return "Sector exposure: not loaded.";
  let rows = snapshot.sectorRows;
  const q = args.sector_query?.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.sector.toLowerCase().includes(q));
  const limit = Math.min(Math.max(args.limit ?? 12, 1), 30);
  const lines = ["=== SECTOR EXPOSURE (look-through) ==="];
  for (const row of rows.slice(0, limit)) {
    lines.push(`- ${row.sector}: ${row.weightPct.toFixed(1)}%`);
  }
  return lines.join("\n");
}

export function getStockExposure(
  snapshot: PortfolioSnapshot,
  args: { limit?: number; stock_query?: string },
): string {
  if (!snapshot.stockRows?.length) return "Stock exposure: not loaded.";
  let rows = snapshot.stockRows;
  const q = args.stock_query?.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  const limit = Math.min(Math.max(args.limit ?? 15, 1), 40);
  const lines = ["=== STOCK EXPOSURE (look-through) ==="];
  for (const row of rows.slice(0, limit)) {
    const sector = row.sector ? ` | ${row.sector}` : "";
    lines.push(`- ${row.name}${sector}: ${row.weightPct.toFixed(2)}%`);
  }
  return lines.join("\n");
}

export function getYearWiseReturns(snapshot: PortfolioSnapshot, args: { years?: number }): string {
  const perf = snapshot.perf;
  if (!perf?.yearWiseReturns?.length) return "Calendar year returns: not available.";
  const n = Math.min(Math.max(args.years ?? 6, 1), 15);
  const lines = ["=== CALENDAR YEAR RETURNS ==="];
  for (const row of perf.yearWiseReturns.slice(-n)) {
    lines.push(`- ${row.year}: ${pct(row.ret)}`);
  }
  return lines.join("\n");
}

export function getRiskMetrics(snapshot: PortfolioSnapshot): string {
  const perf = snapshot.perf;
  if (!perf) return "Risk metrics: NAV performance not loaded.";
  const lines = ["=== RISK METRICS ==="];
  if (perf.sharpeRatio != null) lines.push(`Sharpe ratio (36M): ${perf.sharpeRatio.toFixed(2)}`);
  if (perf.volatility != null) lines.push(`Volatility (annualized): ${pct(perf.volatility)}`);
  if (perf.maxDrawdown3Y != null) lines.push(`Max drawdown (3Y): ${pct(perf.maxDrawdown3Y)}`);
  if (perf.maxDrawdown5Y != null) lines.push(`Max drawdown (5Y): ${pct(perf.maxDrawdown5Y)}`);
  if (perf.currentDrawdown != null) lines.push(`Current drawdown: ${pct(perf.currentDrawdown)}`);
  return lines.join("\n");
}

export function executePortfolioTool(
  snapshot: PortfolioSnapshot,
  name: string,
  args: Record<string, unknown> = {},
): string {
  const tool = name as PortfolioToolName;
  switch (tool) {
    case "list_available_data":
      return listAvailableData(snapshot);
    case "get_portfolio_summary":
      return getPortfolioSummary(snapshot);
    case "get_portfolio_performance":
      return getPortfolioPerformance(snapshot, {
        include_calendar_years: Boolean(args.include_calendar_years),
        frames: Array.isArray(args.frames) ? args.frames.map(String) : undefined,
      });
    case "get_benchmark_comparison":
      return getBenchmarkComparison(snapshot, {
        benchmark_id: typeof args.benchmark_id === "string" ? args.benchmark_id : undefined,
        frames: Array.isArray(args.frames) ? args.frames.map(String) : undefined,
      });
    case "list_benchmark_indices":
      return listBenchmarkIndices(snapshot);
    case "get_benchmark_returns":
      return getBenchmarkReturns(snapshot, {
        benchmark_id: typeof args.benchmark_id === "string" ? args.benchmark_id : undefined,
        frames: Array.isArray(args.frames) ? args.frames.map(String) : undefined,
      });
    case "get_asset_allocation":
      return getAssetAllocation(snapshot);
    case "get_portfolio_fundamentals":
      return getPortfolioFundamentals(snapshot);
    case "get_holdings":
      return getHoldings(snapshot, {
        sort_by: typeof args.sort_by === "string" ? args.sort_by : undefined,
        order: typeof args.order === "string" ? args.order : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
        asset_class: typeof args.asset_class === "string" ? args.asset_class : undefined,
        category: typeof args.category === "string" ? args.category : undefined,
      });
    case "get_best_worst_funds":
      return getBestWorstFunds(snapshot, {
        mode: typeof args.mode === "string" ? args.mode : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
        sort_by: typeof args.sort_by === "string" ? args.sort_by : undefined,
      });
    case "get_fund_details":
      return getFundDetails(snapshot, {
        fund_name_query: typeof args.fund_name_query === "string" ? args.fund_name_query : undefined,
        rank_by_weight: typeof args.rank_by_weight === "number" ? args.rank_by_weight : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    case "search_market_funds":
      return searchMarketFunds(snapshot, {
        query: typeof args.query === "string" ? args.query : undefined,
        category: typeof args.category === "string" ? args.category : undefined,
        sort_by: typeof args.sort_by === "string" ? args.sort_by : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    case "get_market_fund_details":
      return getMarketFundDetails(snapshot, {
        scheme_code: typeof args.scheme_code === "string" ? args.scheme_code : undefined,
        name_query: typeof args.name_query === "string" ? args.name_query : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    case "get_sector_exposure":
      return getSectorExposure(snapshot, {
        limit: typeof args.limit === "number" ? args.limit : undefined,
        sector_query: typeof args.sector_query === "string" ? args.sector_query : undefined,
      });
    case "get_stock_exposure":
      return getStockExposure(snapshot, {
        limit: typeof args.limit === "number" ? args.limit : undefined,
        stock_query: typeof args.stock_query === "string" ? args.stock_query : undefined,
      });
    case "get_year_wise_returns":
      return getYearWiseReturns(snapshot, {
        years: typeof args.years === "number" ? args.years : undefined,
      });
    case "get_risk_metrics":
      return getRiskMetrics(snapshot);
    default:
      return `Unknown tool: ${name}`;
  }
}
