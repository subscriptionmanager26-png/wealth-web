export type SortKey =
  | "name"
  | "roll_1y"
  | "roll_3y"
  | "roll_5y"
  | "cagr_1y"
  | "cagr_3y"
  | "cagr_5y"
  | "volatility_3y"
  | "sharpe_3y"
  | "sortino_3y"
  | "pe"
  | "ter"
  | "aum"
  | "cat_rank_3y";

export type ReturnPeriod = "1y" | "3y" | "5y";

export type ScreenerTableColumn =
  | { kind: "rolling"; period: ReturnPeriod; sortKey: SortKey; label: string }
  | { kind: "cagr"; period: ReturnPeriod; sortKey: SortKey; label: string }
  | { kind: "risk"; id: "volatility" | "sharpe" | "sortino"; sortKey: SortKey; label: string }
  | { kind: "fundamental"; id: "pe" | "ter" | "aum" | "categoryRank"; sortKey: SortKey; label: string };

export type ScreenerTableGroup = {
  label: string;
  columns: ScreenerTableColumn[];
};

const RETURN_PERIODS: ReturnPeriod[] = ["1y", "3y", "5y"];

function periodLabel(period: ReturnPeriod): string {
  if (period === "1y") return "1Y";
  if (period === "3y") return "3Y";
  return "5Y";
}

export const SCREENER_TABLE_GROUPS: ScreenerTableGroup[] = [
  {
    label: "Rolling Returns",
    columns: RETURN_PERIODS.map((period) => ({
      kind: "rolling" as const,
      period,
      sortKey: `roll_${period}` as SortKey,
      label: periodLabel(period),
    })),
  },
  {
    label: "CAGR",
    columns: RETURN_PERIODS.map((period) => ({
      kind: "cagr" as const,
      period,
      sortKey: `cagr_${period}` as SortKey,
      label: periodLabel(period),
    })),
  },
  {
    label: "Risk",
    columns: [
      { kind: "risk", id: "volatility", sortKey: "volatility_3y", label: "Volatility" },
      { kind: "risk", id: "sharpe", sortKey: "sharpe_3y", label: "Sharpe" },
      { kind: "risk", id: "sortino", sortKey: "sortino_3y", label: "Sortino" },
    ],
  },
  {
    label: "Others",
    columns: [
      { kind: "fundamental", id: "pe", sortKey: "pe", label: "P/E" },
      { kind: "fundamental", id: "ter", sortKey: "ter", label: "TER" },
      { kind: "fundamental", id: "aum", sortKey: "aum", label: "AUM" },
      { kind: "fundamental", id: "categoryRank", sortKey: "cat_rank_3y", label: "Category Rank" },
    ],
  },
];

export const ALL_SCREENER_COLUMNS: ScreenerTableColumn[] = SCREENER_TABLE_GROUPS.flatMap(
  (g) => g.columns,
);

export function screenerColumnKey(col: ScreenerTableColumn): string {
  if (col.kind === "fundamental" || col.kind === "risk") return col.id;
  return `${col.kind}-${col.period}`;
}

export function sortDescDefault(key: SortKey): boolean {
  return key !== "name" && key !== "ter" && key !== "cat_rank_3y";
}
