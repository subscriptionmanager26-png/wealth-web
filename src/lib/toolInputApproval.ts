import { BENCHMARK_OPTIONS } from "@mobile/utils/benchmarkTypes";
import type { BenchmarkId } from "@mobile/utils/benchmarkTypes";

import { TOOL_DESCRIPTIONS } from "./agentSteps";
import {
  computeDateRangeReturn,
  navPointsFromSeries,
  resolvePerformanceWindow,
  type NavPoint,
  type TimeFrame,
} from "./performanceUtils";
import type { PortfolioSnapshot } from "./portfolioTools/types";

export type FieldType = "text" | "number" | "date" | "select" | "multiselect" | "boolean" | "readonly";

export type ToolApprovalField = {
  key: string;
  label: string;
  type: FieldType;
  value: string | number | boolean | string[];
  options?: { value: string; label: string }[];
  hint?: string;
  /** When true, UI may refresh this field when linked keys change. */
  derived?: boolean;
  derivedFrom?: string;
};

export type ToolApprovalRequest = {
  toolName: string;
  toolLabel: string;
  toolDescription: string;
  llmArgs: Record<string, unknown>;
  fields: ToolApprovalField[];
};

const BENCHMARK_FRAME_OPTIONS = ["MTD", "1M", "3M", "6M", "1Y", "3Y", "5Y"].map((v) => ({
  value: v,
  label: v,
}));

const PORTFOLIO_FRAME_OPTIONS = ["MTD", "YTD", "1M", "3M", "6M", "1Y", "3Y", "5Y", "Max"].map((v) => ({
  value: v,
  label: v,
}));

const BENCHMARK_SELECT_OPTIONS = BENCHMARK_OPTIONS.map((b) => ({ value: b.id, label: b.label }));

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO YYYY-MM-DD → `05 July 2026` */
export function formatDateDisplay(iso: string): string {
  const d = parseDateInput(iso);
  if (!d) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-GB", { month: "long" });
  return `${day} ${month} ${d.getFullYear()}`;
}

function parseDateInput(value: string): Date | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asStringArray(v: unknown, fallback: string[]): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return fallback;
}

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function primaryFrame(frames: string[]): TimeFrame {
  const order = ["5Y", "3Y", "1Y", "6M", "3M", "1M", "MTD", "Max", "YTD"] as const;
  for (const f of order) {
    if (frames.includes(f)) return f as TimeFrame;
  }
  return (frames[0] as TimeFrame) ?? "1Y";
}

function deriveDateRange(
  points: NavPoint[],
  frame: TimeFrame,
): { start: string; end: string } | null {
  const window = resolvePerformanceWindow(points, frame);
  if (window.length < 2) return null;
  const first = window[0]!;
  const last = window[window.length - 1]!;
  return { start: toDateInputValue(first.date), end: toDateInputValue(last.date) };
}

function benchmarkNav(snapshot: PortfolioSnapshot, benchmarkId: string): NavPoint[] {
  return navPointsFromSeries(snapshot.benchmarkMonthEnds?.[benchmarkId as BenchmarkId]);
}

function portfolioNav(snapshot: PortfolioSnapshot): NavPoint[] {
  return navPointsFromSeries(snapshot.perf?.points?.map((p) => ({ date: p.date, nav100: p.nav100 })));
}

function field(
  key: string,
  label: string,
  type: FieldType,
  value: ToolApprovalField["value"],
  extra?: Partial<ToolApprovalField>,
): ToolApprovalField {
  return { key, label, type, value, ...extra };
}

function noArgFields(toolName: string): ToolApprovalField[] {
  return [
    field("tool", "Action", "readonly", TOOL_DESCRIPTIONS[toolName] ?? toolName),
  ];
}

