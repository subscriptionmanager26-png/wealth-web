import { applyKiteWeights, extractKitePayload, normalizeKiteHoldings } from "./kite";
import { extractIndmoneyPayload, normalizeIndmoneyHoldings } from "./indmoney";
import type { McpToolResult, ParsedBrokerHoldings } from "./types";

function summarize(holdings: ParsedBrokerHoldings["holdings"]): ParsedBrokerHoldings["summary"] {
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const withInvested = holdings.filter((h) => h.invested != null);
  const totalInvested = withInvested.reduce((s, h) => s + (h.invested ?? 0), 0);
  const totalPnl = holdings.reduce((s, h) => s + h.pnl, 0);
  const assetTypes = [...new Set(holdings.map((h) => h.assetType || h.subClass).filter(Boolean))];
  return {
    count: holdings.length,
    totalValue,
    totalInvested: withInvested.length ? totalInvested : null,
    totalPnl,
    assetTypes,
  };
}

export function parseBrokerHoldings(result: McpToolResult): ParsedBrokerHoldings | null {
  if (!result || result.error) return null;

  const indmoney = extractIndmoneyPayload(result);
  if (indmoney) {
    const holdings = normalizeIndmoneyHoldings(indmoney);
    if (holdings.length) {
      return { holdings, parser: "indmoney", source: "indmoney", summary: summarize(holdings) };
    }
  }

  const kite = extractKitePayload(result);
  if (kite) {
    const parser = kite.kind === "mf" ? "kite-mf" : "kite-equity";
    const source = kite.kind === "mf" ? "kite-mf" : "kite";
    const holdings = applyKiteWeights(normalizeKiteHoldings(kite));
    if (holdings.length) {
      return { holdings, parser, source, summary: summarize(holdings) };
    }
  }

  return null;
}

export function mergeParsedHoldings(parts: ParsedBrokerHoldings[]): ParsedBrokerHoldings | null {
  const holdings = parts.flatMap((p) => p.holdings);
  if (!holdings.length) return null;
  const parser = parts.map((p) => p.parser).join("+");
  const source = parts[0]?.source ?? "broker";
  return { holdings, parser, source, summary: summarize(holdings) };
}

export function extractLoginUrl(result: McpToolResult): string | null {
  if (!result?.content) return null;
  const text = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  const match = text.match(/https?:\/\/[^\s)\]"']+/);
  if (match && /login|auth|consent|connect|oauth/i.test(match[0])) {
    return match[0];
  }
  return null;
}
