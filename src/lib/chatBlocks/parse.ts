import type { BadgeVariant, Block, BlockTone, BlocksDocument, CalloutTone } from "./types";
import { isAnswerTemplate, type AnswerTemplate } from "./answerTemplates";
import { parseExtendedBlock } from "./parseExtended";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseTone(v: unknown): BlockTone | undefined {
  if (v === "up" || v === "down" || v === "neutral") return v;
  return undefined;
}

function parseBadgeVariant(v: unknown): BadgeVariant | undefined {
  if (v === "success" || v === "warning" || v === "muted" || v === "info") return v;
  return undefined;
}

function parseCalloutTone(v: unknown): CalloutTone | undefined {
  if (v === "info" || v === "warn" || v === "success") return v;
  return undefined;
}

function parseHeadingLevel(v: unknown): 2 | 3 {
  return v === 3 ? 3 : 2;
}

function parseChildren(raw: unknown): Block[] {
  return Array.isArray(raw) ? raw.map(parseBlock).filter((b): b is Block => b !== null) : [];
}

function parseGridColumns(v: unknown): 1 | 2 | 3 {
  if (v === 1 || v === 2 || v === 3) return v;
  return 2;
}

export function parseBlock(raw: unknown): Block | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;

  switch (raw.type) {
    case "text": {
      const text = asString(raw.text);
      return text ? { type: "text", text } : null;
    }
    case "heading": {
      const text = asString(raw.text);
      return text ? { type: "heading", level: parseHeadingLevel(raw.level), text } : null;
    }
    case "stat": {
      const label = asString(raw.label);
      const value = asString(raw.value);
      if (!label || !value) return null;
      const delta = asString(raw.delta);
      return {
        type: "stat",
        label,
        value,
        delta: delta || undefined,
        tone: parseTone(raw.tone),
      };
    }
    case "badge": {
      const label = asString(raw.label);
      return label ? { type: "badge", label, variant: parseBadgeVariant(raw.variant) } : null;
    }
    case "table": {
      const columns = Array.isArray(raw.columns) ? raw.columns.map(String).filter(Boolean) : [];
      const rows = Array.isArray(raw.rows)
        ? raw.rows
            .filter(Array.isArray)
            .map((row) => row.map(String))
            .filter((row) => row.length > 0)
        : [];
      if (!columns.length || !rows.length) return null;
      return { type: "table", columns, rows };
    }
    case "callout": {
      const text = asString(raw.text);
      return text ? { type: "callout", text, tone: parseCalloutTone(raw.tone) } : null;
    }
    case "divider":
      return { type: "divider" };
    case "stack": {
      const children = parseChildren(raw.children);
      return children.length ? { type: "stack", children } : null;
    }
    case "row": {
      const children = parseChildren(raw.children);
      const gap = raw.gap === "sm" || raw.gap === "md" ? raw.gap : undefined;
      return children.length ? { type: "row", children, gap } : null;
    }
    case "column": {
      const children = parseChildren(raw.children);
      return children.length ? { type: "column", children } : null;
    }
    case "grid": {
      const children = parseChildren(raw.children);
      const columns = parseGridColumns(raw.columns);
      return children.length ? { type: "grid", columns, children } : null;
    }
    case "tabs": {
      const tabsRaw = Array.isArray(raw.tabs) ? raw.tabs : [];
      const tabs = tabsRaw
        .map((t, idx) => {
          if (!isRecord(t)) return null;
          const label = asString(t.label);
          const children = parseChildren(t.children);
          if (!label || !children.length) return null;
          const id = asString(t.id) || `tab${idx + 1}`;
          return { id, label, children };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);
      if (!tabs.length) return null;
      const defaultTab = asString(raw.defaultTab) || undefined;
      return { type: "tabs", tabs, defaultTab };
    }
    case "accordion": {
      const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
      const items = itemsRaw
        .map((item, idx) => {
          if (!isRecord(item)) return null;
          const title = asString(item.title);
          const children = parseChildren(item.children);
          if (!title || !children.length) return null;
          const id = asString(item.id) || `acc${idx + 1}`;
          return { id, title, children, defaultOpen: item.defaultOpen === true };
        })
        .filter((i): i is NonNullable<typeof i> => i !== null);
      if (!items.length) return null;
      return { type: "accordion", items };
    }
    case "portfolioSummary":
      return { type: "portfolioSummary" };
    case "periodReturns": {
      const frames = Array.isArray(raw.frames) ? raw.frames.map(String).filter(Boolean) : undefined;
      return { type: "periodReturns", frames };
    }
    case "benchmarkComparison": {
      const frame = asString(raw.frame) || undefined;
      const benchmarkId = asString(raw.benchmarkId) || undefined;
      return { type: "benchmarkComparison", frame, benchmarkId };
    }
    case "holdingsTable": {
      const limit = typeof raw.limit === "number" ? raw.limit : undefined;
      return { type: "holdingsTable", limit };
    }
    case "allocation":
      return { type: "allocation" };
    case "fundCard": {
      const rank = typeof raw.rank === "number" ? raw.rank : undefined;
      const query = asString(raw.query) || undefined;
      return { type: "fundCard", rank, query };
    }
    case "sectorExposure": {
      const limit = typeof raw.limit === "number" ? raw.limit : undefined;
      return { type: "sectorExposure", limit };
    }
    default:
      if (isRecord(raw)) return parseExtendedBlock(raw);
      return null;
  }
}

