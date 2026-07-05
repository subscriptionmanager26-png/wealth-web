import { formatPct } from "../../../lib/portfolioTools/toolData";
import { useToolData } from "../../../lib/chatBlocks/ToolDataContext";
import type { BenchmarkComparisonBlock } from "../../../lib/chatBlocks/types";

function toneForPct(n: number | null): string {
  if (n == null) return "neutral";
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "neutral";
}

export function BenchmarkComparisonBlockView({ block }: { block: BenchmarkComparisonBlock }) {
  const store = useToolData()?.benchmarkComparison;
  if (!store?.rows.length) {
    return <div className="chat-wealth-missing">Benchmark comparison not loaded.</div>;
  }

  if (block.benchmarkId && store.benchmarkId !== block.benchmarkId) {
    return <div className="chat-wealth-missing">Benchmark data not available for this index.</div>;
  }

  const rows = block.frame
    ? store.rows.filter((r) => r.frame.toLowerCase() === block.frame!.toLowerCase())
    : store.rows.slice(0, 4);

  if (!rows.length) {
    return <div className="chat-wealth-missing">No comparison data for the selected period.</div>;
  }

  return (
    <div className="chat-wealth-card">
      <div className="chat-wealth-card-head">
        <span className="chat-wealth-card-title">vs {store.benchmarkLabel}</span>
      </div>
      <div className="chat-block-table-wrap">
        <table className="chat-block-table chat-wealth-compare-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>You</th>
              <th>Index</th>
              <th>Alpha</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.frame}>
                <td>{row.frame}</td>
                <td className={`chat-wealth-pct-${toneForPct(row.portfolioPct)}`}>{formatPct(row.portfolioPct)}</td>
                <td className={`chat-wealth-pct-${toneForPct(row.benchmarkPct)}`}>{formatPct(row.benchmarkPct)}</td>
                <td className={`chat-wealth-pct-${toneForPct(row.alphaPct)}`}>
                  {row.alphaPct != null ? formatPct(row.alphaPct) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
