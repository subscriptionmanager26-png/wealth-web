/**
 * Unified statement parser entry (MF Central, CDSL, NPS).
 * Core logic is text-only — same mobile architecture as CAMS CAS.
 */

import { parseCASFromExtractedLines, type ParsedCAS } from "./cas-parser";
import { parseCdslFromLines } from "./cdslParser";
import { detectStatementKind } from "./statementDetect";
import { parseMfCentralFromLines } from "./mfCentralParser";
import { parseNpsFromLines } from "./npsParser";
import type {
  MfHoldingRow,
  ParsedCdslStatement,
  ParsedMfCentralStatement,
  ParsedNpsStatement,
  ParsedStatement,
  StatementKind,
} from "./statementTypes";

export type { StatementKind, ParsedStatement, ParsedMfCentralStatement, ParsedCdslStatement, ParsedNpsStatement };
export { detectStatementKind };

export function parseStatementFromLines(lines: string[], fileName = "statement.pdf"): ParsedStatement {
  const text = lines.join("\n");
  const kind = detectStatementKind(text);

  switch (kind) {
    case "mf_central":
      return parseMfCentralFromLines(lines, fileName);
    case "cdsl_cas":
      return parseCdslFromLines(lines, fileName);
    case "nps":
      return parseNpsFromLines(lines, fileName);
    case "cams_kfin_cas":
      return {
        kind: "unknown",
        source_file: fileName,
        reason: "CAMS/KFintech CAS — use parseCASFromExtractedLines / parseCASText",
      };
    default:
      return { kind: "unknown", source_file: fileName, reason: "Unrecognized statement format" };
  }
}

export function parseStatementText(text: string, fileName = "statement.pdf"): ParsedStatement {
  return parseStatementFromLines(text.split(/\r?\n/), fileName);
}

/**
 * Auto-route: CAMS/KFin → existing CAS parser; MF Central / CDSL / NPS → new parsers.
 * Returns a tagged union so callers can branch.
 */
export function parseAnyStatementFromLines(
  lines: string[],
  fileName = "statement.pdf",
):
  | { kind: "cams_kfin_cas"; data: ParsedCAS }
  | { kind: "mf_central"; data: ParsedMfCentralStatement }
  | { kind: "cdsl_cas"; data: ParsedCdslStatement }
  | { kind: "nps"; data: ParsedNpsStatement }
  | { kind: "unknown"; reason: string } {
  const kind = detectStatementKind(lines.join("\n"));
  if (kind === "cams_kfin_cas") {
    return { kind, data: parseCASFromExtractedLines(lines, fileName) };
  }
  const parsed = parseStatementFromLines(lines, fileName);
  if (parsed.kind === "unknown") return { kind: "unknown", reason: parsed.reason };
  if (parsed.kind === "mf_central") return { kind: "mf_central", data: parsed };
  if (parsed.kind === "cdsl_cas") return { kind: "cdsl_cas", data: parsed };
  return { kind: "nps", data: parsed };
}

/** Map MF holdings into a CAMS-like ParsedCAS shape for portfolio reuse. */
export function mfHoldingsToParsedCas(
  holdings: MfHoldingRow[],
  meta: {
    source_file: string;
    period_from?: string | null;
    period_to?: string | null;
    investor_name?: string | null;
    investor_pan?: string | null;
    address?: string | null;
  },
): ParsedCAS {
  return {
    source_file: meta.source_file,
    period_from: meta.period_from ?? null,
    period_to: meta.period_to ?? null,
    investor_name: meta.investor_name ?? null,
    email: null,
    mobile: null,
    address: meta.address ?? null,
    investor_pan: meta.investor_pan ?? null,
    portfolio_summary: holdings
      .filter((h) => h.scheme_name && h.market_value_inr)
      .map((h) => ({
        mutual_fund: h.scheme_name!,
        cost_value_inr: h.cost_value_inr ?? "0",
        market_value_inr: h.market_value_inr ?? "0",
      })),
    holdings: holdings.map((h) => ({
      amc: h.amc,
      folio_no: h.folio_no ?? "",
      pan: meta.investor_pan ?? null,
      kyc_status: null,
      pan_status: null,
      nominee_1: null,
      nominee_2: null,
      nominee_3: null,
      investor_name_on_folio: meta.investor_name ?? null,
      scheme_code: h.scheme_code,
      scheme_name: h.scheme_name,
      isin: h.isin,
      advisor: null,
      registrar: null,
      opening_units: null,
      closing_units: h.closing_units,
      nav_date: meta.period_to ?? null,
      nav_inr: h.nav_inr,
      cost_value_inr: h.cost_value_inr,
      market_value_date: meta.period_to ?? null,
      market_value_inr: h.market_value_inr,
      transactions: h.transactions
        .filter((t) => t.date)
        .map((t) => ({
          date: t.date,
          description: t.description,
          amount_inr: t.amount_inr ?? "",
          units: t.units ?? "",
          price_inr: t.price_inr ?? t.nav_inr ?? "",
          unit_balance: t.unit_balance ?? "",
        })),
    })),
  };
}
