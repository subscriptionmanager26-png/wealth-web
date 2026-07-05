import { BENCHMARK_OPTIONS } from "@mobile/utils/benchmarkTypes";
import type { BenchmarkId } from "@mobile/utils/benchmarkTypes";
import {
  getUpvalyFundReturn,
  listUpvalyFundReturns,
} from "@mobile/utils/upvalyMfApi";
import type { ScreenerSchemeMetrics } from "../screenerSnapshot";
import {
  computeDateRangeReturn,
  computePeriodReturn,
  formatPerfDateRange,
  navPointsFromSeries,
  TIME_FRAMES,
  type TimeFrame,
} from "../performanceUtils";
import { pct } from "./format";
import type { PortfolioSnapshot } from "./types";

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

function formatCustomBenchmarkLine(
  label: string,
  benchNav: ReturnType<typeof navPointsFromSeries>,
  start: Date,
  end: Date,
  returnMode: "auto" | "absolute" | "cagr",
): string | null {
  const result = computeDateRangeReturn(benchNav, start, end, returnMode);
  if (!result.available || result.returnPct == null) return null;
  const kind = result.kind === "cagr" ? "ann." : "abs.";
  const range = formatPerfDateRange(result.startDate, result.endDate);
  return `${label}: ${pct(result.returnPct)} (${kind}${range ? ` · ${range}` : ""})`;
}

export function listBenchmarkIndices(snapshot: PortfolioSnapshot): string {
  const loaded = new Set(
    Object.entries(snapshot.benchmarkMonthEnds ?? {})
      .filter(([, v]) => (v?.length ?? 0) >= 2)
      .map(([id]) => id),
  );
  const lines = ["=== NIFTY BENCHMARK INDICES (TRI month-end) ==="];
  lines.push(`Data loaded for ${loaded.size} of ${BENCHMARK_OPTIONS.length} indices.`);
  lines.push("");
  for (const opt of BENCHMARK_OPTIONS) {
    const status = loaded.has(opt.id) ? "loaded" : "not loaded";
    lines.push(`- ${opt.id}: ${opt.label} [${status}]`);
  }
  lines.push("");
  lines.push("Use get_benchmark_returns for index-only returns, or get_benchmark_comparison vs your portfolio.");
  return lines.join("\n");
}

export function getBenchmarkReturns(
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
  const benchNav = navPointsFromSeries(snapshot.benchmarkMonthEnds?.[benchmarkId]);

  if (benchNav.length < 2) {
    return `Benchmark ${label} (${benchmarkId}): month-end TRI series not loaded. Call list_benchmark_indices for available indices.`;
  }

  const start = parseIsoDate(args.start_date);
  const end = parseIsoDate(args.end_date);
  const returnMode = returnModeArg(args.return_mode);
  const lines = [`=== BENCHMARK RETURNS: ${label} (${benchmarkId}) ===`];

  if (start && end) {
    const custom = formatCustomBenchmarkLine("Custom range", benchNav, start, end, returnMode);
    lines.push(custom ?? "Custom range: NA (insufficient history for selected dates)");
  }

  const frameSet = new Set(
    (args.frames?.length ? args.frames : start && end ? [] : COMPARISON_FRAMES) as TimeFrame[],
  );
  for (const frame of COMPARISON_FRAMES) {
    if (!frameSet.has(frame)) continue;
    const result = computePeriodReturn(benchNav, frame);
    if (!result.available) {
      lines.push(`${frame}: NA (insufficient history)`);
      continue;
    }
    const kind = result.kind === "cagr" ? "ann." : "abs.";
    const range = formatPerfDateRange(result.startDate, result.endDate);
    lines.push(`${frame}: ${pct(result.returnPct)} (${kind}${range ? ` · ${range}` : ""})`);
  }
  return lines.join("\n");
}

function screenerEntries(snapshot: PortfolioSnapshot): [string, ScreenerSchemeMetrics][] {
  return Object.entries(snapshot.screenerFunds ?? {});
}

function portfolioSchemeCodes(snapshot: PortfolioSnapshot): Set<string> {
  return new Set(
    snapshot.holdings.map((h) => h.amfiCode?.trim()).filter((c): c is string => Boolean(c)),
  );
}

