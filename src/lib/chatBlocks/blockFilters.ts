import type { Block } from "./types";
import type { ToolDataStore } from "../portfolioTools/toolData";
import { formatInr, formatPct } from "../portfolioTools/toolData";

/** Blocks that need toolData — skip when data is missing. */
export function blockCanRender(block: Block, store: ToolDataStore): boolean {
  switch (block.type) {
    case "portfolioSummary":
      return Boolean(store.portfolioSummary);
    case "periodReturns":
      return Boolean(store.periodReturns?.rows.length);
    case "benchmarkComparison":
      return Boolean(store.benchmarkComparison?.rows.length);
    case "holdingsTable":
      return Boolean(store.holdings?.rows.length);
    case "allocation":
    case "allocationPie":
      return Boolean(store.allocation?.slices.length);
    case "fundCard":
      return Boolean(store.fundDetails?.length);
    case "sectorExposure":
    case "pieChart":
      if (block.type === "pieChart" && block.variant === "sector") {
        return Boolean(store.sectorExposure?.rows.length);
      }
      return block.type === "sectorExposure" ? Boolean(store.sectorExposure?.rows.length) : Boolean(store.allocation?.slices.length);
    case "performanceChart":
    case "lineChart":
    case "priceChart":
    case "portfolioTimeline":
      return Boolean(store.performanceSeries?.points.length);
    case "returnsTable":
    case "barChart":
      if (block.type === "barChart" && block.variant === "comparison") {
        return Boolean(store.benchmarkComparison?.rows.length);
      }
      return Boolean(store.periodReturns?.rows.length);
    case "diversificationScore":
      return Boolean(store.diversification);
    case "riskMeter":
    case "gaugeChart":
      return Boolean(store.riskMetrics);
    case "bulletList":
      return block.items.length > 0;
    case "table":
      return block.rows.length > 0 && block.columns.length > 0;
    case "timeline":
      return block.events.length > 0;
    case "prosCons":
      return block.pros.some((p) => p.trim()) || block.cons.some((c) => c.trim());
    case "actionChecklist":
      return block.items.length > 0;
    case "decisionMatrix":
      return block.rows.length > 0;
    case "scenarioComparison":
      return block.scenarios.length > 0;
    case "assumptions":
    case "risks":
    case "sources":
      return block.items.length > 0;
    case "recommendationCard":
      return Boolean(block.title?.trim() && block.body?.trim());
    case "infoCard":
      return Boolean(block.title?.trim() && block.body?.trim());
    case "metricCard":
      return Boolean(block.label?.trim() && block.value?.trim() && block.value !== "—");
    case "text":
      return Boolean(block.text?.trim());
    case "heading":
      return Boolean(block.text?.trim());
    case "callout":
      return Boolean(block.text?.trim());
    case "stat":
      return Boolean(block.label?.trim() && block.value?.trim());
  }
  return true;
}

export function filterRenderableBlocks(blocks: Block[], store: ToolDataStore): Block[] {
  return blocks
    .map((block) => pruneBlock(block, store))
    .filter((b): b is Block => b !== null);
}

function pruneBlock(block: Block, store: ToolDataStore): Block | null {
  if (block.type === "stack" || block.type === "row" || block.type === "column" || block.type === "grid") {
    const children = block.children.map((c) => pruneBlock(c, store)).filter((c): c is Block => c !== null);
    if (!children.length) return null;
    if (children.length === 1) return children[0]!;
    return { ...block, children };
  }
  if (block.type === "tabs") {
    const tabs = block.tabs
      .map((tab) => ({
        ...tab,
        children: tab.children.map((c) => pruneBlock(c, store)).filter((c): c is Block => c !== null),
      }))
      .filter((tab) => tab.children.length > 0);
    if (!tabs.length) return null;
    return { ...block, tabs };
  }
  if (block.type === "accordion") {
    const items = block.items
      .map((item) => ({
        ...item,
        children: item.children.map((c) => pruneBlock(c, store)).filter((c): c is Block => c !== null),
      }))
      .filter((item) => item.children.length > 0);
    if (!items.length) return null;
    return { ...block, items };
  }
  return blockCanRender(block, store) ? block : null;
}

export function summaryStatBlocks(store: ToolDataStore): Block[] {
  const s = store.portfolioSummary;
  if (!s) return [];
  const gainTone = s.gain >= 0 ? "up" : "down";
  const stats: Block[] = [
    { type: "stat", label: "Total value", value: formatInr(s.total) },
    { type: "stat", label: "Invested", value: formatInr(s.invested) },
    {
      type: "stat",
      label: "Gain",
      value: `${formatInr(s.gain)} (${formatPct(s.gainPct)})`,
      tone: gainTone,
    },
    { type: "stat", label: "XIRR", value: s.xirr || "—" },
  ];
  if (s.dayChange != null && Number.isFinite(s.dayChange)) {
    stats.push({
      type: "stat",
      label: "Today",
      value: `${formatInr(s.dayChange)} (${formatPct(s.dayChangePct)})`,
      tone: (s.dayChange ?? 0) >= 0 ? "up" : "down",
    });
  }
  return stats;
}
