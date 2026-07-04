/**
 * CDSL Consolidated Account Statement (demat + MF folios + optional NPS).
 * Text-line parser (mobile-safe, same approach as CAMS CAS).
 */

import { parseNpsHoldingsFromLines } from "./npsParser";
import type {
  DematHoldingRow,
  DematTransactionRow,
  MfHoldingRow,
  ParsedCdslStatement,
  StatementTransaction,
} from "./statementTypes";
import {
  DATE_ISO_RE,
  DATE_RE,
  ISIN_RE,
  cleanLines,
  englishOnlyText,
  extractCdslInvestorName,
  extractPan,
  extractPeriod,
  isBoilerLine,
  isEnglishSecurityLine,
  moneyTokens,
  normalizeDate,
  parseMoney,
  parsePct,
} from "./statementUtils";

type DematAccount = ParsedCdslStatement["demat_accounts"][number];

function parseDematAccounts(lines: string[]): DematAccount[] {
  const accounts: DematAccount[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const dp = line.match(/DP Name\s*:\s*(.+?)\s+DP ID\s*:\s*(\d{8})\s+CLIENT ID\s*:\s*(\d{8})/i);
    if (dp) {
      accounts.push({
        dp_name: dp[1]!.replace(/DP का नाम:.*/i, "").trim(),
        dp_id: dp[2]!,
        client_id: dp[3]!,
        bo_id: `${dp[2]}${dp[3]}`,
        value_inr: null,
      });
      continue;
    }
    // Summary table style
    const summary = line.match(/CDSL Demat Account\s+(\d+)\s+([\d,]+\.\d{2})/i);
    if (summary && accounts.length) {
      /* skip — values often on separate structure */
    }
  }

  // BO ID lines: BO ID: 1204720002628607
  for (const line of lines) {
    const bo = line.match(/BO ID\s*:\s*(\d{16})/i);
    const dpName = line.match(/DP Name\s*:\s*([^:]+?)(?:\s+DP|\s+BO|$)/i);
    if (bo) {
      const boId = bo[1]!;
      const dp_id = boId.slice(0, 8);
      const client_id = boId.slice(8);
      if (!accounts.some((a) => a.bo_id === boId)) {
        accounts.push({
          dp_name: dpName?.[1]?.trim() ?? null,
          dp_id,
          client_id,
          bo_id: boId,
          value_inr: null,
        });
      }
    }
  }

  // Values from summary block (name/value may span lines)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!/CDSL Demat Account/i.test(line)) continue;
    const window = [line, lines[i + 1] ?? "", lines[i + 2] ?? ""].join(" ");
    const dpIdM = window.match(/DP Id:\s*(\d{8})\s*Client Id\s*:\s*(\d{8})/i);
    if (!dpIdM) continue;
    const toks = moneyTokens(window);
    // last money token before DP Id is usually the value
    const beforeDp = window.slice(0, window.search(/DP Id:/i));
    const valToks = moneyTokens(beforeDp);
    const val = valToks.length ? parseMoney(valToks[valToks.length - 1]!) : null;
    const bo_id = `${dpIdM[1]}${dpIdM[2]}`;
    const existing = accounts.find((a) => a.bo_id === bo_id);
    const dpName =
      beforeDp
        .replace(/CDSL Demat Account/i, "")
        .replace(/[\d,]+\.\d+/g, "")
        .replace(/\b\d+\b/g, "")
        .replace(/\s+/g, " ")
        .trim() || null;
    if (existing) {
      if (val != null) existing.value_inr = val;
      if (dpName && !existing.dp_name) existing.dp_name = dpName;
    } else {
      accounts.push({
        dp_name: dpName,
        dp_id: dpIdM[1]!,
        client_id: dpIdM[2]!,
        bo_id,
        value_inr: val,
      });
    }
    void toks;
  }

  return accounts;
}

/** Match holding qty/price/value cluster: current … free price value */
function parseHoldingNumbers(line: string): {
  current: string | null;
  free: string | null;
  price: string | null;
  value: string | null;
} | null {
  // Prefer explicit "--" separated pattern from CDSL
  const dashed = line.match(
    /([\d,]+\.\d+)\s+(?:--\s+){1,4}([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d{2})\s*$/,
  );
  if (dashed) {
    return {
      current: parseMoney(dashed[1]!),
      free: parseMoney(dashed[2]!),
      price: parseMoney(dashed[3]!),
      value: parseMoney(dashed[4]!),
    };
  }
  const toks = moneyTokens(line);
  if (toks.length < 3) return null;
  // last = value (2dp), second last = price, first = current balance
  const value = parseMoney(toks[toks.length - 1]!);
  const price = parseMoney(toks[toks.length - 2]!);
  const current = parseMoney(toks[0]!);
  const free = toks.length >= 4 ? parseMoney(toks[toks.length - 3]!) : current;
  if (value == null || current == null) return null;
  // Sanity: market value should be roughly qty * price when both present
  return { current, free, price, value };
}

function isDematSectionBoiler(line: string): boolean {
  if (isBoilerLine(line)) return true;
  if (!line.trim()) return true;
  if (
    /^(Page|Central Depository|CONSOLIDATED ACCOUNT|FORM AND|Investments Account|Account Details|Market|Current|Frozen|Pledge|Free Bal|Pending|Demat\s+Remat|Setup|Value)$/i.test(
      line.trim(),
    )
  ) {
    return true;
  }
  if (/HOLDING STATEMENT|MUTUAL FUND UNITS|Portfolio Value|ISIN ISIN/i.test(line)) return true;
  if (/^Bal\s|^Bal$|Face Value|शेष|मूल्य|लॉक|तारीख/i.test(line)) return true;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(line.trim())) return true;
  return false;
}

