const UPVALY_MF_SCHEME_URL = "https://finapi.upvaly.com/api/mf/scheme-code";
const FETCH_TIMEOUT_MS = 20000;
const FETCH_CONCURRENCY = 6;

/** Timeframes where Upvaly reports annualized return (%). Shorter periods are absolute return (%). */
const ANNUALIZED_TIMEFRAME_KEYS = new Set([
  "1y",
  "2y",
  "3y",
  "5y",
  "7y",
  "10y",
  "inception",
]);

const RETURN_DISPLAY_ORDER = ["1w", "1m", "3m", "6m", "ytd", "1y", "2y", "3y", "5y", "10y", "inception"] as const;

export type UpvalyMfHolding = {
  name: string;
  sector?: string;
  marketValue?: string;
  weightage: string;
  change1M?: string;
};

export type UpvalyMfFundamentals = {
  pe?: string;
  pb?: string;
  priceToSale?: string;
  yieldToMaturity?: string;
  modifiedDuration?: string;
  avgEffMaturity?: string;
};

export type UpvalyReturnKind = "absolute" | "annualized";

/** Fund return for one period; `valuePct` is the API percent (e.g. -2.74 → −2.74%). */
export type UpvalyFundReturn = {
  timeframe: string;
  label: string;
  valuePct: number;
  kind: UpvalyReturnKind;
};

export type UpvalyRiskMetricRow = {
  timeframe: string;
  value: number | null;
  categoryAverage: number | null;
};

export type UpvalySchemeDetail = {
  schemeCode: string;
  schemeName: string;
  schemeCategory?: string;
  schemeCategoryLabel?: string;
  /** AUM in ₹ crore. */
  aumCr?: number | null;
  /** Annual expense ratio (%). */
  expenseRatio?: number | null;
  inceptionDate?: string;
  cagrByPeriod?: Partial<Record<"1y" | "3y" | "5y" | "7y" | "10y", number>>;
  riskStdDevByTimeframe?: Record<string, UpvalyRiskMetricRow>;
  fundamentals?: UpvalyMfFundamentals;
  holdings?: UpvalyMfHolding[];
  returnsByTimeframe: Record<string, UpvalyFundReturn>;
};

type UpvalyRank = {
  timeframe?: string;
  annualizedReturn?: number;
};

type UpvalyRiskReturnRow = {
  timeframe?: string;
  value?: string;
  categoryAverage?: string;
};

type UpvalyRiskStdDevRow = {
  timeframe?: string;
  value?: string;
  categoryAverage?: string;
};

type UpvalyApiBody = {
  status?: string;
  data?: {
    schemeCode?: string;
    schemeName?: string;
    schemeCategory?: string;
    schemeCategoryLabel?: string;
    aum?: string | number;
    expenseRatio?: string | number;
    inceptionDate?: string;
    cagr?: Record<string, string | number>;
    fundamentals?: UpvalyMfFundamentals;
    holdings?: UpvalyMfHolding[];
    ranks?: UpvalyRank[];
    riskMetrics?: {
      returns?: {
        timeframes?: UpvalyRiskReturnRow[];
      };
      riskStandardDeviation?: {
        timeframes?: UpvalyRiskStdDevRow[];
      };
    };
  };
};

const schemeCache = new Map<string, UpvalySchemeDetail | null>();

export function parseUpvalyMetric(value?: string | number | null): number | null {
  if (value == null) return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function normalizeUpvalyTimeframeKey(raw?: string | null): string | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === "inception") return "inception";
  if (s === "ytd") return "ytd";
  const m = s.match(/^(\d+)([wmy])$/);
  if (m) return `${m[1]}${m[2]}`;
  return s;
}

export function upvalyTimeframeLabel(key: string): string {
  const k = normalizeUpvalyTimeframeKey(key) ?? key;
  if (k === "ytd") return "YTD";
  if (k === "inception") return "Since inception";
  const m = k.match(/^(\d+)([wmy])$/);
  if (!m) return k.toUpperCase();
  const n = m[1];
  const unit = m[2] === "w" ? "W" : m[2] === "m" ? "M" : "Y";
  return `${n}${unit}`;
}

export function isAnnualizedUpvalyTimeframe(key: string): boolean {
  return ANNUALIZED_TIMEFRAME_KEYS.has(normalizeUpvalyTimeframeKey(key) ?? key);
}

export function formatUpvalyFundReturnPct(valuePct: number): string {
  if (!Number.isFinite(valuePct)) return "—";
  const sign = valuePct >= 0 ? "+" : "−";
  return `${sign}${Math.abs(valuePct).toFixed(2)}%`;
}

export function getUpvalyFundReturn(
  scheme: UpvalySchemeDetail | undefined,
  timeframe: string,
): UpvalyFundReturn | null {
  if (!scheme) return null;
  const key = normalizeUpvalyTimeframeKey(timeframe);
  if (!key) return null;
  return scheme.returnsByTimeframe[key] ?? null;
}

export function listUpvalyFundReturns(scheme: UpvalySchemeDetail | undefined): UpvalyFundReturn[] {
  if (!scheme) return [];
  const keys = new Set(Object.keys(scheme.returnsByTimeframe));
  const ordered: UpvalyFundReturn[] = [];
  for (const k of RETURN_DISPLAY_ORDER) {
    if (keys.has(k)) ordered.push(scheme.returnsByTimeframe[k]!);
  }
  for (const [k, row] of Object.entries(scheme.returnsByTimeframe)) {
    if (!RETURN_DISPLAY_ORDER.includes(k as (typeof RETURN_DISPLAY_ORDER)[number])) {
      ordered.push(row);
    }
  }
  return ordered;
}

