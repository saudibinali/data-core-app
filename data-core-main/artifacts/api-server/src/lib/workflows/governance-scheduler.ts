/**
 * @file   governance-scheduler.ts
 * @phase  P7-B - Automated Snapshot Scheduling & Retention Lifecycle
 *
 * Converts manual governance snapshot capture into a self-sustaining
 * operational history lifecycle via a single-process append-only scheduler.
 *
 * Architecture - three layers:
 *
 *   Layer 1 - Pure model functions (synchronous, no I/O):
 *     • Workspace iteration helpers (ordering, batch bounding)
 *     • Pruning safety model (cutoff computation, eligibility checks)
 *     • Storage governance metrics (pressure estimation)
 *     • Cycle statistics assembly
 *
 *   Layer 2 - DB layer (async, injectable DB client):
 *     • queryActiveWorkspaceIds() - READ-ONLY workspace enumeration
 *     • pruneSnapshotsOlderThan() - bounded DELETE with safety guardrails
 *
 *   Layer 3 - GovernanceSnapshotScheduler (stateful, single-process):
 *     • setTimeout-chain loop - non-reentrant, restart-safe
 *     • runCaptureOnce() - one full cycle: capture all active workspaces + prune
 *     • Singleton export governanceScheduler
 *
 * Safety invariants:
 *   • Pruning only deletes rows older than RETENTION_RAW_DAYS (30 days).
 *   • Pruning never deletes rows newer than PRUNE_MIN_AGE_HOURS (1 hour floor).
 *   • Pruning never deletes future-dated rows (capturedAt > now).
 *   • Each DELETE is bounded to PRUNE_MAX_DELETE_PER_CYCLE rows.
 *   • No UPDATE of any governance_snapshots row - append-only contract preserved.
 *   • Scheduler cycles do not overlap (isCapturing gate).
 *   • Governance scheduler is fully isolated from workflow_executions.
 *
 * Follows the same setTimeout-chain design as WorkflowScheduler (P6-A):
 *   • No setInterval - next cycle starts AFTER the current one finishes.
 *   • Bounded staleness: any workspace is captured within CAPTURE_INTERVAL_MS.
 *   • DB-backed durability: snapshots survive process restarts.
 *   • start() is idempotent - safe to call multiple times.
 */

import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";
import { db as defaultDb, governanceSnapshotsTable, workspacesTable } from "@workspace/db";
import { logger } from "../logger";
import {
  captureGovernanceSnapshot,
  RECOMMENDED_CAPTURE_INTERVAL_MINUTES,
  RECOMMENDED_RETENTION_RAW_DAYS,
} from "./governance-history";
import {
  buildWorkspaceRollups,
  GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE,
  GOVERNANCE_ACTION_ROLLUP_FAILED,
} from "./governance-rollup";

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 - Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How often the governance scheduler runs a capture cycle (ms).
 *
 * Default: 5 minutes (300,000 ms).
 * Derived from RECOMMENDED_CAPTURE_INTERVAL_MINUTES so the two values are
 * always in sync - changing RECOMMENDED_CAPTURE_INTERVAL_MINUTES in
 * governance-history.ts automatically updates the scheduler interval.
 *
 * A value of 5 minutes gives:
 *   • 288 captures/day per workspace
 *   • ~8,640 rows/workspace over 30 days
 *   • Low DB pressure: one evaluation pass per 5 minutes
 */
export const CAPTURE_INTERVAL_MS = RECOMMENDED_CAPTURE_INTERVAL_MINUTES * 60_000;

/**
 * Retention window for raw governance snapshots (days).
 * Rows older than this value are eligible for pruning.
 * Aligned with RECOMMENDED_RETENTION_RAW_DAYS from governance-history.ts.
 */
export const RETENTION_RAW_DAYS = RECOMMENDED_RETENTION_RAW_DAYS;

/**
 * Minimum age (hours) a snapshot must have before it can be pruned.
 *
 * Even if retention is configured very aggressively, snapshots captured
 * within the last PRUNE_MIN_AGE_HOURS are never deleted.  This protects
 * the most recent history from accidental over-pruning due to misconfiguration
 * or clock skew.
 *
 * Default: 1 hour.
 */
export const PRUNE_MIN_AGE_HOURS = 1;

/**
 * Maximum rows deleted per workspace per pruning cycle.
 *
 * Prevents a large backlog (e.g., after scheduler downtime) from generating
 * an unbounded single DELETE that could lock the table or exhaust the
 * statement timeout.  Remaining rows are pruned in subsequent cycles.
 */