function stripInlineMetricsFromIsinTail(text: string): string {
  return text.replace(/\s+[\d,]+\.\d+(\s+(?:--\s+)?[\d,]+\.\d+)*.*$/, "").trim();
}

function dedupeNameParts(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const cleaned = part.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out
    .join(" ")
    .replace(/\s+[\d,]+\.\d+(\s+--\s*)+/g, " ")
    .replace(/\s+--\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectDematSecurityName(slice: string[], isinIdx: number, isinLine: string): string {
  const parts: string[] = [];
  for (let k = isinIdx - 1; k >= Math.max(0, isinIdx - 6); k -= 1) {
    const prev = slice[k]!;
    if (ISIN_RE.test(prev)) break;
    if (parseHoldingNumbers(prev)) break;
    if (isDematSectionBoiler(prev)) continue;
    if (isEnglishSecurityLine(prev)) {
      parts.unshift(englishOnlyText(prev.replace(/^@\s*/, "")));
    }
  }

  const afterIsin = stripInlineMetricsFromIsinTail(isinLine.replace(ISIN_RE, " ").trim());
  if (afterIsin && isEnglishSecurityLine(afterIsin)) {
    parts.push(englishOnlyText(afterIsin));
  }

  const isinHasInlineMetrics = parseHoldingNumbers(isinLine) != null;
  const skipForward = isinHasInlineMetrics && afterIsin.length > 0;
  const forwardLimit = isinHasInlineMetrics ? 2 : 5;
  let j = isinIdx + 1;
  let forwardNameLines = 0;
  if (!skipForward) {
    while (j < slice.length && j < isinIdx + forwardLimit) {
      const nxt = slice[j]!;
      if (ISIN_RE.test(nxt)) break;
      if (parseHoldingNumbers(nxt)) break;
      if (moneyTokens(nxt).length >= 2) break;
      if (isDematSectionBoiler(nxt)) {
        j += 1;
        continue;
      }
      if (isEnglishSecurityLine(nxt)) {
        parts.push(englishOnlyText(nxt));
        forwardNameLines += 1;
        j += 1;
        if (isinHasInlineMetrics && forwardNameLines >= 1) break;
        continue;
      }
      break;
    }
  }

  return dedupeNameParts(parts);
}

function findMainDematHoldingsEnd(lines: string[], holdStart: number): number {
  for (let idx = holdStart + 1; idx < lines.length; idx += 1) {
    if (/HOLDING STATEMENT AS ON.*Other Details/i.test(lines[idx]!)) return idx;
  }
  const pv = lines.findIndex((l, idx) => idx > holdStart && /Portfolio Value\s*`?\s*[\d,]/i.test(l));
  return pv > holdStart ? pv : lines.length;
}

function activeDematAccount(accounts: DematAccount[]): DematAccount | undefined {
  return (
    [...accounts].find((a) => a.value_inr && Number(a.value_inr) > 0) ??
    [...accounts].reverse().find((a) => a.dp_name && /SBICAP|ZERODHA|GROWW|ANGEL/i.test(a.dp_name)) ??
    accounts[accounts.length - 1]
  );
}

function parseDematHoldings(lines: string[], accounts: DematAccount[]): DematHoldingRow[] {
  const holdings: DematHoldingRow[] = [];
  const holdStart = lines.findIndex((l) => /HOLDING STATEMENT AS ON/i.test(l) && !/Other Details/i.test(l));
  if (holdStart < 0) return holdings;

  const active = activeDematAccount(accounts);
  const end = findMainDematHoldingsEnd(lines, holdStart);
  const slice = lines.slice(holdStart, end);

  let i = 0;
  while (i < slice.length) {
    const line = slice[i]!;
    if (isDematSectionBoiler(line)) {
      i += 1;
      continue;
    }

    const isinM = line.match(ISIN_RE);
    if (!isinM) {
      i += 1;
      continue;
    }
    const isin = isinM[1]!.toUpperCase();
    const security_name = collectDematSecurityName(slice, i, line);

    let parsed = parseHoldingNumbers(line);
    let j = i + 1;
    while (j < slice.length && j < i + 6) {
      const nxt = slice[j]!;
      if (ISIN_RE.test(nxt)) break;
      const nxtParsed = parseHoldingNumbers(nxt);
      if (nxtParsed) {
        parsed = nxtParsed;
        j += 1;
        break;
      }
      if (isDematSectionBoiler(nxt)) {
        j += 1;
        continue;
      }
      if (!isEnglishSecurityLine(nxt) && moneyTokens(nxt).length < 2) {
        j += 1;
        continue;
      }
      break;
    }

    if (parsed && security_name) {
      const priceNum = Number(parsed.price ?? 0);
      const valueNum = Number(parsed.value ?? 0);
      if (priceNum > 0 || valueNum > 0) {
        holdings.push({
          isin,
          security_name,
          current_balance: parsed.current ?? "0",
          free_balance: parsed.free,
          pledge_balance: null,
          frozen_balance: null,
          market_price_inr: parsed.price,
          market_value_inr: parsed.value,
          dp_id: active?.dp_id ?? null,
          client_id: active?.client_id ?? null,
          bo_id: active?.bo_id ?? null,
          dp_name: active?.dp_name ?? null,
          is_locked: false,
        });
      }
    }
    i = Math.max(j, i + 1);
  }

  return holdings;
}

const LOCK_ROW_RE =
  /^(IN[A-Z0-9]{10})\s+(?:(\d{2}-\d{2}-\d{4})\s+\S+\s+)?([\d,]+\.\d+)\s+0\.?0*0\s+0\.?0*0/i;
const LOCK_DATE_ROW_RE = /^(\d{2}-\d{2}-\d{4})\s+\S+\s+([\d,]+\.\d+)\s+0\.?0*0\s+0\.?0*0/i;

function parseLockedDematHoldings(lines: string[], accounts: DematAccount[]): DematHoldingRow[] {
  const holdings: DematHoldingRow[] = [];
  const lockStart = lines.findIndex((l) => /HOLDING STATEMENT AS ON.*Other Details/i.test(l));
  if (lockStart < 0) return holdings;

  const active = activeDematAccount(accounts);
  const end = lines.findIndex((l, idx) => idx > lockStart && /Portfolio Value\s*`?\s*[\d,]/i.test(l));
  const slice = lines.slice(lockStart, end > lockStart ? end : undefined);

  let i = 0;
  while (i < slice.length) {
    const line = slice[i]!;
    if (isDematSectionBoiler(line) && !ISIN_RE.test(line)) {
      i += 1;
      continue;
    }

    const isinM = line.match(ISIN_RE);
    if (!isinM) {
      i += 1;
      continue;
    }

    const isin = isinM[1]!.toUpperCase();
    const nameParts: string[] = [];
    for (let k = i - 1; k >= Math.max(0, i - 4); k -= 1) {
      const prev = slice[k]!;
      if (ISIN_RE.test(prev)) break;
      if (LOCK_DATE_ROW_RE.test(prev)) break;
      if (isDematSectionBoiler(prev)) continue;
      if (isEnglishSecurityLine(prev)) nameParts.unshift(englishOnlyText(prev));
    }

    let releaseDate: string | null = null;
    let qty: string | null = null;
    let j = i + 1;

    const inline = line.match(LOCK_ROW_RE);
    if (inline) {
      releaseDate = inline[2] ? normalizeDate(inline[2]) : null;
      qty = parseMoney(inline[3]!);
    } else {
      const afterIsin = stripInlineMetricsFromIsinTail(line.replace(ISIN_RE, " ").trim());
      if (afterIsin && isEnglishSecurityLine(afterIsin)) nameParts.push(englishOnlyText(afterIsin));

      while (j < slice.length && j < i + 5) {
        const nxt = slice[j]!;
        if (ISIN_RE.test(nxt)) break;
        if (LOCK_DATE_ROW_RE.test(nxt)) {
          releaseDate = normalizeDate(nxt.match(LOCK_DATE_ROW_RE)![1]!);
          qty = parseMoney(nxt.match(LOCK_DATE_ROW_RE)![2]!);
          j += 1;
          break;
        }
        if (isEnglishSecurityLine(nxt)) {
          nameParts.push(englishOnlyText(nxt));
          j += 1;
          continue;
        }
        if (!isDematSectionBoiler(nxt)) break;
        j += 1;
      }
    }

    if (qty) {
      const security_name = dedupeNameParts(nameParts) || isin;
      holdings.push({
        isin,
        security_name,
        current_balance: qty,
        free_balance: null,
        pledge_balance: null,
        frozen_balance: null,
        market_price_inr: null,
        market_value_inr: null,
        dp_id: active?.dp_id ?? null,
        client_id: active?.client_id ?? null,
        bo_id: active?.bo_id ?? null,
        dp_name: active?.dp_name ?? null,
        is_locked: true,
        lockin_release_date: releaseDate,
      });
    }
    i = Math.max(j, i + 1);
  }

  return holdings;
}

function parseDematTransactions(lines: string[], accounts: DematAccount[]): DematTransactionRow[] {
  const txns: DematTransactionRow[] = [];
  let currentBo: DematAccount | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const boM = line.match(/BO ID\s*:\s*(\d{16})/i);
    if (boM) {
      const bo_id = boM[1]!;
      currentBo = accounts.find((a) => a.bo_id === bo_id) ?? {
        dp_name: null,
        dp_id: bo_id.slice(0, 8),
        client_id: bo_id.slice(8),
        bo_id,
        value_inr: null,
      };
    }

    if (/HOLDING STATEMENT AS ON/i.test(line)) break;
    if (/MUTUAL FUND UNITS HELD/i.test(line)) break;

    const dateM = line.match(DATE_ISO_RE) ?? line.match(DATE_RE);
    const isinM = line.match(ISIN_RE);
    if (!dateM || !isinM) continue;

    // Collect security name from previous lines
    const nameParts: string[] = [];
    for (let k = Math.max(0, i - 4); k < i; k += 1) {
      const prev = lines[k]!;
      if (ISIN_RE.test(prev) || DATE_ISO_RE.test(prev) || DATE_RE.test(prev)) continue;
      if (isBoilerLine(prev) || /Stamp|Transaction|Op\. Bal|Credit|Debit/i.test(prev)) continue;
      if (moneyTokens(prev).length >= 4) continue;
      nameParts.push(prev);
    }

    const afterDate = line.slice(dateM.index! + dateM[0].length);
    let nums = moneyTokens(afterDate);
    let desc = "";
    // Sometimes ISIN and date on different lines — look at surrounding
    if (nums.length < 3) {
      const combined = `${lines[i - 1] ?? ""} ${line} ${lines[i + 1] ?? ""}`;
      nums = moneyTokens(combined.replace(ISIN_RE, "").replace(DATE_ISO_RE, "").replace(DATE_RE, ""));
    }

    // Op, Credit, Debit, Cl, Stamp — debit may be "--"
    const parts = afterDate.split(/\s+/);
    void parts;
    const tokens = afterDate.match(/(\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|--)/g) ?? [];
    let opening: string | null = null;
    let credit: string | null = null;
    let debit: string | null = null;
    let closing: string | null = null;
    let stamp: string | null = null;
    if (tokens.length >= 4) {
      opening = parseMoney(tokens[0]!);
      credit = tokens[1] === "--" ? null : parseMoney(tokens[1]!);
      debit = tokens[2] === "--" ? null : parseMoney(tokens[2]!);
      closing = parseMoney(tokens[3]!);
      if (tokens[4]) stamp = parseMoney(tokens[4]!);
    } else if (nums.length >= 4) {
      opening = parseMoney(nums[0]!);
      credit = parseMoney(nums[1]!);
      debit = parseMoney(nums[2]!);
      closing = parseMoney(nums[3]!);
    }

    // Description tokens like PAYOUT-CR, CA-Rearrangement from nearby lines
    for (let k = Math.max(0, i - 5); k <= i; k += 1) {
      const p = lines[k]!;
      if (/PAYOUT|SETT|CA-Rearrangement|EP-DR|Cr Current|Balance/i.test(p) && p.length < 60) {
        desc = desc ? `${desc}; ${p}` : p;
      }
    }

    txns.push({
      date: normalizeDate(dateM[1]!),
      isin: isinM[1]!.toUpperCase(),
      security_name: nameParts.join(" ").replace(/\s+/g, " ").trim(),
      description: desc || "Transaction",
      opening_balance: opening,
      credit,
      debit,
      closing_balance: closing,
      stamp_duty_inr: stamp,
      dp_id: currentBo?.dp_id ?? null,
      client_id: currentBo?.client_id ?? null,
      bo_id: currentBo?.bo_id ?? null,
    });
  }

  return txns;
}

const PARTIAL_ISIN_ONLY_RE = /^\s*(IN[A-Z0-9]{8,11})\s*$/i;
const MF_SCHEME_CODE_RE = /^[A-Z0-9]{2,6}\s*-\s*/;
const MF_FOLIO_RE = /\b(\d{5,}(?:\/\d+)?)\b/;

function isMfSectionBoiler(line: string): boolean {
  if (isBoilerLine(line)) return true;
  if (!line.trim()) return true;
  if (
    /MUTUAL FUND UNITS HELD|Scheme Name|Folio No|Grand Total|Load Structures|Unrealised|Profit\/Loss|Cumulative|Annuali|Closing|INR\)|Valuation|Central Depository|CONSOLIDATED ACCOUNT|FORM AND|Page \d+|A Wing|Lower Parel|Mafatlal|Joshi Marg|sebi has mandated/i.test(
      line,
    )
  ) {
    return true;
  }
  return false;
}

