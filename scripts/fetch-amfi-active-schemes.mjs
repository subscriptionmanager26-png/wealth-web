/**
 * Fetch AMFI NAVAll.txt and build a CSV of currently active schemes.
 *
 *   npm run fetch-amfi-active-schemes
 *
 * Output: public/amfi_active_schemes.csv (+ mobile-vendor/assets when present)
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAV_ALL_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const CATEGORY_RE =
  /^(Open Ended Schemes|Closed Ended Schemes|Interval Scheme|Solution Oriented Scheme|Other Schemes)\((.+)\)\s*$/i;
const SCHEME_ROW_RE = /^(\d+);/;
const AMC_RE = /mutual fund\s*$/i;

function parseCategoryLine(line) {
  const m = line.match(CATEGORY_RE);
  if (!m) return null;
  const inner = m[2].trim();
  const dash = inner.indexOf(" - ");
  if (dash >= 0) {
    return {
      category: inner.slice(0, dash).trim(),
      subCategory: inner.slice(dash + 3).trim(),
    };
  }
  return { category: inner, subCategory: "" };
}

function pickIsin(colGrowthOrPayout, colReinvest) {
  for (const raw of [colGrowthOrPayout, colReinvest]) {
    const v = (raw ?? "").trim();
    if (v && v !== "-") return v.toUpperCase();
  }
  return "";
}

function derivePlan(name) {
  return /\bdirect\b/i.test(name) ? "Direct" : "Regular";
}

function derivePayout(name) {
  return /\bgrowth\b/i.test(name) ? "Growth" : "IDCW";
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseNavAll(text) {
  const rows = [];
  let category = "";
  let subCategory = "";
  let amc = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^scheme code;/i.test(line)) continue;

    const cat = parseCategoryLine(line);
    if (cat) {
      category = cat.category;
      subCategory = cat.subCategory;
      continue;
    }

    if (SCHEME_ROW_RE.test(line)) {
      const parts = line.split(";");
      if (parts.length < 4) continue;
      const amfiCode = parts[0].trim();
      const isin = pickIsin(parts[1], parts[2]);
      const name = parts[3].trim();
      if (!amfiCode || !name) continue;
      rows.push({
        amfiCode,
        isin,
        name,
        category,
        subCategory,
        amc,
        plan: derivePlan(name),
        payout: derivePayout(name),
      });
      continue;
    }

    if (AMC_RE.test(line) && !line.includes(";")) {
      amc = line.trim();
    }
  }

  return rows;
}

async function main() {
  const res = await fetch(NAV_ALL_URL, {
    headers: { "User-Agent": "wealth-web/0.1 (+amfi-active-schemes)" },
  });
  if (!res.ok) throw new Error(`NAVAll fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const rows = parseNavAll(text);

  const header =
    "amfi_code,isin,name,category,sub_category,amc,plan,payout";
  const body = rows
    .map((r) =>
      [
        r.amfiCode,
        r.isin,
        r.name,
        r.category,
        r.subCategory,
        r.amc,
        r.plan,
        r.payout,
      ]
        .map(csvEscape)
        .join(","),
    )
    .join("\n");
  const csv = `${header}\n${body}\n`;

  const targets = [
    path.join(root, "assets", "amfi_active_schemes.csv"),
    path.join(root, "public", "amfi_active_schemes.csv"),
    path.join(root, "mobile-vendor", "assets", "amfi_active_schemes.csv"),
  ];
  for (const dst of targets) {
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, csv, "utf8");
    console.log(`[fetch-amfi-active-schemes] wrote ${rows.length} rows → ${dst}`);
  }

  const withIsin = rows.filter((r) => r.isin).length;
  const direct = rows.filter((r) => r.plan === "Direct").length;
  const growth = rows.filter((r) => r.payout === "Growth").length;
  console.log(
    `[fetch-amfi-active-schemes] summary: ${rows.length} schemes, ${withIsin} with ISIN, ${direct} Direct, ${growth} Growth`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
