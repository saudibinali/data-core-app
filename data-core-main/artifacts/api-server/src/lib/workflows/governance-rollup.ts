/**
 * @file   governance-rollup.ts
 * @phase  P7-C - Historical Rollups & Long-Term Analytics Foundations
 *
 * Converts raw short-term governance history (≤ 30 days) into compressed
 * long-term operational intelligence (up to 365 days) via a deterministic
 * append-only rollup lifecycle.
 *
 * Architecture - three layers:
 *
 *   Layer 1 - Pure model functions (synchronous, no I/O):
 *     • Bucket computation (hour truncation, day truncation)
 *     • Grouping (snapshots → hour groups, hourly rollups → day groups)
 *     • Aggregation (dominant severity, avg metrics, chronic codes, storm freq)
 *     • Rollup payload builders (hourly from snapshots, daily from hourly)
 *     • Query cascade selection (raw ≤30d / hourly 30-90d / daily 90-365d)
 *     • Response serialization
 *
 *   Layer 2 - DB layer (async, injectable DB client):
 *     • querySnapshotsInBucket()         - READ-ONLY snapshot range query
 *     • queryHourlyRollupsInBucket()     - READ-ONLY hourly rollup query
 *     • insertRollupIfNotExists()        - append-only INSERT ON CONFLICT DO NOTHING
 *     • queryRollupsByRange()            - READ-ONLY rollup range query
 *
 *   Layer 3 - Pipeline (async, orchestrates layers 1+2):
 *     • enumerateHourBuckets()           - iterate calendar hours in a window
 *     • enumerateDayBuckets()            - iterate calendar days in a window
 *     • buildHourlyRollupsForWorkspace() - per-workspace hourly rollup pass
 *     • buildDailyRollupsForWorkspace()  - per-workspace daily rollup pass
 *     • buildWorkspaceRollups()          - full orchestration for one workspace
 *
 * Safety guarantees (Section 9 of the P7-C spec):
 *   • Append-only: rollup rows are INSERT ON CONFLICT DO NOTHING - never UPDATE.
 *   • Never rewrites existing rollups: the unique constraint on
 *     (workspaceId, granularity, bucketStart) makes re-runs idempotent.
 *   • Never mutates surviving raw snapshots: the rollup pipeline only READs
 *     from governance_snapshots; it never writes or deletes them.
 *   • Never prunes before rollup: the scheduler calls buildWorkspaceRollups()
 *     first; pruning for a workspace is skipped when rollup fails.
 *   • Analytics isolation: this file never touches workflow_executions or
 *     any other runtime table.
 */

import { and, gte, lt, eq } from "drizzle-orm";
import { db as defaultDb, governanceSnapshotsTable, governanceSnapshotRollupsTable } from "@workspace/db";
import { logger } from "../logger";
import type { StoredSnapshot } from "./governance-history";
import {
  RECOMMENDED_RETENTION_HOURLY_DAYS,
  RECOMMENDED_RETENTION_DAILY_DAYS,
  CHRONIC_THRESHOLD_PCT,
} from "./governance-history";
import { RETENTION_RAW_DAYS } from "./governance-scheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 - Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Millisecond durations for bucket arithmetic. */
export const HOUR_MS = 3_600_000;
export const DAY_MS  = 86_400_000;

/** Rollup granularity literals. */
export const ROLLUP_GRANULARITY_HOURLY = "hourly" as const;
export const ROLLUP_GRANULARITY_DAILY  = "daily"  as const;

/** Schema version written into every new rollup row. Increment on breaking changes. */
export const ROLLUP_SCHEMA_VERSION = 1;

/**
 * Retention bounds for each rollup tier (days).
 * Sourced from P7-A constants to ensure alignment.
 */
export const ROLLUP_HOURLY_RETENTION_DAYS = RECOMMENDED_RETENTION_HOURLY_DAYS;  // 90
export const ROLLUP_DAILY_RETENTION_DAYS  = RECOMMENDED_RETENTION_DAILY_DAYS;   // 365

/**
 * Day-boundary thresholds for the query cascade.
 *
 *   daysBack ≤ RAW_TO_HOURLY_THRESHOLD_DAYS       → raw snapshots
 *   daysBack ≤ HOURLY_TO_DAILY_THRESHOLD_DAYS      → hourly rollups
 *   daysBack ≤ DAILY_MAX_DAYS                      → daily rollups
 */
export const RAW_TO_HOURLY_THRESHOLD_DAYS  = RETENTION_RAW_DAYS;                // 30
export const HOURLY_TO_DAILY_THRESHOLD_DAYS = ROLLUP_HOURLY_RETENTION_DAYS;     // 90
export const DAILY_MAX_DAYS                 = ROLLUP_DAILY_RETENTION_DAYS;      // 365

