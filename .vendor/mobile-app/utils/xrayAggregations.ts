import { parseUpvalyMetric, type UpvalySchemeDetail } from "./upvalyMfApi";

export type PortfolioHoldingInput = {
  amfiCode?: string;
  amount: number;
  name?: string;
};

export type XRayHoldingRow = {
  name: string;
  sector?: string;
  weightPct: number;
  sources: { fundName: string; contribPct: number }[];
};

export type XRaySectorRow = {
  sector: string;
  weightPct: number;
  sources: { fundName: string; contribPct: number }[];
};

export type UnitAgeBucket = {
  label: string;
  units: number;
  pct: number;
};

export function buildXRayHoldings(
  holdings: PortfolioHoldingInput[],
  schemes: Record<string, UpvalySchemeDetail>,
): XRayHoldingRow[] {
  const totalValue = holdings.reduce((sum, h) => sum + (h.amount > 0 ? h.amount : 0), 0);
  if (totalValue <= 0) return [];

  const byName = new Map<string, { sector?: string; weightPct: number; sources: Map<string, number> }>();
  for (const h of holdings) {
    const code = String(h.amfiCode ?? "").trim();
    if (!/^\d+$/.test(code) || h.amount <= 0) continue;
    const scheme = schemes[code];
    if (!scheme?.holdings?.length) continue;
    const fundName = h.name?.trim() || scheme.schemeName || `Scheme ${code}`;
    const fundShare = h.amount / totalValue;
    for (const row of scheme.holdings) {
      const name = String(row.name ?? "").trim();
      if (!name) continue;
      const holdingWeight = parseUpvalyMetric(row.weightage);
      if (holdingWeight == null || holdingWeight <= 0) continue;
      const contrib = fundShare * holdingWeight;
      let entry = byName.get(name);
      if (!entry) {
        entry = { sector: row.sector, weightPct: 0, sources: new Map() };
        byName.set(name, entry);
      }
      entry.weightPct += contrib;
      if (!entry.sector && row.sector) entry.sector = row.sector;
      entry.sources.set(fundName, (entry.sources.get(fundName) ?? 0) + contrib);
    }
  }

  return [...byName.entries()]
    .map(([name, row]) => ({
      name,
      sector: row.sector,
      weightPct: row.weightPct,
      sources: [...row.sources.entries()]
        .map(([fundName, contribPct]) => ({ fundName, contribPct }))
        .sort((a, b) => b.contribPct - a.contribPct),
    }))
    .filter((r) => r.weightPct > 0)
    .sort((a, b) => b.weightPct - a.weightPct);
}

export function buildXRaySectors(holdingRows: XRayHoldingRow[]): XRaySectorRow[] {
  const bySector = new Map<string, { weightPct: number; sources: Map<string, number> }>();
  for (const row of holdingRows) {
    const sector = (row.sector || "Other").trim() || "Other";
    let entry = bySector.get(sector);
    if (!entry) {
      entry = { weightPct: 0, sources: new Map() };
      bySector.set(sector, entry);
    }
    entry.weightPct += row.weightPct;
    for (const src of row.sources) {
      entry.sources.set(src.fundName, (entry.sources.get(src.fundName) ?? 0) + src.contribPct);
    }
  }
  return [...bySector.entries()]
    .map(([sector, row]) => ({
      sector,
      weightPct: row.weightPct,
      sources: [...row.sources.entries()]
        .map(([fundName, contribPct]) => ({ fundName, contribPct }))
        .sort((a, b) => b.contribPct - a.contribPct),
    }))
    .sort((a, b) => b.weightPct - a.weightPct);
}

export function buildUnitAgeBuckets(
  funds: { totalUnits: number; unitsAbove12Months: number }[],
): UnitAgeBucket[] {
  let lt1y = 0;
  let gte1y = 0;
  for (const f of funds) {
    if (f.totalUnits <= 0) continue;
    gte1y += Math.max(0, f.unitsAbove12Months);
    lt1y += Math.max(0, f.totalUnits - f.unitsAbove12Months);
  }
  const total = lt1y + gte1y;
  if (total <= 0) return [];
  return [
    { label: "< 1 year", units: lt1y, pct: (lt1y / total) * 100 },
    { label: "≥ 1 year", units: gte1y, pct: (gte1y / total) * 100 },
  ];
}
