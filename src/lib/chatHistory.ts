import type { ChatMessage } from "./portfolioChat";
import {
  dbDeleteSession,
  dbLoadActiveSessionId,
  dbLoadAllSessions,
  dbLoadSession,
  dbSaveSession,
  dbSetActiveSessionId,
  ensureChatHistoryMigrated,
  type ChatSessionRecord,
  type ChatStorageResult,
} from "./chatHistoryDb";

export type ChatSession = ChatSessionRecord;

export type StorageWriteResult = ChatStorageResult;

function hasContent(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.content.trim().length > 0);
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

function newSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function loadChatSessions(): Promise<ChatSession[]> {
  await ensureChatHistoryMigrated();
  const rows = await dbLoadAllSessions();
  return sortSessionsByLastMessage(rows.filter((s) => hasContent(s.messages)));
}

export async function loadActiveChatSessionId(): Promise<string | null> {
  return dbLoadActiveSessionId();
}

export async function loadChatSession(id: string): Promise<ChatSession | null> {
  return dbLoadSession(id);
}

export async function loadActiveChatSession(): Promise<ChatSession | null> {
  const id = await loadActiveChatSessionId();
  if (!id) return null;
  const session = await loadChatSession(id);
  if (!session || !hasContent(session.messages)) return null;
  return session;
}

export async function createChatSession(): Promise<ChatSession> {
  await ensureChatHistoryMigrated();
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: newSessionId(),
    title: "New chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
    memoryProcessedAt: null,
  };
  await dbSaveSession(session);
  return session;
}

export async function setActiveChatSession(id: string): Promise<void> {
  await dbSetActiveSessionId(id);
}

export async function saveChatSession(
  session: ChatSession,
  messages: ChatMessage[],
): Promise<{ session: ChatSession; storage: StorageWriteResult }> {
  const trimmed = messages.filter((m) => m.role === "user" || m.content.trim().length > 0);
  const activityMs = trimmed.length ? lastMessageActivityMs({ ...session, messages: trimmed }) : Date.now();
  const next: ChatSession = {
    ...session,
    messages: trimmed,
    title: titleFromMessages(trimmed),
    updatedAt: new Date(activityMs).toISOString(),
  };

  if (!hasContent(trimmed)) return { session: next, storage: { ok: true } };

  const storage = await dbSaveSession(next);
  return { session: next, storage };
}

export async function deleteChatSession(id: string): Promise<string | null> {
  return dbDeleteSession(id);
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

export function sessionDayKey(session: ChatSession): string {
  const d = new Date(lastMessageActivityMs(session));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatConversationForExtraction(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
    .join("\n\n");
}
