/**
 * @file   governance-trends.test.ts
 * @phase  P7-D - Governance Trend APIs & Historical Analytics Surface
 *
 * Pure model tests for governance-trends.ts.
 * No database, no HTTP server, no filesystem access.
 *
 * Test groups:
 *   T1  - severity trend uses correct query layer (cascade routing)
 *   T2  - error-rate trend serializes correctly from snapshots and rollups
 *   T3  - backlog trend preserves deterministic ordering
 *   T4  - storm trend returns stable frequency values
 *   T5  - invalid ranges rejected safely
 *   T6  - future windows cannot occur (since always < until = now)
 *   T7  - payload truncation handled correctly
 *   T8  - response contracts stable across layers (TrendEnvelope fields)
 *   T9  - tenant isolation enforced (workspaceId not leaked into shared state)
 *   T10 - trend APIs remain read-only (no mutation symbols exported)
 */

import { describe, it, expect } from "vitest";
import {
  // Constants
  EXTENDED_TREND_RANGES,
  VALID_EXTENDED_RANGES,
  EXTENDED_RANGE_HOURS,
  MAX_TREND_POINTS,
  MAX_TREND_RANGE_DAYS,
  TREND_ACTION_REQUESTED,
  TREND_ACTION_RESOLVED,
  TREND_ACTION_REJECTED,
  TREND_ACTION_TRUNCATED,
  // Validation
  validateTrendRange,
  selectTrendQueryLayer,
  trendRangeToDays,
  // Snapshot serializers
  serializeSeverityFromSnapshots,
  serializeErrorRateFromSnapshots,
  serializeBacklogsFromSnapshots,
  serializeStormsFromSnapshots,
  // Rollup serializers
  serializeSeverityFromRollups,
  serializeErrorRateFromRollups,
  serializeBacklogsFromRollups,
  serializeStormsFromRollups,
  // Truncation & envelope
  truncateTrendPoints,
  buildTrendEnvelope,
  // Safety
  isFutureWindow,
  isRangeTooLarge,
  willTruncate,
  trendLayerLabel,
  type ExtendedTrendRange,
  type SeverityTrendPoint,
  type NumericTrendPoint,
  type BacklogTrendPoint,
  type StormTrendPoint,
  type TrendEnvelope,
  type TrendQueryContext,
} from "../governance-trends";

import type { StoredSnapshot } from "../governance-history";
import type { StoredRollup } from "../governance-rollup";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

const T0 = new Date("2025-06-01T12:00:00.000Z");

function makeSnapshot(overrides: Partial<StoredSnapshot> = {}): StoredSnapshot {
  return {
    id:          1,
    workspaceId: 10,
    capturedAt:  T0,
    severity:    "healthy",
    stuckCount:  0,
    stormSeverity: "none",
    alertCodes:  [],
    alertSummary: { total: 0, critical: 0, warning: 0, info: 0 },
    schemaVersion: 1,
    metricsSnapshot: {
      activeExecutions:           5,
      waitingApprovalCount:       2,
      waitingDelayCount:          3,
      completedExecutions:        10,
      failedExecutions:           1,
      timedOutExecutions:         0,
      cancelledExecutions:        0,
      approvalBacklogCount:       2,
      delayBacklogCount:          3,
      workflowErrorRate:          0.1,
      averageExecutionDurationMs: 500,
    },
    indicators: {
      executionPressure:  "healthy",
      errorConcentration: "healthy",
      approvalPressure:   "healthy",
      delayPressure:      "healthy",
      stormPressure:      "none",
    },
    ...overrides,
  };
}

function makeRollup(overrides: Partial<StoredRollup> = {}): StoredRollup {
  const base = new Date("2025-05-01T10:00:00.000Z");
  return {
    id:                 1,
    workspaceId:        10,
    granularity:        "hourly",
    bucketStart:        base,
    bucketEnd:          new Date(base.getTime() + 3_600_000),
    snapshotCount:      12,
    avgErrorRate:       0.15,
    avgApprovalBacklog: 3.5,
    avgDelayBacklog:    1.2,
    avgStuckCount:      0.8,
    dominantSeverity:   "warning",
    chronicAlertCodes:  ["GOV-001"],
    stormFrequency:     0.25,
    schemaVersion:      1,
    createdAt:          new Date(),
    ...overrides,
  };
}

