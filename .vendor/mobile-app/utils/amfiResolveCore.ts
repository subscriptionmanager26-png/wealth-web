/**
 * Shared AMFI resolution (registry + NAV disambiguation) with no Expo / AsyncStorage.
 * Used by `amfiSchemeMap.ts` (mobile) and Node scripts (laptop CAS checks).
 */

import type { Holding, ParsedCAS, Transaction } from "../parser/cas-parser";
import type { AmfiResolveTrace } from "./amfiResolveTrace";
import { fetchAmfiNavHistorySeries } from "./amfiNavApi";
import { loadPersistedNavSeries, savePersistedNavSeries } from "./navSeriesDiskCache";
import { fetchWithMfapiBackoff } from "./mfapiBackoff";

export type ResolveAmfiOptions = {
  /** When true, never map via ISIN (exercise name + NAV paths only). */
  skipIsin?: boolean;
  /** When false, skip NAV / portal disambiguation (ISIN, cache, and single strict name match only). */
  networkDisambiguation?: boolean;
  /** Timestamped step log for in-app diagnostics. */
  trace?: AmfiResolveTrace;
};

export const MFAPI_BASE = "https://api.mfapi.in/mf/";
/** AMFI India consolidated NAV file for a calendar date (all schemes that appear on that file). */
export const AMFI_PORTAL_NAV_URL = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx";
const NAV_WINDOW_MS = 3 * 86400000;
const MAX_TX_SAMPLES = 6;
const NAV_FETCH_TIMEOUT_MS = 18000;
/** Parallel AMFI history fetches when verifying portal-shortlisted codes. */
const NAV_MATCH_CONCURRENCY = 12;
const MIN_NAV_HITS = 2;
/** Portal price match: txn calendar day plus the next two days (no prior-day files). */
const PORTAL_FORWARD_CALENDAR_DAYS = 3;
/** Portal bootstrap tries txn 1, then up to two more txns when the first has no price match. */
const PORTAL_BOOTSTRAP_TXN_COUNT = 3;
const PORTAL_FETCH_TIMEOUT_MS = 60000;
const PORTAL_USER_AGENT = "Mozilla/5.0 (compatible; CAS-amfi-resolve/1.0)";
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type AmfiSchemeMapEntry = { code: string; by: "isin" | "name" | "nav"; updatedAt: string };

export type AmfiSchemeMapStore = Record<string, AmfiSchemeMapEntry>;

function nowIso(): string {
  return new Date().toISOString();
}

function toNum(s?: string | null): number {
  if (s == null || s === "") return 0;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseCasTxDate(input?: string | null): Date | null {
  if (!input) return null;
  const s = input.trim();
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime())) return d1;
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const day = Number(m[1]);
  const mon = months[m[2].toLowerCase()];
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (!Number.isFinite(day) || mon == null || !Number.isFinite(year)) return null;
  return new Date(year, mon, day, 12, 0, 0);
}

function parseMfapiNavDate(s: string): Date | null {
  const m = String(s).trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm - 1, dd, 12, 0, 0);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
}

