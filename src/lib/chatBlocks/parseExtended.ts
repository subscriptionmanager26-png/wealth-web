import type { Block } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

function asChecklistItems(v: unknown): { id: string; text: string; done?: boolean }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item, i) => {
      if (!isRecord(item)) return null;
      const text = asString(item.text);
      if (!text) return null;
      return { id: asString(item.id) || String(i + 1), text, done: item.done === true };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Parse extended Generative UI block types from raw JSON. */
export function parseExtendedBlock(raw: Record<string, unknown>): Block | null {
  const type = raw.type;
  if (typeof type !== "string") return null;

  switch (type) {
    case "bulletList":
      return { type: "bulletList", items: asStringArray(raw.items) };
    case "timeline": {
      const events = Array.isArray(raw.events)
        ? raw.events
            .map((e) => {
              if (!isRecord(e)) return null;
              const title = asString(e.title);
              const date = asString(e.date);
              if (!title) return null;
              return { date, title, body: asString(e.body) || undefined };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
        : [];
      return { type: "timeline", events };
    }
    case "progressBar":
      return {
        type: "progressBar",
        label: asString(raw.label) || "Progress",
        value: typeof raw.value === "number" ? raw.value : 0,
        max: typeof raw.max === "number" ? raw.max : undefined,
      };
    case "metricCard": {
      const label = asString(raw.label);
      const value = asString(raw.value);
      if (!label || !value) return null;
      return {
        type: "metricCard",
        label,
        value,
        delta: asString(raw.delta) || undefined,
        sublabel: asString(raw.sublabel) || undefined,
      };
    }
    case "infoCard": {
      const title = asString(raw.title);
      const body = asString(raw.body);
      if (!title) return null;
      return { type: "infoCard", title, body };
    }
    case "ctaButton": {
      const label = asString(raw.label);
      if (!label) return null;
      return { type: "ctaButton", label, hint: asString(raw.hint) || undefined };
    }
    case "compareHeader":
      return {
        type: "compareHeader",
        leftLabel: asString(raw.leftLabel) || "A",
        rightLabel: asString(raw.rightLabel) || "B",
        subtitle: asString(raw.subtitle) || undefined,
      };
    case "lineChart":
      return { type: "lineChart", series: raw.series === "benchmark" ? "benchmark" : "portfolio" };
    case "pieChart":
      return { type: "pieChart", variant: raw.variant === "sector" ? "sector" : "allocation" };
    case "barChart":
      return { type: "barChart", variant: raw.variant === "comparison" ? "comparison" : "returns" };
    case "gaugeChart":
      return {
        type: "gaugeChart",
        metric: raw.metric === "volatility" || raw.metric === "diversification" ? raw.metric : "risk",
        label: asString(raw.label) || undefined,
      };
    case "progressRing":
      return {
        type: "progressRing",
        label: asString(raw.label) || undefined,
        value: typeof raw.value === "number" ? raw.value : undefined,
      };
    case "performanceChart":
    case "allocationPie":
    case "returnsTable":
    case "portfolioTimeline":
    case "diversificationScore":
    case "riskMeter":
    case "rebalancingSuggestion":
    case "priceChart":
    case "stockCard":
    case "newsFeed":
    case "valuationSummary":
    case "peerComparison":
    case "netWorthCard":
    case "goalTracker":
    case "retirementProjection":
    case "sipCalculator":
    case "taxSummary":
    case "emergencyFundMeter":
    case "actionPlan":
      return { type } as Block;
    case "recommendationCard": {
      const title = asString(raw.title);
      const body = asString(raw.body);
      if (!title) return null;
      return {
        type: "recommendationCard",
        title,
        body,
        confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
        action: asString(raw.action) || undefined,
      };
    }
    case "actionChecklist":
      return { type: "actionChecklist", items: asChecklistItems(raw.items) };
    case "prosCons":
      return { type: "prosCons", pros: asStringArray(raw.pros), cons: asStringArray(raw.cons) };
    case "decisionMatrix": {
      const rows = Array.isArray(raw.rows)
        ? raw.rows
            .map((r) => {
              if (!isRecord(r)) return null;
              const option = asString(r.option);
              if (!option) return null;
              return { option, score: asString(r.score) || undefined, note: asString(r.note) || undefined };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
        : [];
      return { type: "decisionMatrix", rows };
    }
    case "scenarioComparison": {
      const scenarios = Array.isArray(raw.scenarios)
        ? raw.scenarios
            .map((s) => {
              if (!isRecord(s)) return null;
              const name = asString(s.name);
              const outcome = asString(s.outcome);
              if (!name) return null;
              return {
                name,
                outcome,
                tone: s.tone === "up" || s.tone === "down" ? s.tone : undefined,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null)
        : [];
      return { type: "scenarioComparison", scenarios };
    }
    case "confidenceMeter":
      return {
        type: "confidenceMeter",
        value: typeof raw.value === "number" ? raw.value : 50,
        label: asString(raw.label) || undefined,
      };
    case "assumptions":
      return { type: "assumptions", items: asStringArray(raw.items) };
    case "risks":
      return { type: "risks", items: asStringArray(raw.items) };
    case "sources":
      return { type: "sources", items: asStringArray(raw.items) };
    case "followUpQuestions":
      return { type: "followUpQuestions", items: asStringArray(raw.items) };
    default:
      return null;
  }
}