export const PRUNE_MAX_DELETE_PER_CYCLE = 500;

/**
 * Maximum number of active workspaces processed per capture cycle.
 *
 * Provides a bounded, pagination-ready iteration model.  In a future
 * multi-page architecture, the scheduler would track an offset and page
 * through all workspaces across consecutive cycles.  For now, bounded at 50
 * which covers the majority of platform deployments.
 */
export const WORKSPACE_BATCH_SIZE = 50;

/**
 * Storage pressure thresholds (total platform snapshots).
 *
 * Used by estimateStoragePressure() to classify overall snapshot volume.
 * Based on 8,640 rows/workspace/30 days:
 *   LOW    < 5  workspaces at capacity → < 43,200 rows
 *   MEDIUM < 15 workspaces at capacity → < 129,600 rows
 *   HIGH   < 30 workspaces at capacity → < 259,200 rows
 *   CRITICAL >= 30 workspaces at capacity
 */
export const STORAGE_PRESSURE_LOW_MAX      = 50_000;
export const STORAGE_PRESSURE_MEDIUM_MAX   = 150_000;
export const STORAGE_PRESSURE_HIGH_MAX     = 300_000;

/** Observability action constants for P7-B events. */
export const GOVERNANCE_ACTION_SCHEDULER_STARTED       = "governance_snapshot_scheduler_started"  as const;
export const GOVERNANCE_ACTION_CYCLE_COMPLETED         = "governance_snapshot_cycle_completed"    as const;
export const GOVERNANCE_ACTION_PRUNING_COMPLETED       = "governance_snapshot_pruning_completed"  as const;
export const GOVERNANCE_ACTION_PRUNING_DRY_RUN         = "governance_snapshot_pruning_dry_run"    as const;
export const GOVERNANCE_ACTION_SCHEDULER_FAILED        = "governance_snapshot_scheduler_failed"   as const;

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 - Types
// ─────────────────────────────────────────────────────────────────────────────

/** Statistics for a single completed capture cycle. */
export interface CycleStats {
  /** Number of active workspaces enumerated in this cycle. */
  workspaceCount:   number;
  /** Number of workspaces for which a snapshot was successfully captured. */
  snapshotCount:    number;
  /** Number of workspaces that failed snapshot capture (non-fatal, logged). */
  failedCount:      number;
  /** Total snapshots deleted across all workspaces this cycle. */
  prunedCount:      number;
  /** Retention window applied during this cycle's pruning pass (days). */
  retentionWindow:  number;
  /** Wall-clock duration of the full cycle (capture + prune). */
  cycleDurationMs:  number;
  /**
   * True if this cycle was skipped because a previous cycle was still running.
   * Prevents overlapping capture passes in high-latency environments.
   */
  skippedOverlap:   boolean;
  /** True if pruning was executed in dry-run mode (no rows deleted). */
  dryRun:           boolean;
}

/** Pruning result for a single workspace. */
export interface PruneSingleWorkspaceResult {
  workspaceId: number;
  /** Rows actually deleted (0 if dryRun=true). */
  deleted:     number;
  /** Rows that are eligible for deletion (counted even in dry-run). */
  eligible:    number;
  dryRun:      boolean;
}

/** Aggregated pruning result across all workspaces in one cycle. */
export interface PruneCycleResult {
  totalPruned:    number;
  totalEligible:  number;
  workspaceCount: number;
  dryRun:         boolean;
  /** ISO 8601 - the cutoff timestamp used for this pruning pass. */
  cutoffDate:     string;
}

