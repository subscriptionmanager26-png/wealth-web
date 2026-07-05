import type { HeadingBlock } from "../../lib/chatBlocks/types";

export function HeadingBlockView({ block }: { block: HeadingBlock }) {
  const Tag = block.level === 3 ? "h4" : "h3";
  return <Tag className="chat-block-heading">{block.text}</Tag>;
}
