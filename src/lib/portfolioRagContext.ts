import type { FundHolding } from "./buildHoldings";
import type { PortfolioAnalyticsSnapshot } from "@mobile/utils/portfolioNavAnalytics";
import type { PortfolioFundamentalsSnapshot } from "@mobile/utils/portfolioInsightsAnalytics";
import type { BenchmarkId, BenchmarkMonthEndPoint } from "@mobile/utils/benchmarkTypes";
import { BENCHMARK_OPTIONS } from "@mobile/utils/benchmarkTypes";
import {
  getUpvalyFundReturn,
  listUpvalyFundReturns,
  type UpvalySchemeDetail,
} from "@mobile/utils/upvalyMfApi";
import type { XRayHoldingRow, XRaySectorRow } from "@mobile/utils/xrayAggregations";
import {
  computePeriodReturn,
  navPointsFromSeries,
  type TimeFrame,
} from "./performanceUtils";

type Hero = {
  total: number;
  invested: number;
  gain: number;
  xirr: string;
  dayChange?: number;
  dayChangePct?: number;
};

const BENCHMARK_FRAMES: TimeFrame[] = ["MTD", "1Y", "3Y", "5Y"];
const FUND_DETAIL_LIMIT = 12;
const TOP_STOCKS_LIMIT = 15;

