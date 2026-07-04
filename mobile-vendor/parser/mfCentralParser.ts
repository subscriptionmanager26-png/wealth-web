/**
 * MF Central monthly Mutual Fund Consolidated Account Statement.
 * Text-line parser (same approach as CAMS CAS — mobile-safe).
 */

import type { MfHoldingRow, ParsedMfCentralStatement, StatementTransaction } from "./statementTypes";
import {
  DATE_RE,
  ISIN_RE,
  cleanLines,
  extractPan,
  extractPeriod,
  isBoilerLine,
  moneyTokens,
  parseMoney,
  parsePct,
} from "./statementUtils";

function isAmcHeader(line: string): boolean {
  if (/mutual fund\s*-\s*total/i.test(line)) return false;
  if (/portfolio value/i.test(line)) return false;
  return /mutual fund$/i.test(line.trim()) || /nippon india mutual fund/i.test(line);
}

function isHoldingsSectionStart(line: string): boolean {
  return /summary of holdings as on/i.test(line);
}

function isTxnSectionStart(line: string): boolean {
  return /^transaction details$/i.test(line.trim());
}

function isLoadSection(line: string): boolean {
  return /^load structures$/i.test(line.trim()) || /^notes$/i.test(line.trim());
}

function isMetricsOnlyTail(s: string): boolean {
  const toks = moneyTokens(s);
  if (toks.length < 4) return false;
  const letters = s.replace(/[\d,.\s%₹()-]/g, "");
  return letters.length <= 1;
}

function parseMetricsRow(line: string): {
  units: string | null;
  nav: string | null;
  cost: string | null;
  gain: string | null;
  market: string | null;
} {
  const toks = moneyTokens(line);
  const hasGainPct = /%/.test(line);
  const gain = parsePct(line.match(/(-?\d+(?:\.\d+)?)%/)?.[1] ?? null);
  return {
    units: parseMoney(toks[0]!),
    nav: parseMoney(toks[1]!),
    cost: parseMoney(toks[2]!),
    gain,
    market: parseMoney(toks[toks.length - 1]!),
  };
}

function applySchemeNameParts(nameParts: string[]): { scheme_code: string | null; scheme_name: string | null; plan_tag: string | null } {
  const joined = nameParts.join(" ").replace(/\s+/g, " ").trim();
  let scheme_code: string | null = null;
  let scheme_name: string | null = joined || null;
  let plan_tag: string | null = null;
  const codeM = joined.match(/^(\d+[A-Z]?)-(.+)$/i) ?? joined.match(/^([A-Z0-9][\w/-]*)-(.+)$/i);
  if (codeM) {
    scheme_code = codeM[1]!;
    scheme_name = codeM[2]!.trim();
  }
  const planLine = nameParts.find((p) => /^(regular|direct)\s+growth$/i.test(p.trim()));
  if (planLine) plan_tag = planLine.trim();
  return { scheme_code, scheme_name, plan_tag };
}

