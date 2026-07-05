import type { TableBlock } from "../../lib/chatBlocks/types";

export function TableBlockView({ block }: { block: TableBlock }) {
  return (
    <div className="chat-block-table-wrap">
      <table className="chat-block-table">
        <thead>
          <tr>
            {block.columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i}>
              {block.columns.map((_, j) => (
                <td key={j}>{row[j] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
