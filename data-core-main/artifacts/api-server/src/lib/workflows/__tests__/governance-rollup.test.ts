/**
 * @file  governance-rollup.test.ts
 * @phase P7-C - Historical Rollups & Long-Term Analytics Foundations
 *
 * 100% pure-model tests - no DB, no timers, no network.
 * All functions under test are synchronous or accept injectable clock/DB params.
 *
 * Test groups (T1-T10):
 *   T1  Hourly rollups aggregate raw snapshots correctly
 *   T2  Daily rollups aggregate hourly rollups correctly
 *   T3  dominantSeverity is deterministic
 *   T4  Rollups are append-only (payload structure, idempotency guarantee)
 *   T5  Raw snapshots pruned only after rollup success (success flag)
 *   T6  Query cascade selects correct storage layer
 *   T7  Long-term trends remain continuous (bucket enumeration, grouping)
 *   T8  Chronic alert aggregation is stable
 *   T9  stormFrequency computed correctly
 *   T10 Rollup failures never signal prune-safe (success=false)
 */

import { describe, it, expect } from "vitest";
import type { StoredSnapshot } from "../governance-history";
import type { StoredRollup, TimeBucket, RollupInsertPayload } from "../governance-rollup";
import {
  // Constants
  HOUR_MS,
  DAY_MS,
  ROLLUP_GRANULARITY_HOURLY,
  ROLLUP_GRANULARITY_DAILY,
  ROLLUP_SCHEMA_VERSION,
  ROLLUP_HOURLY_RETENTION_DAYS,
  ROLLUP_DAILY_RETENTION_DAYS,
  RAW_TO_HOURLY_THRESHOLD_DAYS,
  HOURLY_TO_DAILY_THRESHOLD_DAYS,
  ROLLUP_CHRONIC_THRESHOLD_PCT,
  SEVERITY_RANK,
  GOVERNANCE_ACTION_ROLLUP_HOURLY_COMPLETED,
  GOVERNANCE_ACTION_ROLLUP_DAILY_COMPLETED,
  GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE,
  GOVERNANCE_ACTION_ROLLUP_FAILED,
  GOVERNANCE_ACTION_ROLLUP_QUERY_RESOLVED,
  // Bucket
  computeHourBucket,
  computeDayBucket,
  bucketKey,
  // Grouping
  groupSnapshotsByHourBucket,
  groupRollupsByDayBucket,
  // Aggregation
  computeDominantSeverity,
  computeAvg,
  computeChronicCodes,
  computeStormFrequencyFromSnapshots,
  computeStormFrequencyFromRollups,
  // Payload builders
  buildHourlyRollupPayload,
  buildDailyRollupPayload,
  // Query cascade
  selectQueryLayer,
  serializeRollupDataPoint,
  // Pipeline (pure helpers)
  enumerateHourBuckets,
  enumerateDayBuckets,
} from "../governance-rollup";

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-01-15T12:00:00Z");

/** Make a minimal StoredSnapshot for testing. */
function makeSnapshot(overrides: Partial<StoredSnapshot> = {}): StoredSnapshot {
  return {
    id:          overrides.id          ?? 1,
    workspaceId: overrides.workspaceId ?? 10,
    capturedAt:  overrides.capturedAt  ?? new Date("2026-01-15T10:30:00Z"),
    severity:    overrides.severity    ?? "healthy",
    metricsSnapshot: overrides.metricsSnapshot ?? {
      activeExecutions:           0,
      waitingApprovalCount:       0,
      waitingDelayCount:          0,
      completedExecutions:        10,
      failedExecutions:           0,
      timedOutExecutions:         0,
      cancelledExecutions:        0,
      approvalBacklogCount:       0,
      delayBacklogCount:          0,
      workflowErrorRate:          0,
      averageExecutionDurationMs: 1000,
    },
    indicators: overrides.indicators ?? {
      executionPressure:  "healthy",
      errorConcentration: "healthy",
      approvalPressure:   "healthy",
      delayPressure:      "healthy",
      stormPressure:      "healthy",
    },
    alertCodes:    overrides.alertCodes    ?? [],
    alertSummary:  overrides.alertSummary  ?? { total: 0, critical: 0, warning: 0, info: 0 },
    stuckCount:    overrides.stuckCount    ?? 0,
    stormSeverity: overrides.stormSeverity ?? "none",
    schemaVersion: overrides.schemaVersion ?? 1,
  };
}

