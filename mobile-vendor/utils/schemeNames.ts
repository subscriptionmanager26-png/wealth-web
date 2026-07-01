const PRESERVE_UPPER_WORDS = new Set([
  "SBI",
  "HDFC",
  "ICICI",
  "UTI",
  "IDFC",
  "PPFAS",
  "NFO",
  "ETF",
  "FOF",
  "ELSS",
  "NAV",
  "NSE",
  "BSE",
  "NIFTY",
  "SENSEX",
  "US",
]);

function friendlySchemeName(name: string, schemeCode?: string | null): string {
  let cleaned = name.trim();
  const code = (schemeCode ?? "").trim();
  if (code) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`^\\s*${escaped}\\s*[-:|]?\\s*`, "i"), "");
  }
  return cleaned
    .replace(/^\s*[A-Z0-9]{4,10}\s*[-:|]\s*/g, "")
    .replace(/\b(direct|regular)\s*(plan|option)?\b/gi, "")
    .replace(/\b(growth|idcw|dividend|reinvestment|payout)\s*(option)?\b/gi, "")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineCaseSchemeName(input: string): string {
  const toTitle = (w: string) => (w ? `${w[0]!.toUpperCase()}${w.slice(1).toLowerCase()}` : w);
  const transformCore = (core: string) => {
    if (!core) return core;
    const upper = core.toUpperCase();
    if (PRESERVE_UPPER_WORDS.has(upper)) return upper;
    if (/^[A-Z0-9]{2,5}$/.test(core)) return upper;
    if (/[0-9]/.test(core) && core.toUpperCase() === core) return core;
    return toTitle(core);
  };
  const transformToken = (token: string): string => {
    if (!token) return token;
    const m = token.match(/^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9.'’&]*)([^A-Za-z0-9]*)$/);
    if (!m) return token;
    const [, pre, core, post] = m;
    const parts = core.split(/([/-])/);
    const out = parts.map((p) => (p === "/" || p === "-" ? p : transformCore(p))).join("");
    return `${pre}${out}${post}`;
  };
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map(transformToken)
    .join(" ")
    .trim();
}

/** Short display name for funds (strip plan/option noise, title-case). */
export function simplifySchemeName(name: string, schemeCode?: string | null): string {
  const base = friendlySchemeName(name, schemeCode);
  return headlineCaseSchemeName(base || name.trim());
}

/** Canonical fund label for CAS holdings, ledger rows, and portfolio holdings. */
export function casHoldingDisplayName(
  h: {
    scheme_name?: string | null;
    scheme_name_simple?: string | null;
    scheme_code?: string | null;
  },
  options?: { fallback?: string },
): string {
  const parserSimpleName = (h.scheme_name_simple ?? "").trim();
  const schemeName = (h.scheme_name ?? "").trim();
  const baseName = parserSimpleName || schemeName || options?.fallback || "Fund";
  return simplifySchemeName(baseName, h.scheme_code);
}