function parseHoldingsBlock(lines: string[]): MfHoldingRow[] {
  const holdings: MfHoldingRow[] = [];
  let amc: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (isTxnSectionStart(line) || isLoadSection(line)) break;
    if (isBoilerLine(line) || isHoldingsSectionStart(line)) {
      i += 1;
      continue;
    }
    if (/^scheme code/i.test(line) || /^unit$/i.test(line) || /^folio no/i.test(line)) {
      i += 1;
      continue;
    }
    if (/^cost$/i.test(line) || /^market$/i.test(line) || /^name$/i.test(line) || /^balance/i.test(line)) {
      i += 1;
      continue;
    }

    if (isAmcHeader(line)) {
      amc = line.replace(/\s*-\s*total.*$/i, "").trim();
      i += 1;
      continue;
    }
    if (/mutual fund\s*-\s*total/i.test(line) || /^portfolio value/i.test(line)) {
      i += 1;
      continue;
    }

    const isinM = line.match(ISIN_RE);
    const folioM = line.match(/^(\d{5,})\s+/);
    if (isinM && folioM) {
      const folio_no = folioM[1]!;
      const isin = isinM[1]!.toUpperCase();
      const afterIsin = line.slice(line.indexOf(isinM[0]) + isinM[0].length).trim();
      let scheme_code: string | null = null;
      let scheme_name: string | null = null;
      let units: string | null = null;
      let nav: string | null = null;
      let cost: string | null = null;
      let gain: string | null = null;
      let market: string | null = null;
      let plan_tag: string | null = null;
      const nameParts: string[] = [];
      let j = i + 1;

      if (isMetricsOnlyTail(afterIsin)) {
        const metrics = parseMetricsRow(afterIsin);
        units = metrics.units;
        nav = metrics.nav;
        cost = metrics.cost;
        gain = metrics.gain;
        market = metrics.market;
        while (j < lines.length && j < i + 8) {
          const nxt = lines[j]!;
          if (isAmcHeader(nxt) || (ISIN_RE.test(nxt) && /^\d{5,}\s+/.test(nxt))) break;
          if (isTxnSectionStart(nxt) || isLoadSection(nxt)) break;
          if (/mutual fund\s*-\s*total/i.test(nxt) || /^portfolio value/i.test(nxt)) break;
          if (isMetricsOnlyTail(nxt)) break;
          nameParts.push(nxt.trim());
          j += 1;
        }
        const scheme = applySchemeNameParts(nameParts);
        scheme_code = scheme.scheme_code;
        scheme_name = scheme.scheme_name;
        plan_tag = scheme.plan_tag;
      } else {
        scheme_name = afterIsin;
        const codeM = afterIsin.match(/^([A-Z0-9][\w/-]*)-(.+)$/i);
        if (codeM) {
          scheme_code = codeM[1]!;
          scheme_name = codeM[2]!.trim();
        }
        nameParts.push(scheme_name);

        while (j < lines.length && j < i + 5) {
          const nxt = lines[j]!;
          if (isAmcHeader(nxt) || (ISIN_RE.test(nxt) && /^\d{5,}\s+/.test(nxt))) break;
          if (isTxnSectionStart(nxt) || isLoadSection(nxt)) break;
          if (/mutual fund\s*-\s*total/i.test(nxt) || /^portfolio value/i.test(nxt)) break;

          const toks = moneyTokens(nxt);
          const hasGainPct = /%/.test(nxt);
          if (toks.length >= 4 && (hasGainPct || toks.length >= 5)) {
            const metrics = parseMetricsRow(nxt);
            units = metrics.units;
            nav = metrics.nav;
            cost = metrics.cost;
            gain = metrics.gain;
            market = metrics.market;
            j += 1;
            while (j < lines.length && j < i + 8) {
              const planLine = lines[j]!;
              if (ISIN_RE.test(planLine) && /^\d{5,}\s+/.test(planLine)) break;
              if (isAmcHeader(planLine) || isTxnSectionStart(planLine) || isLoadSection(planLine)) break;
              if (/mutual fund\s*-\s*total/i.test(planLine) || /^portfolio value/i.test(planLine)) break;
              if (moneyTokens(planLine).length >= 3) break;
              if (
                /growth|idcw|dividend|direct|regular|plan|option|fund|opportunities|cap/i.test(planLine) &&
                planLine.length < 80
              ) {
                if (/growth|idcw|dividend|direct|regular|plan|option/i.test(planLine)) {
                  plan_tag = plan_tag ? `${plan_tag} ${planLine.trim()}` : planLine.trim();
                }
                nameParts.push(planLine.trim());
                j += 1;
                continue;
              }
              break;
            }
            break;
          }

          if (!ISIN_RE.test(nxt) && moneyTokens(nxt).length < 3) {
            nameParts.push(nxt);
            j += 1;
            continue;
          }
          break;
        }
        const scheme = applySchemeNameParts(nameParts);
        scheme_code = scheme.scheme_code ?? scheme_code;
        scheme_name = scheme.scheme_name;
        plan_tag = plan_tag ?? scheme.plan_tag;
      }

      holdings.push({
        amc,
        folio_no,
        isin,
        scheme_code,
        scheme_name: scheme_name?.replace(/\s+/g, " ").trim() || null,
        closing_units: units,
        nav_inr: nav,
        cost_value_inr: cost,
        market_value_inr: market,
        gain_pct: gain,
        plan_tag,
        transactions: [],
      });
      i = j;
      continue;
    }

    i += 1;
  }

  return holdings;
}

