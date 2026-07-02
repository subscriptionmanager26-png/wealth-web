export type MunshiRule = {
  id: string;
  text: string;
  priority: "high" | "medium" | "low";
  active: boolean;
  sourceSessionId?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type MunshiLearning = {
  id: string;
  text: string;
  confidence: number;
  active: boolean;
  sourceSessionId?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type MunshiDaySummary = {
  date: string;
  summary: string;
  sessionIds: string[];
  updatedAt: string;
};

export type MunshiMemoryJobState = {
  lastExtractAt: string | null;
  /** Local calendar day (YYYY-MM-DD) when automatic extraction last succeeded. */
  lastAutomaticExtractDay: string | null;
  lastConsolidationAt: string | null;
  processing: boolean;
  lastRunProcessedCount?: number;
};

export type MemoryExtractionResult = {
  daySummary: string;
  learnings: { text: string; confidence: number }[];
  rules: { text: string; priority: "high" | "medium" | "low" }[];
};

export const MAX_ACTIVE_RULES = 50;
export const MAX_ACTIVE_LEARNINGS = 100;
export const CONSOLIDATION_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
/** Delay before automatic run on first app open of the day (avoids competing with CAS/NAV load). */
export const MEMORY_AUTO_START_DELAY_MS = 8_000;
