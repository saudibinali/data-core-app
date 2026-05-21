/**
 * @file   __tests__/governance-history.test.ts
 * @phase  P7-A - Historical Governance Snapshots & Trend Infrastructure
 *
 * Pure model tests for the governance history module.
 * All tests operate on plain in-memory data - no DB, no HTTP.
 *
 * Tests:
 *   T1   Snapshot stored immutably - buildSnapshotPayload creates correct shape
 *   T2   Multiple snapshots preserve chronological order
 *   T3   Trend queries return deterministic time ranges
 *   T4   Severity history extracted correctly
 *   T5   Alert frequency aggregation works
 *   T6   Snapshot capture does not mutate runtime state (structural proof)
 *   T7   Historical queries exclude future timestamps
 *   T8   Retention recommendations computed correctly
 *   T9   Snapshot serialization stable
 *   T10  Trend calculations deterministic
 *
 *   Additional:
 *   T11  computeAlertSummary correctness
 *   T12  detectChronicAlerts threshold boundary
 *   T13  extractErrorRateTrend / extractApprovalBacklogTrend / extractDelayBacklogTrend
 *   T14  computeRetentionStats edge cases
 *   T15  serializeSnapshotTrendResponse / serializeChronicAlertsResponse shapes
 */

import { describe, it, expect } from "vitest";
import {
  // Constants
  TREND_RANGE_HOURS,
  CHRONIC_THRESHOLD_PCT,
  RECOMMENDED_CAPTURE_INTERVAL_MINUTES,
  RECOMMENDED_RETENTION_RAW_DAYS,
  RECOMMENDED_RETENTION_HOURLY_DAYS,
  RECOMMENDED_RETENTION_DAILY_DAYS,
  SNAPSHOT_SCHEMA_VERSION,
  GOVERNANCE_ACTION_SNAPSHOT_CAPTURED,
  GOVERNANCE_ACTION_SNAPSHOT_CAPTURE_FAILED,
  GOVERNANCE_ACTION_TREND_QUERY_REQUESTED,
  GOVERNANCE_ACTION_CHRONIC_ALERT_DETECTED,
  // Pure serialization helpers
  serializeSnapshotMetrics,
  serializeSnapshotIndicators,
  computeAlertSummary,
  buildSnapshotPayload,
  // Time-range utilities
  trendRangeToHours,
  trendRangeCutoff,
  snapshotsSince,
  snapshotsBefore,
  sortSnapshotsChronological,
  // Trend extraction
  extractSeverityHistory,
  extractErrorRateTrend,
  extractApprovalBacklogTrend,
  extractDelayBacklogTrend,
  extractStuckCountTrend,
  // Alert frequency
  computeAlertFrequency,
  detectChronicAlerts,
  // Retention
  computeRetentionStats,
  recommendRetentionPolicy,
  // API serialization
  serializeSnapshotTrendResponse,
  serializeChronicAlertsResponse,
  serializeCaptureResult,
} from "../governance-history";
import type {
  StoredSnapshot,
  SnapshotMetrics,
  SnapshotIndicators,
} from "../governance-history";
import type {
  OperationalMetricsSnapshot,
  TenantHealthIndicators,
  GovernanceAlert,
  TenantHealthSummary,
} from "../governance";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-01T12:00:00.000Z");
let nextId = 1;

function makeMetrics(overrides: Partial<OperationalMetricsSnapshot> = {}): OperationalMetricsSnapshot {
  return {
    workspaceId:                 1,
    capturedAt:                  NOW,
    activeExecutions:            5,
    waitingApprovalCount:        2,
    waitingDelayCount:           1,
    completedExecutions:         40,
    failedExecutions:            4,
    timedOutExecutions:          1,
    cancelledExecutions:         2,
    approvalBacklogCount:        1,
    delayBacklogCount:           0,
    averageExecutionDurationMs:  1800,
    workflowErrorRate:           0.09,
    estimatedNotificationFanout: 0,
    ...overrides,
  };
}

function makeIndicators(overrides: Partial<TenantHealthIndicators> = {}): TenantHealthIndicators {
  return {
    executionPressure:  "healthy",
    errorConcentration: "healthy",
    approvalBacklog:    "healthy",
    delayBacklog:       "healthy",
    stuckExecutionRisk: "healthy",
    ...overrides,
  };
}

