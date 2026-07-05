import { Wealth } from "../../../theme/wealthTheme";

export type ChartPoint = { date: string; value: number };

const W = 320;
const H = 120;
const PAD = 8;

function scaleSeries(points: ChartPoint[]): { x: number; y: number }[] {
  if (!points.length) return [];
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  return points.map((p, i) => ({
    x: PAD + (i / Math.max(points.length - 1, 1)) * (W - PAD * 2),
    y: PAD + (1 - (p.value - min) / span) * (H - PAD * 2),
  }));
}

export function MiniLineChart({ points, color = Wealth.chartPortfolio }: { points: ChartPoint[]; color?: string }) {
  const scaled = scaleSeries(points);
  if (scaled.length < 2) {
    return <div className="gen-chart-empty">Not enough data for chart</div>;
  }
  const d = scaled.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${d} L${scaled[scaled.length - 1]!.x.toFixed(1)},${H - PAD} L${scaled[0]!.x.toFixed(1)},${H - PAD} Z`;
  return (
    <svg className="gen-line-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart">
      <path className="gen-line-area" d={area} fill={color} fillOpacity={0.12} />
      <path className="gen-line-path" d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export type PieSlice = { label: string; value: number; color: string };

export function MiniPieChart({ slices }: { slices: PieSlice[] }) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  let angle = -90;
  const cx = 60;
  const cy = 60;
  const r = 48;
  const paths = slices.map((slice) => {
    const sweep = (slice.value / total) * 360;
    const start = angle;
    angle += sweep;
    const x1 = cx + r * Math.cos((start * Math.PI) / 180);
    const y1 = cy + r * Math.sin((start * Math.PI) / 180);
    const x2 = cx + r * Math.cos((angle * Math.PI) / 180);
    const y2 = cy + r * Math.sin((angle * Math.PI) / 180);
    const large = sweep > 180 ? 1 : 0;
    return (
      <path
        key={slice.label}
        d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`}
        fill={slice.color}
      />
    );
  });
  return (
    <div className="gen-pie-wrap">
      <svg className="gen-pie-chart" viewBox="0 0 120 120" role="img" aria-label="Pie chart">
        {paths}
      </svg>
      <div className="gen-pie-legend">
        {slices.map((s) => (
          <div key={s.label} className="gen-pie-legend-row">
            <span className="gen-pie-dot" style={{ background: s.color }} />
            <span>{s.label}</span>
            <span className="gen-pie-pct">{((s.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type BarItem = { label: string; value: number; color?: string };

export function MiniBarChart({ items, format = (n: number) => `${n.toFixed(1)}%` }: { items: BarItem[]; format?: (n: number) => string }) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div className="gen-bar-chart">
      {items.map((item) => (
        <div key={item.label} className="gen-bar-row">
          <span className="gen-bar-label">{item.label}</span>
          <div className="gen-bar-track">
            <span
              className="gen-bar-fill"
              style={{
                width: `${(Math.abs(item.value) / max) * 100}%`,
                background: item.color ?? Wealth.chartPortfolio,
              }}
            />
          </div>
          <span className="gen-bar-value">{format(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function MiniGauge({ value, max = 100, label }: { value: number; max?: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const angle = -90 + (pct / 100) * 180;
  const cx = 70;
  const cy = 70;
  const r = 52;
  const x = cx + r * Math.cos((angle * Math.PI) / 180);
  const y = cy + r * Math.sin((angle * Math.PI) / 180);
  const color = pct > 66 ? Wealth.negative : pct > 33 ? "#f59e0b" : Wealth.positive;
  return (
    <div className="gen-gauge">
      <svg viewBox="0 0 140 90" className="gen-gauge-svg" role="img" aria-label={label ?? "Gauge"}>
        <path d="M18,70 A52,52 0 0,1 122,70" fill="none" stroke="#e5e7eb" strokeWidth={10} strokeLinecap="round" />
        <path
          d={`M18,70 A52,52 0 ${pct > 50 ? 1 : 0},1 ${x},${y}`}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
        />
      </svg>
      <div className="gen-gauge-value" style={{ color }}>
        {Math.round(pct)}
      </div>
      {label ? <div className="gen-gauge-label">{label}</div> : null}
    </div>
  );
}

export function MiniProgressRing({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="gen-progress-ring">
      <svg viewBox="0 0 88 88" className="gen-ring-svg" role="img" aria-label={label ?? "Progress"}>
        <circle cx={44} cy={44} r={r} fill="none" stroke="#e5e7eb" strokeWidth={8} />
        <circle
          cx={44}
          cy={44}
          r={r}
          fill="none"
          stroke={Wealth.orange}
          strokeWidth={8}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
        />
        <text x={44} y={48} textAnchor="middle" className="gen-ring-text">
          {Math.round(pct)}%
        </text>
      </svg>
      {label ? <span className="gen-ring-label">{label}</span> : null}
    </div>
  );
}
