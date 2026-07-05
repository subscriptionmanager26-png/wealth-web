import { postChatRequest } from "./chatApiRoute";
import type { PortfolioSnapshot } from "./portfolioTools";
import {
  approvalFieldsToArgs,
  buildToolApprovalFields,
  refreshDerivedFields,
} from "./toolInputApproval";

const VALID_TOOLS = new Set([
  "list_available_data",
  "get_portfolio_summary",
  "get_portfolio_performance",
  "list_benchmark_indices",
  "get_benchmark_returns",
  "get_benchmark_comparison",
  "search_market_funds",
  "get_market_fund_details",
  "get_asset_allocation",
  "get_portfolio_fundamentals",
  "get_holdings",
  "get_best_worst_funds",
  "get_fund_details",
  "get_sector_exposure",
  "get_stock_exposure",
  "get_year_wise_returns",
  "get_risk_metrics",
]);

const FRAME_TOKENS = ["MTD", "YTD", "1M", "3M", "6M", "1Y", "3Y", "5Y", "Max"] as const;
const BENCHMARK_ALIASES: Record<string, string> = {
  nifty50: "nifty50",
  "nifty 50": "nifty50",
  nifty500: "nifty500",
  "nifty 500": "nifty500",
  nifty100: "nifty100",
  "nifty 100": "nifty100",
  nifty_midcap_100: "nifty_midcap_100",
  midcap: "nifty_midcap_100",
};

const PLANNING_SYSTEM = `You plan which portfolio tools Munshi Ji must call to answer the user. Output ONLY valid JSON (no markdown fences).

{
  "planSummary": "One plain-language sentence on what you will fetch",
  "tools": [{ "name": "tool_name", "arguments": { } }],
  "questions": [{
    "id": "short_id",
    "question": "Plain-language question the user can answer without jargon",
    "options": [
      { "id": "opt1", "label": "Most likely choice in everyday words (rank first)", "patches": { "frames": ["1Y"] } }
    ],
    "customArgHint": { "key": "frames", "type": "frames" }
  }]
}

## Input verification (mandatory)
Before finalizing tools[], mentally walk through EVERY parameter each tool needs (time period, benchmark, sort order, filters, limits, fund names, etc.).
- If the user's question does not clearly specify a value, you MUST ask a clarifying question for it.
- Do not leave ambiguous parameters on "best guess" when the answer would materially change.
- Club related simple inputs into ONE question when natural (e.g. "Which period and benchmark?" with options that set both frames and benchmark_id).
- Split into SEPARATE questions when a topic is complex or options would be confusing if combined.
- Questions are shown ONE AT A TIME to the user — write each question so it stands alone and is easy to understand.
- Use everyday language: say "last 1 year" not "1Y frame"; say "Nifty 500 index" not "nifty500 TRI".

## Options
- 1 to 3 options per question (maximum 3). Use fewer when only one or two choices are realistic.
- Rank options most likely first. Labels must be specific and human-readable — no internal codes unless the user used them.
- patches: global arg { "frames": ["1Y"] } for all tools that accept it, OR per-tool { "get_benchmark_comparison": { "benchmark_id": "nifty500" } }.
- customArgHint tells the app how to parse free-text (types: frames, benchmark_id, text, number, return_mode).

## Tools
- List every tool needed upfront in tools[] with your best-guess arguments (defaults for anything you will ask about).
- Valid tool names: list_available_data, get_portfolio_summary, get_portfolio_performance, list_benchmark_indices, get_benchmark_returns, get_benchmark_comparison, search_market_funds, get_market_fund_details, get_asset_allocation, get_portfolio_fundamentals, get_holdings, get_best_worst_funds, get_fund_details, get_sector_exposure, get_stock_exposure, get_year_wise_returns, get_risk_metrics.
- If nothing needs clarification, return questions: [].
- Do not invent portfolio numbers — only choose tools and parameter values.`;

export type ClarifyingOption = {
  id: string;
  label: string;
  patches: Record<string, unknown>;
};

export type CustomArgHint = {
  key: string;
  type: "frames" | "benchmark_id" | "text" | "number" | "return_mode";
};

