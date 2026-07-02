/**
 * All Munshi chat traffic goes through the app proxy at /api/portfolio/chat.
 * Dev: Vite proxies to server/proxy.mjs on port 3457.
 * Prod: node server/proxy.mjs (Docker / npm start) — not Vercel serverless.
 */

const CHAT_ENDPOINT = "/api/portfolio/chat";

function chatHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = apiKey?.trim();
  if (key) headers["X-Mistral-Api-Key"] = key;
  return headers;
}

type ChatProxyBody = {
  messages?: unknown[];
  tools?: boolean;
  stream?: boolean;
  apiKey?: string;
  context?: string;
};

export async function postChatRequest(
  body: ChatProxyBody,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: chatHeaders(apiKey ?? body.apiKey),
    body: JSON.stringify({ ...body, apiKey: apiKey ?? body.apiKey }),
    signal,
  });
}

export async function streamChatRequest(
  body: ChatProxyBody,
  apiKey: string | undefined,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: chatHeaders(apiKey ?? body.apiKey),
    body: JSON.stringify({ ...body, apiKey: apiKey ?? body.apiKey, stream: true }),
    signal,
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
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
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
        const parsed = JSON.parse(payload) as { text?: string; error?: string };
        if (parsed.error) throw new Error(parsed.error);
        if (typeof parsed.text === "string" && parsed.text.length) onDelta(parsed.text);
      } catch (e) {
        if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
      }
    }
  }
}
