/**
 * Fetch Upvaly scheme data for equity Direct + Growth funds and write a static snapshot.
 *
 *   npm run fetch-screener-snapshot
 *
 * API: https://finapi.upvaly.com/api/mf/scheme-code/{amfiCode}
 * Rate limit: 120 req/min — 100ms delay between calls.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UPVALY_SCHEME_URL = "https://finapi.upvaly.com/api/mf/scheme-code";
const DELAY_MS = 550; // 120 req/min → min 500ms between calls; 550ms adds buffer
const MAX_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 65_000;
const FETCH_TIMEOUT_MS = 30000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function loadEquityDirectGrowthCodes() {
  const csvPath = path.join(root, "public", "amfi_active_schemes.csv");
  const text = readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const codes = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 8) continue;
    const [amfiCode, , , category, , , plan, payout] = cols;
    if (!amfiCode?.trim() || !/^\d+$/.test(amfiCode.trim())) continue;
    if (category !== "Equity Scheme" || plan !== "Direct" || payout !== "Growth") continue;
    codes.push(amfiCode.trim());
  }
  return [...new Set(codes)].sort((a, b) => a.localeCompare(b));
}

async function fetchScheme(amfiCode, attempt = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${UPVALY_SCHEME_URL}/${encodeURIComponent(amfiCode)}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      console.warn(`[fetch-screener-snapshot] rate limited on ${amfiCode}, waiting ${RATE_LIMIT_WAIT_MS / 1000}s…`);
      await sleep(RATE_LIMIT_WAIT_MS);
      return fetchScheme(amfiCode, attempt + 1);
    }
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    if (body?.status !== "success" || !body?.data?.schemeCode) {
      return { ok: false, status: res.status, message: body?.message };
    }
    return { ok: true, data: body.data };
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(2000 * (attempt + 1));
      return fetchScheme(amfiCode, attempt + 1);
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const codes = loadEquityDirectGrowthCodes();
  const retryOnly = process.argv.includes("--retry-failed");

  let existing = { funds: {}, failed: [] };
  const assetsPath = path.join(root, "assets", "screener-snapshot.json");
  if (retryOnly && existsSync(assetsPath)) {
    existing = JSON.parse(readFileSync(assetsPath, "utf8"));
    console.log(`[fetch-screener-snapshot] retry mode: ${existing.failed?.length ?? 0} failed codes`);
  }

  const toFetch = retryOnly
    ? [...new Set([...(existing.failed ?? []), ...codes.filter((c) => !existing.funds?.[c])])]
    : codes;

  console.log(`[fetch-screener-snapshot] fetching ${toFetch.length} equity Direct Growth funds`);

  const funds = { ...(existing.funds ?? {}) };
  const failed = [];

  for (let i = 0; i < toFetch.length; i += 1) {
    const code = toFetch[i];
    if (i > 0) await sleep(DELAY_MS);

    const result = await fetchScheme(code);
    if (result.ok) {
      funds[code] = result.data;
    } else {
      failed.push({ code, ...result });
      console.warn(`[fetch-screener-snapshot] failed ${code}:`, result.message ?? result.status);
    }

    if ((i + 1) % 25 === 0 || i === toFetch.length - 1) {
      console.log(`[fetch-screener-snapshot] progress ${i + 1}/${toFetch.length} (ok ${Object.keys(funds).length})`);
    }
  }

  const allFailed = codes.filter((c) => !funds[c]);
  const snapshot = {
    generatedAt: new Date().toISOString().slice(0, 10),
    fetchedAt: new Date().toISOString(),
    source: UPVALY_SCHEME_URL,
    fundCount: codes.length,
    fetched: Object.keys(funds).length,
    failed: allFailed,
    funds,
  };

  const json = JSON.stringify(snapshot);
  const meta = {
    generatedAt: snapshot.generatedAt,
    fetchedAt: snapshot.fetchedAt,
    source: snapshot.source,
    fundCount: snapshot.fundCount,
    fetched: snapshot.fetched,
    failedCount: snapshot.failed.length,
  };
  const metaJson = JSON.stringify(meta, null, 2);
  const targets = [
    path.join(root, "assets", "screener-snapshot.json"),
    path.join(root, "public", "screener-snapshot.json"),
  ];
  const metaTargets = [
    path.join(root, "assets", "screener-snapshot-meta.json"),
    path.join(root, "public", "screener-snapshot-meta.json"),
  ];

  for (const dst of targets) {
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, json, "utf8");
    console.log(`[fetch-screener-snapshot] wrote ${(json.length / 1024 / 1024).toFixed(2)} MB → ${dst}`);
  }

  for (const dst of metaTargets) {
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, metaJson, "utf8");
    console.log(`[fetch-screener-snapshot] wrote meta → ${dst}`);
  }

  console.log(
    `[fetch-screener-snapshot] done: ${snapshot.fetched}/${snapshot.fundCount} ok, ${snapshot.failed.length} failed`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
