import type { Block } from "../../lib/chatBlocks/types";
import { RenderBlock } from "./RenderBlock";

export function RenderBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="chat-blocks">
      {blocks.map((block, i) => (
        <RenderBlock key={i} block={block} />
      ))}
    </div>
  );
}

// Re-export for layout components
export { RenderBlock };
