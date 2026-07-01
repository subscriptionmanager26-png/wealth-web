/**
 * Fetches full Nifty TRI history for bundled benchmark seed (CI / manual refresh).
 * Run: npm run fetch-benchmark-seed
 */
import { writeFileSync, mkdirSync } from "node:fs";
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

async function fetchIndex(indexName) {
  const cinfo = JSON.stringify({
    name: indexName,
    startDate: formatNiftyApiDate(START),
    endDate: formatNiftyApiDate(END),
    indexName,
  });

  const res = await fetchNiftyTri(cinfo);
  if (!res.ok) throw new Error(`Nifty TRI fetch failed (${res.status}) for ${indexName}`);

  const payload = await res.json();
  if (!payload.d) return [];

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

async function main() {
  const indices = {};
  let fetched = 0;

  for (let i = 0; i < BENCHMARK_INDEXES.length; i += 1) {
    const { id, apiName } = BENCHMARK_INDEXES[i];
    console.log(`Fetching ${apiName}…`);
    const points = await fetchIndex(apiName);
    indices[id] = points;
    if (points.length) fetched += 1;
    console.log(
      `  ${points.length} daily points (${points[0] ? new Date(points[0][0]).toISOString().slice(0, 10) : "?"} → ${points.at(-1) ? new Date(points.at(-1)[0]).toISOString().slice(0, 10) : "?"})`,
    );
    if (i < BENCHMARK_INDEXES.length - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
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
    source: NIFTY_TRI,
    indexCount: BENCHMARK_INDEXES.length,
    fetched,
  };
  const metaJson = JSON.stringify(meta, null, 2);
  writeFileSync(OUT_META, metaJson);
  writeFileSync(PUBLIC_META, metaJson);

  console.log(`Wrote ${OUT_JSON} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`);
  console.log(`Wrote ${OUT_META}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
