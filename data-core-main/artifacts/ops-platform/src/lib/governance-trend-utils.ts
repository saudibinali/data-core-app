/**
 * @file   lib/governance-trend-utils.ts
 * @phase  P7-E - Historical Analytics Dashboard & Trend Visualization Foundations
 *
 * Pure utility functions for the historical analytics dashboard.
 * No React imports - safe to test in a Node environment.
 *
 * ── SAFETY INVARIANTS ─────────────────────────────────────────────────────────
 *   READ-ONLY: no mutations, no side effects, no API calls.
 *   All functions are pure and deterministic.
 *
 * ── EXPORTED TYPES ────────────────────────────────────────────────────────────
 *   TrendRange           - the 7 selectable time ranges
 *   HistoricalEventAction - observability action strings for P7-E
 *   HistoricalObservabilityEvent - structured event payload
 *   ErrorRateSummary     - average + trend direction
 *   PeakBacklog          - timestamp + total depth of worst backlog point
 *   StormPeriod          - timestamp + frequency for heavy storm points
 *   SeverityDistribution - count of each severity across points
 */

// ── Time range values ──────────────────────────────────────────────────────────

export const TREND_RANGES = ["1h", "24h", "7d", "30d", "90d", "180d", "365d"] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

// ── Severity → Recharts hex color ─────────────────────────────────────────────
//
// These hex colors mirror the Tailwind palette so Recharts SVG paths stay
// consistent with the rest of the UI even though Recharts cannot read Tailwind
// class names directly.

export const SEVERITY_HEX: Record<string, string> = {
  critical: "#ef4444",  // red-500
  degraded: "#f97316",  // orange-500
  warning:  "#eab308",  // yellow-500
  healthy:  "#22c55e",  // green-500
} as const;

export function severityHex(severity: string): string {
  return SEVERITY_HEX[severity] ?? "#94a3b8"; // slate-400 fallback
}

// ── Severity → numeric (for BarChart Y axis) ──────────────────────────────────
//
// healthy=0, warning=1, degraded=2, critical=3

export const SEVERITY_NUMERIC: Record<string, number> = {
  healthy:  0,
  warning:  1,
  degraded: 2,
  critical: 3,
} as const;

export function severityToNumeric(severity: string): number {
  return SEVERITY_NUMERIC[severity] ?? 0;
}

// ── Severity distribution (count per level) ───────────────────────────────────

export interface SeverityDistribution {
  critical: number;
  degraded: number;
  warning:  number;
  healthy:  number;
}

export function countSeverityDistribution(
  points: ReadonlyArray<{ severity: string }>,
): SeverityDistribution {
  const counts: SeverityDistribution = { critical: 0, degraded: 0, warning: 0, healthy: 0 };
  for (const p of points) {
    const s = p.severity as keyof SeverityDistribution;
    if (s in counts) counts[s]++;
  }
  return counts;
}

// ── Dominant historical severity (worst seen across all points) ────────────────

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  degraded: 1,
  warning:  2,
  healthy:  3,
};

export function dominantHistoricalSeverity(
  points: ReadonlyArray<{ severity: string }>,
): string {
  if (points.length === 0) return "healthy";
  return points.reduce((worst, p) => {
    const w = SEVERITY_RANK[worst] ?? 99;
    const c = SEVERITY_RANK[p.severity] ?? 99;
    return c < w ? p.severity : worst;
  }, "healthy");
}

export function isAllHealthy(points: ReadonlyArray<{ severity: string }>): boolean {
  return points.length > 0 && points.every(p => p.severity === "healthy");
}

// ── Error rate summary (average + trend direction) ────────────────────────────

export interface ErrorRateSummary {
  average:   number;
  direction: "rising" | "falling" | "stable";
}

/**
 * Compute average error rate and whether it is trending up, down, or flat.
 * Trend is determined by comparing the mean of the first half vs the second half.
 * A delta of < 0.005 (0.5 pp) is treated as stable.
 * PURE.
 */
