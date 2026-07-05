import { formatInr, formatPct } from "../../../lib/portfolioTools/toolData";
import { useToolData } from "../../../lib/chatBlocks/ToolDataContext";
import type { PortfolioSummaryBlock } from "../../../lib/chatBlocks/types";

export function PortfolioSummaryBlockView({ block: _block }: { block: PortfolioSummaryBlock }) {
  const data = useToolData()?.portfolioSummary;
  if (!data) {
    return <div className="chat-wealth-missing">Portfolio summary not loaded.</div>;
  }

  const gainTone = data.gain >= 0 ? "up" : "down";

  return (
    <div className="chat-wealth-card chat-wealth-summary">
      <div className="chat-wealth-card-head">
        <span className="chat-wealth-card-title">Portfolio</span>
        <span className="chat-wealth-card-meta">{data.view}</span>
      </div>
      <div className="chat-wealth-summary-value">{formatInr(data.total)}</div>
      <div className="chat-wealth-summary-grid">
        <div className="chat-wealth-mini-stat">
          <span className="chat-wealth-mini-label">Invested</span>
          <span className="chat-wealth-mini-value">{formatInr(data.invested)}</span>
        </div>
        <div className={`chat-wealth-mini-stat chat-wealth-mini-stat-${gainTone}`}>
          <span className="chat-wealth-mini-label">Gain</span>
          <span className="chat-wealth-mini-value">
            {formatInr(data.gain)} ({formatPct(data.gainPct)})
          </span>
        </div>
        <div className="chat-wealth-mini-stat">
          <span className="chat-wealth-mini-label">XIRR</span>
          <span className="chat-wealth-mini-value">{data.xirr}</span>
        </div>
        {data.dayChange != null && Number.isFinite(data.dayChange) ? (
          <div
            className={`chat-wealth-mini-stat chat-wealth-mini-stat-${(data.dayChange ?? 0) >= 0 ? "up" : "down"}`}
          >
            <span className="chat-wealth-mini-label">Today</span>
            <span className="chat-wealth-mini-value">
              {formatInr(data.dayChange)} ({formatPct(data.dayChangePct)})
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
