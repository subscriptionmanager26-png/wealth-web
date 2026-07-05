import {
  applyClarificationAnswers,
  defaultClarificationAnswers,
  enrichPlannedToolArgs,
  fetchAgentPlan,
  type AgentPlan,
  type ClarificationAnswers,
  type ClarificationRequest,
  type PlannedTool,
} from "./agentPlanning";
import {
  completeRunningSteps,
  ensureMinStepDuration,
  MIN_TOOL_MS,
  newStepId,
  patchStep,
  pauseBetweenSteps,
  sleep,
  toolStepLabel,
  yieldToUi,
  type AgentStep,
} from "./agentSteps";
import { executePortfolioTool, type PortfolioSnapshot } from "./portfolioTools";
import { postChatRequest, streamChatRequest } from "./chatApiRoute";
import { diagLog } from "./diagnosticsLog";
import { mergeToolData, type ToolDataPayload, type ToolDataStore } from "./portfolioTools/toolData";
import { hydrateToolDataFromSnapshot } from "./portfolioTools/hydrateToolData";
import { blocksToPlainText, parseBlocksDocument } from "./chatBlocks/parse";
import type { AnswerTemplate } from "./chatBlocks/answerTemplates";
import { inferAnswerTemplate } from "./chatBlocks/questionRouter";
import {
  hasRenderableToolData,
  mergeBlocksWithToolData,
  synthesizeBlocksFromToolData,
} from "./chatBlocks/synthesizeFromToolData";
import type { Block } from "./chatBlocks/types";
import type { ChatMessage } from "./portfolioChat";

export type AgentMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: MistralToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type MistralToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ChatTurnResponse = {
  message?: AgentMessage;
  content?: string;
  tool_calls?: MistralToolCall[] | null;
  error?: string;
  _timing?: { mistralMs?: number };
};

type ChatRequest = {
  question: string;
  history: ChatMessage[];
  apiKey?: string;
  snapshot: PortfolioSnapshot;
  signal?: AbortSignal;
  memoryContext?: string;
};

export type AgentProgressCallbacks = {
  onDelta: (text: string) => void;
  onBlocks?: (blocks: Block[], fallbackText: string, template?: AnswerTemplate) => void;
  onToolData?: (payload: ToolDataPayload) => void;
  onSteps: (steps: AgentStep[]) => void | Promise<void>;
  onClarification?: (request: ClarificationRequest) => Promise<ClarificationAnswers | null>;
};

const MAX_TOOL_ROUNDS = 8;

