import { useEffect, useMemo, useRef } from "react";

import type { MunshiChatController } from "../hooks/useMunshiChat";
import type { FundHolding } from "../lib/buildHoldings";
import type { PortfolioAnalyticsSnapshot } from "@mobile/utils/portfolioNavAnalytics";
import type { PortfolioFundamentalsSnapshot } from "@mobile/utils/portfolioInsightsAnalytics";
import type { BenchmarkId, BenchmarkMonthEndPoint } from "@mobile/utils/benchmarkTypes";
import type { UpvalySchemeDetail } from "@mobile/utils/upvalyMfApi";
import type { XRayHoldingRow, XRaySectorRow } from "@mobile/utils/xrayAggregations";
import type { PortfolioSnapshot } from "../lib/portfolioTools";
import { ChatAgentSteps } from "./ChatAgentSteps";
import { ChatHistoryDrawer } from "./ChatHistoryDrawer";
import { ChatMessageContent } from "./ChatMessageContent";
import { MistralSettingsModal } from "./MistralSettingsModal";

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
  } = chat;

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

        {messages.length === 0 ? (
          <div className="portfolio-chat-starters">
            {STARTERS.map((q) => (
              <button
                key={q}
                type="button"
                className="chip-btn"
                onClick={() => void send(q, snapshot, onSettingsOpen)}
                disabled={busy || !apiKey || !hasPortfolioData}
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}

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
                <div key={m.id} className="portfolio-chat-bubble portfolio-chat-bubble-user">
                  <div className="portfolio-chat-role">You</div>
                  <div className="portfolio-chat-text">{m.content}</div>
                </div>
              );
            }

            return (
              <div key={m.id} className="portfolio-chat-turn">
                {m.steps?.length ? (
                  <div className="portfolio-chat-trace-wrap">
                    <ChatAgentSteps
                      steps={m.steps}
                      active={isActiveStream || busy}
                      hasAnswer={m.content.trim().length > 0}
                    />
                  </div>
                ) : null}
                <div className="portfolio-chat-bubble portfolio-chat-bubble-assistant">
                  <div className="portfolio-chat-role">Munshi Ji</div>
                  {showAnswer ? (
                    <ChatMessageContent content={m.content} streaming={isStreaming} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {!apiKey ? (
          <p className="portfolio-chat-key-prompt">Open Settings (top right) to add your Mistral API key.</p>
        ) : null}

        {error ? <div className="portfolio-chat-error">{error}</div> : null}

        <form
          className="portfolio-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input, snapshot, onSettingsOpen);
          }}
        >
          <input
            className="portfolio-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={hasPortfolioData ? "Ask about your portfolio…" : "Upload a CAS to start"}
            disabled={busy || !hasPortfolioData}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !input.trim() || !apiKey || !hasPortfolioData}
          >
            Send
          </button>
        </form>
      </div>

      <MistralSettingsModal
        open={settingsOpen}
        onClose={onSettingsClose}
        savedKey={apiKey}
        onSaveKey={saveApiKey}
        onClearKey={clearApiKey}
      />
    </>
  );
}
