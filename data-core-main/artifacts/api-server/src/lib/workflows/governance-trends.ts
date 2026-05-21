/**
 * @file   governance-trends.ts
 * @phase  P7-D - Governance Trend APIs & Historical Analytics Surface
 *
 * Transforms internal historical analytics infrastructure into a safe,
 * read-only long-term analytics API surface.
 *
 * Architecture - pure model with no DB access:
 *
 *   Section 1 - Constants (ranges, limits, observability actions)
 *   Section 2 - Types (DTOs, envelopes, query context)
 *   Section 3 - Range parsing & validation (extended 1h-365d)
 *   Section 4 - Serializers from raw snapshots → trend DTOs
 *   Section 5 - Serializers from rollup rows → trend DTOs
 *   Section 6 - Truncation & envelope building
 *   Section 7 - Safety validators
 *
 * Safety guarantees (P7-D spec §8):
 *   • Read-only: this module contains ZERO DB writes.
 *   • Never mutates snapshots or rollup rows.
 *   • Never triggers rollup pipeline or pruning.
 *   • Never affects runtime execution tables.
 *   • All functions are pure synchronous transforms - fully injectable and testable.
 *
 * Query cascade (via selectQueryLayer from governance-rollup):
 *   ≤ 30d  → "raw"    - 5-minute resolution raw snapshots
 *   31-90d → "hourly" - 1-hour resolution rollups
 *   91-365d→ "daily"  - 1-day resolution rollups
 *
 * All four trend API surfaces (severity, error-rate, backlogs, storms) follow
 * the same consistent TrendEnvelope<T> response shape regardless of which
 * storage tier was queried.  The `sourceLayer` field on every data point and
 * on the envelope communicates the tier to the consumer.
 */

import type { StoredSnapshot } from "./governance-history";
import type { StoredRollup, QueryLayer } from "./governance-rollup";

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 - Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All supported trend range strings for the P7-D APIs.
 * Extends the P7-A raw-only ranges (1h/24h/7d/30d) with rollup-backed ranges.
 */
export const EXTENDED_TREND_RANGES = [
  "1h", "24h", "7d", "30d", "90d", "180d", "365d",
] as const;

export type ExtendedTrendRange = typeof EXTENDED_TREND_RANGES[number];

/** Set used for O(1) validation in route handlers. */
export const VALID_EXTENDED_RANGES = new Set<ExtendedTrendRange>(EXTENDED_TREND_RANGES);

/**
 * Hours represented by each extended range value.
 * Used to compute the query window (since = now - hours).
 */
export const EXTENDED_RANGE_HOURS: Record<ExtendedTrendRange, number> = {
  "1h":   1,
  "24h":  24,
  "7d":   7   * 24,   //  168h
  "30d":  30  * 24,   //  720h
  "90d":  90  * 24,   // 2160h
  "180d": 180 * 24,   // 4320h
  "365d": 365 * 24,   // 8760h
};

/**
 * Maximum number of trend data points returned in a single API response.
 * When the query returns more, the response is truncated and `truncated=true`
 * is set on the envelope.
 *
 * Rationale: at 5-min intervals, a 30d raw query returns 8,640 points.
 * 1,000 is enough for chart rendering and avoids payload bloat.
 */
export const MAX_TREND_POINTS = 1000;

/**
 * Maximum allowed range in days.
 * Requests beyond this are rejected with 400.
 */
export const MAX_TREND_RANGE_DAYS = 365;

/** The four trend surface types exposed by the P7-D API. */
export type TrendType = "severity" | "error-rate" | "backlogs" | "storms";