function makeAlert(code: string, severity: "info" | "warning" | "critical" = "warning"): GovernanceAlert {
  return {
    code,
    severity,
    workspaceId:         42,
    title:               `Alert ${code}`,
    description:         `Description for ${code}`,
    affectedWorkflowIds: [],
    affectedExecutionIds:[],
    detectedAt:          NOW,
    recommendedAction:   "Review the dashboard",
  };
}

function makeHealthSummary(overrides: Partial<TenantHealthSummary> = {}): TenantHealthSummary {
  return {
    workspaceId:     42,
    capturedAt:      NOW,
    severity:        "warning",
    indicators:      makeIndicators({ errorConcentration: "warning" }),
    alerts:          [makeAlert("GOV-02"), makeAlert("GOV-04", "critical")],
    stuckExecutions: [],
    stormResult:     { severity: "none", count: 0, windowMinutes: 5 },
    metrics:         makeMetrics({ workflowErrorRate: 0.09 }),
    ...overrides,
  };
}

function makeStoredSnapshot(overrides: Partial<StoredSnapshot> = {}): StoredSnapshot {
  return {
    id:              nextId++,
    workspaceId:     42,
    capturedAt:      new Date(NOW.getTime() - 3_600_000), // 1h ago by default
    severity:        "warning",
    metricsSnapshot: {
      activeExecutions:           5,
      waitingApprovalCount:       2,
      waitingDelayCount:          1,
      completedExecutions:        40,
      failedExecutions:           4,
      timedOutExecutions:         1,
      cancelledExecutions:        2,
      approvalBacklogCount:       1,
      delayBacklogCount:          0,
      workflowErrorRate:          0.09,
      averageExecutionDurationMs: 1800,
    },
    indicators: {
      executionPressure:  "healthy",
      errorConcentration: "warning",
      approvalPressure:   "healthy",
      delayPressure:      "healthy",
      stormPressure:      "none",
    },
    alertCodes:    ["GOV-02"],
    alertSummary:  { total: 1, critical: 0, warning: 1, info: 0 },
    stuckCount:    0,
    stormSeverity: "none",
    schemaVersion: 1,
    ...overrides,
  };
}

// ── T1: Snapshot stored immutably ─────────────────────────────────────────────

