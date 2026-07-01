import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

type Props = {
  content: string;
  streaming?: boolean;
};

export function ChatMessageContent({ content, streaming }: Props) {
  if (!content && !streaming) return null;

  return (
    <div className={`portfolio-chat-markdown${streaming ? " portfolio-chat-markdown-streaming" : ""}`}>
      {content ? (
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {content}
        </ReactMarkdown>
      ) : null}
      {streaming ? <span className="portfolio-chat-cursor" aria-hidden /> : null}
    </div>
  );
}
