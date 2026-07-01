/**
 * AMFI India official NAV history API (primary). Chunked date ranges + parallel chunk fetches.
 * https://www.amfiindia.com/api/nav-history?query_type=historical_period&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&sd_id={schemeCode}
 */

export type AmfiNavPoint = { t: number; nav: number };

const AMFI_NAV_HISTORY = "/api/amfi/nav-history";
/** AMFI allows up to ~5Y per request; use 4Y windows to minimize HTTP calls. */
export const CHUNK_YEARS = 4;
const CHUNK_PARALLEL = 4;
const FETCH_TIMEOUT_MS = 22000;
const AMFI_USER_AGENT = "Mozilla/5.0 (compatible; portfolio-nav/1.0; +https://amfiindia.com)";

type AmfiHistRecord = { date?: string; nav?: number };
type AmfiNavGroup = { nav_name?: string; historical_records?: AmfiHistRecord[] };
type AmfiNavHistoryBody = {
  data?: {
    nav_groups?: AmfiNavGroup[];
  };
};

function fmtYmd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function noonLocal(y: number, mon0: number, day: number): Date {
  return new Date(y, mon0, day, 12, 0, 0, 0);
}

/** Parse API `YYYY-MM-DD` to local noon (same convention as CAS / mfapi day NAV). */
function parseIsoYmdToNoon(s: string): Date | null {
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = noonLocal(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

function navGroupPreferenceRank(navName: string): number {
  const n = (navName || "").toLowerCase();
  let s = 0;
  if (/(idcw|dividend|payout|reinvest)/.test(n)) s -= 3;
  if (/\bgrowth\b/.test(n)) s += 4;
  if (/\bdirect\b/.test(n)) s += 2;
  if (/\bregular\b/.test(n)) s += 0;
  return s;
}

function mergeAmfiPointsSimple(chunks: AmfiNavPoint[][]): AmfiNavPoint[] {
  const byT = new Map<number, number>();
  for (const pts of chunks) {
    for (const p of pts) {
      if (!Number.isFinite(p.nav) || p.nav <= 0) continue;
      byT.set(p.t, p.nav);
    }
  }
  return [...byT.entries()]
    .map(([t, nav]) => ({ t, nav }))
    .sort((a, b) => a.t - b.t);
}

function parseChunkBody(json: AmfiNavHistoryBody): AmfiNavPoint[] {
  const groups = json.data?.nav_groups ?? [];
  const candidates: { t: number; nav: number; rank: number }[] = [];
  for (const g of groups) {
    const rank = navGroupPreferenceRank(String(g.nav_name ?? ""));
    for (const rec of g.historical_records ?? []) {
      const d = parseIsoYmdToNoon(String(rec.date ?? ""));
      const nav = typeof rec.nav === "number" ? rec.nav : Number(rec.nav);
      if (!d || !Number.isFinite(nav) || nav <= 0) continue;
      candidates.push({ t: d.getTime(), nav, rank });
    }
  }
  const byDay = new Map<number, { nav: number; rank: number }>();
  for (const c of candidates) {
    const prev = byDay.get(c.t);
    if (!prev || c.rank > prev.rank) {
      byDay.set(c.t, { nav: c.nav, rank: c.rank });
    }
  }
  return [...byDay.entries()]
    .map(([t, v]) => ({ t, nav: v.nav }))
    .sort((a, b) => a.t - b.t);
}

async function fetchOneAmfiChunk(schemeId: string, from: Date, to: Date): Promise<AmfiNavPoint[]> {
  if (from.getTime() > to.getTime()) return [];
  const fromS = fmtYmd(from);
  const toS = fmtYmd(to);
  const url = `${AMFI_NAV_HISTORY}?query_type=historical_period&from_date=${encodeURIComponent(fromS)}&to_date=${encodeURIComponent(toS)}&sd_id=${encodeURIComponent(schemeId)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": AMFI_USER_AGENT,
      },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as AmfiNavHistoryBody;
    return parseChunkBody(body);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function buildChunks(fromMs: number, toMs: number): { from: Date; to: Date }[] {
  const out: { from: Date; to: Date }[] = [];
  let cur = new Date(fromMs);
  cur.setHours(12, 0, 0, 0);
  const end = new Date(toMs);
  end.setHours(12, 0, 0, 0);
  if (cur.getTime() > end.getTime()) return out;

  while (cur.getTime() <= end.getTime()) {
    const fromD = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 12, 0, 0, 0);
    const chunkEnd = new Date(fromD);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + CHUNK_YEARS);
    chunkEnd.setDate(chunkEnd.getDate() - 1);
    const toD =
      chunkEnd.getTime() > end.getTime()
        ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0, 0)
        : new Date(chunkEnd.getFullYear(), chunkEnd.getMonth(), chunkEnd.getDate(), 12, 0, 0, 0);
    out.push({ from: fromD, to: toD });
    const next = new Date(toD);
    next.setDate(next.getDate() + 1);
    next.setHours(12, 0, 0, 0);
    cur = next;
  }
  return out;
}

/**
 * Historical NAV for `schemeId` (AMFI `sd_id`) between `fromMs` and `toMs` (inclusive calendar coverage).
 * Fetches in ~{@link CHUNK_YEARS}-year windows (single request when span ≤ 4Y), up to {@link CHUNK_PARALLEL} chunks in parallel.
 */
export async function fetchAmfiNavHistorySeries(schemeId: string, fromMs: number, toMs: number): Promise<AmfiNavPoint[]> {
  if (!/^\d+$/.test(String(schemeId).trim())) return [];
  const chunks = buildChunks(fromMs, toMs);
  if (!chunks.length) return [];
  const all: AmfiNavPoint[][] = [];
  for (let i = 0; i < chunks.length; i += CHUNK_PARALLEL) {
    const batch = chunks.slice(i, i + CHUNK_PARALLEL);
    const part = await Promise.all(batch.map((c) => fetchOneAmfiChunk(schemeId.trim(), c.from, c.to)));
    all.push(...part);
  }
  return mergeAmfiPointsSimple(all);
}
