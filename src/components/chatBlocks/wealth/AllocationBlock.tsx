import { formatInr } from "../../../lib/portfolioTools/toolData";
import { useToolData } from "../../../lib/chatBlocks/ToolDataContext";
import type { AllocationBlock } from "../../../lib/chatBlocks/types";

const SLICE_COLORS = ["#0d9488", "#3b82f6", "#f59e0b", "#8b5cf6", "#64748b"];

export function AllocationBlockView({ block: _block }: { block: AllocationBlock }) {
  const data = useToolData()?.allocation;
  if (!data?.slices.length) {
    return <div className="chat-wealth-missing">Asset allocation not loaded.</div>;
  }

  return (
    <div className="chat-wealth-card">
      <div className="chat-wealth-card-head">
        <span className="chat-wealth-card-title">Allocation</span>
      </div>
      <div className="chat-wealth-allocation-bar" aria-hidden>
        {data.slices.map((slice, i) => (
          <span
            key={slice.type}
            className="chat-wealth-allocation-segment"
            style={{
              width: `${Math.max(slice.weightPct, 0)}%`,
              background: SLICE_COLORS[i % SLICE_COLORS.length],
            }}
          />
        ))}
      </div>
      <div className="chat-wealth-allocation-legend">
        {data.slices.map((slice, i) => (
          <div key={slice.type} className="chat-wealth-allocation-row">
            <span
              className="chat-wealth-allocation-dot"
              style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
            />
            <span className="chat-wealth-allocation-label">{slice.type}</span>
            <span className="chat-wealth-allocation-pct">{slice.weightPct.toFixed(1)}%</span>
            <span className="chat-wealth-allocation-value">{formatInr(slice.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