export function buildToolApprovalFields(
  toolName: string,
  llmArgs: Record<string, unknown>,
  snapshot: PortfolioSnapshot,
): ToolApprovalField[] {
  switch (toolName) {
    case "get_benchmark_returns":
    case "get_benchmark_comparison": {
      const benchmarkId = asString(llmArgs.benchmark_id, "nifty500");
      const frames = asStringArray(llmArgs.frames, ["1Y"]);
      const nav =
        toolName === "get_benchmark_comparison" ? portfolioNav(snapshot) : benchmarkNav(snapshot, benchmarkId);
      const benchNav = benchmarkNav(snapshot, benchmarkId);
      const refNav = toolName === "get_benchmark_comparison" && nav.length >= 2 ? nav : benchNav;
      const frame = primaryFrame(frames);
      const range = deriveDateRange(refNav, frame);
      const llmStart = asString(llmArgs.start_date);
      const llmEnd = asString(llmArgs.end_date);
      return [
        field("benchmark_id", "Benchmark index", "select", benchmarkId, {
          options: BENCHMARK_SELECT_OPTIONS,
          hint: "Nifty TRI index to compare against",
        }),
        field("frames", "Period presets", "multiselect", frames, {
          options: BENCHMARK_FRAME_OPTIONS,
          hint: "Used to suggest dates; you can override dates below",
          derivedFrom: "benchmark_id",
        }),
        field("start_date", "Start date", "date", llmStart || range?.start || "", {
          hint: "Inclusive start of return window (month-end series)",
          derived: !llmStart,
          derivedFrom: "frames",
        }),
        field("end_date", "End date", "date", llmEnd || range?.end || "", {
          hint: "Inclusive end of return window (last completed month-end)",
          derived: !llmEnd,
          derivedFrom: "frames",
        }),
        field("return_mode", "Return calculation", "select", asString(llmArgs.return_mode, "auto"), {
          options: [
            { value: "auto", label: "Auto (CAGR if ≥1Y span)" },
            { value: "absolute", label: "Absolute %" },
            { value: "cagr", label: "Annualized (CAGR)" },
          ],
          hint: "How to compute return between the two dates",
        }),
      ];
    }

    case "get_portfolio_performance": {
      const frames = asStringArray(llmArgs.frames, ["YTD", "1Y"]);
      const nav = portfolioNav(snapshot);
      const frame = primaryFrame(frames);
      const range = deriveDateRange(nav, frame);
      return [
        field("frames", "Period presets", "multiselect", frames, {
          options: PORTFOLIO_FRAME_OPTIONS,
          hint: "Preset windows; override with custom dates if needed",
        }),
        field("start_date", "Start date", "date", asString(llmArgs.start_date) || range?.start || "", {
          derived: !llmArgs.start_date,
          derivedFrom: "frames",
        }),
        field("end_date", "End date", "date", asString(llmArgs.end_date) || range?.end || "", {
          derived: !llmArgs.end_date,
          derivedFrom: "frames",
        }),
        field("include_calendar_years", "Calendar year breakdown", "boolean", asBool(llmArgs.include_calendar_years), {
          hint: "Include last 6 calendar year returns in output",
        }),
      ];
    }

    case "get_holdings":
      return [
        field("sort_by", "Sort by", "select", asString(llmArgs.sort_by, "weight"), {
          options: ["weight", "return", "invested", "value", "name"].map((v) => ({ value: v, label: v })),
        }),
        field("order", "Order", "select", asString(llmArgs.order, "desc"), {
          options: [
            { value: "desc", label: "Descending" },
            { value: "asc", label: "Ascending" },
          ],
        }),
        field("limit", "Max rows", "number", asNumber(llmArgs.limit) ?? 20, { hint: "Number of holdings to return" }),
        field("asset_class", "Asset class filter", "text", asString(llmArgs.asset_class), {
          hint: "e.g. Equity, Debt (optional)",
        }),
        field("category", "Category filter", "text", asString(llmArgs.category), {
          hint: "Substring match on fund category (optional)",
        }),
      ];

    case "get_best_worst_funds":
      return [
        field("mode", "Mode", "select", asString(llmArgs.mode, "both"), {
          options: [
            { value: "best", label: "Best only" },
            { value: "worst", label: "Worst only" },
            { value: "both", label: "Best and worst" },
          ],
        }),
        field("sort_by", "Rank by", "select", asString(llmArgs.sort_by, "return"), {
          options: [
            { value: "return", label: "Return" },
            { value: "weight", label: "Weight" },
          ],
        }),
        field("limit", "Count per side", "number", asNumber(llmArgs.limit) ?? 5),
      ];

    case "get_fund_details":
      return [
        field("fund_name_query", "Fund name contains", "text", asString(llmArgs.fund_name_query), {
          hint: "Search your portfolio holdings by name",
        }),
        field("rank_by_weight", "Pick by weight rank", "select", String(asNumber(llmArgs.rank_by_weight) ?? 0), {
          options: [
            { value: "0", label: "Use name search instead" },
            { value: "1", label: "1 — largest holding" },
            { value: "2", label: "2 — second largest" },
            { value: "3", label: "3 — third largest" },
            { value: "4", label: "4 — fourth largest" },
            { value: "5", label: "5 — fifth largest" },
          ],
        }),
        field("limit", "Max funds", "number", asNumber(llmArgs.limit) ?? 3),
      ];

    case "search_market_funds":
      return [
        field("query", "Name search", "text", asString(llmArgs.query), { hint: "Substring in fund name" }),
        field("category", "Category", "text", asString(llmArgs.category), { hint: "e.g. Flexi Cap, Large Cap" }),
        field("sort_by", "Sort by", "select", asString(llmArgs.sort_by, "name"), {
          options: [
            { value: "name", label: "Name" },
            { value: "return_1y", label: "1Y return" },
            { value: "aum", label: "AUM" },
            { value: "ter", label: "TER" },
          ],
        }),
        field("limit", "Max results", "number", asNumber(llmArgs.limit) ?? 15),
      ];

    case "get_market_fund_details":
      return [
        field("scheme_code", "AMFI scheme code", "text", asString(llmArgs.scheme_code)),
        field("name_query", "Or name search", "text", asString(llmArgs.name_query)),
        field("limit", "Max matches", "number", asNumber(llmArgs.limit) ?? 2),
      ];

    case "get_sector_exposure":
      return [
        field("limit", "Max sectors", "number", asNumber(llmArgs.limit) ?? 15),
        field("sector_query", "Sector filter", "text", asString(llmArgs.sector_query)),
      ];

    case "get_stock_exposure":
      return [
        field("limit", "Max stocks", "number", asNumber(llmArgs.limit) ?? 15),
        field("stock_query", "Stock filter", "text", asString(llmArgs.stock_query)),
      ];

    case "get_year_wise_returns":
      return [field("years", "Last N years", "number", asNumber(llmArgs.years) ?? 6)];

    default:
      return noArgFields(toolName);
  }
}

