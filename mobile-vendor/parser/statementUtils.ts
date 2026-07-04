/** Shared helpers for statement text parsers. */

export const ISIN_RE = /\b(IN[A-Z0-9]{10})\b/i;
export const DATE_RE = /\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b/;
export const DATE_ISO_RE = /\b(\d{2}-\d{2}-\d{4})\b/;
/** Indian/Western amounts, optional decimals. Does not match bare years alone when used via moneyTokens. */
export const MONEY_RE = /-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|-?\d+\.\d+|-?\d+/;

export function cleanLines(lines: string[]): string[] {
  return lines
    .map((l) => l.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0 && !/^--- PAGE \d+ ---$/.test(l));
}

export function parseMoney(raw?: string | null): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[₹`]/g, "").replace(/,/g, "").trim();
  if (!s || s === "--" || s === "-" || s === "N.A" || s === "NA") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export function parsePct(raw?: string | null): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/%/g, "").replace(/,/g, "").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export function normalizeDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const dd = m[1]!.padStart(2, "0");
    return `${dd}-${m[2]}-${m[3]}`;
  }
  const iso = raw.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (iso) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mon = months[Number(iso[2]) - 1];
    if (mon) return `${iso[1]}-${mon}-${iso[3]}`;
  }
  return raw.trim();
}

export function extractPeriod(text: string): { from: string | null; to: string | null } {
  const m1 = text.match(
    /(?:period|from)\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s+to\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
  );
  if (m1) return { from: normalizeDate(m1[1]!), to: normalizeDate(m1[2]!) };

  const m2 = text.match(/(\d{2}-\d{2}-\d{4})\s*(?:से|to|-)\s*(\d{2}-\d{2}-\d{4})/i);
  if (m2) return { from: normalizeDate(m2[1]!), to: normalizeDate(m2[2]!) };

  const m3 = text.match(
    /Statement for the period from\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s+to\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i,
  );
  if (m3) return { from: normalizeDate(m3[1]!), to: normalizeDate(m3[2]!) };

  return { from: null, to: null };
}

export function extractPan(text: string): string | null {
  const m = text.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
  return m?.[1] ?? null;
}

export function isBoilerLine(line: string): boolean {
  const l = line.toLowerCase();
  if (/^page\s+\d+\s+of\s+\d+$/i.test(line)) return true;
  if (l.includes("central depository services")) return true;
  if (l.includes("a wing, 25th floor")) return true;
  if (l.includes("marathon futurex")) return true;
  if (l.includes("version-1025")) return true;
  if (l.includes("sebi has mandated")) return true;
  if (l.includes("ecas: cas via email")) return true;
  if (l.startsWith("*disclaimer") || l.startsWith("re-kyc is a periodic")) return true;
  if (l.includes("load structures") && line.length < 40) return true;
  return false;
}

const DEVANAGARI_RE = /[\u0900-\u097F]/;

const REPLACEMENT_CHAR_RE = /\uFFFD/;

/** Strip Hindi / Devanagari and bilingual column noise; keep Latin security names. */
export function englishOnlyText(raw: string): string {
  return raw
    .replace(DEVANAGARI_RE, " ")
    .replace(REPLACEMENT_CHAR_RE, " ")
    .replace(/#/g, " ")
    .replace(/₹|\(`\)|\(\`\)/g, " ")
    .replace(/\b(Bal|Value|Face|Free|Setup|Pledge|Frozen|Market|Current|ISIN|Security|Demat|Remat|Lockin|Price)\b/gi, " ")
    .replace(/Price\s*\//gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isEnglishSecurityLine(line: string): boolean {
  const noHindi = line.replace(DEVANAGARI_RE, "").trim();
  if (noHindi.length < 2) return false;
  if (REPLACEMENT_CHAR_RE.test(line)) return false;
  if (ISIN_RE.test(noHindi) && moneyTokens(noHindi).length >= 3) return false;
  if (/^\d{2}-\d{2}-\d{4}\s+\S+\s+[\d,]+\.\d+/.test(noHindi)) return false;
  if (/--/.test(noHindi) && moneyTokens(noHindi).length >= 1) return false;
  if (/^(Page|Central Depository|CONSOLIDATED|Account Details|Investments|Price|Value|Market|Current|ISIN|Security|Demat|Remat|Lockin|Bal|Free|Setup|Pledge|Frozen|₹)/i.test(noHindi)) {
    return false;
  }
  if (/Price\s*\//i.test(noHindi) && noHindi.length < 48) return false;
  const latin = noHindi.replace(/[^A-Za-z0-9.,()\-/&]/g, "");
  return latin.length >= Math.min(4, noHindi.length * 0.4);
}

export function extractCdslInvestorName(lines: string[]): string | null {
  for (const line of lines.slice(0, 80)) {
    const m = line.match(/^([A-Z][A-Z\s.()]{4,48})(?:\s+Mutual Fund Folios|\s*$)/);
    if (m) return englishOnlyText(m[1]!);
  }
  const single = lines.join("\n").match(/In the single name of\s+([A-Za-z .()]+)\s*\(\s*PAN/i);
  if (single) return englishOnlyText(single[1]!);
  for (const line of lines) {
    if (/Account Details/i.test(line)) {
      const idx = lines.indexOf(line);
      for (let j = idx + 1; j < Math.min(lines.length, idx + 4); j += 1) {
        const cand = lines[j]!;
        if (/^[A-Z][A-Z\s.()]{4,40}$/.test(cand.replace(DEVANAGARI_RE, "").trim())) {
          return englishOnlyText(cand);
        }
      }
    }
  }
  return null;
}

/**
 * Extract monetary / quantity tokens from a line.
 * Strips face-value noise (RS 5/-, RE.1/-) and folio fragments (123/66) first.
 */
export function moneyTokens(line: string): string[] {
  const cleaned = line
    .replace(ISIN_RE, " ")
    .replace(/\b\d{5,}\/\d+\b/g, " ") // folio 7872983/66
    .replace(/\b(?:RS|RE)\.?\s*\d+(?:\/-)?/gi, " ")
    .replace(/\bFACE VALUE\b[^0-9]*/gi, " ")
    .replace(/--/g, " ");
  return (cleaned.match(new RegExp(MONEY_RE.source, "g")) ?? []).filter((t) => {
    if (!/[\d]/.test(t)) return false;
    // Drop bare 4-digit years in notes
    if (/^(19|20)\d{2}$/.test(t)) return false;
    return true;
  });
}

/** Last N numeric tokens on a line (after cleaning). */
export function trailingMoneyTokens(line: string, n: number): string[] {
  const toks = moneyTokens(line);
  return toks.slice(Math.max(0, toks.length - n));
}