function isMfMetricsDataLine(line: string): boolean {
  if (ISIN_RE.test(line) && moneyTokens(line.replace(ISIN_RE, " ")).length >= 4) return true;
  if (!ISIN_RE.test(line) && moneyTokens(line).length >= 6) return true;
  if (/\d{5,}(?:\/\d+)?/.test(line) && moneyTokens(line).length >= 4) return true;
  return false;
}

function isMfSchemeLine(line: string): boolean {
  if (isMfSectionBoiler(line)) return false;
  if (/\uFFFD/.test(line)) return false;
  const t = englishOnlyText(line);
  if (t.length < 2) return false;
  if (/^(sed |Unrealised|Scheme Name|Invested|Return|Valuation|Closing|Cumulative|Bal\s*\()/i.test(t)) return false;
  if (/\( NAV \)|INR\)/i.test(line)) return false;
  if (MF_SCHEME_CODE_RE.test(t)) return true;
  if (isEnglishSecurityLine(line)) return true;
  if (/fund|plan|growth|elss|cap|etf|liquid|equity|tax|saver|direct|regular|option|birla|axis|icici|kotak|nippon|sbi|tata|mirae|motilal|bandhan|invesco|ppfas/i.test(t)) {
    return true;
  }
  return /^[A-Za-z]/.test(t) && t.length >= 3;
}