export function summarizeErrorRate(
  points: ReadonlyArray<{ value: number }>,
): ErrorRateSummary {
  if (points.length === 0) return { average: 0, direction: "stable" };

  const avg = points.reduce((s, p) => s + p.value, 0) / points.length;

  if (points.length < 2) return { average: avg, direction: "stable" };

  const mid       = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, mid);
  const secondHalf = points.slice(mid);

  const firstAvg  = firstHalf.reduce((s, p)  => s + p.value, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, p) => s + p.value, 0) / secondHalf.length;

  const delta = secondAvg - firstAvg;
  if (Math.abs(delta) < 0.005) return { average: avg, direction: "stable" };
  return { average: avg, direction: delta > 0 ? "rising" : "falling" };
}

// ── Backlog pressure - peak period finder ─────────────────────────────────────

export interface PeakBacklog {
  timestamp:    string;
  totalBacklog: number;
}

export function peakBacklogPeriod(
  points: ReadonlyArray<{
    timestamp:      string;
    approvalBacklog: number;
    delayBacklog:   number;
    stuckCount:     number;
  }>,
): PeakBacklog | null {
  if (points.length === 0) return null;

  let peak: PeakBacklog = { timestamp: points[0]!.timestamp, totalBacklog: 0 };
  for (const p of points) {
    const total = p.approvalBacklog + p.delayBacklog + p.stuckCount;
    if (total > peak.totalBacklog) {
      peak = { timestamp: p.timestamp, totalBacklog: total };
    }
  }
  return peak;
}

// ── Storm activity - heavy period detection ───────────────────────────────────

export interface StormPeriod {
  timestamp:     string;
  stormFrequency: number;
}

export const STORM_HEAVY_THRESHOLD = 0.5;

export function stormHeavyPeriods(
  points:    ReadonlyArray<{ timestamp: string; stormFrequency: number }>,
  threshold: number = STORM_HEAVY_THRESHOLD,
): StormPeriod[] {
  return points
    .filter(p => p.stormFrequency > threshold)
    .map(p => ({ timestamp: p.timestamp, stormFrequency: p.stormFrequency }));
}

// ── Truncation detection across any combination of envelopes ─────────────────

export function isTrendDataTruncated(
  ...envelopes: Array<{ truncated?: boolean } | null | undefined>
): boolean {
  return envelopes.some(e => e?.truncated === true);
}

// ── Source layer label ────────────────────────────────────────────────────────

export function sourceLayerLabel(layer: string): string {
  switch (layer) {
    case "raw":    return "5-min snapshots";
    case "hourly": return "Hourly averages";
    case "daily":  return "Daily averages";
    default:       return layer;
  }
}

// ── Timestamp formatting for chart axis labels ────────────────────────────────
//
// Returns a compact label appropriate for the selected range.
// PURE - uses the Date API only (no external libraries).

export function formatTimestampForRange(timestamp: string, range: TrendRange): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return timestamp;

  switch (range) {
    case "1h":
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    case "24h":
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    case "7d":
      return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    case "30d":
    case "90d":
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    case "180d":
    case "365d":
      return d.toLocaleDateString([], { month: "short", year: "2-digit" });
    default:
      return d.toLocaleDateString();
  }
}

// ── Full timestamp for tooltips ───────────────────────────────────────────────

export function formatTimestampFull(timestamp: string): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return timestamp;
  return d.toLocaleString([], {
    year:   "numeric",
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ── Observability event types ─────────────────────────────────────────────────

export type HistoricalEventAction =
  | "historical_dashboard_loaded"
  | "historical_dashboard_range_changed"
  | "historical_chart_rendered"
  | "historical_truncation_warning_shown";

export interface HistoricalObservabilityEvent {
  action:        HistoricalEventAction;
  selectedRange: string;
  sourceLayer:   string;
  chartType:     string;
  truncated:     boolean;
}

/**
 * Construct a historical analytics dashboard observability event.
 * PURE - no side effects. The caller is responsible for emitting it.
 */
export function buildHistoricalEvent(
  action:        HistoricalEventAction,
  selectedRange: string,
  sourceLayer:   string,
  chartType:     string,
  truncated:     boolean,
): HistoricalObservabilityEvent {
  return { action, selectedRange, sourceLayer, chartType, truncated };
}

// ── Error rate formatting (re-export-friendly helper) ─────────────────────────

export function formatErrorRatePct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// ── Storm frequency label ─────────────────────────────────────────────────────

export function formatStormFrequency(freq: number): string {
  return `${(freq * 100).toFixed(0)}%`;
}
