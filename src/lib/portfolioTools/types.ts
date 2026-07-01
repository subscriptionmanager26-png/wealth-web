import type { FundHolding } from "../buildHoldings";
import type { PortfolioAnalyticsSnapshot } from "@mobile/utils/portfolioNavAnalytics";
import type { PortfolioFundamentalsSnapshot } from "@mobile/utils/portfolioInsightsAnalytics";
import type { BenchmarkId, BenchmarkMonthEndPoint } from "@mobile/utils/benchmarkTypes";
import type { UpvalySchemeDetail } from "@mobile/utils/upvalyMfApi";
import type { XRayHoldingRow, XRaySectorRow } from "@mobile/utils/xrayAggregations";

export type PortfolioHero = {
  total: number;
  invested: number;
  gain: number;
  xirr: string;
  dayChange?: number;
  dayChangePct?: number;
};

export type PortfolioSnapshot = {
  portfolioView: "family" | "member";
  hero: PortfolioHero;
  holdings: FundHolding[];
  perf?: PortfolioAnalyticsSnapshot | null;
  fundamentals?: PortfolioFundamentalsSnapshot | null;
  sectorRows?: XRaySectorRow[];
  stockRows?: XRayHoldingRow[];
  assetSlices?: { type: string; value: number }[];
  upvalySchemes?: Record<string, UpvalySchemeDetail>;
  benchmarkMonthEnds?: Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>;
};

export type PortfolioToolName =
  | "list_available_data"
  | "get_portfolio_summary"
  | "get_portfolio_performance"
  | "get_benchmark_comparison"
  | "get_asset_allocation"
  | "get_portfolio_fundamentals"
  | "get_holdings"
  | "get_best_worst_funds"
  | "get_fund_details"
  | "get_sector_exposure"
  | "get_stock_exposure"
  | "get_year_wise_returns"
  | "get_risk_metrics";