export function refreshDerivedFields(
  toolName: string,
  fields: ToolApprovalField[],
  snapshot: PortfolioSnapshot,
): ToolApprovalField[] {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  const benchmarkId = String(byKey.benchmark_id?.value ?? "nifty500");
  const frames = Array.isArray(byKey.frames?.value)
    ? (byKey.frames.value as string[])
    : asStringArray(byKey.frames?.value, ["1Y"]);
  const frame = primaryFrame(frames);

  if (toolName === "get_benchmark_returns" || toolName === "get_benchmark_comparison") {
    const nav =
      toolName === "get_benchmark_comparison" ? portfolioNav(snapshot) : benchmarkNav(snapshot, benchmarkId);
    const benchNav = benchmarkNav(snapshot, benchmarkId);
    const refNav = toolName === "get_benchmark_comparison" && nav.length >= 2 ? nav : benchNav;
    const range = deriveDateRange(refNav, frame);
    return fields.map((f) => {
      if (!f.derived) return f;
      if (f.key === "start_date" && range) return { ...f, value: range.start };
      if (f.key === "end_date" && range) return { ...f, value: range.end };
      return f;
    });
  }

  if (toolName === "get_portfolio_performance") {
    const range = deriveDateRange(portfolioNav(snapshot), frame);
    return fields.map((f) => {
      if (!f.derived) return f;
      if (f.key === "start_date" && range) return { ...f, value: range.start };
      if (f.key === "end_date" && range) return { ...f, value: range.end };
      return f;
    });
  }

  return fields;
}