function findPrevIsinIndex(slice: string[], fromIdx: number): number {
  for (let k = fromIdx - 1; k >= 0; k -= 1) {
    if (ISIN_RE.test(slice[k]!)) return k;
  }
  return -1;
}

function mfSchemeBlockStart(slice: string[], prevIsinIdx: number, beforeIdx: number): number {
  if (prevIsinIdx < 0) {
    for (let k = beforeIdx - 1; k >= Math.max(0, beforeIdx - 15); k -= 1) {
      const clean = englishOnlyText(slice[k]!);
      if (MF_SCHEME_CODE_RE.test(clean)) return k;
    }
    return Math.max(0, beforeIdx - 6);
  }
  for (let k = prevIsinIdx + 1; k < beforeIdx; k += 1) {
    const clean = englishOnlyText(slice[k]!);
    if (MF_SCHEME_CODE_RE.test(clean)) return k;
  }
  return prevIsinIdx + 1;
}

function collectMfSchemeName(slice: string[], isinIdx: number): string {
  const parts: string[] = [];
  const prevIsinIdx = findPrevIsinIndex(slice, isinIdx);
  const start = mfSchemeBlockStart(slice, prevIsinIdx, isinIdx);

  for (let k = isinIdx - 1; k >= start; k -= 1) {
    const prev = slice[k]!;
    if (ISIN_RE.test(prev)) break;
    if (isMfMetricsDataLine(prev)) break;
    if (isMfSectionBoiler(prev)) continue;
    if (isMfSchemeLine(prev)) parts.unshift(englishOnlyText(prev));
  }

  for (let j = isinIdx + 1; j < Math.min(slice.length, isinIdx + 8); j += 1) {
    const nxt = slice[j]!;
    if (ISIN_RE.test(nxt)) break;
    if (isMfMetricsDataLine(nxt)) break;
    if (isMfSectionBoiler(nxt)) break;
    const clean = englishOnlyText(nxt);
    if (MF_SCHEME_CODE_RE.test(clean)) break;
    if (isMfSchemeLine(nxt)) parts.push(clean);
    else break;
  }
  return dedupeNameParts(parts);
}

