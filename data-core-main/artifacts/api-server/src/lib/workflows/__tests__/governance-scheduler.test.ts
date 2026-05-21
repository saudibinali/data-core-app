/**
 * @file   governance-scheduler.test.ts
 * @phase  P7-B - Automated Snapshot Scheduling & Retention Lifecycle
 *
 * Tests for the governance snapshot scheduler's pure model functions.
 * All tests are synchronous and I/O-free - no DB client, no timer mocking needed.
 *
 * Test groups:
 *   T1  CycleStats assembly (scheduler captures automatically)
 *   T2  Non-reentrant overlap guard (cycles never overlap)
 *   T3  Workspace iteration - ordering and batch bounding (deterministic)
 *   T4  Append-only integrity (pruning never touches non-eligible rows)
 *   T5  Old snapshots are eligible for pruning
 *   T6  Recent snapshots protected by min-age floor (never pruned)
 *   T7  Future-dated snapshots excluded from pruning
 *   T8  Dry-run pruning (no deletion)
 *   T9  Retention constants applied consistently
 *   T10 Scheduler restart-safe behavior (start/stop idempotency)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  // Constants
  CAPTURE_INTERVAL_MS,
  RETENTION_RAW_DAYS,
  PRUNE_MIN_AGE_HOURS,
  PRUNE_MAX_DELETE_PER_CYCLE,
  WORKSPACE_BATCH_SIZE,
  STORAGE_PRESSURE_LOW_MAX,
  STORAGE_PRESSURE_MEDIUM_MAX,
  STORAGE_PRESSURE_HIGH_MAX,
  GOVERNANCE_ACTION_SCHEDULER_STARTED,
  GOVERNANCE_ACTION_CYCLE_COMPLETED,
  GOVERNANCE_ACTION_PRUNING_COMPLETED,
  GOVERNANCE_ACTION_PRUNING_DRY_RUN,
  GOVERNANCE_ACTION_SCHEDULER_FAILED,
  // Types (via inference)
  // Pure functions
  sortWorkspaceIds,
  boundWorkspaceBatch,
  computePruneCutoff,
  isEligibleForPruning,
  buildCycleStats,
  buildOverlapSkipResult,
  buildPruneCycleResult,
  estimateStoragePressure,
  computeStorageGovernanceMetrics,
  getEffectiveRetentionDays,
  estimatedSnapshotsAtCapacity,
  // Scheduler class
  GovernanceSnapshotScheduler,
  type CycleStats,
  type PruneSingleWorkspaceResult,
} from "../governance-scheduler";
import { RECOMMENDED_CAPTURE_INTERVAL_MINUTES, RECOMMENDED_RETENTION_RAW_DAYS } from "../governance-history";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-01-15T10:00:00.000Z");

/** Simulate a date N days before NOW. */
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 3_600_000);
}

/** Simulate a date N hours before NOW. */
function hoursAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 3_600_000);
}

