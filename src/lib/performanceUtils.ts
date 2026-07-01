import { Wealth } from "../theme/wealthTheme";

export type NavPoint = { date: Date; nav100: number };

export const TIME_FRAMES = ["MTD", "1M", "3M", "6M", "1Y", "3Y", "5Y", "Max"] as const;
export type TimeFrame = (typeof TIME_FRAMES)[number];

function monthsForFrame(frame: TimeFrame): number {
  if (frame === "Max" || frame === "MTD") return Number.POSITIVE_INFINITY;
  if (frame === "1M") return 1;
  if (frame === "3M") return 3;
  if (frame === "6M") return 6;
  if (frame === "1Y") return 12;
  if (frame === "3Y") return 36;
  if (frame === "5Y") return 60;
  return 12;
}

function isShortFrame(frame: TimeFrame): boolean {
  return frame === "MTD" || frame === "1M" || frame === "3M" || frame === "6M";
}

function previousMonthEndDate(ref = new Date()): Date {
  return new Date(ref.getFullYear(), ref.getMonth(), 0, 12, 0, 0, 0);
}

function sortNavPoints(points: NavPoint[]): NavPoint[] {
  return [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function resolvePerformanceWindow(points: NavPoint[], frame: TimeFrame): NavPoint[] {
  const sorted = sortNavPoints(points);
  if (!sorted.length) return [];

  if (frame === "MTD") {
    const latest = sorted[sorted.length - 1]!;
    const y = latest.date.getFullYear();
    const m = latest.date.getMonth();
    let base: NavPoint | null = null;
    for (let i = sorted.length - 2; i >= 0; i -= 1) {
      const p = sorted[i]!;
      if (p.date.getFullYear() < y || (p.date.getFullYear() === y && p.date.getMonth() < m)) {
        base = p;
        break;
      }
    }
    return base ? [base, latest] : [];
  }

  const cutoff = previousMonthEndDate().getTime();
  const clipped = sorted.filter((p) => p.date.getTime() <= cutoff);
  if (clipped.length < 2) return [];
  if (frame === "Max") return clipped;

  const months = monthsForFrame(frame);
  if (clipped.length < months + 1) return [];
  return clipped.slice(clipped.length - months - 1);
}

export function isFrameAvailable(points: NavPoint[], frame: TimeFrame): boolean {
  return resolvePerformanceWindow(points, frame).length >= 2;
}

function formatPerfDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatPerfDateRange(start: Date | null, end: Date | null): string | null {
  if (!start || !end) return null;
  return `${formatPerfDate(start)} – ${formatPerfDate(end)}`;
}

function yearsBetween(first: Date, last: Date): number {
  return (last.getTime() - first.getTime()) / (365.2425 * 86400000);
}

function computeWindowReturn(
  window: NavPoint[],
  frame: TimeFrame,
): {
  available: boolean;
  kind: "absolute" | "cagr";
  returnPct: number | null;
  indexEnd: number | null;
  startDate: Date | null;
  endDate: Date | null;
} {
  const unavailable = {
    available: false,
    kind: isShortFrame(frame) ? ("absolute" as const) : ("cagr" as const),
    returnPct: null,
    indexEnd: null,
    startDate: null,
    endDate: null,
  };

  if (window.length < 2) return unavailable;
  const first = window[0]!;
  const last = window[window.length - 1]!;
  if (first.nav100 <= 0 || last.nav100 <= 0) return unavailable;

  const indexEnd = (last.nav100 / first.nav100) * 100;
  const useCagr = !isShortFrame(frame) && (frame !== "Max" || yearsBetween(first.date, last.date) >= 1);
  const kind = useCagr ? "cagr" : "absolute";

  if (kind === "absolute") {
    return {
      available: true,
      kind,
      returnPct: indexEnd - 100,
      indexEnd,
      startDate: first.date,
      endDate: last.date,
    };
  }

  const years = yearsBetween(first.date, last.date);
  if (years <= 0) return unavailable;
  const cagr = (Math.pow(last.nav100 / first.nav100, 1 / years) - 1) * 100;
  return {
    available: true,
    kind,
    returnPct: cagr,
    indexEnd,
    startDate: first.date,
    endDate: last.date,
  };
}

export function computePeriodReturn(points: NavPoint[], frame: TimeFrame) {
  return computeWindowReturn(resolvePerformanceWindow(points, frame), frame);
}

export function formatHeroReturn(result: ReturnType<typeof computePeriodReturn>): string {
  if (!result.available || result.returnPct == null) return "NA";
  const sign = result.returnPct >= 0 ? "+" : "";
  return `${sign}${result.returnPct.toFixed(2)}%`;
}

export function returnToneColor(value: string | null, returnPct: number | null): string {
  if (value === "NA" || returnPct == null) return Wealth.textMuted;
  if (returnPct > 0) return Wealth.positive;
  if (returnPct < 0) return Wealth.negative;
  return Wealth.text;
}

export function navPointsFromSeries(
  series: { date: Date; nav100: number }[] | undefined,
): NavPoint[] {
  if (!series?.length) return [];
  return series.map((p) => ({ date: p.date, nav100: p.nav100 }));
}
