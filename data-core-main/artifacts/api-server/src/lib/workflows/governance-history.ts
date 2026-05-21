/**
 * @file   governance-history.ts
 * @phase  P7-A - Historical Governance Snapshots & Trend Infrastructure
 *
 * Converts point-in-time governance visibility into historical operational
 * intelligence via append-only snapshot persistence, trend extraction, and
 * alert frequency analysis.
 *
 * Architecture - three layers:
 *
 *   Layer 1 - Pure model functions (synchronous, no I/O):
 *     • Snapshot serialization helpers
 *     • Trend extraction (severity history, error rate, backlogs, stuck counts)
 *     • Alert frequency intelligence (chronic alert detection)
 *     • Retention statistics and recommendations
 *     • Time-range utilities
 *
 *   Layer 2 - DB query functions (async, READ-ONLY):
 *     • querySnapshotsByRange()
 *     • queryLatestSnapshot()
 *     • querySnapshotCount()
 *
 *   Layer 3 - Snapshot capture pipeline (async, APPEND-ONLY write):
 *     • insertGovernanceSnapshot()  - single INSERT, never UPDATE
 *     • captureGovernanceSnapshot() - evaluate + persist + emit observability
 *
 * Safety invariants:
 *   • No UPDATE or DELETE of any governance_snapshots row.
 *   • Pure model functions have zero I/O.
 *   • All functions that accept a `now` parameter are injectable for testing.
 *   • Snapshot capture does not mutate any workflow execution runtime state.
 */

import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db as defaultDb, governanceSnapshotsTable } from "@workspace/db";
import { logger } from "../logger";
import {
  evaluateTenantHealth,
  type GovernanceAlert,
  type OperationalMetricsSnapshot,
  type TenantHealthIndicators,
  type TenantHealthSummary,
} from "./governance";

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 - Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Supported time ranges for trend queries. */
export type TrendRange = "1h" | "24h" | "7d" | "30d";

/** Hours represented by each TrendRange value. */
export const TREND_RANGE_HOURS: Record<TrendRange, number> = {
  "1h":  1,
  "24h": 24,
  "7d":  7  * 24,  // 168
  "30d": 30 * 24,  // 720
};

/**
 * A workspace exhibiting a GOV-* alert in more than this percentage of
 * snapshots within the query window is classified as "chronically" afflicted.
 */
export const CHRONIC_THRESHOLD_PCT = 50;

/** Recommended governance snapshot capture interval. */
export const RECOMMENDED_CAPTURE_INTERVAL_MINUTES = 5;

/**
 * Recommended retention periods (days) for each granularity tier.
 *
 * Raw      - full 5-min resolution, kept for fast recent-history queries.
 * Hourly   - one row per hour (future rollup), for medium-term trend charts.
 * Daily    - one row per day (future rollup), for long-term health history.
 *
 * Pruning at these tiers is NOT implemented in P7-A.
 */
export const RECOMMENDED_RETENTION_RAW_DAYS     = 30;
export const RECOMMENDED_RETENTION_HOURLY_DAYS  = 90;
export const RECOMMENDED_RETENTION_DAILY_DAYS   = 365;

/** Observability action constants for P7-A events. */
export const GOVERNANCE_ACTION_SNAPSHOT_CAPTURED       = "governance_snapshot_captured"        as const;
export const GOVERNANCE_ACTION_SNAPSHOT_CAPTURE_FAILED = "governance_snapshot_capture_failed"  as const;
export const GOVERNANCE_ACTION_TREND_QUERY_REQUESTED   = "governance_trend_query_requested"    as const;
export const GOVERNANCE_ACTION_CHRONIC_ALERT_DETECTED  = "governance_chronic_alert_detected"   as const;

/** Schema version written into every new snapshot row. Increment on breaking JSONB changes. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 - Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialized subset of OperationalMetricsSnapshot stored in the JSONB column.
 * Excludes derived/computed fields (workspaceId, capturedAt) that are already
 * stored as first-class columns on the snapshot row.
 */
export interface SnapshotMetrics {
  activeExecutions:           number;
  waitingApprovalCount:       number;
  waitingDelayCount:          number;
  completedExecutions:        number;
  failedExecutions:           number;
  timedOutExecutions:         number;
  cancelledExecutions:        number;
  approvalBacklogCount:       number;
  delayBacklogCount:          number;
  workflowErrorRate:          number;
  averageExecutionDurationMs: number;
}

