"use client";

// Trend charts and the date bucketing behind them, shared by the Dashboard
// and the Ads tab so both draw the same cards the same way. Moved here
// unchanged from DashboardView.tsx; the dashboard renders exactly as before.

import { useId, useState } from "react";
export type TrendTone = "up" | "down" | "neutral";

export const DAY_MS = 86_400_000;

export function timestamp(value: string | null) {
  if (!value) return 0;
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export type DatedSeries = number[] & { dates?: string[] };

export function bucketSeries<T>(
  items: T[],
  generatedAtTimestamp: number,
  range: string,
  getTime: (item: T) => string | null,
  getValue: (item: T) => number = () => 1,
) {
  const buckets: DatedSeries = Array.from({ length: 8 }, () => 0);
  const eventTimes = items
    .map((item) => timestamp(getTime(item)))
    .filter((value) => value > 0);
  const fallbackEnd = generatedAtTimestamp || Math.max(...eventTimes, 0);
  if (!fallbackEnd) return buckets;

  const rangeDays = Number(range);
  const end = fallbackEnd;
  const start =
    range === "all" || !Number.isFinite(rangeDays) || rangeDays <= 0
      ? Math.min(...eventTimes, end - 30 * DAY_MS)
      : end - rangeDays * DAY_MS;
  const span = Math.max(DAY_MS, end - start);
  const formatDate = (value: number) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  buckets.dates = buckets.map((_, index) => {
    const from = formatDate(start + index * span / buckets.length);
    const to = formatDate(Math.min(end, start + (index + 1) * span / buckets.length - 1));
    return from === to ? from : `${from} – ${to}`;
  });

  items.forEach((item) => {
    const eventTimestamp = timestamp(getTime(item));
    if (!eventTimestamp || eventTimestamp < start || eventTimestamp > end) {
      return;
    }
    const bucket = Math.min(
      buckets.length - 1,
      Math.max(
        0,
        Math.floor(((eventTimestamp - start) / span) * buckets.length),
      ),
    );
    buckets[bucket] += getValue(item);
  });

  return buckets;
}

export function seriesTrend(values: number[], inverse = false): TrendTone {
  if (values.length < 2 || values.every((value) => value === 0)) {
    return "neutral";
  }

  const midpoint = Math.floor(values.length / 2);
  const previous = values
    .slice(0, midpoint)
    .reduce((sum, value) => sum + value, 0);
  const current = values
    .slice(midpoint)
    .reduce((sum, value) => sum + value, 0);

  if (current === previous) return "neutral";
  const direction: TrendTone = current > previous ? "up" : "down";
  if (!inverse) return direction;
  return direction === "up" ? "down" : "up";
}

export function ratioTrend(
  numerators: number[],
  denominators: number[],
): TrendTone {
  const midpoint = Math.floor(
    Math.min(numerators.length, denominators.length) / 2,
  );
  if (!midpoint) return "neutral";

  const sum = (values: number[], start: number, end?: number) =>
    values.slice(start, end).reduce((total, value) => total + value, 0);
  const previousDenominator = sum(denominators, 0, midpoint);
  const currentDenominator = sum(denominators, midpoint);
  if (previousDenominator <= 0 || currentDenominator <= 0) return "neutral";

  const previousRatio =
    sum(numerators, 0, midpoint) / previousDenominator;
  const currentRatio = sum(numerators, midpoint) / currentDenominator;
  if (currentRatio === previousRatio) return "neutral";
  return currentRatio > previousRatio ? "up" : "down";
}

export function trendLabel(trend: TrendTone) {
  if (trend === "up") return "Trending up";
  if (trend === "down") return "Trending down";
  return "No directional trend";
}

function sparklineGeometry(values: number[]) {
  const width = 120;
  const height = 48;
  const horizontalPadding = 2;
  const verticalPadding = 6;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => ({
    x:
      horizontalPadding +
      (index / Math.max(1, values.length - 1)) *
        (width - horizontalPadding * 2),
    y:
      height -
      verticalPadding -
      ((value - min) / range) * (height - verticalPadding * 2),
  }));

  if (!points.length) {
    return {
      line: `M ${horizontalPadding} ${height - verticalPadding} L ${width - horizontalPadding} ${height - verticalPadding}`,
      area: `M ${horizontalPadding} ${height - verticalPadding} L ${width - horizontalPadding} ${height - verticalPadding} L ${width - horizontalPadding} ${height} L ${horizontalPadding} ${height} Z`,
    };
  }

  const line = points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const controlX = (previous.x + point.x) / 2;
    return `${path} C ${controlX.toFixed(1)} ${previous.y.toFixed(1)}, ${controlX.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`);
  const first = points[0];
  const last = points.at(-1) ?? first;

  return {
    line,
    area: `${line} L ${last.x.toFixed(1)} ${height} L ${first.x.toFixed(1)} ${height} Z`,
  };
}

