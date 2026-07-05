import type { CalloutBlock } from "../../lib/chatBlocks/types";

export function CalloutBlockView({ block }: { block: CalloutBlock }) {
  const tone = block.tone ?? "info";
  return <div className={`chat-block-callout chat-block-callout-${tone}`}>{block.text}</div>;
}