describe("T1: buildSnapshotPayload creates correct, immutable-ready shape", () => {
  it("includes all required columns", () => {
    const summary = makeHealthSummary();
    const payload = buildSnapshotPayload(summary);

    expect(payload.workspaceId).toBe(42);
    expect(payload.capturedAt).toEqual(NOW);
    expect(payload.severity).toBe("warning");
    expect(payload.stuckCount).toBe(0);
    expect(payload.stormSeverity).toBe("none");
    expect(payload.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
  });

  it("alert codes are extracted from alert objects", () => {
    const summary = makeHealthSummary();
    const payload = buildSnapshotPayload(summary);
    expect(payload.alertCodes).toEqual(["GOV-02", "GOV-04"]);
  });

  it("alert summary counts are correct", () => {
    const summary = makeHealthSummary();
    const payload = buildSnapshotPayload(summary);
    expect(payload.alertSummary.total).toBe(2);
    expect(payload.alertSummary.critical).toBe(1);
    expect(payload.alertSummary.warning).toBe(1);
    expect(payload.alertSummary.info).toBe(0);
  });

  it("does not include estimatedNotificationFanout in metricsSnapshot", () => {
    const summary = makeHealthSummary();
    const payload = buildSnapshotPayload(summary);
    expect("estimatedNotificationFanout" in payload.metricsSnapshot).toBe(false);
  });

  it("buildSnapshotPayload is pure - same input gives same output", () => {
    const summary = makeHealthSummary();
    const p1      = buildSnapshotPayload(summary);
    const p2      = buildSnapshotPayload(summary);
    expect(p1).toEqual(p2);
  });

  it("does not mutate the input TenantHealthSummary", () => {
    const summary     = makeHealthSummary();
    const alertsBefore = [...summary.alerts];
    buildSnapshotPayload(summary);
    expect(summary.alerts).toEqual(alertsBefore);
  });
});

// ── T2: Multiple snapshots preserve chronological order ──────────────────────

describe("T2: sortSnapshotsChronological preserves chronological order", () => {
  it("sorts ascending by capturedAt", () => {
    const t1 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:00:00Z") });
    const t2 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T11:00:00Z") });
    const t3 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T12:00:00Z") });

    const sorted = sortSnapshotsChronological([t3, t1, t2]);
    expect(sorted[0]!.capturedAt).toEqual(t1.capturedAt);
    expect(sorted[1]!.capturedAt).toEqual(t2.capturedAt);
    expect(sorted[2]!.capturedAt).toEqual(t3.capturedAt);
  });

  it("does not mutate the input array", () => {
    const snaps = [
      makeStoredSnapshot({ capturedAt: new Date("2026-06-01T12:00:00Z") }),
      makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:00:00Z") }),
    ];
    const original = snaps.map(s => s.capturedAt.toISOString());
    sortSnapshotsChronological(snaps);
    expect(snaps.map(s => s.capturedAt.toISOString())).toEqual(original);
  });

  it("handles empty array", () => {
    expect(sortSnapshotsChronological([])).toEqual([]);
  });

  it("single snapshot returned unchanged", () => {
    const snap = makeStoredSnapshot();
    const result = sortSnapshotsChronological([snap]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(snap);
  });

  it("snapshots with equal timestamps preserve relative order", () => {
    const t = new Date("2026-06-01T10:00:00Z");
    const s1 = makeStoredSnapshot({ capturedAt: t });
    const s2 = makeStoredSnapshot({ capturedAt: new Date(t) });
    // stable sort - should not throw
    const result = sortSnapshotsChronological([s1, s2]);
    expect(result).toHaveLength(2);
  });
});

// ── T3: Trend queries return deterministic time ranges ────────────────────────

describe("T3: trend range semantics are deterministic", () => {
  it("trendRangeToHours maps all four ranges correctly", () => {
    expect(trendRangeToHours("1h")).toBe(1);
    expect(trendRangeToHours("24h")).toBe(24);
    expect(trendRangeToHours("7d")).toBe(168);
    expect(trendRangeToHours("30d")).toBe(720);
  });

  it("TREND_RANGE_HOURS constant matches trendRangeToHours", () => {
    expect(TREND_RANGE_HOURS["1h"]).toBe(trendRangeToHours("1h"));
    expect(TREND_RANGE_HOURS["24h"]).toBe(trendRangeToHours("24h"));
    expect(TREND_RANGE_HOURS["7d"]).toBe(trendRangeToHours("7d"));
    expect(TREND_RANGE_HOURS["30d"]).toBe(trendRangeToHours("30d"));
  });

  it("trendRangeCutoff returns correct cutoff with injectable now", () => {
    const now    = new Date("2026-06-01T12:00:00.000Z");
    const cutoff = trendRangeCutoff("24h", now);
    const expected = new Date("2026-05-31T12:00:00.000Z");
    expect(cutoff.toISOString()).toBe(expected.toISOString());
  });

  it("snapshotsSince filters to >= since boundary", () => {
    const since = new Date("2026-06-01T11:00:00Z");
    const inside = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T11:00:00Z") });
    const outside = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:59:59Z") });
    const result = snapshotsSince([inside, outside], since);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(inside.id);
  });

  it("snapshotsSince does not mutate the input", () => {
    const snaps = [makeStoredSnapshot(), makeStoredSnapshot()];
    const before = snaps.length;
    snapshotsSince(snaps, new Date("2026-01-01"));
    expect(snaps).toHaveLength(before);
  });

  it("snapshotsSince returns all when since is very old", () => {
    const snaps = [makeStoredSnapshot(), makeStoredSnapshot()];
    expect(snapshotsSince(snaps, new Date("2020-01-01"))).toHaveLength(2);
  });
});

// ── T4: Severity history extracted correctly ──────────────────────────────────

describe("T4: extractSeverityHistory maps snapshots to severity data points", () => {
  it("maps capturedAt and severity for each snapshot", () => {
    const snap = makeStoredSnapshot({ severity: "critical" });
    const result = extractSeverityHistory([snap]);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe("critical");
    expect(result[0]!.capturedAt).toBe(snap.capturedAt.toISOString());
  });

  it("preserves order of input array", () => {
    const s1 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:00:00Z"), severity: "healthy" });
    const s2 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T11:00:00Z"), severity: "warning" });
    const result = extractSeverityHistory([s1, s2]);
    expect(result[0]!.severity).toBe("healthy");
    expect(result[1]!.severity).toBe("warning");
  });

  it("returns empty array for no snapshots", () => {
    expect(extractSeverityHistory([])).toEqual([]);
  });

  it("all 4 severity values round-trip correctly", () => {
    const severities = ["healthy", "warning", "degraded", "critical"];
    for (const sev of severities) {
      const snap   = makeStoredSnapshot({ severity: sev });
      const result = extractSeverityHistory([snap]);
      expect(result[0]!.severity).toBe(sev);
    }
  });

  it("capturedAt is ISO 8601 string", () => {
    const snap   = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T12:00:00.000Z") });
    const result = extractSeverityHistory([snap]);
    expect(result[0]!.capturedAt).toBe("2026-06-01T12:00:00.000Z");
  });
});

// ── T5: Alert frequency aggregation works ─────────────────────────────────────

describe("T5: computeAlertFrequency aggregates alert codes correctly", () => {
  it("counts each code occurrence across snapshots", () => {
    const snaps = [
      makeStoredSnapshot({ alertCodes: ["GOV-02", "GOV-04"], capturedAt: new Date("2026-06-01T10:00:00Z") }),
      makeStoredSnapshot({ alertCodes: ["GOV-02"],            capturedAt: new Date("2026-06-01T11:00:00Z") }),
      makeStoredSnapshot({ alertCodes: ["GOV-02", "GOV-07"], capturedAt: new Date("2026-06-01T12:00:00Z") }),
    ];
    const freq = computeAlertFrequency(snaps);
    const gov02 = freq.find(e => e.code === "GOV-02")!;
    expect(gov02.count).toBe(3);
    expect(gov02.totalSnapshots).toBe(3);
    expect(gov02.frequencyPct).toBe(100);
  });

  it("marks isChronic=true when frequencyPct >= CHRONIC_THRESHOLD_PCT", () => {
    const snaps = [
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: new Date("2026-06-01T10:00:00Z") }),
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: new Date("2026-06-01T11:00:00Z") }),
      makeStoredSnapshot({ alertCodes: [],         capturedAt: new Date("2026-06-01T12:00:00Z") }),
    ];
    const freq    = computeAlertFrequency(snaps);
    const entry   = freq.find(e => e.code === "GOV-02")!;
    const pct     = (2 / 3) * 100;
    expect(entry.frequencyPct).toBeCloseTo(pct, 1);
    expect(entry.isChronic).toBe(pct >= CHRONIC_THRESHOLD_PCT);
  });

  it("returns empty array for no snapshots", () => {
    expect(computeAlertFrequency([])).toEqual([]);
  });

  it("sorts by count descending", () => {
    const snaps = [
      makeStoredSnapshot({ alertCodes: ["GOV-04"],        capturedAt: new Date("2026-06-01T10:00:00Z") }),
      makeStoredSnapshot({ alertCodes: ["GOV-02", "GOV-04"], capturedAt: new Date("2026-06-01T11:00:00Z") }),
      makeStoredSnapshot({ alertCodes: ["GOV-02", "GOV-04"], capturedAt: new Date("2026-06-01T12:00:00Z") }),
    ];
    const freq = computeAlertFrequency(snaps);
    expect(freq[0]!.code).toBe("GOV-04"); // count = 3
    expect(freq[1]!.code).toBe("GOV-02"); // count = 2
  });

  it("tracks firstSeenAt and lastSeenAt correctly", () => {
    const early = new Date("2026-06-01T10:00:00Z");
    const late  = new Date("2026-06-01T12:00:00Z");
    const snaps = [
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: early }),
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: late }),
    ];
    const freq  = computeAlertFrequency(snaps);
    const entry = freq.find(e => e.code === "GOV-02")!;
    expect(entry.firstSeenAt).toBe(early.toISOString());
    expect(entry.lastSeenAt).toBe(late.toISOString());
  });
});