export function buildPortfolioRagContext(input: {
  /** Anonymous view label only — never investor names. */
  portfolioView: "family" | "member";
  hero: Hero;
  holdings: FundHolding[];
  perf?: PortfolioAnalyticsSnapshot | null;
  fundamentals?: PortfolioFundamentalsSnapshot | null;
  sectorRows?: XRaySectorRow[];
  stockRows?: XRayHoldingRow[];
  assetSlices?: { type: string; value: number }[];
  upvalySchemes?: Record<string, UpvalySchemeDetail>;
  benchmarkMonthEnds?: Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>;
}): string {
  const {
    portfolioView,
    hero,
    holdings,
    perf,
    fundamentals,
    sectorRows,
    stockRows,
    assetSlices,
    upvalySchemes = {},
    benchmarkMonthEnds,
  } = input;

  const totalWeight = holdings.reduce((a, h) => a + h.amount, 0) || 1;
  const sorted = [...holdings].sort((a, b) => b.amount - a.amount);
  const viewLabel = portfolioView === "family" ? "Aggregated family view" : "Single-member view";
  const lines: string[] = [
    `=== PORTFOLIO (${viewLabel}) ===`,
    "Note: Context excludes names, PAN, addresses, folio numbers, and other identifying details.",
  ];

  lines.push(
    `Current value: ₹${fmt(hero.total)}`,
    `Invested: ₹${fmt(hero.invested)}`,
    `Gain/Loss: ₹${fmt(hero.gain)} (${pct(hero.invested > 0 ? ((hero.gain / hero.invested) * 100) : null)})`,
    `XIRR: ${hero.xirr}`,
  );
  if (hero.dayChange != null && Number.isFinite(hero.dayChange)) {
    lines.push(`Day change: ₹${fmt(hero.dayChange)} (${pct(hero.dayChangePct ?? null)})`);
  }

  if (perf) {
    lines.push("", "=== PORTFOLIO PERFORMANCE (NAV-based) ===");
    if (perf.mtdReturn != null) lines.push(`MTD return: ${pct(perf.mtdReturn)}`);
    if (perf.ytdReturn != null) lines.push(`YTD return: ${pct(perf.ytdReturn)}`);
    if (perf.return1Y != null) lines.push(`1Y return: ${pct(perf.return1Y)}`);
    if (perf.annualized3Y != null) lines.push(`3Y annualized: ${pct(perf.annualized3Y)}`);
    if (perf.annualized5Y != null) lines.push(`5Y annualized: ${pct(perf.annualized5Y)}`);
    if (perf.annualizedSinceInception != null) {
      lines.push(`Since inception (annualized): ${pct(perf.annualizedSinceInception)}`);
    }
    if (perf.sharpeRatio != null) lines.push(`Sharpe ratio (36M): ${perf.sharpeRatio.toFixed(2)}`);
    if (perf.volatility != null) lines.push(`Volatility (annualized): ${pct(perf.volatility)}`);
    if (perf.maxDrawdown3Y != null) lines.push(`Max drawdown (3Y): ${pct(perf.maxDrawdown3Y)}`);
    if (perf.maxDrawdown5Y != null) lines.push(`Max drawdown (5Y): ${pct(perf.maxDrawdown5Y)}`);
    if (perf.currentDrawdown != null) lines.push(`Current drawdown: ${pct(perf.currentDrawdown)}`);

    if (perf.yearWiseReturns?.length) {
      lines.push("", "Calendar year returns:");
      for (const row of perf.yearWiseReturns.slice(-6)) {
        lines.push(`- ${row.year}: ${pct(row.ret)}`);
      }
    }
  }

  const portfolioNav = navPointsFromSeries(perf?.points?.map((p) => ({ date: p.date, nav100: p.nav100 })));
  const benchmarkId: BenchmarkId = "nifty500";
  const benchmarkLabel = BENCHMARK_OPTIONS.find((b) => b.id === benchmarkId)?.label ?? "Nifty 500";
  const benchNav = navPointsFromSeries(benchmarkMonthEnds?.[benchmarkId]);
  if (portfolioNav.length >= 2 || benchNav.length >= 2) {
    lines.push("", `=== BENCHMARK COMPARISON (vs ${benchmarkLabel} TRI) ===`);
    for (const frame of BENCHMARK_FRAMES) {
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
  }

  if (assetSlices?.length) {
    lines.push("", "=== ASSET ALLOCATION ===");
    for (const slice of assetSlices) {
      const w = totalWeight > 0 ? (slice.value / totalWeight) * 100 : 0;
      lines.push(`- ${slice.type}: ${w.toFixed(1)}% (₹${fmt(slice.value)})`);
    }
  }

  if (fundamentals?.weighted) {
    lines.push("", "=== PORTFOLIO FUNDAMENTALS (value-weighted) ===");
    const w = fundamentals.weighted;
    if (w.expenseRatio.value != null) lines.push(`TER: ${w.expenseRatio.value.toFixed(2)}%`);
    if (w.pe.value != null) lines.push(`P/E: ${w.pe.value.toFixed(1)}`);
    if (w.pb.value != null) lines.push(`P/B: ${w.pb.value.toFixed(2)}`);
    if (w.yieldToMaturity.value != null) lines.push(`Yield to maturity: ${w.yieldToMaturity.value.toFixed(2)}%`);
    if (w.modifiedDuration.value != null) lines.push(`Modified duration: ${w.modifiedDuration.value.toFixed(2)} yrs`);
  }

  if (sectorRows?.length) {
    lines.push("", "=== SECTOR EXPOSURE (look-through) ===");
    for (const row of sectorRows.slice(0, 12)) {
      lines.push(`- ${row.sector}: ${row.weightPct.toFixed(1)}%`);
    }
  }

  if (stockRows?.length) {
    lines.push("", "=== TOP STOCK HOLDINGS (look-through) ===");
    for (const row of stockRows.slice(0, TOP_STOCKS_LIMIT)) {
      const sector = row.sector ? ` | ${row.sector}` : "";
      lines.push(`- ${row.name}${sector}: ${row.weightPct.toFixed(2)}%`);
    }
  }

  lines.push("", "=== HOLDINGS SUMMARY ===");
  for (const h of sorted) {
    const weight = (h.amount / totalWeight) * 100;
    lines.push(
      `- ${h.name} | ${h.assetClass}/${h.category} | Weight ${weight.toFixed(1)}% | ` +
        `Value ₹${fmt(h.current)} | Invested ₹${fmt(h.invested)} | Return ${pct(h.returnPct)} | ` +
        `Plan ${h.planTag ?? "—"}`,
    );
  }

  const detailFunds = sorted.filter((h) => h.amount > 0).slice(0, FUND_DETAIL_LIMIT);
  if (detailFunds.length) {
    lines.push("", "=== FUND DETAILS (from scheme data) ===");
    for (const h of detailFunds) {
      const code = h.amfiCode?.trim();
      const scheme = code ? upvalySchemes[code] : undefined;
      lines.push("", `Fund: ${h.name}`);
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

      const ret1y = getUpvalyFundReturn(scheme, "1y");
      const ret3y = getUpvalyFundReturn(scheme, "3y");
      const ret5y = getUpvalyFundReturn(scheme, "5y");
      const fundReturns: string[] = [];
      if (ret1y) fundReturns.push(`1Y ${pct(ret1y.valuePct)}`);
      if (ret3y) fundReturns.push(`3Y ${pct(ret3y.valuePct)}`);
      if (ret5y) fundReturns.push(`5Y ${pct(ret5y.valuePct)}`);
      if (fundReturns.length) lines.push(`  Fund returns: ${fundReturns.join(" | ")}`);

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
  }

  return lines.join("\n");
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}
