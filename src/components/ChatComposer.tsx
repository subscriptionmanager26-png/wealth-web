import { useCallback, useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
};

const MAX_HEIGHT_PX = 160;

export function ChatComposer({ value, onChange, onSubmit, onStop, busy, disabled, placeholder }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy && !disabled && value.trim()) onSubmit();
    }
  }

  const canSend = !busy && !disabled && value.trim().length > 0;

  return (
    <div className={`chat-composer${disabled ? " chat-composer-disabled" : ""}`}>
      <div className="chat-composer-inner">
        <textarea
          ref={textareaRef}
          className="chat-composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || busy}
          rows={1}
          aria-label="Message Munshi Ji"
        />
        <div className="chat-composer-actions">
          {busy ? (
            <button type="button" className="chat-composer-stop" onClick={onStop} aria-label="Stop generating">
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="chat-composer-send"
              onClick={onSubmit}
              disabled={!canSend}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
      <p className="chat-composer-hint">Enter to send · Shift+Enter for new line</p>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 19V5M12 5L6 11M12 5l6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