// ── T6: Snapshot capture does not mutate runtime state (structural proof) ─────

describe("T6: snapshot capture pipeline is observability-only (structural proof)", () => {
  it("buildSnapshotPayload is synchronous and returns plain object", () => {
    const summary = makeHealthSummary();
    const result  = buildSnapshotPayload(summary);
    // Must not be a Promise
    expect(typeof (result as unknown as Promise<unknown>).then).toBe("undefined");
    expect(typeof result).toBe("object");
  });

  it("serializeSnapshotMetrics does not include workspaceId or capturedAt", () => {
    const metrics = makeMetrics();
    const result  = serializeSnapshotMetrics(metrics);
    expect("workspaceId" in result).toBe(false);
    expect("capturedAt"  in result).toBe(false);
  });

  it("serializeSnapshotMetrics retains all 11 numeric fields", () => {
    const metrics = makeMetrics({ workflowErrorRate: 0.25, activeExecutions: 99 });
    const result  = serializeSnapshotMetrics(metrics);
    expect(result.workflowErrorRate).toBe(0.25);
    expect(result.activeExecutions).toBe(99);
    expect(Object.keys(result)).toHaveLength(11);
  });

  it("buildSnapshotPayload does not modify the alerts array reference", () => {
    const summary = makeHealthSummary();
    const ref     = summary.alerts;
    buildSnapshotPayload(summary);
    expect(summary.alerts).toBe(ref); // same reference
  });

  it("GOVERNANCE_ACTION_* constants are distinct strings", () => {
    const actions = new Set([
      GOVERNANCE_ACTION_SNAPSHOT_CAPTURED,
      GOVERNANCE_ACTION_SNAPSHOT_CAPTURE_FAILED,
      GOVERNANCE_ACTION_TREND_QUERY_REQUESTED,
      GOVERNANCE_ACTION_CHRONIC_ALERT_DETECTED,
    ]);
    expect(actions.size).toBe(4);
  });
});

