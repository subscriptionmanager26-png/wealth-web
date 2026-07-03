/**
 * Fetches full Nifty TRI history for bundled benchmark seed (CI / manual refresh).
 * Run: npm run fetch-benchmark-seed
 *
 * Resilience:
 * - Browser-like headers + session warm-up + retries (see server/upstream.mjs)
 * - Optional proxy fallback via NIFTY_TRI_PROXY_URL (e.g. production /api/nifty/tri)
 * - Per-index failures do not abort the whole run
 * - Keeps previous seed points for indices that fail to refresh
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

const NIFTY_TRI = "https://www.niftyindices.com/Backpage.aspx/getTotalReturnIndexString";
/** Production proxy — different egress IP than GitHub Actions (helps when Nifty returns 403). */
const DEFAULT_PROXY = "https://wealth-web-zeta.vercel.app/api/nifty/tri";
const PROXY_URL = (process.env.NIFTY_TRI_PROXY_URL ?? DEFAULT_PROXY).trim();

const BENCHMARK_INDEXES = [
  { id: "nifty50", apiName: "NIFTY 50" },
  { id: "nifty100", apiName: "NIFTY 100" },
  { id: "nifty200", apiName: "NIFTY 200" },
  { id: "nifty500", apiName: "NIFTY 500" },
  { id: "nifty_india_fpi_150", apiName: "NIFTY INDIA FPI 150" },
  { id: "nifty_largemidcap_250", apiName: "NIFTY LARGEMIDCAP 250" },
  { id: "nifty_microcap_250", apiName: "NIFTY MICROCAP 250" },
  { id: "nifty_midcap_100", apiName: "NIFTY MIDCAP 100" },
  { id: "nifty_midcap_150", apiName: "NIFTY MIDCAP 150" },
  { id: "nifty_midcap_50", apiName: "NIFTY MIDCAP 50" },
  { id: "nifty_midcap_select", apiName: "NIFTY MIDCAP SELECT" },
  { id: "nifty_midsmallcap_400", apiName: "NIFTY MIDSMALLCAP 400" },
  { id: "nifty_midsmallcap_400_5050", apiName: "NIFTY MIDSMALLCAP400 50:50" },
  { id: "nifty_next_50", apiName: "NIFTY NEXT 50" },
  { id: "nifty_smallcap_100", apiName: "NIFTY SMALLCAP 100" },
  { id: "nifty_smallcap_250", apiName: "NIFTY SMALLCAP 250" },
  { id: "nifty_smallcap_50", apiName: "NIFTY SMALLCAP 50" },
  { id: "nifty_smallcap_500", apiName: "NIFTY SMALLCAP 500" },
  { id: "nifty_total_market", apiName: "NIFTY TOTAL MARKET" },
  { id: "nifty500_largemidsmall_equalcap", apiName: "NIFTY500 LARGEMIDSMALL EQUAL-CAP WEIGHTED" },
  { id: "nifty500_multicap_502525", apiName: "NIFTY500 MULTICAP 50:25:25" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const START = new Date(2000, 0, 1, 12, 0, 0, 0);
const END = new Date();
const MIN_POINTS = 100;

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
  if (!payload?.d) return [];
  let rows;
  try {
    rows = JSON.parse(payload.d);
  } catch {
    return [];
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

  // 1) Direct Nifty (with retries inside fetchNiftyTri)
  try {
    const res = await fetchNiftyTri(postBody, { retries: 3, timeoutMs: 45000 });
    lastStatus = res.status;
    if (res.ok) {
      const points = parseTriPayload(await res.json());
      if (points.length >= MIN_POINTS) return { points, source: "direct" };
      lastError = `too few points (${points.length})`;
    } else {
      lastError = `HTTP ${res.status}`;
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }

  // 2) Production proxy fallback (different egress IP than GitHub Actions)
  if (PROXY_URL) {
    console.warn(`  direct failed (${lastError}); trying proxy ${PROXY_URL}`);
    try {
      const res = await fetchViaProxy(postBody);
      lastStatus = res?.status ?? lastStatus;
      if (res?.ok) {
        const points = parseTriPayload(await res.json());
        if (points.length >= MIN_POINTS) return { points, source: "proxy" };
        lastError = `proxy too few points (${points.length})`;
      } else {
        lastError = `proxy HTTP ${res?.status}`;
      }
    } catch (e) {
      lastError = `proxy: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  throw new Error(`Nifty TRI fetch failed for ${indexName}: ${lastError}${lastStatus ? ` (status ${lastStatus})` : ""}`);
}

function keepPrevious(indices, existing, id, failures, apiName, msg) {
  failures.push({ id, apiName, error: msg });
  const prev = existing.indices?.[id];
  if (Array.isArray(prev) && prev.length >= MIN_POINTS) {
    indices[id] = prev;
    console.warn(`  FAILED — kept previous ${prev.length} points. ${msg}`);
    return 1;
  }
  indices[id] = Array.isArray(prev) ? prev : [];
  console.warn(`  FAILED — no usable previous data. ${msg}`);
  return 0;
}

async function main() {
  const existing = loadExistingSeed();
  const indices = { ...existing.indices };
  let refreshed = 0;
  let reused = 0;
  const failures = [];
  /** Stop hammering Nifty after consecutive hard failures (403 / timeout / proxy down). */
  const CIRCUIT_BREAK_AFTER = 2;
  let consecutiveFailures = 0;
  let circuitOpen = false;

  for (let i = 0; i < BENCHMARK_INDEXES.length; i += 1) {
    const { id, apiName } = BENCHMARK_INDEXES[i];

    if (circuitOpen) {
      reused += keepPrevious(indices, existing, id, failures, apiName, "skipped (circuit open — Nifty unreachable)");
      continue;
    }

    console.log(`Fetching ${apiName}…`);
    try {
      const { points, source } = await fetchIndex(apiName);
      indices[id] = points;
      refreshed += 1;
      consecutiveFailures = 0;
      console.log(
        `  ${points.length} daily points via ${source} (${points[0] ? new Date(points[0][0]).toISOString().slice(0, 10) : "?"} → ${points.at(-1) ? new Date(points.at(-1)[0]).toISOString().slice(0, 10) : "?"})`,
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
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  const withData = Object.values(indices).filter((p) => Array.isArray(p) && p.length >= MIN_POINTS).length;
  if (withData === 0) {
    throw new Error(
      `No benchmark indices have usable data (refreshed=${refreshed}, failures=${failures.length}). Nifty may be blocking this network.`,
    );
  }

  // Nifty often blocks datacenter IPs (403 / timeout). If every fetch failed but we still have a
  // usable prior seed, keep it and exit successfully so CI stays green.
  if (refreshed === 0) {
    console.warn(
      `All ${failures.length} index fetches failed; keeping existing seed (${withData} indices). First error: ${failures[0]?.error}`,
    );
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
