import { useMemo, useState } from "react";

import type { PortfolioAnalyticsSnapshot } from "@mobile/utils/portfolioNavAnalytics";
import type { PortfolioFundamentalsSnapshot } from "@mobile/utils/portfolioInsightsAnalytics";
import type { ParsedCas } from "@mobile/utils/casParser";
import type { XRayHoldingRow, XRaySectorRow } from "@mobile/utils/xrayAggregations";
import { parseUpvalyMetric, type UpvalySchemeDetail } from "@mobile/utils/upvalyMfApi";
import { BENCHMARK_OPTIONS, type BenchmarkId, type BenchmarkMonthEndPoint } from "@mobile/utils/benchmarkTypes";
import {
  TIME_FRAMES,
  computePeriodReturn,
  formatHeroReturn,
  formatPerfDateRange,
  isFrameAvailable,
  navPointsFromSeries,
  returnToneColor,
  type TimeFrame,
} from "../lib/performanceUtils";
import { formatPct, hasMaterialHoldingValue } from "../lib/format";
import { TransactionLedgerSection } from "./TransactionLedgerSection";

const CATEGORIES = ["Performance", "Diversification", "Fundamentals", "Others"] as const;
const SECTOR_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#cbd5e1"];
const DIST_PAGE_SIZE = 10;

type AnalysisTabProps = {
  hero: { total: number; invested: number; gain: number; xirr: string };
  perf: PortfolioAnalyticsSnapshot | null;
  portfolioFundamentals: PortfolioFundamentalsSnapshot;
  assetSlices: { type: string; value: number; color: string }[];
  sectorRows: XRaySectorRow[];
  stockRows: XRayHoldingRow[];
  upvalySchemes: Record<string, UpvalySchemeDetail>;
  holdings: {
    id: string;
    name: string;
    category: string;
    subCategory: string;
    invested: number;
    value: number;
    totalUnits: number;
    returns: number;
    owner: string;
    amfiCode?: string;
  }[];
  savedParsedDocs: ParsedCas[];
  showOwnerTags: boolean;
  overviewSharpe: string;
  onOpenInsights?: () => void;
  benchmarkMonthEnds?: Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>;
  benchmarkDailyNav?: Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>;
  sellFundsCount?: number;
};