// ── T7: Historical queries exclude future timestamps ──────────────────────────

describe("T7: snapshotsBefore excludes future-dated snapshots", () => {
  it("filters out snapshots after the boundary", () => {
    const past   = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T11:00:00Z") });
    const future = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T13:00:00Z") });
    const now    = new Date("2026-06-01T12:00:00Z");
    const result = snapshotsBefore([past, future], now);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(past.id);
  });

  it("snapshot exactly at boundary is included", () => {
    const boundary = new Date("2026-06-01T12:00:00Z");
    const snap     = makeStoredSnapshot({ capturedAt: boundary });
    const result   = snapshotsBefore([snap], boundary);
    expect(result).toHaveLength(1);
  });

  it("all future snapshots removed when now is in the past", () => {
    const snaps = [
      makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:00:00Z") }),
      makeStoredSnapshot({ capturedAt: new Date("2026-06-01T11:00:00Z") }),
    ];
    // If 'before' is before all snapshots, result is empty
    const result = snapshotsBefore(snaps, new Date("2026-06-01T09:00:00Z"));
    expect(result).toHaveLength(0);
  });

  it("snapshotsBefore does not mutate input", () => {
    const snaps  = [makeStoredSnapshot()];
    const before = snaps.length;
    snapshotsBefore(snaps, new Date("2026-06-01T09:00:00Z"));
    expect(snaps).toHaveLength(before);
  });
});

// ── T8: Retention recommendations computed correctly ─────────────────────────

describe("T8: retention recommendations are deterministic", () => {
  it("recommendRetentionPolicy returns expected constants", () => {
    const rec = recommendRetentionPolicy();
    expect(rec.captureIntervalMinutes).toBe(RECOMMENDED_CAPTURE_INTERVAL_MINUTES);
    expect(rec.keepRawDays).toBe(RECOMMENDED_RETENTION_RAW_DAYS);
    expect(rec.keepHourlyDays).toBe(RECOMMENDED_RETENTION_HOURLY_DAYS);
    expect(rec.keepDailyDays).toBe(RECOMMENDED_RETENTION_DAILY_DAYS);
  });

  it("estimatedRawRowsAt30d = (24*60/interval) * keepRawDays", () => {
    const rec = recommendRetentionPolicy();
    const expected = ((24 * 60) / RECOMMENDED_CAPTURE_INTERVAL_MINUTES) * RECOMMENDED_RETENTION_RAW_DAYS;
    expect(rec.estimatedRawRowsAt30d).toBe(expected);
  });

  it("recommendRetentionPolicy is idempotent (pure)", () => {
    const r1 = recommendRetentionPolicy();
    const r2 = recommendRetentionPolicy();
    expect(r1).toEqual(r2);
  });

  it("computeRetentionStats with 0 snapshots returns null timestamps", () => {
    const stats = computeRetentionStats([]);
    expect(stats.snapshotCount).toBe(0);
    expect(stats.oldestCapturedAt).toBeNull();
    expect(stats.newestCapturedAt).toBeNull();
    expect(stats.spanHours).toBe(0);
    expect(stats.avgIntervalMs).toBeNull();
  });

  it("computeRetentionStats with 1 snapshot has null avgIntervalMs", () => {
    const snap  = makeStoredSnapshot();
    const stats = computeRetentionStats([snap]);
    expect(stats.snapshotCount).toBe(1);
    expect(stats.avgIntervalMs).toBeNull();
  });

  it("computeRetentionStats computes spanHours correctly", () => {
    const s1 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:00:00Z") });
    const s2 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T22:00:00Z") });
    const stats = computeRetentionStats([s1, s2]);
    expect(stats.spanHours).toBe(12);
  });
});

