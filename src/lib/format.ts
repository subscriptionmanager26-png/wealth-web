export const MIN_HOLDING_VALUE_INR = 1;

/** Hide exited / zero-balance scheme lines in portfolio UI (matches mobile app). */
export function hasMaterialHoldingValue(amount: number): boolean {
  return Number.isFinite(amount) && amount >= MIN_HOLDING_VALUE_INR;
}

export const randId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const toNum = (s?: string | null) => {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const formatInrFull = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export const formatInrShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2).replace(/\.00$/, "")}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2).replace(/\.00$/, "")}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(2).replace(/\.00$/, "")}K`;
  return `${sign}₹${Math.round(abs)}`;
};

export const formatCompactInr = formatInrShort;

export const formatUnits = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

export const formatPct = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`;

export function parseCasDate(input?: string | null): Date | null {
  if (!input) return null;
  const s = input.trim();
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime())) return d1;
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const day = Number(m[1]);
  const mon = months[m[2].toLowerCase()];
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (!Number.isFinite(day) || mon == null || !Number.isFinite(year)) return null;
  return new Date(year, mon, day);
}