function stripNoiseTokens(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fund|plan|option|series|class)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForMatch(s: string): Set<string> {
  const raw = stripNoiseTokens(s);
  const parts = raw.split(" ").filter((t) => t.length > 1);
  return new Set(parts);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

type SchemeRow = {
  amfi: string;
  name: string;
  tokens: Set<string>;
};

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

export class AmfiRegistry {
  private readonly rows: SchemeRow[];
  private readonly isinToAmfi = new Map<string, string>();

  private constructor(rows: SchemeRow[], isinToAmfi: Map<string, string>) {
    this.rows = rows;
    this.isinToAmfi = isinToAmfi;
  }

  static fromCsv(text: string): AmfiRegistry {
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (!lines.length) return new AmfiRegistry([], new Map());
    const isinToAmfi = new Map<string, string>();
    const rows: SchemeRow[] = [];
    const header = parseCsvLine(lines[0]).map((c) => c.toLowerCase());
    const iCode = header.indexOf("scheme_code");
    const iName = header.indexOf("scheme_name");
    const iG = header.indexOf("isin_growth");
    const iD = header.indexOf("isin_dividend");
    if (iCode < 0 || iName < 0) return new AmfiRegistry([], new Map());

    for (let li = 1; li < lines.length; li += 1) {
      const cols = parseCsvLine(lines[li]);
      if (cols.length < Math.max(iCode, iName) + 1) continue;
      const amfi = cols[iCode]?.trim();
      const name = cols[iName]?.trim() ?? "";
      if (!amfi || !/^\d+$/.test(amfi)) continue;
      const tokens = tokenizeForMatch(name);
      rows.push({ amfi, name, tokens });
      const g = iG >= 0 ? cols[iG]?.trim().toUpperCase() : "";
      const d = iD >= 0 ? cols[iD]?.trim().toUpperCase() : "";
      for (const isin of [g, d]) {
        if (isin && /^INF[A-Z0-9]{9}$/.test(isin) && !isinToAmfi.has(isin)) {
          isinToAmfi.set(isin, amfi);
        }
      }
    }
    return new AmfiRegistry(rows, isinToAmfi);
  }

  lookupByIsin(isin: string): string | null {
    const k = isin.trim().toUpperCase();
    if (!k) return null;
    return this.isinToAmfi.get(k) ?? null;
  }

  /**
   * Scheme rows whose official name contains the CAS fund label as a substring (case-insensitive).
   * Collapses all runs of whitespace to a single space on both sides so master typos like
   * `Low Duration  Fund` still match `Low Duration Fund`.
   */
  findStrictNameCandidates(displayName: string): string[] {
    const needle = normalizeSchemeWhitespace(displayName).toLowerCase();
    if (!needle) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of this.rows) {
      if (!normalizeSchemeWhitespace(r.name).toLowerCase().includes(needle)) continue;
      if (seen.has(r.amfi)) continue;
      seen.add(r.amfi);
      out.push(r.amfi);
    }
    return out;
  }

  /** Official scheme name from master CSV for an AMFI scheme code (debugging). */
  schemeNameForAmfi(code: string): string | null {
    for (const r of this.rows) {
      if (r.amfi === code) return r.name;
    }
    return null;
  }

  /** @deprecated Legacy Jaccard shortlist; prefer {@link strictFundLabelCandidates}. */
  findNameCandidates(displayName: string, limit = 28): string[] {
    const qTokens = tokenizeForMatch(displayName);
    if (!qTokens.size) return [];
    const scored: { amfi: string; score: number }[] = [];
    for (const r of this.rows) {
      const score = jaccard(qTokens, r.tokens);
      if (score < 0.08) continue;
      scored.push({ amfi: r.amfi, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of scored) {
      if (seen.has(s.amfi)) continue;
      seen.add(s.amfi);
      out.push(s.amfi);
      if (out.length >= limit) break;
    }
    return out;
  }
}

/** Collapse whitespace for strict name ↔ master CSV substring checks. */
export function normalizeSchemeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Remove CAMS/KFintech internal scheme letter codes at the start of the scheme line
 * (e.g. `H 51 T - `, `# H 58 - `) so matching uses `HDFC …` instead of a lone `H` token.
 */
export function stripLeadingCasSchemeHeaderPrefix(displayName: string): string {
  let s = displayName.replace(/\s+/g, " ").trim();
  const re = /^(?:#\s*)?(?:[A-Za-z]\s*\d+\s*(?:T\s*)?-\s*)+/;
  for (;;) {
    const m = s.match(re);
    if (!m) break;
    s = s.slice(m[0].length).trim();
  }
  return s.trim();
}

/** Master CSV rows whose `scheme_name` contains the CAS fund label (strict path only). */
export function strictFundLabelCandidates(registry: AmfiRegistry, displayName: string): string[] {
  const raw = displayName.replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const label = stripLeadingCasSchemeHeaderPrefix(raw) || raw;
  return registry.findStrictNameCandidates(label);
}

/** Rows that are payout / IDCW / reinvest variants rather than accumulation Growth. */
function isIncomeOrPayoutFlavorMasterName(name: string): boolean {
  const u = name.toUpperCase();
  if (/\bIDCW\b/.test(name)) return true;
  if (u.includes("INCOME DISTRIBUTION")) return true;
  if (/\bPAYOUT\b/.test(u)) return true;
  if (u.includes("REINVESTMENT")) return true;
  return false;
}

/**
 * Discard strict CSV rows that contradict the CAS plan line (Growth vs IDCW / payout labels, Bonus option,
 * Direct vs Regular). Eliminates NAV ties where mfapi NAV matches accumulation and income options on the same day.
 */
export function narrowStrictCandidatesByCas(registry: AmfiRegistry, codes: string[], h: Holding): string[] {
  if (codes.length <= 1) return codes;

  const blob = normalizeSchemeWhitespace(`${h.scheme_name || ""} ${h.scheme_info || ""}`).toLowerCase();
  let narrowed = [...codes];

  if (/\bdirect plan\b/.test(blob)) {
    const next = narrowed.filter((c) => /\bDirect Plan\b/i.test(registry.schemeNameForAmfi(c) || ""));
    if (next.length) narrowed = next;
  } else if (/\bregular plan\b/.test(blob)) {
    const next = narrowed.filter((c) => /\bRegular Plan\b/i.test(registry.schemeNameForAmfi(c) || ""));
    if (next.length) narrowed = next;
  }

  const casWantsIncomeFlavor =
    /\bidcw\b/.test(blob) ||
    /\bincome distribution cum capital withdrawal\b/.test(blob) ||
    /\bpayout of income\b/.test(blob) ||
    /\breinvestment of income distribution\b/.test(blob);

  const afterInc = narrowed.filter((c) => {
    const nm = registry.schemeNameForAmfi(c) || "";
    const inc = isIncomeOrPayoutFlavorMasterName(nm);
    return casWantsIncomeFlavor ? inc : !inc;
  });
  if (afterInc.length) narrowed = afterInc;

  if (!/\bbonus\b/i.test(blob)) {
    const afterBonus = narrowed.filter((c) => !/\bBonus\b/i.test(registry.schemeNameForAmfi(c) || ""));
    if (afterBonus.length) narrowed = afterBonus;
  }

  return narrowed.length ? narrowed : codes;
}

/** Strict label match + CAS plan narrowing (resolver + CLI use this shared shortlist). */
export function strictCandidatesForHolding(registry: AmfiRegistry, h: Holding): string[] {
  const label = (h.scheme_name_simple || h.scheme_name || "").replace(/\s+/g, " ").trim();
  if (!label) return [];
  return narrowStrictCandidatesByCas(registry, strictFundLabelCandidates(registry, label), h);
}

export function storeIsinKey(isin: string): string {
  return `i:${isin.trim().toUpperCase()}`;
}

export function storeNameKey(h: Holding): string {
  const folio = (h.folio_no || "").trim();
  /* Full scheme line first so two holdings with the same scheme_name_simple (e.g. Monthly vs Weekly IDCW) do not share one cache slot. */
  const raw = normalizeSchemeWhitespace(h.scheme_name || h.scheme_name_simple || "")
    .trim()
    .toLowerCase();
  const slug = raw.replace(/[^a-z0-9]+/g, "_").replace(/_+/g, "_").slice(0, 120);
  return `n:${folio}:${slug}`;
}

function fmtAmfiPortalFrmdt(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS_SHORT[d.getMonth()];
  return `${day}-${mon}-${d.getFullYear()}`;
}

/** Portal returns `DD-MMM-YYYY`; cache full day maps code → NAV. */
const portalDayNavCache = new Map<string, Map<string, number>>();

export async function fetchPortalNavMapForDate(frmdt: string): Promise<Map<string, number>> {
  const cached = portalDayNavCache.get(frmdt);
  if (cached !== undefined) return cached;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PORTAL_FETCH_TIMEOUT_MS);
  const out = new Map<string, number>();
  let completedOk = false;
  try {
    const url = `${AMFI_PORTAL_NAV_URL}?frmdt=${encodeURIComponent(frmdt)}`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "text/plain,*/*", "User-Agent": PORTAL_USER_AGENT },
    });
    if (!res.ok) {
      return out;
    }
    const raw = await res.text();
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("Open Ended") || t.startsWith("Close Ended")) continue;
      if (!/^\d+;/.test(t)) continue;
      const parts = t.split(";");
      if (parts.length < 6) continue;
      const code = parts[0]?.trim();
      const navStr = parts[4]?.trim();
      if (!code || !/^\d+$/.test(code)) continue;
      const nav = toNum(navStr);
      if (nav <= 0) continue;
      out.set(code, nav);
    }
    completedOk = true;
  } catch {
    // network / parse failure — do not cache so the next resolution attempt can retry.
  } finally {
    clearTimeout(timer);
  }
  if (completedOk) {
    portalDayNavCache.set(frmdt, out);
  }
  return out;
}

/** AMFI scheme codes whose portal NAV equals price (4 dp) on txn date and the next 2 calendar days. */
async function amfiCodesMatchingPortalPriceForSample(
  targetMs: number,
  price: number,
  trace?: AmfiResolveTrace,
): Promise<Set<string>> {
  const match = new Set<string>();
  const p4 = round4(price);
  for (let delta = 0; delta < PORTAL_FORWARD_CALENDAR_DAYS; delta += 1) {
    const d = new Date(targetMs);
    d.setDate(d.getDate() + delta);
    const frmdt = fmtAmfiPortalFrmdt(d.getTime());
    const dayMap = await fetchPortalNavMapForDate(frmdt);
    for (const [code, nav] of dayMap) {
      if (round4(nav) === p4) match.add(code);
    }
    trace?.appendNow(`Portal day ${frmdt} @ ${p4}: ${dayMap.size} NAV row(s), ${match.size} price match(es) so far`);
  }
  return match;
}

