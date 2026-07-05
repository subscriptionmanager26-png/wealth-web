/** Extended Generative UI block types — templates, charts, AI, wealth. */
import type { BlockTone, BadgeVariant, CalloutTone } from "./types";

export type BulletListBlock = { type: "bulletList"; items: string[] };
export type TimelineEvent = { date: string; title: string; body?: string };
export type TimelineBlock = { type: "timeline"; events: TimelineEvent[] };
export type ProgressBarBlock = { type: "progressBar"; label: string; value: number; max?: number; tone?: BlockTone };
export type MetricCardBlock = {
  type: "metricCard";
  label: string;
  value: string;
  delta?: string;
  tone?: BlockTone;
  sublabel?: string;
};
export type InfoCardBlock = { type: "infoCard"; title: string; body: string };
export type CtaButtonBlock = { type: "ctaButton"; label: string; hint?: string };
export type CompareHeaderBlock = { type: "compareHeader"; leftLabel: string; rightLabel: string; subtitle?: string };

export type LineChartBlock = { type: "lineChart"; series?: "portfolio" | "benchmark" };
export type PieChartBlock = { type: "pieChart"; variant?: "allocation" | "sector" };
export type BarChartBlock = { type: "barChart"; variant?: "comparison" | "returns" };
export type GaugeChartBlock = { type: "gaugeChart"; metric?: "risk" | "volatility" | "diversification"; label?: string };
export type ProgressRingBlock = { type: "progressRing"; label?: string; value?: number };

export type PerformanceChartBlock = { type: "performanceChart" };
export type AllocationPieBlock = { type: "allocationPie" };
export type ReturnsTableBlock = { type: "returnsTable" };
export type PortfolioTimelineBlock = { type: "portfolioTimeline" };
export type DiversificationScoreBlock = { type: "diversificationScore" };
export type RiskMeterBlock = { type: "riskMeter" };
export type RebalancingBlock = { type: "rebalancingSuggestion" };
export type PriceChartBlock = { type: "priceChart" };

export type RecommendationCardBlock = {
  type: "recommendationCard";
  title: string;
  body: string;
  confidence?: number;
  action?: string;
};
export type ChecklistItem = { id: string; text: string; done?: boolean };
export type ActionChecklistBlock = { type: "actionChecklist"; items: ChecklistItem[] };
export type ProsConsBlock = { type: "prosCons"; pros: string[]; cons: string[] };
export type DecisionMatrixRow = { option: string; score?: string; note?: string };
export type DecisionMatrixBlock = { type: "decisionMatrix"; rows: DecisionMatrixRow[] };
export type ScenarioItem = { name: string; outcome: string; tone?: BlockTone };
export type ScenarioComparisonBlock = { type: "scenarioComparison"; scenarios: ScenarioItem[] };
export type ConfidenceMeterBlock = { type: "confidenceMeter"; value: number; label?: string };
export type AssumptionsBlock = { type: "assumptions"; items: string[] };
export type RisksBlock = { type: "risks"; items: string[] };
export type SourcesBlock = { type: "sources"; items: string[] };
export type FollowUpQuestionsBlock = { type: "followUpQuestions"; items: string[] };

export type StockCardBlock = { type: "stockCard"; symbol?: string };
export type NewsFeedBlock = { type: "newsFeed" };
export type ValuationBlock = { type: "valuationSummary" };
export type PeerComparisonBlock = { type: "peerComparison" };

export type NetWorthCardBlock = { type: "netWorthCard" };
export type GoalTrackerBlock = { type: "goalTracker" };
export type RetirementProjectionBlock = { type: "retirementProjection" };
export type SipCalculatorBlock = { type: "sipCalculator" };
export type TaxSummaryBlock = { type: "taxSummary" };
export type EmergencyFundBlock = { type: "emergencyFundMeter" };
export type ActionPlanBlock = { type: "actionPlan" };

export type ExtendedBlock =
  | BulletListBlock
  | TimelineBlock
  | ProgressBarBlock
  | MetricCardBlock
  | InfoCardBlock
  | CtaButtonBlock
  | CompareHeaderBlock
  | LineChartBlock
  | PieChartBlock
  | BarChartBlock
  | GaugeChartBlock
  | ProgressRingBlock
  | PerformanceChartBlock
  | AllocationPieBlock
  | ReturnsTableBlock
  | PortfolioTimelineBlock
  | DiversificationScoreBlock
  | RiskMeterBlock
  | RebalancingBlock
  | PriceChartBlock
  | RecommendationCardBlock
  | ActionChecklistBlock
  | ProsConsBlock
  | DecisionMatrixBlock
  | ScenarioComparisonBlock
  | ConfidenceMeterBlock
  | AssumptionsBlock
  | RisksBlock
  | SourcesBlock
  | FollowUpQuestionsBlock
  | StockCardBlock
  | NewsFeedBlock
  | ValuationBlock
  | PeerComparisonBlock
  | NetWorthCardBlock
  | GoalTrackerBlock
  | RetirementProjectionBlock
  | SipCalculatorBlock
  | TaxSummaryBlock
  | EmergencyFundBlock
  | ActionPlanBlock;

export type { BlockTone, BadgeVariant, CalloutTone };
