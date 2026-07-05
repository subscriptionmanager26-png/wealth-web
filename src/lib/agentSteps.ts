export type AgentStepStatus = "running" | "done" | "error";

export type AgentStepKind = "think" | "tool" | "write";

export type AgentStep = {
  id: string;
  kind: AgentStepKind;
  status: AgentStepStatus;
  label: string;
  detail?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  startedAt?: number;
  endedAt?: number;
  /** Wall time waiting on /api/portfolio/chat (mostly Mistral + Vercel). */
  apiMs?: number;
  /** Extra delay we add for step animation / min duration. */
  uiPaddingMs?: number;
};

const TOOL_LABELS: Record<string, string> = {
  list_available_data: "list_available_data",
  get_portfolio_summary: "get_portfolio_summary",
  get_portfolio_performance: "get_portfolio_performance",
  get_benchmark_comparison: "get_benchmark_comparison",
  list_benchmark_indices: "list_benchmark_indices",
  get_benchmark_returns: "get_benchmark_returns",
  get_asset_allocation: "get_asset_allocation",
  get_portfolio_fundamentals: "get_portfolio_fundamentals",
  get_holdings: "get_holdings",
  get_best_worst_funds: "get_best_worst_funds",
  get_fund_details: "get_fund_details",
  search_market_funds: "search_market_funds",
  get_market_fund_details: "get_market_fund_details",
  get_sector_exposure: "get_sector_exposure",
  get_stock_exposure: "get_stock_exposure",
  get_year_wise_returns: "get_year_wise_returns",
  get_risk_metrics: "get_risk_metrics",
};

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  list_available_data: "Check what portfolio data is loaded",
  get_portfolio_summary: "Read portfolio value, gain, and XIRR",
  get_portfolio_performance: "Read NAV-based returns",
  get_benchmark_comparison: "Compare portfolio vs index",
  list_benchmark_indices: "List Nifty TRI indices available",
  get_benchmark_returns: "Read index returns only",
  get_asset_allocation: "Read equity vs debt allocation",
  get_portfolio_fundamentals: "Read weighted TER, P/E, P/B",
  get_holdings: "Read fund holdings and weights",
  get_best_worst_funds: "Rank funds by performance",
  get_fund_details: "Read portfolio fund facts",
  search_market_funds: "Search screener fund universe",
  get_market_fund_details: "Read screener fund facts",
  get_sector_exposure: "Read sector look-through",
  get_stock_exposure: "Read stock look-through",
  get_year_wise_returns: "Read calendar year returns",
  get_risk_metrics: "Read Sharpe, volatility, drawdown",
};

export function newStepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function toolStepLabel(toolName: string, args: Record<string, unknown>): { label: string; detail?: string } {
  const label = TOOL_LABELS[toolName] ?? toolName;
  const parts: string[] = [];

  if (toolName === "get_benchmark_comparison") {
    const bench = typeof args.benchmark_id === "string" ? args.benchmark_id : "nifty500";
    parts.push(bench);
    if (Array.isArray(args.frames) && args.frames.length) parts.push(args.frames.join(", "));
  }
  if (toolName === "get_holdings") {
    if (args.sort_by) parts.push(`sort=${args.sort_by}`);
    if (args.limit) parts.push(`limit=${args.limit}`);
    if (args.asset_class) parts.push(String(args.asset_class));
  }
  if (toolName === "get_fund_details") {
    if (args.fund_name_query) parts.push(`query="${args.fund_name_query}"`);
    else if (args.rank_by_weight) parts.push(`rank=${args.rank_by_weight}`);
  }
  if (toolName === "get_sector_exposure" && args.sector_query) parts.push(String(args.sector_query));
  if (toolName === "get_stock_exposure" && args.stock_query) parts.push(String(args.stock_query));
  if (toolName === "get_best_worst_funds" && args.mode) parts.push(String(args.mode));

  const description = TOOL_DESCRIPTIONS[toolName];
  return {
    label,
    detail: parts.length ? parts.join(" · ") : description,
  };
}

export function patchStep(steps: AgentStep[], id: string, patch: Partial<AgentStep>): AgentStep[] {
  return steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

export function completeRunningSteps(steps: AgentStep[]): AgentStep[] {
  const now = Date.now();
  return steps.map((s) =>
    s.status === "running" ? { ...s, status: "done" as const, endedAt: now } : s,
  );
}

export function activitySummary(steps: AgentStep[]): string {
  const running = steps.find((s) => s.status === "running");
  if (running) {
    if (running.kind === "tool") return `Calling ${running.label}…`;
    if (running.kind === "write") return "Writing response…";
    return "Thinking…";
  }
  const toolCount = steps.filter((s) => s.kind === "tool" && s.status === "done").length;
  const thinkMs = steps
    .filter((s) => s.kind === "think" && s.startedAt && s.endedAt)
    .reduce((sum, s) => sum + (s.endedAt! - s.startedAt!), 0);
  const secs = thinkMs > 0 ? Math.max(1, Math.round(thinkMs / 1000)) : null;
  if (toolCount > 0) {
    return secs ? `Used ${toolCount} tool${toolCount === 1 ? "" : "s"} · ${secs}s` : `Used ${toolCount} tool${toolCount === 1 ? "" : "s"}`;
  }
  return secs ? `Thought for ${secs}s` : "Done";
}

/** Let React paint between step updates. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

const MIN_THINK_WRITE_MS = 120;
export const MIN_TOOL_MS = 0;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureMinStepDuration(startedAt: number, minMs = MIN_THINK_WRITE_MS): Promise<void> {
  if (minMs <= 0) return;
  const elapsed = Date.now() - startedAt;
  if (elapsed < minMs) await sleep(minMs - elapsed);
}

export async function pauseBetweenSteps(): Promise<void> {
  await sleep(40);
}
