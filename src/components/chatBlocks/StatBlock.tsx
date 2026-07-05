import type { StatBlock } from "../../lib/chatBlocks/types";

export function StatBlockView({ block }: { block: StatBlock }) {
  const tone = block.tone ?? "neutral";
  return (
    <div className={`chat-block-stat chat-block-stat-${tone}`}>
      <span className="chat-block-stat-label">{block.label}</span>
      <span className="chat-block-stat-value">{block.value}</span>
      {block.delta ? <span className="chat-block-stat-delta">{block.delta}</span> : null}
    </div>
  );
}