/**
 * Per-dimension severity indicators serialized into the snapshot.
 * String values: "healthy" | "warning" | "degraded" | "critical" | "none"
 */
export interface SnapshotIndicators {
  executionPressure:  string;
  errorConcentration: string;
  approvalPressure:   string;
  delayPressure:      string;
  stormPressure:      string;
}

/** Alert count breakdown at capture time. */
export interface SnapshotAlertSummary {
  total:    number;
  critical: number;
  warning:  number;
  info:     number;
}

/** A fully hydrated governance snapshot row as returned from the DB. */
export interface StoredSnapshot {
  id:              number;
  workspaceId:     number;
  capturedAt:      Date;
  severity:        string;
  metricsSnapshot: SnapshotMetrics;
  indicators:      SnapshotIndicators;
  alertCodes:      string[];
  alertSummary:    SnapshotAlertSummary;
  stuckCount:      number;
  stormSeverity:   string;
  schemaVersion:   number;
}

/** A {capturedAt, severity} data point for severity history charts. */
export interface SeverityDataPoint {
  capturedAt: string;  // ISO 8601
  severity:   string;
}

/** A {capturedAt, value} data point for numeric trend series. */
export interface NumberDataPoint {
  capturedAt: string;  // ISO 8601
  value:      number;
}

/** Alert frequency entry - one per distinct GOV-* code found in the snapshots. */
export interface AlertFrequencyEntry {
  code:           string;
  count:          number;
  totalSnapshots: number;
  /** Percentage of snapshots that contain this code (0-100, two decimal places). */
  frequencyPct:   number;
  firstSeenAt:    string;  // ISO 8601
  lastSeenAt:     string;  // ISO 8601
  isChronic:      boolean; // frequencyPct >= CHRONIC_THRESHOLD_PCT
}

/** Statistical summary of a workspace's stored snapshots. */
export interface RetentionStats {
  snapshotCount:    number;
  oldestCapturedAt: string | null;  // ISO 8601
  newestCapturedAt: string | null;  // ISO 8601
  spanHours:        number;
  /** Average ms between consecutive snapshots. null when < 2 snapshots. */
  avgIntervalMs:    number | null;
}

/** Retention policy recommendation (static, not workspace-specific). */
export interface RetentionRecommendation {
  captureIntervalMinutes:  number;
  keepRawDays:             number;
  keepHourlyDays:          number;
  keepDailyDays:           number;
  /** Estimated raw row count for a workspace at recommended capture interval × keepRawDays. */
  estimatedRawRowsAt30d:   number;
}

/** Result returned by captureGovernanceSnapshot(). */
export interface CaptureResult {
  snapshotId:    number;
  workspaceId:   number;
  capturedAt:    string;  // ISO 8601
  severity:      string;
  stuckCount:    number;
  stormSeverity: string;
  alertCodes:    string[];
}