export function searchMarketFunds(
  snapshot: PortfolioSnapshot,
  args: {
    query?: string;
    category?: string;
    sort_by?: string;
    limit?: number;
  },
): string {
  const index = screenerEntries(snapshot);
  if (!index.length) {
    return "Market fund screener: not loaded. Equity Direct Growth universe unavailable.";
  }

  let rows = index;
  const q = args.query?.trim().toLowerCase();
  const cat = args.category?.trim().toLowerCase();
  if (q) rows = rows.filter(([, s]) => s.schemeName.toLowerCase().includes(q));
  if (cat) {
    rows = rows.filter(
      ([, s]) =>
        (s.schemeCategoryLabel ?? s.schemeCategory ?? "").toLowerCase().includes(cat) ||
        (s.schemeCategory ?? "").toLowerCase().includes(cat),
    );
  }

  const inPortfolio = portfolioSchemeCodes(snapshot);
  const sortBy = args.sort_by ?? "name";
  rows.sort(([, a], [, b]) => {
    if (sortBy === "return_1y") {
      return (getUpvalyFundReturn(b, "1y")?.valuePct ?? -Infinity) - (getUpvalyFundReturn(a, "1y")?.valuePct ?? -Infinity);
    }
    if (sortBy === "aum") return (b.aumCr ?? 0) - (a.aumCr ?? 0);
    if (sortBy === "ter") return (a.expenseRatio ?? Infinity) - (b.expenseRatio ?? Infinity);
    return a.schemeName.localeCompare(b.schemeName);
  });

  const limit = Math.min(Math.max(args.limit ?? 15, 1), 40);
  const lines = [
    "=== MARKET FUND SEARCH (Equity Direct Growth screener) ===",
    `Universe: ${index.length} funds${snapshot.screenerGeneratedAt ? ` · data as of ${snapshot.screenerGeneratedAt}` : ""}`,
  ];
  if (q) lines.push(`Filter name: "${args.query}"`);
  if (cat) lines.push(`Filter category: "${args.category}"`);

  if (!rows.length) {
    lines.push("No funds matched. Try a shorter query or broader category.");
    return lines.join("\n");
  }

  lines.push("", `Showing ${Math.min(limit, rows.length)} of ${rows.length} matches:`);
  for (const [code, s] of rows.slice(0, limit)) {
    const ret1y = getUpvalyFundReturn(s, "1y");
    const owned = inPortfolio.has(code) ? " · in portfolio" : "";
    lines.push(
      `- [${code}] ${s.schemeName} | ${s.schemeCategoryLabel ?? s.schemeCategory ?? "—"} | ` +
        `1Y ${pct(ret1y?.valuePct ?? null)} | AUM ₹${s.aumCr != null ? `${s.aumCr.toFixed(0)} Cr` : "—"}${owned}`,
    );
  }
  lines.push("", "Use get_market_fund_details with scheme_code or name_query for full facts.");
  return lines.join("\n");
}

