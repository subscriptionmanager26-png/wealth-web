import { useEffect, useMemo, useState } from "react";

import {
  getUpvalyFundReturn,
  listUpvalyFundReturns,
  parseUpvalyMetric,
} from "@mobile/utils/upvalyMfApi";
import {
  filterEquityDirectGrowth,
  loadAmfiActiveSchemes,
  uniqueSorted,
  type ActiveSchemeRow,
} from "../lib/amfiActiveSchemes";
import {
  buildMetricsIndex,
  formatSnapshotDate,
  loadScreenerSnapshot,
  type ScreenerSchemeMetrics,
} from "../lib/screenerSnapshot";
import { standardizeAmcName } from "../lib/amcNames";
import { simplifySchemeName } from "@mobile/utils/schemeNames";
import { ScreenerCategoryTabs } from "./ScreenerCategoryTabs";
import {
  ALL_SCREENER_COLUMNS,
  SCREENER_TABLE_GROUPS,
  screenerColumnKey,
  sortDescDefault,
  type ScreenerTableColumn,
  type SortKey,
} from "./screenerTypes";

function shortCategoryLabel(label: string): string {
  return label.replace(/ Fund$/, "").replace(/^Equity Scheme - /, "");
}

function formatAum(cr: number | null | undefined): string {
  if (cr == null || !Number.isFinite(cr)) return "—";
  if (cr >= 1000) return `₹${(cr / 1000).toFixed(1)}k Cr`;
  return `₹${cr.toFixed(1)} Cr`;
}