export type ClarifyingQuestion = {
  id: string;
  question: string;
  options: ClarifyingOption[];
  customArgHint?: CustomArgHint;
};

export type PlannedTool = {
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentPlan = {
  planSummary: string;
  tools: PlannedTool[];
  questions: ClarifyingQuestion[];
};

export type ClarificationAnswer = {
  optionId?: string;
  customText?: string;
};

export type ClarificationAnswers = Record<string, ClarificationAnswer>;

export type ClarificationRequest = {
  plan: AgentPlan;
  userQuestion: string;
};

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizePlan(raw: unknown): AgentPlan | null {
  if (!isRecord(raw)) return null;
  const toolsRaw = Array.isArray(raw.tools) ? raw.tools : [];
  const tools: PlannedTool[] = toolsRaw
    .map((t) => {
      if (!isRecord(t) || typeof t.name !== "string") return null;
      if (!VALID_TOOLS.has(t.name)) return null;
      const args = isRecord(t.arguments) ? t.arguments : {};
      return { name: t.name, arguments: args };
    })
    .filter((t): t is PlannedTool => t !== null);

  const questionsRaw = Array.isArray(raw.questions) ? raw.questions : [];
  const questions: ClarifyingQuestion[] = questionsRaw
    .map((q) => {
      if (!isRecord(q) || typeof q.id !== "string" || typeof q.question !== "string") return null;
      const optionsRaw = Array.isArray(q.options) ? q.options.slice(0, 3) : [];
      const options: ClarifyingOption[] = optionsRaw
        .map((o, idx) => {
          if (!isRecord(o)) return null;
          const id = typeof o.id === "string" ? o.id : `opt${idx + 1}`;
          const label = typeof o.label === "string" ? o.label.trim() : "";
          const patches = isRecord(o.patches) ? o.patches : {};
          if (!label) return null;
          return { id, label, patches };
        })
        .filter((o): o is ClarifyingOption => o !== null);
      if (!options.length) return null;
      let customArgHint: CustomArgHint | undefined;
      if (isRecord(q.customArgHint) && typeof q.customArgHint.key === "string") {
        const type = q.customArgHint.type;
        if (
          type === "frames" ||
          type === "benchmark_id" ||
          type === "text" ||
          type === "number" ||
          type === "return_mode"
        ) {
          customArgHint = { key: q.customArgHint.key, type };
        }
      }
      return { id: q.id, question: q.question.trim(), options, customArgHint };
    })
    .filter((q): q is ClarifyingQuestion => q !== null);

  const planSummary = typeof raw.planSummary === "string" ? raw.planSummary.trim() : "Fetching portfolio data";
  if (!tools.length) return null;
  return { planSummary, tools, questions };
}

export function buildSnapshotSummary(snapshot: PortfolioSnapshot): string {
  const lines: string[] = [];
  lines.push(`Holdings: ${snapshot.holdings?.length ?? 0}`);
  if (snapshot.hero) {
    lines.push(`Portfolio value: ₹${Math.round(snapshot.hero.total).toLocaleString("en-IN")}`);
  }
  const benchIds = Object.keys(snapshot.benchmarkMonthEnds ?? {}).filter(
    (k) => (snapshot.benchmarkMonthEnds?.[k as keyof typeof snapshot.benchmarkMonthEnds]?.length ?? 0) > 0,
  );
  lines.push(`Benchmarks loaded: ${benchIds.length ? benchIds.join(", ") : "none"}`);
  lines.push(`NAV series: ${snapshot.perf?.points?.length ? "yes" : "no"}`);
  lines.push(`Look-through: ${snapshot.sectorRows?.length ? "sectors yes" : "sectors no"}, ${snapshot.stockRows?.length ? "stocks yes" : "stocks no"}`);
  return lines.join("\n");
}

export async function fetchAgentPlan(
  userQuestion: string,
  snapshot: PortfolioSnapshot,
  history: { role: string; content: string }[],
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<AgentPlan | null> {
  const historyBlock = history
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
    .join("\n");

  const userContent = `User question: ${userQuestion.trim()}

Portfolio context:
${buildSnapshotSummary(snapshot)}

Recent chat:
${historyBlock || "(none)"}`;

  const res = await postChatRequest(
    { memoryExtract: true, systemPrompt: PLANNING_SYSTEM, userContent, stream: false, apiKey },
    apiKey,
    signal,
  );
  const data = (await res.json().catch(() => ({}))) as { content?: string; error?: string };
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : `Planning failed (${res.status})`);
  }
  const parsed = parseJsonObject<unknown>(String(data.content ?? ""));
  return normalizePlan(parsed);
}

