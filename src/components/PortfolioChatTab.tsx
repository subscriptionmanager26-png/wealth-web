import { useEffect, useMemo, useRef, useState } from "react";

import type { MunshiChatController } from "../hooks/useMunshiChat";
import type { FundHolding } from "../lib/buildHoldings";
import type { PortfolioAnalyticsSnapshot } from "@mobile/utils/portfolioNavAnalytics";
import type { PortfolioFundamentalsSnapshot } from "@mobile/utils/portfolioInsightsAnalytics";
import type { BenchmarkId, BenchmarkMonthEndPoint } from "@mobile/utils/benchmarkTypes";
import type { UpvalySchemeDetail } from "@mobile/utils/upvalyMfApi";
import type { XRayHoldingRow, XRaySectorRow } from "@mobile/utils/xrayAggregations";
import type { PortfolioSnapshot } from "../lib/portfolioTools";
import { buildMetricsIndex, loadScreenerSnapshot, type ScreenerSchemeMetrics } from "../lib/screenerSnapshot";
import { ChatAgentSteps } from "./ChatAgentSteps";
import { ChatComposer } from "./ChatComposer";
import { ChatEmptyState } from "./ChatEmptyState";
import { ChatHistoryDrawer } from "./ChatHistoryDrawer";
import { ChatMessageActions } from "./ChatMessageActions";
import { ChatMessageContent } from "./ChatMessageContent";
import { MistralSettingsModal } from "./MistralSettingsModal";
import { ClarificationModal } from "./ClarificationModal";

type Props = {
  chat: MunshiChatController;
  portfolioView: "family" | "member";
  hero: { total: number; invested: number; gain: number; xirr: string; dayChange?: number; dayChangePct?: number };
  holdings: FundHolding[];
  perf?: PortfolioAnalyticsSnapshot | null;
  portfolioFundamentals?: PortfolioFundamentalsSnapshot | null;
  sectorRows?: XRaySectorRow[];
  stockRows?: XRayHoldingRow[];
  assetSlices?: { type: string; value: number }[];
  upvalySchemes?: Record<string, UpvalySchemeDetail>;
  benchmarkMonthEnds?: Partial<Record<BenchmarkId, BenchmarkMonthEndPoint[]>>;
  insightsLoading?: boolean;
  settingsOpen: boolean;
  onSettingsClose: () => void;
  onSettingsOpen: () => void;
  historyOpen: boolean;
  onHistoryClose: () => void;
  hasPortfolioData: boolean;
  onUploadClick?: () => void;
};

const STARTERS = [
  "How is my portfolio performing vs Nifty 500?",
  "What is my largest holding and its weight?",
  "Summarize my equity vs debt allocation.",
  "Which funds have the best and worst returns?",
  "What are my top underlying stock exposures?",
];