export function DashboardSparkline({
  values,
  trend,
  id,
  trendBasis,
}: {
  values: number[];
  trend: TrendTone;
  id: string;
  trendBasis?: string;
}) {
  const geometry = sparklineGeometry(values);
  const gradientId = `crm-dashboard-area-${id.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
  const label = `${id} sparkline. ${trendBasis ?? id}: ${trendLabel(trend)}`;
  return (
    <svg
      className={`crm-dashboard-sparkline is-trend-${trend}`}
      viewBox="0 0 120 48"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        className="crm-dashboard-sparkline-area"
        d={geometry.area}
        fill={`url(#${gradientId})`}
      />
      <path className="crm-dashboard-sparkline-line" d={geometry.line} />
    </svg>
  );
}

export function DashboardAreaChart({ values, trend, id, money }: { values: DatedSeries; trend: TrendTone; id: string; trendBasis?: string; /** Format points as dollars; defaults to the Dashboard's own Revenue and Ad spend cards. */ money?: boolean }) {
  const isMoney = money ?? (id === "Revenue" || id === "Ad spend");
  const fillId = useId();
  const [active, setActive] = useState<number | null>(null);
  const geometry = sparklineGeometry(values);
  const markerX = active === null ? 0 : 2 + active / Math.max(1, values.length - 1) * 116;
  const markerY = active === null ? 0 : 42 - values[active] / Math.max(1, ...values) * 36;
  const describe = (index: number) => `${values.dates?.[index] ?? "Date unavailable"}: ${isMoney ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(values[index]) : `${values[index]} ${id.toLowerCase()}`}`;
  return (
    <div className={`crm-dashboard-area-chart is-trend-${trend}`}>
      <svg viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".34" /><stop offset="60%" stopColor="currentColor" stopOpacity=".13" /><stop offset="100%" stopColor="currentColor" stopOpacity=".015" /></linearGradient></defs>
        <path className="crm-dashboard-area-glow" d={geometry.area} fill={`url(#${fillId})`} />
        <path className="crm-dashboard-area-fill" d={geometry.area} fill={`url(#${fillId})`} />
        <path className="crm-dashboard-area-line" d={geometry.line} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      </svg>
      {active !== null && <div className="crm-dashboard-chart-marker" style={{ left: `${markerX / 120 * 100}%` }} aria-hidden="true"><span style={{ top: `${markerY / 48 * 100}%` }} /></div>}
      <div className="crm-dashboard-chart-targets" onMouseLeave={() => setActive(null)}>
        {values.map((value, index) => <button key={index} type="button" aria-label={describe(index)} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)} />)}
      </div>
      {active !== null && <output className="crm-dashboard-chart-tooltip" style={{ left: `clamp(84px, ${markerX / 120 * 100}%, calc(100% - 84px))` }}><strong>{isMoney ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(values[active]) : `${values[active]} ${id.toLowerCase()}`}</strong><time>{values.dates?.[active] ?? "Date unavailable"}</time></output>}
    </div>
  );
}