/**
 * Fraction threshold for chronic alert detection in rollups.
 * Aligned with P7-A's CHRONIC_THRESHOLD_PCT = 50.
 * A code must appear in STRICTLY MORE than this fraction of source records.
 */
export const ROLLUP_CHRONIC_THRESHOLD_PCT = CHRONIC_THRESHOLD_PCT;  // 50

/**
 * How many hours before the raw retention boundary to roll up.
 * The scheduler builds hourly rollups for this overlap zone so that
 * every snapshot is covered before it leaves the raw window.
 *
 * Example: with RETENTION_RAW_DAYS=30 and ROLLUP_OVERLAP_HOURS=48,
 * the hourly rollup window is [now-32d, now-28d] - ensures full coverage.
 */
export const ROLLUP_OVERLAP_HOURS = 48;

/**
 * Max rollup rows to delete per prune pass (parallel to PRUNE_MAX_DELETE_PER_CYCLE).
 * Keeps DELETE statements bounded and avoids lock contention.
 */
export const ROLLUP_PRUNE_MAX_DELETE_PER_CYCLE = 500;

/** Severity ranking table.  Higher value = worse health. */
export const SEVERITY_RANK: Record<string, number> = {
  healthy:  0,
  warning:  1,
  degraded: 2,
  critical: 3,
};

/** Observability action constants for P7-C events. */
export const GOVERNANCE_ACTION_ROLLUP_HOURLY_COMPLETED  = "governance_rollup_hourly_completed"  as const;
export const GOVERNANCE_ACTION_ROLLUP_DAILY_COMPLETED   = "governance_rollup_daily_completed"   as const;
export const GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE      = "governance_rollup_pruning_safe"      as const;
export const GOVERNANCE_ACTION_ROLLUP_FAILED            = "governance_rollup_failed"            as const;
export const GOVERNANCE_ACTION_ROLLUP_QUERY_RESOLVED    = "governance_rollup_query_resolved"    as const;

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 - Types
// ─────────────────────────────────────────────────────────────────────────────

/** Supported rollup granularities. */
export type RollupGranularity = typeof ROLLUP_GRANULARITY_HOURLY | typeof ROLLUP_GRANULARITY_DAILY;

/** A closed-open time bucket [start, end). */
export interface TimeBucket {
  start: Date;
  end:   Date;
}

/** A group of source records sharing the same time bucket. */
export interface BucketGroup<T> {
  bucket: TimeBucket;
  items:  T[];
}

/** A fully hydrated rollup row returned from the DB. */
export interface StoredRollup {
  id:                 number;
  workspaceId:        number;
  granularity:        RollupGranularity;
  bucketStart:        Date;
  bucketEnd:          Date;
  snapshotCount:      number;
  avgErrorRate:       number;
  avgApprovalBacklog: number;
  avgDelayBacklog:    number;
  avgStuckCount:      number;
  dominantSeverity:   string;
  chronicAlertCodes:  string[];
  stormFrequency:     number;
  schemaVersion:      number;
  createdAt:          Date;
}

/** Values used for INSERT into governance_snapshot_rollups. */
export interface RollupInsertPayload {
  workspaceId:        number;
  granularity:        RollupGranularity;
  bucketStart:        Date;
  bucketEnd:          Date;
  snapshotCount:      number;
  avgErrorRate:       number;
  avgApprovalBacklog: number;
  avgDelayBacklog:    number;
  avgStuckCount:      number;
  dominantSeverity:   string;
  chronicAlertCodes:  string[];
  stormFrequency:     number;
  schemaVersion:      number;
}

/** Serialized rollup data point for API/trend responses. */
export interface RollupDataPoint {
  bucketStart:        string;  // ISO 8601
  bucketEnd:          string;  // ISO 8601
  granularity:        RollupGranularity;
  snapshotCount:      number;
  avgErrorRate:       number;
  avgApprovalBacklog: number;
  avgDelayBacklog:    number;
  avgStuckCount:      number;
  dominantSeverity:   string;
  chronicAlertCodes:  string[];
  stormFrequency:     number;
}

/** Which storage tier the query cascade resolved to. */
export type QueryLayer = "raw" | "hourly" | "daily";

/** Result of the query cascade resolution (pure). */
export interface QueryLayerResolution {
  layer:   QueryLayer;
  daysBack: number;
}