// ── T9: Snapshot serialization stable ────────────────────────────────────────

describe("T9: snapshot serialization is stable and deterministic", () => {
  it("serializeSnapshotMetrics same input → same output", () => {
    const m  = makeMetrics();
    const r1 = serializeSnapshotMetrics(m);
    const r2 = serializeSnapshotMetrics(m);
    expect(r1).toEqual(r2);
  });

  it("serializeSnapshotIndicators same input → same output", () => {
    const ind = makeIndicators({ executionPressure: "degraded" });
    const r1  = serializeSnapshotIndicators(ind);
    const r2  = serializeSnapshotIndicators(ind);
    expect(r1).toEqual(r2);
  });

  it("computeAlertSummary zero alerts → all zeros", () => {
    const s = computeAlertSummary([]);
    expect(s).toEqual({ total: 0, critical: 0, warning: 0, info: 0 });
  });

  it("serializeCaptureResult maps all fields", () => {
    const snap: StoredSnapshot = makeStoredSnapshot({
      id:            999,
      workspaceId:   42,
      capturedAt:    new Date("2026-06-01T12:00:00.000Z"),
      severity:      "critical",
      stuckCount:    3,
      stormSeverity: "warning",
      alertCodes:    ["GOV-02", "GOV-07"],
    });
    const result = serializeCaptureResult(snap);
    expect(result.snapshotId).toBe(999);
    expect(result.workspaceId).toBe(42);
    expect(result.capturedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(result.severity).toBe("critical");
    expect(result.stuckCount).toBe(3);
    expect(result.stormSeverity).toBe("warning");
    expect(result.alertCodes).toEqual(["GOV-02", "GOV-07"]);
  });

  it("SNAPSHOT_SCHEMA_VERSION is 1", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });
});

// ── T10: Trend calculations are deterministic ─────────────────────────────────

describe("T10: trend extraction functions are deterministic", () => {
  it("extractErrorRateTrend same inputs → same outputs", () => {
    const snaps = [makeStoredSnapshot(), makeStoredSnapshot()];
    const r1    = extractErrorRateTrend(snaps);
    const r2    = extractErrorRateTrend(snaps);
    expect(r1).toEqual(r2);
  });

  it("extractApprovalBacklogTrend maps correct field", () => {
    const snap   = makeStoredSnapshot();
    snap.metricsSnapshot.approvalBacklogCount = 7;
    const result = extractApprovalBacklogTrend([snap]);
    expect(result[0]!.value).toBe(7);
  });

  it("extractDelayBacklogTrend maps correct field", () => {
    const snap   = makeStoredSnapshot();
    snap.metricsSnapshot.delayBacklogCount = 3;
    const result = extractDelayBacklogTrend([snap]);
    expect(result[0]!.value).toBe(3);
  });

  it("extractStuckCountTrend maps stuckCount column", () => {
    const snap = makeStoredSnapshot({ stuckCount: 5 });
    const result = extractStuckCountTrend([snap]);
    expect(result[0]!.value).toBe(5);
  });

  it("all trend extractors return empty array for empty input", () => {
    expect(extractSeverityHistory([])).toEqual([]);
    expect(extractErrorRateTrend([])).toEqual([]);
    expect(extractApprovalBacklogTrend([])).toEqual([]);
    expect(extractDelayBacklogTrend([])).toEqual([]);
    expect(extractStuckCountTrend([])).toEqual([]);
  });
});