/** Scheme codes whose portal NAV equals CAS price (4 dp) on txn date and the next 2 calendar days. */
export async function portalCodesMatchingCasPriceWindow(targetMs: number, price: number): Promise<string[]> {
  const s = await amfiCodesMatchingPortalPriceForSample(targetMs, price);
  return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** NAV and CAS unit price must match after rounding to 4 decimal places (no relative tolerance). */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Parsed closing valuation on the CAS block (statement NAV + date). */
type HoldingNavPick = Pick<Holding, "nav_date" | "nav_inr" | "closing_units">;

/** When strict substring match on master CSV yields no rows: progressive portal + NAV disambiguation. */
async function resolveWhenNoStrictNameMatch(
  transactions: Transaction[],
  holding?: HoldingNavPick,
  trace?: AmfiResolveTrace,
): Promise<string | null> {
  trace?.appendNow(
    "No strict name match — portal bootstrap (up to 3 txns), then AMFI history on remaining txns",
  );
  const samples = pickTransactionSamples(transactions, 0, holding);
  if (!samples.length) {
    trace?.appendNow("No qualifying transaction price samples for portal path");
    return null;
  }
  return resolvePortalNavProgressive(samples, trace);
}

function dedupePriceSamples(samples: { t: number; price: number }[]): { t: number; price: number }[] {
  const seen = new Set<string>();
  const out: { t: number; price: number }[] = [];
  for (const s of samples) {
    const k = `${s.t}|${round4(s.price)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * CAS closing line `NAV on DD-Mon-YYYY: INR …` is scheme NAV (same 4 dp check as txn unit price).
 * Used when the statement period has no qualifying purchase/redemption rows but units are held.
 */
function closingNavPriceSample(holding?: HoldingNavPick): { t: number; price: number } | null {
  if (!holding) return null;
  const units = toNum(holding.closing_units);
  if (!Number.isFinite(units) || units === 0) return null;
  const price = toNum(holding.nav_inr);
  if (price <= 0) return null;
  const d = parseCasTxDate(holding.nav_date);
  if (!d) return null;
  return { t: d.getTime(), price };
}

/** `maxSamples` 0 or negative = use every qualifying txn (portal path + AMFI history verify). */
function pickTransactionSamples(
  transactions: Transaction[],
  maxSamples = MAX_TX_SAMPLES,
  holding?: HoldingNavPick,
): { t: number; price: number }[] {
  const raw: { t: number; price: number }[] = [];
  for (const tx of transactions) {
    if (tx.is_synthetic === "true") continue;
    // Dividend reinvestment lines quote a reinvestment price, not scheme NAV — unusable for NAV matching.
    if (/IDCW\s+Reinvested/i.test(tx.description || "")) continue;
    const units = toNum(tx.units);
    const price = toNum(tx.price_inr);
    /* Switch-outs use negative units but still carry the scheme unit price for NAV checks. */
    if (!Number.isFinite(units) || units === 0 || price <= 0) continue;
    const d = parseCasTxDate(tx.date);
    if (!d) continue;
    raw.push({ t: d.getTime(), price });
  }
  raw.sort((a, b) => a.t - b.t);
  const closing = closingNavPriceSample(holding);
  const slotClosing = closing ? 1 : 0;

  let txPicked: typeof raw;
  if (maxSamples <= 0 || raw.length + slotClosing <= maxSamples) {
    txPicked = raw;
  } else {
    const budget = Math.max(1, maxSamples - slotClosing);
    txPicked = [];
    const step = Math.max(1, Math.floor(raw.length / budget));
    for (let i = 0; i < raw.length && txPicked.length < budget; i += step) {
      txPicked.push(raw[i]);
    }
  }

  return dedupePriceSamples([...txPicked, ...(closing ? [closing] : [])]);
}

export type NavPoint = { t: number; nav: number };

/** Optional date window for NAV pulls (AMFI chunked API + mfapi slice). */
export type NavSeriesFetchRange = { fromMs: number; toMs: number };

const DEFAULT_NAV_FROM_MS = new Date(1990, 0, 1, 12, 0, 0, 0).getTime();

function defaultNavRangeToMs(): number {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

const navSeriesCache = new Map<string, NavPoint[]>();

/** NAV series merged per AMFI so mapping pulls and portfolio NAV reuse the same history. */
const navSeriesMergedCache = new Map<string, NavPoint[]>();

function navSeriesCacheKey(amfi: string, range?: NavSeriesFetchRange): string {
  if (!range) return `${amfi}|full`;
  const a = Math.floor(range.fromMs / 86400000);
  const b = Math.floor(range.toMs / 86400000);
  return `${amfi}|${a}|${b}`;
}

function sliceNavSeries(points: NavPoint[], fromMs: number, toMs: number): NavPoint[] {
  return points.filter((p) => p.t >= fromMs && p.t <= toMs);
}

function mergeNavSeriesPoints(a: NavPoint[], b: NavPoint[]): NavPoint[] {
  const byT = new Map<number, number>();
  for (const p of a) byT.set(p.t, p.nav);
  for (const p of b) byT.set(p.t, p.nav);
  return [...byT.entries()].map(([t, nav]) => ({ t, nav })).sort((x, y) => x.t - y.t);
}

function mergedSeriesCoversRange(pts: NavPoint[], fromMs: number, toMs: number): boolean {
  if (!pts.length) return false;
  const edgeSlackMs = 2 * 86400000;
  return pts[0]!.t <= fromMs + edgeSlackMs && pts[pts.length - 1]!.t >= toMs - edgeSlackMs;
}

function navRangeCoveringSamples(samples: { t: number }[]): NavSeriesFetchRange {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const s of samples) {
    lo = Math.min(lo, s.t);
    hi = Math.max(hi, s.t);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    const n = Date.now();
    return { fromMs: n - NAV_WINDOW_MS * 2, toMs: n + NAV_WINDOW_MS * 2 };
  }
  return { fromMs: lo - NAV_WINDOW_MS, toMs: hi + NAV_WINDOW_MS };
}

async function fetchNavSeriesFromMfapi(amfi: string): Promise<NavPoint[]> {
  const fetchOnce = async (): Promise<NavPoint[]> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NAV_FETCH_TIMEOUT_MS);
    const pts: NavPoint[] = [];
    try {
      const res = await fetch(`${MFAPI_BASE}${encodeURIComponent(amfi)}`, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        return [];
      }
      const body = (await res.json()) as { status?: string; data?: { date?: string; nav?: string }[] };
      const st = String(body.status ?? "").toUpperCase();
      if ((st !== "OK" && st !== "SUCCESS") || !Array.isArray(body.data)) {
        return [];
      }
      for (const row of body.data) {
        if (!row?.date || row.nav == null) continue;
        const d = parseMfapiNavDate(String(row.date));
        if (!d) continue;
        const nav = toNum(String(row.nav));
        if (nav <= 0) continue;
        pts.push({ t: d.getTime(), nav });
      }
      pts.sort((a, b) => a.t - b.t);
      return pts;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  };
  return fetchWithMfapiBackoff(fetchOnce, (p) => p.length > 0);
}

function navExact4dpMatchInWindow(series: NavPoint[], targetMs: number, price: number): boolean {
  const p = round4(price);
  for (const pt of series) {
    if (Math.abs(pt.t - targetMs) > NAV_WINDOW_MS) continue;
    if (round4(pt.nav) === p) return true;
  }
  return false;
}

type PortalBootstrapResult = {
  candidates: Set<string>;
  portalTxnIndex: number;
};

async function bootstrapPortalCandidates(
  samples: { t: number; price: number }[],
  trace?: AmfiResolveTrace,
): Promise<PortalBootstrapResult | null> {
  const limit = Math.min(PORTAL_BOOTSTRAP_TXN_COUNT, samples.length);
  for (let i = 0; i < limit; i += 1) {
    const sample = samples[i]!;
    const codes = await amfiCodesMatchingPortalPriceForSample(sample.t, sample.price, trace);
    if (codes.size) {
      trace?.appendNow(`Portal on txn ${i + 1}: ${codes.size} eligible code(s)`);
      return { candidates: codes, portalTxnIndex: i };
    }
    trace?.appendNow(`Portal on txn ${i + 1}: no code on txn day or next 2 calendar day(s)`);
  }
  trace?.appendNow(`No portal-eligible codes in first ${limit} txn(s)`);
  return null;
}

/**
 * Portal consolidated NAV on up to three txns, then AMFI per-scheme history for survivors only.
 * Remaining qualifying txns after the portal txn are matched against that history.
 */
async function resolvePortalNavProgressive(
  samples: { t: number; price: number }[],
  trace?: AmfiResolveTrace,
): Promise<string | null> {
  const portalBootstrap = await bootstrapPortalCandidates(samples, trace);
  if (!portalBootstrap?.candidates.size) return null;

  const { candidates, portalTxnIndex } = portalBootstrap;
  const matchSamples = samples.slice(portalTxnIndex + 1);
  if (!matchSamples.length) {
    if (candidates.size === 1) {
      const amfi = [...candidates][0]!;
      trace?.appendNow(`Only portal txn available — sole eligible AMFI ${amfi}`);
      return amfi;
    }
    trace?.appendNow(
      `Only portal txn available — ${candidates.size} eligible code(s), no further NAV samples`,
    );
    return null;
  }

  trace?.appendNow(
    `AMFI history checks on ${matchSamples.length} txn(s) after portal txn ${portalTxnIndex + 1}`,
  );
  const scored: { amfi: string; hits: number }[] = [];
  const sorted = [...candidates].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const range = navRangeCoveringSamples(matchSamples);
  const minHitsRequired = Math.min(MIN_NAV_HITS, matchSamples.length);

  for (let i = 0; i < sorted.length; i += NAV_MATCH_CONCURRENCY) {
    const chunk = sorted.slice(i, i + NAV_MATCH_CONCURRENCY);
    const part = await Promise.all(
      chunk.map(async (amfi) => {
        const series = await fetchNavSeriesFromAmfiOnly(amfi, range);
        if (!series.length) {
          trace?.appendNow(`AMFI ${amfi}: empty NAV history`);
          return null;
        }
        let hits = 0;
        for (const sample of matchSamples) {
          if (navExact4dpMatchInWindow(series, sample.t, sample.price)) hits += 1;
        }
        if (hits === 0) {
          trace?.appendNow(
            `AMFI ${amfi}: failed — 0/${matchSamples.length} NAV hit(s) after portal txn`,
          );
          return null;
        }
        trace?.appendNow(`AMFI ${amfi}: ${hits}/${matchSamples.length} NAV hit(s) after portal txn`);
        return { amfi, hits };
      }),
    );
    for (const row of part) {
      if (row) scored.push(row);
    }
  }

  if (!scored.length) {
    trace?.appendNow("No portal survivor passed AMFI history NAV checks");
    return null;
  }

  scored.sort((a, b) => b.hits - a.hits || a.amfi.localeCompare(b.amfi, undefined, { numeric: true }));
  const best = scored[0]!;
  const second = scored[1];
  if (best.hits < minHitsRequired) {
    trace?.appendNow(
      `Best survivor ${best.amfi} has ${best.hits} hit(s) — need ${minHitsRequired}`,
    );
    return null;
  }
  if (second && second.hits === best.hits) {
    trace?.appendNow(`Ambiguous — ${best.amfi} and ${second.amfi} tied at ${best.hits} hit(s)`);
    return null;
  }
  trace?.appendNow(`Portal/NAV chose AMFI ${best.amfi} (${best.hits} hit(s))`);
  return best.amfi;
}

function formatMsDDMMMYYYY(ms: number): string {
  const d = new Date(ms);
  const mon = MONTHS_SHORT[d.getMonth()];
  return `${String(d.getDate()).padStart(2, "0")}-${mon}-${d.getFullYear()}`;
}

/** Explains why CAS unit price (4 dp) did not match AMFI history NAV in the ±3 calendar-day window. */
function amfiNavMismatchExplanation(series: NavPoint[], targetMs: number, casPrice: number): string {
  const p = round4(casPrice);
  const lo = targetMs - NAV_WINDOW_MS;
  const hi = targetMs + NAV_WINDOW_MS;
  const pts = series.filter((pt) => pt.t >= lo && pt.t <= hi).sort((a, b) => a.t - b.t);
  if (!pts.length) {
    return `no AMFI NAV rows between ${formatMsDDMMMYYYY(lo)} and ${formatMsDDMMMYYYY(hi)}`;
  }
  if (pts.some((pt) => round4(pt.nav) === p)) return `MATCH at 4 dp`;
  const navLines = pts.map((pt) => `${formatMsDDMMMYYYY(pt.t)}→${round4(pt.nav)}`).join("; ");
  return `CAS/unit round4=${p}; AMFI history in ±3d window: ${navLines}`;
}

export type TxQualifyingDetail = {
  t: number;
  price: number;
  date: string;
  units: number;
  desc: string;
};

/** Same filtering/subsampling as `pickTransactionSamples`, but keeps CAS fields for debugging. */
export function collectQualifyingTxDetails(
  transactions: Transaction[],
  maxSamples: number,
  holding?: HoldingNavPick,
): TxQualifyingDetail[] {
  const raw: TxQualifyingDetail[] = [];
  for (const tx of transactions) {
    if (tx.is_synthetic === "true") continue;
    if (/IDCW\s+Reinvested/i.test(tx.description || "")) continue;
    const units = toNum(tx.units);
    const price = toNum(tx.price_inr);
    if (!Number.isFinite(units) || units === 0 || price <= 0) continue;
    const d = parseCasTxDate(tx.date);
    if (!d) continue;
    raw.push({
      t: d.getTime(),
      price,
      date: (tx.date || "").trim(),
      units,
      desc: (tx.description || "").replace(/\s+/g, " ").trim().slice(0, 88),
    });
  }
  raw.sort((a, b) => a.t - b.t);
  const byKey = new Map<string, TxQualifyingDetail>();
  for (const r of raw) {
    const k = `${r.t}|${round4(r.price)}`;
    if (!byKey.has(k)) byKey.set(k, r);
  }

  const closing = closingNavPriceSample(holding);
  const samples = pickTransactionSamples(transactions, maxSamples, holding);

  const out: TxQualifyingDetail[] = [];
  for (const s of samples) {
    const k = `${s.t}|${round4(s.price)}`;
    const fromTx = byKey.get(k);
    if (fromTx) {
      out.push(fromTx);
      continue;
    }
    if (
      closing &&
      s.t === closing.t &&
      round4(s.price) === round4(closing.price) &&
      holding &&
      toNum(holding.closing_units) !== 0
    ) {
      out.push({
        t: s.t,
        price: s.price,
        date: String(holding.nav_date ?? "").trim(),
        units: toNum(holding.closing_units),
        desc: "CAS closing valuation NAV",
      });
    }
  }
  return out;
}

/**
 * NAV series for scheme `amfi` from the AMFI nav-history API only (no mfapi fallback).
 * Used for portal and strict-name NAV disambiguation.
 */
async function fetchNavSeriesFromAmfiOnly(amfi: string, range?: NavSeriesFetchRange): Promise<NavPoint[]> {
  const id = String(amfi ?? "").trim();
  if (!/^\d+$/.test(id)) return [];

  const fromMs = range?.fromMs ?? DEFAULT_NAV_FROM_MS;
  const toMs = range?.toMs ?? defaultNavRangeToMs();

  const merged = navSeriesMergedCache.get(id);
  if (merged?.length && mergedSeriesCoversRange(merged, fromMs, toMs)) {
    return sliceNavSeries(merged, fromMs, toMs);
  }

  const key = `${navSeriesCacheKey(id, range)}|amfi-only`;
  const cached = navSeriesCache.get(key);
  if (cached !== undefined && cached.length > 0) {
    const nextMerged = mergeNavSeriesPoints(merged ?? [], cached);
    navSeriesMergedCache.set(id, nextMerged);
    return sliceNavSeries(nextMerged, fromMs, toMs);
  }
  if (cached !== undefined && cached.length === 0) {
    navSeriesCache.delete(key);
  }

  const pts = await fetchAmfiNavHistorySeries(id, fromMs, toMs);
  pts.sort((a, b) => a.t - b.t);
  if (pts.length > 0) {
    navSeriesCache.set(key, pts);
    navSeriesMergedCache.set(id, mergeNavSeriesPoints(merged ?? [], pts));
    return sliceNavSeries(navSeriesMergedCache.get(id)!, fromMs, toMs);
  }
  return pts;
}

/**
 * NAV series for scheme `amfi` (AMFI `sd_id`). Uses AMFI nav-history API first (chunked + parallel chunks),
 * then mfapi.in with exponential backoff if AMFI returns no usable points.
 * Pass `range` to limit downloads (recommended for analytics / CAS windows).
 */
export async function fetchNavSeriesForAmfi(amfi: string, range?: NavSeriesFetchRange): Promise<NavPoint[]> {
  const id = String(amfi ?? "").trim();
  if (!/^\d+$/.test(id)) return [];

  const fromMs = range?.fromMs ?? DEFAULT_NAV_FROM_MS;
  const toMs = range?.toMs ?? defaultNavRangeToMs();

  const merged = navSeriesMergedCache.get(id);
  if (merged?.length && mergedSeriesCoversRange(merged, fromMs, toMs)) {
    return sliceNavSeries(merged, fromMs, toMs);
  }

  const diskPts = await loadPersistedNavSeries(id);
  if (diskPts?.length) {
    const fromDisk = mergeNavSeriesPoints(merged ?? [], diskPts);
    navSeriesMergedCache.set(id, fromDisk);
    if (mergedSeriesCoversRange(fromDisk, fromMs, toMs)) {
      return sliceNavSeries(fromDisk, fromMs, toMs);
    }
  }

  const key = navSeriesCacheKey(id, range);
  const cached = navSeriesCache.get(key);
  if (cached !== undefined && cached.length > 0) {
    const nextMerged = mergeNavSeriesPoints(merged ?? [], cached);
    navSeriesMergedCache.set(id, nextMerged);
    return sliceNavSeries(nextMerged, fromMs, toMs);
  }
  if (cached !== undefined && cached.length === 0) {
    navSeriesCache.delete(key);
  }

  let pts: NavPoint[] = await fetchAmfiNavHistorySeries(id, fromMs, toMs);
  if (!pts.length) {
    let mf = await fetchNavSeriesFromMfapi(id);
    if (range && mf.length) {
      mf = mf.filter((p) => p.t >= fromMs && p.t <= toMs);
    }
    pts = mf;
  }
  pts.sort((a, b) => a.t - b.t);
  if (pts.length > 0) {
    navSeriesCache.set(key, pts);
    const full = mergeNavSeriesPoints(navSeriesMergedCache.get(id) ?? merged ?? [], pts);
    navSeriesMergedCache.set(id, full);
    void savePersistedNavSeries(id, full);
    return sliceNavSeries(full, fromMs, toMs);
  }
  return pts;
}

/**
 * Ignore dormant folio lines: opening and closing units are both zero and the CAS
 * block has no transaction rows (same as "*** No transactions during this period ***").
 */
export function shouldSkipAmfiResolution(h: Holding): boolean {
  const open = toNum(h.opening_units);
  const close = toNum(h.closing_units);
  if (open !== 0 || close !== 0) return false;
  return (h.transactions ?? []).length === 0;
}

async function scoreAmfiByNavHits(
  amfi: string,
  samples: { t: number; price: number }[],
  trace?: AmfiResolveTrace,
): Promise<{
  amfi: string;
  hits: number;
} | null> {
  const series = await fetchNavSeriesFromAmfiOnly(amfi, navRangeCoveringSamples(samples));
  if (!series.length) {
    trace?.appendNow(`NAV series empty for AMFI ${amfi}`);
    return null;
  }
  let hits = 0;
  for (const s of samples) {
    if (navExact4dpMatchInWindow(series, s.t, s.price)) hits += 1;
  }
  trace?.appendNow(`NAV score AMFI ${amfi}: ${hits}/${samples.length} sample hit(s)`);
  return { amfi, hits };
}

async function pickAmfiByNav(
  amfiList: string[],
  transactions: Transaction[],
  options?: { maxSamples?: number; holding?: HoldingNavPick },
  trace?: AmfiResolveTrace,
): Promise<string | null> {
  const sortedAmfis = [...amfiList].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const maxSamples = options?.maxSamples ?? MAX_TX_SAMPLES;
  const samples = pickTransactionSamples(transactions, maxSamples, options?.holding);
  if (!samples.length) {
    trace?.appendNow("NAV disambiguation skipped — no qualifying price samples");
    return null;
  }
  const minHitsRequired = Math.min(MIN_NAV_HITS, samples.length);
  trace?.appendNow(
    `NAV disambiguation across ${sortedAmfis.length} candidate code(s), ${samples.length} sample(s), need ${minHitsRequired} hit(s)`,
  );

  type Cand = { amfi: string; hits: number };
  const scored: Cand[] = [];

  for (let i = 0; i < sortedAmfis.length; i += NAV_MATCH_CONCURRENCY) {
    const chunk = sortedAmfis.slice(i, i + NAV_MATCH_CONCURRENCY);
    const part = await Promise.all(chunk.map((amfi) => scoreAmfiByNavHits(amfi, samples, trace)));
    for (const row of part) {
      if (!row || row.hits < minHitsRequired) continue;
      scored.push(row);
    }
  }

  if (!scored.length) {
    trace?.appendNow("NAV disambiguation found no candidate meeting minimum hits");
    return null;
  }
  scored.sort((a, b) => b.hits - a.hits || a.amfi.localeCompare(b.amfi, undefined, { numeric: true }));
  const best = scored[0];
  const second = scored[1];
  /** Two schemes both match NAV on every sampled txn → ambiguous; do not guess. */
  if (second && second.hits === best.hits) {
    trace?.appendNow(`NAV disambiguation tie: ${best.amfi} vs ${second.amfi} at ${best.hits} hit(s)`);
    return null;
  }
  trace?.appendNow(`NAV disambiguation chose AMFI ${best!.amfi} (${best!.hits} hit(s))`);
  return best!.amfi;
}

/**
 * Human-readable trace for how `resolveAmfiForParsedCasCore` classifies a holding (ISIN from master CSV first
 * unless `skipIsin`, then cached name-key, strict name/NAV paths). Stateless: does not read the AMFI cache.
 */
export async function explainAmfiResolutionSteps(
  h: Holding,
  registry: AmfiRegistry,
  options?: ResolveAmfiOptions,
): Promise<string[]> {
  const lines: string[] = [];
  const title = (h.scheme_name_simple || h.scheme_name || "(no name)").slice(0, 72);
  lines.push(`=== ${title}${((h.scheme_name_simple || h.scheme_name || "").length > 72 ? "…" : "")} ===`);

  if (shouldSkipAmfiResolution(h)) {
    lines.push("Skipped: dormant folio (0 units & no transaction rows).");
    return lines;
  }

  const isin = (h.isin || "").trim().toUpperCase();

  let stepNum = 1;
  const nextStep = (): string => {
    const n = String(stepNum);
    stepNum += 1;
    return `${n})`;
  };

  if (!options?.skipIsin && isin && /^INF[A-Z0-9]{9}$/.test(isin)) {
    const fromCsv = registry.lookupByIsin(isin);
    if (fromCsv) {
      lines.push(`${nextStep()} Master CSV lookup by ISIN ${isin} → AMFI ${fromCsv}.`);
      lines.push("RESULT: Resolved by ISIN (resolver would not run name/NAV for this holding).");
      return lines;
    }
    lines.push(
      `${nextStep()} ISIN ${isin} absent from master CSV ISIN columns; resolver continues with cached name-key (if persisted) then name/NAV.`,
    );
  } else if (options?.skipIsin && isin && /^INF[A-Z0-9]{9}$/.test(isin)) {
    lines.push(
      `${nextStep()} ISIN mapping disabled (same as --skip-isin); resolver would skip CSV ISIN lookup for ${isin}.`,
    );
  } else {
    lines.push(
      `${nextStep()} ${isin ? `Non-standard holding ISIN (${isin});` : "No ISIN on holding;"} resolver relies on cached name-key (if persisted) then name/NAV.`,
    );
  }

  const nk = storeNameKey(h);
  lines.push(
    `${nextStep()} In-memory resolver would consult store key "${nk}" if the app had cached an AMFI for this holding (this trace ignores cache).`,
  );

  const label = (h.scheme_name_simple || h.scheme_name || "").replace(/\s+/g, " ").trim();
  lines.push(`${nextStep()} Fund label for strict CSV match: "${label.length > 100 ? `${label.slice(0, 100)}…` : label}"`);

  const strictList = strictCandidatesForHolding(registry, h);
  lines.push(
    `${nextStep()} Strict substring matches in unique_schemes.csv (narrowed by CAS Direct/Regular, Growth vs payout/IDCW/reinvest, Bonus flag): ${strictList.length} code(s).`,
  );

  const txs = h.transactions ?? [];

  if (strictList.length === 1) {
    lines.push(`${nextStep()} Single match → would assign AMFI ${strictList[0]} (by name).`);
    return lines;
  }

  if (strictList.length > 1) {
    lines.push(
      `${nextStep()} Multiple strict matches → AMFI history only (±${NAV_WINDOW_MS / 86400000} calendar days, 4 dp), max ${MAX_TX_SAMPLES} sampled txns.`,
    );
    const samples6 = pickTransactionSamples(txs, MAX_TX_SAMPLES, h);
    lines.push(`   Qualifying txn samples: ${samples6.length}.`);
    if (!samples6.length) {
      lines.push("RESULT: No usable txns → cannot disambiguate.");
      return lines;
    }
    const minReq = Math.min(MIN_NAV_HITS, samples6.length);
    lines.push(`   Minimum NAV hits required: ${minReq}.`);

    const scored: { amfi: string; hits: number }[] = [];
    for (let i = 0; i < strictList.length; i += NAV_MATCH_CONCURRENCY) {
      const chunk = strictList.slice(i, i + NAV_MATCH_CONCURRENCY);
      const part = await Promise.all(chunk.map((amfi) => scoreAmfiByNavHits(amfi, samples6)));
      for (const row of part) if (row) scored.push(row);
    }
    scored.sort((a, b) => b.hits - a.hits);

    for (const s of scored.slice(0, 12)) {
      lines.push(`   AMFI ${s.amfi}: ${s.hits}/${samples6.length} hits`);
    }
    if (strictList.length > 12) lines.push(`   (${strictList.length} strict candidates total)`);

    const best = scored[0];
    const second = scored[1];
    if (!best || best.hits < minReq) {
      lines.push(
        `RESULT: No candidate reaches ${minReq} hits on sampled txns (best ${best?.hits ?? 0}). Portal path is not used when strict list is non-empty.`,
      );
      return lines;
    }
    if (second && second.hits === best.hits) {
      lines.push(`RESULT: Tie — AMFI ${best.amfi} and ${second.amfi} both ${best.hits} hits → unresolved.`);
      return lines;
    }
    lines.push(`RESULT: Would pick AMFI ${best.amfi} (unique top hit count).`);
    return lines;
  }

  lines.push(
    `${nextStep()} Zero strict matches → portal on up to three txns, then AMFI history on remaining txns (no mfapi).`,
  );
  const samplesAll = pickTransactionSamples(txs, 0, h);
  lines.push(`   Qualifying txns (full history): ${samplesAll.length}.`);
  if (!samplesAll.length) {
    lines.push("RESULT: No usable txns.");
    return lines;
  }

  const portalBootstrap = await bootstrapPortalCandidates(samplesAll);
  if (!portalBootstrap?.candidates.size) {
    lines.push("RESULT: No portal-eligible codes in first three txns.");
    return lines;
  }
  lines.push(
    `${nextStep()} Portal bootstrap on txn ${portalBootstrap.portalTxnIndex + 1}: ${portalBootstrap.candidates.size} eligible code(s).`,
  );
  lines.push(
    `   Sample codes: ${[...portalBootstrap.candidates].slice(0, 20).join(", ")}${portalBootstrap.candidates.size > 20 ? " …" : ""}`,
  );
  lines.push(
    `   AMFI history checks on ${Math.max(0, samplesAll.length - portalBootstrap.portalTxnIndex - 1)} txn(s) after portal txn.`,
  );

  const picked = await resolvePortalNavProgressive(samplesAll);
  if (picked) {
    lines.push(`RESULT: Would pick AMFI ${picked}.`);
  } else {
    lines.push("RESULT: Progressive portal/NAV path unresolved.");
  }

  return lines;
}

/**
 * Detailed trace: qualifying CAS txns, strict/portal shortlists, and per–AMFI-code history NAV vs CAS price (4 dp).
 */
export async function explainAmfiResolutionVerbose(h: Holding, registry: AmfiRegistry): Promise<string[]> {
  const lines: string[] = [];
  const title = (h.scheme_name_simple || h.scheme_name || "(no name)").slice(0, 72);
  lines.push(`=== VERBOSE TRACE: ${title} ===`);

  if (shouldSkipAmfiResolution(h)) {
    lines.push("Skipped: dormant folio.");
    return lines;
  }

  const txs = h.transactions ?? [];
  const label = (h.scheme_name_simple || h.scheme_name || "").replace(/\s+/g, " ").trim();
  lines.push(`Fund label for strict CSV substring match: "${label}"`);

  const strictList = strictCandidatesForHolding(registry, h);
  lines.push("");
  lines.push(`--- Shortlist A: strict master CSV matches (${strictList.length}), CAS narrow ---`);
  for (const code of strictList.slice(0, 50)) {
    const nm = registry.schemeNameForAmfi(code);
    lines.push(`  ${code}  ${nm ? nm.slice(0, 90) : "?"}`);
  }
  if (strictList.length > 50) lines.push(`  … +${strictList.length - 50} more`);

  const allQual = collectQualifyingTxDetails(txs, 0, h);
  lines.push("");
  lines.push(
    `--- Qualifying NAV samples (${allQual.length}) — txn unit prices + optional CAS closing valuation NAV; excludes synthetic opening anchor & IDCW Reinvested ---`,
  );
  for (const q of allQual) {
    lines.push(
      `  ${q.date}  units=${q.units}  price_inr=${q.price}  round4=${round4(q.price)}  ${q.desc ? `«${q.desc}»` : ""}`,
    );
  }

  if (strictList.length === 1) {
    lines.push("");
    lines.push(`RESULT: unique strict match → AMFI ${strictList[0]}`);
    return lines;
  }

  if (strictList.length > 1) {
    const samplesDetail = collectQualifyingTxDetails(txs, MAX_TX_SAMPLES, h);
    lines.push("");
    lines.push(
      `--- AMFI history branch: scoring uses up to ${MAX_TX_SAMPLES} evenly spaced samples (${samplesDetail.length} row(s)) — ±3 calendar days, 4 dp ---`,
    );
    const minReq = Math.min(MIN_NAV_HITS, samplesDetail.length);
    lines.push(`Minimum NAV hits required: ${minReq}`);
    for (const q of samplesDetail) {
      lines.push(`  SAMPLE  ${q.date}  CAS round4=${round4(q.price)}`);
    }

    const maxCand = 14;
    const cands = strictList.slice(0, maxCand);
    lines.push("");
    lines.push(
      `--- AMFI history NAV vs CAS for each SAMPLE (showing ${cands.length}/${strictList.length} AMFI codes) ---`,
    );

    const explainNavRange = navRangeCoveringSamples(samplesDetail.map((q) => ({ t: q.t })));
    for (const amfi of cands) {
      const nm = registry.schemeNameForAmfi(amfi);
      const series = await fetchNavSeriesFromAmfiOnly(amfi, explainNavRange);
      lines.push(`>> AMFI ${amfi}${nm ? ` — ${nm.slice(0, 70)}` : ""}`);
      if (!series.length) {
        lines.push(`   (no NAV series from AMFI history API)`);
        continue;
      }
      for (let i = 0; i < samplesDetail.length; i++) {
        const q = samplesDetail[i];
        const ok = navExact4dpMatchInWindow(series, q.t, q.price);
        const explain = amfiNavMismatchExplanation(series, q.t, q.price);
        lines.push(`   ${q.date}: ${ok ? "MATCH" : "NO MATCH"} — ${explain}`);
      }
    }
    if (strictList.length > maxCand) {
      lines.push(`… (${strictList.length - maxCand} further strict candidates not expanded)`);
    }

    const samplesLite = samplesDetail.map((q) => ({ t: q.t, price: q.price }));
    const scored: { amfi: string; hits: number }[] = [];
    for (let i = 0; i < strictList.length; i += NAV_MATCH_CONCURRENCY) {
      const chunk = strictList.slice(i, i + NAV_MATCH_CONCURRENCY);
      const part = await Promise.all(chunk.map((amfi) => scoreAmfiByNavHits(amfi, samplesLite)));
      for (const row of part) if (row) scored.push(row);
    }
    scored.sort((a, b) => b.hits - a.hits);
    lines.push("");
    lines.push("--- Hit counts (all strict candidates) ---");
    for (const s of scored) {
      lines.push(`  AMFI ${s.amfi}: ${s.hits}/${samplesDetail.length}`);
    }

    const best = scored[0];
    const second = scored[1];
    lines.push("");
    if (!best || best.hits < minReq) {
      lines.push(`RESULT: no AMFI reaches ${minReq} hits. Portal path is NOT used when strict list is non-empty.`);
    } else if (second && second.hits === best.hits) {
      lines.push(`RESULT: tie — ${best.amfi} and ${second.amfi} both at ${best.hits} hits.`);
    } else {
      lines.push(`RESULT: would pick AMFI ${best.amfi}.`);
    }
    return lines;
  }

  const samplesAll = collectQualifyingTxDetails(txs, 0, h);
  lines.push("");
  lines.push(
    "--- Portal branch: up to three txns — portal file NAV on txn date + next 2 calendar days = CAS price at 4 dp ---",
  );
  const portalBootstrap = await bootstrapPortalCandidates(
    samplesAll.map((q) => ({ t: q.t, price: q.price })),
  );
  if (!portalBootstrap?.candidates.size) {
    lines.push("  (no portal-eligible codes in first three txns)");
  } else {
    lines.push(
      `  txn ${portalBootstrap.portalTxnIndex + 1}: ${portalBootstrap.candidates.size} eligible code(s): ${[...portalBootstrap.candidates].slice(0, 35).join(", ")}${portalBootstrap.candidates.size > 35 ? " …" : ""}`,
    );
    lines.push(
      `  AMFI history checks on ${Math.max(0, samplesAll.length - portalBootstrap.portalTxnIndex - 1)} txn(s) after portal txn`,
    );
  }

  const samplesLite = samplesAll.map((q) => ({ t: q.t, price: q.price }));
  const picked = await resolvePortalNavProgressive(samplesLite);
  lines.push("");
  lines.push("--- Progressive portal/NAV path (portal bootstrap + AMFI history on remaining txns) ---");
  if (picked) {
    const nm = registry.schemeNameForAmfi(picked);
    lines.push(`RESULT: would pick AMFI ${picked}${nm ? ` — ${nm.slice(0, 85)}` : ""}`);
  } else {
    lines.push("RESULT: progressive portal/NAV path unresolved.");
  }

  return lines;
}

/**
 * Mutates `parsed.holdings[*].mf_amfi_code` and `store` (in memory). Caller persists `store` if `dirty`.
 */
export async function resolveAmfiForParsedCasCore(
  parsed: ParsedCAS,
  registry: AmfiRegistry,
  store: AmfiSchemeMapStore,
  options?: ResolveAmfiOptions,
): Promise<{ dirty: boolean }> {
  const holdings = parsed.holdings ?? [];
  const trace = options?.trace;
  let dirty = false;
  trace?.appendNow(
    `Resolver pass begin (holdings=${holdings.length}, skipIsin=${options?.skipIsin === true}, network=${options?.networkDisambiguation !== false})`,
  );

  for (const h of holdings) {
    const label = (h.scheme_name_simple || h.scheme_name || "").replace(/\s+/g, " ").trim();
    const folio = (h.folio_no || "").trim() || "—";
    if (shouldSkipAmfiResolution(h)) {
      trace?.appendNow(`Holding folio ${folio} | ${label || "(no name)"} — skip dormant`);
      continue;
    }
    if (h.mf_amfi_code && String(h.mf_amfi_code).trim()) {
      trace?.appendNow(`Holding folio ${folio} | ${label || "(no name)"} — already AMFI ${String(h.mf_amfi_code).trim()}`);
      continue;
    }
    trace?.appendNow(`Holding folio ${folio} | ${label || "(no name)"} — resolve`);

    const isin = (h.isin || "").trim().toUpperCase();
    if (!options?.skipIsin && isin && /^INF[A-Z0-9]{9}$/.test(isin)) {
      const sk = storeIsinKey(isin);
      const cached = store[sk];
      if (cached?.code) {
        h.mf_amfi_code = cached.code;
        trace?.appendNow(`ISIN ${isin} → AMFI ${cached.code} (device cache)`);
        continue;
      }
      const fromCsv = registry.lookupByIsin(isin);
      if (fromCsv) {
        h.mf_amfi_code = fromCsv;
        store[sk] = { code: fromCsv, by: "isin", updatedAt: nowIso() };
        dirty = true;
        trace?.appendNow(`ISIN ${isin} → AMFI ${fromCsv} (bundled CSV)`);
        continue;
      }
      trace?.appendNow(`ISIN ${isin} not in bundled CSV — continue name/NAV`);
    } else if (isin) {
      trace?.appendNow(`ISIN ${isin || "(missing)"} not used — continue name/NAV`);
    }

    const nk = storeNameKey(h);
    const nameCached = store[nk];
    if (nameCached?.code) {
      h.mf_amfi_code = nameCached.code;
      trace?.appendNow(`Name cache → AMFI ${nameCached.code}`);
      continue;
    }

    if (!label) {
      trace?.appendNow("No scheme label — unresolved");
      continue;
    }

    const strictList = strictCandidatesForHolding(registry, h);
    trace?.appendNow(`Strict name shortlist: ${strictList.length} candidate(s)`);

    let chosen: string | null = null;
    let by: AmfiSchemeMapEntry["by"] = "name";

    if (strictList.length === 1) {
      chosen = strictList[0] ?? null;
      if (chosen) trace?.appendNow(`Single strict name match → AMFI ${chosen}`);
    } else if (strictList.length > 1) {
      if (options?.networkDisambiguation === false) {
        trace?.appendNow("Multiple strict matches — defer network disambiguation to later pass");
        continue;
      }
      chosen = await pickAmfiByNav(strictList, h.transactions ?? [], { holding: h }, trace);
      by = "nav";
    } else {
      if (options?.networkDisambiguation === false) {
        trace?.appendNow("No strict match — defer portal/NAV path to later pass");
        continue;
      }
      chosen = await resolveWhenNoStrictNameMatch(h.transactions ?? [], h, trace);
      by = "nav";
    }

    if (chosen) {
      h.mf_amfi_code = chosen;
      store[nk] = { code: chosen, by, updatedAt: nowIso() };
      dirty = true;
      trace?.appendNow(`Resolved → AMFI ${chosen} (by ${by})`);
    } else {
      trace?.appendNow("Unresolved after this pass");
    }
  }

  trace?.appendNow(`Resolver pass end (dirty=${dirty})`);
  return { dirty };
}
