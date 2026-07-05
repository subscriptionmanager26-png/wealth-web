import type { PortfolioToolName } from "./types";

/** Arguments each tool accepts — strip invalid planner keys (e.g. frames on summary). */
const TOOL_ALLOWED_ARGS: Record<string, ReadonlySet<string>> = {
  list_available_data: new Set(),
  get_portfolio_summary: new Set(),
  get_portfolio_performance: new Set([
    "frames",
    "include_calendar_years",
    "start_date",
    "end_date",
    "return_mode",
  ]),
  list_benchmark_indices: new Set(),
  get_benchmark_returns: new Set(["benchmark_id", "frames"]),
  get_benchmark_comparison: new Set([
    "benchmark_id",
    "frames",
    "start_date",
    "end_date",
    "return_mode",
  ]),
  search_market_funds: new Set(["query", "category", "sort_by", "limit"]),
  get_market_fund_details: new Set(["query", "rank"]),
  get_asset_allocation: new Set(),
  get_portfolio_fundamentals: new Set(),
  get_holdings: new Set(["sort_by", "order", "limit", "asset_class", "category"]),
  get_best_worst_funds: new Set(["mode", "limit", "sort_by"]),
  get_fund_details: new Set(["fund_name_query", "rank_by_weight", "limit"]),
  get_sector_exposure: new Set(["limit", "sector_query"]),
  get_stock_exposure: new Set(["limit", "stock_query"]),
  get_year_wise_returns: new Set(["years"]),
  get_risk_metrics: new Set(),
};

export function sanitizeToolArguments(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = TOOL_ALLOWED_ARGS[name];
  if (!allowed) return { ...args };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

export function isValidToolName(name: string): name is PortfolioToolName {
  return name in TOOL_ALLOWED_ARGS;
}
