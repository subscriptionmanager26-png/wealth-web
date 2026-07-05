import { formatInr, formatPct } from "../../../lib/portfolioTools/toolData";
import { useToolData } from "../../../lib/chatBlocks/ToolDataContext";
import type { HoldingsTableBlock } from "../../../lib/chatBlocks/types";

export function HoldingsTableBlockView({ block }: { block: HoldingsTableBlock }) {
  const data = useToolData()?.holdings;
  if (!data?.rows.length) {
    return <div className="chat-wealth-missing">Holdings not loaded.</div>;
  }

  const limit = block.limit ?? data.rows.length;
  const rows = data.rows.slice(0, limit);

  return (
    <div className="chat-wealth-card">
      <div className="chat-wealth-card-head">
        <span className="chat-wealth-card-title">Holdings</span>
        <span className="chat-wealth-card-meta">{rows.length} funds</span>
      </div>
      <div className="chat-block-table-wrap">
        <table className="chat-block-table">
          <thead>
            <tr>
              <th>Fund</th>
              <th>Weight</th>
              <th>Value</th>
              <th>Return</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>
                  <div className="chat-wealth-fund-name">{row.name}</div>
                  <div className="chat-wealth-fund-meta">
                    {row.assetClass} · {row.category}
                  </div>
                </td>
                <td>{row.weightPct.toFixed(1)}%</td>
                <td>{formatInr(row.value)}</td>
                <td>{formatPct(row.returnPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
