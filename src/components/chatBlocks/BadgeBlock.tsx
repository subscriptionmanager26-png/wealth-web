import type { BadgeBlock } from "../../lib/chatBlocks/types";

export function BadgeBlockView({ block }: { block: BadgeBlock }) {
  const variant = block.variant ?? "muted";
  return <span className={`chat-block-badge chat-block-badge-${variant}`}>{block.label}</span>;
}