/** Result of building rollups for a single workspace. */
export interface RollupWorkspaceResult {
  workspaceId:  number;
  hourlyBuilt:  number;
  dailyBuilt:   number;
  success:      boolean;
  error?:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 - Pure: bucket computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Truncate a timestamp to the start of its UTC clock-hour.
 *
 * Returns a closed-open bucket [hourStart, hourStart+1h).
 * Deterministic - the same ts always yields the same bucket.
 *
 * Example: 2026-01-15T10:37:22Z → { start: 2026-01-15T10:00:00Z, end: 2026-01-15T11:00:00Z }
 *
 * PURE - deterministic.
 */
export function computeHourBucket(ts: Date): TimeBucket {
  const start = new Date(ts);
  start.setUTCMinutes(0, 0, 0);
  return { start, end: new Date(start.getTime() + HOUR_MS) };
}

/**
 * Truncate a timestamp to the start of its UTC calendar-day.
 *
 * Returns a closed-open bucket [dayStart, dayStart+24h).
 * Deterministic - the same ts always yields the same bucket.
 *
 * Example: 2026-01-15T10:37:22Z → { start: 2026-01-15T00:00:00Z, end: 2026-01-16T00:00:00Z }
 *
 * PURE - deterministic.
 */
export function computeDayBucket(ts: Date): TimeBucket {
  const start = new Date(ts);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/**
 * Produce a stable string key from a TimeBucket for use as a Map key.
 * Uses the bucket start's ISO 8601 string.
 *
 * PURE - deterministic.
 */
export function bucketKey(bucket: TimeBucket): string {
  return bucket.start.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 - Pure: grouping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group an array of StoredSnapshot into hour-bucket groups.
 *
 * Each group contains all snapshots whose capturedAt falls within the same
 * UTC clock-hour.  Result is sorted ascending by bucket start - deterministic
 * iteration order for downstream rollup building.
 *
 * Does NOT mutate the input array.
 *
 * PURE - deterministic.
 */
export function groupSnapshotsByHourBucket(
  snapshots: StoredSnapshot[],
): BucketGroup<StoredSnapshot>[] {
  const map = new Map<string, BucketGroup<StoredSnapshot>>();

  for (const snapshot of snapshots) {
    const bucket = computeHourBucket(snapshot.capturedAt);
    const key    = bucketKey(bucket);

    if (!map.has(key)) {
      map.set(key, { bucket, items: [] });
    }
    map.get(key)!.items.push(snapshot);
  }

  return Array.from(map.values()).sort(
    (a, b) => a.bucket.start.getTime() - b.bucket.start.getTime(),
  );
}

/**
 * Group an array of StoredRollup (hourly granularity) into UTC-day groups.
 *
 * Each group contains all hourly rollups whose bucketStart falls within the
 * same UTC calendar-day.  Result is sorted ascending by bucket start.
 *
 * Does NOT mutate the input array.
 *
 * PURE - deterministic.
 */
export function groupRollupsByDayBucket(
  rollups: StoredRollup[],
): BucketGroup<StoredRollup>[] {
  const map = new Map<string, BucketGroup<StoredRollup>>();

  for (const rollup of rollups) {
    const bucket = computeDayBucket(rollup.bucketStart);
    const key    = bucketKey(bucket);

    if (!map.has(key)) {
      map.set(key, { bucket, items: [] });
    }
    map.get(key)!.items.push(rollup);
  }

  return Array.from(map.values()).sort(
    (a, b) => a.bucket.start.getTime() - b.bucket.start.getTime(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 - Pure: aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the dominant severity from a list of severity strings.
 *
 * Rule: highest severity wins.
 * Severity ranking: healthy(0) < warning(1) < degraded(2) < critical(3).
 *
 * Edge cases:
 *   • Empty input → "healthy" (default - no evidence of degradation)
 *   • Unknown severity string → treated as rank -1 (below "healthy")
 *   • Ties → the highest-rank value wins (deterministic via numeric max)
 *
 * PURE - deterministic.
 */
export function computeDominantSeverity(severities: string[]): string {
  if (severities.length === 0) return "healthy";

  let maxRank   = -1;
  let maxSev    = "healthy";

  for (const sev of severities) {
    const rank = SEVERITY_RANK[sev] ?? -1;
    if (rank > maxRank) {
      maxRank = rank;
      maxSev  = sev;
    }
  }

  return maxSev;
}

/**
 * Compute the arithmetic mean of a numeric array.
 *
 * Edge cases:
 *   • Empty input → 0
 *   • All zeros → 0
 *
 * PURE - deterministic.
 */
export function computeAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Identify GOV-* alert codes that appear in strictly more than `threshold`%
 * of the supplied `codeArrays`.
 *
 * Algorithm:
 *   1. Flatten all code arrays, counting unique appearances per source item
 *      (a code is counted once per source item, even if it appears multiple
 *       times in the same item's array - though in practice each item's array
 *       contains distinct codes).
 *   2. A code is "chronic" when (count / total) * 100 > threshold (strict >).
 *   3. Return codes sorted lexicographically for a stable, deterministic output.
 *
 * This mirrors the P7-A detectChronicAlerts() semantics - aligned with
 * ROLLUP_CHRONIC_THRESHOLD_PCT = 50 (> 50%, not ≥ 50%).
 *
 * PURE - deterministic.
 */
export function computeChronicCodes(
  codeArrays: string[][],
  threshold:  number = ROLLUP_CHRONIC_THRESHOLD_PCT,
): string[] {
  const total = codeArrays.length;
  if (total === 0) return [];

  const counts = new Map<string, number>();

  for (const codes of codeArrays) {
    // Count each distinct code once per source item.
    const seen = new Set<string>();
    for (const code of codes) {
      if (!seen.has(code)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
        seen.add(code);
      }
    }
  }

  const result: string[] = [];
  for (const [code, count] of counts) {
    if ((count / total) * 100 > threshold) {
      result.push(code);
    }
  }

  return result.sort();
}

/**
 * Compute storm frequency from a list of raw snapshots.
 *
 * Returns the fraction (0.0-1.0) of snapshots whose stormSeverity is not "none".
 *
 * Edge case: empty input → 0.
 *
 * PURE - deterministic.
 */
export function computeStormFrequencyFromSnapshots(snapshots: StoredSnapshot[]): number {
  if (snapshots.length === 0) return 0;
  const stormCount = snapshots.filter(s => s.stormSeverity !== "none").length;
  return stormCount / snapshots.length;
}

/**
 * Compute storm frequency from a list of hourly rollup rows.
 *
 * Returns the arithmetic mean of stormFrequency across the rollups (0.0-1.0).
 * This correctly propagates the weighted storm signal from hourly to daily.
 *
 * Edge case: empty input → 0.
 *
 * PURE - deterministic.
 */
export function computeStormFrequencyFromRollups(rollups: StoredRollup[]): number {
  return computeAvg(rollups.map(r => r.stormFrequency));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 - Pure: rollup payload builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an hourly rollup insert payload from a set of raw snapshots.
 *
 * The bucket must cover the capturedAt range of all supplied snapshots.
 * It is the caller's responsibility to pass only snapshots that belong to
 * the same clock-hour bucket.
 *
 * Aggregation semantics:
 *   snapshotCount      - length of input array
 *   avgErrorRate       - mean(snap.metricsSnapshot.workflowErrorRate)
 *   avgApprovalBacklog - mean(snap.metricsSnapshot.approvalBacklogCount)
 *   avgDelayBacklog    - mean(snap.metricsSnapshot.delayBacklogCount)
 *   avgStuckCount      - mean(snap.stuckCount)           ← top-level column
 *   dominantSeverity   - highest severity across all snapshots
 *   chronicAlertCodes  - codes in > ROLLUP_CHRONIC_THRESHOLD_PCT% of snapshots
 *   stormFrequency     - fraction with stormSeverity != "none"
 *
 * PURE - deterministic.
 */
export function buildHourlyRollupPayload(
  workspaceId: number,
  bucket:      TimeBucket,
  snapshots:   StoredSnapshot[],
): RollupInsertPayload {
  return {
    workspaceId,
    granularity:        ROLLUP_GRANULARITY_HOURLY,
    bucketStart:        bucket.start,
    bucketEnd:          bucket.end,
    snapshotCount:      snapshots.length,
    avgErrorRate:       computeAvg(snapshots.map(s => s.metricsSnapshot.workflowErrorRate)),
    avgApprovalBacklog: computeAvg(snapshots.map(s => s.metricsSnapshot.approvalBacklogCount)),
    avgDelayBacklog:    computeAvg(snapshots.map(s => s.metricsSnapshot.delayBacklogCount)),
    avgStuckCount:      computeAvg(snapshots.map(s => s.stuckCount)),
    dominantSeverity:   computeDominantSeverity(snapshots.map(s => s.severity)),
    chronicAlertCodes:  computeChronicCodes(snapshots.map(s => s.alertCodes)),
    stormFrequency:     computeStormFrequencyFromSnapshots(snapshots),
    schemaVersion:      ROLLUP_SCHEMA_VERSION,
  };
}

/**
 * Build a daily rollup insert payload from a set of hourly rollup rows.
 *
 * The bucket must be a UTC calendar-day that covers the bucketStart range of
 * all supplied hourly rollups.  It is the caller's responsibility to pass only
 * rollups that belong to the same calendar-day.
 *
 * Aggregation semantics:
 *   snapshotCount      - sum(rollup.snapshotCount) - total raw snapshots in the day
 *   avgErrorRate       - mean(rollup.avgErrorRate)
 *   avgApprovalBacklog - mean(rollup.avgApprovalBacklog)
 *   avgDelayBacklog    - mean(rollup.avgDelayBacklog)
 *   avgStuckCount      - mean(rollup.avgStuckCount)
 *   dominantSeverity   - highest dominantSeverity across hourly rollups
 *   chronicAlertCodes  - codes chronic in > 50% of the hourly rollups
 *   stormFrequency     - mean(rollup.stormFrequency)
 *
 * PURE - deterministic.
 */
export function buildDailyRollupPayload(
  workspaceId: number,
  bucket:      TimeBucket,
  rollups:     StoredRollup[],
): RollupInsertPayload {
  return {
    workspaceId,
    granularity:        ROLLUP_GRANULARITY_DAILY,
    bucketStart:        bucket.start,
    bucketEnd:          bucket.end,
    snapshotCount:      rollups.reduce((sum, r) => sum + r.snapshotCount, 0),
    avgErrorRate:       computeAvg(rollups.map(r => r.avgErrorRate)),
    avgApprovalBacklog: computeAvg(rollups.map(r => r.avgApprovalBacklog)),
    avgDelayBacklog:    computeAvg(rollups.map(r => r.avgDelayBacklog)),
    avgStuckCount:      computeAvg(rollups.map(r => r.avgStuckCount)),
    dominantSeverity:   computeDominantSeverity(rollups.map(r => r.dominantSeverity)),
    chronicAlertCodes:  computeChronicCodes(rollups.map(r => r.chronicAlertCodes)),
    stormFrequency:     computeStormFrequencyFromRollups(rollups),
    schemaVersion:      ROLLUP_SCHEMA_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 - Pure: query cascade
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine which storage tier to query based on how far back the request reaches.
 *
 * Query cascade:
 *   daysBack ≤ 30   → "raw"    (governance_snapshots, 5-min resolution)
 *   daysBack ≤ 90   → "hourly" (governance_snapshot_rollups, 1-hour resolution)
 *   daysBack ≤ 365  → "daily"  (governance_snapshot_rollups, 1-day resolution)
 *   daysBack > 365  → "daily"  (clamped - caller should validate range)
 *
 * This model ensures:
 *   • Recent data (≤ 30d) is served from full-resolution raw snapshots.
 *   • Medium-term data (30-90d) is served from hourly rollups.
 *   • Long-term data (90-365d) is served from daily rollups.
 *   • The transition boundaries are aligned with the retention policy constants.
 *
 * PURE - deterministic.
 */
export function selectQueryLayer(daysBack: number): QueryLayer {
  if (daysBack <= RAW_TO_HOURLY_THRESHOLD_DAYS)   return "raw";
  if (daysBack <= HOURLY_TO_DAILY_THRESHOLD_DAYS)  return "hourly";
  return "daily";
}

/**
 * Resolve a numeric daysBack value to a QueryLayerResolution.
 *
 * Emits a governance_rollup_query_resolved observability event.
 *
 * PURE (observability side-effect via logger only).
 */
export function resolveQueryLayer(
  daysBack:    number,
  workspaceId: number,
): QueryLayerResolution {
  const layer = selectQueryLayer(daysBack);

  logger.info(
    {
      workspaceId,
      daysBack,
      layer,
      action: GOVERNANCE_ACTION_ROLLUP_QUERY_RESOLVED,
    },
    `[governance-rollup] P7-C: Query cascade resolved to ${layer}`,
  );

  return { layer, daysBack };
}

/**
 * Serialize a StoredRollup into an API-ready RollupDataPoint.
 *
 * Converts Date objects to ISO 8601 strings.
 *
 * PURE - deterministic.
 */
export function serializeRollupDataPoint(rollup: StoredRollup): RollupDataPoint {
  return {
    bucketStart:        rollup.bucketStart.toISOString(),
    bucketEnd:          rollup.bucketEnd.toISOString(),
    granularity:        rollup.granularity,
    snapshotCount:      rollup.snapshotCount,
    avgErrorRate:       rollup.avgErrorRate,
    avgApprovalBacklog: rollup.avgApprovalBacklog,
    avgDelayBacklog:    rollup.avgDelayBacklog,
    avgStuckCount:      rollup.avgStuckCount,
    dominantSeverity:   rollup.dominantSeverity,
    chronicAlertCodes:  rollup.chronicAlertCodes,
    stormFrequency:     rollup.stormFrequency,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 8 - DB layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query raw snapshots within a time bucket [start, end).
 *
 * Used by the rollup pipeline to supply source snapshots for hourly aggregation.
 * READ-ONLY - no mutations.
 *
 * Returns rows ordered by capturedAt ASC for deterministic aggregation.
 */
export async function querySnapshotsInBucket(
  workspaceId: number,
  start:       Date,
  end:         Date,
  database:    typeof defaultDb = defaultDb,
): Promise<StoredSnapshot[]> {
  const rows = await database
    .select()
    .from(governanceSnapshotsTable)
    .where(
      and(
        eq(governanceSnapshotsTable.workspaceId, workspaceId),
        gte(governanceSnapshotsTable.capturedAt, start),
        lt(governanceSnapshotsTable.capturedAt, end),
      ),
    )
    .orderBy(governanceSnapshotsTable.capturedAt);

  return rows.map(r => ({
    id:              r.id,
    workspaceId:     r.workspaceId,
    capturedAt:      r.capturedAt,
    severity:        r.severity,
    metricsSnapshot: r.metricsSnapshot as StoredSnapshot["metricsSnapshot"],
    indicators:      r.indicators      as StoredSnapshot["indicators"],
    alertCodes:      (r.alertCodes     as string[]) ?? [],
    alertSummary:    r.alertSummary    as StoredSnapshot["alertSummary"],
    stuckCount:      r.stuckCount,
    stormSeverity:   r.stormSeverity,
    schemaVersion:   r.schemaVersion,
  }));
}

/**
 * Query hourly rollup rows within a UTC-day window [dayStart, dayEnd).
 *
 * Used by the rollup pipeline to supply source rows for daily aggregation.
 * READ-ONLY - no mutations.
 *
 * Returns rows ordered by bucketStart ASC.
 */
export async function queryHourlyRollupsInBucket(
  workspaceId: number,
  dayStart:    Date,
  dayEnd:      Date,
  database:    typeof defaultDb = defaultDb,
): Promise<StoredRollup[]> {
  const rows = await database
    .select()
    .from(governanceSnapshotRollupsTable)
    .where(
      and(
        eq(governanceSnapshotRollupsTable.workspaceId, workspaceId),
        eq(governanceSnapshotRollupsTable.granularity, ROLLUP_GRANULARITY_HOURLY),
        gte(governanceSnapshotRollupsTable.bucketStart, dayStart),
        lt(governanceSnapshotRollupsTable.bucketStart, dayEnd),
      ),
    )
    .orderBy(governanceSnapshotRollupsTable.bucketStart);

  return rows.map(rowToStoredRollup);
}

/**
 * Insert a rollup row if no row with the same (workspaceId, granularity, bucketStart)
 * already exists.  Returns true if the row was inserted, false on conflict.
 *
 * This is the ONLY write path for governance_snapshot_rollups.
 * ON CONFLICT DO NOTHING ensures idempotency - re-running the rollup pipeline
 * for the same bucket is safe and produces no mutations.
 *
 * APPEND-ONLY - never UPDATE, never DELETE.
 */
export async function insertRollupIfNotExists(
  payload:  RollupInsertPayload,
  database: typeof defaultDb = defaultDb,
): Promise<boolean> {
  const result = await database
    .insert(governanceSnapshotRollupsTable)
    .values({
      workspaceId:        payload.workspaceId,
      granularity:        payload.granularity,
      bucketStart:        payload.bucketStart,
      bucketEnd:          payload.bucketEnd,
      snapshotCount:      payload.snapshotCount,
      avgErrorRate:       payload.avgErrorRate,
      avgApprovalBacklog: payload.avgApprovalBacklog,
      avgDelayBacklog:    payload.avgDelayBacklog,
      avgStuckCount:      payload.avgStuckCount,
      dominantSeverity:   payload.dominantSeverity,
      chronicAlertCodes:  payload.chronicAlertCodes,
      stormFrequency:     payload.stormFrequency,
      schemaVersion:      payload.schemaVersion,
    })
    .onConflictDoNothing()
    .returning({ id: governanceSnapshotRollupsTable.id });

  return result.length > 0;
}

/**
 * Query rollup rows for a workspace within a time range [since, until).
 *
 * Supports the query cascade - callers use selectQueryLayer() to decide which
 * granularity to pass.  READ-ONLY - no mutations.
 *
 * Returns rows ordered by bucketStart ASC for trend chart rendering.
 */
export async function queryRollupsByRange(
  workspaceId:  number,
  granularity:  RollupGranularity,
  since:        Date,
  until:        Date,
  database:     typeof defaultDb = defaultDb,
): Promise<StoredRollup[]> {
  const rows = await database
    .select()
    .from(governanceSnapshotRollupsTable)
    .where(
      and(
        eq(governanceSnapshotRollupsTable.workspaceId, workspaceId),
        eq(governanceSnapshotRollupsTable.granularity, granularity),
        gte(governanceSnapshotRollupsTable.bucketStart, since),
        lt(governanceSnapshotRollupsTable.bucketStart, until),
      ),
    )
    .orderBy(governanceSnapshotRollupsTable.bucketStart);

  return rows.map(rowToStoredRollup);
}

/**
 * Internal row mapper: raw DB row → StoredRollup.
 * Handles JSONB deserialization and null coercion for real columns.
 */
function rowToStoredRollup(r: typeof governanceSnapshotRollupsTable.$inferSelect): StoredRollup {
  return {
    id:                 r.id,
    workspaceId:        r.workspaceId,
    granularity:        r.granularity as RollupGranularity,
    bucketStart:        r.bucketStart,
    bucketEnd:          r.bucketEnd,
    snapshotCount:      r.snapshotCount,
    avgErrorRate:       r.avgErrorRate ?? 0,
    avgApprovalBacklog: r.avgApprovalBacklog ?? 0,
    avgDelayBacklog:    r.avgDelayBacklog ?? 0,
    avgStuckCount:      r.avgStuckCount ?? 0,
    dominantSeverity:   r.dominantSeverity,
    chronicAlertCodes:  (r.chronicAlertCodes as string[]) ?? [],
    stormFrequency:     r.stormFrequency ?? 0,
    schemaVersion:      r.schemaVersion,
    createdAt:          r.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 9 - Pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enumerate all clock-hour bucket start times within a window [windowStart, windowEnd).
 *
 * Returns an array of TimeBucket objects - one per hour in the window.
 * The first bucket is the hour containing `windowStart`, truncated to the
 * start of that hour.  The last bucket is the one whose start < windowEnd.
 *
 * Maximum 8,760 buckets (365 days × 24 hours) - bounded by DAILY_MAX_DAYS.
 *
 * PURE - deterministic.
 */
export function enumerateHourBuckets(windowStart: Date, windowEnd: Date): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  let current = computeHourBucket(windowStart).start;

  while (current.getTime() < windowEnd.getTime()) {
    buckets.push({ start: current, end: new Date(current.getTime() + HOUR_MS) });
    current = new Date(current.getTime() + HOUR_MS);
  }

  return buckets;
}

/**
 * Enumerate all UTC-day bucket start times within a window [windowStart, windowEnd).
 *
 * Returns an array of TimeBucket objects - one per day in the window.
 * The first bucket is the day containing `windowStart`, truncated to UTC midnight.
 *
 * Maximum 365 buckets.
 *
 * PURE - deterministic.
 */
export function enumerateDayBuckets(windowStart: Date, windowEnd: Date): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  let current = computeDayBucket(windowStart).start;

  while (current.getTime() < windowEnd.getTime()) {
    buckets.push({ start: current, end: new Date(current.getTime() + DAY_MS) });
    current = new Date(current.getTime() + DAY_MS);
  }

  return buckets;
}

/**
 * Build hourly rollups for a workspace over the given window.
 *
 * For each clock-hour in [windowStart, windowEnd):
 *   1. Query raw snapshots in that hour bucket.
 *   2. If snapshots exist → build hourly rollup payload → insert (ON CONFLICT DO NOTHING).
 *   3. Increment hourlyBuilt counter.
 *
 * Returns the count of rollup rows inserted (conflicts count as 0 - already existed).
 *
 * Emits governance_rollup_hourly_completed on success.
 */
export async function buildHourlyRollupsForWorkspace(
  workspaceId:  number,
  windowStart:  Date,
  windowEnd:    Date,
  now:          Date             = new Date(),
  database:     typeof defaultDb = defaultDb,
): Promise<number> {
  const hourBuckets = enumerateHourBuckets(windowStart, windowEnd);
  let built = 0;

  for (const bucket of hourBuckets) {
    // Do not roll up hours that haven't ended yet.
    if (bucket.end.getTime() > now.getTime()) continue;

    const snapshots = await querySnapshotsInBucket(workspaceId, bucket.start, bucket.end, database);
    if (snapshots.length === 0) continue;

    const payload  = buildHourlyRollupPayload(workspaceId, bucket, snapshots);
    const inserted = await insertRollupIfNotExists(payload, database);
    if (inserted) built++;
  }

  logger.info(
    {
      workspaceId,
      granularity:        ROLLUP_GRANULARITY_HOURLY,
      sourceSnapshotCount: hourBuckets.length,
      rollupCount:         built,
      retentionWindow:     ROLLUP_HOURLY_RETENTION_DAYS,
      action:              GOVERNANCE_ACTION_ROLLUP_HOURLY_COMPLETED,
    },
    "[governance-rollup] P7-C: Hourly rollup pass completed",
  );

  return built;
}

/**
 * Build daily rollups for a workspace over the given window.
 *
 * For each UTC-day in [windowStart, windowEnd):
 *   1. Query hourly rollup rows for that day.
 *   2. If hourly rollups exist → build daily rollup payload → insert (ON CONFLICT DO NOTHING).
 *   3. Increment dailyBuilt counter.
 *
 * Returns the count of daily rollup rows inserted.
 *
 * Emits governance_rollup_daily_completed on success.
 */
export async function buildDailyRollupsForWorkspace(
  workspaceId:  number,
  windowStart:  Date,
  windowEnd:    Date,
  now:          Date             = new Date(),
  database:     typeof defaultDb = defaultDb,
): Promise<number> {
  const dayBuckets = enumerateDayBuckets(windowStart, windowEnd);
  let built = 0;

  for (const bucket of dayBuckets) {
    if (bucket.end.getTime() > now.getTime()) continue;

    const hourlyRollups = await queryHourlyRollupsInBucket(workspaceId, bucket.start, bucket.end, database);
    if (hourlyRollups.length === 0) continue;

    const payload  = buildDailyRollupPayload(workspaceId, bucket, hourlyRollups);
    const inserted = await insertRollupIfNotExists(payload, database);
    if (inserted) built++;
  }

  logger.info(
    {
      workspaceId,
      granularity:        ROLLUP_GRANULARITY_DAILY,
      sourceSnapshotCount: dayBuckets.length,
      rollupCount:         built,
      retentionWindow:     ROLLUP_DAILY_RETENTION_DAYS,
      action:              GOVERNANCE_ACTION_ROLLUP_DAILY_COMPLETED,
    },
    "[governance-rollup] P7-C: Daily rollup pass completed",
  );

  return built;
}

/**
 * Orchestrate the full rollup pipeline for a single workspace.
 *
 * Called by the GovernanceSnapshotScheduler BEFORE pruning raw snapshots.
 * The scheduler uses the returned `success` flag to decide whether it is safe
 * to prune - if success=false, pruning is skipped for this workspace.
 *
 * Pipeline steps:
 *   A. Hourly rollups for the overlap zone around the raw retention boundary
 *      Window: [now - (RETENTION_RAW_DAYS + 2d), now - (RETENTION_RAW_DAYS - 2d)]
 *      Purpose: ensure every snapshot about to exit the 30-day window has a rollup.
 *
 *   B. Daily rollups for the overlap zone around the hourly retention boundary
 *      Window: [now - (ROLLUP_HOURLY_RETENTION_DAYS + 2d), now - (ROLLUP_HOURLY_RETENTION_DAYS - 2d)]
 *      Purpose: ensure every hourly rollup about to exit the 90-day window has a daily rollup.
 *
 * The overlap zones (±2 days around the boundary) handle edge cases such as
 * clock skew, daylight-saving-time transitions, and scheduler downtime.
 *
 * ON CONFLICT DO NOTHING ensures this is safe to call on every cycle - it
 * is strictly idempotent.
 */
export async function buildWorkspaceRollups(
  workspaceId: number,
  now:         Date             = new Date(),
  database:    typeof defaultDb = defaultDb,
): Promise<RollupWorkspaceResult> {
  try {
    // A. Hourly rollup overlap zone
    const hourlyWindowStart = new Date(now.getTime() - (RETENTION_RAW_DAYS + 2) * DAY_MS);
    const hourlyWindowEnd   = new Date(now.getTime() - (RETENTION_RAW_DAYS - 2) * DAY_MS);

    const hourlyBuilt = await buildHourlyRollupsForWorkspace(
      workspaceId,
      hourlyWindowStart,
      hourlyWindowEnd,
      now,
      database,
    );

    // B. Daily rollup overlap zone
    const dailyWindowStart = new Date(now.getTime() - (ROLLUP_HOURLY_RETENTION_DAYS + 2) * DAY_MS);
    const dailyWindowEnd   = new Date(now.getTime() - (ROLLUP_HOURLY_RETENTION_DAYS - 2) * DAY_MS);

    const dailyBuilt = await buildDailyRollupsForWorkspace(
      workspaceId,
      dailyWindowStart,
      dailyWindowEnd,
      now,
      database,
    );

    return { workspaceId, hourlyBuilt, dailyBuilt, success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        workspaceId,
        error,
        action: GOVERNANCE_ACTION_ROLLUP_FAILED,
      },
      "[governance-rollup] P7-C: Rollup pipeline failed for workspace",
    );

    return { workspaceId, hourlyBuilt: 0, dailyBuilt: 0, success: false, error };
  }
}