function parseReturnsByTimeframe(data: NonNullable<UpvalyApiBody["data"]>): Record<string, UpvalyFundReturn> {
  const out: Record<string, UpvalyFundReturn> = {};

  for (const row of data.ranks ?? []) {
    const key = normalizeUpvalyTimeframeKey(row.timeframe);
    if (!key || row.annualizedReturn == null || !Number.isFinite(row.annualizedReturn)) continue;
    out[key] = {
      timeframe: key,
      label: upvalyTimeframeLabel(key),
      valuePct: row.annualizedReturn,
      kind: isAnnualizedUpvalyTimeframe(key) ? "annualized" : "absolute",
    };
  }

  for (const row of data.riskMetrics?.returns?.timeframes ?? []) {
    const key = normalizeUpvalyTimeframeKey(row.timeframe);
    const valuePct = parseUpvalyMetric(row.value);
    if (!key || valuePct == null) continue;
    out[key] = {
      timeframe: key,
      label: upvalyTimeframeLabel(key),
      valuePct,
      kind: isAnnualizedUpvalyTimeframe(key) ? "annualized" : "absolute",
    };
  }

  return out;
}

function parseCagrByPeriod(cagr?: Record<string, string | number>): UpvalySchemeDetail["cagrByPeriod"] {
  if (!cagr || typeof cagr !== "object") return undefined;
  const out: NonNullable<UpvalySchemeDetail["cagrByPeriod"]> = {};
  for (const key of ["1y", "3y", "5y", "7y", "10y"] as const) {
    const value = parseUpvalyMetric(cagr[key]);
    if (value != null) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseRiskStdDevByTimeframe(
  rows?: UpvalyRiskStdDevRow[],
): UpvalySchemeDetail["riskStdDevByTimeframe"] {
  const out: NonNullable<UpvalySchemeDetail["riskStdDevByTimeframe"]> = {};
  for (const row of rows ?? []) {
    const key = normalizeUpvalyTimeframeKey(row.timeframe);
    if (!key) continue;
    out[key] = {
      timeframe: key,
      value: parseUpvalyMetric(row.value),
      categoryAverage: parseUpvalyMetric(row.categoryAverage),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

export function isUpvalySchemeFetchSettled(schemeCode: string): boolean {
  const id = String(schemeCode ?? "").trim();
  return /^\d+$/.test(id) && schemeCache.has(id);
}

export async function fetchUpvalySchemeByCode(schemeCode: string): Promise<UpvalySchemeDetail | null> {
  const id = String(schemeCode ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  if (schemeCache.has(id)) {
    const cached = schemeCache.get(id);
    if (cached && (!("riskStdDevByTimeframe" in cached) || !("expenseRatio" in cached))) {
      schemeCache.delete(id);
    } else {
      return cached ?? null;
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${UPVALY_MF_SCHEME_URL}/${encodeURIComponent(id)}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      schemeCache.set(id, null);
      return null;
    }
    const body = (await res.json()) as UpvalyApiBody;
    const data = body.data;
    if (!data?.schemeCode) {
      schemeCache.set(id, null);
      return null;
    }
    const out: UpvalySchemeDetail = {
      schemeCode: String(data.schemeCode),
      schemeName: String(data.schemeName ?? ""),
      schemeCategory: data.schemeCategory,
      schemeCategoryLabel: data.schemeCategoryLabel,
      aumCr: parseUpvalyMetric(data.aum),
      expenseRatio: parseUpvalyMetric(data.expenseRatio),
      inceptionDate: data.inceptionDate ? String(data.inceptionDate) : undefined,
      cagrByPeriod: parseCagrByPeriod(data.cagr),
      riskStdDevByTimeframe: parseRiskStdDevByTimeframe(data.riskMetrics?.riskStandardDeviation?.timeframes),
      fundamentals: data.fundamentals,
      holdings: data.holdings,
      returnsByTimeframe: parseReturnsByTimeframe(data),
    };
    schemeCache.set(id, out);
    return out;
  } catch {
    schemeCache.set(id, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchUpvalySchemesForCodes(codes: string[]): Promise<Record<string, UpvalySchemeDetail>> {
  const unique = [...new Set(codes.map((c) => String(c).trim()).filter((c) => /^\d+$/.test(c)))];
  const toFetch = unique.filter((code) => !schemeCache.has(code));
  const out: Record<string, UpvalySchemeDetail> = {};

  for (const code of unique) {
    const cached = schemeCache.get(code);
    if (cached) out[code] = cached;
  }

  for (let i = 0; i < toFetch.length; i += FETCH_CONCURRENCY) {
    const chunk = toFetch.slice(i, i + FETCH_CONCURRENCY);
    const part = await Promise.all(chunk.map((code) => fetchUpvalySchemeByCode(code)));
    chunk.forEach((code, j) => {
      const row = part[j];
      if (row) out[code] = row;
    });
  }
  return out;
}

export function schemeFundamentalTagLine(scheme: UpvalySchemeDetail): string | null {
  const f = scheme.fundamentals ?? {};
  const ytm = parseUpvalyMetric(f.yieldToMaturity);
  const modDur = parseUpvalyMetric(f.modifiedDuration);
  if (ytm != null || modDur != null) {
    const parts: string[] = [];
    if (ytm != null) parts.push(`YTM ${ytm.toFixed(2)}%`);
    if (modDur != null) parts.push(`Mod dur ${modDur.toFixed(2)}`);
    return parts.join(" · ");
  }

  const pe = parseUpvalyMetric(f.pe);
  const pb = parseUpvalyMetric(f.pb);
  if (pe != null || pb != null) {
    const parts: string[] = [];
    if (pe != null) parts.push(`PE ${pe.toFixed(2)}`);
    if (pb != null) parts.push(`PB ${pb.toFixed(2)}`);
    return parts.join(" · ");
  }
  return null;
}