function formatTer(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

function formatRatio(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function formatMetric(n: number | null | undefined, digits = 1): string {
  return formatRatio(n, digits);
}

function formatVolatility(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

function formatReturnPct(valuePct: number | null | undefined): string {
  if (valuePct == null || !Number.isFinite(valuePct)) return "—";
  const sign = valuePct >= 0 ? "+" : "−";
  return `${sign}${Math.abs(valuePct).toFixed(1)}%`;
}

function formatCategoryRank(rank: number | null | undefined): string {
  if (rank == null || !Number.isFinite(rank)) return "—";
  return String(Math.round(rank));
}

function returnTone(valuePct: number | null | undefined): string {
  if (valuePct == null || !Number.isFinite(valuePct)) return "neutral";
  if (valuePct > 0) return "positive";
  if (valuePct < 0) return "negative";
  return "neutral";
}

function cellNumeric(col: ScreenerTableColumn, scheme: ScreenerSchemeMetrics | undefined): number | null {
  if (col.kind === "fundamental") {
    switch (col.id) {
      case "aum":
        return scheme?.aumCr ?? null;
      case "ter":
        return scheme?.expenseRatio ?? null;
      case "pe":
        return parseUpvalyMetric(scheme?.fundamentals?.pe);
      case "categoryRank":
        return scheme?.categoryRank3y ?? null;
      default:
        return null;
    }
  }
  if (col.kind === "risk") {
    switch (col.id) {
      case "volatility":
        return scheme?.volatility3y ?? null;
      case "sharpe":
        return scheme?.sharpe3y ?? null;
      case "sortino":
        return scheme?.sortino3y ?? null;
      default:
        return null;
    }
  }
  if (col.kind === "rolling") {
    return scheme?.rollingByPeriod[col.period]?.average ?? null;
  }
  if (col.period === "3y" || col.period === "5y") {
    return scheme?.cagrByPeriod?.[col.period] ?? null;
  }
  return getUpvalyFundReturn(scheme, col.period)?.valuePct ?? null;
}

function formatDisplayCell(col: ScreenerTableColumn, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (col.kind === "fundamental") {
    if (col.id === "aum") return formatAum(value);
    if (col.id === "ter") return formatTer(value);
    if (col.id === "categoryRank") return formatCategoryRank(value);
    return formatRatio(value, 1);
  }
  if (col.kind === "risk") {
    if (col.id === "volatility") return formatVolatility(value);
    return formatRatio(value, 1);
  }
  return formatReturnPct(value);
}

function sortValue(
  row: ActiveSchemeRow,
  key: SortKey,
  metrics: Record<string, ScreenerSchemeMetrics>,
): string | number {
  const m = metrics[row.amfiCode];
  switch (key) {
    case "name":
      return standardizeAmcName(row.amc).toLowerCase();
    case "roll_1y":
      return m?.rollingByPeriod["1y"]?.average ?? Number.NEGATIVE_INFINITY;
    case "roll_3y":
      return m?.rollingByPeriod["3y"]?.average ?? Number.NEGATIVE_INFINITY;
    case "roll_5y":
      return m?.rollingByPeriod["5y"]?.average ?? Number.NEGATIVE_INFINITY;
    case "cagr_1y":
      return getUpvalyFundReturn(m, "1y")?.valuePct ?? Number.NEGATIVE_INFINITY;
    case "cagr_3y":
      return m?.cagrByPeriod?.["3y"] ?? Number.NEGATIVE_INFINITY;
    case "cagr_5y":
      return m?.cagrByPeriod?.["5y"] ?? Number.NEGATIVE_INFINITY;
    case "volatility_3y":
      return m?.volatility3y ?? Number.NEGATIVE_INFINITY;
    case "sharpe_3y":
      return m?.sharpe3y ?? Number.NEGATIVE_INFINITY;
    case "sortino_3y":
      return m?.sortino3y ?? Number.NEGATIVE_INFINITY;
    case "cat_rank_3y":
      return m?.categoryRank3y ?? Number.POSITIVE_INFINITY;
    case "aum":
      return m?.aumCr ?? Number.NEGATIVE_INFINITY;
    case "ter":
      return m?.expenseRatio != null ? -m.expenseRatio : Number.NEGATIVE_INFINITY;
    case "pe":
      return parseUpvalyMetric(m?.fundamentals?.pe) ?? Number.NEGATIVE_INFINITY;
    default:
      return row.name;
  }
}

export function ScreenerTab() {
  const [allRows, setAllRows] = useState<ActiveSchemeRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("cagr_1y");
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, ScreenerSchemeMetrics>>({});
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void loadAmfiActiveSchemes()
      .then((rows) => {
        if (!cancelled) setAllRows(filterEquityDirectGrowth(rows));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load fund list");
      })
      .finally(() => {
        if (!cancelled) setCsvLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadScreenerSnapshot()
      .then((snapshot) => {
        if (!cancelled) {
          setMetrics(buildMetricsIndex(snapshot));
          setSnapshotDate(snapshot.generatedAt);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError((prev) =>
            prev ?? (err instanceof Error ? err.message : "Failed to load screener data"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const subCategories = useMemo(() => uniqueSorted(allRows.map((r) => r.subCategory)), [allRows]);

  const subCategoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of allRows) {
      counts.set(r.subCategory, (counts.get(r.subCategory) ?? 0) + 1);
    }
    return subCategories.map((id) => ({
      id,
      label: id,
      count: counts.get(id) ?? 0,
    }));
  }, [allRows, subCategories]);

  useEffect(() => {
    if (!subCategoryOptions.length) return;
    setActiveCategory((prev) => {
      if (prev && subCategoryOptions.some((o) => o.id === prev)) return prev;
      const largeCap = subCategoryOptions.find((o) => /large cap/i.test(o.label));
      return largeCap?.id ?? subCategoryOptions[0]!.id;
    });
  }, [subCategoryOptions]);

  const filtered = useMemo(() => {
    return allRows.filter((r) => {
      if (activeCategory && r.subCategory !== activeCategory) return false;
      return true;
    });
  }, [allRows, activeCategory]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey, metrics);
      const bv = sortValue(b, sortKey, metrics);
      let cmp: number;
      if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv);
        cmp = sortDesc ? -cmp : cmp;
      } else {
        const na = av as number;
        const nb = bv as number;
        cmp = sortDesc ? nb - na : na - nb;
      }
      if (cmp !== 0) return cmp;
      return a.amfiCode.localeCompare(b.amfiCode);
    });
    return copy;
  }, [filtered, sortKey, sortDesc, metrics]);

  const tableRows = sorted;

  const selected = useMemo(
    () => (selectedCode ? allRows.find((r) => r.amfiCode === selectedCode) ?? null : null),
    [selectedCode, allRows],
  );

  const dataLoading = csvLoading || snapshotLoading;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(sortDescDefault(key));
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDesc ? " ↓" : " ↑") : "");

  if (selected) {
    const scheme = metrics[selected.amfiCode];
    const returnRows = scheme ? listUpvalyFundReturns(scheme) : [];
    const risk3y = scheme?.riskStdDevByTimeframe?.["3y"];

    return (
      <div className="tab-panel screener-root">
        <button type="button" className="back-card" onClick={() => setSelectedCode(null)}>
          <span className="back-card-icon">‹</span>
          <div>
            <strong>Back to screener</strong>
          </div>
        </button>

        <article className="fund-card-lg">
          <div className="tag-row">
            <span className="tag">{selected.subCategory}</span>
            <span className="tag">Direct · Growth</span>
          </div>
          <h3 className="fund-title">{simplifySchemeName(selected.name, selected.amfiCode)}</h3>
          <p className="muted caption">{standardizeAmcName(selected.amc)}</p>
          <div className="screener-detail-grid">
            <div>
              <span className="stat-label">AUM</span>
              <span className="metric-value">{formatAum(scheme?.aumCr)}</span>
            </div>
            <div>
              <span className="stat-label">Expense ratio</span>
              <span className="metric-value">{formatTer(scheme?.expenseRatio)}</span>
            </div>
            <div>
              <span className="stat-label">1Y return</span>
              <span className={returnTone(getUpvalyFundReturn(scheme, "1y")?.valuePct)}>
                {getUpvalyFundReturn(scheme, "1y")
                  ? formatReturnPct(getUpvalyFundReturn(scheme, "1y")!.valuePct)
                  : "—"}
              </span>
            </div>
            <div>
              <span className="stat-label">3Y CAGR</span>
              <span className={returnTone(scheme?.cagrByPeriod?.["3y"])}>
                {scheme?.cagrByPeriod?.["3y"] != null
                  ? formatReturnPct(scheme.cagrByPeriod["3y"]!)
                  : "—"}
              </span>
            </div>
          </div>
        </article>

        <section className="panel-card">
          <p className="eyebrow">Returns</p>
          <div className="fund-stat-list">
            {returnRows.length ? (
              returnRows.map((row) => (
                <div key={row.timeframe} className="fund-stat-row">
                  <span>{row.label}</span>
                  <span className={returnTone(row.valuePct)}>{formatReturnPct(row.valuePct)}</span>
                </div>
              ))
            ) : (
              <p className="muted">{snapshotLoading ? "Loading returns…" : "No return data"}</p>
            )}
          </div>
        </section>

        <section className="panel-card">
          <p className="eyebrow">Fundamentals</p>
          <div className="fund-grid">
            {[
              ["P/E", formatMetric(parseUpvalyMetric(scheme?.fundamentals?.pe), 1)],
              ["P/B", formatMetric(parseUpvalyMetric(scheme?.fundamentals?.pb), 1)],
              ["P/S", formatMetric(parseUpvalyMetric(scheme?.fundamentals?.priceToSale), 1)],
              ["Inception", scheme?.inceptionDate ?? "—"],
            ].map(([label, val]) => (
              <div key={label} className="fund-tile">
                <span className="metric-label">{label}</span>
                <span className="metric-value">{val}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-card">
          <p className="eyebrow">Risk (3Y std dev)</p>
          <div className="fund-stat-list">
            <div className="fund-stat-row">
              <span>Fund</span>
              <span>{formatMetric(risk3y?.value, 1)}%</span>
            </div>
            <div className="fund-stat-row">
              <span>Category avg</span>
              <span>{formatMetric(risk3y?.categoryAverage, 1)}%</span>
            </div>
          </div>
        </section>

        {scheme?.holdings?.length ? (
          <section className="panel-card">
            <p className="eyebrow">Top holdings</p>
            {scheme.holdings.slice(0, 10).map((h) => (
              <div key={h.name} className="contrib-row">
                <div>
                  <strong>{h.name}</strong>
                  <p className="muted caption">{h.sector ?? "—"}</p>
                </div>
                <span>{h.weightage}</span>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tab-panel screener-root">
      {loadError ? (
        <section className="panel-card">
          <p className="negative">{loadError}</p>
        </section>
      ) : null}

      {subCategoryOptions.length ? (
        <ScreenerCategoryTabs
          options={subCategoryOptions}
          activeId={activeCategory}
          onChange={setActiveCategory}
        />
      ) : null}

      <section className="screener-table-wrap panel-card">
        <div className="screener-table-meta">
          <span className="screener-table-count">{sorted.length} Funds</span>
          {activeCategory ? (
            <span className="screener-table-category">{shortCategoryLabel(activeCategory)}</span>
          ) : null}
          {snapshotDate ? (
            <span className="screener-table-date muted caption">
              Data as of {formatSnapshotDate(snapshotDate)}
            </span>
          ) : null}
        </div>

        <div className="screener-table-scroll">
          <table className="screener-table screener-table-unified">
            <thead>
              <tr>
                <th rowSpan={2} className="screener-sticky-col screener-th-fund">
                  <button type="button" className="screener-th-btn" onClick={() => toggleSort("name")}>
                    AMC{sortIndicator("name")}
                  </button>
                </th>
                {SCREENER_TABLE_GROUPS.map((group) => (
                  <th
                    key={group.label}
                    colSpan={group.columns.length}
                    className="screener-th-group"
                  >
                    {group.label}
                  </th>
                ))}
              </tr>
              <tr>
                {SCREENER_TABLE_GROUPS.flatMap((group) =>
                  group.columns.map((col) => (
                    <th key={screenerColumnKey(col)} className="screener-th-sub">
                      <button
                        type="button"
                        className="screener-th-btn"
                        onClick={() => toggleSort(col.sortKey)}
                      >
                        {col.label}
                        {sortIndicator(col.sortKey)}
                      </button>
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => {
                const scheme = metrics[row.amfiCode];
                const amcLabel = standardizeAmcName(row.amc);
                return (
                  <tr key={row.amfiCode} className="screener-row">
                    <td className="screener-fund-cell screener-sticky-col">
                      <button
                        type="button"
                        className="screener-amc-btn"
                        onClick={() => setSelectedCode(row.amfiCode)}
                      >
                        {amcLabel}
                      </button>
                    </td>
                    {ALL_SCREENER_COLUMNS.map((col) => {
                      const value = cellNumeric(col, scheme);
                      const tone =
                        col.kind === "rolling" || col.kind === "cagr" ? returnTone(value) : "";
                      const key = screenerColumnKey(col);
                      return (
                        <td key={key} className={tone}>
                          {dataLoading && value == null ? "…" : formatDisplayCell(col, value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