export function parseBlocksDocument(raw: string): BlocksDocument | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  if (!isRecord(parsed)) return null;
  const templateRaw = parsed.template;
  const template: AnswerTemplate | undefined = isAnswerTemplate(templateRaw) ? templateRaw : undefined;
  const blocksRaw = Array.isArray(parsed.blocks) ? parsed.blocks : [];
  const blocks = blocksRaw.map(parseBlock).filter((b): b is Block => b !== null);
  return blocks.length ? { blocks, template } : null;
}

/** Plain text for copy, history fallback, and search. */
export function blocksToPlainText(blocks: Block[]): string {
  const lines: string[] = [];

  function walk(block: Block) {
    switch (block.type) {
      case "text":
        lines.push(block.text);
        break;
      case "heading":
        lines.push(block.text);
        break;
      case "stat":
        lines.push(`${block.label}: ${block.value}${block.delta ? ` (${block.delta})` : ""}`);
        break;
      case "badge":
        lines.push(block.label);
        break;
      case "table":
        lines.push(block.columns.join(" | "));
        for (const row of block.rows) lines.push(row.join(" | "));
        break;
      case "callout":
        lines.push(block.text);
        break;
      case "divider":
        lines.push("—");
        break;
      case "stack":
      case "row":
      case "column":
      case "grid":
        for (const child of block.children) walk(child);
        break;
      case "tabs":
        for (const tab of block.tabs) {
          lines.push(tab.label);
          for (const child of tab.children) walk(child);
        }
        break;
      case "accordion":
        for (const item of block.items) {
          lines.push(item.title);
          for (const child of item.children) walk(child);
        }
        break;
      case "portfolioSummary":
        lines.push("[Portfolio summary]");
        break;
      case "periodReturns":
        lines.push("[Period returns]");
        break;
      case "benchmarkComparison":
        lines.push("[Benchmark comparison]");
        break;
      case "holdingsTable":
        lines.push("[Holdings]");
        break;
      case "allocation":
        lines.push("[Asset allocation]");
        break;
      case "fundCard":
        lines.push("[Fund details]");
        break;
      case "sectorExposure":
        lines.push("[Sector exposure]");
        break;
      default:
        break;
    }
  }

  for (const block of blocks) walk(block);
  return lines.filter(Boolean).join("\n\n");
}
