import type { Block } from "./types";
import type { ToolDataStore } from "../portfolioTools/toolData";
import { filterRenderableBlocks, summaryStatBlocks } from "./blockFilters";

/** 15 reusable answer templates — AI picks template, design system fills slots. */
export const ANSWER_TEMPLATES = [
  "dashboard",
  "companyAnalysis",
  "portfolioAnalysis",
  "comparison",
  "recommendation",
  "planning",
  "newsSummary",
  "educational",
  "timeline",
  "calculator",
  "riskAssessment",
  "goalTracker",
  "taxReview",
  "scenarioAnalysis",
  "actionPlan",
] as const;

export type AnswerTemplate = (typeof ANSWER_TEMPLATES)[number];

export function isAnswerTemplate(v: unknown): v is AnswerTemplate {
  return typeof v === "string" && (ANSWER_TEMPLATES as readonly string[]).includes(v);
}

function narrative(blocks: Block[]): Block[] {
  return blocks.filter((b) =>
    ["text", "heading", "callout", "badge", "recommendationCard", "prosCons", "actionChecklist", "assumptions", "risks", "sources", "followUpQuestions"].includes(
      b.type,
    ),
  );
}

function slotHeading(title: string): Block {
  return { type: "heading", level: 2, text: title };
}

function pushGrid(blocks: Block[], columns: 1 | 2 | 3, children: Block[]) {
  const filtered = children.filter(Boolean);
  if (!filtered.length) return;
  if (filtered.length === 1) {
    blocks.push(filtered[0]!);
    return;
  }
  blocks.push({ type: "grid", columns, children: filtered });
}

