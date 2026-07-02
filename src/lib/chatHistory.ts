import { deviceStorageGet, deviceStorageSet, type StorageWriteResult } from "./deviceStorage";
import type { ChatMessage } from "./portfolioChat";

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

type Store = {
  version: 1;
  activeSessionId: string | null;
  sessions: ChatSession[];
};

const STORAGE_KEY = "wealth_web_munshi_chats_v1";
const MAX_SESSIONS = 40;

function newSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function hasContent(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.content.trim().length > 0);
}

function readStore(): Store {
  try {
    const raw = deviceStorageGet(STORAGE_KEY);
    if (!raw) return { version: 1, activeSessionId: null, sessions: [] };
    const parsed = JSON.parse(raw) as Store;
    if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) {
      return { version: 1, activeSessionId: null, sessions: [] };
    }
    return parsed;
  } catch {
    return { version: 1, activeSessionId: null, sessions: [] };
  }
}

function writeStore(store: Store): StorageWriteResult {
  return deviceStorageSet(STORAGE_KEY, JSON.stringify(store));
}

export function titleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return "New chat";
  const t = firstUser.content.trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

function messageTimestampMs(message: ChatMessage): number | null {
  const head = message.id.split("-")[0] ?? "";
  const t = Number(head);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** Sort key: timestamp of the last message in the thread (falls back to session updatedAt). */
export function lastMessageActivityMs(session: ChatSession): number {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const t = messageTimestampMs(session.messages[i]!);
    if (t) return t;
  }
  const updated = new Date(session.updatedAt).getTime();
  return Number.isFinite(updated) ? updated : 0;
}

export function lastMessageActivityIso(session: ChatSession): string {
  return new Date(lastMessageActivityMs(session)).toISOString();
}

function sortSessionsByLastMessage(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => lastMessageActivityMs(b) - lastMessageActivityMs(a));
}

/** Sessions that have at least one non-empty message (for history UI). */
export function loadChatSessions(): ChatSession[] {
  return sortSessionsByLastMessage(
    readStore().sessions.filter((s) => hasContent(s.messages)),
  );
}

export function loadActiveChatSessionId(): string | null {
  return readStore().activeSessionId;
}

export function loadChatSession(id: string): ChatSession | null {
  return readStore().sessions.find((s) => s.id === id) ?? null;
}

/** Resume the active saved session, if it has messages. */
export function loadActiveChatSession(): ChatSession | null {
  const id = loadActiveChatSessionId();
  if (!id) return null;
  const session = loadChatSession(id);
  if (!session || !hasContent(session.messages)) return null;
  return session;
}

export function createChatSession(): ChatSession {
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: newSessionId(),
    title: "New chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  const store = readStore();
  store.sessions = [session, ...store.sessions.filter((s) => hasContent(s.messages))].slice(0, MAX_SESSIONS);
  store.activeSessionId = session.id;
  writeStore(store);
  return session;
}

export function setActiveChatSession(id: string): void {
  const store = readStore();
  if (!store.sessions.some((s) => s.id === id)) return;
  store.activeSessionId = id;
  writeStore(store);
}

export function saveChatSession(
  session: ChatSession,
  messages: ChatMessage[],
): { session: ChatSession; storage: StorageWriteResult } {
  const trimmed = messages
    .filter((m) => m.role === "user" || m.content.trim().length > 0)
    .map((m) => (m.role === "assistant" ? { ...m, steps: undefined } : m));
  const activityMs = trimmed.length
    ? lastMessageActivityMs({ ...session, messages: trimmed })
    : Date.now();
  const next: ChatSession = {
    ...session,
    messages: trimmed,
    title: titleFromMessages(trimmed),
    updatedAt: new Date(activityMs).toISOString(),
  };

  if (!hasContent(trimmed)) return { session: next, storage: { ok: true } };

  const store = readStore();
  const idx = store.sessions.findIndex((s) => s.id === next.id);
  if (idx >= 0) store.sessions[idx] = next;
  else store.sessions = [next, ...store.sessions];
  store.sessions = sortSessionsByLastMessage(
    store.sessions.filter((s) => hasContent(s.messages)),
  ).slice(0, MAX_SESSIONS);
  store.activeSessionId = next.id;
  const storage = writeStore(store);
  return { session: next, storage };
}

export function deleteChatSession(id: string): string | null {
  const store = readStore();
  store.sessions = store.sessions.filter((s) => s.id !== id);
  if (store.activeSessionId === id) {
    store.activeSessionId = store.sessions.find((s) => hasContent(s.messages))?.id ?? null;
  }
  writeStore(store);
  return store.activeSessionId;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function sessionDateGroupLabel(session: ChatSession, now = Date.now()): string {
  const activity = lastMessageActivityMs(session);
  const today = startOfDay(now);
  const activityDay = startOfDay(activity);
  const diffDays = Math.floor((today - activityDay) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 days";
  if (diffDays < 30) return "Previous 30 days";
  return "Older";
}

export function groupSessionsByDate(sessions: ChatSession[]): { label: string; sessions: ChatSession[] }[] {
  const groups = new Map<string, ChatSession[]>();
  const order = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

  for (const session of sessions) {
    const label = sessionDateGroupLabel(session);
    const list = groups.get(label) ?? [];
    list.push(session);
    groups.set(label, list);
  }

  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, sessions: groups.get(label)! }));
}