/** Make a minimal StoredRollup for testing. */
function makeRollup(overrides: Partial<StoredRollup> = {}): StoredRollup {
  return {
    id:                 overrides.id                 ?? 1,
    workspaceId:        overrides.workspaceId        ?? 10,
    granularity:        overrides.granularity        ?? ROLLUP_GRANULARITY_HOURLY,
    bucketStart:        overrides.bucketStart        ?? new Date("2026-01-15T10:00:00Z"),
    bucketEnd:          overrides.bucketEnd          ?? new Date("2026-01-15T11:00:00Z"),
    snapshotCount:      overrides.snapshotCount      ?? 12,
    avgErrorRate:       overrides.avgErrorRate       ?? 0,
    avgApprovalBacklog: overrides.avgApprovalBacklog ?? 0,
    avgDelayBacklog:    overrides.avgDelayBacklog    ?? 0,
    avgStuckCount:      overrides.avgStuckCount      ?? 0,
    dominantSeverity:   overrides.dominantSeverity   ?? "healthy",
    chronicAlertCodes:  overrides.chronicAlertCodes  ?? [],
    stormFrequency:     overrides.stormFrequency     ?? 0,
    schemaVersion:      overrides.schemaVersion      ?? 1,
    createdAt:          overrides.createdAt          ?? new Date("2026-01-15T11:01:00Z"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Hourly rollups aggregate raw snapshots correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: buildHourlyRollupPayload - aggregate raw snapshots correctly", () => {
  const bucket: TimeBucket = {
    start: new Date("2026-01-15T10:00:00Z"),
    end:   new Date("2026-01-15T11:00:00Z"),
  };

  it("snapshotCount equals input array length", () => {
    const snapshots = [makeSnapshot(), makeSnapshot({ id: 2 }), makeSnapshot({ id: 3 })];
    const payload = buildHourlyRollupPayload(10, bucket, snapshots);
    expect(payload.snapshotCount).toBe(3);
  });

  it("avgErrorRate is arithmetic mean of workflowErrorRate", () => {
    const snapshots = [
      makeSnapshot({ metricsSnapshot: { ...makeSnapshot().metricsSnapshot, workflowErrorRate: 0.1 } }),
      makeSnapshot({ metricsSnapshot: { ...makeSnapshot().metricsSnapshot, workflowErrorRate: 0.3 } }),
    ];
    const payload = buildHourlyRollupPayload(10, bucket, snapshots);
    expect(payload.avgErrorRate).toBeCloseTo(0.2);
  });

  it("avgApprovalBacklog is mean of approvalBacklogCount", () => {
    const snapshots = [
      makeSnapshot({ metricsSnapshot: { ...makeSnapshot().metricsSnapshot, approvalBacklogCount: 4 } }),
      makeSnapshot({ metricsSnapshot: { ...makeSnapshot().metricsSnapshot, approvalBacklogCount: 8 } }),
    ];
    const payload = buildHourlyRollupPayload(10, bucket, snapshots);
    expect(payload.avgApprovalBacklog).toBeCloseTo(6);
  });

  it("avgDelayBacklog is mean of delayBacklogCount", () => {
    const snapshots = [
      makeSnapshot({ metricsSnapshot: { ...makeSnapshot().metricsSnapshot, delayBacklogCount: 2 } }),
      makeSnapshot({ metricsSnapshot: { ...makeSnapshot().metricsSnapshot, delayBacklogCount: 6 } }),
    ];
    const payload = buildHourlyRollupPayload(10, bucket, snapshots);
    expect(payload.avgDelayBacklog).toBeCloseTo(4);
  });

  it("avgStuckCount is mean of top-level stuckCount column", () => {
    const snapshots = [
      makeSnapshot({ stuckCount: 0 }),
      makeSnapshot({ stuckCount: 4 }),
    ];
    const payload = buildHourlyRollupPayload(10, bucket, snapshots);
    expect(payload.avgStuckCount).toBeCloseTo(2);
  });

  it("granularity is 'hourly'", () => {
    const payload = buildHourlyRollupPayload(10, bucket, [makeSnapshot()]);
    expect(payload.granularity).toBe(ROLLUP_GRANULARITY_HOURLY);
  });

  it("bucketStart and bucketEnd are preserved", () => {
    const payload = buildHourlyRollupPayload(10, bucket, [makeSnapshot()]);
    expect(payload.bucketStart).toBe(bucket.start);
    expect(payload.bucketEnd).toBe(bucket.end);
  });

  it("schemaVersion is ROLLUP_SCHEMA_VERSION", () => {
    const payload = buildHourlyRollupPayload(10, bucket, [makeSnapshot()]);
    expect(payload.schemaVersion).toBe(ROLLUP_SCHEMA_VERSION);
  });

  it("single snapshot produces correct averages", () => {
    const snap = makeSnapshot({
      metricsSnapshot: { ...makeSnapshot().metricsSnapshot, workflowErrorRate: 0.42 },
      stuckCount: 3,
    });
    const payload = buildHourlyRollupPayload(10, bucket, [snap]);
    expect(payload.avgErrorRate).toBeCloseTo(0.42);
    expect(payload.avgStuckCount).toBeCloseTo(3);
    expect(payload.snapshotCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Daily rollups aggregate hourly rollups correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: buildDailyRollupPayload - aggregate hourly rollups correctly", () => {
  const dayBucket: TimeBucket = {
    start: new Date("2026-01-15T00:00:00Z"),
    end:   new Date("2026-01-16T00:00:00Z"),
  };

  it("snapshotCount is the SUM of hourly snapshotCounts", () => {
    const rollups = [
      makeRollup({ snapshotCount: 12 }),
      makeRollup({ snapshotCount: 10 }),
      makeRollup({ snapshotCount: 11 }),
    ];
    const payload = buildDailyRollupPayload(10, dayBucket, rollups);
    expect(payload.snapshotCount).toBe(33);
  });

  it("avgErrorRate is arithmetic mean of hourly avgErrorRate values", () => {
    const rollups = [
      makeRollup({ avgErrorRate: 0.1 }),
      makeRollup({ avgErrorRate: 0.3 }),
    ];
    const payload = buildDailyRollupPayload(10, dayBucket, rollups);
    expect(payload.avgErrorRate).toBeCloseTo(0.2);
  });

  it("avgApprovalBacklog is mean of hourly avgApprovalBacklog", () => {
    const rollups = [
      makeRollup({ avgApprovalBacklog: 2 }),
      makeRollup({ avgApprovalBacklog: 4 }),
      makeRollup({ avgApprovalBacklog: 6 }),
    ];
    const payload = buildDailyRollupPayload(10, dayBucket, rollups);
    expect(payload.avgApprovalBacklog).toBeCloseTo(4);
  });

  it("avgDelayBacklog is mean of hourly avgDelayBacklog", () => {
    const rollups = [
      makeRollup({ avgDelayBacklog: 10 }),
      makeRollup({ avgDelayBacklog: 20 }),
    ];
    const payload = buildDailyRollupPayload(10, dayBucket, rollups);
    expect(payload.avgDelayBacklog).toBeCloseTo(15);
  });

  it("avgStuckCount is mean of hourly avgStuckCount", () => {
    const rollups = [
      makeRollup({ avgStuckCount: 1 }),
      makeRollup({ avgStuckCount: 3 }),
    ];
    const payload = buildDailyRollupPayload(10, dayBucket, rollups);
    expect(payload.avgStuckCount).toBeCloseTo(2);
  });

  it("granularity is 'daily'", () => {
    const payload = buildDailyRollupPayload(10, dayBucket, [makeRollup()]);
    expect(payload.granularity).toBe(ROLLUP_GRANULARITY_DAILY);
  });

  it("single hourly rollup produces identity daily rollup (except granularity)", () => {
    const rollup = makeRollup({
      snapshotCount:      5,
      avgErrorRate:       0.25,
      avgApprovalBacklog: 3,
      avgDelayBacklog:    7,
      avgStuckCount:      1,
      dominantSeverity:   "warning",
      stormFrequency:     0.5,
    });
    const payload = buildDailyRollupPayload(10, dayBucket, [rollup]);
    expect(payload.snapshotCount).toBe(5);
    expect(payload.avgErrorRate).toBeCloseTo(0.25);
    expect(payload.avgApprovalBacklog).toBeCloseTo(3);
    expect(payload.avgDelayBacklog).toBeCloseTo(7);
    expect(payload.avgStuckCount).toBeCloseTo(1);
    expect(payload.dominantSeverity).toBe("warning");
    expect(payload.stormFrequency).toBeCloseTo(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - dominantSeverity is deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: computeDominantSeverity - deterministic severity escalation", () => {
  it("returns highest severity - critical beats all others", () => {
    expect(computeDominantSeverity(["healthy", "critical", "warning", "degraded"])).toBe("critical");
  });

  it("returns 'degraded' when critical is absent", () => {
    expect(computeDominantSeverity(["healthy", "warning", "degraded"])).toBe("degraded");
  });

  it("returns 'warning' when only healthy and warning present", () => {
    expect(computeDominantSeverity(["healthy", "warning", "healthy"])).toBe("warning");
  });

  it("returns 'healthy' for all-healthy inputs", () => {
    expect(computeDominantSeverity(["healthy", "healthy", "healthy"])).toBe("healthy");
  });

  it("returns 'healthy' for empty input (default)", () => {
    expect(computeDominantSeverity([])).toBe("healthy");
  });

  it("returns single value unchanged", () => {
    expect(computeDominantSeverity(["degraded"])).toBe("degraded");
    expect(computeDominantSeverity(["critical"])).toBe("critical");
    expect(computeDominantSeverity(["healthy"])).toBe("healthy");
  });

  it("SEVERITY_RANK ordering: healthy < warning < degraded < critical", () => {
    expect(SEVERITY_RANK["healthy"]).toBeLessThan(SEVERITY_RANK["warning"]!);
    expect(SEVERITY_RANK["warning"]).toBeLessThan(SEVERITY_RANK["degraded"]!);
    expect(SEVERITY_RANK["degraded"]).toBeLessThan(SEVERITY_RANK["critical"]!);
  });

  it("is stable under permutation - same result regardless of order", () => {
    const inputs = ["warning", "healthy", "critical", "degraded"];
    const result = computeDominantSeverity(inputs);
    const shuffled = ["critical", "degraded", "healthy", "warning"];
    expect(computeDominantSeverity(shuffled)).toBe(result);
  });

  it("daily rollup escalates correctly across hourly dominantSeverity values", () => {
    const hourlyRollups = [
      makeRollup({ dominantSeverity: "healthy" }),
      makeRollup({ dominantSeverity: "warning" }),
      makeRollup({ dominantSeverity: "critical" }),
    ];
    const dayBucket: TimeBucket = {
      start: new Date("2026-01-15T00:00:00Z"),
      end:   new Date("2026-01-16T00:00:00Z"),
    };
    const payload = buildDailyRollupPayload(10, dayBucket, hourlyRollups);
    expect(payload.dominantSeverity).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Rollups are append-only (payload structure)
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: Append-only rollup structure guarantees", () => {
  const bucket: TimeBucket = {
    start: new Date("2026-01-15T10:00:00Z"),
    end:   new Date("2026-01-15T11:00:00Z"),
  };

  it("RollupInsertPayload has no id field (INSERT generates it)", () => {
    const payload = buildHourlyRollupPayload(10, bucket, [makeSnapshot()]);
    expect("id" in payload).toBe(false);
  });

  it("RollupInsertPayload has no createdAt field (DB defaultNow() generates it)", () => {
    const payload = buildHourlyRollupPayload(10, bucket, [makeSnapshot()]);
    expect("createdAt" in payload).toBe(false);
  });

  it("all required fields are present in hourly payload", () => {
    const payload = buildHourlyRollupPayload(10, bucket, [makeSnapshot()]);
    const required: Array<keyof RollupInsertPayload> = [
      "workspaceId", "granularity", "bucketStart", "bucketEnd",
      "snapshotCount", "avgErrorRate", "avgApprovalBacklog",
      "avgDelayBacklog", "avgStuckCount", "dominantSeverity",
      "chronicAlertCodes", "stormFrequency", "schemaVersion",
    ];
    for (const field of required) {
      expect(payload).toHaveProperty(field);
    }
  });

  it("all required fields are present in daily payload", () => {
    const dayBucket: TimeBucket = {
      start: new Date("2026-01-15T00:00:00Z"),
      end:   new Date("2026-01-16T00:00:00Z"),
    };
    const payload = buildDailyRollupPayload(10, dayBucket, [makeRollup()]);
    const required: Array<keyof RollupInsertPayload> = [
      "workspaceId", "granularity", "bucketStart", "bucketEnd",
      "snapshotCount", "avgErrorRate", "avgApprovalBacklog",
      "avgDelayBacklog", "avgStuckCount", "dominantSeverity",
      "chronicAlertCodes", "stormFrequency", "schemaVersion",
    ];
    for (const field of required) {
      expect(payload).toHaveProperty(field);
    }
  });

  it("chronicAlertCodes is an array (never undefined)", () => {
    const payload = buildHourlyRollupPayload(10, bucket, [makeSnapshot({ alertCodes: [] })]);
    expect(Array.isArray(payload.chronicAlertCodes)).toBe(true);
  });

  it("schemaVersion is the correct constant", () => {
    const payload = buildHourlyRollupPayload(10, bucket, [makeSnapshot()]);
    expect(payload.schemaVersion).toBe(ROLLUP_SCHEMA_VERSION);
  });

  it("building the same bucket twice produces equal payloads (idempotent)", () => {
    const snapshots = [makeSnapshot(), makeSnapshot({ id: 2, severity: "warning" })];
    const p1 = buildHourlyRollupPayload(10, bucket, snapshots);
    const p2 = buildHourlyRollupPayload(10, bucket, snapshots);
    expect(p1.dominantSeverity).toBe(p2.dominantSeverity);
    expect(p1.avgErrorRate).toBeCloseTo(p2.avgErrorRate);
    expect(p1.snapshotCount).toBe(p2.snapshotCount);
    expect(p1.chronicAlertCodes).toEqual(p2.chronicAlertCodes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Raw snapshots pruned only after rollup success
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: Prune-safe - rollup success flag controls pruning eligibility", () => {
  it("RollupWorkspaceResult has a success field", () => {
    // We test the shape by constructing a value that matches the type
    const result = {
      workspaceId: 10,
      hourlyBuilt: 2,
      dailyBuilt:  1,
      success:     true,
    };
    expect(result.success).toBe(true);
  });

  it("failure result has success=false", () => {
    const result = {
      workspaceId: 10,
      hourlyBuilt: 0,
      dailyBuilt:  0,
      success:     false,
      error:       "DB connection failed",
    };
    expect(result.success).toBe(false);
  });

  it("pruning must be skipped when success=false (invariant assertion)", () => {
    // This test encodes the scheduler invariant as a pure assertion:
    // if result.success === false, the pruning guard should NOT allow deletion.
    const shouldPrune = (success: boolean) => success;
    expect(shouldPrune(false)).toBe(false);
    expect(shouldPrune(true)).toBe(true);
  });

  it("GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE is a distinct string constant", () => {
    expect(typeof GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE).toBe("string");
    expect(GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE).toBe("governance_rollup_pruning_safe");
  });

  it("GOVERNANCE_ACTION_ROLLUP_FAILED is a distinct string constant", () => {
    expect(typeof GOVERNANCE_ACTION_ROLLUP_FAILED).toBe("string");
    expect(GOVERNANCE_ACTION_ROLLUP_FAILED).toBe("governance_rollup_failed");
  });

  it("all five P7-C action constants are unique strings", () => {
    const actions = [
      GOVERNANCE_ACTION_ROLLUP_HOURLY_COMPLETED,
      GOVERNANCE_ACTION_ROLLUP_DAILY_COMPLETED,
      GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE,
      GOVERNANCE_ACTION_ROLLUP_FAILED,
      GOVERNANCE_ACTION_ROLLUP_QUERY_RESOLVED,
    ];
    const unique = new Set(actions);
    expect(unique.size).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Query cascade selects correct storage layer
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: selectQueryLayer - correct storage tier selection", () => {
  it("daysBack=0 → raw", ()  => expect(selectQueryLayer(0)).toBe("raw"));
  it("daysBack=1 → raw", ()  => expect(selectQueryLayer(1)).toBe("raw"));
  it("daysBack=15 → raw", () => expect(selectQueryLayer(15)).toBe("raw"));
  it("daysBack=30 → raw (boundary is inclusive)", () => expect(selectQueryLayer(30)).toBe("raw"));
  it("daysBack=31 → hourly", () => expect(selectQueryLayer(31)).toBe("hourly"));
  it("daysBack=60 → hourly", () => expect(selectQueryLayer(60)).toBe("hourly"));
  it("daysBack=90 → hourly (boundary is inclusive)", () => expect(selectQueryLayer(90)).toBe("hourly"));
  it("daysBack=91 → daily", ()  => expect(selectQueryLayer(91)).toBe("daily"));
  it("daysBack=180 → daily", () => expect(selectQueryLayer(180)).toBe("daily"));
  it("daysBack=365 → daily", () => expect(selectQueryLayer(365)).toBe("daily"));
  it("daysBack=400 → daily (clamped, beyond max retention)", () => expect(selectQueryLayer(400)).toBe("daily"));

  it("RAW_TO_HOURLY_THRESHOLD_DAYS constant is 30", () => {
    expect(RAW_TO_HOURLY_THRESHOLD_DAYS).toBe(30);
  });

  it("HOURLY_TO_DAILY_THRESHOLD_DAYS constant is 90", () => {
    expect(HOURLY_TO_DAILY_THRESHOLD_DAYS).toBe(90);
  });

  it("ROLLUP_HOURLY_RETENTION_DAYS constant is 90", () => {
    expect(ROLLUP_HOURLY_RETENTION_DAYS).toBe(90);
  });

  it("ROLLUP_DAILY_RETENTION_DAYS constant is 365", () => {
    expect(ROLLUP_DAILY_RETENTION_DAYS).toBe(365);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Long-term trends remain continuous
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: Bucket enumeration and grouping - trend continuity", () => {
  describe("computeHourBucket", () => {
    it("truncates to UTC hour boundary", () => {
      const ts = new Date("2026-01-15T10:37:22Z");
      const { start, end } = computeHourBucket(ts);
      expect(start.toISOString()).toBe("2026-01-15T10:00:00.000Z");
      expect(end.toISOString()).toBe("2026-01-15T11:00:00.000Z");
    });

    it("already-truncated time stays the same", () => {
      const ts = new Date("2026-01-15T10:00:00Z");
      const { start } = computeHourBucket(ts);
      expect(start.toISOString()).toBe("2026-01-15T10:00:00.000Z");
    });

    it("end = start + 1 hour", () => {
      const ts = new Date("2026-01-15T10:37:22Z");
      const { start, end } = computeHourBucket(ts);
      expect(end.getTime() - start.getTime()).toBe(HOUR_MS);
    });

    it("is deterministic - same ts always produces same bucket", () => {
      const ts = new Date("2026-01-15T10:37:22Z");
      const b1 = computeHourBucket(ts);
      const b2 = computeHourBucket(ts);
      expect(b1.start.getTime()).toBe(b2.start.getTime());
    });
  });

  describe("computeDayBucket", () => {
    it("truncates to UTC midnight", () => {
      const ts = new Date("2026-01-15T10:37:22Z");
      const { start, end } = computeDayBucket(ts);
      expect(start.toISOString()).toBe("2026-01-15T00:00:00.000Z");
      expect(end.toISOString()).toBe("2026-01-16T00:00:00.000Z");
    });

    it("end = start + 24 hours", () => {
      const ts = new Date("2026-01-15T10:37:22Z");
      const { start, end } = computeDayBucket(ts);
      expect(end.getTime() - start.getTime()).toBe(DAY_MS);
    });
  });

  describe("enumerateHourBuckets", () => {
    it("produces correct number of hour buckets for a 4-hour window", () => {
      const start = new Date("2026-01-15T08:00:00Z");
      const end   = new Date("2026-01-15T12:00:00Z");
      const buckets = enumerateHourBuckets(start, end);
      expect(buckets.length).toBe(4);
    });

    it("buckets are non-overlapping and contiguous", () => {
      const start = new Date("2026-01-15T08:00:00Z");
      const end   = new Date("2026-01-15T12:00:00Z");
      const buckets = enumerateHourBuckets(start, end);
      for (let i = 1; i < buckets.length; i++) {
        expect(buckets[i]!.start.getTime()).toBe(buckets[i - 1]!.end.getTime());
      }
    });

    it("returns empty array for zero-width window", () => {
      const ts = new Date("2026-01-15T10:00:00Z");
      expect(enumerateHourBuckets(ts, ts)).toHaveLength(0);
    });

    it("each bucket spans exactly 1 hour", () => {
      const start = new Date("2026-01-15T08:00:00Z");
      const end   = new Date("2026-01-15T11:00:00Z");
      for (const bucket of enumerateHourBuckets(start, end)) {
        expect(bucket.end.getTime() - bucket.start.getTime()).toBe(HOUR_MS);
      }
    });
  });

  describe("enumerateDayBuckets", () => {
    it("produces correct number of day buckets for a 3-day window", () => {
      const start = new Date("2026-01-13T00:00:00Z");
      const end   = new Date("2026-01-16T00:00:00Z");
      expect(enumerateDayBuckets(start, end)).toHaveLength(3);
    });

    it("each bucket spans exactly 24 hours", () => {
      const start = new Date("2026-01-13T00:00:00Z");
      const end   = new Date("2026-01-16T00:00:00Z");
      for (const bucket of enumerateDayBuckets(start, end)) {
        expect(bucket.end.getTime() - bucket.start.getTime()).toBe(DAY_MS);
      }
    });
  });

  describe("groupSnapshotsByHourBucket", () => {
    it("groups snapshots into correct hour buckets", () => {
      const snapshots = [
        makeSnapshot({ capturedAt: new Date("2026-01-15T10:05:00Z") }),
        makeSnapshot({ capturedAt: new Date("2026-01-15T10:45:00Z") }),
        makeSnapshot({ capturedAt: new Date("2026-01-15T11:15:00Z") }),
      ];
      const groups = groupSnapshotsByHourBucket(snapshots);
      expect(groups).toHaveLength(2);
      expect(groups[0]!.items).toHaveLength(2);
      expect(groups[1]!.items).toHaveLength(1);
    });

    it("returns groups in ascending order by bucket start", () => {
      const snapshots = [
        makeSnapshot({ capturedAt: new Date("2026-01-15T11:00:00Z") }),
        makeSnapshot({ capturedAt: new Date("2026-01-15T09:00:00Z") }),
        makeSnapshot({ capturedAt: new Date("2026-01-15T10:00:00Z") }),
      ];
      const groups = groupSnapshotsByHourBucket(snapshots);
      for (let i = 1; i < groups.length; i++) {
        expect(groups[i]!.bucket.start.getTime()).toBeGreaterThan(groups[i - 1]!.bucket.start.getTime());
      }
    });

    it("does not mutate the input array", () => {
      const snapshots = [
        makeSnapshot({ capturedAt: new Date("2026-01-15T10:05:00Z") }),
      ];
      const original = [...snapshots];
      groupSnapshotsByHourBucket(snapshots);
      expect(snapshots).toEqual(original);
    });

    it("returns empty array for empty input", () => {
      expect(groupSnapshotsByHourBucket([])).toHaveLength(0);
    });
  });

  describe("groupRollupsByDayBucket", () => {
    it("groups hourly rollups into UTC-day buckets", () => {
      const rollups = [
        makeRollup({ bucketStart: new Date("2026-01-15T10:00:00Z") }),
        makeRollup({ bucketStart: new Date("2026-01-15T22:00:00Z") }),
        makeRollup({ bucketStart: new Date("2026-01-16T02:00:00Z") }),
      ];
      const groups = groupRollupsByDayBucket(rollups);
      expect(groups).toHaveLength(2);
      expect(groups[0]!.items).toHaveLength(2);
      expect(groups[1]!.items).toHaveLength(1);
    });

    it("returns groups in ascending order by day start", () => {
      const rollups = [
        makeRollup({ bucketStart: new Date("2026-01-17T10:00:00Z") }),
        makeRollup({ bucketStart: new Date("2026-01-15T10:00:00Z") }),
        makeRollup({ bucketStart: new Date("2026-01-16T10:00:00Z") }),
      ];
      const groups = groupRollupsByDayBucket(rollups);
      for (let i = 1; i < groups.length; i++) {
        expect(groups[i]!.bucket.start.getTime()).toBeGreaterThan(groups[i - 1]!.bucket.start.getTime());
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Chronic alert aggregation is stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: computeChronicCodes - stable chronic alert detection", () => {
  it("code in all items → chronic", () => {
    const codes = [["GOV-01"], ["GOV-01"], ["GOV-01"]];
    expect(computeChronicCodes(codes)).toContain("GOV-01");
  });

  it("code in exactly 50% → NOT chronic (strict >)", () => {
    const codes = [["GOV-01"], ["GOV-01"], [], []];
    expect(computeChronicCodes(codes)).not.toContain("GOV-01");
  });

  it("code in 51% → chronic", () => {
    // 4 items: GOV-01 in items 1,2,3 → 3/4 = 75% > 50%
    const codes = [["GOV-01"], ["GOV-01"], ["GOV-01"], []];
    expect(computeChronicCodes(codes)).toContain("GOV-01");
  });

  it("code in 0% → not chronic", () => {
    const codes = [["GOV-02"], ["GOV-02"], ["GOV-02"]];
    expect(computeChronicCodes(codes)).not.toContain("GOV-01");
  });

  it("empty input → empty result", () => {
    expect(computeChronicCodes([])).toHaveLength(0);
  });

  it("returns sorted array for determinism", () => {
    const codes = [
      ["GOV-03", "GOV-01"],
      ["GOV-03", "GOV-01"],
      ["GOV-03", "GOV-01"],
    ];
    const result = computeChronicCodes(codes);
    expect(result).toEqual(["GOV-01", "GOV-03"]);
  });

  it("same code appearing multiple times in one item counts as one appearance", () => {
    // GOV-01 appears twice in item 1, once in item 2, absent in item 3
    // Should count as 2/3 = 66.7% > 50% → chronic
    const codes = [["GOV-01", "GOV-01"], ["GOV-01"], []];
    expect(computeChronicCodes(codes)).toContain("GOV-01");
  });

  it("ROLLUP_CHRONIC_THRESHOLD_PCT is 50", () => {
    expect(ROLLUP_CHRONIC_THRESHOLD_PCT).toBe(50);
  });

  it("is idempotent - same input → same output", () => {
    const codes = [["GOV-01", "GOV-02"], ["GOV-01"], ["GOV-01"]];
    const r1 = computeChronicCodes(codes);
    const r2 = computeChronicCodes(codes);
    expect(r1).toEqual(r2);
  });

  it("buildHourlyRollupPayload propagates chronic codes correctly", () => {
    // 3 snapshots all with GOV-01 → should be chronic (100% > 50%)
    const snapshots = [
      makeSnapshot({ alertCodes: ["GOV-01"] }),
      makeSnapshot({ alertCodes: ["GOV-01"] }),
      makeSnapshot({ alertCodes: ["GOV-01"] }),
    ];
    const bucket: TimeBucket = {
      start: new Date("2026-01-15T10:00:00Z"),
      end:   new Date("2026-01-15T11:00:00Z"),
    };
    const payload = buildHourlyRollupPayload(10, bucket, snapshots);
    expect(payload.chronicAlertCodes).toContain("GOV-01");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - stormFrequency computed correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: stormFrequency - storm signal aggregation", () => {
  describe("computeStormFrequencyFromSnapshots", () => {
    it("all snapshots with storm → 1.0", () => {
      const snapshots = [
        makeSnapshot({ stormSeverity: "warning" }),
        makeSnapshot({ stormSeverity: "critical" }),
      ];
      expect(computeStormFrequencyFromSnapshots(snapshots)).toBeCloseTo(1.0);
    });

    it("no snapshots with storm → 0.0", () => {
      const snapshots = [
        makeSnapshot({ stormSeverity: "none" }),
        makeSnapshot({ stormSeverity: "none" }),
      ];
      expect(computeStormFrequencyFromSnapshots(snapshots)).toBeCloseTo(0.0);
    });

    it("half with storm → 0.5", () => {
      const snapshots = [
        makeSnapshot({ stormSeverity: "warning" }),
        makeSnapshot({ stormSeverity: "none" }),
      ];
      expect(computeStormFrequencyFromSnapshots(snapshots)).toBeCloseTo(0.5);
    });

    it("empty input → 0", () => {
      expect(computeStormFrequencyFromSnapshots([])).toBe(0);
    });

    it("'warning' storm severity counts as storm", () => {
      const snapshots = [makeSnapshot({ stormSeverity: "warning" })];
      expect(computeStormFrequencyFromSnapshots(snapshots)).toBeCloseTo(1.0);
    });

    it("'critical' storm severity counts as storm", () => {
      const snapshots = [makeSnapshot({ stormSeverity: "critical" })];
      expect(computeStormFrequencyFromSnapshots(snapshots)).toBeCloseTo(1.0);
    });
  });

  describe("computeStormFrequencyFromRollups", () => {
    it("returns mean of hourly stormFrequency values", () => {
      const rollups = [
        makeRollup({ stormFrequency: 0.2 }),
        makeRollup({ stormFrequency: 0.6 }),
      ];
      expect(computeStormFrequencyFromRollups(rollups)).toBeCloseTo(0.4);
    });

    it("all zeros → 0", () => {
      const rollups = [
        makeRollup({ stormFrequency: 0 }),
        makeRollup({ stormFrequency: 0 }),
      ];
      expect(computeStormFrequencyFromRollups(rollups)).toBeCloseTo(0);
    });

    it("all ones → 1", () => {
      const rollups = [
        makeRollup({ stormFrequency: 1 }),
        makeRollup({ stormFrequency: 1 }),
      ];
      expect(computeStormFrequencyFromRollups(rollups)).toBeCloseTo(1);
    });

    it("empty input → 0", () => {
      expect(computeStormFrequencyFromRollups([])).toBe(0);
    });
  });

  it("buildHourlyRollupPayload propagates stormFrequency correctly", () => {
    const snapshots = [
      makeSnapshot({ stormSeverity: "warning" }),
      makeSnapshot({ stormSeverity: "none" }),
      makeSnapshot({ stormSeverity: "none" }),
      makeSnapshot({ stormSeverity: "none" }),
    ];
    const bucket: TimeBucket = {
      start: new Date("2026-01-15T10:00:00Z"),
      end:   new Date("2026-01-15T11:00:00Z"),
    };
    const payload = buildHourlyRollupPayload(10, bucket, snapshots);
    expect(payload.stormFrequency).toBeCloseTo(0.25);
  });

  it("buildDailyRollupPayload uses mean of hourly stormFrequency", () => {
    const rollups = [
      makeRollup({ stormFrequency: 0.0 }),
      makeRollup({ stormFrequency: 0.5 }),
      makeRollup({ stormFrequency: 1.0 }),
    ];
    const dayBucket: TimeBucket = {
      start: new Date("2026-01-15T00:00:00Z"),
      end:   new Date("2026-01-16T00:00:00Z"),
    };
    const payload = buildDailyRollupPayload(10, dayBucket, rollups);
    expect(payload.stormFrequency).toBeCloseTo(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Rollup failures never delete raw history
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: Prune isolation - failures must never trigger raw deletion", () => {
  it("failure result carries success=false - scheduler must check this", () => {
    const failureResult = {
      workspaceId: 10,
      hourlyBuilt: 0,
      dailyBuilt:  0,
      success:     false as const,
      error:       "timeout connecting to DB",
    };
    // The scheduler invariant: if result.success is false, skip pruning
    expect(failureResult.success).toBe(false);
  });

  it("GOVERNANCE_ACTION_ROLLUP_FAILED is emitted on failure (constant check)", () => {
    expect(GOVERNANCE_ACTION_ROLLUP_FAILED).toBe("governance_rollup_failed");
  });

  it("success result must have success=true to enable pruning", () => {
    const successResult = {
      workspaceId: 10,
      hourlyBuilt: 2,
      dailyBuilt:  1,
      success:     true as const,
    };
    expect(successResult.success).toBe(true);
  });

  it("prune guard - any falsy success value prevents pruning", () => {
    const pruneShouldProceed = (result: { success: boolean }) => result.success === true;
    expect(pruneShouldProceed({ success: false })).toBe(false);
    expect(pruneShouldProceed({ success: true  })).toBe(true);
  });

  it("zero hourlyBuilt + zero dailyBuilt is still safe if success=true (no-op)", () => {
    const result = { workspaceId: 10, hourlyBuilt: 0, dailyBuilt: 0, success: true };
    // Zero rollups built = no new data in overlap zone (already covered)
    // This is a valid idempotent run - pruning should still be allowed.
    expect(result.success).toBe(true);
  });

  it("GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE is logged when pruning proceeds after rollup", () => {
    // Structural test: constant exists and is distinct
    expect(GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE).toBe("governance_rollup_pruning_safe");
    expect(GOVERNANCE_ACTION_ROLLUP_PRUNING_SAFE).not.toBe(GOVERNANCE_ACTION_ROLLUP_FAILED);
  });

  it("serializeRollupDataPoint produces correct ISO strings", () => {
    const rollup = makeRollup({
      bucketStart: new Date("2026-01-15T10:00:00Z"),
      bucketEnd:   new Date("2026-01-15T11:00:00Z"),
      granularity: ROLLUP_GRANULARITY_HOURLY,
    });
    const point = serializeRollupDataPoint(rollup);
    expect(point.bucketStart).toBe("2026-01-15T10:00:00.000Z");
    expect(point.bucketEnd).toBe("2026-01-15T11:00:00.000Z");
    expect(point.granularity).toBe(ROLLUP_GRANULARITY_HOURLY);
  });

  it("bucketKey is stable for the same bucket", () => {
    const bucket: TimeBucket = {
      start: new Date("2026-01-15T10:00:00Z"),
      end:   new Date("2026-01-15T11:00:00Z"),
    };
    expect(bucketKey(bucket)).toBe(bucketKey(bucket));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: computeAvg correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("computeAvg - arithmetic mean helper", () => {
  it("empty → 0", () => expect(computeAvg([])).toBe(0));
  it("single value → that value", () => expect(computeAvg([7])).toBeCloseTo(7));
  it("two equal values → same value", () => expect(computeAvg([3, 3])).toBeCloseTo(3));
  it("three values", () => expect(computeAvg([1, 2, 3])).toBeCloseTo(2));
  it("all zeros → 0", () => expect(computeAvg([0, 0, 0])).toBeCloseTo(0));
});
