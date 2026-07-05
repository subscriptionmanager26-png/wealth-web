import type { ReactNode } from "react";
import type { Block } from "../../../lib/chatBlocks/types";
import {
  ActionChecklistBlockView,
  AllocationPieBlockView,
  AssumptionsBlockView,
  BarChartBlockView,
  BulletListBlockView,
  CompareHeaderBlockView,
  ConfidenceMeterBlockView,
  CtaButtonBlockView,
  DecisionMatrixBlockView,
  DiversificationScoreBlockView,
  FollowUpQuestionsBlockView,
  GaugeChartBlockView,
  InfoCardBlockView,
  MetricCardBlockView,
  PerformanceChartBlockView,
  PieChartBlockView,
  PriceChartBlockView,
  ProgressBarBlockView,
  ProgressRingBlockView,
  ProsConsBlockView,
  RecommendationCardBlockView,
  ReturnsTableBlockView,
  RisksBlockView,
  RiskMeterBlockView,
  ScenarioComparisonBlockView,
  SourcesBlockView,
  TimelineBlockView,
} from "./genUi/GenUiBlocks";

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="gen-placeholder-card">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

/** Renders extended Generative UI block types. */
export function renderExtendedBlock(block: Block): ReactNode {
  switch (block.type) {
    case "bulletList":
      return <BulletListBlockView block={block} />;
    case "timeline":
      return <TimelineBlockView block={block} />;
    case "progressBar":
      return <ProgressBarBlockView block={block} />;
    case "metricCard":
      return <MetricCardBlockView block={block} />;
    case "infoCard":
      return <InfoCardBlockView block={block} />;
    case "ctaButton":
      return <CtaButtonBlockView block={block} />;
    case "compareHeader":
      return <CompareHeaderBlockView block={block} />;
    case "lineChart":
    case "performanceChart":
      return <PerformanceChartBlockView block={{ type: "performanceChart" }} />;
    case "priceChart":
      return <PriceChartBlockView block={block} />;
    case "pieChart":
      return <PieChartBlockView block={block} />;
    case "allocationPie":
      return <AllocationPieBlockView block={block} />;
    case "barChart":
      return <BarChartBlockView block={block} />;
    case "gaugeChart":
      return <GaugeChartBlockView block={block} />;
    case "progressRing":
      return <ProgressRingBlockView block={block} />;
    case "returnsTable":
      return <ReturnsTableBlockView block={block} />;
    case "diversificationScore":
      return <DiversificationScoreBlockView block={block} />;
    case "riskMeter":
      return <RiskMeterBlockView block={block} />;
    case "recommendationCard":
      return <RecommendationCardBlockView block={block} />;
    case "actionChecklist":
      return <ActionChecklistBlockView block={block} />;
    case "prosCons":
      return <ProsConsBlockView block={block} />;
    case "decisionMatrix":
      return <DecisionMatrixBlockView block={block} />;
    case "scenarioComparison":
      return <ScenarioComparisonBlockView block={block} />;
    case "confidenceMeter":
      return <ConfidenceMeterBlockView block={block} />;
    case "assumptions":
      return <AssumptionsBlockView block={block} />;
    case "risks":
      return <RisksBlockView block={block} />;
    case "sources":
      return <SourcesBlockView block={block} />;
    case "followUpQuestions":
      return <FollowUpQuestionsBlockView block={block} />;
    case "stockCard":
      return <PlaceholderCard title="Stock dashboard" body="Equity stock cards connect when direct stock holdings are loaded." />;
    case "newsFeed":
      return <PlaceholderCard title="News feed" body="Portfolio and market news will appear here when the news API is connected." />;
    case "valuationSummary":
      return <PlaceholderCard title="Valuation" body="P/E, P/B and fair-value estimates for funds and stocks." />;
    case "peerComparison":
      return <PlaceholderCard title="Peer comparison" body="Side-by-side peer metrics for funds in the same category." />;
    case "netWorthCard":
      return <PlaceholderCard title="Net worth" body="Aggregated net worth across assets and liabilities." />;
    case "goalTracker":
      return <PlaceholderCard title="Goal tracker" body="Track progress toward financial goals with projected dates." />;
    case "retirementProjection":
      return <PlaceholderCard title="Retirement projection" body="Monte Carlo and corpus projections for retirement planning." />;
    case "sipCalculator":
      return <PlaceholderCard title="SIP calculator" body="Estimate future corpus from monthly SIP, return, and horizon." />;
    case "taxSummary":
      return <PlaceholderCard title="Tax summary" body="Estimated capital gains, dividend tax, and deduction opportunities." />;
    case "emergencyFundMeter":
      return <PlaceholderCard title="Emergency fund" body="Months of expenses covered by liquid savings." />;
    case "actionPlan":
      return <ActionChecklistBlockView block={{ type: "actionChecklist", items: [{ id: "1", text: "Define priorities with Munshi" }] }} />;
    case "portfolioTimeline":
      return <TimelineBlockView block={{ type: "timeline", events: [] }} />;
    case "rebalancingSuggestion":
      return <PlaceholderCard title="Rebalancing" body="Suggested trades to align with target allocation." />;
    default:
      return null;
  }
}
