/**
 * NPS holdings parser.
 * Handles:
 * - CRA / Central Record Keeping Agency transaction statements (columnar Tier 1 / Tier 2)
 * - NPS section inside CDSL CAS (when PRAN + holdings present)
 *
 * Text-line only (mobile-safe).
 */

import type {
  NpsHoldingRow,
  NpsNominee,
  NpsTierSummary,
  ParsedNpsStatement,
} from "./statementTypes";
import {
  ISIN_RE,
  cleanLines,
  extractPan,
  extractPeriod,
  moneyTokens,
  normalizeDate,
  parseMoney,
  parsePct,
} from "./statementUtils";

const SCHEME_LABELS: Record<string, string> = {
  E: "Equity (Scheme E)",
  C: "Corporate Bond (Scheme C)",
  G: "Government Securities (Scheme G)",
  A: "Alternative Investment (Scheme A)",
};

function isCraStatement(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("central record keeping agency") ||
    t.includes("central recordkeeping agency") ||
    (t.includes("national pension system") && /\bpran\b/i.test(text) && t.includes("tier 1"))
  );
}

function hasNpsContent(lines: string[]): boolean {
  const text = lines.join("\n");
  return /PRAN\s*[:.]?\s*\d{12}/i.test(text) || isCraStatement(text);
}

function normalizeSpaceDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return normalizeDate(raw);
  return `${m[1]!.padStart(2, "0")}-${m[2]}-${m[3]}`;
}

