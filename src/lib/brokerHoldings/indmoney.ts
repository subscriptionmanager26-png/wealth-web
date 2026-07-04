import type { McpToolResult, NormalizedBrokerHolding } from "./types";

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isIndmoneyRow(row: Record<string, unknown>): boolean {
  return "investment" in row && "market_value" in row && ("asset_type" in row || "investment_code" in row);
}

export function extractIndmoneyPayload(result: McpToolResult): { holdings: Record<string, unknown>[] } | null {
  const candidates: unknown[] = [];
  if (result.structuredContent?.result) candidates.push(tryParseJson(result.structuredContent.result));
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === "text" && block.text) candidates.push(tryParseJson(block.text));
    }
  }
  candidates.push(result);

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const obj = candidate as { holdings?: unknown[] };
    if (Array.isArray(obj.holdings)) {
      const rows = obj.holdings.filter((row): row is Record<string, unknown> => isIndmoneyRow(row as Record<string, unknown>));
      if (rows.length) return { holdings: rows };
    }
    if (Array.isArray(candidate)) {
      const rows = (candidate as unknown[]).filter((row): row is Record<string, unknown> =>
        isIndmoneyRow(row as Record<string, unknown>),
      );
      if (rows.length) return { holdings: rows };
    }
  }
  return null;
}

export function normalizeIndmoneyHolding(row: Record<string, unknown>): NormalizedBrokerHolding {
  const investedRaw = row.invested_amount;
  const invested =
    investedRaw === "unknown" || investedRaw === "" || investedRaw == null ? null : Number(investedRaw);

  return {
    source: "indmoney",
    parser: "indmoney",
    code: String(row.investment_code ?? ""),
    name: String(row.investment ?? ""),
    assetType: String(row.asset_type ?? ""),
    subClass: String(row.assetclass_l2 ?? ""),
    invested,
    value: Number(row.market_value ?? 0),
    weightPct: Number(row.holding_percent ?? 0),
    pnl: Number(row.total_pnl ?? 0),
    pnlPct: Number(row.pnl_per ?? 0),
    units: Number(row.total_units ?? 0),
    price: Number(row.unit_price ?? 0),
    broker: String(row.broker ?? "").trim(),
    raw: row,
  };
}

export function normalizeIndmoneyHoldings(payload: { holdings: Record<string, unknown>[] }): NormalizedBrokerHolding[] {
  return payload.holdings.map(normalizeIndmoneyHolding);
}

export const INDMONEY_ASSET_TYPES = ["STOCK", "MF", "US_STOCK", "IND_STOCK", "ETF", "GOLD", "NPS"] as const;
