/**
 * Daily Nifty TRI seed refresh (CI / manual).
 * Run: npm run fetch-benchmark-seed
 *
 * Strategy (gentle on niftyindices.com):
 * 1. Fetch only the last TRI_LOOKBACK_DAYS of TRI per index
 * 2. Space requests by REQUEST_GAP_MS between indices
 * 3. Merge recent points into the existing long history seed
 * 4. If TRI fails, fall back to NSE daily price archives
 * 5. If nothing new, keep previous seed and exit 0
 *
 * Live endpoint: /BackPage/getTotalReturnIndexString (JSON array).
 * Legacy /Backpage.aspx/... returns homepage HTML to non-browser clients.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchNiftyTri } from "../server/upstream.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUT_JSON = path.resolve(root, "assets/benchmark-seed.json");
const OUT_META = path.resolve(root, "assets/benchmark-seed-meta.json");
const PUBLIC_JSON = path.resolve(root, "public/benchmark-seed.json");
const PUBLIC_META = path.resolve(root, "public/benchmark-seed-meta.json");

const NIFTY_TRI = "https://www.niftyindices.com/BackPage/getTotalReturnIndexString";
/** Production proxy — different egress IP than GitHub Actions (helps when Nifty returns 403). */
const DEFAULT_PROXY = "https://wealth-web-zeta.vercel.app/api/nifty/tri";
const PROXY_URL = (process.env.NIFTY_TRI_PROXY_URL ?? DEFAULT_PROXY).trim();

const BENCHMARK_INDEXES = [
  { id: "nifty50", apiName: "NIFTY 50", nseName: "Nifty 50" },
  { id: "nifty100", apiName: "NIFTY 100", nseName: "Nifty 100" },
  { id: "nifty200", apiName: "NIFTY 200", nseName: "Nifty 200" },
  { id: "nifty500", apiName: "NIFTY 500", nseName: "Nifty 500" },
  { id: "nifty_india_fpi_150", apiName: "NIFTY INDIA FPI 150", nseName: "Nifty India FPI 150" },
  { id: "nifty_largemidcap_250", apiName: "NIFTY LARGEMIDCAP 250", nseName: "NIFTY LargeMidcap 250" },
  { id: "nifty_microcap_250", apiName: "NIFTY MICROCAP 250", nseName: "Nifty Microcap 250" },
  { id: "nifty_midcap_100", apiName: "NIFTY MIDCAP 100", nseName: "NIFTY Midcap 100" },
  { id: "nifty_midcap_150", apiName: "NIFTY MIDCAP 150", nseName: "Nifty Midcap 150" },
  { id: "nifty_midcap_50", apiName: "NIFTY MIDCAP 50", nseName: "Nifty Midcap 50" },
  { id: "nifty_midcap_select", apiName: "NIFTY MIDCAP SELECT", nseName: "Nifty Midcap Select" },
  { id: "nifty_midsmallcap_400", apiName: "NIFTY MIDSMALLCAP 400", nseName: "Nifty MidSmallcap 400" },
  { id: "nifty_midsmallcap_400_5050", apiName: "NIFTY MIDSMALLCAP400 50:50", nseName: "Nifty MidSmallcap400 50:50" },
  { id: "nifty_next_50", apiName: "NIFTY NEXT 50", nseName: "Nifty Next 50" },
  { id: "nifty_smallcap_100", apiName: "NIFTY SMALLCAP 100", nseName: "NIFTY Smallcap 100" },
  { id: "nifty_smallcap_250", apiName: "NIFTY SMALLCAP 250", nseName: "Nifty Smallcap 250" },
  { id: "nifty_smallcap_50", apiName: "NIFTY SMALLCAP 50", nseName: "Nifty Smallcap 50" },
  { id: "nifty_smallcap_500", apiName: "NIFTY SMALLCAP 500", nseName: "Nifty Smallcap 500" },
  { id: "nifty_total_market", apiName: "NIFTY TOTAL MARKET", nseName: "Nifty Total Market" },
  {
    id: "nifty500_largemidsmall_equalcap",
    apiName: "NIFTY500 LARGEMIDSMALL EQUAL-CAP WEIGHTED",
    nseName: "Nifty500 LargeMidSmall Equal-Cap Weighted",
  },
  { id: "nifty500_multicap_502525", apiName: "NIFTY500 MULTICAP 50:25:25", nseName: "Nifty500 Multicap 50:25:25" },
];

