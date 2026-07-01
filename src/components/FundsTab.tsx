import { useMemo, useState } from "react";

import {
  formatUpvalyFundReturnPct,
  getUpvalyFundReturn,
  listUpvalyFundReturns,
  type UpvalySchemeDetail,
} from "@mobile/utils/upvalyMfApi";
import { formatCompactInr, formatInrFull, hasMaterialHoldingValue } from "../lib/format";
import type { FundHolding } from "../lib/buildHoldings";

type FundsTabProps = {
  holdings: FundHolding[];
  portfolioTotal: number;
  upvalySchemes: Record<string, UpvalySchemeDetail>;
  insightsLoading: boolean;
};

function fundPlTone(h: FundHolding): "positive" | "negative" | "neutral" {
  return h.returns > 0 ? "positive" : h.returns < 0 ? "negative" : "neutral";
}

function formatFundProfitLoss(h: FundHolding): string {
  const sign = h.returns >= 0 ? "+" : "−";
  return `${sign}${formatCompactInr(Math.abs(h.returns))}`;
}

function formatFundReturn1Y(h: FundHolding, schemes: Record<string, UpvalySchemeDetail>): string {
  const code = h.amfiCode?.trim();
  if (!code) return "—";
  const row = getUpvalyFundReturn(schemes[code], "1y");
  return row ? formatUpvalyFundReturnPct(row.valuePct) : "—";
}

export function FundsTab({ holdings, portfolioTotal, upvalySchemes, insightsLoading }: FundsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...holdings].filter((h) => hasMaterialHoldingValue(h.current)).sort((a, b) => b.current - a.current),
    [holdings],
  );
  const selected = useMemo(
    () => (selectedId ? sorted.find((h) => h.id === selectedId) ?? null : null),
    [selectedId, sorted],
  );

  if (selected) {
    const code = selected.amfiCode?.trim();
    const scheme = code ? upvalySchemes[code] : undefined;
    const fundamentals = scheme?.fundamentals;
    const topHoldings = scheme?.holdings?.slice(0, 15) ?? [];
    const plTone = fundPlTone(selected);
    const returnRows = scheme ? listUpvalyFundReturns(scheme) : [];

    return (
      <div className="tab-panel">
        <button type="button" className="back-card" onClick={() => setSelectedId(null)}>
          <span className="back-card-icon">‹</span>
          <div>
            <strong>Back to funds</strong>
          </div>
        </button>

        <article className="fund-card-lg">
          <h3 className="fund-title">{selected.name}</h3>
          <div className="fund-stats">
            <div>
              <span className="stat-label">Profit / Loss</span>
              <span className={plTone}>{formatFundProfitLoss(selected)}</span>
            </div>
            <div>
              <span className="stat-label">1Y returns</span>
              <span>{insightsLoading ? "…" : formatFundReturn1Y(selected, upvalySchemes)}</span>
            </div>
            <div>
              <span className="stat-label">Weight</span>
              <span>{portfolioTotal > 0 ? `${((selected.amount / portfolioTotal) * 100).toFixed(1)}%` : "—"}</span>
            </div>
          </div>
        </article>

        <section className="panel-card">
          <p className="eyebrow">Returns</p>
          <div className="fund-stat-list">
            <div className="fund-stat-row">
              <span>Current value</span>
              <span>{formatInrFull(selected.current)}</span>
            </div>
            <div className="fund-stat-row">
              <span>Invested</span>
              <span>{formatCompactInr(selected.invested)}</span>
            </div>
            <div className="fund-stat-row">
              <span>Profit / Loss</span>
              <span className={plTone}>{formatFundProfitLoss(selected)}</span>
            </div>
            <div className="fund-stat-row">
              <span>Total return</span>
              <span className={plTone}>
                {selected.returnPct >= 0 ? "+" : ""}
                {selected.returnPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </section>

        {returnRows.length ? (
          <section className="panel-card">
            <p className="eyebrow">Fund returns (source)</p>
            {returnRows.map((row) => (
              <div key={row.timeframe} className="fund-stat-row">
                <span>{row.label}</span>
                <span>{formatUpvalyFundReturnPct(row.valuePct)}</span>
              </div>
            ))}
          </section>
        ) : null}

        <section className="panel-card">
          <p className="eyebrow">Fundamentals</p>
          {!scheme && !insightsLoading ? (
            <p className="muted">No fundamental data for this scheme yet.</p>
          ) : (
            <div className="fund-stat-list">
              <div className="fund-stat-row">
                <span>Expense ratio</span>
                <span>{scheme?.expenseRatio != null ? `${scheme.expenseRatio.toFixed(2)}%` : "—"}</span>
              </div>
              <div className="fund-stat-row">
                <span>P/E</span>
                <span>{fundamentals?.pe ?? "—"}</span>
              </div>
              <div className="fund-stat-row">
                <span>P/B</span>
                <span>{fundamentals?.pb ?? "—"}</span>
              </div>
            </div>
          )}
        </section>

        {topHoldings.length ? (
          <section className="panel-card">
            <p className="eyebrow">Top holdings</p>
            {topHoldings.map((row) => (
              <div key={row.name} className="contrib-row">
                <span>{row.name}</span>
                <span>{row.weightage || "—"}</span>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tab-panel">
      {!sorted.length ? (
        <p className="muted">No holdings yet. Upload a CAS PDF to get started.</p>
      ) : (
        sorted.map((h) => {
          const tone = fundPlTone(h);
          const weightPct = portfolioTotal > 0 ? (h.amount / portfolioTotal) * 100 : 0;
          return (
            <button key={h.id} type="button" className="fund-card-lg fund-card-btn" onClick={() => setSelectedId(h.id)}>
              <div className="fund-header-row">
                <div className="amc-avatar">{h.amc.slice(0, 2).toUpperCase()}</div>
                <div className="fund-main">
                  <h3 className="fund-title">{h.name}</h3>
                  <div className="tag-row">
                    <span className="tag">{h.category}</span>
                    {h.payoutTag ? <span className="tag">{h.payoutTag}</span> : null}
                  </div>
                </div>
                <div className="fund-value-col">
                  <span className="fund-value">{formatCompactInr(h.current)}</span>
                </div>
              </div>
              <div className="fund-stats">
                <div>
                  <span className="stat-label">P/L</span>
                  <span className={tone}>{formatFundProfitLoss(h)}</span>
                </div>
                <div>
                  <span className="stat-label">1Y</span>
                  <span>{insightsLoading ? "…" : formatFundReturn1Y(h, upvalySchemes)}</span>
                </div>
                <div>
                  <span className="stat-label">Weight</span>
                  <span>{weightPct > 0 ? `${weightPct.toFixed(1)}%` : "—"}</span>
                </div>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
