import { formatPct } from "../../../lib/portfolioTools/toolData";
import { useToolData } from "../../../lib/chatBlocks/ToolDataContext";
import type { PeriodReturnsBlock } from "../../../lib/chatBlocks/types";

function toneForPct(n: number | null): string {
  if (n == null) return "neutral";
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "neutral";
}

export function PeriodReturnsBlockView({ block }: { block: PeriodReturnsBlock }) {
  const data = useToolData()?.periodReturns;
  if (!data?.rows.length) {
    return <div className="chat-wealth-missing">Period returns not loaded.</div>;
  }

  const frameSet = block.frames?.length ? new Set(block.frames) : null;
  const rows = frameSet ? data.rows.filter((r) => frameSet.has(r.frame)) : data.rows;

  return (
    <div className="chat-wealth-card">
      <div className="chat-wealth-card-head">
        <span className="chat-wealth-card-title">Returns</span>
      </div>
      <div className="chat-wealth-chips">
        {rows.map((row) => (
          <div key={row.frame} className={`chat-wealth-chip chat-wealth-chip-${toneForPct(row.returnPct)}`}>
            <span className="chat-wealth-chip-label">{row.frame}</span>
            <span className="chat-wealth-chip-value">{formatPct(row.returnPct)}</span>
          </div>
        ))}
      </div>
      {data.calendarYears?.length ? (
        <div className="chat-wealth-subsection">
          <span className="chat-wealth-subtitle">Calendar years</span>
          <div className="chat-wealth-chips">
            {data.calendarYears.map((y) => (
              <div key={y.year} className={`chat-wealth-chip chat-wealth-chip-${toneForPct(y.returnPct)}`}>
                <span className="chat-wealth-chip-label">{y.year}</span>
                <span className="chat-wealth-chip-value">{formatPct(y.returnPct)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
