import type { TextBlock } from "../../lib/chatBlocks/types";

export function TextBlockView({ block }: { block: TextBlock }) {
  return <p className="chat-block-text">{block.text}</p>;
}