/** Observability action constants for P7-D events. */
export const TREND_ACTION_REQUESTED  = "governance_trend_api_requested"  as const;
export const TREND_ACTION_RESOLVED   = "governance_trend_api_resolved"   as const;
export const TREND_ACTION_REJECTED   = "governance_trend_query_rejected" as const;
export const TREND_ACTION_TRUNCATED  = "governance_trend_payload_truncated" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 - Types (DTOs & envelopes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single severity data point on the governance health timeline.
 *
 * For raw tier:    one point per captured snapshot (5-min cadence)
 * For hourly tier: one point per clock-hour (dominant severity of that hour)
 * For daily tier:  one point per UTC day (dominant severity of that day)
 */
export interface SeverityTrendPoint {
  timestamp:   string;    // ISO 8601 - capturedAt (raw) or bucketStart (rollup)
  severity:    string;    // "healthy" | "warning" | "degraded" | "critical"
  sourceLayer: QueryLayer;
}

/**
 * A single numeric data point on a continuous metric timeline.
 *
 * Used by the error-rate trend (workflowErrorRate for raw, avgErrorRate for rollup).
 */
export interface NumericTrendPoint {
  timestamp:   string;    // ISO 8601
  value:       number;    // 0-1 for error rate
  sourceLayer: QueryLayer;
}

/**
 * A single backlog data point combining all queue dimensions.
 *
 * For raw tier:    approvalBacklogCount, delayBacklogCount, stuckCount (exact integers)
 * For rollup tier: avgApprovalBacklog, avgDelayBacklog, avgStuckCount (float averages)
 */
export interface BacklogTrendPoint {
  timestamp:      string;  // ISO 8601
  approvalBacklog: number;
  delayBacklog:    number;
  stuckCount:      number;
  sourceLayer:     QueryLayer;
}

/**
 * A single storm activity data point.
 *
 * stormFrequency:
 *   Raw tier    - binary (0.0 or 1.0): was there a storm at this snapshot?
 *   Rollup tier - fraction [0.0-1.0]: what fraction of the period had storms?
 * dominantSeverity:
 *   Raw tier    - the snapshot's overall severity
 *   Rollup tier - the rollup's dominantSeverity (worst severity in the period)
 */
export interface StormTrendPoint {
  timestamp:        string;   // ISO 8601
  stormFrequency:   number;   // 0.0-1.0
  dominantSeverity: string;   // "healthy" | "warning" | "degraded" | "critical"
  sourceLayer:      QueryLayer;
}

/**
 * Pagination-ready response envelope for all four trend API surfaces.
 *
 * T is the concrete point type (SeverityTrendPoint, NumericTrendPoint, etc.)
 *
 * The envelope is consistent regardless of which storage tier served the data.
 * Consumers should inspect `sourceLayer` to understand point resolution.
 */
export interface TrendEnvelope<T> {
  range:       string;      // e.g. "30d"
  rangeDays:   number;      // numeric days in the query window
  sourceLayer: QueryLayer;  // which tier was queried
  pointCount:  number;      // actual points returned (≤ MAX_TREND_POINTS)
  truncated:   boolean;     // true if original result exceeded MAX_TREND_POINTS
  points:      T[];
}

/**
 * Computed query context derived from a validated range string.
 * Immutable once computed; passed through to serializers and envelope builders.
 */
export interface TrendQueryContext {
  range:     ExtendedTrendRange;
  rangeDays: number;
  hours:     number;
  since:     Date;
  until:     Date;
  layer:     QueryLayer;
}

/**
 * Result of range validation (discriminated union for exhaustive handling).
 */
export type TrendRangeValidation =
  | { ok: true;  context: TrendQueryContext }
  | { ok: false; reason: string; statusCode: 400 | 422 };

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 - Range parsing & validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine which storage query tier to use for a given number of days.
 *
 * Mirrors selectQueryLayer() from governance-rollup.ts as a pure inline
 * computation - avoids a cross-module import in the pure model layer.
 *
 * PURE - deterministic.
 */
export function selectTrendQueryLayer(rangeDays: number): QueryLayer {
  if (rangeDays <= 30)  return "raw";
  if (rangeDays <= 90)  return "hourly";
  return "daily";
}

/**
 * Validate a raw `range` query parameter and compute the full query context.
 *
 * Validation rules:
 *   1. Must be one of the EXTENDED_TREND_RANGES literals.
 *   2. The computed window must not exceed MAX_TREND_RANGE_DAYS (365).
 *   3. `since` must be strictly before `until` (now).
 *
 * Future-window rejection is enforced by using `until = now` always.
 * This means `since` is always in the past when the range is valid.
 *
 * PURE - injectable `now` for deterministic testing.
 */
export function validateTrendRange(
  rawRange: string,
  now:      Date = new Date(),
): TrendRangeValidation {
  if (!VALID_EXTENDED_RANGES.has(rawRange as ExtendedTrendRange)) {
    return {
      ok:         false,
      reason:     `Invalid range "${rawRange}". Must be one of: ${EXTENDED_TREND_RANGES.join(" | ")}`,
      statusCode: 400,
    };
  }

  const range    = rawRange as ExtendedTrendRange;
  const hours    = EXTENDED_RANGE_HOURS[range];
  const rangeDays = hours / 24;

  if (rangeDays > MAX_TREND_RANGE_DAYS) {
    return {
      ok:         false,
      reason:     `Range "${range}" exceeds maximum allowed window of ${MAX_TREND_RANGE_DAYS} days`,
      statusCode: 400,
    };
  }

  const until = new Date(now);
  const since = new Date(now.getTime() - hours * 3_600_000);
  const layer = selectTrendQueryLayer(rangeDays);

  return {
    ok:      true,
    context: { range, rangeDays, hours, since, until, layer },
  };
}

/**
 * Extract the rangeDays from a validated ExtendedTrendRange string.
 * Returns null for unknown values (validated inputs always return a number).
 *
 * PURE - deterministic.
 */
export function trendRangeToDays(range: ExtendedTrendRange): number {
  return EXTENDED_RANGE_HOURS[range] / 24;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 - Serializers from raw snapshots → trend DTOs
// ─────────────────────────────────────────────────────────────────────────────
//
// All serializers in this section are PURE - they take StoredSnapshot[] and
// return a DTO array.  No DB access.  Order is preserved from the input
// (callers must pass snapshots in capturedAt ASC order for determinism).
//

/**
 * Serialize raw snapshots into SeverityTrendPoint[].
 *
 * timestamp = snapshot.capturedAt ISO 8601
 * severity  = snapshot.severity
 *
 * PURE - deterministic.
 */
export function serializeSeverityFromSnapshots(
  snapshots:   StoredSnapshot[],
  layer:       QueryLayer = "raw",
): SeverityTrendPoint[] {
  return snapshots.map(s => ({
    timestamp:   s.capturedAt.toISOString(),
    severity:    s.severity,
    sourceLayer: layer,
  }));
}

/**
 * Serialize raw snapshots into NumericTrendPoint[] (error-rate surface).
 *
 * value = snapshot.metricsSnapshot.workflowErrorRate (0-1)
 *
 * PURE - deterministic.
 */
export function serializeErrorRateFromSnapshots(
  snapshots: StoredSnapshot[],
  layer:     QueryLayer = "raw",
): NumericTrendPoint[] {
  return snapshots.map(s => ({
    timestamp:   s.capturedAt.toISOString(),
    value:       s.metricsSnapshot.workflowErrorRate,
    sourceLayer: layer,
  }));
}

/**
 * Serialize raw snapshots into BacklogTrendPoint[].
 *
 * approvalBacklog = snapshot.metricsSnapshot.approvalBacklogCount
 * delayBacklog    = snapshot.metricsSnapshot.delayBacklogCount
 * stuckCount      = snapshot.stuckCount  (top-level column - exact integer)
 *
 * PURE - deterministic.
 */
export function serializeBacklogsFromSnapshots(
  snapshots: StoredSnapshot[],
  layer:     QueryLayer = "raw",
): BacklogTrendPoint[] {
  return snapshots.map(s => ({
    timestamp:       s.capturedAt.toISOString(),
    approvalBacklog: s.metricsSnapshot.approvalBacklogCount,
    delayBacklog:    s.metricsSnapshot.delayBacklogCount,
    stuckCount:      s.stuckCount,
    sourceLayer:     layer,
  }));
}

/**
 * Serialize raw snapshots into StormTrendPoint[].
 *
 * stormFrequency:
 *   Binary - 1.0 if stormSeverity !== "none", 0.0 otherwise.
 *   (Per-snapshot binary signal; rollup tiers provide fractional frequency.)
 *
 * dominantSeverity = snapshot.severity (overall workspace health at capture time)
 *
 * PURE - deterministic.
 */
export function serializeStormsFromSnapshots(
  snapshots: StoredSnapshot[],
  layer:     QueryLayer = "raw",
): StormTrendPoint[] {
  return snapshots.map(s => ({
    timestamp:        s.capturedAt.toISOString(),
    stormFrequency:   s.stormSeverity !== "none" ? 1.0 : 0.0,
    dominantSeverity: s.severity,
    sourceLayer:      layer,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 - Serializers from rollup rows → trend DTOs
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors Section 4 for the rollup storage tier.  timestamp uses bucketStart
// (inclusive start of the aggregated time bucket) so chart consumers can
// align data points with their time axes.
//

/**
 * Serialize rollup rows into SeverityTrendPoint[].
 *
 * timestamp = rollup.bucketStart ISO 8601
 * severity  = rollup.dominantSeverity (worst severity in the bucket)
 *
 * PURE - deterministic.
 */
export function serializeSeverityFromRollups(
  rollups: StoredRollup[],
  layer:   QueryLayer,
): SeverityTrendPoint[] {
  return rollups.map(r => ({
    timestamp:   r.bucketStart.toISOString(),
    severity:    r.dominantSeverity,
    sourceLayer: layer,
  }));
}

/**
 * Serialize rollup rows into NumericTrendPoint[] (error-rate surface).
 *
 * value = rollup.avgErrorRate (mean of workflowErrorRate within the bucket)
 *
 * PURE - deterministic.
 */
export function serializeErrorRateFromRollups(
  rollups: StoredRollup[],
  layer:   QueryLayer,
): NumericTrendPoint[] {
  return rollups.map(r => ({
    timestamp:   r.bucketStart.toISOString(),
    value:       r.avgErrorRate,
    sourceLayer: layer,
  }));
}

/**
 * Serialize rollup rows into BacklogTrendPoint[].
 *
 * approvalBacklog = rollup.avgApprovalBacklog (float average within the bucket)
 * delayBacklog    = rollup.avgDelayBacklog
 * stuckCount      = rollup.avgStuckCount
 *
 * Note: these are floating-point averages (not integer counts) for rollup tiers.
 * The sourceLayer field signals this to consumers.
 *
 * PURE - deterministic.
 */
export function serializeBacklogsFromRollups(
  rollups: StoredRollup[],
  layer:   QueryLayer,
): BacklogTrendPoint[] {
  return rollups.map(r => ({
    timestamp:       r.bucketStart.toISOString(),
    approvalBacklog: r.avgApprovalBacklog,
    delayBacklog:    r.avgDelayBacklog,
    stuckCount:      r.avgStuckCount,
    sourceLayer:     layer,
  }));
}

/**
 * Serialize rollup rows into StormTrendPoint[].
 *
 * stormFrequency   = rollup.stormFrequency (fraction of the bucket with storms)
 * dominantSeverity = rollup.dominantSeverity
 *
 * PURE - deterministic.
 */
export function serializeStormsFromRollups(
  rollups: StoredRollup[],
  layer:   QueryLayer,
): StormTrendPoint[] {
  return rollups.map(r => ({
    timestamp:        r.bucketStart.toISOString(),
    stormFrequency:   r.stormFrequency,
    dominantSeverity: r.dominantSeverity,
    sourceLayer:      layer,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 - Truncation & envelope building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply the MAX_TREND_POINTS safety cap to a sorted point array.
 *
 * Returns the first `max` points (oldest → newest, matching query order).
 * Sets `truncated = true` when the input exceeded the cap.
 *
 * PURE - deterministic.
 */
export function truncateTrendPoints<T>(
  points: T[],
  max:    number = MAX_TREND_POINTS,
): { points: T[]; truncated: boolean } {
  if (points.length <= max) {
    return { points, truncated: false };
  }
  return { points: points.slice(0, max), truncated: true };
}

/**
 * Wrap truncated trend points in the standard TrendEnvelope<T>.
 *
 * All four trend API surfaces return this envelope shape.
 *
 * PURE - deterministic.
 */
export function buildTrendEnvelope<T>(
  ctx:       TrendQueryContext,
  points:    T[],
  truncated: boolean,
): TrendEnvelope<T> {
  return {
    range:       ctx.range,
    rangeDays:   ctx.rangeDays,
    sourceLayer: ctx.layer,
    pointCount:  points.length,
    truncated,
    points,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 - Safety validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a query window is entirely in the future.
 *
 * This should never happen through normal usage (since = now - hours)
 * but provides an explicit guard against clock-skew edge cases.
 *
 * PURE - deterministic.
 */
export function isFutureWindow(since: Date, now: Date = new Date()): boolean {
  return since.getTime() >= now.getTime();
}

/**
 * Check whether a range in days exceeds the platform maximum.
 *
 * PURE - deterministic.
 */
export function isRangeTooLarge(rangeDays: number, max: number = MAX_TREND_RANGE_DAYS): boolean {
  return rangeDays > max;
}

/**
 * Guard against absurd point density in raw tier queries.
 *
 * At 5-min capture intervals, a 30-day raw window yields 8,640 points.
 * MAX_TREND_POINTS = 1,000 caps the response; this function checks whether
 * the raw point count exceeds the cap (used for logging only).
 *
 * PURE - deterministic.
 */
export function willTruncate(rawCount: number, max: number = MAX_TREND_POINTS): boolean {
  return rawCount > max;
}

/**
 * Return the effective query layer description for logging.
 * Used to build consistent observability log fields.
 *
 * PURE - deterministic.
 */
export function trendLayerLabel(layer: QueryLayer): string {
  switch (layer) {
    case "raw":    return "raw_snapshots";
    case "hourly": return "hourly_rollups";
    case "daily":  return "daily_rollups";
  }
}
