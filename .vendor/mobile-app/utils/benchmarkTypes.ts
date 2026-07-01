/** Nifty Indices TRI benchmarks (API `indextype` names). */
export const NIFTY_BENCHMARK_INDEXES = [
  { id: "nifty50", label: "Nifty 50", apiName: "NIFTY 50" },
  { id: "nifty100", label: "Nifty 100", apiName: "NIFTY 100" },
  { id: "nifty200", label: "Nifty 200", apiName: "NIFTY 200" },
  { id: "nifty500", label: "Nifty 500", apiName: "NIFTY 500" },
  { id: "nifty_india_fpi_150", label: "Nifty India FPI 150", apiName: "NIFTY INDIA FPI 150" },
  { id: "nifty_largemidcap_250", label: "Nifty LargeMidcap 250", apiName: "NIFTY LARGEMIDCAP 250" },
  { id: "nifty_microcap_250", label: "Nifty Microcap 250", apiName: "NIFTY MICROCAP 250" },
  { id: "nifty_midcap_100", label: "Nifty Midcap 100", apiName: "NIFTY MIDCAP 100" },
  { id: "nifty_midcap_150", label: "Nifty Midcap 150", apiName: "NIFTY MIDCAP 150" },
  { id: "nifty_midcap_50", label: "Nifty Midcap 50", apiName: "NIFTY MIDCAP 50" },
  { id: "nifty_midcap_select", label: "Nifty Midcap Select", apiName: "NIFTY MIDCAP SELECT" },
  { id: "nifty_midsmallcap_400", label: "Nifty MidSmallcap 400", apiName: "NIFTY MIDSMALLCAP 400" },
  {
    id: "nifty_midsmallcap_400_5050",
    label: "Nifty MidSmallcap 400 50:50",
    apiName: "NIFTY MIDSMALLCAP400 50:50",
  },
  { id: "nifty_next_50", label: "Nifty Next 50", apiName: "NIFTY NEXT 50" },
  { id: "nifty_smallcap_100", label: "Nifty Smallcap 100", apiName: "NIFTY SMALLCAP 100" },
  { id: "nifty_smallcap_250", label: "Nifty Smallcap 250", apiName: "NIFTY SMALLCAP 250" },
  { id: "nifty_smallcap_50", label: "Nifty Smallcap 50", apiName: "NIFTY SMALLCAP 50" },
  { id: "nifty_smallcap_500", label: "Nifty Smallcap 500", apiName: "NIFTY SMALLCAP 500" },
  { id: "nifty_total_market", label: "Nifty Total Market", apiName: "NIFTY TOTAL MARKET" },
  {
    id: "nifty500_largemidsmall_equalcap",
    label: "Nifty500 LargemidSmall Equal-Cap",
    apiName: "NIFTY500 LARGEMIDSMALL EQUAL-CAP WEIGHTED",
  },
  {
    id: "nifty500_multicap_502525",
    label: "Nifty500 Multicap 50:25:25",
    apiName: "NIFTY500 MULTICAP 50:25:25",
  },
] as const;

export const BENCHMARK_OPTIONS = NIFTY_BENCHMARK_INDEXES.map(({ id, label }) => ({ id, label }));

export type BenchmarkId = (typeof NIFTY_BENCHMARK_INDEXES)[number]["id"];

export const BENCHMARK_NIFTY_INDEX_NAMES: Record<BenchmarkId, string> = Object.fromEntries(
  NIFTY_BENCHMARK_INDEXES.map((row) => [row.id, row.apiName]),
) as Record<BenchmarkId, string>;

export const BENCHMARK_IDS_WITH_API = NIFTY_BENCHMARK_INDEXES.map((row) => row.id);

export type BenchmarkDailyPoint = { t: number; tri: number };

export type BenchmarkDailySeries = {
  version: 1;
  id: BenchmarkId;
  indexName: string;
  updatedAt: string;
  points: BenchmarkDailyPoint[];
};

export type BenchmarkMonthEndPoint = { date: Date; nav100: number };
