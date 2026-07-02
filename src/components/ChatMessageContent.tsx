import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";

import { normalizeChatMarkdown } from "../lib/normalizeChatMarkdown";

type Props = {
  content: string;
  streaming?: boolean;
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

export function ChatMessageContent({ content, streaming }: Props) {
  const markdown = useMemo(() => normalizeChatMarkdown(content), [content]);

  if (!markdown && !streaming) return null;

  return (
    <div className={`portfolio-chat-markdown${streaming ? " portfolio-chat-markdown-streaming" : ""}`}>
      {markdown ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {markdown}
        </ReactMarkdown>
      ) : null}
      {streaming ? <span className="portfolio-chat-cursor" aria-hidden /> : null}
    </div>
  );
}
