import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";

import { RenderBlocks } from "./chatBlocks/RenderBlocks";
import { blocksToPlainText } from "../lib/chatBlocks/parse";
import { ToolDataProvider } from "../lib/chatBlocks/ToolDataContext";
import type { Block } from "../lib/chatBlocks/types";
import type { ToolDataStore } from "../lib/portfolioTools/toolData";
import { normalizeChatMarkdown } from "../lib/normalizeChatMarkdown";

type Props = {
  content: string;
  blocks?: Block[];
  toolData?: ToolDataStore;
  streaming?: boolean;
  /** When false (default), always render classic markdown even if blocks exist in history. */
  generativeUi?: boolean;
};

function CodeBlock({ children, className }: { children?: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  const language = className?.replace("language-", "") ?? "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="chat-code-block">
      <div className="chat-code-head">
        <span className="chat-code-lang">{language || "code"}</span>
        <button type="button" className="chat-code-copy" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const inline = !className;
    if (inline) {
      return (
        <code className="chat-inline-code" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  pre({ children }) {
    return <>{children}</>;
  },
};

export function ChatMessageContent({ content, blocks, toolData, streaming, generativeUi = false }: Props) {
  const hasBlocks = Boolean(blocks?.length);
  const markdownSource = useMemo(() => {
    if (generativeUi && hasBlocks) return "";
    if (!generativeUi && hasBlocks && blocks?.length) {
      const plain = blocksToPlainText(blocks);
      if (plain.trim()) return plain;
    }
    return content;
  }, [blocks, content, generativeUi, hasBlocks]);
  const markdown = useMemo(() => normalizeChatMarkdown(markdownSource), [markdownSource]);
  const showBlocks = generativeUi && hasBlocks;

  if (!showBlocks && !markdown && !streaming) return null;

  const body = showBlocks ? (
    <ToolDataProvider value={toolData}>
      <RenderBlocks blocks={blocks!} />
    </ToolDataProvider>
  ) : markdown ? (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {markdown}
    </ReactMarkdown>
  ) : null;

  return (
    <div
      className={`portfolio-chat-markdown${streaming ? " portfolio-chat-markdown-streaming" : ""}${showBlocks ? " portfolio-chat-has-blocks" : ""}`}
    >
      {body}
      {streaming ? <span className="portfolio-chat-cursor" aria-hidden /> : null}
    </div>
  );
}