const NSE_ARCHIVE = "https://archives.nseindia.com/content/indices/ind_close_all_";
const NSE_LOOKBACK_DAYS = 21;
const UA = "Mozilla/5.0 (compatible; wealth-web-benchmark-seed/1.0)";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Only pull recent TRI — full history already lives in assets/benchmark-seed.json. */
const TRI_LOOKBACK_DAYS = 3;
/** Pause between index requests so we do not look like a burst scraper. */
const REQUEST_GAP_MS = 2_500;
const END = new Date();
const START = new Date(END.getFullYear(), END.getMonth(), END.getDate() - TRI_LOOKBACK_DAYS, 12, 0, 0, 0);
/** Minimum points for an existing series to count as usable history. */
const MIN_HISTORY_POINTS = 100;
/** Minimum points required from a recent TRI pull. */
const MIN_RECENT_POINTS = 1;

function formatNiftyApiDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function parseNiftyIndexDate(s) {
  const m = String(s ?? "")
    .trim()
    .match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mon = MONTHS.indexOf(m[2]);
  const yyyy = Number(m[3]);
  if (!Number.isFinite(dd) || mon < 0 || !Number.isFinite(yyyy)) return null;
  return new Date(yyyy, mon, dd, 12, 0, 0, 0);
}

function parseTriValue(s) {
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function loadExistingSeed() {
  for (const p of [OUT_JSON, PUBLIC_JSON]) {
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8"));
      if (parsed?.indices && typeof parsed.indices === "object") return parsed;
    } catch {
      /* ignore */
    }
  }
  return { version: 1, generatedAt: null, indices: {} };
}

function parseTriPayload(payload) {
  // New BackPage endpoint returns a JSON array; legacy .aspx returned { d: "<json array>" }.
  let rows = [];
  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && typeof payload.d === "string") {
    try {
      rows = JSON.parse(payload.d);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(rows)) return [];

  const byT = new Map();
  for (const row of rows) {
    const date = parseNiftyIndexDate(row.Date ?? "");
    const tri = parseTriValue(row.TotalReturnsIndex);
    if (!date || tri == null) continue;
    byT.set(date.getTime(), tri);
  }

  return [...byT.entries()]
    .map(([t, tri]) => [t, Math.round(tri * 100) / 100])
    .sort((a, b) => a[0] - b[0]);
}

async function fetchViaProxy(postBody) {
  if (!PROXY_URL) return null;
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: postBody,
    signal: AbortSignal.timeout(120000),
  });
  return res;
}

async function fetchIndex(indexName) {
  const cinfo = JSON.stringify({
    name: indexName,
    startDate: formatNiftyApiDate(START),
    endDate: formatNiftyApiDate(END),
    indexName,
  });
  const postBody = JSON.stringify({ cinfo });

  let lastStatus = null;
  let lastError = null;

  async function readTriResponse(res, label) {
    const text = await res.text();
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    if (text.trim().startsWith("<") || text.includes("<!DOCTYPE")) {
      throw new Error(`${label} HTML block (wrong endpoint or WAF)`);
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error(`${label} invalid JSON: ${e instanceof Error ? e.message : e}`);
    }
    const points = parseTriPayload(payload);
    if (points.length < MIN_RECENT_POINTS) throw new Error(`${label} too few points (${points.length})`);
    return points;
  }

  // 1) Direct Nifty (few retries — daily job should stay gentle)
  try {
    const res = await fetchNiftyTri(postBody, { retries: 2, timeoutMs: 30000 });
    lastStatus = res.status;
    const points = await readTriResponse(res, "direct");
    return { points, source: "direct" };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }

  // 2) Production proxy fallback (different egress IP than GitHub Actions)
  if (PROXY_URL) {
    console.warn(`  direct failed (${lastError}); trying proxy ${PROXY_URL}`);
    try {
      const res = await fetchViaProxy(postBody);
      lastStatus = res?.status ?? lastStatus;
      const points = await readTriResponse(res, "proxy");
      return { points, source: "proxy" };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(`Nifty TRI fetch failed for ${indexName}: ${lastError}${lastStatus ? ` (status ${lastStatus})` : ""}`);
}

/** Merge recent TRI points into long history (recent wins on the same calendar day). */
function mergePoints(existing, recent) {
  const byDay = new Map();
  for (const pt of existing ?? []) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    byDay.set(dayKeyFromMs(pt[0]), [pt[0], pt[1]]);
  }
  for (const pt of recent ?? []) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    byDay.set(dayKeyFromMs(pt[0]), [pt[0], pt[1]]);
  }
  return [...byDay.values()].sort((a, b) => a[0] - b[0]);
}

