import { formatInr, formatPct, type FundCardData } from "../../../lib/portfolioTools/toolData";
import { useToolData } from "../../../lib/chatBlocks/ToolDataContext";
import type { FundCardBlock } from "../../../lib/chatBlocks/types";

function pickFund(block: FundCardBlock, funds: FundCardData[] | undefined): FundCardData | null {
  if (!funds?.length) return null;
  if (block.rank != null && block.rank >= 1) {
    return funds[block.rank - 1] ?? funds[0];
  }
  if (block.query?.trim()) {
    const q = block.query.trim().toLowerCase();
    return funds.find((f) => f.name.toLowerCase().includes(q)) ?? funds[0];
  }
  return funds[funds.length - 1];
}

export function FundCardBlockView({ block }: { block: FundCardBlock }) {
  const funds = useToolData()?.fundDetails;
  const data = pickFund(block, funds);
  if (!data) {
    return <div className="chat-wealth-missing">Fund details not loaded.</div>;
  }

  const tone = (data.returnPct ?? 0) >= 0 ? "up" : "down";

  return (
    <div className="chat-wealth-card chat-wealth-fund-card">
      <div className="chat-wealth-card-head">
        <span className="chat-wealth-card-title">{data.name}</span>
        <span className={`chat-wealth-fund-return chat-wealth-pct-${tone}`}>{formatPct(data.returnPct)}</span>
      </div>
      {data.category ? <div className="chat-wealth-fund-meta">{data.category}</div> : null}
      <div className="chat-wealth-summary-grid">
        <div className="chat-wealth-mini-stat">
          <span className="chat-wealth-mini-label">Weight</span>
          <span className="chat-wealth-mini-value">{data.weightPct.toFixed(1)}%</span>
        </div>
        <div className="chat-wealth-mini-stat">
          <span className="chat-wealth-mini-label">Value</span>
          <span className="chat-wealth-mini-value">{formatInr(data.value)}</span>
        </div>
        {data.ter != null ? (
          <div className="chat-wealth-mini-stat">
            <span className="chat-wealth-mini-label">TER</span>
            <span className="chat-wealth-mini-value">{data.ter.toFixed(2)}%</span>
          </div>
        ) : null}
        {data.return1y != null ? (
          <div className="chat-wealth-mini-stat">
            <span className="chat-wealth-mini-label">Scheme 1Y</span>
            <span className="chat-wealth-mini-value">{formatPct(data.return1y)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
