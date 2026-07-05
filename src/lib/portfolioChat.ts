import { postChatRequest, streamChatRequest } from "./chatApiRoute";
import type { AgentStep } from "./agentSteps";
import type { AnswerTemplate } from "./chatBlocks/answerTemplates";
import type { Block } from "./chatBlocks/types";
import type { ToolDataStore } from "./portfolioTools/toolData";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Structured UI blocks for assistant replies (Phase 1+). */
  blocks?: Block[];
  /** Structured data from tools for wealth widgets (Phase 2). */
  toolData?: ToolDataStore;
  /** Generative UI answer template (dashboard, comparison, etc.). */
  answerTemplate?: AnswerTemplate;
  /** Cursor-style activity trace (tool calls + thinking steps). */
  steps?: AgentStep[];
};

type ChatRequest = {
  question: string;
  context: string;
  history: ChatMessage[];
  apiKey?: string;
  stream?: boolean;
};

function buildChatBody(input: ChatRequest) {
  const apiKey = input.apiKey?.trim();
  return {
    apiKey: apiKey || undefined,
    context: input.context,
    stream: input.stream ?? false,
    messages: [
      ...input.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: input.question },
    ],
  };
}

export async function askPortfolioQuestion(input: ChatRequest): Promise<string> {
  const res = await postChatRequest(buildChatBody({ ...input, stream: false }), input.apiKey);

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
  }
  return String(data.answer ?? "");
}

export async function streamPortfolioQuestion(
  input: ChatRequest,
  onDelta: (text: string) => void,
): Promise<void> {
  await streamChatRequest(buildChatBody({ ...input, stream: true }), input.apiKey, onDelta);
}
