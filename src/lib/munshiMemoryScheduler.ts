import { dbListUnprocessedSessions, dbMarkSessionMemoryProcessed } from "./chatHistoryDb";
import { formatConversationForExtraction, sessionDayKey, type ChatSession } from "./chatHistory";
import { consolidateMemoryLists, extractMemoryFromConversation } from "./munshiMemoryExtractor";
import {
  memoryAddLearnings,
  memoryAddRules,
  memoryGetJobState,
  memoryListLearnings,
  memoryListRules,
  memoryPruneCaps,
  memoryReplaceAllLearnings,
  memoryReplaceAllRules,
  memorySetJobState,
  memoryUpsertDaySummary,
} from "./munshiMemoryDb";
import {
  automaticExtractStatusMessage,
  localDayKey,
  type AutomaticExtractDecision,
} from "./munshiMemorySchedulePolicy";
import {
  CONSOLIDATION_INTERVAL_MS,
  MAX_ACTIVE_LEARNINGS,
  MAX_ACTIVE_RULES,
} from "./munshiMemoryTypes";

let running = false;

export type MemoryJobProgress = {
  phase: "idle" | "extracting" | "consolidating" | "done" | "error";
  processedSessions: number;
  totalSessions: number;
  pendingSessions: number;
  lastExtractAt: string | null;
  lastAutomaticExtractDay: string | null;
  statusMessage: string;
  error?: string;
};

let progress: MemoryJobProgress = {
  phase: "idle",
  processedSessions: 0,
  totalSessions: 0,
  pendingSessions: 0,
  lastExtractAt: null,
  lastAutomaticExtractDay: null,
  statusMessage: "",
};

const listeners = new Set<(p: MemoryJobProgress) => void>();

function setProgress(patch: Partial<MemoryJobProgress>) {
  progress = { ...progress, ...patch };
  for (const fn of listeners) fn(progress);
}

export function subscribeMemoryJobProgress(fn: (p: MemoryJobProgress) => void): () => void {
  listeners.add(fn);
  void refreshMemoryStatus().then(() => fn(progress));
  return () => listeners.delete(fn);
}

export function getMemoryJobProgress(): MemoryJobProgress {
  return progress;
}

export async function evaluateAutomaticExtract(apiKey: string): Promise<AutomaticExtractDecision> {
  const key = apiKey.trim();
  const job = await memoryGetJobState();
  const pending = (await dbListUnprocessedSessions()).length;
  const today = localDayKey();

  if (!key) {
    return {
      shouldRun: false,
      pendingSessions: pending,
      reason: "no_api_key",
      lastAutomaticExtractDay: job.lastAutomaticExtractDay ?? null,
      lastExtractAt: job.lastExtractAt,
    };
  }
  if (job.processing || running) {
    return {
      shouldRun: false,
      pendingSessions: pending,
      reason: "already_running",
      lastAutomaticExtractDay: job.lastAutomaticExtractDay ?? null,
      lastExtractAt: job.lastExtractAt,
    };
  }
  if (pending === 0) {
    return {
      shouldRun: false,
      pendingSessions: 0,
      reason: "no_pending",
      lastAutomaticExtractDay: job.lastAutomaticExtractDay ?? null,
      lastExtractAt: job.lastExtractAt,
    };
  }
  if (job.lastAutomaticExtractDay === today) {
    return {
      shouldRun: false,
      pendingSessions: pending,
      reason: "already_ran_today",
      lastAutomaticExtractDay: job.lastAutomaticExtractDay,
      lastExtractAt: job.lastExtractAt,
    };
  }
  return {
    shouldRun: true,
    pendingSessions: pending,
    reason: "due",
    lastAutomaticExtractDay: job.lastAutomaticExtractDay ?? null,
    lastExtractAt: job.lastExtractAt,
  };
}

export async function refreshMemoryStatus(): Promise<MemoryJobProgress> {
  const job = await memoryGetJobState();
  const pending = (await dbListUnprocessedSessions()).length;
  const today = localDayKey();

  let reason: AutomaticExtractDecision["reason"] = "no_pending";
  if (pending > 0 && job.lastAutomaticExtractDay === today) reason = "already_ran_today";
  else if (pending > 0) reason = "due";

  const msg = automaticExtractStatusMessage({
    shouldRun: reason === "due",
    pendingSessions: pending,
    reason,
    lastAutomaticExtractDay: job.lastAutomaticExtractDay ?? null,
    lastExtractAt: job.lastExtractAt,
  });

  setProgress({
    pendingSessions: pending,
    lastExtractAt: job.lastExtractAt,
    lastAutomaticExtractDay: job.lastAutomaticExtractDay ?? null,
    statusMessage: msg,
  });
  return progress;
}