function keepPrevious(indices, existing, id, failures, apiName, msg) {
  failures.push({ id, apiName, error: msg });
  const prev = existing.indices?.[id];
  if (Array.isArray(prev) && prev.length >= MIN_HISTORY_POINTS) {
    indices[id] = prev;
    console.warn(`  FAILED — kept previous ${prev.length} points. ${msg}`);
    return 1;
  }
  indices[id] = Array.isArray(prev) ? prev : [];
  console.warn(`  FAILED — no usable previous data. ${msg}`);
  return 0;
}

function formatNseArchiveDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

function parseNseCsvDate(s) {
  const m = String(s ?? "")
    .trim()
    .match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0, 0);
}

function dayKeyFromMs(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayKeyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function noonMsFromDayKey(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

/** Fetch one NSE daily index-close CSV. Returns Map<lowerName, {dayKey, close}>. */
async function fetchNseArchiveDay(date) {
  const url = `${NSE_ARCHIVE}${formatNseArchiveDate(date)}.csv`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.includes("Index Name") || text.trim().startsWith("<")) return null;

  const out = new Map();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",");
    if (cols.length < 6) continue;
    const name = (cols[0] ?? "").trim();
    const dateObj = parseNseCsvDate(cols[1]);
    const close = Number(String(cols[5] ?? "").replace(/,/g, ""));
    if (!name || !dateObj || !Number.isFinite(close) || close <= 0) continue;
    out.set(name.toLowerCase(), { dayKey: dayKeyFromDate(dateObj), close });
  }
  return out;
}

/**
 * When TRI API is blocked, extend existing TRI-denominated series using NSE price-index
 * daily returns: tri[t] = tri[t-1] * (price[t] / price[t-1]).
 * Short gaps are fine; on ex-dividend days TRI would be slightly higher than this proxy.
 */