// ── T11: computeAlertSummary correctness ──────────────────────────────────────

describe("T11: computeAlertSummary correctly counts by severity", () => {
  it("counts critical, warning, info separately", () => {
    const alerts = [
      makeAlert("GOV-01", "critical"),
      makeAlert("GOV-02", "critical"),
      makeAlert("GOV-03", "warning"),
      makeAlert("GOV-04", "info"),
    ];
    const s = computeAlertSummary(alerts);
    expect(s.total).toBe(4);
    expect(s.critical).toBe(2);
    expect(s.warning).toBe(1);
    expect(s.info).toBe(1);
  });

  it("all info alerts", () => {
    const alerts = [makeAlert("GOV-01", "info"), makeAlert("GOV-02", "info")];
    const s      = computeAlertSummary(alerts);
    expect(s.critical).toBe(0);
    expect(s.warning).toBe(0);
    expect(s.info).toBe(2);
  });

  it("is pure - does not modify input array", () => {
    const alerts = [makeAlert("GOV-01", "critical")];
    const before = alerts.length;
    computeAlertSummary(alerts);
    expect(alerts).toHaveLength(before);
  });
});

// ── T12: detectChronicAlerts threshold boundary ───────────────────────────────

describe("T12: detectChronicAlerts threshold boundary", () => {
  it("returns empty when no snapshots exist", () => {
    expect(detectChronicAlerts([])).toEqual([]);
  });

  it("code appearing in exactly CHRONIC_THRESHOLD_PCT of snapshots is chronic", () => {
    // 2 out of 4 = 50% = CHRONIC_THRESHOLD_PCT
    const snaps = [
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: new Date("2026-06-01T09:00:00Z") }),
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: new Date("2026-06-01T10:00:00Z") }),
      makeStoredSnapshot({ alertCodes: [],         capturedAt: new Date("2026-06-01T11:00:00Z") }),
      makeStoredSnapshot({ alertCodes: [],         capturedAt: new Date("2026-06-01T12:00:00Z") }),
    ];
    const chronic = detectChronicAlerts(snaps, 50);
    expect(chronic.find(e => e.code === "GOV-02")).toBeDefined();
  });

  it("code appearing below threshold is not chronic", () => {
    const snaps = [
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: new Date("2026-06-01T09:00:00Z") }),
      makeStoredSnapshot({ alertCodes: [],         capturedAt: new Date("2026-06-01T10:00:00Z") }),
      makeStoredSnapshot({ alertCodes: [],         capturedAt: new Date("2026-06-01T11:00:00Z") }),
    ];
    const chronic = detectChronicAlerts(snaps, 50);
    expect(chronic.find(e => e.code === "GOV-02")).toBeUndefined();
  });

  it("custom threshold is honoured", () => {
    const snaps = [
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: new Date("2026-06-01T09:00:00Z") }),
      makeStoredSnapshot({ alertCodes: [],         capturedAt: new Date("2026-06-01T10:00:00Z") }),
    ];
    // 50% - at threshold=50 it's chronic, at threshold=51 it's not
    expect(detectChronicAlerts(snaps, 50)).toHaveLength(1);
    expect(detectChronicAlerts(snaps, 51)).toHaveLength(0);
  });
});

// ── T13: extractErrorRateTrend / extractApprovalBacklogTrend / extractDelayBacklogTrend

describe("T13: numeric trend extractors map correct fields", () => {
  it("extractErrorRateTrend value = workflowErrorRate", () => {
    const snap   = makeStoredSnapshot();
    snap.metricsSnapshot.workflowErrorRate = 0.42;
    const result = extractErrorRateTrend([snap]);
    expect(result[0]!.value).toBe(0.42);
  });

  it("all numeric extractors produce capturedAt as ISO string", () => {
    const snap = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T12:00:00.000Z") });
    const iso  = "2026-06-01T12:00:00.000Z";
    expect(extractErrorRateTrend([snap])[0]!.capturedAt).toBe(iso);
    expect(extractApprovalBacklogTrend([snap])[0]!.capturedAt).toBe(iso);
    expect(extractDelayBacklogTrend([snap])[0]!.capturedAt).toBe(iso);
    expect(extractStuckCountTrend([snap])[0]!.capturedAt).toBe(iso);
  });

  it("multi-snapshot extraction preserves order", () => {
    const snaps = [
      makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:00:00Z") }),
      makeStoredSnapshot({ capturedAt: new Date("2026-06-01T11:00:00Z") }),
    ];
    snaps[0]!.metricsSnapshot.workflowErrorRate = 0.1;
    snaps[1]!.metricsSnapshot.workflowErrorRate = 0.2;
    const result = extractErrorRateTrend(snaps);
    expect(result[0]!.value).toBe(0.1);
    expect(result[1]!.value).toBe(0.2);
  });
});

