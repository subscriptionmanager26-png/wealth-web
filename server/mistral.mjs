import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MUNSHI_TOOL_SCHEMAS } from "./munshiToolSchemas.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_MODEL = process.env.MISTRAL_MODEL ?? "mistral-large-latest";

const BASE_SYSTEM_PROMPT = `You are Munshi Ji, a portfolio assistant for Indian mutual fund investors.

You have tools to fetch portfolio data on demand. Call only the tools you need — see the tool catalog below.
- Answer the user's question directly. Do not open with an unsolicited benchmark summary.
- The data deliberately excludes personal identifiers (names, PAN, address, folio numbers, email, phone). Never ask for or infer them.
- Use INR (₹) for amounts and Indian number formatting where helpful.
- If tool results say data is missing or not loaded, say so — never invent holdings, schemes, NAV figures, or metrics.
- Do not recommend buys or sells unless explicitly asked.
- This is informational only, not investment advice.
- Use Markdown for structured answers (headings, bullet lists, tables when helpful).
- Use LaTeX for formulas when showing calculations, e.g. inline $XIRR$ or display $$\\text{Return} = \\frac{V_1 - V_0}{V_0}$$.
- Distinguish between portfolio-level metrics (NAV/XIRR) and individual fund metrics (scheme returns).`;

let cachedToolCatalog = null;

function loadToolCatalog() {
  if (cachedToolCatalog) return cachedToolCatalog;
  try {
    cachedToolCatalog = readFileSync(path.join(__dirname, "munshi-tools.md"), "utf8");
  } catch {
    cachedToolCatalog = "See tool descriptions in each tool schema.";
  }
  return cachedToolCatalog;
}

function buildSystemPrompt() {
  return `${BASE_SYSTEM_PROMPT}\n\n---\n\n${loadToolCatalog()}`;
}

function resolveApiKey(apiKeyInput) {
  const apiKey = apiKeyInput?.trim() || process.env.MISTRAL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Mistral API key is required. Add it in AI settings or set MISTRAL_API_KEY on the server.");
  }
  return apiKey;
}

function normalizeAgentMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && ["user", "assistant", "tool"].includes(m.role))
    .map((m) => {
      const out = { role: m.role, content: typeof m.content === "string" ? m.content : "" };
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.name) out.name = m.name;
      return out;
    })
    .slice(-24);
}

function buildMistralMessages({ messages, context, useTools }) {
  if (useTools) {
    return [{ role: "system", content: buildSystemPrompt() }, ...normalizeAgentMessages(messages)];
  }

  const userTurns = messages.filter((m) => m.role === "user");
  const lastUser = userTurns[userTurns.length - 1];
  if (!lastUser?.content?.trim()) {
    throw new Error("Question is required");
  }

  const contextBlock = context?.trim()
    ? `Portfolio context (authoritative — use only this data):\n${context.trim()}`
    : "Portfolio context: No portfolio data was provided.";

  const history = messages
    .slice(0, -1)
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.trim() }));

  return {
    lastUser,
    mistralMessages: [
      { role: "system", content: BASE_SYSTEM_PROMPT },
      ...history,
      {
        role: "user",
        content: `${contextBlock}\n\nQuestion: ${lastUser.content.trim()}`,
      },
    ],
  };
}

async function readMistralError(res, text) {
  let detail = text;
  try {
    const parsed = JSON.parse(text);
    detail = parsed?.message ?? parsed?.error?.message ?? text;
  } catch {
    /* keep raw */
  }
  throw new Error(`Mistral API ${res.status}: ${detail}`);
}

/** Agent turn with optional tools (non-streaming). */
export async function mistralChatTurn({ messages, apiKey: apiKeyInput, tools = false }) {
  const apiKey = resolveApiKey(apiKeyInput);
  const mistralMessages = buildMistralMessages({ messages, useTools: tools });

  const body = {
    model: DEFAULT_MODEL,
    messages: mistralMessages,
    temperature: 0.2,
  };
  if (tools) {
    body.tools = MUNSHI_TOOL_SCHEMAS;
    body.tool_choice = "auto";
  }

  const res = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) await readMistralError(res, text);

  const data = JSON.parse(text);
  const message = data?.choices?.[0]?.message ?? {};
  return {
    message,
    model: data?.model ?? DEFAULT_MODEL,
    content: message.content?.trim() ?? "",
    tool_calls: message.tool_calls ?? null,
  };
}

function parseSseLines(buffer, onDataLine) {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    onDataLine(payload);
  }
  return rest;
}

/** Stream final answer (no tools). */
export async function streamMistralChat({ messages, apiKey: apiKeyInput, onChunk }) {
  const apiKey = resolveApiKey(apiKeyInput);
  const mistralMessages = [{ role: "system", content: buildSystemPrompt() }, ...normalizeAgentMessages(messages)];

  const res = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: mistralMessages,
      temperature: 0.2,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    await readMistralError(res, text);
  }

  if (!res.body) throw new Error("Mistral returned an empty stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let model = DEFAULT_MODEL;
  let answer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = parseSseLines(buffer, (payload) => {
      try {
        const parsed = JSON.parse(payload);
        if (parsed?.model) model = parsed.model;
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length) {
          answer += delta;
          onChunk(delta);
        }
      } catch {
        /* ignore malformed chunks */
      }
    });
  }

  if (!answer.trim()) throw new Error("Mistral returned an empty response");
  return { answer: answer.trim(), model };
}

/** @deprecated Legacy full-context chat */
export async function chatWithMistral({ messages, context, apiKey: apiKeyInput }) {
  const apiKey = resolveApiKey(apiKeyInput);
  const { mistralMessages } = buildMistralMessages({ messages, context, useTools: false });

  const res = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: mistralMessages,
      temperature: 0.1,
    }),
  });

  const text = await res.text();
  if (!res.ok) await readMistralError(res, text);

  const data = JSON.parse(text);
  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Mistral returned an empty response");
  return { answer, model: data?.model ?? DEFAULT_MODEL };
}

/** @deprecated Legacy full-context stream */
export async function streamChatWithMistral({ messages, context, apiKey: apiKeyInput, onChunk }) {
  const apiKey = resolveApiKey(apiKeyInput);
  const { mistralMessages } = buildMistralMessages({ messages, context, useTools: false });

  const res = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: mistralMessages,
      temperature: 0.1,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    await readMistralError(res, text);
  }

  if (!res.body) throw new Error("Mistral returned an empty stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let model = DEFAULT_MODEL;
  let answer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = parseSseLines(buffer, (payload) => {
      try {
        const parsed = JSON.parse(payload);
        if (parsed?.model) model = parsed.model;
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length) {
          answer += delta;
          onChunk(delta);
        }
      } catch {
        /* ignore malformed chunks */
      }
    });
  }

  if (!answer.trim()) throw new Error("Mistral returned an empty response");
  return { answer: answer.trim(), model };
}
