export type ActiveSchemeRow = {
  amfiCode: string;
  isin: string;
  name: string;
  category: string;
  subCategory: string;
  amc: string;
  plan: "Direct" | "Regular";
  payout: "Growth" | "IDCW";
};

let cache: ActiveSchemeRow[] | null = null;
let loadPromise: Promise<ActiveSchemeRow[]> | null = null;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
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

function parseRows(text: string): ActiveSchemeRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const rows: ActiveSchemeRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]!);
    if (cols.length < 8) continue;
    const [amfiCode, isin, name, category, subCategory, amc, plan, payout] = cols;
    if (!amfiCode?.trim() || !/^\d+$/.test(amfiCode.trim())) continue;
    rows.push({
      amfiCode: amfiCode.trim(),
      isin: (isin ?? "").trim(),
      name: (name ?? "").trim(),
      category: (category ?? "").trim(),
      subCategory: (subCategory ?? "").trim(),
      amc: (amc ?? "").trim(),
      plan: plan === "Direct" ? "Direct" : "Regular",
      payout: payout === "Growth" ? "Growth" : "IDCW",
    });
  }
  return rows;
}

export async function loadAmfiActiveSchemes(): Promise<ActiveSchemeRow[]> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await fetch("/amfi_active_schemes.csv");
      if (!res.ok) throw new Error(`Failed to load active schemes (${res.status})`);
      cache = parseRows(await res.text());
      return cache;
    })();
  }
  return loadPromise;
}

export function filterEquityDirectGrowth(rows: ActiveSchemeRow[]): ActiveSchemeRow[] {
  return rows.filter(
    (r) => r.category === "Equity Scheme" && r.plan === "Direct" && r.payout === "Growth",
  );
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
