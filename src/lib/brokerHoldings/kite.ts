import type { McpToolResult, NormalizedBrokerHolding } from "./types";

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isKiteMfRow(row: Record<string, unknown>): boolean {
  return "fund" in row && "folio" in row && "quantity" in row && "last_price" in row;
}

function isKiteEquityRow(row: Record<string, unknown>): boolean {
  if (isKiteMfRow(row)) return false;
  return "tradingsymbol" in row && "quantity" in row && "last_price" in row;
}

export function extractKitePayload(result: McpToolResult): { kind: "mf" | "equity"; rows: Record<string, unknown>[] } | null {
  const candidates: unknown[] = [];
  if (result.structuredContent?.result) candidates.push(tryParseJson(result.structuredContent.result));
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === "text" && block.text) candidates.push(tryParseJson(block.text));
    }
  }
  candidates.push(result);

  for (const candidate of candidates) {
    if (!candidate) continue;
    const arrays = [
      Array.isArray(candidate) ? candidate : null,
      Array.isArray((candidate as { data?: unknown[] }).data) ? (candidate as { data: unknown[] }).data : null,
      Array.isArray((candidate as { holdings?: unknown[] }).holdings)
        ? (candidate as { holdings: unknown[] }).holdings
        : null,
    ].filter(Boolean) as Record<string, unknown>[][];

    for (const rows of arrays) {
      if (rows.some(isKiteMfRow)) return { kind: "mf", rows: rows.filter(isKiteMfRow) };
      if (rows.some(isKiteEquityRow)) return { kind: "equity", rows: rows.filter(isKiteEquityRow) };
    }
  }
  return null;
}

function normalizeKiteEquity(row: Record<string, unknown>): NormalizedBrokerHolding {
  const units = Number(row.quantity ?? 0);
  const avgPrice = Number(row.average_price ?? 0);
  const price = Number(row.last_price ?? 0);
  const invested = avgPrice * units;
  const value = price * units;
  const pnl = Number(row.pnl ?? 0);
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : null;
  return {
    source: "kite",
    parser: "kite-equity",
    code: String(row.isin ?? ""),
    name: String(row.tradingsymbol ?? ""),
    assetType: String(row.product ?? ""),
    subClass: String(row.exchange ?? ""),
    invested,
    value,
    weightPct: null,
    pnl,
    pnlPct,
    units,
    price,
    broker: "Zerodha",
    dayChange: Number(row.day_change ?? 0),
    dayChangePct: Number(row.day_change_percentage ?? 0),
    raw: row,
  };
}

function normalizeKiteMf(row: Record<string, unknown>): NormalizedBrokerHolding {
  const units = Number(row.quantity ?? 0);
  const avgPrice = Number(row.average_price ?? 0);
  const price = Number(row.last_price ?? 0);
  const invested = avgPrice * units;
  const value = price * units;
  const reportedPnl = Number(row.pnl ?? 0);
  const pnl = reportedPnl !== 0 ? reportedPnl : value - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : null;
  return {
    source: "kite-mf",
    parser: "kite-mf",
    code: String(row.tradingsymbol ?? ""),
    name: String(row.fund ?? ""),
    assetType: "MF",
    subClass: String(row.folio ?? ""),
    folio: String(row.folio ?? ""),
    invested,
    value,
    weightPct: null,
    pnl,
    pnlPct,
    units,
    price,
    broker: "Zerodha",
    raw: row,
  };
}

export function normalizeKiteHoldings(payload: { kind: "mf" | "equity"; rows: Record<string, unknown>[] }): NormalizedBrokerHolding[] {
  if (payload.kind === "mf") return payload.rows.map(normalizeKiteMf);
  return payload.rows.filter(isKiteEquityRow).map(normalizeKiteEquity);
}

export function applyKiteWeights(holdings: NormalizedBrokerHolding[]): NormalizedBrokerHolding[] {
  const total = holdings.reduce((s, h) => s + h.value, 0);
  if (total <= 0) return holdings;
  return holdings.map((h) => ({ ...h, weightPct: (h.value / total) * 100 }));
}
