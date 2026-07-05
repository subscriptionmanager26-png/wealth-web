import type {
  ActionChecklistBlock,
  AllocationPieBlock,
  AssumptionsBlock,
  BarChartBlock,
  BulletListBlock,
  CompareHeaderBlock,
  ConfidenceMeterBlock,
  CtaButtonBlock,
  DecisionMatrixBlock,
  DiversificationScoreBlock,
  FollowUpQuestionsBlock,
  GaugeChartBlock,
  InfoCardBlock,
  MetricCardBlock,
  PerformanceChartBlock,
  PieChartBlock,
  PriceChartBlock,
  ProgressBarBlock,
  ProgressRingBlock,
  ProsConsBlock,
  RecommendationCardBlock,
  ReturnsTableBlock,
  RisksBlock,
  RiskMeterBlock,
  ScenarioComparisonBlock,
  SourcesBlock,
  TimelineBlock,
} from "../../../lib/chatBlocks/extendedTypes";
import { formatPct } from "../../../lib/portfolioTools/toolData";
import { useToolData } from "../../../lib/chatBlocks/ToolDataContext";
import { Wealth } from "../../../theme/wealthTheme";
import { MiniBarChart, MiniGauge, MiniLineChart, MiniPieChart, MiniProgressRing } from "../charts/ChartPrimitives";

const SLICE_COLORS = ["#0d9488", "#3b82f6", "#f59e0b", "#8b5cf6", "#64748b", "#ec4899"];