function parseTransactions(lines: string[], holdings: MfHoldingRow[]): void {
  let i = 0;
  let currentIsin: string | null = null;
  let currentFolio: string | null = null;
  let currentScheme: string | null = null;
  let currentAmc: string | null = null;
  let openingUnits: string | null = null;
  const pendingTxns: StatementTransaction[] = [];

  const flush = () => {
    if (!pendingTxns.length) return;
    const target =
      holdings.find((h) => h.folio_no === currentFolio && h.isin === currentIsin) ??
      holdings.find((h) => h.folio_no === currentFolio) ??
      holdings.find((h) => h.isin === currentIsin);
    if (target) {
      target.transactions.push(...pendingTxns);
      if (!target.closing_units && pendingTxns.at(-1)?.unit_balance) {
        target.closing_units = pendingTxns.at(-1)!.unit_balance;
      }
    } else if (currentFolio || currentIsin) {
      holdings.push({
        amc: currentAmc,
        folio_no: currentFolio,
        isin: currentIsin,
        scheme_code: null,
        scheme_name: currentScheme,
        closing_units: pendingTxns.at(-1)?.unit_balance ?? null,
        nav_inr: null,
        cost_value_inr: null,
        market_value_inr: null,
        gain_pct: null,
        plan_tag: null,
        transactions: [...pendingTxns],
      });
    }
    pendingTxns.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (isLoadSection(line)) break;
    if (!isTxnSectionStart(line) && i === 0) {
      // seek to transaction details
    }
    if (isAmcHeader(line)) {
      flush();
      currentAmc = line.trim();
      i += 1;
      continue;
    }

    const isinLine = line.match(/^ISIN\s*:\s*(IN[A-Z0-9]{10})/i);
    if (isinLine) {
      flush();
      currentIsin = isinLine[1]!.toUpperCase();
      i += 1;
      continue;
    }
    const folioLine = line.match(/^Folio No\.?\s*:\s*(\d+)/i);
    if (folioLine) {
      currentFolio = folioLine[1]!;
      i += 1;
      continue;
    }

    if (/^opening balance$/i.test(line.trim())) {
      const next = lines[i + 1];
      const u = next ? parseMoney(moneyTokens(next)[0] ?? next) : null;
      if (u) {
        openingUnits = u;
        pendingTxns.push({
          date: "",
          description: "Opening Balance",
          amount_inr: null,
          units: null,
          price_inr: null,
          nav_inr: null,
          unit_balance: u,
        });
        i += 2;
        continue;
      }
    }

    if (/^closing balance\b/i.test(line)) {
      const u = parseMoney(moneyTokens(line)[0] ?? line.replace(/closing balance/i, ""));
      if (u) {
        pendingTxns.push({
          date: "",
          description: "Closing Balance",
          amount_inr: null,
          units: null,
          price_inr: null,
          nav_inr: null,
          unit_balance: u,
        });
      }
      flush();
      i += 1;
      continue;
    }

    const dateM = line.match(DATE_RE);
    if (dateM && !/holder|pan|kyc/i.test(line)) {
      const date = dateM[1]!;
      let desc = line.slice(dateM.index! + dateM[0].length).trim().replace(/-$/, "").trim();
      let amount: string | null = null;
      let nav: string | null = null;
      let price: string | null = null;
      let units: string | null = null;

      // Numbers may be on same line or next
      let nums = moneyTokens(line.slice(dateM.index! + dateM[0].length));
      let j = i + 1;
      if (nums.length < 3 && j < lines.length) {
        const nxt = lines[j]!;
        if (!DATE_RE.test(nxt) && !/^ISIN/i.test(nxt) && !/^Folio/i.test(nxt) && !isAmcHeader(nxt)) {
          const more = moneyTokens(nxt);
          if (more.length >= 3) {
            nums = more;
            // narration may continue on following line
            j += 1;
            if (j < lines.length && !DATE_RE.test(lines[j]!) && moneyTokens(lines[j]!).length < 2) {
              if (!/^(opening|closing) balance/i.test(lines[j]!)) {
                desc = `${desc} ${lines[j]}`.trim();
                j += 1;
              }
            }
          } else if (!/^(opening|closing) balance/i.test(nxt) && !ISIN_RE.test(nxt)) {
            desc = `${desc} ${nxt}`.trim();
            j += 1;
            if (j < lines.length) {
              const more2 = moneyTokens(lines[j]!);
              if (more2.length >= 3) {
                nums = more2;
                j += 1;
              }
            }
          }
        }
      }

      if (nums.length >= 3) {
        amount = parseMoney(nums[0]!);
        nav = parseMoney(nums[1]!);
        price = parseMoney(nums[2]!);
        units = nums.length >= 4 ? parseMoney(nums[3]!) : null;
        pendingTxns.push({
          date,
          description: desc || "Transaction",
          amount_inr: amount,
          units,
          price_inr: price,
          nav_inr: nav,
          unit_balance: null,
        });
        i = j;
        continue;
      }
    }

    // Scheme name line before ISIN
    if (
      !isBoilerLine(line) &&
      !/^(holder|primary|2nd|3rd|guardian|unique client|mode of holding|date\s+transaction)/i.test(line) &&
      !ISIN_RE.test(line) &&
      !DATE_RE.test(line) &&
      moneyTokens(line).length < 2 &&
      line.length > 8
    ) {
      if (!/^transaction details$/i.test(line)) currentScheme = line.trim();
    }

    i += 1;
  }
  flush();
  void openingUnits;
}