async function maybeConsolidate(apiKey: string, signal?: AbortSignal): Promise<void> {
  const job = await memoryGetJobState();
  const last = job.lastConsolidationAt ? new Date(job.lastConsolidationAt).getTime() : 0;
  if (Date.now() - last < CONSOLIDATION_INTERVAL_MS) return;

  setProgress({ phase: "consolidating" });
  const learnings = (await memoryListLearnings(true)).map((l) => ({
    text: l.text,
    confidence: l.confidence,
  }));
  const rules = (await memoryListRules(true)).map((r) => ({
    text: r.text,
    priority: r.priority,
  }));

  if (learnings.length < 5 && rules.length < 5) {
    await memorySetJobState({ lastConsolidationAt: new Date().toISOString() });
    return;
  }

  const merged = await consolidateMemoryLists(learnings, rules, apiKey, signal);
  const now = new Date().toISOString();

  await memoryReplaceAllLearnings(
    merged.learnings.slice(0, MAX_ACTIVE_LEARNINGS).map((l, i) => ({
      id: `consolidated-${i}-${Date.now()}`,
      text: l.text,
      confidence: l.confidence,
      active: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await memoryReplaceAllRules(
    merged.rules.slice(0, MAX_ACTIVE_RULES).map((r, i) => ({
      id: `consolidated-${i}-${Date.now()}`,
      text: r.text,
      priority: r.priority,
      active: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await memorySetJobState({ lastConsolidationAt: now });
}

async function processSession(session: ChatSession, apiKey: string, signal?: AbortSignal): Promise<void> {
  const conversation = formatConversationForExtraction(session.messages);
  if (!conversation.trim()) return;

  const extracted = await extractMemoryFromConversation(conversation, apiKey, signal);
  const day = sessionDayKey(session);

  if (extracted.daySummary) {
    await memoryUpsertDaySummary(day, extracted.daySummary, session.id);
  }
  if (extracted.learnings.length) {
    await memoryAddLearnings(
      extracted.learnings.map((l) => ({ ...l, sourceSessionId: session.id })),
    );
  }
  if (extracted.rules.length) {
    await memoryAddRules(extracted.rules.map((r) => ({ ...r, sourceSessionId: session.id })));
  }
  await dbMarkSessionMemoryProcessed(session.id);
  await memoryPruneCaps(MAX_ACTIVE_LEARNINGS, MAX_ACTIVE_RULES);
}

type RunOptions = {
  force?: boolean;
  markAutomaticDay?: boolean;
};

export async function runMemoryPipeline(apiKey: string, options: RunOptions = {}, signal?: AbortSignal): Promise<void> {
  if (running || !apiKey.trim()) return;

  if (!options.force) {
    const decision = await evaluateAutomaticExtract(apiKey);
    setProgress({
      statusMessage: automaticExtractStatusMessage(decision),
      pendingSessions: decision.pendingSessions,
      lastExtractAt: decision.lastExtractAt,
      lastAutomaticExtractDay: decision.lastAutomaticExtractDay,
    });
    if (!decision.shouldRun) return;
  }

  running = true;
  await memorySetJobState({ processing: true });

  try {
    const pending = await dbListUnprocessedSessions();
    setProgress({
      phase: "extracting",
      processedSessions: 0,
      totalSessions: pending.length,
      pendingSessions: pending.length,
    });

    if (pending.length === 0) {
      await memorySetJobState({ processing: false });
      setProgress({ phase: "idle", statusMessage: "No new conversations to process." });
      return;
    }

    for (let i = 0; i < pending.length; i += 1) {
      if (signal?.aborted) break;
      await processSession(pending[i]!, apiKey, signal);
      setProgress({ processedSessions: i + 1 });
    }

    await maybeConsolidate(apiKey, signal);
    const now = new Date().toISOString();
    const today = localDayKey();
    await memorySetJobState({
      lastExtractAt: now,
      lastRunProcessedCount: pending.length,
      processing: false,
      ...(options.markAutomaticDay ? { lastAutomaticExtractDay: today } : {}),
    });
    setProgress({
      phase: "done",
      processedSessions: pending.length,
      totalSessions: pending.length,
      pendingSessions: 0,
      lastExtractAt: now,
      lastAutomaticExtractDay: options.markAutomaticDay ? today : progress.lastAutomaticExtractDay,
      statusMessage: `Processed ${pending.length} conversation(s) at ${new Date(now).toLocaleString("en-IN")}.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await memorySetJobState({ processing: false });
    setProgress({ phase: "error", error: msg, statusMessage: msg });
    throw e;
  } finally {
    running = false;
    await memorySetJobState({ processing: false });
    await refreshMemoryStatus();
  }
}

export async function tryAutomaticMemoryExtract(apiKey: string): Promise<void> {
  await runMemoryPipeline(apiKey, { force: false, markAutomaticDay: true });
}

export async function runMemoryPipelineNow(apiKey: string): Promise<void> {
  await runMemoryPipeline(apiKey, { force: true, markAutomaticDay: false });
}