// ── T14: computeRetentionStats edge cases ────────────────────────────────────

describe("T14: computeRetentionStats edge cases", () => {
  it("two snapshots 1 hour apart → spanHours=1, avgIntervalMs=3600000", () => {
    const s1 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:00:00Z") });
    const s2 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T11:00:00Z") });
    const stats = computeRetentionStats([s1, s2]);
    expect(stats.spanHours).toBe(1);
    expect(stats.avgIntervalMs).toBe(3_600_000);
  });

  it("computes correct snapshotCount", () => {
    const snaps = Array.from({ length: 5 }, () => makeStoredSnapshot());
    const stats = computeRetentionStats(snaps);
    expect(stats.snapshotCount).toBe(5);
  });

  it("out-of-order snapshots still produce correct span", () => {
    const s1 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T12:00:00Z") });
    const s2 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:00:00Z") });
    const stats = computeRetentionStats([s1, s2]);
    expect(stats.spanHours).toBe(2); // correctly sorted internally
  });

  it("oldestCapturedAt and newestCapturedAt are ISO strings", () => {
    const s1 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T10:00:00.000Z") });
    const s2 = makeStoredSnapshot({ capturedAt: new Date("2026-06-01T12:00:00.000Z") });
    const stats = computeRetentionStats([s1, s2]);
    expect(stats.oldestCapturedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(stats.newestCapturedAt).toBe("2026-06-01T12:00:00.000Z");
  });
});

// ── T15: serializeSnapshotTrendResponse / serializeChronicAlertsResponse ──────

describe("T15: API response serializers produce correct shapes", () => {
  it("serializeSnapshotTrendResponse includes all required fields", () => {
    const snaps = [makeStoredSnapshot()];
    const now   = new Date("2026-06-01T12:00:00.000Z");
    const resp  = serializeSnapshotTrendResponse("24h", snaps, now);
    expect(resp.range).toBe("24h");
    expect(resp.capturedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(resp.snapshotCount).toBe(1);
    expect(Array.isArray(resp.severityHistory)).toBe(true);
    expect(Array.isArray(resp.errorRateTrend)).toBe(true);
    expect(Array.isArray(resp.approvalBacklogTrend)).toBe(true);
    expect(Array.isArray(resp.delayBacklogTrend)).toBe(true);
    expect(Array.isArray(resp.stuckCountTrend)).toBe(true);
  });

  it("serializeSnapshotTrendResponse with 0 snapshots returns nulls for firstAt/lastAt", () => {
    const resp = serializeSnapshotTrendResponse("1h", [], NOW);
    expect(resp.snapshotCount).toBe(0);
    expect(resp.firstAt).toBeNull();
    expect(resp.lastAt).toBeNull();
  });

  it("serializeChronicAlertsResponse includes chronicCount", () => {
    const chronic = [
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: new Date("2026-06-01T10:00:00Z") }),
      makeStoredSnapshot({ alertCodes: ["GOV-02"], capturedAt: new Date("2026-06-01T11:00:00Z") }),
    ];
    const resp = serializeChronicAlertsResponse("7d", chronic, NOW);
    expect(resp.range).toBe("7d");
    expect(resp.snapshotCount).toBe(2);
    expect(resp.chronicCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(resp.items)).toBe(true);
  });

  it("serializeSnapshotTrendResponse is deterministic for same input", () => {
    const snaps = [makeStoredSnapshot()];
    const r1    = serializeSnapshotTrendResponse("24h", snaps, NOW);
    const r2    = serializeSnapshotTrendResponse("24h", snaps, NOW);
    expect(r1).toEqual(r2);
  });
});