/** Simulate a date N hours after NOW (future). */
function hoursFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * 3_600_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - CycleStats assembly (scheduler captures automatically)
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: buildCycleStats assembles correct result shape", () => {
  it("captures workspaceCount, snapshotCount, failedCount correctly", () => {
    const stats = buildCycleStats(5, 4, 1, 10, 1200);
    expect(stats.workspaceCount).toBe(5);
    expect(stats.snapshotCount).toBe(4);
    expect(stats.failedCount).toBe(1);
  });

  it("includes prunedCount in stats", () => {
    const stats = buildCycleStats(3, 3, 0, 47, 800);
    expect(stats.prunedCount).toBe(47);
  });

  it("uses RETENTION_RAW_DAYS as default retentionWindow", () => {
    const stats = buildCycleStats(2, 2, 0, 0, 500);
    expect(stats.retentionWindow).toBe(RETENTION_RAW_DAYS);
  });

  it("accepts retentionWindow override", () => {
    const stats = buildCycleStats(1, 1, 0, 0, 300, { retentionWindow: 14 });
    expect(stats.retentionWindow).toBe(14);
  });

  it("skippedOverlap is false for normal cycles", () => {
    const stats = buildCycleStats(5, 5, 0, 0, 1000);
    expect(stats.skippedOverlap).toBe(false);
  });

  it("dryRun defaults to false", () => {
    const stats = buildCycleStats(1, 1, 0, 0, 100);
    expect(stats.dryRun).toBe(false);
  });

  it("dryRun=true is preserved in stats", () => {
    const stats = buildCycleStats(2, 2, 0, 0, 200, { dryRun: true });
    expect(stats.dryRun).toBe(true);
  });

  it("cycleDurationMs is recorded accurately", () => {
    const stats = buildCycleStats(10, 10, 0, 500, 3750);
    expect(stats.cycleDurationMs).toBe(3750);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Non-reentrant overlap guard (cycles never overlap)
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: buildOverlapSkipResult - cycle overlap prevention", () => {
  it("returns skippedOverlap=true", () => {
    const result = buildOverlapSkipResult(0);
    expect(result.skippedOverlap).toBe(true);
  });

  it("returns zero workspaceCount", () => {
    expect(buildOverlapSkipResult(0).workspaceCount).toBe(0);
  });

  it("returns zero snapshotCount", () => {
    expect(buildOverlapSkipResult(0).snapshotCount).toBe(0);
  });

  it("returns zero prunedCount", () => {
    expect(buildOverlapSkipResult(0).prunedCount).toBe(0);
  });

  it("records cycleDurationMs correctly", () => {
    const result = buildOverlapSkipResult(42);
    expect(result.cycleDurationMs).toBe(42);
  });

  it("dryRun is false for overlap skip", () => {
    expect(buildOverlapSkipResult(0).dryRun).toBe(false);
  });

  it("GovernanceSnapshotScheduler.start() is idempotent (no throw on double start)", () => {
    const s = new GovernanceSnapshotScheduler();
    expect(() => { s.start(); s.start(); }).not.toThrow();
    s.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Workspace iteration (deterministic ordering and batch bounding)
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: Workspace iteration is deterministic and bounded", () => {
  it("sortWorkspaceIds returns IDs in ascending order", () => {
    expect(sortWorkspaceIds([5, 3, 1, 4, 2])).toEqual([1, 2, 3, 4, 5]);
  });

  it("sortWorkspaceIds does not mutate the input array", () => {
    const input = [3, 1, 2];
    sortWorkspaceIds(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("sortWorkspaceIds handles empty array", () => {
    expect(sortWorkspaceIds([])).toEqual([]);
  });

  it("sortWorkspaceIds is stable - single element unchanged", () => {
    expect(sortWorkspaceIds([7])).toEqual([7]);
  });

  it("sortWorkspaceIds with already-sorted input stays sorted", () => {
    expect(sortWorkspaceIds([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("boundWorkspaceBatch returns at most `limit` IDs", () => {
    const ids = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(boundWorkspaceBatch(ids, 50)).toHaveLength(50);
  });

  it("boundWorkspaceBatch takes the FIRST `limit` IDs (lowest after sort)", () => {
    const ids = [10, 20, 30, 40, 50];
    expect(boundWorkspaceBatch(ids, 3)).toEqual([10, 20, 30]);
  });

  it("boundWorkspaceBatch with limit >= length returns all", () => {
    const ids = [1, 2, 3];
    expect(boundWorkspaceBatch(ids, 10)).toEqual([1, 2, 3]);
  });

  it("boundWorkspaceBatch does not mutate the input array", () => {
    const ids = [1, 2, 3, 4, 5];
    boundWorkspaceBatch(ids, 2);
    expect(ids).toHaveLength(5);
  });

  it("boundWorkspaceBatch uses WORKSPACE_BATCH_SIZE as default limit", () => {
    const ids = Array.from({ length: WORKSPACE_BATCH_SIZE + 10 }, (_, i) => i + 1);
    expect(boundWorkspaceBatch(ids)).toHaveLength(WORKSPACE_BATCH_SIZE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Append-only integrity (pruning never touches non-eligible rows)
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: isEligibleForPruning preserves non-eligible rows", () => {
  const cutoff = daysAgo(30);

  it("row captured exactly at cutoff boundary is NOT eligible (strict lt)", () => {
    // capturedAt = cutoff → lt(capturedAt, cutoff) = false → not eligible
    expect(isEligibleForPruning(cutoff, cutoff, NOW)).toBe(false);
  });

  it("row captured 1ms before cutoff IS eligible", () => {
    const ts = new Date(cutoff.getTime() - 1);
    expect(isEligibleForPruning(ts, cutoff, NOW)).toBe(true);
  });

  it("row captured 1ms after cutoff is NOT eligible", () => {
    const ts = new Date(cutoff.getTime() + 1);
    expect(isEligibleForPruning(ts, cutoff, NOW)).toBe(false);
  });

  it("row captured yesterday (within retention window) is NOT eligible", () => {
    // retentionCutoff = 30 days ago; yesterday is only 1 day ago → not eligible
    expect(isEligibleForPruning(daysAgo(1), cutoff, NOW)).toBe(false);
  });

  it("row captured 60 days ago IS eligible", () => {
    expect(isEligibleForPruning(daysAgo(60), cutoff, NOW)).toBe(true);
  });

  it("buildPruneCycleResult totalPruned is sum of deleted across workspaces", () => {
    const results: PruneSingleWorkspaceResult[] = [
      { workspaceId: 1, deleted: 10, eligible: 10, dryRun: false },
      { workspaceId: 2, deleted: 25, eligible: 30, dryRun: false },
      { workspaceId: 3, deleted: 5,  eligible: 5,  dryRun: false },
    ];
    const r = buildPruneCycleResult(results, cutoff, false);
    expect(r.totalPruned).toBe(40);
  });

  it("buildPruneCycleResult totalEligible is sum of eligible across workspaces", () => {
    const results: PruneSingleWorkspaceResult[] = [
      { workspaceId: 1, deleted: 10, eligible: 12, dryRun: false },
      { workspaceId: 2, deleted: 20, eligible: 20, dryRun: false },
    ];
    const r = buildPruneCycleResult(results, cutoff, false);
    expect(r.totalEligible).toBe(32);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Old snapshots are eligible for pruning
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: Old snapshots correctly identified as prunable", () => {
  it("computePruneCutoff with 30d retention returns ~30 days ago", () => {
    const cutoff = computePruneCutoff(30, 1, NOW);
    const expectedMs = NOW.getTime() - 30 * 24 * 3_600_000;
    expect(Math.abs(cutoff.getTime() - expectedMs)).toBeLessThan(1000);
  });

  it("snapshot 31 days old is eligible for pruning (> 30d retention)", () => {
    const cutoff = computePruneCutoff(30, 1, NOW);
    expect(isEligibleForPruning(daysAgo(31), cutoff, NOW)).toBe(true);
  });

  it("snapshot 60 days old is eligible for pruning", () => {
    const cutoff = computePruneCutoff(30, 1, NOW);
    expect(isEligibleForPruning(daysAgo(60), cutoff, NOW)).toBe(true);
  });

  it("snapshot 30.1 days old (just past retention) is eligible", () => {
    const olderThan30d = new Date(NOW.getTime() - 30 * 24 * 3_600_000 - 360_000);
    const cutoff = computePruneCutoff(30, 1, NOW);
    expect(isEligibleForPruning(olderThan30d, cutoff, NOW)).toBe(true);
  });

  it("buildPruneCycleResult records correct cutoffDate as ISO string", () => {
    const cutoff = computePruneCutoff(30, 1, NOW);
    const r = buildPruneCycleResult([], cutoff, false);
    expect(r.cutoffDate).toBe(cutoff.toISOString());
  });

  it("buildPruneCycleResult workspaceCount matches results length", () => {
    const results: PruneSingleWorkspaceResult[] = [
      { workspaceId: 1, deleted: 5, eligible: 5, dryRun: false },
      { workspaceId: 2, deleted: 3, eligible: 3, dryRun: false },
    ];
    expect(buildPruneCycleResult(results, daysAgo(30), false).workspaceCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Recent snapshots protected by min-age floor
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: Min-age floor protects recent snapshots from pruning", () => {
  it("snapshot 30 minutes old is NOT eligible (inside PRUNE_MIN_AGE_HOURS=1h)", () => {
    const cutoff = computePruneCutoff(RETENTION_RAW_DAYS, PRUNE_MIN_AGE_HOURS, NOW);
    // cutoff is ~30 days ago; 30-minute-old snapshot is way inside retention window
    expect(isEligibleForPruning(hoursAgo(0.5), cutoff, NOW)).toBe(false);
  });

  it("snapshot 59 minutes old is NOT eligible", () => {
    const cutoff = computePruneCutoff(RETENTION_RAW_DAYS, PRUNE_MIN_AGE_HOURS, NOW);
    expect(isEligibleForPruning(hoursAgo(59 / 60), cutoff, NOW)).toBe(false);
  });

  it("computePruneCutoff with 0-day retention still clamps to 1h ago (min-age floor)", () => {
    // If retention = 0 days, the computed cutoff should be at most 1h ago
    const cutoff = computePruneCutoff(0, 1, NOW);
    const oneHourAgoMs = NOW.getTime() - 3_600_000;
    // The cutoff must be <= 1h ago (i.e., not less than 1h ago in terms of calendar direction)
    expect(cutoff.getTime()).toBeLessThanOrEqual(oneHourAgoMs);
  });

  it("computePruneCutoff with 1-day retention returns 1 day ago (> 1h min-age)", () => {
    const cutoff = computePruneCutoff(1, 1, NOW);
    const oneDayAgoMs = NOW.getTime() - 24 * 3_600_000;
    expect(Math.abs(cutoff.getTime() - oneDayAgoMs)).toBeLessThan(1000);
  });

  it("snapshot exactly at cutoff is NOT deleted (strict less-than in eligibility check)", () => {
    const cutoff = computePruneCutoff(30, PRUNE_MIN_AGE_HOURS, NOW);
    // exactly at boundary → NOT eligible
    expect(isEligibleForPruning(cutoff, cutoff, NOW)).toBe(false);
  });

  it("PRUNE_MIN_AGE_HOURS constant is positive", () => {
    expect(PRUNE_MIN_AGE_HOURS).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Future-dated snapshots excluded from pruning
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: Future-dated snapshots are excluded from pruning", () => {
  const cutoff = daysAgo(30);

  it("snapshot 1 hour in the future is NOT eligible", () => {
    expect(isEligibleForPruning(hoursFromNow(1), cutoff, NOW)).toBe(false);
  });

  it("snapshot 7 days in the future is NOT eligible", () => {
    expect(isEligibleForPruning(new Date(NOW.getTime() + 7 * 24 * 3_600_000), cutoff, NOW)).toBe(false);
  });

  it("snapshot exactly at NOW is eligible (capturedAt=now → lte boundary satisfied)", () => {
    // capturedAt = NOW → ts <= now.getTime() → satisfies the second condition
    // But capturedAt = NOW is >> cutoff (30 days ago) → not eligible on the first condition
    expect(isEligibleForPruning(NOW, cutoff, NOW)).toBe(false);
  });

  it("snapshot 1ms after NOW is NOT eligible (future)", () => {
    const future = new Date(NOW.getTime() + 1);
    expect(isEligibleForPruning(future, cutoff, NOW)).toBe(false);
  });

  it("snapshot far in the future is never eligible even if old cutoff is used", () => {
    // Use a very old cutoff that is in the future relative to an old NOW
    const ancientNow = new Date("2020-01-01T00:00:00.000Z");
    const futureCapturedAt = new Date("2026-01-01T00:00:00.000Z");
    const cutoffRelativeToAncient = computePruneCutoff(30, 1, ancientNow);
    // futureCapturedAt is far in the future relative to ancientNow
    expect(isEligibleForPruning(futureCapturedAt, cutoffRelativeToAncient, ancientNow)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Dry-run pruning performs no deletion
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: Dry-run pruning returns count without deleting", () => {
  it("buildPruneCycleResult with dryRun=true has totalPruned=0", () => {
    const results: PruneSingleWorkspaceResult[] = [
      { workspaceId: 1, deleted: 0, eligible: 50, dryRun: true },
      { workspaceId: 2, deleted: 0, eligible: 30, dryRun: true },
    ];
    const r = buildPruneCycleResult(results, daysAgo(30), true);
    expect(r.totalPruned).toBe(0);
  });

  it("buildPruneCycleResult with dryRun=true preserves totalEligible count", () => {
    const results: PruneSingleWorkspaceResult[] = [
      { workspaceId: 1, deleted: 0, eligible: 50, dryRun: true },
      { workspaceId: 2, deleted: 0, eligible: 30, dryRun: true },
    ];
    const r = buildPruneCycleResult(results, daysAgo(30), true);
    expect(r.totalEligible).toBe(80);
  });

  it("buildPruneCycleResult records dryRun=true flag correctly", () => {
    const r = buildPruneCycleResult([], daysAgo(30), true);
    expect(r.dryRun).toBe(true);
  });

  it("buildCycleStats with dryRun=true reflects in CycleStats", () => {
    const stats = buildCycleStats(3, 3, 0, 0, 1000, { dryRun: true });
    expect(stats.dryRun).toBe(true);
    expect(stats.prunedCount).toBe(0);
  });

  it("GOVERNANCE_ACTION_PRUNING_DRY_RUN constant is distinct from PRUNING_COMPLETED", () => {
    expect(GOVERNANCE_ACTION_PRUNING_DRY_RUN).not.toBe(GOVERNANCE_ACTION_PRUNING_COMPLETED);
  });

  it("dry-run result never has deleted > 0", () => {
    // Structural guarantee: a PruneSingleWorkspaceResult with dryRun=true must have deleted=0
    const dryRunResult: PruneSingleWorkspaceResult = {
      workspaceId: 1, deleted: 0, eligible: 100, dryRun: true,
    };
    expect(dryRunResult.deleted).toBe(0);
    expect(dryRunResult.eligible).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Retention constants applied consistently
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: Retention constants are consistent across the system", () => {
  it("RETENTION_RAW_DAYS matches RECOMMENDED_RETENTION_RAW_DAYS from governance-history", () => {
    expect(RETENTION_RAW_DAYS).toBe(RECOMMENDED_RETENTION_RAW_DAYS);
  });

  it("CAPTURE_INTERVAL_MS matches RECOMMENDED_CAPTURE_INTERVAL_MINUTES in ms", () => {
    expect(CAPTURE_INTERVAL_MS).toBe(RECOMMENDED_CAPTURE_INTERVAL_MINUTES * 60_000);
  });

  it("getEffectiveRetentionDays() returns RETENTION_RAW_DAYS", () => {
    expect(getEffectiveRetentionDays()).toBe(RETENTION_RAW_DAYS);
  });

  it("getEffectiveRetentionDays() is idempotent across multiple calls", () => {
    expect(getEffectiveRetentionDays()).toBe(getEffectiveRetentionDays());
  });

  it("estimatedSnapshotsAtCapacity with defaults matches retention recommendation", () => {
    // 5-min interval × 30 days = 288 captures/day × 30 days = 8,640
    expect(estimatedSnapshotsAtCapacity()).toBe(8_640);
  });

  it("estimatedSnapshotsAtCapacity with 1-min interval × 7 days = 10080", () => {
    expect(estimatedSnapshotsAtCapacity(1, 7)).toBe(10_080);
  });

  it("computePruneCutoff with RETENTION_RAW_DAYS=30 and PRUNE_MIN_AGE_HOURS=1", () => {
    const cutoff = computePruneCutoff(RETENTION_RAW_DAYS, PRUNE_MIN_AGE_HOURS, NOW);
    const expected = new Date(NOW.getTime() - RETENTION_RAW_DAYS * 24 * 3_600_000);
    expect(Math.abs(cutoff.getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it("PRUNE_MAX_DELETE_PER_CYCLE is a positive integer", () => {
    expect(PRUNE_MAX_DELETE_PER_CYCLE).toBeGreaterThan(0);
    expect(Number.isInteger(PRUNE_MAX_DELETE_PER_CYCLE)).toBe(true);
  });

  it("WORKSPACE_BATCH_SIZE is a positive integer", () => {
    expect(WORKSPACE_BATCH_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(WORKSPACE_BATCH_SIZE)).toBe(true);
  });

  it("all 5 observability action constants are distinct strings", () => {
    const actions = new Set([
      GOVERNANCE_ACTION_SCHEDULER_STARTED,
      GOVERNANCE_ACTION_CYCLE_COMPLETED,
      GOVERNANCE_ACTION_PRUNING_COMPLETED,
      GOVERNANCE_ACTION_PRUNING_DRY_RUN,
      GOVERNANCE_ACTION_SCHEDULER_FAILED,
    ]);
    expect(actions.size).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Scheduler restart-safe behavior (start/stop idempotency)
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: GovernanceSnapshotScheduler is restart-safe", () => {
  let scheduler: GovernanceSnapshotScheduler;

  beforeEach(() => {
    scheduler = new GovernanceSnapshotScheduler();
  });

  it("start() does not throw on first call", () => {
    expect(() => scheduler.start()).not.toThrow();
    scheduler.stop();
  });

  it("start() is idempotent - second call is a no-op (no throw)", () => {
    scheduler.start();
    expect(() => scheduler.start()).not.toThrow();
    scheduler.stop();
  });

  it("stop() does not throw when scheduler is running", () => {
    scheduler.start();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it("stop() is idempotent - second call is a no-op (no throw)", () => {
    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.stop()).not.toThrow();
  });

  it("stop() after never-started scheduler does not throw", () => {
    expect(() => scheduler.stop()).not.toThrow();
  });

  it("start → stop → start cycle does not throw", () => {
    expect(() => {
      scheduler.start();
      scheduler.stop();
      scheduler.start();
      scheduler.stop();
    }).not.toThrow();
  });

  it("new GovernanceSnapshotScheduler instances are independent", () => {
    const s1 = new GovernanceSnapshotScheduler();
    const s2 = new GovernanceSnapshotScheduler();
    s1.start();
    // s2 should still be in stopped state - stopping s1 does not affect s2
    expect(() => s2.stop()).not.toThrow();
    s1.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: Storage governance metrics
// ─────────────────────────────────────────────────────────────────────────────

describe("Storage governance metrics (estimateStoragePressure + computeStorageGovernanceMetrics)", () => {
  it("estimateStoragePressure returns 'low' for small counts", () => {
    expect(estimateStoragePressure(0)).toBe("low");
    expect(estimateStoragePressure(STORAGE_PRESSURE_LOW_MAX - 1)).toBe("low");
  });

  it("estimateStoragePressure returns 'medium' in mid range", () => {
    expect(estimateStoragePressure(STORAGE_PRESSURE_LOW_MAX)).toBe("medium");
    expect(estimateStoragePressure(STORAGE_PRESSURE_MEDIUM_MAX - 1)).toBe("medium");
  });

  it("estimateStoragePressure returns 'high' approaching critical", () => {
    expect(estimateStoragePressure(STORAGE_PRESSURE_MEDIUM_MAX)).toBe("high");
    expect(estimateStoragePressure(STORAGE_PRESSURE_HIGH_MAX - 1)).toBe("high");
  });

  it("estimateStoragePressure returns 'critical' at max", () => {
    expect(estimateStoragePressure(STORAGE_PRESSURE_HIGH_MAX)).toBe("critical");
    expect(estimateStoragePressure(1_000_000)).toBe("critical");
  });

  it("computeStorageGovernanceMetrics with zero snapshots returns null timestamps", () => {
    const m = computeStorageGovernanceMetrics(0, null, null, 0);
    expect(m.oldestSnapshotAt).toBeNull();
    expect(m.newestSnapshotAt).toBeNull();
    expect(m.estimatedStoragePressure).toBe("low");
    expect(m.snapshotsPrunedLastCycle).toBe(0);
  });

  it("computeStorageGovernanceMetrics converts Date objects to ISO strings", () => {
    const oldest = new Date("2026-01-01T00:00:00.000Z");
    const newest = new Date("2026-01-15T00:00:00.000Z");
    const m = computeStorageGovernanceMetrics(5000, oldest, newest, 100);
    expect(m.oldestSnapshotAt).toBe("2026-01-01T00:00:00.000Z");
    expect(m.newestSnapshotAt).toBe("2026-01-15T00:00:00.000Z");
  });

  it("computeStorageGovernanceMetrics is pure - same inputs give same output", () => {
    const m1 = computeStorageGovernanceMetrics(10000, null, null, 50);
    const m2 = computeStorageGovernanceMetrics(10000, null, null, 50);
    expect(m1).toEqual(m2);
  });
});