export function getMarketFundDetails(
  snapshot: PortfolioSnapshot,
  args: { scheme_code?: string; name_query?: string; limit?: number },
): string {
  const index = snapshot.screenerFunds ?? {};
  const codes = Object.keys(index);
  if (!codes.length) return "Market fund screener: not loaded.";

  const limit = Math.min(Math.max(args.limit ?? 2, 1), 5);
  let picks: ScreenerSchemeMetrics[] = [];

  const code = args.scheme_code?.trim();
  if (code && index[code]) {
    picks = [index[code]!];
  } else if (args.name_query?.trim()) {
    const q = args.name_query.trim().toLowerCase();
    picks = codes
      .map((c) => index[c]!)
      .filter((s) => s.schemeName.toLowerCase().includes(q))
      .slice(0, limit);
  } else {
    return "Provide scheme_code (AMFI code from search) or name_query.";
  }

  if (!picks.length) return `No market fund matched "${args.name_query ?? code ?? ""}".`;

  const inPortfolio = portfolioSchemeCodes(snapshot);
  const lines = ["=== MARKET FUND DETAILS (screener — not limited to your holdings) ==="];

  for (const scheme of picks) {
    const codeKey = scheme.schemeCode;
    lines.push("", `Fund: ${scheme.schemeName}`);
    lines.push(`  Scheme code (AMFI): ${codeKey}`);
    if (inPortfolio.has(codeKey)) lines.push("  Note: also held in your portfolio");
    if (scheme.schemeCategoryLabel || scheme.schemeCategory) {
      lines.push(`  Category: ${scheme.schemeCategoryLabel ?? scheme.schemeCategory}`);
    }
    if (scheme.aumCr != null) lines.push(`  AUM: ₹${scheme.aumCr.toLocaleString("en-IN")} Cr`);
    if (scheme.expenseRatio != null) lines.push(`  TER: ${scheme.expenseRatio.toFixed(2)}%`);
    if (scheme.inceptionDate) lines.push(`  Inception: ${scheme.inceptionDate}`);
    if (scheme.categoryRank3y != null) lines.push(`  Category rank (3Y): ${scheme.categoryRank3y}`);

    const retFrames = ["3m", "6m", "1y", "3y", "5y"] as const;
    const retParts: string[] = [];
    for (const tf of retFrames) {
      const ret = getUpvalyFundReturn(scheme, tf);
      if (ret) retParts.push(`${ret.label} ${pct(ret.valuePct)}`);
    }
    if (retParts.length) lines.push(`  Returns: ${retParts.join(" | ")}`);

    if (scheme.volatility3y != null) lines.push(`  Volatility (3Y): ${scheme.volatility3y.toFixed(2)}%`);
    if (scheme.sharpe3y != null) lines.push(`  Sharpe (3Y): ${scheme.sharpe3y.toFixed(2)}`);

    const f = scheme.fundamentals;
    if (f) {
      const parts: string[] = [];
      if (f.pe) parts.push(`P/E ${f.pe}`);
      if (f.pb) parts.push(`P/B ${f.pb}`);
      if (parts.length) lines.push(`  Fundamentals: ${parts.join(" | ")}`);
    }

    const topHoldings = scheme.holdings?.slice(0, 5) ?? [];
    if (topHoldings.length) {
      lines.push("  Top underlying holdings:");
      for (const row of topHoldings) {
        lines.push(`    - ${row.name}: ${row.weightage}%${row.sector ? ` (${row.sector})` : ""}`);
      }
    }

    const extra = listUpvalyFundReturns(scheme)
      .filter((r) => !retFrames.includes(r.timeframe as (typeof retFrames)[number]))
      .slice(0, 3)
      .map((r) => `${r.label} ${pct(r.valuePct)}`);
    if (extra.length) lines.push(`  Other returns: ${extra.join(" | ")}`);
  }
  return lines.join("\n");
}

export function formatPortfolioPeriodReturns(
  snapshot: PortfolioSnapshot,
  args: {
    frames?: string[];
    include_calendar_years?: boolean;
    start_date?: string;
    end_date?: string;
    return_mode?: string;
  },
): string {
  const perf = snapshot.perf;
  if (!perf?.points?.length) return "Portfolio NAV performance: not loaded yet.";

  const nav = navPointsFromSeries(perf.points.map((p) => ({ date: p.date, nav100: p.nav100 })));
  const start = parseIsoDate(args.start_date);
  const end = parseIsoDate(args.end_date);
  const returnMode = returnModeArg(args.return_mode);
  const requested = (args.frames?.length ? args.frames : ["MTD", "YTD", "1M", "3M", "6M", "1Y", "3Y", "5Y"]) as string[];

  const lines = ["=== PORTFOLIO PERFORMANCE (NAV-based, month-end) ==="];

  if (start && end) {
    const custom = formatCustomBenchmarkLine("Custom range", nav, start, end, returnMode);
    lines.push(custom ?? "Custom range: NA (insufficient history for selected dates)");
  }

  for (const frame of requested) {
    if (frame === "YTD") {
      lines.push(`YTD: ${pct(perf.ytdReturn)}`);
      continue;
    }
    if (!(TIME_FRAMES as readonly string[]).includes(frame)) continue;
    const result = computePeriodReturn(nav, frame as TimeFrame);
    if (!result.available) {
      lines.push(`${frame}: NA (insufficient history)`);
      continue;
    }
    const kind = result.kind === "cagr" ? "ann." : "abs.";
    const range = formatPerfDateRange(result.startDate, result.endDate);
    lines.push(`${frame}: ${pct(result.returnPct)} (${kind}${range ? ` · ${range}` : ""})`);
  }

  if (perf.annualizedSinceInception != null) {
    lines.push(`Since inception (ann.): ${pct(perf.annualizedSinceInception)}`);
  }
  if (perf.sharpeRatio != null) lines.push(`Sharpe (36M): ${perf.sharpeRatio.toFixed(2)}`);
  if (perf.volatility != null) lines.push(`Volatility (ann.): ${pct(perf.volatility)}`);

  if (args.include_calendar_years && perf.yearWiseReturns?.length) {
    lines.push("", "Calendar year returns:");
    for (const row of perf.yearWiseReturns.slice(-6)) {
      lines.push(`- ${row.year}: ${pct(row.ret)}`);
    }
  }
  return lines.join("\n");
}
