/** Phase 1 — generic Munshi chat UI blocks */

export type BlockTone = "up" | "down" | "neutral";
export type BadgeVariant = "success" | "warning" | "muted" | "info";
export type CalloutTone = "info" | "warn" | "success";

export type TextBlock = {
  type: "text";
  text: string;
};

export type HeadingBlock = {
  type: "heading";
  level?: 2 | 3;
  text: string;
};

export type StatBlock = {
  type: "stat";
  label: string;
  value: string;
  delta?: string;
  tone?: BlockTone;
};

export type BadgeBlock = {
  type: "badge";
  label: string;
  variant?: BadgeVariant;
};

export type TableBlock = {
  type: "table";
  columns: string[];
  rows: string[][];
};

export type CalloutBlock = {
  type: "callout";
  tone?: CalloutTone;
  text: string;
};

export type DividerBlock = {
  type: "divider";
};

export type StackBlock = {
  type: "stack";
  children: Block[];
};

/** Phase 3 — layout blocks */
export type RowBlock = {
  type: "row";
  children: Block[];
  gap?: "sm" | "md";
};

export type ColumnBlock = {
  type: "column";
  children: Block[];
};

export type GridBlock = {
  type: "grid";
  columns?: 1 | 2 | 3;
  children: Block[];
};

export type TabPanel = {
  id: string;
  label: string;
  children: Block[];
};

export type TabsBlock = {
  type: "tabs";
  tabs: TabPanel[];
  defaultTab?: string;
};

export type AccordionPanel = {
  id: string;
  title: string;
  children: Block[];
  defaultOpen?: boolean;
};

export type AccordionBlock = {
  type: "accordion";
  items: AccordionPanel[];
};

/** Phase 2 — wealth blocks (data from tool results, not LLM numbers) */
export type PortfolioSummaryBlock = {
  type: "portfolioSummary";
};

export type PeriodReturnsBlock = {
  type: "periodReturns";
  frames?: string[];
};

export type BenchmarkComparisonBlock = {
  type: "benchmarkComparison";
  frame?: string;
  benchmarkId?: string;
};

export type HoldingsTableBlock = {
  type: "holdingsTable";
  limit?: number;
};

export type AllocationBlock = {
  type: "allocation";
};

export type FundCardBlock = {
  type: "fundCard";
  rank?: number;
  query?: string;
};

export type SectorExposureBlock = {
  type: "sectorExposure";
  limit?: number;
};

export type {
  BulletListBlock,
  TimelineBlock,
  ProgressBarBlock,
  MetricCardBlock,
  InfoCardBlock,
  CtaButtonBlock,
  CompareHeaderBlock,
  LineChartBlock,
  PieChartBlock,
  BarChartBlock,
  GaugeChartBlock,
  ProgressRingBlock,
  PerformanceChartBlock,
  AllocationPieBlock,
  ReturnsTableBlock,
  PortfolioTimelineBlock,
  DiversificationScoreBlock,
  RiskMeterBlock,
  RebalancingBlock,
  PriceChartBlock,
  RecommendationCardBlock,
  ActionChecklistBlock,
  ProsConsBlock,
  DecisionMatrixBlock,
  ScenarioComparisonBlock,
  ConfidenceMeterBlock,
  AssumptionsBlock,
  RisksBlock,
  SourcesBlock,
  FollowUpQuestionsBlock,
  StockCardBlock,
  NewsFeedBlock,
  ValuationBlock,
  PeerComparisonBlock,
  NetWorthCardBlock,
  GoalTrackerBlock,
  RetirementProjectionBlock,
  SipCalculatorBlock,
  TaxSummaryBlock,
  EmergencyFundBlock,
  ActionPlanBlock,
} from "./extendedTypes";

import type { ExtendedBlock } from "./extendedTypes";
import type { AnswerTemplate } from "./answerTemplates";

export type Block =
  | TextBlock
  | HeadingBlock
  | StatBlock
  | BadgeBlock
  | TableBlock
  | CalloutBlock
  | DividerBlock
  | StackBlock
  | RowBlock
  | ColumnBlock
  | GridBlock
  | TabsBlock
  | AccordionBlock
  | PortfolioSummaryBlock
  | PeriodReturnsBlock
  | BenchmarkComparisonBlock
  | HoldingsTableBlock
  | AllocationBlock
  | FundCardBlock
  | SectorExposureBlock
  | ExtendedBlock;

export type BlocksDocument = {
  template?: AnswerTemplate;
  blocks: Block[];
};