/** CDSL sometimes splits ISIN across lines: INF769K01D / metrics / M9 */
function repairSplitIsinMfLines(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const partial = line.match(PARTIAL_ISIN_ONLY_RE)?.[1];
    if (partial && partial.length < 12) {
      const prefix = partial.toUpperCase();
      const need = 12 - prefix.length;
      const metricsLine = lines[i + 1]?.trim() ?? "";
      const suffixLine = lines[i + 2]?.trim() ?? "";
      const sfxM = suffixLine.match(new RegExp(`^([A-Z0-9]{${need}})\\b`, "i"));
      if (sfxM && /[\d,]+\.\d+/.test(metricsLine)) {
        const fullIsin = prefix + sfxM[1]!.toUpperCase();
        if (/^IN[A-Z0-9]{10}$/.test(fullIsin)) {
          out.push(`${fullIsin}   ${metricsLine}`);
          i += 3;
          continue;
        }
      }
    }
    out.push(line);
    i += 1;
  }
  return out;
}

function parseMfMetricsFromIsinLine(line: string, isin: string): {
  folio: string | null;
  units: string | null;
  nav: string | null;
  cost: string | null;
  market: string | null;
  gainPct: string | null;
} {
  let rest = line.replace(new RegExp(`\\b${isin}\\b`, "i"), " ");
  let folio: string | null = null;
  const folioM = rest.match(MF_FOLIO_RE);
  if (folioM) {
    folio = folioM[1]!;
    rest = rest.replace(folioM[0], " ");
  }
  const numMatch = rest.match(
    /([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d+)/,
  );
  if (numMatch) {
    return {
      folio,
      units: parseMoney(numMatch[1]!),
      nav: parseMoney(numMatch[2]!),
      cost: parseMoney(numMatch[3]!),
      market: parseMoney(numMatch[4]!),
      gainPct: parsePct(numMatch[6]!),
    };
  }
  const toks = moneyTokens(rest);
  if (toks.length >= 6) {
    return {
      folio,
      units: parseMoney(toks[0]!),
      nav: parseMoney(toks[1]!),
      cost: parseMoney(toks[2]!),
      market: parseMoney(toks[3]!),
      gainPct: parsePct(toks[5]!),
    };
  }
  return { folio, units: null, nav: null, cost: null, market: null, gainPct: null };
}

function splitMfSchemeCode(scheme_name: string): { scheme_code: string | null; scheme_name: string } {
  const m = scheme_name.match(/^([A-Z0-9]{2,6})\s*-\s*(.+)$/);
  if (m) return { scheme_code: m[1]!, scheme_name: m[2]!.trim() };
  return { scheme_code: null, scheme_name };
}

function parseCdslMfHoldings(lines: string[]): MfHoldingRow[] {
  const holdings: MfHoldingRow[] = [];
  const start = lines.findIndex((l) => /MUTUAL FUND UNITS HELD AS ON/i.test(l));
  if (start < 0) return holdings;

  const end = lines.findIndex((l, idx) => idx > start && (/Grand Total/i.test(l) || /Load Structures/i.test(l)));
  const slice = repairSplitIsinMfLines(lines.slice(start, end > start ? end + 1 : undefined));

  let i = 0;
  while (i < slice.length) {
    const line = slice[i]!;
    if (isMfSectionBoiler(line)) {
      i += 1;
      continue;
    }

    const isinM = line.match(ISIN_RE);
    if (isinM) {
      const isin = isinM[1]!.toUpperCase();
      const scheme_name_raw = collectMfSchemeName(slice, i);
      const metrics = parseMfMetricsFromIsinLine(line, isin);

      if (metrics.units && metrics.market) {
        holdings.push({
          amc: null,
          folio_no: metrics.folio,
          isin,
          scheme_code: splitMfSchemeCode(scheme_name_raw).scheme_code,
          scheme_name: scheme_name_raw || null,
          closing_units: metrics.units,
          nav_inr: metrics.nav,
          cost_value_inr: metrics.cost,
          market_value_inr: metrics.market,
          gain_pct: metrics.gainPct,
          plan_tag: null,
          transactions: [],
        });
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  return holdings;
}

function parseCdslMfTransactions(lines: string[], holdings: MfHoldingRow[]): void {
  const start = lines.findIndex((l) => /MUTUAL FUND UNITS HELD WITH MF\/RTA/i.test(l));
  const holdAsOn = lines.findIndex((l) => /MUTUAL FUND UNITS HELD AS ON/i.test(l));
  if (start < 0) return;
  const slice = lines.slice(start, holdAsOn > start ? holdAsOn : undefined);

  let amc: string | null = null;
  let scheme: string | null = null;
  let isin: string | null = null;
  let folio: string | null = null;
  let pending: StatementTransaction[] = [];

  const flush = () => {
    if (!pending.length) return;
    const target =
      holdings.find((h) => h.isin === isin && (!folio || h.folio_no === folio)) ??
      holdings.find((h) => h.isin === isin);
    if (target) {
      target.transactions.push(...pending);
      if (amc && !target.amc) target.amc = amc;
      if (scheme && !target.scheme_name) target.scheme_name = scheme;
    }
    pending = [];
  };

  for (let i = 0; i < slice.length; i += 1) {
    const line = slice[i]!;
    if (/Mutual Fund$/i.test(line) && !/units held/i.test(line)) {
      flush();
      amc = line.trim();
      continue;
    }
    const isinM = line.match(/ISIN\s*:\s*(IN[A-Z0-9]{10})/i);
    if (isinM) {
      flush();
      isin = isinM[1]!.toUpperCase();
      continue;
    }
    if (/^[A-Z0-9].*Fund/i.test(line) && !/Mutual Fund$/i.test(line) && moneyTokens(line).length < 2) {
      scheme = line.replace(/^\d+\s*-\s*/, "").trim();
      const codeM = line.match(/^(\d+|[A-Z]{2,5})\s*-\s*/);
      void codeM;
      continue;
    }
    if (/^Opening Balance/i.test(line)) {
      const u = parseMoney(moneyTokens(line)[0] ?? null);
      pending.push({
        date: "",
        description: "Opening Balance",
        amount_inr: null,
        units: null,
        price_inr: null,
        nav_inr: null,
        unit_balance: u,
      });
      continue;
    }
    if (/^Closing Balance/i.test(line)) {
      const u = parseMoney(moneyTokens(line)[0] ?? null);
      pending.push({
        date: "",
        description: "Closing Balance",
        amount_inr: null,
        units: null,
        price_inr: null,
        nav_inr: null,
        unit_balance: u,
      });
      flush();
      continue;
    }

    const dateM = line.match(DATE_ISO_RE) ?? line.match(DATE_RE);
    if (dateM) {
      let block = line.slice(dateM.index! + dateM[0].length);
      let j = i + 1;
      while (j < slice.length && j < i + 4) {
        const nxt = slice[j]!;
        if ((DATE_ISO_RE.test(nxt) || DATE_RE.test(nxt)) && j > i) break;
        if (/^Closing Balance|^Opening Balance|ISIN\s*:/i.test(nxt)) break;
        block = `${block} ${nxt}`;
        j += 1;
        // stop once we have amount nav price units
        if (
          block.match(/([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/)
        ) {
          break;
        }
      }
      // Strip instalment markers like 179/470 and long reference ids
      const cleaned = block
        .replace(/\b\d{1,4}\/\d{1,4}\b/g, " ")
        .replace(/\b\d{8,}\b/g, " ")
        .replace(/ARN-[\w/]+/gi, " ");
      const m = cleaned.match(
        /([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/,
      );
      if (m) {
        const desc = cleaned
          .slice(0, cleaned.indexOf(m[0]))
          .replace(/\s+/g, " ")
          .trim();
        pending.push({
          date: normalizeDate(dateM[1]!),
          description: desc || "Transaction",
          amount_inr: parseMoney(m[1]!),
          nav_inr: parseMoney(m[2]!),
          price_inr: parseMoney(m[3]!),
          units: parseMoney(m[4]!),
          unit_balance: null,
        });
        i = j - 1;
      }
    }
  }
  flush();
  void folio;
}

const CDSL_AMC_LINE_RE = /AMC Name\s*:\s*(.+)/i;
const CDSL_ISIN_LABEL_RE = /ISIN\s*:\s*(IN[A-Z0-9]{10})/i;
const CDSL_FOLIO_LABEL_RE = /Folio No\s*:\s*([\d/]+)/i;
const CDSL_SCHEME_NAME_RE = /Scheme Name\s*:\s*(.+)/i;

function parseCdslMfAmcByIsin(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < lines.length; i += 1) {
    const amcM = lines[i]!.match(CDSL_AMC_LINE_RE);
    if (!amcM) continue;
    const amc = englishOnlyText(amcM[1]!.trim());
    if (!amc) continue;

    let isin: string | null = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 16); j += 1) {
      const blockLine = lines[j]!;
      if (j > i + 1 && CDSL_AMC_LINE_RE.test(blockLine)) break;
      const isinM = blockLine.match(CDSL_ISIN_LABEL_RE);
      if (isinM) {
        isin = isinM[1]!.toUpperCase();
        break;
      }
    }
    if (isin) map.set(isin, amc);
  }
  return map;
}

function applyCdslMfAmcFromAccountDetails(lines: string[], holdings: MfHoldingRow[]): void {
  const amcByIsin = parseCdslMfAmcByIsin(lines);
  for (const h of holdings) {
    if (!h.isin) continue;
    const amc = amcByIsin.get(h.isin);
    if (amc) h.amc = amc;
  }

  // Enrich scheme / folio from labelled account-detail blocks when helpful
  for (let i = 0; i < lines.length; i += 1) {
    const amcM = lines[i]!.match(CDSL_AMC_LINE_RE);
    if (!amcM) continue;
    const amc = englishOnlyText(amcM[1]!.trim());

    let isin: string | null = null;
    let folio: string | null = null;
    const schemeParts: string[] = [];
    let inScheme = false;

    for (let j = i + 1; j < Math.min(lines.length, i + 16); j += 1) {
      const blockLine = lines[j]!;
      if (j > i + 1 && CDSL_AMC_LINE_RE.test(blockLine)) break;

      const isinM = blockLine.match(CDSL_ISIN_LABEL_RE);
      if (isinM) isin = isinM[1]!.toUpperCase();

      const folioM = blockLine.match(CDSL_FOLIO_LABEL_RE);
      if (folioM) folio = folioM[1]!;

      const schemeM = blockLine.match(CDSL_SCHEME_NAME_RE);
      if (schemeM) {
        schemeParts.length = 0;
        schemeParts.push(englishOnlyText(schemeM[1]!.trim()));
        inScheme = true;
        continue;
      }

      if (inScheme) {
        if (/Scheme Code|Folio No|KYC|ISIN|Mode of Holding|Nominee|Email id/i.test(blockLine)) {
          inScheme = false;
        } else if (blockLine.length < 100 && !isBoilerLine(blockLine)) {
          schemeParts.push(englishOnlyText(blockLine));
        }
      }
    }

    if (!isin) continue;
    const targets = holdings.filter((h) => h.isin === isin && (!folio || h.folio_no === folio));
    const scheme_name = dedupeNameParts(schemeParts);
    for (const h of targets.length ? targets : holdings.filter((x) => x.isin === isin)) {
      if (amc) h.amc = amc;
      if (scheme_name && (!h.scheme_name || h.scheme_name.length < scheme_name.length * 0.6)) {
        h.scheme_name = scheme_name;
      }
      if (folio && !h.folio_no) h.folio_no = folio;
    }
  }
}

export function parseCdslFromLines(linesIn: string[], fileName = "cdsl-cas.pdf"): ParsedCdslStatement {
  const lines = cleanLines(linesIn);
  const text = lines.join("\n");
  const period = extractPeriod(text);

  const casId = text.match(/CAS ID:\s*([A-Z0-9]+)/i)?.[1] ?? null;
  const pan = extractPan(text);
  const investor_name = extractCdslInvestorName(lines);

  const addrParts: string[] = [];
  for (const l of lines.slice(0, 50)) {
    if (/PINCODE:|UTTAR PRADESH|GHAZIABAD|SHIVPURI|HAPUR/i.test(l)) addrParts.push(l);
  }

  const totalM = text.match(/Total Portfolio Value\s+([\d,]+\.\d{2})/i);
  const dematVal = text.match(/CDSL Demat Accounts?\s*\n?\s*([\d,]+\.\d{2})/i);
  const mfVal = text.match(/Mutual Fund Folios\s*\n?\s*([\d,]+\.\d{2})/i);

  // Summary block values
  let demat_value_inr: string | null = dematVal ? parseMoney(dematVal[1]!) : null;
  let mf_folios_value_inr: string | null = mfVal ? parseMoney(mfVal[1]!) : null;
  const summaryMf = lines.find((l) => /Mutual Fund Folios\s+\d+\s+Folios/i.test(l));
  if (summaryMf) {
    const toks = moneyTokens(summaryMf);
    if (toks.length) mf_folios_value_inr = parseMoney(toks[toks.length - 1]!);
  }
  for (const l of lines) {
    if (/^CDSL Demat Account/i.test(l)) {
      const toks = moneyTokens(l);
      if (toks.length && Number(parseMoney(toks[toks.length - 1]!)) > 0) {
        demat_value_inr = parseMoney(toks[toks.length - 1]!);
      }
    }
  }

  const accounts = parseDematAccounts(lines);
  const demat_holdings = parseDematHoldings(lines, accounts);
  const locked_demat_holdings = parseLockedDematHoldings(lines, accounts);
  const demat_transactions = parseDematTransactions(lines, accounts);
  const mf_holdings = parseCdslMfHoldings(lines);
  parseCdslMfTransactions(lines, mf_holdings);
  applyCdslMfAmcFromAccountDetails(lines, mf_holdings);

  const nps_holdings = parseNpsHoldingsFromLines(lines);
  const nps_value_inr = nps_holdings.length
    ? String(
        nps_holdings.reduce((s, r) => s + (Number(r.market_value_inr) || 0), 0),
      )
    : null;

  return {
    kind: "cdsl_cas",
    source_file: fileName,
    cas_id: casId,
    period_from: period.from,
    period_to: period.to,
    investor_name,
    investor_pan: pan,
    address: addrParts.length ? addrParts.join(", ") : null,
    total_portfolio_value_inr: totalM ? parseMoney(totalM[1]!) : parseMoney(text.match(/PORTFOLIO VALUE\s*`?\s*([\d,]+\.\d{2})/i)?.[1] ?? null),
    demat_value_inr,
    mf_folios_value_inr,
    nps_value_inr,
    demat_accounts: accounts,
    demat_holdings,
    locked_demat_holdings,
    demat_transactions,
    mf_holdings,
    nps_holdings,
  };
}

export function parseCdslText(text: string, fileName = "cdsl-cas.pdf"): ParsedCdslStatement {
  return parseCdslFromLines(text.split(/\r?\n/), fileName);
}