function extractCraPeriod(text: string): { from: string | null; to: string | null } {
  const m = text.match(
    /(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+to\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/i,
  );
  if (m) return { from: normalizeSpaceDate(m[1]!), to: normalizeSpaceDate(m[2]!) };
  return extractPeriod(text);
}

function threeAmounts(line: string): string[] | null {
  const m = line.match(
    /([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s*$/,
  );
  if (!m) return null;
  return [m[1]!, m[2]!, m[3]!];
}

function parseSchemeCodes(lines: string[], start: number, end: number): { code: string; pct: string | null }[] {
  const schemes: { code: string; pct: string | null }[] = [];
  for (let i = start; i < end; i += 1) {
    const line = lines[i]!;
    const m = line.match(/SCHEME_NAME\s+([ECGA])\s+(\d+(?:\.\d+)?)/i);
    if (m) {
      schemes.push({ code: m[1]!.toUpperCase(), pct: parsePct(m[2]!) });
      continue;
    }
    // Sometimes "SCHEME_NAME E   75" with extra spaces
    const m2 = line.match(/SCHEME[_\s-]*NAME\s+([ECGA])\b/i);
    if (m2) {
      const pct = line.match(/\b(\d{1,3}(?:\.\d+)?)\s*$/)?.[1];
      schemes.push({ code: m2[1]!.toUpperCase(), pct: parsePct(pct ?? null) });
    }
  }
  return schemes;
}

function findLabeledTriple(lines: string[], start: number, end: number, label: RegExp): string[] | null {
  for (let i = start; i < end; i += 1) {
    if (!label.test(lines[i]!)) continue;
    // values may be on same line or next
    const same = threeAmounts(lines[i]!);
    if (same) return same;
    for (let j = i + 1; j < Math.min(end, i + 3); j += 1) {
      const trip = threeAmounts(lines[j]!);
      if (trip) return trip;
    }
  }
  return null;
}

function findGainTriple(lines: string[], start: number, end: number): string[] | null {
  for (let i = start; i < end; i += 1) {
    if (!/Unrealised Gain\/Loss/i.test(lines[i]!)) continue;
    const vals: string[] = [];
    // May be one line with 3 amounts, or 3 separate amount-only lines
    const same = moneyTokens(lines[i]!);
    if (same.length >= 3) {
      return same.slice(0, 3).map((t) => parseMoney(t)!).filter(Boolean) as string[];
    }
    for (let j = i + 1; j < Math.min(end, i + 6) && vals.length < 3; j += 1) {
      const line = lines[j]!;
      if (/NOTE:|Transaction Details|TIER\s*[12]|Page\s+\d+/i.test(line)) break;
      const toks = moneyTokens(line);
      if (toks.length === 1) vals.push(parseMoney(toks[0]!)!);
      else if (toks.length >= 3) return toks.slice(0, 3).map((t) => parseMoney(t)!);
    }
    if (vals.length === 3) return vals;
  }
  return null;
}

function parseTierBlock(
  lines: string[],
  start: number,
  end: number,
  tier: "T1" | "T2",
  pran: string | null,
  pensionFund: string | null,
): { summary: NpsTierSummary; holdings: NpsHoldingRow[] } {
  const block = lines.slice(start, end);
  const text = block.join("\n");

  // Investment details line: contribution count deductions invested valuation
  let total_contribution_inr: string | null = null;
  let contribution_count: string | null = null;
  let withdrawal_billing_deductions_inr: string | null = null;
  let current_invested_amount_inr: string | null = null;
  let current_valuation_inr: string | null = null;

  for (let i = 0; i < block.length; i += 1) {
    if (!/INVESTMENT DETAILS/i.test(block[i]!)) continue;
    for (let j = i + 1; j < Math.min(block.length, i + 8); j += 1) {
      const toks = moneyTokens(block[j]!);
      // Prefer a line with 5 amounts
      if (toks.length >= 5) {
        total_contribution_inr = parseMoney(toks[0]!);
        contribution_count = parseMoney(toks[1]!);
        withdrawal_billing_deductions_inr = parseMoney(toks[2]!);
        current_invested_amount_inr = parseMoney(toks[3]!);
        current_valuation_inr = parseMoney(toks[4]!);
        break;
      }
    }
    break;
  }

  const schemes = parseSchemeCodes(block, 0, block.length);
  const investments = findLabeledTriple(block, 0, block.length, /Current Investment/i);
  const units = findLabeledTriple(block, 0, block.length, /Total units/i);
  const navs = findLabeledTriple(block, 0, block.length, /Latest NAV/i);
  const values = findLabeledTriple(block, 0, block.length, /Current Value/i);
  const gains = findGainTriple(block, 0, block.length);

  const holdings: NpsHoldingRow[] = [];
  const n = Math.max(schemes.length, investments?.length ?? 0, values?.length ?? 0);
  for (let i = 0; i < n; i += 1) {
    const code = schemes[i]?.code ?? null;
    holdings.push({
      pran,
      tier,
      scheme_code: code,
      scheme_name: code ? SCHEME_LABELS[code] ?? `Scheme ${code}` : null,
      allocation_pct: schemes[i]?.pct ?? null,
      pension_fund: pensionFund,
      invested_amount_inr: investments ? parseMoney(investments[i]!) : null,
      units: units ? parseMoney(units[i]!) : null,
      nav_inr: navs ? parseMoney(navs[i]!) : null,
      market_value_inr: values ? parseMoney(values[i]!) : null,
      contribution_inr: null,
      unrealised_gain_inr: gains ? parseMoney(gains[i]!) : null,
    });
  }

  // XIRR / status come from subscriber header, filled by caller
  void text;
  return {
    summary: {
      tier,
      status: null,
      total_contribution_inr,
      contribution_count,
      withdrawal_billing_deductions_inr,
      current_invested_amount_inr,
      current_valuation_inr,
      xirr_since_inception_pct: null,
    },
    holdings,
  };
}

function parseCraStatement(lines: string[], fileName: string): ParsedNpsStatement {
  const text = lines.join("\n");
  const period = extractCraPeriod(text);
  const pran = text.match(/PRAN\s+(\d{12})/i)?.[1] ?? text.match(/PRAN\s*[:.]?\s*(\d{12})/i)?.[1] ?? null;

  // Name: first person-like line after SUBSCRIBER DETAILS
  let investor_name: string | null = null;
  const subIdx = lines.findIndex((l) => /SUBSCRIBER DETAILS/i.test(l));
  if (subIdx >= 0) {
    for (let i = subIdx + 1; i < Math.min(lines.length, subIdx + 6); i += 1) {
      const line = lines[i]!.replace(/POP Registration No.*/i, "").trim();
      if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$/.test(line) || /^[A-Za-z][A-Za-z .]{2,40}$/.test(line)) {
        if (!/POP|PRAN|Mobile|Email|Tier|Status|Statement/i.test(line)) {
          investor_name = line.trim();
          break;
        }
      }
    }
  }

  const addressParts: string[] = [];
  for (const l of lines.slice(0, 25)) {
    if (
      /H\.?\s*NO|SHIVPURI|GHAZIABAD|PIN|UP,\s*IN/i.test(l) &&
      !/POP|PRAN|Mobile|Email|CENTRAL RECORD|NATIONAL PENSION|Transaction Statement/i.test(l)
    ) {
      addressParts.push(l.replace(/POP Name.*/i, "").trim());
    }
  }

  const mobile = text.match(/Mobile\s+(\d{10})/i)?.[1] ?? null;
  const email = text.match(/Email\s+([^\s]+@[^\s]+)/i)?.[1] ?? null;
  const pop_name =
    text.match(/POP Name\s+(.+?)(?:\s+POP SP|\s+Mobile|\s+Email|$)/i)?.[1]?.trim() ??
    text.match(/POP Name\s+([A-Za-z0-9 .,&-]+)/i)?.[1]?.trim() ??
    null;
  const pop_registration_no = text.match(/POP Registration No\s+(\d+)/i)?.[1] ?? null;
  const pran_generated_date_raw = text.match(/PRAN Generated Date\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/i)?.[1];
  const statement_date_raw = text.match(/Statement Date\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/i)?.[1];

  const tier1Status = text.match(/Tier 1 Status\s+(\w+)/i)?.[1] ?? null;
  const tier2Status = text.match(/Tier 2 Status\s+(\w+)/i)?.[1] ?? null;
  const tier1Xirr = parsePct(text.match(/Tier 1 XIRR since inception\s+([\d.]+)%/i)?.[1] ?? null);
  const tier2Xirr = parsePct(text.match(/Tier 2 XIRR since inception\s+([\d.]+)%/i)?.[1] ?? null);

  // Pension fund manager (repeated 3x in columns)
  const pf =
    text.match(/(HDFC Pension Fund Management(?:\s+Limited)?)/i)?.[1]?.replace(/\s+/g, " ").trim() ??
    text.match(/([A-Z][A-Za-z]+ Pension Fund Management(?:\s+Limited)?)/)?.[1] ??
    null;

  // Nominees: "Sangeeta Agarwal   Dependent Mother   50   50"
  const nominees: NpsNominee[] = [];
  const nomStart = lines.findIndex((l) => /Nominee Details/i.test(l));
  if (nomStart >= 0) {
    for (let i = nomStart + 1; i < Math.min(lines.length, nomStart + 8); i += 1) {
      const line = lines[i]!;
      if (/TIER 1|INVESTMENT DETAILS|SCHEME DETAILS/i.test(line)) break;
      const m = line.match(/^([A-Za-z .]+?)\s+(Dependent\s+\w+|\w+)\s+(\d+)\s+(\d+)\s*$/);
      if (m) {
        nominees.push({
          name: m[1]!.trim(),
          relationship: m[2]!.trim(),
          tier1_pct: parsePct(m[3]!),
          tier2_pct: parsePct(m[4]!),
        });
      }
    }
  }

  // Only real scheme section headers (not "Tier 1 Status" / "Tier 2 XIRR").
  const t1Start = lines.findIndex((l) => /TIER\s*1\s*-\s*Common Scheme/i.test(l));
  const t2Idx = lines.findIndex((l) => /TIER\s*2\s*-\s*Common Scheme/i.test(l));

  const holdings: NpsHoldingRow[] = [];
  const tiers: NpsTierSummary[] = [];

  if (t1Start >= 0) {
    const end = t2Idx > t1Start ? t2Idx : lines.length;
    const { summary, holdings: h } = parseTierBlock(lines, t1Start, end, "T1", pran, pf);
    summary.status = tier1Status;
    summary.xirr_since_inception_pct = tier1Xirr;
    tiers.push(summary);
    holdings.push(...h);
  }

  if (t2Idx >= 0) {
    // Tier 2 block ends at charge schedule / notes
    const end = lines.findIndex(
      (l, idx) => idx > t2Idx && (/Intermediary\s+Charge Head|Mode of\s*$|For physical PRAN Kit|Notes:/i.test(l)),
    );
    const { summary, holdings: h } = parseTierBlock(
      lines,
      t2Idx,
      end > t2Idx ? end : lines.length,
      "T2",
      pran,
      pf,
    );
    summary.status = tier2Status;
    summary.xirr_since_inception_pct = tier2Xirr;
    tiers.push(summary);
    holdings.push(...h);
  }

  const round2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  const total = holdings.reduce((s, h) => s + (Number(h.market_value_inr) || 0), 0);
  const tierTotal = tiers.reduce((s, t) => s + (Number(t.current_valuation_inr) || 0), 0);

  return {
    kind: "nps",
    source_file: fileName,
    period_from: period.from,
    period_to: period.to,
    statement_date: statement_date_raw ? normalizeSpaceDate(statement_date_raw) : null,
    investor_name,
    investor_pan: extractPan(text),
    pran,
    pran_generated_date: pran_generated_date_raw ? normalizeSpaceDate(pran_generated_date_raw) : null,
    address: addressParts.length ? addressParts.join(", ") : null,
    mobile,
    email,
    pop_name,
    pop_registration_no,
    total_value_inr: tierTotal > 0 ? round2(tierTotal) : holdings.length ? round2(total) : null,
    tiers,
    holdings,
    nominees,
  };
}

/** Extract NPS rows from CDSL-style embedded sections (PRAN required). */
export function parseNpsHoldingsFromLines(linesIn: string[]): NpsHoldingRow[] {
  const lines = cleanLines(linesIn);
  if (!hasNpsContent(lines)) return [];
  if (isCraStatement(lines.join("\n"))) {
    return parseCraStatement(lines, "nps.pdf").holdings;
  }

  const holdings: NpsHoldingRow[] = [];
  const text = lines.join("\n");
  const pran = text.match(/PRAN\s*[:.]?\s*(\d{12})/i)?.[1] ?? null;
  let start = lines.findIndex((l) => /PRAN\s*[:.]?\s*\d{12}/i.test(l));
  if (start < 0) return [];
  const end = lines.findIndex(
    (l, idx) => idx > start && (/NOTES TO CAS|ABOUT CDSL|Load Structures|^NOTES\b/i.test(l)),
  );
  const slice = lines.slice(start, end > start ? end : Math.min(lines.length, start + 80));
  let tier: NpsHoldingRow["tier"] = "unknown";
  for (const line of slice) {
    if (/notes to cas|about cdsl|communiqu|circular|grievance/i.test(line)) break;
    if (/tier\s*[-–]?\s*i\b|tier\s*1\b|\bT1\b/i.test(line)) tier = "T1";
    if (/tier\s*[-–]?\s*ii\b|tier\s*2\b|\bT2\b/i.test(line)) tier = "T2";
    const m = line.match(/^(.+?)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d{2})\s*$/);
    if (!m) continue;
    const scheme_name = m[1]!.replace(ISIN_RE, "").trim();
    if (scheme_name.length < 3 || /PRAN|Total|Opening|Closing|page\s+\d+/i.test(scheme_name)) continue;
    holdings.push({
      pran,
      tier,
      scheme_name,
      scheme_code: line.match(ISIN_RE)?.[1]?.toUpperCase() ?? null,
      allocation_pct: null,
      pension_fund: null,
      invested_amount_inr: null,
      units: parseMoney(m[2]!),
      nav_inr: parseMoney(m[3]!),
      market_value_inr: parseMoney(m[4]!),
      contribution_inr: null,
      unrealised_gain_inr: null,
    });
  }
  return holdings;
}

export function parseNpsFromLines(linesIn: string[], fileName = "nps.pdf"): ParsedNpsStatement {
  const lines = cleanLines(linesIn);
  const text = lines.join("\n");

  if (isCraStatement(text)) {
    return parseCraStatement(lines, fileName);
  }

  const period = extractPeriod(text);
  const holdings = parseNpsHoldingsFromLines(lines);
  const pran = text.match(/PRAN\s*[:.]?\s*(\d{12})/i)?.[1] ?? holdings[0]?.pran ?? null;
  const total = holdings.reduce((s, h) => s + (Number(h.market_value_inr) || 0), 0);

  return {
    kind: "nps",
    source_file: fileName,
    period_from: period.from,
    period_to: period.to,
    statement_date: null,
    investor_name: text.match(/(?:Subscriber Name|Name of Subscriber)\s*[:.]?\s*([A-Za-z .]+)/i)?.[1]?.trim() ?? null,
    investor_pan: extractPan(text),
    pran,
    pran_generated_date: null,
    address: null,
    mobile: null,
    email: null,
    pop_name: null,
    pop_registration_no: null,
    total_value_inr: holdings.length ? String(total) : null,
    tiers: [],
    holdings,
    nominees: [],
  };
}

export function parseNpsText(text: string, fileName = "nps.pdf"): ParsedNpsStatement {
  return parseNpsFromLines(text.split(/\r?\n/), fileName);
}
