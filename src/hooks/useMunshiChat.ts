import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  createChatSession,
  loadActiveChatSession,
  loadChatSession,
  loadChatSessions,
  saveChatSession,
  setActiveChatSession,
  type ChatSession,
} from "../lib/chatHistory";
import {
  clearMistralApiKeyPersisted,
  hydrateMistralApiKey,
  loadMistralApiKey,
  saveMistralApiKeyPersisted,
} from "../lib/mistralApiKey";
import { runPortfolioChatAgent, ChatAbortError } from "../lib/portfolioChatAgent";
import { completeRunningSteps } from "../lib/agentSteps";
import type { PortfolioSnapshot } from "../lib/portfolioTools";
import type { ChatMessage } from "../lib/portfolioChat";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function draftSession(): ChatSession {
  const now = new Date().toISOString();
  return { id: "", title: "New chat", messages: [], createdAt: now, updatedAt: now };
}

function initChatState(): { session: ChatSession; messages: ChatMessage[]; isDraft: boolean } {
  const resumed = loadActiveChatSession();
  if (resumed) return { session: resumed, messages: resumed.messages, isDraft: false };
  return { session: draftSession(), messages: [], isDraft: true };
}

export function useMunshiChat() {
  const bootRef = useRef(initChatState());
  const [apiKey, setApiKey] = useState(() => loadMistralApiKey());
  const [session, setSession] = useState<ChatSession>(bootRef.current.session);
  const [messages, setMessages] = useState<ChatMessage[]>(bootRef.current.messages);
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadChatSessions());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const isDraftRef = useRef(bootRef.current.isDraft);
  const sessionRef = useRef(session);
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);

  sessionRef.current = session;
  messagesRef.current = messages;

  const refreshSessions = useCallback(() => {
    setSessions(loadChatSessions());
  }, []);

  const persistToStorage = useCallback(
    (nextMessages: ChatMessage[], baseSession = sessionRef.current) => {
      let active = baseSession;
      if (!active.id || isDraftRef.current) {
        active = createChatSession();
        isDraftRef.current = false;
      }
      const { session: saved, storage } = saveChatSession(active, nextMessages);
      setSession(saved);
      refreshSessions();
      if (!storage.ok) {
        setStorageError("Could not save chat on this device. Free browser storage or disable private mode.");
      }
      return saved;
    },
    [refreshSessions],
  );

  const saveApiKey = useCallback(async (key: string) => {
    const trimmed = key.trim();
    const result = await saveMistralApiKeyPersisted(trimmed);
    if (!result.ok) {
      setStorageError(`Could not save API key: ${result.error}`);
      return false;
    }
    setApiKey(trimmed);
    setStorageError(null);
    if (trimmed) setError(null);
    return true;
  }, []);

  const clearApiKey = useCallback(async () => {
    const result = await clearMistralApiKeyPersisted();
    if (!result.ok) {
      setStorageError(`Could not remove API key: ${result.error}`);
      return false;
    }
    setApiKey("");
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hydrateMistralApiKey().then((key) => {
      if (!cancelled && key) setApiKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const startNewChat = useCallback(() => {
    if (busy) return;
    isDraftRef.current = true;
    setSession(draftSession());
    setMessages([]);
    messagesRef.current = [];
    setInput("");
    setError(null);
    setStreamingId(null);
    refreshSessions();
  }, [busy, refreshSessions]);

  const openSession = useCallback(
    (id: string) => {
      if (busy) return;
      const picked = loadChatSession(id);
      if (!picked) return;
      isDraftRef.current = false;
      setActiveChatSession(id);
      setSession(picked);
      setMessages(picked.messages);
      messagesRef.current = picked.messages;
      setError(null);
      refreshSessions();
    },
    [busy, refreshSessions],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runQuestion = useCallback(
    async (
      question: string,
      history: ChatMessage[],
      snapshot: PortfolioSnapshot,
      onNeedApiKey?: () => void,
    ) => {
      const q = question.trim();
      if (!q || busy) return;
      if (!apiKey.trim()) {
        setError("Add your Mistral API key in Settings to start chatting.");
        onNeedApiKey?.();
        return;
      }
      setError(null);
      setBusy(true);

      const userMsg: ChatMessage = { id: newId(), role: "user", content: q };
      const assistantId = newId();
      const withUser = [...history, userMsg];

      persistToStorage(withUser);

      const assistantPlaceholder: ChatMessage = { id: assistantId, role: "assistant", content: "" };
      const withAssistant = [...withUser, assistantPlaceholder];
      setMessages(withAssistant);
      messagesRef.current = withAssistant;
      setStreamingId(assistantId);
      setInput("");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await runPortfolioChatAgent(
          { question: q, history, apiKey, snapshot, signal: controller.signal },
          {
            onDelta: (delta) => {
              flushSync(() => {
                setMessages((prev) => {
                  const next = prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m));
                  messagesRef.current = next;
                  return next;
                });
              });
            },
            onSteps: async (steps) => {
              await new Promise<void>((resolve) => {
                flushSync(() => {
                  setMessages((prev) => {
                    const next = prev.map((m) => (m.id === assistantId ? { ...m, steps } : m));
                    messagesRef.current = next;
                    return next;
                  });
                });
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
              });
            },
          },
        );
      } catch (e) {
        if (e instanceof ChatAbortError) {
          setMessages((prev) => {
            const next = prev.map((m) =>
              m.id === assistantId && m.steps ? { ...m, steps: completeRunningSteps(m.steps) } : m,
            );
            messagesRef.current = next;
            return next;
          });
        } else {
          setMessages(withUser);
          messagesRef.current = withUser;
          persistToStorage(withUser);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        abortRef.current = null;
        setStreamingId(null);
        setBusy(false);
        persistToStorage(messagesRef.current);
      }
    },
    [apiKey, busy, persistToStorage],
  );

  const send = useCallback(
    async (question: string, snapshot: PortfolioSnapshot, onNeedApiKey?: () => void) => {
      await runQuestion(question, messagesRef.current, snapshot, onNeedApiKey);
    },
    [runQuestion],
  );

  const regenerate = useCallback(
    async (assistantId: string, snapshot: PortfolioSnapshot, onNeedApiKey?: () => void) => {
      if (busy) return;
      const msgs = messagesRef.current;
      const idx = msgs.findIndex((m) => m.id === assistantId);
      if (idx <= 0) return;
      const userMsg = msgs[idx - 1];
      if (!userMsg || userMsg.role !== "user") return;
      const history = msgs.slice(0, idx - 1);
      setMessages(history);
      messagesRef.current = history;
      await runQuestion(userMsg.content, history, snapshot, onNeedApiKey);
    },
    [busy, runQuestion],
  );

  const startEdit = useCallback(
    (userId: string) => {
      if (busy) return;
      const msgs = messagesRef.current;
      const idx = msgs.findIndex((m) => m.id === userId);
      if (idx < 0) return;
      const userMsg = msgs[idx];
      if (userMsg?.role !== "user") return;
      const trimmed = msgs.slice(0, idx);
      setMessages(trimmed);
      messagesRef.current = trimmed;
      setInput(userMsg.content);
      setError(null);
      persistToStorage(trimmed);
    },
    [busy, persistToStorage],
  );

  useEffect(() => {
    const msgs = messagesRef.current;
    if (!msgs.some((m) => m.content.trim())) return;
    const id = window.setTimeout(() => persistToStorage(msgs), 500);
    return () => window.clearTimeout(id);
  }, [messages, persistToStorage]);

  return {
    apiKey,
    saveApiKey,
    clearApiKey,
    session,
    messages,
    sessions,
    input,
    setInput,
    busy,
    streamingId,
    error: error ?? storageError,
    refreshSessions,
    startNewChat,
    openSession,
    send,
    stopGeneration,
    regenerate,
    startEdit,
    persistToStorage,
  };
}

export type MunshiChatController = ReturnType<typeof useMunshiChat>;