export function PortfolioChatTab({
  chat,
  portfolioView,
  hero,
  holdings,
  perf,
  portfolioFundamentals,
  sectorRows,
  stockRows,
  assetSlices,
  upvalySchemes,
  benchmarkMonthEnds,
  insightsLoading,
  settingsOpen,
  onSettingsClose,
  onSettingsOpen,
  historyOpen,
  onHistoryClose,
  hasPortfolioData,
  onUploadClick,
}: Props) {
  const threadRef = useRef<HTMLDivElement>(null);
  const {
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
    error,
    refreshSessions,
    openSession,
    send,
    stopGeneration,
    regenerate,
    startEdit,
    memoryJob,
    runMemoryNow,
    clarificationRequest,
    submitClarification,
    cancelClarification,
  } = chat;

  const [screenerFunds, setScreenerFunds] = useState<Record<string, ScreenerSchemeMetrics>>({});
  const [screenerGeneratedAt, setScreenerGeneratedAt] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    void loadScreenerSnapshot().then((snap) => {
      if (cancelled) return;
      setScreenerFunds(buildMetricsIndex(snap));
      setScreenerGeneratedAt(snap.generatedAt);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const snapshot = useMemo(
    (): PortfolioSnapshot => ({
      portfolioView,
      hero,
      holdings,
      perf,
      fundamentals: portfolioFundamentals,
      sectorRows,
      stockRows,
      assetSlices,
      upvalySchemes,
      benchmarkMonthEnds,
      screenerFunds,
      screenerGeneratedAt,
    }),
    [
      portfolioView,
      hero,
      holdings,
      perf,
      portfolioFundamentals,
      sectorRows,
      stockRows,
      assetSlices,
      upvalySchemes,
      benchmarkMonthEnds,
      screenerFunds,
      screenerGeneratedAt,
    ],
  );

  useEffect(() => {
    if (historyOpen) refreshSessions();
  }, [historyOpen, refreshSessions]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingId, busy]);

  function handleOpenSession(id: string) {
    openSession(id);
    onHistoryClose();
  }

  function handleSubmit() {
    void send(input, snapshot, onSettingsOpen);
  }

  const inputDisabled = !hasPortfolioData || !apiKey;

  return (
    <>
      <ChatHistoryDrawer
        open={historyOpen}
        sessions={sessions}
        activeSessionId={session.id || null}
        onClose={onHistoryClose}
        onSelect={handleOpenSession}
      />

      <div className="portfolio-chat">
        {!hasPortfolioData ? (
          <div className="portfolio-chat-empty panel-card">
            <p>Upload a CAS statement to ground answers in your real holdings and performance.</p>
            {onUploadClick ? (
              <button type="button" className="btn-primary" onClick={onUploadClick}>
                Upload CAS
              </button>
            ) : null}
          </div>
        ) : null}

        {insightsLoading ? (
          <p className="text-muted portfolio-chat-loading-note">Loading fund metrics for richer answers…</p>
        ) : null}

        <div className="portfolio-chat-body">
          {messages.length === 0 ? (
            <ChatEmptyState
              starters={STARTERS}
              onSelect={(q) => void send(q, snapshot, onSettingsOpen)}
              disabled={busy || !apiKey || !hasPortfolioData}
              hasApiKey={Boolean(apiKey)}
              hasPortfolioData={hasPortfolioData}
              onSettingsOpen={onSettingsOpen}
            />
          ) : (
            <div className="portfolio-chat-thread" ref={threadRef} aria-live="polite">
              {messages.map((m) => {
                const nonWriteRunning = m.steps?.some((s) => s.status === "running" && s.kind !== "write");
                const isActiveStream = streamingId === m.id;
                const showAnswer =
                  m.role === "assistant" &&
                  m.content.trim().length > 0 &&
                  (!nonWriteRunning || !isActiveStream);
                const isStreaming = isActiveStream && m.content.length > 0 && !nonWriteRunning;

                if (m.role === "user") {
                  return (
                    <div key={m.id} className="chat-message chat-message-user">
                      <div className="chat-message-inner">
                        <div className="portfolio-chat-bubble portfolio-chat-bubble-user">
                          <div className="portfolio-chat-text">{m.content}</div>
                        </div>
                        <ChatMessageActions
                          role="user"
                          content={m.content}
                          onEdit={() => startEdit(m.id)}
                          disabled={busy}
                        />
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={m.id} className="chat-message chat-message-assistant">
                    <div className="chat-message-inner">
                      {m.steps?.length ? (
                        <div className="portfolio-chat-trace-wrap">
                          <ChatAgentSteps
                            steps={m.steps}
                            active={isActiveStream || busy}
                            hasAnswer={m.content.trim().length > 0}
                          />
                        </div>
                      ) : null}
                      {(showAnswer || isStreaming) && (
                        <div className="portfolio-chat-reply">
                          {showAnswer || isStreaming ? (
                            <ChatMessageContent content={m.content} streaming={isStreaming} />
                          ) : null}
                        </div>
                      )}
                      {m.content.trim() && !isActiveStream ? (
                        <ChatMessageActions
                          role="assistant"
                          content={m.content}
                          onRegenerate={() => void regenerate(m.id, snapshot, onSettingsOpen)}
                          disabled={busy}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error ? <div className="portfolio-chat-error">{error}</div> : null}

        <ChatComposer
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          onStop={stopGeneration}
          busy={busy}
          disabled={inputDisabled}
          placeholder={
            !hasPortfolioData
              ? "Upload a CAS to start"
              : !apiKey
                ? "Add API key in Settings to chat"
                : "Ask about your portfolio…"
          }
        />
      </div>

      <MistralSettingsModal
        open={settingsOpen}
        onClose={onSettingsClose}
        savedKey={apiKey}
        onSaveKey={saveApiKey}
        onClearKey={clearApiKey}
        memoryJob={memoryJob}
        onRunMemoryNow={runMemoryNow}
      />

      <ClarificationModal
        open={Boolean(clarificationRequest)}
        request={clarificationRequest}
        onSubmit={submitClarification}
        onCancel={cancelClarification}
      />
    </>
  );
}
