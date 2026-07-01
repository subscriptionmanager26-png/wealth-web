import {
  fetchUpvalySchemesForCodes,
  isUpvalySchemeFetchSettled,
  parseUpvalyMetric,
  type UpvalySchemeDetail,
} from "./upvalyMfApi";

export type PortfolioHoldingInput = {
  amfiCode?: string;
  amount: number;
  name?: string;
};

export type WeightedMetricCoverage = {
  value: number | null;
  /** Sum of current value for funds that contributed this metric (denominator only). */
  contributingValue: number;
  contributingSchemeCount: number;
};

export type PortfolioFundamentalsSnapshot = {
  weighted: {
    pe: WeightedMetricCoverage;
    pb: WeightedMetricCoverage;
    priceToSale: WeightedMetricCoverage;
    yieldToMaturity: WeightedMetricCoverage;
    modifiedDuration: WeightedMetricCoverage;
    avgEffMaturity: WeightedMetricCoverage;
    expenseRatio: WeightedMetricCoverage;
  };
  schemesRequested: number;
  schemesWithData: number;
  /** Sum of current value for all eligible holdings (full portfolio slice in Analytics). */
  totalEligibleValue: number;
};

export type PortfolioAggregatedHolding = {
  name: string;
  sector?: string;
  weightPct: number;
};

/** Value-weighted average; denominator = current value of funds that report this metric only. */
function weightedMetric(
  holdings: PortfolioHoldingInput[],
  schemes: Record<string, UpvalySchemeDetail>,
  pick: (fundamentals: NonNullable<UpvalySchemeDetail["fundamentals"]>) => string | undefined,
): WeightedMetricCoverage {
  let weightedSum = 0;
  let contributingValue = 0;
  const contributingCodes = new Set<string>();
  for (const h of holdings) {
    const code = String(h.amfiCode ?? "").trim();
    if (!/^\d+$/.test(code) || h.amount <= 0) continue;
    const fundamentals = schemes[code]?.fundamentals;
    if (!fundamentals) continue;
    const metric = parseUpvalyMetric(pick(fundamentals));
    if (metric == null) continue;
    weightedSum += h.amount * metric;
    contributingValue += h.amount;
    contributingCodes.add(code);
  }
  return {
    value: contributingValue > 0 ? weightedSum / contributingValue : null,
    contributingValue,
    contributingSchemeCount: contributingCodes.size,
  };
}

function weightedSchemeMetric(
  holdings: PortfolioHoldingInput[],
  schemes: Record<string, UpvalySchemeDetail>,
  pick: (scheme: UpvalySchemeDetail) => number | null | undefined,
): WeightedMetricCoverage {
  let weightedSum = 0;
  let contributingValue = 0;
  const contributingCodes = new Set<string>();
  for (const h of holdings) {
    const code = String(h.amfiCode ?? "").trim();
    if (!/^\d+$/.test(code) || h.amount <= 0) continue;
    const scheme = schemes[code];
    if (!scheme) continue;
    const metric = pick(scheme);
    if (metric == null || !Number.isFinite(metric)) continue;
    weightedSum += h.amount * metric;
    contributingValue += h.amount;
    contributingCodes.add(code);
  }
  return {
    value: contributingValue > 0 ? weightedSum / contributingValue : null,
    contributingValue,
    contributingSchemeCount: contributingCodes.size,
  };
}

export function buildPortfolioFundamentalsSnapshot(
  holdings: PortfolioHoldingInput[],
  schemes: Record<string, UpvalySchemeDetail>,
): PortfolioFundamentalsSnapshot {
  const codes = new Set(
    holdings
      .map((h) => String(h.amfiCode ?? "").trim())
      .filter((code) => /^\d+$/.test(code)),
  );
  let schemesWithData = 0;
  for (const code of codes) {
    if (schemes[code]?.fundamentals) schemesWithData += 1;
  }

  const totalEligibleValue = holdings.reduce((sum, h) => sum + (h.amount > 0 ? h.amount : 0), 0);

  return {
    weighted: {
      pe: weightedMetric(holdings, schemes, (f) => f.pe),
      pb: weightedMetric(holdings, schemes, (f) => f.pb),
      priceToSale: weightedMetric(holdings, schemes, (f) => f.priceToSale),
      yieldToMaturity: weightedMetric(holdings, schemes, (f) => f.yieldToMaturity),
      modifiedDuration: weightedMetric(holdings, schemes, (f) => f.modifiedDuration),
      avgEffMaturity: weightedMetric(holdings, schemes, (f) => f.avgEffMaturity),
      expenseRatio: weightedSchemeMetric(holdings, schemes, (s) => s.expenseRatio),
    },
    schemesRequested: codes.size,
    schemesWithData,
    totalEligibleValue,
  };
}

export function buildPortfolioHoldingsAggregation(
  holdings: PortfolioHoldingInput[],
  schemes: Record<string, UpvalySchemeDetail>,
): PortfolioAggregatedHolding[] {
  const totalValue = holdings.reduce((sum, h) => sum + (h.amount > 0 ? h.amount : 0), 0);
  if (totalValue <= 0) return [];

  const byName = new Map<string, { sector?: string; weightPct: number }>();
  for (const h of holdings) {
    const code = String(h.amfiCode ?? "").trim();
    if (!/^\d+$/.test(code) || h.amount <= 0) continue;
    const scheme = schemes[code];
    if (!scheme?.holdings?.length) continue;
    const fundShare = h.amount / totalValue;
    for (const row of scheme.holdings) {
      const name = String(row.name ?? "").trim();
      if (!name) continue;
      const holdingWeight = parseUpvalyMetric(row.weightage);
      if (holdingWeight == null || holdingWeight <= 0) continue;
      const contrib = fundShare * holdingWeight;
      const prev = byName.get(name);
      if (prev) {
        prev.weightPct += contrib;
        if (!prev.sector && row.sector) prev.sector = row.sector;
      } else {
        byName.set(name, { sector: row.sector, weightPct: contrib });
      }
    }
  }

  return [...byName.entries()]
    .map(([name, row]) => ({ name, sector: row.sector, weightPct: row.weightPct }))
    .filter((row) => row.weightPct > 0)
    .sort((a, b) => b.weightPct - a.weightPct);
}

export async function loadPortfolioInsightsForHoldings(
  holdings: PortfolioHoldingInput[],
  options?: { onlyCodes?: string[] },
): Promise<Record<string, UpvalySchemeDetail>> {
  const codes =
    options?.onlyCodes ??
    holdings
      .map((h) => String(h.amfiCode ?? "").trim())
      .filter((code) => /^\d+$/.test(code));
  const unique = [...new Set(codes.filter((c) => /^\d+$/.test(c)))];
  const pending = unique.filter((code) => !isUpvalySchemeFetchSettled(code));
  if (!pending.length) return {};
  return fetchUpvalySchemesForCodes(pending);
}
