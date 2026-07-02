import { postChatRequest } from "./chatApiRoute";
import type { MemoryExtractionResult } from "./munshiMemoryTypes";

const EXTRACTION_SYSTEM = `You extract structured memory from Munshi Ji portfolio chat transcripts.

Output ONLY valid JSON (no markdown fences) with this shape:
{
  "daySummary": "2-4 sentence summary of what was discussed (no names, PAN, folio, email, phone)",
  "learnings": [{ "text": "soft preference or pattern", "confidence": 0.0-1.0 }],
  "rules": [{ "text": "behavioral rule for the assistant", "priority": "high"|"medium"|"low" }]
}

Guidelines:
- daySummary: factual recap of topics (performance, allocation, benchmarks, funds, metrics).
- learnings: user preferences (formatting, metrics they care about, recurring questions). Not portfolio numbers.
- rules: how the assistant should behave to avoid past mistakes (e.g. distinguish XIRR vs fund CAGR).
- Only include learnings/rules that are actionable and supported by the conversation.
- If the user corrected the assistant, capture that as a high-priority rule.
- Never include personal identifiers.
- If nothing useful, return empty arrays and a brief daySummary.`;

const CONSOLIDATION_SYSTEM = `You consolidate Munshi Ji memory lists by merging duplicates and removing contradictions.

Output ONLY valid JSON:
{
  "learnings": [{ "text": "...", "confidence": 0.0-1.0 }],
  "rules": [{ "text": "...", "priority": "high"|"medium"|"low" }]
}

Keep the most useful items. Prefer newer user corrections. Max 40 learnings and 25 rules. No personal identifiers.`;

function parseJsonObject<T>(raw: string): T | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

export async function callMemoryLlm(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await postChatRequest(
    {
      memoryExtract: true,
      systemPrompt,
      userContent,
      stream: false,
      apiKey,
    },
    apiKey,
    signal,
  );
  const data = (await res.json().catch(() => ({}))) as { content?: string; error?: string };
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : `Memory LLM failed (${res.status})`);
  }
  return String(data.content ?? "").trim();
}

export async function extractMemoryFromConversation(
  conversation: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<MemoryExtractionResult> {
  const content = await callMemoryLlm(
    EXTRACTION_SYSTEM,
    `Conversation:\n\n${conversation.slice(0, 24_000)}`,
    apiKey,
    signal,
  );
  const parsed = parseJsonObject<MemoryExtractionResult>(content);
  if (!parsed) {
    return { daySummary: "", learnings: [], rules: [] };
  }
  return {
    daySummary: String(parsed.daySummary ?? "").trim(),
    learnings: Array.isArray(parsed.learnings)
      ? parsed.learnings
          .filter((l) => l?.text?.trim())
          .map((l) => ({
            text: String(l.text).trim(),
            confidence: Number(l.confidence) || 0.5,
          }))
      : [],
    rules: Array.isArray(parsed.rules)
      ? parsed.rules
          .filter((r) => r?.text?.trim())
          .map((r) => ({
            text: String(r.text).trim(),
            priority: (["high", "medium", "low"].includes(r.priority) ? r.priority : "medium") as
              | "high"
              | "medium"
              | "low",
          }))
      : [],
  };
}

export async function consolidateMemoryLists(
  learnings: { text: string; confidence: number }[],
  rules: { text: string; priority: "high" | "medium" | "low" }[],
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ learnings: typeof learnings; rules: typeof rules }> {
  const payload = JSON.stringify({ learnings, rules }, null, 2);
  const content = await callMemoryLlm(
    CONSOLIDATION_SYSTEM,
    `Merge and deduplicate these lists:\n\n${payload.slice(0, 20_000)}`,
    apiKey,
    signal,
  );
  const parsed = parseJsonObject<{ learnings?: typeof learnings; rules?: typeof rules }>(content);
  if (!parsed) return { learnings, rules };
  return {
    learnings: Array.isArray(parsed.learnings) ? parsed.learnings : learnings,
    rules: Array.isArray(parsed.rules) ? parsed.rules : rules,
  };
}
