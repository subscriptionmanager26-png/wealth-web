import { useMemo } from "react";

import {
  groupSessionsByDate,
  lastMessageActivityIso,
  type ChatSession,
} from "../lib/chatHistory";

type Props = {
  open: boolean;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ChatHistoryDrawer({ open, sessions, activeSessionId, onClose, onSelect }: Props) {
  const grouped = useMemo(() => groupSessionsByDate(sessions), [sessions]);

  if (!open) return null;

  return (
    <div className="chat-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="chat-drawer"
        role="dialog"
        aria-label="Previous chats"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chat-drawer-head">
          <h2>Chats</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="text-muted chat-drawer-note">Saved on this device only.</p>

        {grouped.length === 0 ? (
          <p className="chat-drawer-empty">No previous chats yet.</p>
        ) : (
          <div className="chat-drawer-scroll">
            {grouped.map((group) => (
              <section key={group.label} className="chat-drawer-group">
                <h3 className="chat-drawer-group-label">{group.label}</h3>
                <ul className="chat-drawer-list">
                  {group.sessions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={`chat-drawer-item${s.id === activeSessionId ? " chat-drawer-item-active" : ""}`}
                        onClick={() => onSelect(s.id)}
                      >
                        <span className="chat-drawer-item-title">{s.title}</span>
                        <span className="chat-drawer-item-meta">
                          {s.messages.length} messages · {formatWhen(lastMessageActivityIso(s))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