export function AnalysisTab({
  hero,
  perf,
  portfolioFundamentals,
  assetSlices,
  sectorRows,
  holdings,
  savedParsedDocs,
  stockRows,
  upvalySchemes,
  showOwnerTags,
  onOpenInsights,
  benchmarkMonthEnds,
  benchmarkDailyNav,
  sellFundsCount = 0,
  overviewSharpe,
}: AnalysisTabProps) {
  const materialHoldings = useMemo(
    () => holdings.filter((h) => hasMaterialHoldingValue(h.value)),
    [holdings],
  );

  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Performance");
  const [chartType, setChartType] = useState<"stock" | "sector" | "assetClass">("assetClass");
  const [distPage, setDistPage] = useState(1);
  const [selectedDistLabel, setSelectedDistLabel] = useState<string | null>(null);
  const [fundamentalsView, setFundamentalsView] = useState<"portfolio" | "fund">("portfolio");
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("1Y");
  const [benchmarkId, setBenchmarkId] = useState<BenchmarkId>("nifty500");
  const [benchmarkPickerOpen, setBenchmarkPickerOpen] = useState(false);

  const portfolioNavPoints = useMemo(() => {
    return navPointsFromSeries((perf?.points ?? []).map((p) => ({ date: p.date, nav100: p.nav100 })));
  }, [perf?.points]);

  const benchmarkNavPoints = useMemo(() => {
    const useDaily = timeFrame === "MTD" || timeFrame === "1M" || timeFrame === "3M" || timeFrame === "6M";
    const src = useDaily ? benchmarkDailyNav?.[benchmarkId] : benchmarkMonthEnds?.[benchmarkId];
    return navPointsFromSeries(src?.map((p) => ({ date: p.date, nav100: p.nav100 })));
  }, [benchmarkDailyNav, benchmarkId, benchmarkMonthEnds, timeFrame]);

  const periodMetrics = useMemo(() => computePeriodReturn(portfolioNavPoints, timeFrame), [portfolioNavPoints, timeFrame]);
  const benchMetrics = useMemo(() => computePeriodReturn(benchmarkNavPoints, timeFrame), [benchmarkNavPoints, timeFrame]);

  const portfolioReturnText = formatHeroReturn(periodMetrics);
  const benchmarkReturnText = formatHeroReturn(benchMetrics);
  const benchmarkLabel = BENCHMARK_OPTIONS.find((b) => b.id === benchmarkId)?.label ?? benchmarkId;

  const alpha =
    periodMetrics.returnPct != null && benchMetrics.returnPct != null
      ? periodMetrics.returnPct - benchMetrics.returnPct
      : null;

  const alphaPill = useMemo(() => {
    if (alpha == null || !Number.isFinite(alpha)) {
      return { text: "Insufficient data for alpha", tone: "neutral" as const };
    }
    const sign = alpha >= 0 ? "+" : "";
    return {
      text: `${sign}${alpha.toFixed(2)}% vs ${benchmarkLabel}`,
      tone: alpha > 0 ? ("positive" as const) : alpha < 0 ? ("negative" as const) : ("neutral" as const),
    };
  }, [alpha, benchmarkLabel]);

  const performanceDateRange = formatPerfDateRange(periodMetrics.startDate, periodMetrics.endDate);

  const distRows = useMemo(() => {
    const total = hero.total || 1;
    return assetSlices
      .map((s, i) => ({
        label: s.type,
        weightPct: (s.value / total) * 100,
        color: s.color ?? SECTOR_COLORS[i % SECTOR_COLORS.length],
      }))
      .sort((a, b) => b.weightPct - a.weightPct);
  }, [assetSlices, hero.total]);

  const allDistRows = useMemo(() => {
    const total = hero.total || 1;
    if (chartType === "assetClass") return distRows;
    if (chartType === "sector") {
      return sectorRows.map((r, i) => ({
        label: r.sector,
        weightPct: r.weightPct,
        color: SECTOR_COLORS[i % SECTOR_COLORS.length],
      }));
    }
    return stockRows.map((r, i) => ({
      label: r.name,
      weightPct: r.weightPct,
      color: SECTOR_COLORS[i % SECTOR_COLORS.length],
    }));
  }, [chartType, distRows, hero.total, sectorRows, stockRows]);

  const distTotalPages = Math.max(1, Math.ceil(allDistRows.length / DIST_PAGE_SIZE));
  const effectiveDistPage = Math.min(distPage, distTotalPages);
  const paginatedDistRows = allDistRows.slice(
    (effectiveDistPage - 1) * DIST_PAGE_SIZE,
    effectiveDistPage * DIST_PAGE_SIZE,
  );

  const diagnosticContributions = useMemo(() => {
    if (!selectedDistLabel) return [];
    let sources: { fundName: string; contribPct: number }[] = [];
    if (chartType === "stock") {
      sources = stockRows.find((r) => r.name === selectedDistLabel)?.sources ?? [];
    } else if (chartType === "sector") {
      sources = sectorRows.find((r) => r.sector === selectedDistLabel)?.sources ?? [];
    } else {
      const total = hero.total || 1;
      sources = materialHoldings
        .filter((h) => h.category === selectedDistLabel && h.value > 0)
        .map((h) => ({ fundName: h.name, contribPct: (h.value / total) * 100 }));
    }
    const map = new Map(sources.map((s) => [s.fundName, s.contribPct]));
    return materialHoldings
      .map((h) => ({ name: h.name, contrib: map.get(h.name) ?? 0 }))
      .filter((row) => row.contrib > 0)
      .sort((a, b) => b.contrib - a.contrib);
  }, [chartType, hero.total, materialHoldings, sectorRows, selectedDistLabel, stockRows]);

  return (
    <div className="analysis-root">
      <div className="analysis-cat-bar">
        <div className="analysis-cat-row">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`analysis-cat-btn ${category === cat ? "analysis-cat-btn-active" : ""}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="analysis-body">
      {category === "Performance" ? (
        <>
          <section className="panel-card">
            <p className="eyebrow">Portfolio vs benchmark</p>
            <div className="compare-row">
              <div className="compare-col">
                <span className="compare-label">Your portfolio</span>
                <span
                  className="compare-value"
                  style={{ color: returnToneColor(portfolioReturnText, periodMetrics.returnPct) }}
                >
                  {portfolioReturnText}
                </span>
              </div>
              <div className="compare-divider" />
              <div className="compare-col">
                <button type="button" className="benchmark-picker" onClick={() => setBenchmarkPickerOpen(true)}>
                  <span className="compare-label">{benchmarkLabel}</span>
                  <span className="edit-icon">✎</span>
                </button>
                <span
                  className="compare-value"
                  style={{ color: returnToneColor(benchmarkReturnText, benchMetrics.returnPct) }}
                >
                  {benchmarkReturnText}
                </span>
              </div>
            </div>
            <div className={`alpha-pill alpha-pill-${alphaPill.tone}`}>{alphaPill.text}</div>
          </section>

          {performanceDateRange ? <p className="date-range">{performanceDateRange}</p> : null}

          <section className="panel-card">
            <p className="eyebrow">Time period</p>
            <div className="pill-row">
              {TIME_FRAMES.map((frame) => {
                const active = timeFrame === frame;
                const available = isFrameAvailable(portfolioNavPoints, frame);
                return (
                  <button
                    key={frame}
                    type="button"
                    className={`pill ${active ? "pill-active" : ""} ${!available && !active ? "pill-muted" : ""}`}
                    onClick={() => setTimeFrame(frame)}
                  >
                    {frame}
                  </button>
                );
              })}
            </div>
          </section>

          {sellFundsCount > 0 ? (
            <button type="button" className="alert-card" onClick={onOpenInsights}>
              <span className="alert-icon">⚠</span>
              <span>
                <strong>
                  {sellFundsCount} fund{sellFundsCount === 1 ? "" : "s"} flagged to sell
                </strong>
                <br />
                <span className="muted">Tap to see which funds and why</span>
              </span>
            </button>
          ) : null}
        </>
      ) : null}

      {category === "Diversification" ? (
        <>
          <div className="segmented-nav">
            {(["stock", "sector", "assetClass"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`segmented-btn ${chartType === k ? "segmented-btn-active" : ""}`}
                onClick={() => {
                  setChartType(k);
                  setDistPage(1);
                  setSelectedDistLabel(null);
                }}
              >
                {k === "assetClass" ? "Asset class" : k === "sector" ? "Sector" : "Stock"}
              </button>
            ))}
          </div>

          <section className="panel-card">
            <p className="eyebrow">
              {chartType === "assetClass"
                ? "Asset class allocation"
                : chartType === "sector"
                  ? "Top sector allocation"
                  : "Top underlying stocks"}
            </p>
            {chartType === "stock" ? (
              <p className="muted">Aggregated across all mutual funds</p>
            ) : null}
            {!paginatedDistRows.length ? (
              <p className="muted">
                {chartType === "assetClass"
                  ? "Asset class breakdown loads from your holdings."
                  : chartType === "sector"
                    ? "Sector data loads after source mapping completes."
                    : "Stock-level X-Ray data not loaded yet."}
              </p>
            ) : (
              paginatedDistRows.map((row, i) => {
                const selected = selectedDistLabel === row.label;
                return (
                  <button
                    key={row.label}
                    type="button"
                    className={`dist-row dist-row-btn ${selected ? "dist-row-selected" : ""}`}
                    onClick={() => setSelectedDistLabel((prev) => (prev === row.label ? null : row.label))}
                  >
                    <div className="dist-head">
                      <span>{row.label}</span>
                      <span>{row.weightPct.toFixed(1)}%</span>
                    </div>
                    <div className="dist-track">
                      <div
                        className="dist-fill"
                        style={{
                          width: `${Math.max(2, row.weightPct)}%`,
                          background: row.color ?? SECTOR_COLORS[i % 5],
                        }}
                      />
                    </div>
                  </button>
                );
              })
            )}
            {distTotalPages > 1 ? (
              <div className="dist-pager">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={effectiveDistPage <= 1}
                  onClick={() => setDistPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span className="muted">
                  Page {effectiveDistPage} of {distTotalPages}
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={effectiveDistPage >= distTotalPages}
                  onClick={() => setDistPage((p) => Math.min(distTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            ) : null}
          </section>

          {selectedDistLabel ? (
            <section className="panel-card">
              <p className="eyebrow">Fund contribution · {selectedDistLabel}</p>
              {!diagnosticContributions.length ? (
                <p className="muted">No fund-level contribution data for this item.</p>
              ) : (
                diagnosticContributions.map((row) => (
                  <div key={row.name} className="contrib-row">
                    <span>{row.name}</span>
                    <span>{row.contrib.toFixed(2)}%</span>
                  </div>
                ))
              )}
            </section>
          ) : (
            <p className="muted">Tap a row above to see each fund&apos;s contribution.</p>
          )}
        </>
      ) : null}

      {category === "Fundamentals" ? (
        <>
          <div className="segmented-nav">
            <button
              type="button"
              className={`segmented-btn ${fundamentalsView === "portfolio" ? "segmented-btn-active" : ""}`}
              onClick={() => setFundamentalsView("portfolio")}
            >
              Portfolio
            </button>
            <button
              type="button"
              className={`segmented-btn ${fundamentalsView === "fund" ? "segmented-btn-active" : ""}`}
              onClick={() => setFundamentalsView("fund")}
            >
              Fund wise
            </button>
          </div>

          {fundamentalsView === "portfolio" ? (
            <section className="panel-card">
              <div className="fund-grid">
                {[
                  ["Volatility", formatPct(perf?.volatility), "Annualized std dev"],
                  ["Sharpe ratio", overviewSharpe, "Risk-adjusted return"],
                  ["Max DD", formatPct(perf?.maxDrawdownAll), "Historical peak to trough"],
                  ["Current DD", formatPct(perf?.currentDrawdown), "From running peak"],
                  ["Portfolio P/E", portfolioFundamentals.weighted.pe.value?.toFixed(1) ?? "—", "Price to earnings"],
                  [
                    "Portfolio YTM",
                    portfolioFundamentals.weighted.yieldToMaturity.value != null
                      ? `${portfolioFundamentals.weighted.yieldToMaturity.value.toFixed(1)}%`
                      : "—",
                    "Yield to maturity (debt)",
                  ],
                  [
                    "Expense ratio",
                    portfolioFundamentals.weighted.expenseRatio.value != null
                      ? `${portfolioFundamentals.weighted.expenseRatio.value.toFixed(2)}%`
                      : "—",
                    "Value-weighted average TER",
                  ],
                ].map(([label, val, sub]) => (
                  <div key={label} className="fund-tile">
                    <span className="metric-label">{label}</span>
                    <span className="metric-value">{val}</span>
                    <span className="muted caption">{sub}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            materialHoldings.map((h) => {
              const scheme = h.amfiCode ? upvalySchemes[h.amfiCode] : undefined;
              const fundamentals = scheme?.fundamentals;
              const expenseRatio = scheme?.expenseRatio;
              return (
                <section key={h.id} className="panel-card">
                  <h3 className="fund-title">{h.name}</h3>
                  <p className="muted">{h.subCategory}</p>
                  {!fundamentals && expenseRatio == null ? (
                    <p className="muted">No fundamental data for this scheme yet.</p>
                  ) : (
                    <div className="fund-grid">
                      {[
                        ["Expense ratio", expenseRatio != null ? `${expenseRatio.toFixed(2)}%` : "—"],
                        ["P/E", parseUpvalyMetric(fundamentals?.pe)?.toFixed(1) ?? "—"],
                        ["P/B", parseUpvalyMetric(fundamentals?.pb)?.toFixed(1) ?? "—"],
                        ["YTM", parseUpvalyMetric(fundamentals?.yieldToMaturity)?.toFixed(1) ?? "—"],
                      ].map(([label, val]) => (
                        <div key={label} className="fund-tile">
                          <span className="metric-label">{label}</span>
                          <span className="metric-value">{val}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </>
      ) : null}

      {category === "Others" ? (
        <section className="panel-card">
          <TransactionLedgerSection
            savedParsedDocs={savedParsedDocs}
            holdings={materialHoldings.map((h) => ({
              id: h.id,
              name: h.name,
              value: h.value,
              totalUnits: h.totalUnits ?? 0,
            }))}
          />
        </section>
      ) : null}
      </div>

      {benchmarkPickerOpen ? (
        <div className="modal-backdrop" onClick={() => setBenchmarkPickerOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Change benchmark</h3>
            <div className="bench-list">
              {BENCHMARK_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`bench-option ${benchmarkId === opt.id ? "bench-option-active" : ""}`}
                  onClick={() => {
                    setBenchmarkId(opt.id);
                    setBenchmarkPickerOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