/** Storage governance metrics for platform-level observability. */
export interface StorageGovernanceMetrics {
  /** Total governance_snapshots rows across all workspaces. */
  totalSnapshots:           number;
  /** ISO 8601 timestamp of the oldest snapshot on the platform, or null. */
  oldestSnapshotAt:         string | null;
  /** ISO 8601 timestamp of the newest snapshot on the platform, or null. */
  newestSnapshotAt:         string | null;
  /** Qualitative storage pressure classification. */
  estimatedStoragePressure: "low" | "medium" | "high" | "critical";
  /** How many snapshots were pruned in the most recent cycle. */
  snapshotsPrunedLastCycle: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 - Pure model functions (no I/O)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort an array of workspace IDs in ascending order.
 *
 * Deterministic ordering ensures the scheduler visits workspaces in a
 * consistent sequence across restarts.  Does NOT mutate the input array.
 *
 * PURE - deterministic.
 */
export function sortWorkspaceIds(ids: number[]): number[] {
  return [...ids].sort((a, b) => a - b);
}

/**
 * Apply the scheduler's batch-size cap to an already-sorted ID list.
 * Returns the first `limit` IDs - pagination-ready when a full page walk
 * is implemented across consecutive cycles.
 *
 * Does NOT mutate the input array.
 *
 * PURE - deterministic.
 */
export function boundWorkspaceBatch(ids: number[], limit: number = WORKSPACE_BATCH_SIZE): number[] {
  return ids.slice(0, limit);
}

/**
 * Compute the safe pruning cutoff date for governance snapshots.
 *
 * A snapshot row is eligible for deletion when its capturedAt < cutoff.
 *
 * Safety guarantee:
 *   The cutoff is the MORE CONSERVATIVE (earlier in time) of:
 *     1. `retentionDays` ago - the configured retention boundary.
 *     2. `minAgeHours` ago - the minimum-age floor.
 *
 *   This means even if `retentionDays` is somehow misconfigured to 0,
 *   snapshots captured within the last `minAgeHours` hours are never pruned.
 *
 * Additional constraint:
 *   The cutoff is always clamped to <= now to prevent deleting future-dated
 *   rows that were inserted with a capturedAt in the future (clock skew).
 *   (The lte(capturedAt, now) condition in the query provides the same
 *   protection at the DB level - this is belt-and-suspenders.)
 *
 * PURE - injectable `now` for deterministic testing.
 */
export function computePruneCutoff(
  retentionDays: number = RETENTION_RAW_DAYS,
  minAgeHours:   number = PRUNE_MIN_AGE_HOURS,
  now:           Date   = new Date(),
): Date {
  const retentionMs   = retentionDays * 24 * 3_600_000;
  const minAgeMs      = minAgeHours   * 3_600_000;
  const retentionDate = new Date(now.getTime() - retentionMs);
  const minAgeDate    = new Date(now.getTime() - minAgeMs);

  // Use the EARLIER boundary (further from now) - more conservative, smaller prune window.
  // In the normal case (30d retention, 1h min-age): retentionDate << minAgeDate → use retentionDate.
  // Edge case (0d retention): retentionDate ≈ now >> minAgeDate → clamp to minAgeDate (1h ago).
  const cutoff = retentionDate.getTime() <= minAgeDate.getTime() ? retentionDate : minAgeDate;

  // Clamp to now - never produce a future cutoff.
  return cutoff.getTime() > now.getTime() ? now : cutoff;
}

/**
 * Determine whether a single snapshot row is eligible for pruning.
 *
 * A snapshot is eligible when:
 *   1. Its capturedAt < cutoff (older than retention window + min-age floor).
 *   2. Its capturedAt <= now (reject future-dated rows - clock skew protection).
 *
 * PURE - deterministic.
 */
export function isEligibleForPruning(
  capturedAt: Date,
  cutoff:     Date,
  now:        Date = new Date(),
): boolean {
  const ts = capturedAt.getTime();
  return ts < cutoff.getTime() && ts <= now.getTime();
}

/**
 * Assemble a CycleStats object from collected per-workspace results.
 *
 * PURE - deterministic, no side effects.
 */
export function buildCycleStats(
  workspaceCount:  number,
  snapshotCount:   number,
  failedCount:     number,
  prunedCount:     number,
  cycleDurationMs: number,
  options: { retentionWindow?: number; dryRun?: boolean } = {},
): CycleStats {
  return {
    workspaceCount,
    snapshotCount,
    failedCount,
    prunedCount,
    retentionWindow:  options.retentionWindow ?? RETENTION_RAW_DAYS,
    cycleDurationMs,
    skippedOverlap:   false,
    dryRun:           options.dryRun ?? false,
  };
}

/**
 * Build a zero-count CycleStats signalling that this cycle was skipped
 * because a previous capture cycle was still in progress.
 *
 * The non-reentrant gate (isCapturing flag) prevents concurrent capture
 * passes from overlapping.  When the gate is held, a new cycle fires and
 * immediately returns this sentinel rather than starting a second pass.
 *
 * PURE - deterministic.
 */
export function buildOverlapSkipResult(cycleDurationMs: number = 0): CycleStats {
  return {
    workspaceCount:   0,
    snapshotCount:    0,
    failedCount:      0,
    prunedCount:      0,
    retentionWindow:  RETENTION_RAW_DAYS,
    cycleDurationMs,
    skippedOverlap:   true,
    dryRun:           false,
  };
}

/**
 * Aggregate per-workspace prune results into a platform-level PruneCycleResult.
 *
 * PURE - deterministic, no side effects.
 */
export function buildPruneCycleResult(
  results: PruneSingleWorkspaceResult[],
  cutoff:  Date,
  dryRun:  boolean,
): PruneCycleResult {
  const totalPruned   = results.reduce((s, r) => s + r.deleted,  0);
  const totalEligible = results.reduce((s, r) => s + r.eligible, 0);
  return {
    totalPruned,
    totalEligible,
    workspaceCount: results.length,
    dryRun,
    cutoffDate:     cutoff.toISOString(),
  };
}

/**
 * Classify total platform snapshot count into a qualitative storage pressure
 * level for dashboard display and alerting.
 *
 * Thresholds are based on WORKSPACE_BATCH_SIZE workspaces × 8,640 rows each.
 *
 * PURE - deterministic.
 */
export function estimateStoragePressure(
  totalSnapshots: number,
): "low" | "medium" | "high" | "critical" {
  if (totalSnapshots < STORAGE_PRESSURE_LOW_MAX)    return "low";
  if (totalSnapshots < STORAGE_PRESSURE_MEDIUM_MAX) return "medium";
  if (totalSnapshots < STORAGE_PRESSURE_HIGH_MAX)   return "high";
  return "critical";
}

/**
 * Compute platform-level storage governance metrics from aggregated stats.
 *
 * PURE - injectable values for deterministic testing.
 */
export function computeStorageGovernanceMetrics(
  totalSnapshots:           number,
  oldestSnapshotAt:         Date | null,
  newestSnapshotAt:         Date | null,
  snapshotsPrunedLastCycle: number,
): StorageGovernanceMetrics {
  return {
    totalSnapshots,
    oldestSnapshotAt:         oldestSnapshotAt  ? oldestSnapshotAt.toISOString()  : null,
    newestSnapshotAt:         newestSnapshotAt  ? newestSnapshotAt.toISOString()  : null,
    estimatedStoragePressure: estimateStoragePressure(totalSnapshots),
    snapshotsPrunedLastCycle,
  };
}

/**
 * Return the effective retention window in days.
 * Centralised so all callers (scheduler, tests, API responses) use the same value.
 *
 * PURE - deterministic.
 */
export function getEffectiveRetentionDays(): number {
  return RETENTION_RAW_DAYS;
}

/**
 * Compute how many snapshots should exist per workspace at full capacity.
 * Useful for capacity planning displays.
 *
 * PURE - deterministic.
 */
export function estimatedSnapshotsAtCapacity(
  captureIntervalMinutes: number = RECOMMENDED_CAPTURE_INTERVAL_MINUTES,
  retentionDays:          number = RETENTION_RAW_DAYS,
): number {
  const capturesPerDay = (24 * 60) / captureIntervalMinutes;
  return Math.round(capturesPerDay * retentionDays);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 - DB layer (async, injectable DB client)
// ─────────────────────────────────────────────────────────────────────────────

type DbClient = typeof defaultDb;

/**
 * Fetch the IDs of all active workspaces, sorted ascending.
 *
 * Only workspaces with status='active' are included - suspended and disabled
 * workspaces are skipped so governance snapshots are not captured for tenants
 * that are not actively using the platform.
 *
 * Results are bounded by `limit` (default: WORKSPACE_BATCH_SIZE) for
 * pagination-ready iteration.  In a future multi-page implementation, an
 * offset parameter would enable walking all workspaces across consecutive cycles.
 *
 * READ-ONLY.
 */
export async function queryActiveWorkspaceIds(
  database: DbClient = defaultDb,
  limit:    number   = WORKSPACE_BATCH_SIZE,
): Promise<number[]> {
  const rows = await database
    .select({ id: workspacesTable.id })
    .from(workspacesTable)
    .where(eq(workspacesTable.status, "active"))
    .orderBy(asc(workspacesTable.id))
    .limit(limit);

  return rows.map(r => r.id);
}

/**
 * Delete governance snapshots older than the given cutoff for one workspace.
 *
 * SAFETY GUARANTEES:
 *   1. Only deletes rows WHERE capturedAt < cutoff (older than retention window).
 *   2. Only deletes rows WHERE capturedAt <= now (rejects future-dated rows).
 *   3. Bounded to `maxDelete` rows per call - prevents runaway DELETEs.
 *   4. dryRun=true counts eligible rows but performs zero deletions.
 *
 * APPEND-ONLY PROMISE:
 *   This is the ONLY application code path that DELETEs governance_snapshots rows.
 *   It does not touch rows inside the retention window.
 *   All surviving rows remain immutable - no UPDATE is ever performed.
 *
 * Implementation uses SELECT-then-DELETE (by primary key) because Drizzle ORM
 * does not support LIMIT on DELETE for PostgreSQL.  The SELECT result set is
 * bounded by `maxDelete` before the DELETE runs - achieving the same safety.
 */
export async function pruneSnapshotsOlderThan(
  workspaceId: number,
  cutoff:      Date,
  now:         Date     = new Date(),
  maxDelete:   number   = PRUNE_MAX_DELETE_PER_CYCLE,
  dryRun:      boolean  = false,
  database:    DbClient = defaultDb,
): Promise<PruneSingleWorkspaceResult> {
  // Fetch IDs of eligible rows (bounded)
  const eligible = await database
    .select({ id: governanceSnapshotsTable.id })
    .from(governanceSnapshotsTable)
    .where(and(
      eq(governanceSnapshotsTable.workspaceId, workspaceId),
      lt(governanceSnapshotsTable.capturedAt,  cutoff),  // older than retention window
      lte(governanceSnapshotsTable.capturedAt, now),     // exclude future-dated rows
    ))
    .limit(maxDelete);

  if (eligible.length === 0) {
    return { workspaceId, deleted: 0, eligible: 0, dryRun };
  }

  // Dry-run: return count without deleting
  if (dryRun) {
    return { workspaceId, deleted: 0, eligible: eligible.length, dryRun: true };
  }

  // Real deletion - bounded to the SELECT result set
  const deleted = await database
    .delete(governanceSnapshotsTable)
    .where(inArray(governanceSnapshotsTable.id, eligible.map(r => r.id)))
    .returning({ id: governanceSnapshotsTable.id });

  return { workspaceId, deleted: deleted.length, eligible: eligible.length, dryRun: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 - GovernanceSnapshotScheduler (Layer 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Self-sustaining governance snapshot lifecycle scheduler.
 *
 * Runs a periodic capture-and-prune cycle for every active workspace.
 * Each cycle:
 *   1. Queries active workspace IDs (bounded, sorted ascending).
 *   2. Calls captureGovernanceSnapshot() for each workspace (append-only).
 *   3. Calls pruneSnapshotsOlderThan() for each workspace (bounded DELETE).
 *   4. Emits structured observability events.
 *
 * Design follows WorkflowScheduler (P6-A) exactly:
 *   • setTimeout chain (NOT setInterval): next cycle starts AFTER current completes.
 *   • Non-reentrant: isCapturing gate prevents overlapping cycles.
 *   • start() idempotent: calling start() on a running scheduler is a no-op.
 *   • stop() non-destructive: in-flight cycle completes, next is cancelled.
 *   • Restart-safe: all state lives in the DB, no in-memory timers to recover.
 */
export class GovernanceSnapshotScheduler {
  private timer:       ReturnType<typeof setTimeout> | null = null;
  private running:     boolean = false;
  /**
   * Non-reentrant capture gate.
   *
   * Set to true at the start of runCaptureOnce() and released in the finally
   * block.  If a new cycle fires while the gate is held (because a previous
   * cycle took longer than CAPTURE_INTERVAL_MS), the new cycle returns a
   * buildOverlapSkipResult() immediately without starting a second pass.
   *
   * This is the primary mechanism that prevents overlapping capture cycles
   * from writing duplicate snapshots or generating conflicting pruning passes.
   */
  private isCapturing: boolean = false;

  /**
   * Start the scheduler loop.
   * Idempotent - calling start() on an already-running scheduler is a no-op.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    logger.info(
      {
        captureIntervalMs: CAPTURE_INTERVAL_MS,
        retentionDays:     RETENTION_RAW_DAYS,
        workspaceBatchSize: WORKSPACE_BATCH_SIZE,
        pruneMaxPerCycle:  PRUNE_MAX_DELETE_PER_CYCLE,
        action:            GOVERNANCE_ACTION_SCHEDULER_STARTED,
      },
      "[governance-scheduler] P7-B: Governance snapshot scheduler started",
    );

    this._schedule();
  }

  /**
   * Stop the scheduler loop.
   * Any in-flight cycle completes naturally - stop() cancels the next scheduled
   * cycle and clears the running flag.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    logger.info(
      { action: "governance_snapshot_scheduler_stopped" },
      "[governance-scheduler] P7-B: Governance snapshot scheduler stopped",
    );
  }

  /**
   * Execute one full capture + prune cycle.
   *
   * Steps:
   *   1. Acquire the non-reentrant gate (isCapturing).
   *   2. Query active workspace IDs (bounded batch, sorted ascending).
   *   3. For each workspace: call captureGovernanceSnapshot() - append-only.
   *      Per-workspace errors are caught and counted (non-fatal - other workspaces proceed).
   *   4. Run pruning pass across the same workspace batch.
   *      Per-workspace prune errors are caught and counted (non-fatal).
   *   5. Emit governance_snapshot_cycle_completed and
   *      governance_snapshot_pruning_completed / governance_snapshot_pruning_dry_run.
   *   6. Release the gate.
   *
   * @param now     Injectable time reference for testing (defaults to new Date()).
   * @param options { dryRun: boolean } - when true, pruning counts but does not delete.
   */
  async runCaptureOnce(
    now:     Date                = new Date(),
    options: { dryRun?: boolean } = {},
  ): Promise<CycleStats> {
    const dryRun = options.dryRun ?? false;

    // ── Non-reentrant gate ─────────────────────────────────────────────────────
    if (this.isCapturing) {
      logger.warn(
        {
          action: "governance_snapshot_cycle_overlap_skipped",
        },
        "[governance-scheduler] P7-B: Capture cycle skipped - previous cycle still running",
      );
      return buildOverlapSkipResult(0);
    }

    this.isCapturing = true;
    const cycleStart = Date.now();

    let workspaceIds: number[] = [];
    let snapshotCount          = 0;
    let failedCount            = 0;
    const pruneResults: PruneSingleWorkspaceResult[] = [];

    try {
      // ── Step 1: Enumerate active workspaces ──────────────────────────────────
      workspaceIds = await queryActiveWorkspaceIds(defaultDb, WORKSPACE_BATCH_SIZE);
      // Apply deterministic sort (queryActiveWorkspaceIds already ORDER BY id ASC,
      // but sortWorkspaceIds provides an in-memory guarantee for tests and restarts)
      workspaceIds = sortWorkspaceIds(workspaceIds);

      // ── Step 2: Capture snapshot for each workspace ──────────────────────────
      for (const wsId of workspaceIds) {
        try {
          await captureGovernanceSnapshot(wsId, defaultDb, now);
          snapshotCount++;
        } catch (err: unknown) {
          failedCount++;
          logger.error(
            {
              workspaceId: wsId,
              error:  err instanceof Error ? err.message : String(err),
              action: GOVERNANCE_ACTION_SCHEDULER_FAILED,
            },
            "[governance-scheduler] P7-B: Failed to capture snapshot for workspace - continuing",
          );
        }
      }

      // ── Step 3: Rollup pass (P7-C) - must complete before pruning ───────────
      //
      // For each workspace, build historical rollups in the overlap zone around
      // the raw retention boundary.  The returned success flag is used in step 4
      // to gate pruning: if rollup fails for a workspace, pruning is SKIPPED for
      // that workspace to preserve raw history.
      //
      // Safety rule (P7-C spec §6): raw pruning NEVER happens before rollup success.
      const rollupSuccessSet = new Set<number>();

      for (const wsId of workspaceIds) {
        try {
          const result = await buildWorkspaceRollups(wsId, now, defaultDb);
          if (result.success) {
            rollupSuccessSet.add(wsId);
            logger.info(
              {
                workspaceId:   wsId,
                hourlyBuilt:   result.hourlyBuilt,
                dailyBuilt:    result.dailyBuilt,
                action:        GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE,
              },
              "[governance-scheduler] P7-C: Rollup succeeded - pruning is safe for workspace",
            );
          } else {
            logger.error(
              {
                workspaceId: wsId,
                error:       result.error,
                action:      GOVERNANCE_ACTION_ROLLUP_FAILED,
              },
              "[governance-scheduler] P7-C: Rollup failed - pruning skipped for workspace",
            );
          }
        } catch (err: unknown) {
          logger.error(
            {
              workspaceId: wsId,
              error:  err instanceof Error ? err.message : String(err),
              action: GOVERNANCE_ACTION_ROLLUP_FAILED,
            },
            "[governance-scheduler] P7-C: Rollup threw - pruning skipped for workspace",
          );
        }
      }

      // ── Step 4: Pruning pass - only for workspaces where rollup succeeded ───
      const cutoff = computePruneCutoff(RETENTION_RAW_DAYS, PRUNE_MIN_AGE_HOURS, now);

      for (const wsId of workspaceIds) {
        // P7-C safety rule: skip pruning if rollup did not succeed for this workspace.
        if (!rollupSuccessSet.has(wsId)) continue;

        try {
          const result = await pruneSnapshotsOlderThan(
            wsId,
            cutoff,
            now,
            PRUNE_MAX_DELETE_PER_CYCLE,
            dryRun,
            defaultDb,
          );
          pruneResults.push(result);
        } catch (err: unknown) {
          logger.error(
            {
              workspaceId: wsId,
              error:  err instanceof Error ? err.message : String(err),
              action: GOVERNANCE_ACTION_SCHEDULER_FAILED,
            },
            "[governance-scheduler] P7-B: Failed to prune snapshots for workspace - continuing",
          );
        }
      }

      // ── Step 5: Aggregate prune stats ────────────────────────────────────────
      const pruneResult = buildPruneCycleResult(pruneResults, cutoff, dryRun);
      const cycleDuration = Date.now() - cycleStart;
      const stats = buildCycleStats(
        workspaceIds.length,
        snapshotCount,
        failedCount,
        pruneResult.totalPruned,
        cycleDuration,
        { retentionWindow: RETENTION_RAW_DAYS, dryRun },
      );

      // ── Step 5: Observability ────────────────────────────────────────────────
      logger.info(
        {
          workspaceCount:   stats.workspaceCount,
          snapshotCount:    stats.snapshotCount,
          failedCount:      stats.failedCount,
          cycleDurationMs:  stats.cycleDurationMs,
          retentionWindow:  stats.retentionWindow,
          action:           GOVERNANCE_ACTION_CYCLE_COMPLETED,
        },
        "[governance-scheduler] P7-B: Governance snapshot cycle completed",
      );

      const pruneAction = dryRun
        ? GOVERNANCE_ACTION_PRUNING_DRY_RUN
        : GOVERNANCE_ACTION_PRUNING_COMPLETED;

      const pruneLogFn = dryRun ? logger.info.bind(logger) : logger.info.bind(logger);
      pruneLogFn(
        {
          workspaceCount:   pruneResult.workspaceCount,
          prunedCount:      pruneResult.totalPruned,
          eligibleCount:    pruneResult.totalEligible,
          retentionWindow:  RETENTION_RAW_DAYS,
          cutoffDate:       pruneResult.cutoffDate,
          dryRun,
          action:           pruneAction,
        },
        dryRun
          ? "[governance-scheduler] P7-B: Governance snapshot pruning dry-run completed"
          : "[governance-scheduler] P7-B: Governance snapshot pruning completed",
      );

      return stats;

    } finally {
      this.isCapturing = false;
    }
  }

  /**
   * Schedule the next capture cycle via setTimeout.
   *
   * Using setTimeout (NOT setInterval) ensures the next cycle starts only
   * AFTER the current one completes.  If a cycle takes 4 minutes, the next
   * cycle starts 5 minutes after the previous one finished - not 1 minute later.
   * This prevents unbounded overlap even under heavy load.
   */
  private _schedule(): void {
    if (!this.running) return;

    this.timer = setTimeout(() => {
      void this.runCaptureOnce()
        .catch((err: unknown) => {
          logger.error(
            {
              err,
              action: GOVERNANCE_ACTION_SCHEDULER_FAILED,
            },
            "[governance-scheduler] P7-B: Unexpected error in capture cycle",
          );
        })
        .finally(() => {
          this._schedule();
        });
    }, CAPTURE_INTERVAL_MS);
  }
}

/**
 * Singleton governance snapshot scheduler.
 *
 * Started from init-sequence.ts after the workflow engine starts.
 * The same instance is accessible for testing via runCaptureOnce() without
 * start()/stop() (mirror of the P6-A workflowScheduler pattern).
 */
export const governanceScheduler = new GovernanceSnapshotScheduler();