export function parseMfCentralFromLines(linesIn: string[], fileName = "mf-central.pdf"): ParsedMfCentralStatement {
  const lines = cleanLines(linesIn).filter((l) => !isBoilerLine(l) || /summary of holdings|transaction details/i.test(l));
  const text = lines.join("\n");
  const period = extractPeriod(text);

  let investor_name: string | null = null;
  let address: string | null = null;
  const hufLine = lines.find((l) => /\([Hh]uf\)/.test(l));
  if (hufLine) {
    investor_name =
      hufLine.match(/^(.+?\([Hh]uf\))/i)?.[1]?.trim() ?? hufLine.replace(/\s+SEBI.*/i, "").trim();
  } else {
    const nameLine = lines.find(
      (l) => /\bHUF\b/.test(l) || (/^[A-Z][A-Za-z .()]+$/.test(l) && l.length < 40),
    );
    if (nameLine && !/mutual fund|portfolio|summary/i.test(nameLine)) {
      investor_name = nameLine.replace(/\s+SEBI has.*/i, "").trim();
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (!/Primary Holder/i.test(lines[i]!)) continue;
    const same = lines[i]!.match(/Primary Holder\s+([A-Za-z .()]+?)\s+([A-Z]{5}\d{4}[A-Z])/i);
    if (same) {
      investor_name = same[1]!.trim();
      break;
    }
    const next = lines[i + 1];
    const nextM = next?.match(/^([A-Za-z .()]+?)\s+([A-Z]{5}\d{4}[A-Z])/);
    if (nextM) {
      investor_name = nextM[1]!.trim();
      break;
    }
  }

  const addrParts: string[] = [];
  for (const l of lines.slice(0, 20)) {
    if (/^\d+\/|SHIV|GHAZIABAD|UTTAR|PINCODE|FACTORY|NEAR/i.test(l) && !/SEBI|CAS|email/i.test(l)) {
      addrParts.push(l);
    }
  }
  if (addrParts.length) address = addrParts.join(", ");

  let total_portfolio_value_inr: string | null = null;
  let total_invested_value_inr: string | null = null;
  let total_gain_inr: string | null = null;
  let absolute_gain_pct: string | null = null;
  const totalsLine = lines.find((l) => /Total Portfolio Value/i.test(l));
  const numsBefore = lines.find((l) => moneyTokens(l).length >= 3 && /%/.test(l) && lines.indexOf(l) < 40);
  if (numsBefore) {
    const toks = moneyTokens(numsBefore);
    total_portfolio_value_inr = parseMoney(toks[0]!);
    total_invested_value_inr = parseMoney(toks[1]!);
    total_gain_inr = parseMoney(toks[2]!);
    absolute_gain_pct = parsePct(numsBefore.match(/(-?\d+(?:\.\d+)?)%/)?.[1] ?? toks[3] ?? null);
  }
  void totalsLine;

  const holdStart = lines.findIndex(isHoldingsSectionStart);
  const txnStart = lines.findIndex(isTxnSectionStart);
  const holdLines = holdStart >= 0 ? lines.slice(holdStart, txnStart >= 0 ? txnStart : undefined) : [];
  const holdings = parseHoldingsBlock(holdLines);

  if (txnStart >= 0) {
    parseTransactions(lines.slice(txnStart), holdings);
  }

  return {
    kind: "mf_central",
    source_file: fileName,
    period_from: period.from,
    period_to: period.to,
    investor_name,
    investor_pan: extractPan(text),
    address,
    total_portfolio_value_inr,
    total_invested_value_inr,
    total_gain_inr,
    absolute_gain_pct,
    holdings,
  };
}

export function parseMfCentralText(text: string, fileName = "mf-central.pdf"): ParsedMfCentralStatement {
  return parseMfCentralFromLines(text.split(/\r?\n/), fileName);
}
