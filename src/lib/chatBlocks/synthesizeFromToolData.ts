import type { AnswerTemplate } from "./answerTemplates";
import { buildTemplateBlocks, defaultTemplateForTools } from "./answerTemplates";
import type { Block } from "./types";
import type { PortfolioSnapshot } from "../portfolioTools/types";
import type { ToolDataStore } from "../portfolioTools/toolData";
import { hydrateToolDataFromSnapshot } from "../portfolioTools/hydrateToolData";

const NARRATIVE_TYPES = new Set<Block["type"]>([
  "text",
  "heading",
  "callout",
  "stat",
  "badge",
  "recommendationCard",
  "prosCons",
  "actionChecklist",
  "assumptions",
  "risks",
  "sources",
  "followUpQuestions",
  "infoCard",
  "bulletList",
  "decisionMatrix",
  "scenarioComparison",
]);

export function extractNarrativeBlocks(blocks: Block[]): Block[] {
  return blocks.filter((block) => NARRATIVE_TYPES.has(block.type));
}

function withHydration(snapshot: PortfolioSnapshot | undefined, store: ToolDataStore): ToolDataStore {
  return snapshot ? hydrateToolDataFromSnapshot(snapshot, store) : store;
}

/** Merge LLM narrative + template slot layout filled from toolData. */
export function mergeBlocksWithToolData(
  llmBlocks: Block[] | null,
  store: ToolDataStore,
  template?: AnswerTemplate,
  snapshot?: PortfolioSnapshot,
): Block[] {
  const hydrated = withHydration(snapshot, store);
  const resolvedTemplate = template ?? defaultTemplateForTools(hydrated);
  const narrative = llmBlocks ? extractNarrativeBlocks(llmBlocks) : [];
  return buildTemplateBlocks(resolvedTemplate, hydrated, narrative);
}

export function synthesizeBlocksFromToolData(
  store: ToolDataStore,
  introText?: string,
  template?: AnswerTemplate,
  snapshot?: PortfolioSnapshot,
): Block[] {
  const hydrated = withHydration(snapshot, store);
  const intro: Block[] = introText?.trim() ? [{ type: "text", text: introText.trim() }] : [];
  return buildTemplateBlocks(template ?? defaultTemplateForTools(hydrated), hydrated, intro);
}

export function hasRenderableToolData(store: ToolDataStore): boolean {
  return Boolean(
    store.portfolioSummary ||
      store.periodReturns ||
      store.benchmarkComparison ||
      store.holdings ||
      store.allocation ||
      store.sectorExposure ||
      store.riskMetrics ||
      store.performanceSeries ||
      store.diversification ||
      (store.fundDetails?.length ?? 0) > 0,
  );
}

export type { AnswerTemplate };
