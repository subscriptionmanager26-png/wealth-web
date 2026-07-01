import { useState } from "react";

type Props = {
  role: "user" | "assistant";
  content: string;
  onEdit?: () => void;
  onRegenerate?: () => void;
  disabled?: boolean;
};

export function ChatMessageActions({ role, content, onEdit, onRegenerate, disabled }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="chat-message-actions" aria-label="Message actions">
      <button type="button" className="chat-action-btn" onClick={() => void copy()} disabled={disabled || !content.trim()}>
        {copied ? "Copied" : "Copy"}
      </button>
      {role === "user" && onEdit ? (
        <button type="button" className="chat-action-btn" onClick={onEdit} disabled={disabled}>
          Edit
        </button>
      ) : null}
      {role === "assistant" && onRegenerate ? (
        <button type="button" className="chat-action-btn" onClick={onRegenerate} disabled={disabled}>
          Regenerate
        </button>
      ) : null}
    </div>
  );
}