function isToolSpecificPatch(patches: Record<string, unknown>): boolean {
  return Object.keys(patches).some((k) => VALID_TOOLS.has(k));
}

function mergePatchesIntoTool(
  tool: PlannedTool,
  patches: Record<string, unknown>,
): PlannedTool {
  if (!Object.keys(patches).length) return tool;
  if (isToolSpecificPatch(patches)) {
    const toolPatch = patches[tool.name];
    if (!isRecord(toolPatch)) return tool;
    return { ...tool, arguments: { ...tool.arguments, ...toolPatch } };
  }
  const merged = { ...tool.arguments };
  for (const [key, value] of Object.entries(patches)) {
    if (VALID_TOOLS.has(key)) continue;
    merged[key] = value;
  }
  return { ...tool, arguments: merged };
}

function parseFramesFromText(text: string): string[] | null {
  const upper = text.trim().toUpperCase();
  const direct = FRAME_TOKENS.find((f) => f.toUpperCase() === upper);
  if (direct) return [direct];
  const found = FRAME_TOKENS.filter((f) => upper.includes(f.toUpperCase()));
  return found.length ? [...found] : null;
}

function parseBenchmarkFromText(text: string): string | null {
  const lower = text.trim().toLowerCase();
  for (const [alias, id] of Object.entries(BENCHMARK_ALIASES)) {
    if (lower.includes(alias)) return id;
  }
  if (/^nifty[_a-z0-9]+$/i.test(lower.replace(/\s+/g, "_"))) return lower.replace(/\s+/g, "_");
  return null;
}

function patchesFromCustomText(question: ClarifyingQuestion, text: string): Record<string, unknown> {
  const hint = question.customArgHint;
  const trimmed = text.trim();
  if (!trimmed || !hint) return { [hint?.key ?? "query"]: trimmed };

  switch (hint.type) {
    case "frames": {
      const frames = parseFramesFromText(trimmed);
      return frames ? { [hint.key]: frames } : { [hint.key]: [trimmed] };
    }
    case "benchmark_id": {
      const id = parseBenchmarkFromText(trimmed);
      return { [hint.key]: id ?? trimmed };
    }
    case "number": {
      const n = Number(trimmed);
      return Number.isFinite(n) ? { [hint.key]: n } : { [hint.key]: trimmed };
    }
    case "return_mode":
      return { [hint.key]: trimmed.toLowerCase() };
    default:
      return { [hint.key]: trimmed };
  }
}

export function applyClarificationAnswers(plan: AgentPlan, answers: ClarificationAnswers): PlannedTool[] {
  let tools = plan.tools.map((t) => ({ ...t, arguments: { ...t.arguments } }));

  for (const question of plan.questions) {
    const answer = answers[question.id];
    if (!answer) continue;

    let patches: Record<string, unknown> = {};
    if (answer.optionId) {
      const opt = question.options.find((o) => o.id === answer.optionId);
      if (opt) patches = opt.patches;
    } else if (answer.customText?.trim()) {
      patches = patchesFromCustomText(question, answer.customText);
    }

    tools = tools.map((t) => mergePatchesIntoTool(t, patches));
  }

  return tools;
}

export function enrichPlannedToolArgs(
  tool: PlannedTool,
  snapshot: PortfolioSnapshot,
): Record<string, unknown> {
  const fields = buildToolApprovalFields(tool.name, tool.arguments, snapshot);
  const refreshed = refreshDerivedFields(tool.name, fields, snapshot);
  return approvalFieldsToArgs(tool.name, refreshed);
}

export function defaultClarificationAnswers(plan: AgentPlan): ClarificationAnswers {
  const answers: ClarificationAnswers = {};
  for (const q of plan.questions) {
    if (q.options[0]) {
      answers[q.id] = { optionId: q.options[0].id };
    }
  }
  return answers;
}
