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
import { ensureChatHistoryMigrated } from "../lib/chatHistoryDb";
import {
  clearMistralApiKeyPersisted,
  hydrateMistralApiKey,
  loadMistralApiKey,
  saveMistralApiKeyPersisted,
} from "../lib/mistralApiKey";
import { buildMemoryContextForQuestion } from "../lib/munshiMemoryRetrieval";
import {
  refreshMemoryStatus,
  runMemoryPipelineNow,
  tryAutomaticMemoryExtract,
  subscribeMemoryJobProgress,
  type MemoryJobProgress,
} from "../lib/munshiMemoryScheduler";
import { MEMORY_AUTO_START_DELAY_MS } from "../lib/munshiMemoryTypes";
import { diagLog } from "../lib/diagnosticsLog";
import { runPortfolioChatAgent, ChatAbortError } from "../lib/portfolioChatAgent";
import { completeRunningSteps } from "../lib/agentSteps";
import type { PortfolioSnapshot } from "../lib/portfolioTools";
import type { ChatMessage } from "../lib/portfolioChat";
import type { ClarificationAnswers, ClarificationRequest } from "../lib/agentPlanning";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function draftSession(): ChatSession {
  const now = new Date().toISOString();
  return { id: "", title: "New chat", messages: [], createdAt: now, updatedAt: now, memoryProcessedAt: null };
}

export function useMunshiChat() {
  const [booted, setBooted] = useState(false);
  const [apiKey, setApiKey] = useState(() => loadMistralApiKey());
  const [session, setSession] = useState<ChatSession>(draftSession());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [memoryJob, setMemoryJob] = useState<MemoryJobProgress>({
    phase: "idle",
    processedSessions: 0,
    totalSessions: 0,
    pendingSessions: 0,
    lastExtractAt: null,
    lastAutomaticExtractDay: null,
    statusMessage: "",
  });

  const isDraftRef = useRef(true);
  const sessionRef = useRef(session);
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);
  const apiKeyRef = useRef(apiKey);
  const autoExtractScheduledRef = useRef(false);
  const approvalResolverRef = useRef<((args: ClarificationAnswers | null) => void) | null>(null);

  const [clarificationRequest, setClarificationRequest] = useState<ClarificationRequest | null>(null);

  sessionRef.current = session;
  messagesRef.current = messages;
  apiKeyRef.current = apiKey;

  const refreshSessions = useCallback(async () => {
    setSessions(await loadChatSessions());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureChatHistoryMigrated();
      const resumed = await loadActiveChatSession();
      if (cancelled) return;
      if (resumed) {
        isDraftRef.current = false;
        setSession(resumed);
        setMessages(resumed.messages);
        messagesRef.current = resumed.messages;
      }
      setSessions(await loadChatSessions());
      setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeMemoryJobProgress(setMemoryJob);
    return unsub;
  }, []);

  useEffect(() => {
    if (!booted || !apiKey.trim() || autoExtractScheduledRef.current) return;
    autoExtractScheduledRef.current = true;
    const timer = window.setTimeout(() => {
      void tryAutomaticMemoryExtract(apiKey).catch(() => {
        /* status panel shows errors */
      });
    }, MEMORY_AUTO_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [booted, apiKey]);

  const persistToStorage = useCallback(
    async (nextMessages: ChatMessage[], baseSession = sessionRef.current) => {
      let active = baseSession;
      if (!active.id || isDraftRef.current) {
        active = await createChatSession();
        isDraftRef.current = false;
      }
      const { session: saved, storage } = await saveChatSession(active, nextMessages);
      setSession(saved);
      await refreshSessions();
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
    void refreshSessions();
  }, [busy, refreshSessions]);

  const openSession = useCallback(
    async (id: string) => {
      if (busy) return;
      const picked = await loadChatSession(id);
      if (!picked) return;
      isDraftRef.current = false;
      await setActiveChatSession(id);
      setSession(picked);
      setMessages(picked.messages);
      messagesRef.current = picked.messages;
      setError(null);
      await refreshSessions();
    },
    [busy, refreshSessions],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runMemoryNow = useCallback(async () => {
    const key = apiKeyRef.current.trim();
    if (!key) {
      setError("Add your Mistral API key to run memory extraction.");
      return;
    }
    try {
      await runMemoryPipelineNow(key);
      await refreshSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refreshSessions]);

  const requestClarification = useCallback((request: ClarificationRequest) => {
    return new Promise<ClarificationAnswers | null>((resolve) => {
      approvalResolverRef.current = resolve;
      setClarificationRequest(request);
    });
  }, []);

  const submitClarification = useCallback((answers: ClarificationAnswers) => {
    if (!clarificationRequest || !approvalResolverRef.current) return;
    approvalResolverRef.current(answers);
    approvalResolverRef.current = null;
    setClarificationRequest(null);
  }, [clarificationRequest]);

  const cancelClarification = useCallback(() => {
    if (approvalResolverRef.current) {
      approvalResolverRef.current(null);
      approvalResolverRef.current = null;
    }
    setClarificationRequest(null);
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

      await persistToStorage(withUser);

      const assistantPlaceholder: ChatMessage = { id: assistantId, role: "assistant", content: "" };
      const withAssistant = [...withUser, assistantPlaceholder];
      setMessages(withAssistant);
      messagesRef.current = withAssistant;
      setStreamingId(assistantId);
      setInput("");

      const controller = new AbortController();
      abortRef.current = controller;

      let memoryContext = "";
      try {
        memoryContext = await buildMemoryContextForQuestion(q);
        if (memoryContext.trim()) {
          diagLog("chat", "Memory context injected", { chars: memoryContext.length });
        }
      } catch {
        /* memory retrieval is best-effort */
      }

      try {
        await runPortfolioChatAgent(
          { question: q, history, apiKey, snapshot, signal: controller.signal, memoryContext },
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
            onClarification: requestClarification,
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
          await persistToStorage(withUser);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        abortRef.current = null;
        approvalResolverRef.current = null;
        setClarificationRequest(null);
        setStreamingId(null);
        setBusy(false);
        await persistToStorage(messagesRef.current);
        void refreshMemoryStatus();
      }
    },
    [apiKey, busy, persistToStorage, requestClarification],
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
    async (userId: string) => {
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
      await persistToStorage(trimmed);
    },
    [busy, persistToStorage],
  );

  useEffect(() => {
    if (!booted) return;
    const msgs = messagesRef.current;
    if (!msgs.some((m) => m.content.trim())) return;
    const id = window.setTimeout(() => {
      void persistToStorage(msgs);
    }, 500);
    return () => window.clearTimeout(id);
  }, [messages, persistToStorage, booted]);

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
    booted,
    memoryJob,
    runMemoryNow,
    error: error ?? storageError,
    refreshSessions,
    startNewChat,
    openSession,
    send,
    stopGeneration,
    regenerate,
    startEdit,
    persistToStorage,
    clarificationRequest,
    submitClarification,
    cancelClarification,
  };
}

export type MunshiChatController = ReturnType<typeof useMunshiChat>;