function makeContext(
  range: ExtendedTrendRange,
  now: Date = T0,
): TrendQueryContext {
  const result = validateTrendRange(range, now);
  if (!result.ok) throw new Error(`Unexpected invalid range: ${range}`);
  return result.context;
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Severity trend uses correct query layer
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - selectTrendQueryLayer: cascade routing", () => {
  it("routes daysBack=0 to raw", () => {
    expect(selectTrendQueryLayer(0)).toBe("raw");
  });

  it("routes daysBack=1 to raw", () => {
    expect(selectTrendQueryLayer(1)).toBe("raw");
  });

  it("routes daysBack=7 to raw (7d range)", () => {
    expect(selectTrendQueryLayer(7)).toBe("raw");
  });

  it("routes daysBack=30 to raw (boundary inclusive)", () => {
    expect(selectTrendQueryLayer(30)).toBe("raw");
  });

  it("routes daysBack=31 to hourly", () => {
    expect(selectTrendQueryLayer(31)).toBe("hourly");
  });

  it("routes daysBack=90 to hourly (boundary inclusive)", () => {
    expect(selectTrendQueryLayer(90)).toBe("hourly");
  });

  it("routes daysBack=91 to daily", () => {
    expect(selectTrendQueryLayer(91)).toBe("daily");
  });

  it("routes daysBack=180 to daily", () => {
    expect(selectTrendQueryLayer(180)).toBe("daily");
  });

  it("routes daysBack=365 to daily", () => {
    expect(selectTrendQueryLayer(365)).toBe("daily");
  });

  it("1h range → raw tier", () => {
    const ctx = makeContext("1h");
    expect(ctx.layer).toBe("raw");
  });

  it("24h range → raw tier", () => {
    const ctx = makeContext("24h");
    expect(ctx.layer).toBe("raw");
  });

  it("7d range → raw tier", () => {
    const ctx = makeContext("7d");
    expect(ctx.layer).toBe("raw");
  });

  it("30d range → raw tier (boundary)", () => {
    const ctx = makeContext("30d");
    expect(ctx.layer).toBe("raw");
  });

  it("90d range → hourly tier", () => {
    const ctx = makeContext("90d");
    expect(ctx.layer).toBe("hourly");
  });

  it("180d range → daily tier", () => {
    const ctx = makeContext("180d");
    expect(ctx.layer).toBe("daily");
  });

  it("365d range → daily tier", () => {
    const ctx = makeContext("365d");
    expect(ctx.layer).toBe("daily");
  });

  it("severity serializer from raw returns sourceLayer=raw", () => {
    const snap = makeSnapshot({ severity: "critical" });
    const pts = serializeSeverityFromSnapshots([snap], "raw");
    expect(pts[0]?.sourceLayer).toBe("raw");
  });

  it("severity serializer from rollup returns sourceLayer=hourly", () => {
    const rollup = makeRollup({ dominantSeverity: "warning" });
    const pts = serializeSeverityFromRollups([rollup], "hourly");
    expect(pts[0]?.sourceLayer).toBe("hourly");
  });

  it("severity serializer from rollup returns sourceLayer=daily", () => {
    const rollup = makeRollup({ granularity: "daily", dominantSeverity: "degraded" });
    const pts = serializeSeverityFromRollups([rollup], "daily");
    expect(pts[0]?.sourceLayer).toBe("daily");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Error-rate trend serializes correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - error-rate trend serialization", () => {
  it("serializes workflowErrorRate from snapshot", () => {
    const snap = makeSnapshot({ metricsSnapshot: { ...makeSnapshot().metricsSnapshot, workflowErrorRate: 0.42 } });
    const pts = serializeErrorRateFromSnapshots([snap], "raw");
    expect(pts).toHaveLength(1);
    expect(pts[0]?.value).toBe(0.42);
    expect(pts[0]?.sourceLayer).toBe("raw");
  });

  it("serializes avgErrorRate from rollup", () => {
    const rollup = makeRollup({ avgErrorRate: 0.27 });
    const pts = serializeErrorRateFromRollups([rollup], "hourly");
    expect(pts).toHaveLength(1);
    expect(pts[0]?.value).toBe(0.27);
    expect(pts[0]?.sourceLayer).toBe("hourly");
  });

  it("preserves timestamp from snapshot capturedAt", () => {
    const ts = new Date("2025-06-01T08:30:00.000Z");
    const snap = makeSnapshot({ capturedAt: ts });
    const pts = serializeErrorRateFromSnapshots([snap], "raw");
    expect(pts[0]?.timestamp).toBe(ts.toISOString());
  });

  it("preserves timestamp from rollup bucketStart", () => {
    const ts = new Date("2025-05-01T10:00:00.000Z");
    const rollup = makeRollup({ bucketStart: ts });
    const pts = serializeErrorRateFromRollups([rollup], "hourly");
    expect(pts[0]?.timestamp).toBe(ts.toISOString());
  });

  it("serializes multiple snapshots in input order", () => {
    const t1 = new Date("2025-06-01T08:00:00.000Z");
    const t2 = new Date("2025-06-01T08:05:00.000Z");
    const t3 = new Date("2025-06-01T08:10:00.000Z");
    const s1 = makeSnapshot({ capturedAt: t1, metricsSnapshot: { ...makeSnapshot().metricsSnapshot, workflowErrorRate: 0.1 } });
    const s2 = makeSnapshot({ capturedAt: t2, metricsSnapshot: { ...makeSnapshot().metricsSnapshot, workflowErrorRate: 0.2 } });
    const s3 = makeSnapshot({ capturedAt: t3, metricsSnapshot: { ...makeSnapshot().metricsSnapshot, workflowErrorRate: 0.3 } });
    const pts = serializeErrorRateFromSnapshots([s1, s2, s3], "raw");
    expect(pts.map(p => p.value)).toEqual([0.1, 0.2, 0.3]);
  });

  it("empty snapshots → empty array", () => {
    expect(serializeErrorRateFromSnapshots([], "raw")).toEqual([]);
  });

  it("empty rollups → empty array", () => {
    expect(serializeErrorRateFromRollups([], "daily")).toEqual([]);
  });

  it("each point has exactly the required fields (NumericTrendPoint shape)", () => {
    const snap = makeSnapshot();
    const [pt] = serializeErrorRateFromSnapshots([snap], "raw");
    expect(pt).toBeDefined();
    const keys = Object.keys(pt!).sort();
    expect(keys).toEqual(["sourceLayer", "timestamp", "value"].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Backlog trend preserves deterministic ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - backlog trend: deterministic ordering and field mapping", () => {
  it("maps approvalBacklogCount from snapshot", () => {
    const snap = makeSnapshot({ metricsSnapshot: { ...makeSnapshot().metricsSnapshot, approvalBacklogCount: 7 } });
    const [pt] = serializeBacklogsFromSnapshots([snap], "raw");
    expect(pt?.approvalBacklog).toBe(7);
  });

  it("maps delayBacklogCount from snapshot", () => {
    const snap = makeSnapshot({ metricsSnapshot: { ...makeSnapshot().metricsSnapshot, delayBacklogCount: 4 } });
    const [pt] = serializeBacklogsFromSnapshots([snap], "raw");
    expect(pt?.delayBacklog).toBe(4);
  });

  it("maps top-level stuckCount from snapshot", () => {
    const snap = makeSnapshot({ stuckCount: 9 });
    const [pt] = serializeBacklogsFromSnapshots([snap], "raw");
    expect(pt?.stuckCount).toBe(9);
  });

  it("maps avgApprovalBacklog from rollup", () => {
    const rollup = makeRollup({ avgApprovalBacklog: 5.5 });
    const [pt] = serializeBacklogsFromRollups([rollup], "hourly");
    expect(pt?.approvalBacklog).toBe(5.5);
  });

  it("maps avgDelayBacklog from rollup", () => {
    const rollup = makeRollup({ avgDelayBacklog: 2.7 });
    const [pt] = serializeBacklogsFromRollups([rollup], "hourly");
    expect(pt?.delayBacklog).toBe(2.7);
  });

  it("maps avgStuckCount from rollup", () => {
    const rollup = makeRollup({ avgStuckCount: 1.3 });
    const [pt] = serializeBacklogsFromRollups([rollup], "daily");
    expect(pt?.stuckCount).toBe(1.3);
  });

  it("preserves input order across multiple snapshots", () => {
    const snaps = [
      makeSnapshot({ capturedAt: new Date("2025-06-01T08:00:00Z"), stuckCount: 1 }),
      makeSnapshot({ capturedAt: new Date("2025-06-01T08:05:00Z"), stuckCount: 5 }),
      makeSnapshot({ capturedAt: new Date("2025-06-01T08:10:00Z"), stuckCount: 3 }),
    ];
    const pts = serializeBacklogsFromSnapshots(snaps, "raw");
    expect(pts.map(p => p.stuckCount)).toEqual([1, 5, 3]);
  });

  it("preserves input order across multiple rollups", () => {
    const rollups = [
      makeRollup({ bucketStart: new Date("2025-05-01T10:00:00Z"), avgStuckCount: 2 }),
      makeRollup({ bucketStart: new Date("2025-05-01T11:00:00Z"), avgStuckCount: 4 }),
    ];
    const pts = serializeBacklogsFromRollups(rollups, "hourly");
    expect(pts.map(p => p.stuckCount)).toEqual([2, 4]);
  });

  it("BacklogTrendPoint has exactly the required fields", () => {
    const snap = makeSnapshot();
    const [pt] = serializeBacklogsFromSnapshots([snap], "raw");
    const keys = Object.keys(pt!).sort();
    expect(keys).toEqual(["approvalBacklog", "delayBacklog", "sourceLayer", "stuckCount", "timestamp"].sort());
  });

  it("does not mutate input snapshot array", () => {
    const snap = makeSnapshot({ stuckCount: 99 });
    const input = [snap];
    serializeBacklogsFromSnapshots(input, "raw");
    expect(input).toHaveLength(1);
    expect(input[0]!.stuckCount).toBe(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Storm trend returns stable frequency values
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - storm trend: frequency semantics", () => {
  it("binary stormFrequency=1 when stormSeverity=warning (raw)", () => {
    const snap = makeSnapshot({ stormSeverity: "warning" });
    const [pt] = serializeStormsFromSnapshots([snap], "raw");
    expect(pt?.stormFrequency).toBe(1.0);
  });

  it("binary stormFrequency=1 when stormSeverity=critical (raw)", () => {
    const snap = makeSnapshot({ stormSeverity: "critical" });
    const [pt] = serializeStormsFromSnapshots([snap], "raw");
    expect(pt?.stormFrequency).toBe(1.0);
  });

  it("binary stormFrequency=0 when stormSeverity=none (raw)", () => {
    const snap = makeSnapshot({ stormSeverity: "none" });
    const [pt] = serializeStormsFromSnapshots([snap], "raw");
    expect(pt?.stormFrequency).toBe(0.0);
  });

  it("preserves fractional stormFrequency from hourly rollup", () => {
    const rollup = makeRollup({ stormFrequency: 0.42 });
    const [pt] = serializeStormsFromRollups([rollup], "hourly");
    expect(pt?.stormFrequency).toBe(0.42);
  });

  it("preserves fractional stormFrequency from daily rollup", () => {
    const rollup = makeRollup({ granularity: "daily", stormFrequency: 0.75 });
    const [pt] = serializeStormsFromRollups([rollup], "daily");
    expect(pt?.stormFrequency).toBe(0.75);
  });

  it("dominantSeverity from raw = snapshot severity", () => {
    const snap = makeSnapshot({ severity: "critical" });
    const [pt] = serializeStormsFromSnapshots([snap], "raw");
    expect(pt?.dominantSeverity).toBe("critical");
  });

  it("dominantSeverity from rollup = rollup dominantSeverity", () => {
    const rollup = makeRollup({ dominantSeverity: "degraded" });
    const [pt] = serializeStormsFromRollups([rollup], "hourly");
    expect(pt?.dominantSeverity).toBe("degraded");
  });

  it("stormFrequency=0 for all calm snapshots", () => {
    const snaps = [
      makeSnapshot({ stormSeverity: "none" }),
      makeSnapshot({ stormSeverity: "none" }),
      makeSnapshot({ stormSeverity: "none" }),
    ];
    const pts = serializeStormsFromSnapshots(snaps, "raw");
    expect(pts.every(p => p.stormFrequency === 0.0)).toBe(true);
  });

  it("stormFrequency=1 for all storming snapshots", () => {
    const snaps = [
      makeSnapshot({ stormSeverity: "warning" }),
      makeSnapshot({ stormSeverity: "critical" }),
    ];
    const pts = serializeStormsFromSnapshots(snaps, "raw");
    expect(pts.every(p => p.stormFrequency === 1.0)).toBe(true);
  });

  it("StormTrendPoint has exactly the required fields", () => {
    const snap = makeSnapshot();
    const [pt] = serializeStormsFromSnapshots([snap], "raw");
    const keys = Object.keys(pt!).sort();
    expect(keys).toEqual(["dominantSeverity", "sourceLayer", "stormFrequency", "timestamp"].sort());
  });

  it("stormFrequency is always a number [0,1] from rollups", () => {
    const rollups = [
      makeRollup({ stormFrequency: 0.0 }),
      makeRollup({ stormFrequency: 0.5 }),
      makeRollup({ stormFrequency: 1.0 }),
    ];
    const pts = serializeStormsFromRollups(rollups, "hourly");
    pts.forEach(p => {
      expect(typeof p.stormFrequency).toBe("number");
      expect(p.stormFrequency).toBeGreaterThanOrEqual(0);
      expect(p.stormFrequency).toBeLessThanOrEqual(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Invalid ranges rejected safely
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - validateTrendRange: invalid range rejection", () => {
  const now = T0;

  it("rejects empty string", () => {
    const r = validateTrendRange("", now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.statusCode).toBe(400);
  });

  it("rejects unknown literal 'week'", () => {
    const r = validateTrendRange("week", now);
    expect(r.ok).toBe(false);
  });

  it("rejects 'daily' (not a valid range literal)", () => {
    const r = validateTrendRange("daily", now);
    expect(r.ok).toBe(false);
  });

  it("rejects '1y' (not a valid range literal)", () => {
    const r = validateTrendRange("1y", now);
    expect(r.ok).toBe(false);
  });

  it("rejects '31d' (not a declared range)", () => {
    const r = validateTrendRange("31d", now);
    expect(r.ok).toBe(false);
  });

  it("rejects numeric 30", () => {
    const r = validateTrendRange(String(30), now);
    expect(r.ok).toBe(false);
  });

  it("rejects case-mismatched '7D'", () => {
    const r = validateTrendRange("7D", now);
    expect(r.ok).toBe(false);
  });

  it("accepts all valid range literals", () => {
    for (const range of EXTENDED_TREND_RANGES) {
      const r = validateTrendRange(range, now);
      expect(r.ok).toBe(true);
    }
  });

  it("rejection includes a descriptive reason string", () => {
    const r = validateTrendRange("bad", now);
    if (!r.ok) {
      expect(typeof r.reason).toBe("string");
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("valid range produces a non-null context", () => {
    const r = validateTrendRange("30d", now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.context).toBeDefined();
  });

  it("VALID_EXTENDED_RANGES covers exactly the declared literals", () => {
    for (const range of EXTENDED_TREND_RANGES) {
      expect(VALID_EXTENDED_RANGES.has(range)).toBe(true);
    }
    expect(VALID_EXTENDED_RANGES.size).toBe(EXTENDED_TREND_RANGES.length);
  });

  it("isRangeTooLarge returns true for 366 days", () => {
    expect(isRangeTooLarge(366)).toBe(true);
  });

  it("isRangeTooLarge returns false for 365 days", () => {
    expect(isRangeTooLarge(365)).toBe(false);
  });

  it("isRangeTooLarge returns false for all declared ranges", () => {
    for (const range of EXTENDED_TREND_RANGES) {
      const days = EXTENDED_RANGE_HOURS[range] / 24;
      expect(isRangeTooLarge(days)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Future windows cannot occur through normal usage
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - future window safety", () => {
  const now = new Date("2025-06-01T12:00:00.000Z");

  it("since is always strictly before now for all valid ranges", () => {
    for (const range of EXTENDED_TREND_RANGES) {
      const r = validateTrendRange(range, now);
      if (!r.ok) throw new Error(`Should be valid: ${range}`);
      expect(r.context.since.getTime()).toBeLessThan(now.getTime());
    }
  });

  it("until = now for all valid ranges", () => {
    for (const range of EXTENDED_TREND_RANGES) {
      const r = validateTrendRange(range, now);
      if (!r.ok) throw new Error(`Should be valid: ${range}`);
      expect(r.context.until.getTime()).toBe(now.getTime());
    }
  });

  it("isFutureWindow returns true when since >= now", () => {
    const future = new Date(now.getTime() + 1000);
    expect(isFutureWindow(future, now)).toBe(true);
  });

  it("isFutureWindow returns true when since === now", () => {
    expect(isFutureWindow(now, now)).toBe(true);
  });

  it("isFutureWindow returns false for all computed since values", () => {
    for (const range of EXTENDED_TREND_RANGES) {
      const r = validateTrendRange(range, now);
      if (!r.ok) throw new Error(`Should be valid: ${range}`);
      expect(isFutureWindow(r.context.since, now)).toBe(false);
    }
  });

  it("rangeDays > 0 for all valid ranges", () => {
    for (const range of EXTENDED_TREND_RANGES) {
      const days = trendRangeToDays(range as ExtendedTrendRange);
      expect(days).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Payload truncation handled correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - truncateTrendPoints: safety cap", () => {
  it("does not truncate when count < max", () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ value: i }));
    const result = truncateTrendPoints(pts, 1000);
    expect(result.truncated).toBe(false);
    expect(result.points).toHaveLength(10);
  });

  it("does not truncate when count === max", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({ value: i }));
    const result = truncateTrendPoints(pts, 1000);
    expect(result.truncated).toBe(false);
    expect(result.points).toHaveLength(1000);
  });

  it("truncates when count > max", () => {
    const pts = Array.from({ length: 1500 }, (_, i) => ({ value: i }));
    const result = truncateTrendPoints(pts, 1000);
    expect(result.truncated).toBe(true);
    expect(result.points).toHaveLength(1000);
  });

  it("truncates from the end (keeps oldest/first points)", () => {
    const pts = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }];
    const result = truncateTrendPoints(pts, 3);
    expect(result.points).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
  });

  it("does not mutate the original array", () => {
    const pts = Array.from({ length: 1500 }, (_, i) => ({ value: i }));
    const original_length = pts.length;
    truncateTrendPoints(pts, 1000);
    expect(pts).toHaveLength(original_length);
  });

  it("willTruncate returns true when count > MAX_TREND_POINTS", () => {
    expect(willTruncate(1001)).toBe(true);
  });

  it("willTruncate returns false when count <= MAX_TREND_POINTS", () => {
    expect(willTruncate(1000)).toBe(false);
  });

  it("MAX_TREND_POINTS is 1000", () => {
    expect(MAX_TREND_POINTS).toBe(1000);
  });

  it("empty array → no truncation", () => {
    const result = truncateTrendPoints([], 1000);
    expect(result.truncated).toBe(false);
    expect(result.points).toHaveLength(0);
  });

  it("custom max parameter is respected", () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ v: i }));
    const result = truncateTrendPoints(pts, 50);
    expect(result.truncated).toBe(true);
    expect(result.points).toHaveLength(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Response contracts stable across layers (TrendEnvelope fields)
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - buildTrendEnvelope: consistent response contract", () => {
  const baseCtx = makeContext("30d");

  it("envelope contains all required fields", () => {
    const pts = [{ timestamp: "a", value: 1, sourceLayer: "raw" as const }];
    const env = buildTrendEnvelope(baseCtx, pts, false);
    expect(env).toHaveProperty("range");
    expect(env).toHaveProperty("rangeDays");
    expect(env).toHaveProperty("sourceLayer");
    expect(env).toHaveProperty("pointCount");
    expect(env).toHaveProperty("truncated");
    expect(env).toHaveProperty("points");
  });

  it("range matches the input context", () => {
    const env = buildTrendEnvelope(baseCtx, [], false);
    expect(env.range).toBe("30d");
  });

  it("rangeDays matches the input context", () => {
    const env = buildTrendEnvelope(baseCtx, [], false);
    expect(env.rangeDays).toBe(30);
  });

  it("sourceLayer matches the computed layer", () => {
    const env = buildTrendEnvelope(baseCtx, [], false);
    expect(env.sourceLayer).toBe("raw");  // 30d → raw
  });

  it("sourceLayer=hourly for 90d context", () => {
    const ctx = makeContext("90d");
    const env = buildTrendEnvelope(ctx, [], false);
    expect(env.sourceLayer).toBe("hourly");
  });

  it("sourceLayer=daily for 365d context", () => {
    const ctx = makeContext("365d");
    const env = buildTrendEnvelope(ctx, [], false);
    expect(env.sourceLayer).toBe("daily");
  });

  it("pointCount equals the length of the points array", () => {
    const pts = [1, 2, 3, 4, 5].map(i => ({ v: i }));
    const env = buildTrendEnvelope(baseCtx, pts, false);
    expect(env.pointCount).toBe(5);
  });

  it("truncated=false when not truncated", () => {
    const env = buildTrendEnvelope(baseCtx, [], false);
    expect(env.truncated).toBe(false);
  });

  it("truncated=true when truncation occurred", () => {
    const env = buildTrendEnvelope(baseCtx, [], true);
    expect(env.truncated).toBe(true);
  });

  it("empty points → pointCount=0", () => {
    const env = buildTrendEnvelope(baseCtx, [], false);
    expect(env.pointCount).toBe(0);
  });

  it("envelope is stable - same inputs always produce same output", () => {
    const pts = [{ x: 1 }];
    const e1 = buildTrendEnvelope(baseCtx, pts, false);
    const e2 = buildTrendEnvelope(baseCtx, pts, false);
    expect(e1).toEqual(e2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Tenant isolation enforced
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - tenant isolation", () => {
  it("severity serializer does not include workspaceId in output points", () => {
    const snap = makeSnapshot({ workspaceId: 999 });
    const [pt] = serializeSeverityFromSnapshots([snap], "raw");
    expect(pt).not.toHaveProperty("workspaceId");
  });

  it("error-rate serializer does not include workspaceId in output points", () => {
    const snap = makeSnapshot({ workspaceId: 999 });
    const [pt] = serializeErrorRateFromSnapshots([snap], "raw");
    expect(pt).not.toHaveProperty("workspaceId");
  });

  it("backlog serializer does not include workspaceId in output points", () => {
    const snap = makeSnapshot({ workspaceId: 999 });
    const [pt] = serializeBacklogsFromSnapshots([snap], "raw");
    expect(pt).not.toHaveProperty("workspaceId");
  });

  it("storm serializer does not include workspaceId in output points", () => {
    const snap = makeSnapshot({ workspaceId: 999 });
    const [pt] = serializeStormsFromSnapshots([snap], "raw");
    expect(pt).not.toHaveProperty("workspaceId");
  });

  it("rollup serializer does not include workspaceId in output points", () => {
    const rollup = makeRollup({ workspaceId: 42 });
    const [pt] = serializeSeverityFromRollups([rollup], "hourly");
    expect(pt).not.toHaveProperty("workspaceId");
  });

  it("no id field in any trend point (no raw DB row exposure)", () => {
    const snap = makeSnapshot({ id: 77 });
    const pts = [
      serializeSeverityFromSnapshots([snap], "raw"),
      serializeErrorRateFromSnapshots([snap], "raw"),
      serializeBacklogsFromSnapshots([snap], "raw"),
      serializeStormsFromSnapshots([snap], "raw"),
    ];
    for (const arr of pts) {
      expect(arr[0]).not.toHaveProperty("id");
    }
  });

  it("no schemaVersion in any trend point (no internal fields exposed)", () => {
    const snap = makeSnapshot({ schemaVersion: 3 });
    const pts = [
      serializeSeverityFromSnapshots([snap], "raw"),
      serializeErrorRateFromSnapshots([snap], "raw"),
      serializeBacklogsFromSnapshots([snap], "raw"),
      serializeStormsFromSnapshots([snap], "raw"),
    ];
    for (const arr of pts) {
      expect(arr[0]).not.toHaveProperty("schemaVersion");
    }
  });

  it("no alertCodes in any trend point (no JSONB internals exposed)", () => {
    const snap = makeSnapshot({ alertCodes: ["GOV-001", "GOV-002"] });
    const pts = [
      serializeSeverityFromSnapshots([snap], "raw"),
      serializeErrorRateFromSnapshots([snap], "raw"),
      serializeBacklogsFromSnapshots([snap], "raw"),
      serializeStormsFromSnapshots([snap], "raw"),
    ];
    for (const arr of pts) {
      expect(arr[0]).not.toHaveProperty("alertCodes");
    }
  });

  it("two workspaces with different data produce independent point arrays", () => {
    const ws1Snap = makeSnapshot({ workspaceId: 1, severity: "healthy" });
    const ws2Snap = makeSnapshot({ workspaceId: 2, severity: "critical" });
    const ws1Pts = serializeSeverityFromSnapshots([ws1Snap], "raw");
    const ws2Pts = serializeSeverityFromSnapshots([ws2Snap], "raw");
    expect(ws1Pts[0]?.severity).toBe("healthy");
    expect(ws2Pts[0]?.severity).toBe("critical");
    // Mutation of one does not affect the other
    expect(ws1Pts).not.toBe(ws2Pts);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Trend APIs remain read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - read-only safety guarantee", () => {
  it("no pruneSnapshots* symbol exported from governance-trends", async () => {
    const mod = await import("../governance-trends");
    const keys = Object.keys(mod);
    expect(keys.some(k => k.toLowerCase().includes("prune"))).toBe(false);
  });

  it("no buildRollup* symbol exported from governance-trends", async () => {
    const mod = await import("../governance-trends");
    const keys = Object.keys(mod);
    expect(keys.some(k => k.toLowerCase().includes("buildrollup") || k.toLowerCase().includes("build_rollup"))).toBe(false);
  });

  it("no insert* symbol exported from governance-trends", async () => {
    const mod = await import("../governance-trends");
    const keys = Object.keys(mod);
    expect(keys.some(k => k.toLowerCase().startsWith("insert"))).toBe(false);
  });

  it("no delete* symbol exported from governance-trends", async () => {
    const mod = await import("../governance-trends");
    const keys = Object.keys(mod);
    expect(keys.some(k => k.toLowerCase().startsWith("delete"))).toBe(false);
  });

  it("no captureSnapshot* symbol exported from governance-trends", async () => {
    const mod = await import("../governance-trends");
    const keys = Object.keys(mod);
    expect(keys.some(k => k.toLowerCase().includes("capture"))).toBe(false);
  });

  it("all four observability action constants are distinct strings", () => {
    const actions = [TREND_ACTION_REQUESTED, TREND_ACTION_RESOLVED, TREND_ACTION_REJECTED, TREND_ACTION_TRUNCATED];
    const unique = new Set(actions);
    expect(unique.size).toBe(4);
  });

  it("TREND_ACTION_REQUESTED = 'governance_trend_api_requested'", () => {
    expect(TREND_ACTION_REQUESTED).toBe("governance_trend_api_requested");
  });

  it("TREND_ACTION_RESOLVED = 'governance_trend_api_resolved'", () => {
    expect(TREND_ACTION_RESOLVED).toBe("governance_trend_api_resolved");
  });

  it("TREND_ACTION_REJECTED = 'governance_trend_query_rejected'", () => {
    expect(TREND_ACTION_REJECTED).toBe("governance_trend_query_rejected");
  });

  it("TREND_ACTION_TRUNCATED = 'governance_trend_payload_truncated'", () => {
    expect(TREND_ACTION_TRUNCATED).toBe("governance_trend_payload_truncated");
  });

  it("trendLayerLabel returns non-empty string for all layers", () => {
    expect(trendLayerLabel("raw").length).toBeGreaterThan(0);
    expect(trendLayerLabel("hourly").length).toBeGreaterThan(0);
    expect(trendLayerLabel("daily").length).toBeGreaterThan(0);
  });

  it("trendLayerLabel returns distinct labels for each layer", () => {
    const labels = new Set([
      trendLayerLabel("raw"),
      trendLayerLabel("hourly"),
      trendLayerLabel("daily"),
    ]);
    expect(labels.size).toBe(3);
  });

  it("MAX_TREND_RANGE_DAYS is 365", () => {
    expect(MAX_TREND_RANGE_DAYS).toBe(365);
  });
});
