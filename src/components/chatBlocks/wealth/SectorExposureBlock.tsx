import { useToolData } from "../../../lib/chatBlocks/ToolDataContext";
import type { SectorExposureBlock } from "../../../lib/chatBlocks/types";

export function SectorExposureBlockView({ block }: { block: SectorExposureBlock }) {
  const data = useToolData()?.sectorExposure;
  if (!data?.rows.length) {
    return <div className="chat-wealth-missing">Sector exposure not loaded.</div>;
  }

  const limit = block.limit ?? data.rows.length;
  const rows = data.rows.slice(0, limit);
  const maxPct = Math.max(...rows.map((r) => r.weightPct), 1);

  return (
    <div className="chat-wealth-card">
      <div className="chat-wealth-card-head">
        <span className="chat-wealth-card-title">Sector exposure</span>
      </div>
      <div className="chat-wealth-sector-list">
        {rows.map((row) => (
          <div key={row.sector} className="chat-wealth-sector-row">
            <div className="chat-wealth-sector-head">
              <span className="chat-wealth-sector-name">{row.sector}</span>
              <span className="chat-wealth-sector-pct">{row.weightPct.toFixed(1)}%</span>
            </div>
            <div className="chat-wealth-sector-track" aria-hidden>
              <span
                className="chat-wealth-sector-fill"
                style={{ width: `${(row.weightPct / maxPct) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
