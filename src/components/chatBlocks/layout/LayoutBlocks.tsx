import type { ColumnBlock, GridBlock, RowBlock } from "../../../lib/chatBlocks/types";
import { RenderBlock } from "../RenderBlock";

export function RowBlockView({ block }: { block: RowBlock }) {
  const gap = block.gap ?? "md";
  return (
    <div className={`chat-layout-row chat-layout-gap-${gap}`}>
      {block.children.map((child, i) => (
        <div key={i} className="chat-layout-row-item">
          <RenderBlock block={child} />
        </div>
      ))}
    </div>
  );
}

export function ColumnBlockView({ block }: { block: ColumnBlock }) {
  return (
    <div className="chat-layout-column">
      {block.children.map((child, i) => (
        <RenderBlock key={i} block={child} />
      ))}
    </div>
  );
}

export function GridBlockView({ block }: { block: GridBlock }) {
  const cols = block.columns ?? 2;
  return (
    <div className={`chat-layout-grid chat-layout-grid-${cols}`}>
      {block.children.map((child, i) => (
        <div key={i} className="chat-layout-grid-item">
          <RenderBlock block={child} />
        </div>
      ))}
    </div>
  );
}