export function approvalFieldsToArgs(
  toolName: string,
  fields: ToolApprovalField[],
): Record<string, unknown> {
  const map = Object.fromEntries(fields.map((f) => [f.key, f.value]));

  switch (toolName) {
    case "get_benchmark_returns":
    case "get_benchmark_comparison":
      return {
        benchmark_id: asString(map.benchmark_id, "nifty500"),
        frames: asStringArray(map.frames, []),
        start_date: asString(map.start_date),
        end_date: asString(map.end_date),
        return_mode: asString(map.return_mode, "auto"),
      };
    case "get_portfolio_performance":
      return {
        frames: asStringArray(map.frames, []),
        start_date: asString(map.start_date),
        end_date: asString(map.end_date),
        include_calendar_years: asBool(map.include_calendar_years),
      };
    case "get_holdings":
      return {
        sort_by: asString(map.sort_by) || undefined,
        order: asString(map.order) || undefined,
        limit: asNumber(map.limit),
        asset_class: asString(map.asset_class) || undefined,
        category: asString(map.category) || undefined,
      };
    case "get_best_worst_funds":
      return {
        mode: asString(map.mode) || undefined,
        sort_by: asString(map.sort_by) || undefined,
        limit: asNumber(map.limit),
      };
    case "get_fund_details": {
      const rank = Number(asString(map.rank_by_weight, "0"));
      return {
        fund_name_query: asString(map.fund_name_query) || undefined,
        rank_by_weight: rank > 0 ? rank : undefined,
        limit: asNumber(map.limit),
      };
    }
    case "search_market_funds":
      return {
        query: asString(map.query) || undefined,
        category: asString(map.category) || undefined,
        sort_by: asString(map.sort_by) || undefined,
        limit: asNumber(map.limit),
      };
    case "get_market_fund_details":
      return {
        scheme_code: asString(map.scheme_code) || undefined,
        name_query: asString(map.name_query) || undefined,
        limit: asNumber(map.limit),
      };
    case "get_sector_exposure":
      return {
        limit: asNumber(map.limit),
        sector_query: asString(map.sector_query) || undefined,
      };
    case "get_stock_exposure":
      return {
        limit: asNumber(map.limit),
        stock_query: asString(map.stock_query) || undefined,
      };
    case "get_year_wise_returns":
      return { years: asNumber(map.years) };
    default:
      return {};
  }
}

export function buildToolApprovalRequest(
  toolName: string,
  llmArgs: Record<string, unknown>,
  snapshot: PortfolioSnapshot,
): ToolApprovalRequest {
  const fields = buildToolApprovalFields(toolName, llmArgs, snapshot);
  return {
    toolName,
    toolLabel: toolName,
    toolDescription: TOOL_DESCRIPTIONS[toolName] ?? "Run portfolio tool",
    llmArgs,
    fields,
  };
}

export function previewDateRangeReturn(
  points: NavPoint[],
  startDateStr: string,
  endDateStr: string,
  returnMode: string,
): string | null {
  const start = parseDateInput(startDateStr);
  const end = parseDateInput(endDateStr);
  if (!start || !end) return null;
  const mode = returnMode === "cagr" || returnMode === "absolute" ? returnMode : "auto";
  const result = computeDateRangeReturn(points, start, end, mode);
  if (!result.available || result.returnPct == null) return null;
  const kind = result.kind === "cagr" ? "ann." : "abs.";
  return `${result.returnPct >= 0 ? "+" : ""}${result.returnPct.toFixed(1)}% (${kind})`;
}
