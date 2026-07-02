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
};

export type AgentProgressCallbacks = {
  onDelta: (text: string) => void;
  onSteps: (steps: AgentStep[]) => void | Promise<void>;
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

async function publishSteps(onSteps: AgentProgressCallbacks["onSteps"], steps: AgentStep[]) {
  await onSteps(steps);
  await yieldToUi();
}

async function fetchToolTurn(
  messages: AgentMessage[],
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<ChatTurnResponse> {
  throwIfAborted(signal);
  const res = await postChatRequest({ messages, tools: true, stream: false, apiKey }, apiKey, signal);
  const data = (await res.json().catch(() => ({}))) as ChatTurnResponse & { error?: string };
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
  }
  return data;
}

async function streamAgentTurn(
  messages: AgentMessage[],
  apiKey: string | undefined,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await streamChatRequest({ messages, tools: true, stream: true, apiKey }, apiKey, (delta) => {
    throwIfAborted(signal);
    onDelta(delta);
  }, signal);
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

export async function runPortfolioChatAgent(input: ChatRequest, callbacks: AgentProgressCallbacks): Promise<void> {
  const { onDelta, onSteps } = callbacks;
  const { signal } = input;
  let steps: AgentStep[] = [];

  const agentMessages: AgentMessage[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.question.trim() },
  ];

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
        detail: round === 0 ? "Choosing what portfolio data to load" : "Reviewing results",
        startedAt: thinkStart,
      },
    ];
    await publishSteps(onSteps, steps);

    const apiStart = Date.now();
    const turn = await fetchToolTurn(agentMessages, input.apiKey, signal);
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
        const args = parseToolArgs(tc.function.arguments);
        const { label, detail } = toolStepLabel(tc.function.name, args);
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
            toolArgs: args,
            startedAt: toolStart,
          },
        ];
        await publishSteps(onSteps, steps);

        const result = executePortfolioTool(input.snapshot, tc.function.name, args);
        agentMessages.push({
          role: "tool",
          name: tc.function.name,
          content: result,
          tool_call_id: tc.id,
        });

        await ensureMinStepDuration(toolStart, MIN_TOOL_MS);
        const lineCount = result.split("\n").filter((l) => l.trim() && !l.startsWith("===")).length;
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
    if (direct) {
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
      await ensureMinStepDuration(writeStart);
      await streamTextGradually(direct, onDelta, signal);
      steps = patchStep(steps, writeId, { status: "done", endedAt: Date.now() });
      await publishSteps(onSteps, steps);
      steps = completeRunningSteps(steps);
      await publishSteps(onSteps, steps);
      return;
    }

    break;
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

  let firstDelta = false;
  await streamAgentTurn(agentMessages, input.apiKey, async (delta) => {
    if (!firstDelta) {
      firstDelta = true;
      await ensureMinStepDuration(writeStart);
    }
    onDelta(delta);
  }, signal);

  if (!firstDelta) {
    await ensureMinStepDuration(writeStart);
  }
  steps = patchStep(steps, writeId, { status: "done", endedAt: Date.now() });
  steps = completeRunningSteps(steps);
  await publishSteps(onSteps, steps);
}