export function BulletListBlockView({ block }: { block: BulletListBlock }) {
  if (!block.items.length) return null;
  return (
    <ul className="gen-bullet-list">
      {block.items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function TimelineBlockView({ block }: { block: TimelineBlock }) {
  if (!block.events.length) {
    return <div className="gen-placeholder-card">Timeline events will appear when news and event data is connected.</div>;
  }
  return (
    <div className="gen-timeline">
      {block.events.map((e, i) => (
        <div key={i} className="gen-timeline-item">
          <span className="gen-timeline-date">{e.date}</span>
          <span className="gen-timeline-title">{e.title}</span>
          {e.body ? <p className="gen-timeline-body">{e.body}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function ProgressBarBlockView({ block }: { block: ProgressBarBlock }) {
  const max = block.max ?? 100;
  const pct = Math.min(100, (block.value / max) * 100);
  return (
    <div className={`gen-progress-bar gen-tone-${block.tone ?? "neutral"}`}>
      <div className="gen-progress-head">
        <span>{block.label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="gen-progress-track">
        <span className="gen-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function MetricCardBlockView({ block }: { block: MetricCardBlock }) {
  return (
    <div className={`gen-metric-card gen-tone-${block.tone ?? "neutral"}`}>
      <span className="gen-metric-label">{block.label}</span>
      <span className="gen-metric-value">{block.value}</span>
      {block.delta ? <span className="gen-metric-delta">{block.delta}</span> : null}
      {block.sublabel ? <span className="gen-metric-sub">{block.sublabel}</span> : null}
    </div>
  );
}

export function InfoCardBlockView({ block }: { block: InfoCardBlock }) {
  return (
    <div className="gen-info-card">
      <h4 className="gen-info-title">{block.title}</h4>
      <p className="gen-info-body">{block.body}</p>
    </div>
  );
}

export function CtaButtonBlockView({ block }: { block: CtaButtonBlock }) {
  return (
    <button type="button" className="gen-cta-btn" title={block.hint}>
      {block.label}
    </button>
  );
}

export function CompareHeaderBlockView({ block }: { block: CompareHeaderBlock }) {
  return (
    <div className="gen-compare-header">
      <div className="gen-compare-side gen-compare-a">
        <span className="gen-compare-label">{block.leftLabel}</span>
      </div>
      <span className="gen-compare-vs">vs</span>
      <div className="gen-compare-side gen-compare-b">
        <span className="gen-compare-label">{block.rightLabel}</span>
      </div>
      {block.subtitle ? <p className="gen-compare-sub">{block.subtitle}</p> : null}
    </div>
  );
}

export function PerformanceChartBlockView({ block: _ }: { block: PerformanceChartBlock }) {
  const series = useToolData()?.performanceSeries;
  if (!series?.points.length) return <div className="gen-placeholder-card">Performance chart loads after NAV data is available.</div>;
  return (
    <div className="gen-chart-card">
      <div className="gen-chart-card-head">{series.label ?? "Performance"}</div>
      <MiniLineChart points={series.points} />
    </div>
  );
}

export function PriceChartBlockView({ block: _ }: { block: PriceChartBlock }) {
  return <PerformanceChartBlockView block={{ type: "performanceChart" }} />;
}

export function AllocationPieBlockView({ block: _ }: { block: AllocationPieBlock }) {
  const data = useToolData()?.allocation;
  if (!data?.slices.length) return <div className="gen-placeholder-card">Allocation pie loads after asset allocation tool runs.</div>;
  return (
    <div className="gen-chart-card">
      <div className="gen-chart-card-head">Asset allocation</div>
      <MiniPieChart
        slices={data.slices.map((s, i) => ({
          label: s.type,
          value: s.weightPct,
          color: SLICE_COLORS[i % SLICE_COLORS.length]!,
        }))}
      />
    </div>
  );
}

export function PieChartBlockView({ block }: { block: PieChartBlock }) {
  if (block.variant === "sector") {
    const data = useToolData()?.sectorExposure;
    if (!data?.rows.length) return <div className="gen-placeholder-card">Sector pie not loaded.</div>;
    return (
      <div className="gen-chart-card">
        <div className="gen-chart-card-head">Sector exposure</div>
        <MiniPieChart
          slices={data.rows.slice(0, 6).map((r, i) => ({
            label: r.sector,
            value: r.weightPct,
            color: SLICE_COLORS[i % SLICE_COLORS.length]!,
          }))}
        />
      </div>
    );
  }
  return <AllocationPieBlockView block={{ type: "allocationPie" }} />;
}

export function BarChartBlockView({ block }: { block: BarChartBlock }) {
  const store = useToolData();
  if (block.variant === "comparison" && store?.benchmarkComparison) {
    const rows = store.benchmarkComparison.rows.slice(0, 4);
    return (
      <div className="gen-chart-card">
        <div className="gen-chart-card-head">You vs {store.benchmarkComparison.benchmarkLabel}</div>
        <MiniBarChart
          items={rows.flatMap((r) => [
            { label: `${r.frame} You`, value: r.portfolioPct ?? 0, color: Wealth.chartPortfolio },
            { label: `${r.frame} Index`, value: r.benchmarkPct ?? 0, color: Wealth.chartBenchmark },
          ])}
          format={(n) => formatPct(n)}
        />
      </div>
    );
  }
  const rows = store?.periodReturns?.rows ?? [];
  if (!rows.length) return <div className="gen-placeholder-card">Returns bar chart not loaded.</div>;
  return (
    <div className="gen-chart-card">
      <div className="gen-chart-card-head">Period returns</div>
      <MiniBarChart items={rows.map((r) => ({ label: r.frame, value: r.returnPct ?? 0 }))} format={(n) => formatPct(n)} />
    </div>
  );
}

export function GaugeChartBlockView({ block }: { block: GaugeChartBlock }) {
  const risk = useToolData()?.riskMetrics;
  const div = useToolData()?.diversification;
  let value = 50;
  if (block.metric === "volatility" && risk?.volatility != null) value = Math.min(100, risk.volatility);
  else if (block.metric === "diversification" && div) value = div.score;
  else if (risk?.currentDrawdown != null) value = Math.min(100, Math.abs(risk.currentDrawdown));
  return (
    <div className="gen-chart-card gen-gauge-card">
      <MiniGauge value={value} label={block.label ?? block.metric ?? "Risk"} />
    </div>
  );
}

export function ProgressRingBlockView({ block }: { block: ProgressRingBlock }) {
  return <MiniProgressRing value={block.value ?? 0} label={block.label} />;
}

export function ReturnsTableBlockView({ block: _ }: { block: ReturnsTableBlock }) {
  const data = useToolData()?.periodReturns;
  if (!data?.rows.length) return <div className="gen-placeholder-card">Returns table not loaded.</div>;
  return (
    <div className="gen-chart-card">
      <div className="gen-chart-card-head">Returns</div>
      <div className="chat-block-table-wrap">
        <table className="chat-block-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Return</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.frame}>
                <td>{r.frame}</td>
                <td>{formatPct(r.returnPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DiversificationScoreBlockView({ block: _ }: { block: DiversificationScoreBlock }) {
  const data = useToolData()?.diversification;
  if (!data) return <div className="gen-placeholder-card">Diversification score not loaded.</div>;
  return (
    <div className="gen-score-card">
      <div className="gen-score-ring-wrap">
        <MiniProgressRing value={data.score} />
      </div>
      <div className="gen-score-copy">
        <span className="gen-score-title">Diversification</span>
        <span className="gen-score-label">{data.label}</span>
        {data.topHoldingPct != null ? (
          <span className="gen-score-meta">Largest holding: {data.topHoldingPct.toFixed(1)}%</span>
        ) : null}
      </div>
    </div>
  );
}

export function RiskMeterBlockView({ block: _ }: { block: RiskMeterBlock }) {
  const risk = useToolData()?.riskMetrics;
  if (!risk) return <div className="gen-placeholder-card">Risk metrics not loaded.</div>;
  const drawdown = risk.currentDrawdown != null ? Math.min(100, Math.abs(risk.currentDrawdown)) : 30;
  return (
    <div className="gen-risk-card">
      <div className="gen-chart-card-head">Risk meter</div>
      <MiniGauge value={drawdown} label="Drawdown exposure" />
      <div className="gen-risk-stats">
        {risk.volatility != null ? <span>Volatility {formatPct(risk.volatility)}</span> : null}
        {risk.sharpe != null ? <span>Sharpe {risk.sharpe.toFixed(2)}</span> : null}
        {risk.maxDrawdown3Y != null ? <span>Max DD 3Y {formatPct(risk.maxDrawdown3Y)}</span> : null}
      </div>
    </div>
  );
}

export function RecommendationCardBlockView({ block }: { block: RecommendationCardBlock }) {
  return (
    <div className="gen-recommendation-card">
      <div className="gen-recommendation-head">
        <h4>{block.title}</h4>
        {block.confidence != null ? <span className="gen-confidence-pill">{block.confidence}% confidence</span> : null}
      </div>
      <p>{block.body}</p>
      {block.action ? <span className="gen-recommendation-action">{block.action}</span> : null}
    </div>
  );
}

export function ActionChecklistBlockView({ block }: { block: ActionChecklistBlock }) {
  if (!block.items.length) return null;
  return (
    <ul className="gen-checklist">
      {block.items.map((item) => (
        <li key={item.id} className={item.done ? "gen-check-done" : ""}>
          <span className="gen-check-box" aria-hidden />
          {item.text}
        </li>
      ))}
    </ul>
  );
}

export function ProsConsBlockView({ block }: { block: ProsConsBlock }) {
  const pros = block.pros.filter((p) => p.trim());
  const cons = block.cons.filter((c) => c.trim());
  if (!pros.length && !cons.length) return null;
  return (
    <div className="gen-pros-cons">
      <div className="gen-pros">
        <span className="gen-pc-title">Pros</span>
        <ul>{pros.map((p, i) => <li key={i}>{p}</li>)}</ul>
      </div>
      <div className="gen-cons">
        <span className="gen-pc-title">Cons</span>
        <ul>{cons.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </div>
    </div>
  );
}

export function DecisionMatrixBlockView({ block }: { block: DecisionMatrixBlock }) {
  if (!block.rows.length) return null;
  return (
    <table className="chat-block-table gen-decision-matrix">
      <thead>
        <tr>
          <th>Option</th>
          <th>Score</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {block.rows.map((r, i) => (
          <tr key={i}>
            <td>{r.option}</td>
            <td>{r.score ?? "—"}</td>
            <td>{r.note ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ScenarioComparisonBlockView({ block }: { block: ScenarioComparisonBlock }) {
  if (!block.scenarios.length) {
    return <div className="gen-placeholder-card">Scenario cards appear when stress-test data is available.</div>;
  }
  return (
    <div className="gen-scenario-grid">
      {block.scenarios.map((s, i) => (
        <div key={i} className={`gen-scenario-card gen-tone-${s.tone ?? "neutral"}`}>
          <span className="gen-scenario-name">{s.name}</span>
          <span className="gen-scenario-outcome">{s.outcome}</span>
        </div>
      ))}
    </div>
  );
}

export function ConfidenceMeterBlockView({ block }: { block: ConfidenceMeterBlock }) {
  return <MiniGauge value={block.value} label={block.label ?? "Confidence"} />;
}

export function AssumptionsBlockView({ block }: { block: AssumptionsBlock }) {
  if (!block.items.length) return null;
  return (
    <div className="gen-assumptions">
      <span className="gen-section-label">Assumptions</span>
      <ul>{block.items.map((a, i) => <li key={i}>{a}</li>)}</ul>
    </div>
  );
}

export function RisksBlockView({ block }: { block: RisksBlock }) {
  if (!block.items.length) return null;
  return (
    <div className="gen-risks">
      <span className="gen-section-label">Risks</span>
      <ul>{block.items.map((r, i) => <li key={i}>{r}</li>)}</ul>
    </div>
  );
}

export function SourcesBlockView({ block }: { block: SourcesBlock }) {
  if (!block.items.length) return null;
  return (
    <div className="gen-sources">
      <span className="gen-section-label">Sources</span>
      <ul>{block.items.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </div>
  );
}

export function FollowUpQuestionsBlockView({ block }: { block: FollowUpQuestionsBlock }) {
  if (!block.items.length) return null;
  return (
    <div className="gen-followups">
      <span className="gen-section-label">Follow-up</span>
      <div className="gen-followup-chips">
        {block.items.map((q, i) => (
          <span key={i} className="gen-followup-chip">
            {q}
          </span>
        ))}
      </div>
    </div>
  );
}
