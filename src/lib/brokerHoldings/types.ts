export type McpToolResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: { result?: string };
  isError?: boolean;
  error?: string;
};

export type NormalizedBrokerHolding = {
  source: string;
  parser: string;
  code: string;
  name: string;
  assetType: string;
  subClass: string;
  folio?: string;
  invested: number | null;
  value: number;
  weightPct: number | null;
  pnl: number;
  pnlPct: number | null;
  units: number;
  price: number;
  broker: string;
  dayChange?: number | null;
  dayChangePct?: number | null;
  raw?: Record<string, unknown>;
};

export type ParsedBrokerHoldings = {
  holdings: NormalizedBrokerHolding[];
  parser: string;
  source: string;
  summary: {
    count: number;
    totalValue: number;
    totalInvested: number | null;
    totalPnl: number;
    assetTypes: string[];
  };
};