/** Deterministic slot layout per template — widgets from toolData, narrative from LLM. */
export function buildTemplateBlocks(
  template: AnswerTemplate,
  store: ToolDataStore,
  llmBlocks: Block[] = [],
): Block[] {
  const intro = narrative(llmBlocks);
  const blocks: Block[] = [...intro];

  switch (template) {
    case "dashboard":
      if (!intro.length) blocks.push(slotHeading("Portfolio overview"));
      if (store.portfolioSummary) blocks.push({ type: "portfolioSummary" });
      if (!store.periodReturns?.rows.length && store.portfolioSummary) {
        pushGrid(blocks, 2, summaryStatBlocks(store));
      }
      pushGrid(blocks, 2, [
        ...(store.periodReturns?.rows.length ? [{ type: "periodReturns" as const }] : []),
        ...(store.benchmarkComparison?.rows.length ? [{ type: "benchmarkComparison" as const }] : []),
        ...(store.diversification ? [{ type: "diversificationScore" as const }] : []),
        ...(store.riskMetrics ? [{ type: "riskMeter" as const }] : []),
      ]);
      if (store.performanceSeries?.points.length) blocks.push({ type: "performanceChart" });
      if (store.allocation?.slices.length) blocks.push({ type: "allocationPie" });
      if (store.holdings?.rows.length) blocks.push({ type: "holdingsTable", limit: 8 });
      if (!intro.some((b) => b.type === "followUpQuestions")) {
        blocks.push({ type: "followUpQuestions", items: ["Show top performers", "Compare vs Nifty 500", "What's my risk?"] });
      }
      break;

    case "companyAnalysis":
      if (!intro.length) blocks.push(slotHeading("Fund analysis"));
      if (store.fundDetails?.length) {
        for (let i = 0; i < Math.min(store.fundDetails.length, 2); i += 1) {
          blocks.push({ type: "fundCard", rank: i + 1 });
        }
      } else {
        blocks.push({ type: "stockCard" });
      }
      if (store.performanceSeries) blocks.push({ type: "priceChart" });
      if (store.periodReturns) blocks.push({ type: "returnsTable" });
      blocks.push({ type: "newsFeed" });
      break;

    case "portfolioAnalysis":
      if (!intro.length) blocks.push(slotHeading("Portfolio analysis"));
      if (store.periodReturns) blocks.push({ type: "periodReturns" });
      if (store.performanceSeries) blocks.push({ type: "performanceChart" });
      if (store.allocation) blocks.push({ type: "allocationPie" });
      if (store.sectorExposure) blocks.push({ type: "sectorExposure", limit: 10 });
      if (store.holdings) blocks.push({ type: "holdingsTable", limit: 10 });
      break;

    case "comparison":
      if (!intro.length) blocks.push(slotHeading("Comparison"));
      blocks.push({
        type: "compareHeader",
        leftLabel: "Your portfolio",
        rightLabel: store.benchmarkComparison?.benchmarkLabel ?? "Benchmark",
      });
      pushGrid(blocks, 2, [
        ...(store.periodReturns ? [{ type: "barChart" as const, variant: "returns" as const }] : []),
        ...(store.benchmarkComparison ? [{ type: "barChart" as const, variant: "comparison" as const }] : []),
      ]);
      if (store.benchmarkComparison?.rows.length) blocks.push({ type: "benchmarkComparison" });
      break;

    case "recommendation":
      if (!intro.length) {
        blocks.push({
          type: "recommendationCard",
          title: "Recommendation",
          body: "Review the details below based on your portfolio data.",
        });
      }
      if (store.holdings?.rows.length) blocks.push({ type: "holdingsTable", limit: 5 });
      if (!intro.some((b) => b.type === "actionChecklist")) {
        blocks.push({ type: "actionChecklist", items: [{ id: "1", text: "Review holdings" }] });
      }
      blocks.push({ type: "risks", items: ["Past performance does not guarantee future results."] });
      break;

    case "planning":
      if (!intro.length) blocks.push(slotHeading("Financial plan"));
      blocks.push({ type: "goalTracker" });
      blocks.push({ type: "progressRing", label: "Goal progress", value: 42 });
      blocks.push({ type: "retirementProjection" });
      blocks.push({ type: "actionChecklist", items: [{ id: "1", text: "Define your target amount" }] });
      break;

    case "newsSummary":
      if (!intro.length) blocks.push(slotHeading("News & events"));
      blocks.push({ type: "newsFeed" });
      break;

    case "educational":
      if (!intro.length) blocks.push(slotHeading("Explainer"));
      if (!intro.some((b) => b.type === "infoCard")) {
        blocks.push({ type: "infoCard", title: "Overview", body: "Key concepts for this topic." });
      }
      break;

    case "timeline":
      if (!intro.length) blocks.push(slotHeading("Timeline"));
      if (store.performanceSeries?.points.length) blocks.push({ type: "portfolioTimeline" });
      break;

    case "calculator":
      if (!intro.length) blocks.push(slotHeading("Calculator"));
      blocks.push({ type: "sipCalculator" });
      blocks.push({ type: "metricCard", label: "Estimated corpus", value: "—", sublabel: "Adjust inputs in chat" });
      break;

    case "riskAssessment":
      if (!intro.length) blocks.push(slotHeading("Risk assessment"));
      if (store.riskMetrics) blocks.push({ type: "riskMeter" });
      if (store.riskMetrics?.volatility != null) {
        blocks.push({ type: "gaugeChart", metric: "volatility", label: "Volatility" });
      }
      if (store.sectorExposure?.rows.length) blocks.push({ type: "pieChart", variant: "sector" });
      if (store.allocation?.slices.length) blocks.push({ type: "pieChart", variant: "allocation" });
      if (store.diversification) blocks.push({ type: "diversificationScore" });
      if (store.performanceSeries?.points.length) blocks.push({ type: "performanceChart" });
      break;

    case "goalTracker":
      if (!intro.length) blocks.push(slotHeading("Goals"));
      blocks.push({ type: "goalTracker" });
      blocks.push({ type: "progressRing", label: "Savings progress", value: 35 });
      blocks.push({ type: "actionPlan" });
      break;

    case "taxReview":
      if (!intro.length) blocks.push(slotHeading("Tax review"));
      blocks.push({ type: "taxSummary" });
      blocks.push({ type: "actionChecklist", items: [{ id: "1", text: "Review capital gains with your CA" }] });
      break;

    case "scenarioAnalysis":
      if (!intro.length) blocks.push(slotHeading("Scenarios"));
      if (store.benchmarkComparison?.rows.length) blocks.push({ type: "benchmarkComparison" });
      blocks.push({ type: "assumptions", items: ["Projections use historical returns"] });
      break;

    case "actionPlan":
      if (!intro.length) blocks.push(slotHeading("Action plan"));
      blocks.push({ type: "actionChecklist", items: [{ id: "1", text: "Review next steps" }] });
      if (store.holdings) blocks.push({ type: "holdingsTable", limit: 5 });
      blocks.push({ type: "followUpQuestions", items: ["What should I sell?", "How to rebalance?"] });
      break;

    default:
      break;
  }

  return filterRenderableBlocks(blocks, store);
}

export function defaultTemplateForTools(store: ToolDataStore): AnswerTemplate {
  if (store.benchmarkComparison) return "comparison";
  if (store.riskMetrics) return "riskAssessment";
  if (store.fundDetails?.length) return "companyAnalysis";
  if (store.periodReturns || store.performanceSeries) return "portfolioAnalysis";
  if (store.portfolioSummary) return "dashboard";
  return "dashboard";
}