/** Payload passed to insertGovernanceSnapshot() (all DB columns except id). */
export interface SnapshotInsertPayload {
  workspaceId:     number;
  capturedAt:      Date;
  severity:        string;
  metricsSnapshot: SnapshotMetrics;
  indicators:      SnapshotIndicators;
  alertCodes:      string[];
  alertSummary:    SnapshotAlertSummary;
  stuckCount:      number;
  stormSeverity:   string;
  schemaVersion:   number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 - Pure serialization helpers (no I/O)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the storable metrics subset from an OperationalMetricsSnapshot.
 * Drops workspaceId, capturedAt, and estimatedNotificationFanout - those
 * live as first-class columns or are derivable from the workspace context.
 *
 * PURE - deterministic, no side effects.
 */
export function serializeSnapshotMetrics(
  metrics: OperationalMetricsSnapshot,
): SnapshotMetrics {
  return {
    activeExecutions:           metrics.activeExecutions,
    waitingApprovalCount:       metrics.waitingApprovalCount,
    waitingDelayCount:          metrics.waitingDelayCount,
    completedExecutions:        metrics.completedExecutions,
    failedExecutions:           metrics.failedExecutions,
    timedOutExecutions:         metrics.timedOutExecutions,
    cancelledExecutions:        metrics.cancelledExecutions,
    approvalBacklogCount:       metrics.approvalBacklogCount,
    delayBacklogCount:          metrics.delayBacklogCount,
    workflowErrorRate:          metrics.workflowErrorRate,
    averageExecutionDurationMs: metrics.averageExecutionDurationMs,
  };
}

/**
 * Extract the storable indicators subset from TenantHealthIndicators.
 * Converts typed severity values to plain strings for JSONB storage.
 * Field names in the snapshot match the governance engine's indicator keys.
 *
 * PURE - deterministic, no side effects.
 */
export function serializeSnapshotIndicators(
  indicators: TenantHealthIndicators,
): SnapshotIndicators {
  return {
    executionPressure:  indicators.executionPressure,
    errorConcentration: indicators.errorConcentration,
    approvalPressure:   indicators.approvalBacklog,
    delayPressure:      indicators.delayBacklog,
    stormPressure:      indicators.stuckExecutionRisk,
  };
}

/**
 * Compute a count breakdown from a list of GovernanceAlerts.
 *
 * PURE - deterministic, no side effects.
 */
export function computeAlertSummary(alerts: GovernanceAlert[]): SnapshotAlertSummary {
  let critical = 0;
  let warning  = 0;
  let info     = 0;
  for (const a of alerts) {
    if (a.severity === "critical")     critical++;
    else if (a.severity === "warning") warning++;
    else                               info++;
  }
  return { total: alerts.length, critical, warning, info };
}

/**
 * Build the full SnapshotInsertPayload from a TenantHealthSummary.
 * The resulting object is ready for insertion into governance_snapshots.
 *
 * PURE - deterministic, no side effects.
 */
export function buildSnapshotPayload(
  summary: TenantHealthSummary,
): SnapshotInsertPayload {
  return {
    workspaceId:     summary.workspaceId,
    capturedAt:      summary.capturedAt,
    severity:        summary.severity,
    metricsSnapshot: serializeSnapshotMetrics(summary.metrics),
    indicators:      serializeSnapshotIndicators(summary.indicators),
    alertCodes:      summary.alerts.map(a => a.code),
    alertSummary:    computeAlertSummary(summary.alerts),
    stuckCount:      summary.stuckExecutions.length,
    stormSeverity:   summary.stormResult.severity,
    schemaVersion:   SNAPSHOT_SCHEMA_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 - Pure time-range utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a TrendRange string to its equivalent number of hours.
 *
 * PURE - deterministic.
 */
export function trendRangeToHours(range: TrendRange): number {
  return TREND_RANGE_HOURS[range];
}

/**
 * Return the cutoff Date for a given TrendRange relative to `now`.
 *
 * PURE - injectable `now` enables deterministic testing.
 */
export function trendRangeCutoff(range: TrendRange, now: Date = new Date()): Date {
  const hours = trendRangeToHours(range);
  return new Date(now.getTime() - hours * 3_600_000);
}

/**
 * Filter a snapshot array to those with capturedAt >= since.
 * Does NOT mutate the input array.
 *
 * PURE - deterministic.
 */
export function snapshotsSince(
  snapshots: StoredSnapshot[],
  since:     Date,
): StoredSnapshot[] {
  return snapshots.filter(s => s.capturedAt.getTime() >= since.getTime());
}

/**
 * Filter a snapshot array to those with capturedAt <= before.
 * Rejects future-dated snapshots when `before` is the current time.
 * Does NOT mutate the input array.
 *
 * PURE - deterministic.
 */
export function snapshotsBefore(
  snapshots: StoredSnapshot[],
  before:    Date,
): StoredSnapshot[] {
  return snapshots.filter(s => s.capturedAt.getTime() <= before.getTime());
}

/**
 * Sort a list of snapshots in ascending capturedAt order.
 * Returns a new array - does NOT mutate the input.
 *
 * PURE - deterministic.
 */
export function sortSnapshotsChronological(
  snapshots: StoredSnapshot[],
): StoredSnapshot[] {
  return [...snapshots].sort(
    (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 - Pure trend extraction functions
// ─────────────────────────────────────────────────────────────────────────────
//
// All functions accept pre-sorted (chronological) snapshots and return
// plain data-point arrays suitable for charting or JSON serialization.
// None of these functions perform DB queries or have any I/O.
//

/**
 * Extract a severity history series from a list of snapshots.
 *
 * PURE - deterministic.
 */
export function extractSeverityHistory(
  snapshots: StoredSnapshot[],
): SeverityDataPoint[] {
  return snapshots.map(s => ({
    capturedAt: s.capturedAt.toISOString(),
    severity:   s.severity,
  }));
}

/**
 * Extract a workflow error-rate trend series (values: 0-1).
 *
 * PURE - deterministic.
 */
export function extractErrorRateTrend(
  snapshots: StoredSnapshot[],
): NumberDataPoint[] {
  return snapshots.map(s => ({
    capturedAt: s.capturedAt.toISOString(),
    value:      s.metricsSnapshot.workflowErrorRate,
  }));
}

/**
 * Extract an approval backlog trend series (values: count of overdue approvals).
 *
 * PURE - deterministic.
 */
export function extractApprovalBacklogTrend(
  snapshots: StoredSnapshot[],
): NumberDataPoint[] {
  return snapshots.map(s => ({
    capturedAt: s.capturedAt.toISOString(),
    value:      s.metricsSnapshot.approvalBacklogCount,
  }));
}

/**
 * Extract a delay backlog trend series (values: count of overdue delay wakeups).
 *
 * PURE - deterministic.
 */
export function extractDelayBacklogTrend(
  snapshots: StoredSnapshot[],
): NumberDataPoint[] {
  return snapshots.map(s => ({
    capturedAt: s.capturedAt.toISOString(),
    value:      s.metricsSnapshot.delayBacklogCount,
  }));
}

/**
 * Extract a stuck-execution count trend series.
 *
 * PURE - deterministic.
 */
export function extractStuckCountTrend(
  snapshots: StoredSnapshot[],
): NumberDataPoint[] {
  return snapshots.map(s => ({
    capturedAt: s.capturedAt.toISOString(),
    value:      s.stuckCount,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 - Pure alert frequency intelligence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregate alert code occurrence frequencies across a list of snapshots.
 *
 * For each distinct GOV-* code found in any snapshot's alertCodes array,
 * computes: total occurrence count, percentage of snapshots containing it,
 * first/last seen timestamps, and whether it qualifies as "chronic".
 *
 * A code is "chronic" when frequencyPct >= CHRONIC_THRESHOLD_PCT (default 50%).
 *
 * Result is sorted by count descending (most frequent first).
 *
 * PURE - deterministic, no side effects.
 */
export function computeAlertFrequency(
  snapshots: StoredSnapshot[],
): AlertFrequencyEntry[] {
  if (snapshots.length === 0) return [];

  const total = snapshots.length;

  // code → { count, firstSeenAt, lastSeenAt }
  const map = new Map<string, { count: number; first: Date; last: Date }>();

  for (const snap of snapshots) {
    for (const code of snap.alertCodes) {
      const existing = map.get(code);
      if (!existing) {
        map.set(code, { count: 1, first: snap.capturedAt, last: snap.capturedAt });
      } else {
        existing.count++;
        if (snap.capturedAt.getTime() < existing.first.getTime()) {
          existing.first = snap.capturedAt;
        }
        if (snap.capturedAt.getTime() > existing.last.getTime()) {
          existing.last = snap.capturedAt;
        }
      }
    }
  }

  const entries: AlertFrequencyEntry[] = [];
  for (const [code, { count, first, last }] of map.entries()) {
    const frequencyPct = Math.round((count / total) * 10_000) / 100;
    entries.push({
      code,
      count,
      totalSnapshots: total,
      frequencyPct,
      firstSeenAt:    first.toISOString(),
      lastSeenAt:     last.toISOString(),
      isChronic:      frequencyPct >= CHRONIC_THRESHOLD_PCT,
    });
  }

  // Sort by count descending (tie-break alphabetically for determinism)
  return entries.sort((a, b) =>
    b.count !== a.count
      ? b.count - a.count
      : a.code.localeCompare(b.code),
  );
}

/**
 * Filter computeAlertFrequency() results to only chronic entries.
 *
 * `thresholdPct` defaults to CHRONIC_THRESHOLD_PCT (50).
 *
 * PURE - deterministic.
 */
export function detectChronicAlerts(
  snapshots:    StoredSnapshot[],
  thresholdPct: number = CHRONIC_THRESHOLD_PCT,
): AlertFrequencyEntry[] {
  return computeAlertFrequency(snapshots)
    .filter(e => e.frequencyPct >= thresholdPct)
    .map(e => ({ ...e, isChronic: true }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 - Pure retention utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute retention statistics from a list of snapshots.
 * Assumes snapshots are pre-sorted chronologically.
 *
 * PURE - injectable now (unused here, present for API symmetry).
 */
export function computeRetentionStats(
  snapshots: StoredSnapshot[],
): RetentionStats {
  if (snapshots.length === 0) {
    return {
      snapshotCount:    0,
      oldestCapturedAt: null,
      newestCapturedAt: null,
      spanHours:        0,
      avgIntervalMs:    null,
    };
  }

  const sorted  = sortSnapshotsChronological(snapshots);
  const oldest  = sorted[0]!;
  const newest  = sorted[sorted.length - 1]!;
  const spanMs  = newest.capturedAt.getTime() - oldest.capturedAt.getTime();
  const spanH   = Math.round((spanMs / 3_600_000) * 100) / 100;
  const avgMs   = sorted.length >= 2
    ? Math.round(spanMs / (sorted.length - 1))
    : null;

  return {
    snapshotCount:    sorted.length,
    oldestCapturedAt: oldest.capturedAt.toISOString(),
    newestCapturedAt: newest.capturedAt.toISOString(),
    spanHours:        spanH,
    avgIntervalMs:    avgMs,
  };
}

/**
 * Return the static retention policy recommendation for this platform.
 * Values are based on RECOMMENDED_* constants; not workspace-specific.
 *
 * PURE - deterministic, no arguments needed.
 */
export function recommendRetentionPolicy(): RetentionRecommendation {
  const captureIntervalMinutes = RECOMMENDED_CAPTURE_INTERVAL_MINUTES;
  const capturesPerDay         = (24 * 60) / captureIntervalMinutes;  // 288
  const estimatedRawRowsAt30d  = capturesPerDay * RECOMMENDED_RETENTION_RAW_DAYS;

  return {
    captureIntervalMinutes,
    keepRawDays:           RECOMMENDED_RETENTION_RAW_DAYS,
    keepHourlyDays:        RECOMMENDED_RETENTION_HOURLY_DAYS,
    keepDailyDays:         RECOMMENDED_RETENTION_DAILY_DAYS,
    estimatedRawRowsAt30d,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 8 - API response serialization (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Shape returned by GET /governance/snapshots. */
export interface SnapshotTrendResponse {
  range:                string;
  capturedAt:           string;
  snapshotCount:        number;
  firstAt:              string | null;
  lastAt:               string | null;
  severityHistory:      SeverityDataPoint[];
  errorRateTrend:       NumberDataPoint[];
  approvalBacklogTrend: NumberDataPoint[];
  delayBacklogTrend:    NumberDataPoint[];
  stuckCountTrend:      NumberDataPoint[];
}

/** Shape returned by GET /governance/snapshots/chronic-alerts. */
export interface ChronicAlertsResponse {
  range:          string;
  capturedAt:     string;
  snapshotCount:  number;
  items:          AlertFrequencyEntry[];
  chronicCount:   number;
}

/**
 * Build the trend response payload from a pre-fetched snapshot list.
 *
 * PURE - deterministic, injectable `now`.
 */
export function serializeSnapshotTrendResponse(
  range:     TrendRange,
  snapshots: StoredSnapshot[],
  now:       Date = new Date(),
): SnapshotTrendResponse {
  const sorted = sortSnapshotsChronological(snapshots);
  const first  = sorted[0]   ? sorted[0].capturedAt.toISOString()                    : null;
  const last   = sorted.length > 0 ? sorted[sorted.length - 1]!.capturedAt.toISOString() : null;

  return {
    range,
    capturedAt:           now.toISOString(),
    snapshotCount:        sorted.length,
    firstAt:              first,
    lastAt:               last,
    severityHistory:      extractSeverityHistory(sorted),
    errorRateTrend:       extractErrorRateTrend(sorted),
    approvalBacklogTrend: extractApprovalBacklogTrend(sorted),
    delayBacklogTrend:    extractDelayBacklogTrend(sorted),
    stuckCountTrend:      extractStuckCountTrend(sorted),
  };
}

/**
 * Build the chronic-alerts response payload from a snapshot list.
 *
 * PURE - deterministic, injectable `now`.
 */
export function serializeChronicAlertsResponse(
  range:     TrendRange,
  snapshots: StoredSnapshot[],
  now:       Date = new Date(),
): ChronicAlertsResponse {
  const items        = computeAlertFrequency(snapshots);
  const chronicCount = items.filter(e => e.isChronic).length;
  return {
    range,
    capturedAt:    now.toISOString(),
    snapshotCount: snapshots.length,
    items,
    chronicCount,
  };
}

/**
 * Build the capture-result response payload from a stored snapshot row.
 *
 * PURE - deterministic.
 */
export function serializeCaptureResult(snapshot: StoredSnapshot): CaptureResult {
  return {
    snapshotId:    snapshot.id,
    workspaceId:   snapshot.workspaceId,
    capturedAt:    snapshot.capturedAt.toISOString(),
    severity:      snapshot.severity,
    stuckCount:    snapshot.stuckCount,
    stormSeverity: snapshot.stormSeverity,
    alertCodes:    snapshot.alertCodes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 9 - DB layer (async, injectable DB client)
// ─────────────────────────────────────────────────────────────────────────────

type DbClient = typeof defaultDb;

/**
 * Insert a new governance snapshot row.
 *
 * APPEND-ONLY - uses INSERT, never UPDATE.
 * Returns the newly created StoredSnapshot row.
 */
export async function insertGovernanceSnapshot(
  payload:  SnapshotInsertPayload,
  database: DbClient = defaultDb,
): Promise<StoredSnapshot> {
  const rows = await database
    .insert(governanceSnapshotsTable)
    .values({
      workspaceId:     payload.workspaceId,
      capturedAt:      payload.capturedAt,
      severity:        payload.severity,
      metricsSnapshot: payload.metricsSnapshot,
      indicators:      payload.indicators,
      alertCodes:      payload.alertCodes,
      alertSummary:    payload.alertSummary,
      stuckCount:      payload.stuckCount,
      stormSeverity:   payload.stormSeverity,
      schemaVersion:   payload.schemaVersion,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("governance_snapshots INSERT returned no rows");

  return hydrateSnapshot(row);
}

/**
 * Query all governance snapshots for a workspace within the given time range.
 * Returns rows in ascending capturedAt order (oldest first).
 *
 * READ-ONLY.
 */
export async function querySnapshotsByRange(
  workspaceId: number,
  range:       TrendRange,
  database:    DbClient = defaultDb,
  now:         Date     = new Date(),
): Promise<StoredSnapshot[]> {
  const cutoff = trendRangeCutoff(range, now);

  const rows = await database
    .select()
    .from(governanceSnapshotsTable)
    .where(
      and(
        eq(governanceSnapshotsTable.workspaceId, workspaceId),
        gte(governanceSnapshotsTable.capturedAt, cutoff),
        lte(governanceSnapshotsTable.capturedAt, now),
      ),
    )
    .orderBy(asc(governanceSnapshotsTable.capturedAt));

  return rows.map(hydrateSnapshot);
}

/**
 * Fetch the most recently captured snapshot for a workspace, or null if none.
 *
 * READ-ONLY.
 */
export async function queryLatestSnapshot(
  workspaceId: number,
  database:    DbClient = defaultDb,
): Promise<StoredSnapshot | null> {
  const rows = await database
    .select()
    .from(governanceSnapshotsTable)
    .where(eq(governanceSnapshotsTable.workspaceId, workspaceId))
    .orderBy(asc(governanceSnapshotsTable.capturedAt))
    .limit(1);

  return rows[0] ? hydrateSnapshot(rows[0]) : null;
}

/**
 * Return the total number of stored snapshots for a workspace.
 *
 * READ-ONLY.
 */
export async function querySnapshotCount(
  workspaceId: number,
  database:    DbClient = defaultDb,
): Promise<number> {
  const rows = await database
    .select({ id: governanceSnapshotsTable.id })
    .from(governanceSnapshotsTable)
    .where(eq(governanceSnapshotsTable.workspaceId, workspaceId));
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 10 - Snapshot capture pipeline (Layer 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate tenant health and persist the result as an immutable snapshot.
 *
 * Pipeline:
 *   1. Call evaluateTenantHealth() - reads workflow_executions, pure evaluation
 *   2. Build SnapshotInsertPayload from the TenantHealthSummary
 *   3. INSERT into governance_snapshots (append-only)
 *   4. Emit governance_snapshot_captured observability event
 *   5. Detect chronic alerts (if snapshots exist in the 7d window) and emit
 *      governance_chronic_alert_detected if any are found
 *
 * SAFETY:
 *   • Does NOT mutate any workflow execution rows.
 *   • Does NOT UPDATE or DELETE governance_snapshot rows.
 *   • On failure, emits governance_snapshot_capture_failed and re-throws.
 */
export async function captureGovernanceSnapshot(
  workspaceId: number,
  database:    DbClient = defaultDb,
  now:         Date     = new Date(),
): Promise<CaptureResult> {
  let summary: TenantHealthSummary;

  try {
    summary = await evaluateTenantHealth(workspaceId, database, now);
  } catch (err) {
    logger.error(
      {
        workspaceId,
        error:  err instanceof Error ? err.message : String(err),
        action: GOVERNANCE_ACTION_SNAPSHOT_CAPTURE_FAILED,
      },
      "[governance-history] P7-A: Snapshot capture failed during health evaluation",
    );
    throw err;
  }

  const payload = buildSnapshotPayload(summary);

  let stored: StoredSnapshot;
  try {
    stored = await insertGovernanceSnapshot(payload, database);
  } catch (err) {
    logger.error(
      {
        workspaceId,
        severity: summary.severity,
        error:    err instanceof Error ? err.message : String(err),
        action:   GOVERNANCE_ACTION_SNAPSHOT_CAPTURE_FAILED,
      },
      "[governance-history] P7-A: Snapshot capture failed during INSERT",
    );
    throw err;
  }

  // ── Observability: governance_snapshot_captured ───────────────────────────
  logger.info(
    {
      workspaceId,
      snapshotId:    stored.id,
      snapshotSeverity: stored.severity,
      stuckCount:    stored.stuckCount,
      stormSeverity: stored.stormSeverity,
      alertCodes:    stored.alertCodes,
      capturedAt:    stored.capturedAt.toISOString(),
      action:        GOVERNANCE_ACTION_SNAPSHOT_CAPTURED,
    },
    "[governance-history] P7-A: Governance snapshot captured",
  );

  // ── Chronic alert detection on a 7d rolling window ───────────────────────
  try {
    const recent7d = await querySnapshotsByRange(workspaceId, "7d", database, now);
    const chronic  = detectChronicAlerts(recent7d);

    if (chronic.length > 0) {
      logger.warn(
        {
          workspaceId,
          snapshotSeverity: stored.severity,
          trendRange:       "7d",
          alertCodes:       chronic.map(c => c.code),
          chronicCount:     chronic.length,
          capturedAt:       stored.capturedAt.toISOString(),
          action:           GOVERNANCE_ACTION_CHRONIC_ALERT_DETECTED,
        },
        "[governance-history] P7-A: Chronic governance alerts detected",
      );
    }
  } catch {
    // Non-fatal: failure to query history does not fail the capture itself
    logger.warn(
      { workspaceId, action: GOVERNANCE_ACTION_CHRONIC_ALERT_DETECTED },
      "[governance-history] P7-A: Could not check for chronic alerts after capture",
    );
  }

  return serializeCaptureResult(stored);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cast a raw Drizzle DB row to the typed StoredSnapshot interface.
 * Handles JSONB column casting that Drizzle returns as `unknown`.
 */
function hydrateSnapshot(
  row: typeof governanceSnapshotsTable.$inferSelect,
): StoredSnapshot {
  return {
    id:              row.id,
    workspaceId:     row.workspaceId,
    capturedAt:      row.capturedAt,
    severity:        row.severity,
    metricsSnapshot: row.metricsSnapshot as SnapshotMetrics,
    indicators:      row.indicators     as SnapshotIndicators,
    alertCodes:      (row.alertCodes    as string[] | null) ?? [],
    alertSummary:    row.alertSummary   as SnapshotAlertSummary,
    stuckCount:      row.stuckCount,
    stormSeverity:   row.stormSeverity,
    schemaVersion:   row.schemaVersion,
  };
}
