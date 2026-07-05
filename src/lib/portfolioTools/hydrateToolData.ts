import type { PortfolioSnapshot } from "./types";
import type { ToolDataStore } from "./toolData";
import {
  buildAllocationData,
  buildDiversificationData,
  buildHoldingsData,
  buildPerformanceSeriesData,
  buildPeriodReturnsData,
  buildPortfolioSummaryData,
  buildRiskMetricsData,
  buildSectorExposureData,
} from "./toolData";

/**
 * Fill toolData gaps from the loaded portfolio snapshot so templates
 * can render rich UI even when the planner only called one tool.
 */
export function hydrateToolDataFromSnapshot(
  snapshot: PortfolioSnapshot,
  store: ToolDataStore,
): ToolDataStore {
  const next: ToolDataStore = { ...store };

  if (!next.portfolioSummary && snapshot.hero) {
    next.portfolioSummary = buildPortfolioSummaryData(snapshot);
  }
  if (!next.holdings?.rows.length && snapshot.holdings?.length) {
    next.holdings = buildHoldingsData(snapshot, { sort_by: "weight", limit: 10 });
  }
  if (!next.allocation?.slices.length) {
    const alloc = buildAllocationData(snapshot);
    if (alloc?.slices.length) next.allocation = alloc;
  }
  if (!next.periodReturns?.rows.length && snapshot.perf?.points?.length) {
    const pr = buildPeriodReturnsData(snapshot, { frames: ["MTD", "YTD", "1M", "1Y"] });
    if (pr.rows.length) next.periodReturns = pr;
  }
  if (!next.performanceSeries?.points.length) {
    const series = buildPerformanceSeriesData(snapshot);
    if (series) next.performanceSeries = series;
  }
  if (!next.diversification) {
    const div = buildDiversificationData(snapshot);
    if (div) next.diversification = div;
  }
  if (!next.sectorExposure?.rows.length && snapshot.sectorRows?.length) {
    const sectors = buildSectorExposureData(snapshot, { limit: 8 });
    if (sectors?.rows.length) next.sectorExposure = sectors;
  }
  if (!next.riskMetrics && snapshot.perf) {
    const risk = buildRiskMetricsData(snapshot);
    if (risk) next.riskMetrics = risk;
  }

  return next;
}
