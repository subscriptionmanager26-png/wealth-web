import type { MunshiLearning, MunshiRule } from "./munshiMemoryTypes";
import { memoryListDaySummaries, memoryListLearnings, memoryListRules, memoryTouchUsage } from "./munshiMemoryDb";

const MAX_RULES_INJECT = 12;
const MAX_LEARNINGS_INJECT = 5;
const MAX_DAY_SUMMARIES_INJECT = 2;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function relevanceScore(queryTokens: Set<string>, text: string): number {
  const target = tokenize(text);
  if (!target.size) return 0;
  let hits = 0;
  for (const t of queryTokens) {
    if (target.has(t)) hits += 1;
  }
  return hits / Math.sqrt(target.size);
}

export type RetrievedMemory = {
  rules: MunshiRule[];
  learnings: MunshiLearning[];
  daySummaries: { date: string; summary: string }[];
};

export async function retrieveMemoryForQuestion(question: string): Promise<RetrievedMemory> {
  const q = question.trim();
  const queryTokens = tokenize(q);

  const [allRules, allLearnings, allDaySummaries] = await Promise.all([
    memoryListRules(true),
    memoryListLearnings(true),
    memoryListDaySummaries(),
  ]);

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const rules = [...allRules]
    .sort((a, b) => {
      const rel = relevanceScore(queryTokens, b.text) - relevanceScore(queryTokens, a.text);
      if (Math.abs(rel) > 0.01) return rel;
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, MAX_RULES_INJECT);

  const learnings = [...allLearnings]
    .sort((a, b) => {
      const rel = relevanceScore(queryTokens, b.text) - relevanceScore(queryTokens, a.text);
      if (Math.abs(rel) > 0.01) return rel;
      return b.confidence - a.confidence;
    })
    .slice(0, MAX_LEARNINGS_INJECT);

  const daySummaries = allDaySummaries
    .map((d) => ({ date: d.date, summary: d.summary, score: relevanceScore(queryTokens, d.summary) }))
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))
    .slice(0, MAX_DAY_SUMMARIES_INJECT)
    .map(({ date, summary }) => ({ date, summary }));

  void memoryTouchUsage({
    ruleIds: rules.map((r) => r.id),
    learningIds: learnings.map((l) => l.id),
  });

  return { rules, learnings, daySummaries };
}

export function buildMemoryContextBlock(memory: RetrievedMemory): string {
  const parts: string[] = [];

  if (memory.rules.length) {
    parts.push(
      "### Rules (must follow; portfolio tool results override memory if they conflict)\n" +
        memory.rules.map((r) => `- [${r.priority}] ${r.text}`).join("\n"),
    );
  }

  if (memory.learnings.length) {
    parts.push(
      "### Learnings (preferences and patterns — hints only)\n" +
        memory.learnings.map((l) => `- ${l.text}`).join("\n"),
    );
  }

  if (memory.daySummaries.length) {
    parts.push(
      "### Recent conversation context\n" +
        memory.daySummaries.map((d) => `- **${d.date}**: ${d.summary}`).join("\n"),
    );
  }

  return parts.join("\n\n");
}

export async function buildMemoryContextForQuestion(question: string): Promise<string> {
  const memory = await retrieveMemoryForQuestion(question);
  return buildMemoryContextBlock(memory);
}