export class ChatAbortError extends Error {
  constructor() {
    super("Aborted");
    this.name = "ChatAbortError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ChatAbortError();
}

function formatTimingDetail(apiMs: number, uiPaddingMs: number, serverMistralMs?: number): string {
  const parts = [`API ${(apiMs / 1000).toFixed(1)}s`];
  if (serverMistralMs != null && serverMistralMs > 0) {
    parts.push(`Mistral ${(serverMistralMs / 1000).toFixed(1)}s`);
  }
  if (uiPaddingMs >= 50) parts.push(`UI ${(uiPaddingMs / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** True if any tool result exists after the most recent user message. */
function hasToolResultsSinceLastUser(messages: AgentMessage[]): boolean {
  let afterUser = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === "user") break;
    if (m.role === "tool") afterUser = true;
  }
  return afterUser;
}

async function publishSteps(onSteps: AgentProgressCallbacks["onSteps"], steps: AgentStep[]) {
  await onSteps(steps);
  await yieldToUi();
}

async function fetchToolTurn(
  messages: AgentMessage[],
  apiKey: string | undefined,
  memoryContext: string | undefined,
  toolChoice: "auto" | "required",
  signal?: AbortSignal,
): Promise<ChatTurnResponse> {
  throwIfAborted(signal);
  const res = await postChatRequest(
    { messages, tools: true, stream: false, apiKey, memoryContext, toolChoice },
    apiKey,
    signal,
  );
  const data = (await res.json().catch(() => ({}))) as ChatTurnResponse & { error?: string };
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
  }
  return data;
}

async function fetchBlocksAnswer(
  messages: AgentMessage[],
  apiKey: string | undefined,
  memoryContext: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const res = await postChatRequest(
    { messages, blocksAnswer: true, apiKey, memoryContext },
    apiKey,
    signal,
  );
  const data = (await res.json().catch(() => ({}))) as { content?: string; error?: string };
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
  }
  return String(data.content ?? "").trim();
}

function deliverBlocksAnswer(
  raw: string,
  onBlocks: NonNullable<AgentProgressCallbacks["onBlocks"]>,
  toolData?: ToolDataStore,
  template?: AnswerTemplate,
  snapshot?: PortfolioSnapshot,
): boolean {
  const doc = parseBlocksDocument(raw);
  const resolvedTemplate = doc?.template ?? template;
  const hydrated = snapshot && toolData ? hydrateToolDataFromSnapshot(snapshot, toolData) : toolData;
  if (hydrated && hasRenderableToolData(hydrated)) {
    const blocks = mergeBlocksWithToolData(doc?.blocks ?? null, hydrated, resolvedTemplate, snapshot);
    if (blocks.length) {
      onBlocks(blocks, raw.trim() || blocksToPlainText(blocks), resolvedTemplate);
      return true;
    }
  }

  if (doc?.blocks.length) {
    onBlocks(doc.blocks, blocksToPlainText(doc.blocks), resolvedTemplate);
    return true;
  }

  return false;
}

async function finalizeStructuredAnswer(
  agentMessages: AgentMessage[],
  input: ChatRequest,
  memoryContext: string | undefined,
  callbacks: Pick<AgentProgressCallbacks, "onDelta" | "onBlocks">,
  toolData: ToolDataStore,
  answerTemplate: AnswerTemplate,
  signal?: AbortSignal,
): Promise<void> {
  const { onDelta, onBlocks } = callbacks;
  const hydrated = hydrateToolDataFromSnapshot(input.snapshot, toolData);

  if (hydrated && hasRenderableToolData(hydrated) && onBlocks) {
    try {
      const raw = await fetchBlocksAnswer(agentMessages, input.apiKey, memoryContext, signal);
      if (deliverBlocksAnswer(raw, onBlocks, hydrated, answerTemplate, input.snapshot)) return;
    } catch (e) {
      diagLog("chat", "Blocks answer failed — using template layout from tool data", {
        error: e instanceof Error ? e.message : String(e),
        template: answerTemplate,
      });
    }
    const blocks = synthesizeBlocksFromToolData(hydrated, undefined, answerTemplate, input.snapshot);
    onBlocks(blocks, blocksToPlainText(blocks), answerTemplate);
    return;
  }

  if (!onBlocks) {
    await streamAgentTurn(agentMessages, input.apiKey, memoryContext, onDelta, signal);
    return;
  }

  try {
    const raw = await fetchBlocksAnswer(agentMessages, input.apiKey, memoryContext, signal);
    if (deliverBlocksAnswer(raw, onBlocks, hydrated, answerTemplate, input.snapshot)) return;
    if (raw) await streamTextGradually(raw, onDelta, signal);
  } catch (e) {
    diagLog("chat", "Blocks answer failed — falling back to stream", {
      error: e instanceof Error ? e.message : String(e),
    });
    await streamAgentTurn(agentMessages, input.apiKey, memoryContext, onDelta, signal);
  }
}

async function streamAgentTurn(
  messages: AgentMessage[],
  apiKey: string | undefined,
  memoryContext: string | undefined,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await streamChatRequest(
    { messages, tools: true, stream: true, apiKey, memoryContext, answerFromToolsOnly: true },
    apiKey,
    (delta) => {
      throwIfAborted(signal);
      onDelta(delta);
    },
    signal,
  );
}

async function streamTextGradually(
  text: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const chunks = text.match(/[^\s]+\s*|\s+/g) ?? [text];
  for (const chunk of chunks) {
    throwIfAborted(signal);
    onDelta(chunk);
    if (chunk.trim().length) await sleep(4);
  }
}

async function executePlannedTools(
  planned: PlannedTool[],
  planSummary: string,
  input: ChatRequest,
  agentMessages: AgentMessage[],
  steps: AgentStep[],
  onSteps: AgentProgressCallbacks["onSteps"],
  onToolData: AgentProgressCallbacks["onToolData"],
  signal?: AbortSignal,
): Promise<AgentStep[]> {
  if (!planned.length) return steps;

  const toolCalls: MistralToolCall[] = planned.map((tool, idx) => ({
    id: `plan-${idx}-${newStepId()}`,
    type: "function",
    function: {
      name: tool.name,
      arguments: JSON.stringify(enrichPlannedToolArgs(tool, input.snapshot)),
    },
  }));

  agentMessages.push({
    role: "assistant",
    content: planSummary,
    tool_calls: toolCalls,
  });

  let nextSteps = steps;
  for (let i = 0; i < toolCalls.length; i += 1) {
    throwIfAborted(signal);
    const tc = toolCalls[i]!;
    const tool = planned[i]!;
    const approvedArgs = enrichPlannedToolArgs(tool, input.snapshot);
    const { label, detail } = toolStepLabel(tc.function.name, approvedArgs);
    const toolStepId = newStepId();
    const toolStart = Date.now();

    nextSteps = [
      ...nextSteps,
      {
        id: toolStepId,
        kind: "tool",
        status: "running",
        label,
        detail,
        toolName: tc.function.name,
        toolArgs: approvedArgs,
        startedAt: toolStart,
      },
    ];
    await publishSteps(onSteps, nextSteps);

    const { text, data } = executePortfolioTool(input.snapshot, tc.function.name, approvedArgs);
    if (data?.length) {
      for (const payload of data) onToolData?.(payload);
    }
    agentMessages.push({
      role: "tool",
      name: tc.function.name,
      content: text,
      tool_call_id: tc.id,
    });

    await ensureMinStepDuration(toolStart, MIN_TOOL_MS);
    const lineCount = text.split("\n").filter((l) => l.trim() && !l.startsWith("===")).length;
    nextSteps = patchStep(nextSteps, toolStepId, {
      status: "done",
      endedAt: Date.now(),
      detail: lineCount > 0 ? `${lineCount} row${lineCount === 1 ? "" : "s"} returned` : "No data",
    });
    await publishSteps(onSteps, nextSteps);
    await pauseBetweenSteps();
  }

  return nextSteps;
}

async function runPlanningPhase(
  input: ChatRequest,
  agentMessages: AgentMessage[],
  steps: AgentStep[],
  onSteps: AgentProgressCallbacks["onSteps"],
  onClarification: AgentProgressCallbacks["onClarification"],
  onToolData: AgentProgressCallbacks["onToolData"],
  signal?: AbortSignal,
): Promise<{ steps: AgentStep[]; plan: AgentPlan | null }> {
  const planId = newStepId();
  const planStart = Date.now();
  let nextSteps = [
    ...steps,
    {
      id: planId,
      kind: "think" as const,
      status: "running" as const,
      label: "Planning",
      detail: "Choosing tools and what to clarify",
      startedAt: planStart,
    },
  ];
  await publishSteps(onSteps, nextSteps);

  let plan: AgentPlan | null = null;
  try {
    plan = await fetchAgentPlan(
      input.question,
      input.snapshot,
      input.history.map((m) => ({ role: m.role, content: m.content })),
      input.apiKey,
      signal,
    );
  } catch (e) {
    diagLog("chat", "Planning failed — falling back to live tool selection", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await ensureMinStepDuration(planStart);
  nextSteps = patchStep(nextSteps, planId, {
    status: "done",
    endedAt: Date.now(),
    detail: plan
      ? `${plan.tools.length} tool${plan.tools.length === 1 ? "" : "s"} planned${plan.questions.length ? ` · ${plan.questions.length} question${plan.questions.length === 1 ? "" : "s"}` : ""}`
      : "Using live tool selection",
  });
  await publishSteps(onSteps, nextSteps);
  await pauseBetweenSteps();

  if (!plan?.tools.length) {
    return { steps: nextSteps, plan: null };
  }

  let resolvedTools = plan.tools;
  if (plan.questions.length) {
    let answers: ClarificationAnswers | null = null;
    if (onClarification) {
      const clarifyId = newStepId();
      const clarifyStart = Date.now();
      nextSteps = [
        ...nextSteps,
        {
          id: clarifyId,
          kind: "think",
          status: "running",
          label: "Clarifying",
          detail: `${plan.questions.length} quick question${plan.questions.length === 1 ? "" : "s"}`,
          startedAt: clarifyStart,
        },
      ];
      await publishSteps(onSteps, nextSteps);

      answers = await onClarification({ plan, userQuestion: input.question.trim() });
      if (!answers) {
        nextSteps = patchStep(nextSteps, clarifyId, {
          status: "done",
          endedAt: Date.now(),
          detail: "Cancelled",
        });
        await publishSteps(onSteps, nextSteps);
        throw new ChatAbortError();
      }

      await ensureMinStepDuration(clarifyStart);
      nextSteps = patchStep(nextSteps, clarifyId, {
        status: "done",
        endedAt: Date.now(),
        detail: "Choices confirmed",
      });
      await publishSteps(onSteps, nextSteps);
      await pauseBetweenSteps();
    } else {
      answers = defaultClarificationAnswers(plan);
    }
    resolvedTools = applyClarificationAnswers(plan, answers);
  }

  nextSteps = await executePlannedTools(
    resolvedTools,
    plan.planSummary,
    input,
    agentMessages,
    nextSteps,
    onSteps,
    onToolData,
    signal,
  );

  return { steps: nextSteps, plan };
}

export async function runPortfolioChatAgent(input: ChatRequest, callbacks: AgentProgressCallbacks): Promise<void> {
  const { onDelta, onBlocks, onToolData, onSteps, onClarification } = callbacks;
  const { signal, memoryContext } = input;
  let steps: AgentStep[] = [];
  let toolData: ToolDataStore = {};
  const recordToolData = (payload: ToolDataPayload) => {
    toolData = mergeToolData(toolData, payload);
    onToolData?.(payload);
  };

  const agentMessages: AgentMessage[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.question.trim() },
  ];

  let answerTemplate: AnswerTemplate = inferAnswerTemplate(input.question);

  try {
    const planning = await runPlanningPhase(
      input,
      agentMessages,
      steps,
      onSteps,
      onClarification,
      recordToolData,
      signal,
    );
    steps = planning.steps;
    if (planning.plan?.answerTemplate) answerTemplate = planning.plan.answerTemplate;
  } catch (e) {
    if (e instanceof ChatAbortError) {
      steps = completeRunningSteps(steps);
      await publishSteps(onSteps, steps);
      return;
    }
    throw e;
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    throwIfAborted(signal);
    const thinkId = newStepId();
    const thinkStart = Date.now();
    steps = [
      ...steps,
      {
        id: thinkId,
        kind: "think",
        status: "running",
        label: round === 0 ? "Thinking" : "Thinking",
        detail:
          round === 0 && !hasToolResultsSinceLastUser(agentMessages)
            ? "Choosing what portfolio data to load"
            : "Reviewing results",
        startedAt: thinkStart,
      },
    ];
    await publishSteps(onSteps, steps);

    const apiStart = Date.now();
    const needsTools = !hasToolResultsSinceLastUser(agentMessages);
    const turn = await fetchToolTurn(
      agentMessages,
      input.apiKey,
      memoryContext,
      needsTools ? "required" : "auto",
      signal,
    );
    const apiMs = Date.now() - apiStart;
    const toolCalls = turn.tool_calls ?? turn.message?.tool_calls ?? null;
    const reasoning = (turn.content ?? turn.message?.content ?? "").trim();
    const serverMistralMs = turn._timing?.mistralMs;

    const beforePad = Date.now();
    await ensureMinStepDuration(thinkStart);
    const uiPaddingMs = Date.now() - beforePad;

    diagLog("chat", `Think round ${round + 1}: ${formatTimingDetail(apiMs, uiPaddingMs, serverMistralMs)}`, {
      round: round + 1,
      apiMs,
      uiPaddingMs,
      serverMistralMs,
      toolCount: toolCalls?.length ?? 0,
    });

    const thinkDetail = toolCalls?.length
      ? `Selected ${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}`
      : "Ready to respond";
    steps = patchStep(steps, thinkId, {
      status: "done",
      endedAt: Date.now(),
      apiMs,
      uiPaddingMs,
      detail: `${thinkDetail} · ${formatTimingDetail(apiMs, uiPaddingMs, serverMistralMs)}`,
    });
    await publishSteps(onSteps, steps);
    await pauseBetweenSteps();

    if (reasoning && toolCalls?.length) {
      const reasonId = newStepId();
      const reasonStart = Date.now();
      steps = [
        ...steps,
        {
          id: reasonId,
          kind: "think",
          status: "running",
          label: "Reasoning",
          detail: reasoning.length > 220 ? `${reasoning.slice(0, 220)}…` : reasoning,
          startedAt: reasonStart,
        },
      ];
      await publishSteps(onSteps, steps);
      await ensureMinStepDuration(reasonStart);
      steps = patchStep(steps, reasonId, { status: "done", endedAt: Date.now() });
      await publishSteps(onSteps, steps);
      await pauseBetweenSteps();
    }

    if (toolCalls?.length) {
      agentMessages.push({
        role: "assistant",
        content: turn.content ?? turn.message?.content ?? "",
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        throwIfAborted(signal);
        const rawArgs = parseToolArgs(tc.function.arguments);
        const approvedArgs = enrichPlannedToolArgs({ name: tc.function.name, arguments: rawArgs }, input.snapshot);
        const { label, detail } = toolStepLabel(tc.function.name, approvedArgs);
        const toolStepId = newStepId();
        const toolStart = Date.now();

        steps = [
          ...steps,
          {
            id: toolStepId,
            kind: "tool",
            status: "running",
            label,
            detail,
            toolName: tc.function.name,
            toolArgs: approvedArgs,
            startedAt: toolStart,
          },
        ];
        await publishSteps(onSteps, steps);

    const { text, data } = executePortfolioTool(input.snapshot, tc.function.name, approvedArgs);
    if (data?.length) {
      for (const payload of data) recordToolData(payload);
    }
        agentMessages.push({
          role: "tool",
          name: tc.function.name,
          content: text,
          tool_call_id: tc.id,
        });

        await ensureMinStepDuration(toolStart, MIN_TOOL_MS);
        const lineCount = text.split("\n").filter((l) => l.trim() && !l.startsWith("===")).length;
        steps = patchStep(steps, toolStepId, {
          status: "done",
          endedAt: Date.now(),
          detail: lineCount > 0 ? `${lineCount} row${lineCount === 1 ? "" : "s"} returned` : "No data",
        });
        await publishSteps(onSteps, steps);
        await pauseBetweenSteps();
      }
      continue;
    }

    const direct = (turn.content ?? turn.message?.content ?? "").trim();
    if (hasToolResultsSinceLastUser(agentMessages) && !toolCalls?.length) {
      break;
    }

    if (direct && !hasToolResultsSinceLastUser(agentMessages)) {
      diagLog("chat", "Model returned data without tools — forcing another tool round", { round: round + 1 });
      agentMessages.push({
        role: "assistant",
        content: direct,
      });
      agentMessages.push({
        role: "user",
        content:
          "You must call portfolio tools before answering with any data. Use the appropriate tool(s) now — do not answer from memory.",
      });
      continue;
    }

    break;
  }

  if (!hasToolResultsSinceLastUser(agentMessages)) {
    onDelta(
      "I need to load your portfolio data via tools before I can answer. Please try your question again — if this keeps happening, rephrase or check that your statements are loaded.",
    );
    steps = completeRunningSteps(steps);
    await publishSteps(onSteps, steps);
    return;
  }

  const writeId = newStepId();
  const writeStart = Date.now();
  steps = [
    ...steps,
    {
      id: writeId,
      kind: "write",
      status: "running",
      label: "Writing response",
      startedAt: writeStart,
    },
  ];
  await publishSteps(onSteps, steps);

  const hydrated = hydrateToolDataFromSnapshot(input.snapshot, toolData);

  await ensureMinStepDuration(writeStart);
  await finalizeStructuredAnswer(
    agentMessages,
    input,
    memoryContext,
    { onDelta, onBlocks },
    hydrated,
    answerTemplate,
    signal,
  );

  steps = patchStep(steps, writeId, { status: "done", endedAt: Date.now() });
  steps = completeRunningSteps(steps);
  await publishSteps(onSteps, steps);
}