async function extendSeedFromNseArchives(existingIndices) {
  console.log(`TRI blocked — extending seed via NSE archives (last ${NSE_LOOKBACK_DAYS} days)…`);
  const byDay = [];
  const today = new Date();
  for (let i = 0; i < NSE_LOOKBACK_DAYS; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12, 0, 0, 0);
    try {
      const map = await fetchNseArchiveDay(d);
      if (map?.size) {
        byDay.push({ dayKey: dayKeyFromDate(d), map });
        console.log(`  NSE archive ${formatNseArchiveDate(d)}: ${map.size} indices`);
      }
    } catch (e) {
      console.warn(`  NSE archive ${formatNseArchiveDate(d)} failed:`, e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  byDay.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  if (byDay.length < 2) {
    return { indices: existingIndices, extended: 0, days: byDay.length };
  }

  const priceById = new Map();
  for (const { id, nseName } of BENCHMARK_INDEXES) {
    const series = new Map();
    const key = nseName.toLowerCase();
    for (const day of byDay) {
      const row = day.map.get(key);
      if (row) series.set(row.dayKey, row.close);
    }
    priceById.set(id, series);
  }

  const next = { ...existingIndices };
  let extended = 0;

  for (const { id } of BENCHMARK_INDEXES) {
    const prev = Array.isArray(existingIndices[id]) ? [...existingIndices[id]] : [];
    if (prev.length < MIN_HISTORY_POINTS) continue;
    prev.sort((a, b) => a[0] - b[0]);
    const prices = priceById.get(id);
    if (!prices?.size) continue;

    let lastT = prev[prev.length - 1][0];
    let lastTri = prev[prev.length - 1][1];
    let lastDay = dayKeyFromMs(lastT);
    let lastPrice = prices.get(lastDay);
    if (lastPrice == null) {
      const sortedDays = [...prices.keys()].sort();
      for (let i = sortedDays.length - 1; i >= 0; i -= 1) {
        if (sortedDays[i] <= lastDay) {
          lastPrice = prices.get(sortedDays[i]);
          lastDay = sortedDays[i];
          break;
        }
      }
    }
    if (lastPrice == null || lastPrice <= 0) continue;

    let added = 0;
    for (const dayKey of [...prices.keys()].sort()) {
      if (dayKey <= lastDay) continue;
      const price = prices.get(dayKey);
      if (price == null || price <= 0 || lastPrice <= 0) continue;
      const newTri = Math.round(lastTri * (price / lastPrice) * 100) / 100;
      const t = noonMsFromDayKey(dayKey);
      prev.push([t, newTri]);
      lastT = t;
      lastTri = newTri;
      lastPrice = price;
      lastDay = dayKey;
      added += 1;
    }
    if (added > 0) {
      next[id] = prev;
      extended += 1;
      console.log(`  ${id}: +${added} day(s) via NSE price returns → ${lastDay} @ ${lastTri}`);
    }
  }

  return { indices: next, extended, days: byDay.length };
}

async function main() {
  const existing = loadExistingSeed();
  const indices = { ...existing.indices };
  let refreshed = 0;
  let reused = 0;
  const failures = [];
  /** Stop after a few hard failures so we fall through to NSE instead of hammering. */
  const CIRCUIT_BREAK_AFTER = 3;
  let consecutiveFailures = 0;
  let circuitOpen = false;

  console.log(
    `TRI window: ${formatNiftyApiDate(START)} → ${formatNiftyApiDate(END)} (${TRI_LOOKBACK_DAYS} days), gap ${REQUEST_GAP_MS}ms`,
  );

  for (let i = 0; i < BENCHMARK_INDEXES.length; i += 1) {
    const { id, apiName } = BENCHMARK_INDEXES[i];

    if (circuitOpen) {
      reused += keepPrevious(indices, existing, id, failures, apiName, "skipped (circuit open — Nifty unreachable)");
      continue;
    }

    console.log(`Fetching ${apiName}…`);
    try {
      const { points, source } = await fetchIndex(apiName);
      const prev = Array.isArray(existing.indices?.[id]) ? existing.indices[id] : [];
      const merged = mergePoints(prev, points);
      indices[id] = merged;
      refreshed += 1;
      consecutiveFailures = 0;
      const first = points[0] ? new Date(points[0][0]).toISOString().slice(0, 10) : "?";
      const last = points.at(-1) ? new Date(points.at(-1)[0]).toISOString().slice(0, 10) : "?";
      console.log(
        `  +${points.length} recent via ${source} (${first} → ${last}); series now ${merged.length} points`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      reused += keepPrevious(indices, existing, id, failures, apiName, msg);
      consecutiveFailures += 1;
      if (consecutiveFailures >= CIRCUIT_BREAK_AFTER) {
        circuitOpen = true;
        console.warn(
          `Circuit open after ${consecutiveFailures} consecutive failures — keeping previous seed for remaining indices.`,
        );
      }
    }
    if (!circuitOpen && i < BENCHMARK_INDEXES.length - 1) {
      await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
    }
  }

  const withData = Object.values(indices).filter((p) => Array.isArray(p) && p.length >= MIN_HISTORY_POINTS).length;
  if (withData === 0) {
    throw new Error(
      `No benchmark indices have usable data (refreshed=${refreshed}, failures=${failures.length}). Nifty may be blocking this network.`,
    );
  }

  // niftyindices.com is behind Akamai Bot Manager — automated clients often get homepage HTML.
  // Fall back to NSE daily archives and extend TRI series with price returns.
  if (refreshed === 0) {
    console.warn(
      `All TRI fetches failed (first: ${failures[0]?.error}). Trying NSE archive fallback…`,
    );
    try {
      const nse = await extendSeedFromNseArchives(existing.indices ?? {});
      if (nse.extended > 0) {
        const generatedAt = new Date().toISOString();
        const payload = { version: 1, generatedAt, indices: nse.indices };
        const json = JSON.stringify(payload);
        mkdirSync(path.dirname(OUT_JSON), { recursive: true });
        mkdirSync(path.dirname(PUBLIC_JSON), { recursive: true });
        writeFileSync(OUT_JSON, json);
        writeFileSync(PUBLIC_JSON, json);
        const meta = {
          generatedAt,
          fetchedAt: generatedAt,
          lastAttemptAt: generatedAt,
          lastAttemptOk: true,
          source: "nse-archives-price-return-extension",
          note: "TRI API blocked; extended prior TRI levels using NSE price-index daily returns",
          indexCount: BENCHMARK_INDEXES.length,
          fetched: Object.values(nse.indices).filter((p) => Array.isArray(p) && p.length >= MIN_HISTORY_POINTS).length,
          refreshed: nse.extended,
          reused: withData - nse.extended,
          nseArchiveDays: nse.days,
          failed: failures.map((f) => f.id),
        };
        const metaJson = JSON.stringify(meta, null, 2);
        writeFileSync(OUT_META, metaJson);
        writeFileSync(PUBLIC_META, metaJson);
        console.log(`Wrote ${OUT_JSON} via NSE fallback (${nse.extended} indices extended)`);
        console.log(`Wrote ${OUT_META}`);
        return;
      }
      console.warn("NSE fallback added no new days — keeping existing seed.");
    } catch (e) {
      console.warn("NSE fallback failed:", e instanceof Error ? e.message : e);
    }

    const attemptMeta = {
      generatedAt: existing.generatedAt ?? new Date().toISOString(),
      fetchedAt: existing.generatedAt ?? new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      lastAttemptOk: false,
      lastAttemptError: failures[0]?.error ?? "unknown",
      source: NIFTY_TRI,
      indexCount: BENCHMARK_INDEXES.length,
      fetched: withData,
      refreshed: 0,
      reused: withData,
      failed: failures.map((f) => f.id),
    };
    const metaJson = JSON.stringify(attemptMeta, null, 2);
    mkdirSync(path.dirname(OUT_META), { recursive: true });
    writeFileSync(OUT_META, metaJson);
    writeFileSync(PUBLIC_META, metaJson);
    console.log(`Wrote attempt meta only (seed unchanged): ${OUT_META}`);
    return;
  }

  const generatedAt = new Date().toISOString();
  const payload = { version: 1, generatedAt, indices };
  const json = JSON.stringify(payload);

  mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  mkdirSync(path.dirname(PUBLIC_JSON), { recursive: true });
  writeFileSync(OUT_JSON, json);
  writeFileSync(PUBLIC_JSON, json);

  const meta = {
    generatedAt,
    fetchedAt: generatedAt,
    lastAttemptAt: generatedAt,
    lastAttemptOk: true,
    source: NIFTY_TRI,
    mode: "recent-merge",
    triLookbackDays: TRI_LOOKBACK_DAYS,
    requestGapMs: REQUEST_GAP_MS,
    indexCount: BENCHMARK_INDEXES.length,
    fetched: withData,
    refreshed,
    reused,
    failed: failures.map((f) => f.id),
  };
  const metaJson = JSON.stringify(meta, null, 2);
  writeFileSync(OUT_META, metaJson);
  writeFileSync(PUBLIC_META, metaJson);

  console.log(`Wrote ${OUT_JSON} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`);
  console.log(`Wrote ${OUT_META}`);
  console.log(`Summary: refreshed=${refreshed}, reused=${reused}, withData=${withData}, failed=${failures.length}`);
  if (failures.length) {
    console.warn("Failed indices:", failures.map((f) => f.id).join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
