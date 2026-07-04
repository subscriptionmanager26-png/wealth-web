import type { BenchmarkDailyPoint } from "./benchmarkTypes";

const NIFTY_TRI_URL = "https://www.niftyindices.com/BackPage/getTotalReturnIndexString";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function formatNiftyApiDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

export function parseNiftyIndexDate(s: string): Date | null {
  const m = String(s ?? "")
    .trim()
    .match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mon = MONTHS.indexOf(m[2] as (typeof MONTHS)[number]);
  const yyyy = Number(m[3]);
  if (!Number.isFinite(dd) || mon < 0 || !Number.isFinite(yyyy)) return null;
  return new Date(yyyy, mon, dd, 12, 0, 0, 0);
}

type NiftyTriRow = {
  Date?: string;
  "Index Name"?: string;
  TotalReturnsIndex?: string;
};

function parseTriValue(s?: string | null): number | null {
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function fetchNiftyTotalReturnIndex(
  indexName: string,
  startDate: Date,
  endDate: Date,
): Promise<BenchmarkDailyPoint[]> {
  const cinfo = JSON.stringify({
    name: indexName,
    startDate: formatNiftyApiDate(startDate),
    endDate: formatNiftyApiDate(endDate),
    indexName,
  });

  const res = await fetch(NIFTY_TRI_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/json; charset=UTF-8",
      Origin: "https://www.niftyindices.com",
      Referer: "https://www.niftyindices.com/reports/historical-data",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({ cinfo }),
  });

  if (!res.ok) {
    throw new Error(`Nifty TRI fetch failed (${res.status}) for ${indexName}`);
  }

  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error(`Nifty TRI returned HTML for ${indexName}`);
  }
  const payload = JSON.parse(text) as NiftyTriRow[] | { d?: string };
  // BackPage returns a JSON array; legacy .aspx returned { d: "<json array>" }.
  let rows: NiftyTriRow[] = [];
  if (Array.isArray(payload)) rows = payload;
  else if (payload?.d) {
    try {
      rows = JSON.parse(payload.d) as NiftyTriRow[];
    } catch {
      return [];
    }
  }
  if (!Array.isArray(rows)) return [];

  const byT = new Map<number, number>();
  for (const row of rows) {
    const date = parseNiftyIndexDate(row.Date ?? "");
    const tri = parseTriValue(row.TotalReturnsIndex);
    if (!date || tri == null) continue;
    byT.set(date.getTime(), tri);
  }

  return [...byT.entries()]
    .map(([t, tri]) => ({ t, tri }))
    .sort((a, b) => a.t - b.t);
}
