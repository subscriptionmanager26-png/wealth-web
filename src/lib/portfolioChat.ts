import type { AgentStep } from "./agentSteps";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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

function chatHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = apiKey?.trim();
  if (key) headers["X-Mistral-Api-Key"] = key;
  return headers;
}

export async function askPortfolioQuestion(input: ChatRequest): Promise<string> {
  const res = await fetch("/api/portfolio/chat", {
    method: "POST",
    headers: chatHeaders(input.apiKey),
    body: JSON.stringify(buildChatBody({ ...input, stream: false })),
  });

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
  const res = await fetch("/api/portfolio/chat", {
    method: "POST",
    headers: chatHeaders(input.apiKey),
    body: JSON.stringify(buildChatBody({ ...input, stream: true })),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
  }

  if (!res.body) throw new Error("Streaming response was empty");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload) as { text?: string; error?: string; done?: boolean };
        if (parsed.error) throw new Error(parsed.error);
        if (typeof parsed.text === "string" && parsed.text.length) onDelta(parsed.text);
      } catch (e) {
        if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
      }
    }
  }
}
