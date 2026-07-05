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
  extractPan,
  extractPeriod,
  isBoilerLine,
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

function parseDematHoldings(lines: string[], accounts: DematAccount[]): DematHoldingRow[] {
  const holdings: DematHoldingRow[] = [];
  const holdStart = lines.findIndex((l) => /HOLDING STATEMENT AS ON/i.test(l));
  if (holdStart < 0) return holdings;

  // Prefer demat account that actually has holdings value
  const active =
    [...accounts].find((a) => a.value_inr && Number(a.value_inr) > 0) ??
    [...accounts].reverse().find((a) => a.dp_name && /SBICAP|ZERODHA|GROWW|ANGEL/i.test(a.dp_name)) ??
    accounts[accounts.length - 1];

  const end = lines.findIndex((l, idx) => idx > holdStart && /Portfolio Value\s*`?\s*[\d,]/i.test(l));
  const slice = lines.slice(holdStart, end > holdStart ? end + 1 : undefined);

  let i = 0;
  while (i < slice.length) {
    const line = slice[i]!;
    if (isBoilerLine(line) || /HOLDING STATEMENT|^\s*Pledge|^\s*Market|^\s*Current|Free Bal|Face Value/i.test(line)) {
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
    for (let k = Math.max(0, i - 3); k < i; k += 1) {
      const prev = slice[k]!;
      if (ISIN_RE.test(prev) || moneyTokens(prev).length >= 3) continue;
      if (isBoilerLine(prev) || /HOLDING STATEMENT|Pledge|Market|Current|Free Bal/i.test(prev)) continue;
      nameParts.push(prev.replace(/^@\s*/, "").replace(/#/g, " ").trim());
    }
    const inlineName = line
      .replace(ISIN_RE, " ")
      .replace(/([\d,]+\.\d+|\s--\s)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (inlineName.length > 2) nameParts.push(inlineName);

    let numsLine = line;
    let parsed = parseHoldingNumbers(line);
    let j = i + 1;
    while (j < slice.length && j < i + 6) {
      const nxt = slice[j]!;
      if (ISIN_RE.test(nxt)) break;
      if (/Portfolio Value/i.test(nxt)) break;
      if (/^(Note:|\*|\$|@|~|!!|##)/.test(nxt)) break;
      const nxtParsed = parseHoldingNumbers(nxt);
      if (nxtParsed) {
        parsed = nxtParsed;
        numsLine = nxt;
        j += 1;
        break;
      }
      if (moneyTokens(nxt).length < 2 && !isBoilerLine(nxt)) {
        nameParts.push(nxt.replace(/^@\s*/, "").trim());
        j += 1;
        continue;
      }
      break;
    }
    void numsLine;

    if (parsed) {
      const security_name = nameParts
        .join(" ")
        .replace(/\s+/g, " ")
        .replace(/#/g, " ")
        .trim();
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

function parseCdslMfHoldings(lines: string[]): MfHoldingRow[] {
  const holdings: MfHoldingRow[] = [];
  const start = lines.findIndex((l) => /MUTUAL FUND UNITS HELD AS ON/i.test(l));
  if (start < 0) return holdings;

  const end = lines.findIndex((l, idx) => idx > start && (/Grand Total/i.test(l) || /Load Structures/i.test(l)));
  const slice = lines.slice(start, end > start ? end + 1 : undefined);

  let i = 0;
  while (i < slice.length) {
    const line = slice[i]!;
    if (/MUTUAL FUND UNITS HELD|Scheme Name|Folio No|Grand Total|Load Structures|Unrealised|Profit\/Loss/i.test(line)) {
      i += 1;
      continue;
    }
    if (isBoilerLine(line)) {
      i += 1;
      continue;
    }

    const isinM = line.match(ISIN_RE);
    if (isinM) {
      const isin = isinM[1]!.toUpperCase();
      const nameParts: string[] = [];
      for (let k = Math.max(0, i - 3); k < i; k += 1) {
        const prev = slice[k]!;
        if (ISIN_RE.test(prev) || moneyTokens(prev).length >= 4) continue;
        if (/Scheme Name|Folio|Unrealised|Closing|Invested|Loss\(%\)|NAV/i.test(prev)) continue;
        // Skip lone plan suffix left over from previous row
        if (/^(Growth|IDCW|Dividend|Direct|Regular)$/i.test(prev.trim())) continue;
        nameParts.push(prev);
      }

      let rest = line.replace(ISIN_RE, " ");
      let folio: string | null = null;
      const folioM = rest.match(/(\d{5,}\/\d+)/);
      if (folioM) {
        folio = folioM[1]!;
        rest = rest.replace(folioM[0], " ");
      }

      // units nav invested valuation profit pct — all on this line after folio
      const numMatch = rest.match(
        /([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d+)/,
      );
      let units: string | null = null;
      let nav: string | null = null;
      let cost: string | null = null;
      let market: string | null = null;
      let gainPct: string | null = null;
      let j = i + 1;
      if (numMatch) {
        units = parseMoney(numMatch[1]!);
        nav = parseMoney(numMatch[2]!);
        cost = parseMoney(numMatch[3]!);
        market = parseMoney(numMatch[4]!);
        gainPct = parsePct(numMatch[6]!);
      } else {
        const toks = moneyTokens(rest);
        if (toks.length >= 6) {
          units = parseMoney(toks[0]!);
          nav = parseMoney(toks[1]!);
          cost = parseMoney(toks[2]!);
          market = parseMoney(toks[3]!);
          gainPct = parsePct(toks[5]!);
        }
      }

      while (j < slice.length && j < i + 3) {
        const nxt = slice[j]!;
        if (ISIN_RE.test(nxt) || /Grand Total/i.test(nxt)) break;
        if (moneyTokens(nxt).length < 2 && /growth|plan|fund/i.test(nxt)) {
          nameParts.push(nxt);
          j += 1;
          continue;
        }
        break;
      }

      if (units && market) {
        let scheme_code: string | null = null;
        let scheme_name = nameParts.join(" ").replace(/\s+/g, " ").trim();
        const codeM = scheme_name.match(/^(\d+|[A-Z]{2,5})\s*-\s*(.+)$/);
        if (codeM) {
          scheme_code = codeM[1]!;
          scheme_name = codeM[2]!.trim();
        }
        holdings.push({
          amc: null,
          folio_no: folio,
          isin,
          scheme_code,
          scheme_name: scheme_name || null,
          closing_units: units,
          nav_inr: nav,
          cost_value_inr: cost,
          market_value_inr: market,
          gain_pct: gainPct,
          plan_tag: null,
          transactions: [],
        });
      }
      i = Math.max(j, i + 1);
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

export function parseCdslFromLines(linesIn: string[], fileName = "cdsl-cas.pdf"): ParsedCdslStatement {
  const lines = cleanLines(linesIn);
  const text = lines.join("\n");
  const period = extractPeriod(text);

  const casId = text.match(/CAS ID:\s*([A-Z0-9]+)/i)?.[1] ?? null;
  const pan = extractPan(text);
  const nameM =
    text.match(/In the single name of\s*\n?\s*([A-Z][A-Za-z .]+)\s*\(\s*PAN/i) ??
    text.match(/SATISH KUMAR|Name\/Joint Name[^\n]*\n([A-Z][A-Za-z .]+)/);
  let investor_name: string | null = null;
  const nameLine = lines.find((l) => /^[A-Z][A-Z\s]{2,}$/.test(l) && l.length < 40 && !/CDSL|DEMAT|TOTAL|PAGE/i.test(l));
  if (nameLine) investor_name = nameLine.trim();
  const single = text.match(/In the single name of\s+([A-Za-z .]+)\s*\(\s*PAN/i);
  if (single) investor_name = single[1]!.trim();
  void nameM;

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
  const demat_transactions = parseDematTransactions(lines, accounts);
  const mf_holdings = parseCdslMfHoldings(lines);
  parseCdslMfTransactions(lines, mf_holdings);

  // Fill AMC from account details section
  for (const h of mf_holdings) {
    if (h.amc) continue;
    const block = lines.find((l) => h.isin && l.includes(h.isin));
    void block;
  }
  for (let i = 0; i < lines.length; i += 1) {
    const amcLine = lines[i]!.match(/^AMC Name\s*:\s*(.+)$/i);
    if (!amcLine) continue;
    const schemeLine = lines[i + 1] ?? "";
    const isinLine = lines.slice(i, i + 5).find((l) => ISIN_RE.test(l));
    const isin = isinLine?.match(ISIN_RE)?.[1]?.toUpperCase();
    if (!isin) continue;
    const h = mf_holdings.find((x) => x.isin === isin);
    if (h) {
      h.amc = amcLine[1]!.trim();
      if (!h.scheme_name && /Scheme Name\s*:\s*(.+?)(?:\s+Scheme Code|$)/i.test(schemeLine)) {
        h.scheme_name = schemeLine.match(/Scheme Name\s*:\s*(.+?)(?:\s+Scheme Code|$)/i)?.[1]?.trim() ?? h.scheme_name;
      }
      const folioLine = lines.slice(i, i + 5).find((l) => /Folio No\s*:/i.test(l));
      const folio = folioLine?.match(/Folio No\s*:\s*([\d/]+)/i)?.[1];
      if (folio && !h.folio_no) h.folio_no = folio;
    }
  }

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
    demat_transactions,
    mf_holdings,
    nps_holdings,
  };
}

export function parseCdslText(text: string, fileName = "cdsl-cas.pdf"): ParsedCdslStatement {
  return parseCdslFromLines(text.split(/\r?\n/), fileName);
}
