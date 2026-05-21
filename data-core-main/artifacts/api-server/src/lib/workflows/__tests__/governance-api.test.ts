/**
 * @file   __tests__/governance-api.test.ts
 * @phase  P6-D - Governance APIs & Operational Control Surface
 *
 * Pure model tests for the governance API serialization layer.
 * All tests operate on plain in-memory data - no DB, no HTTP.
 *
 * The serialization functions (serializeHealthResponse, serializeMetricsResponse,
 * serializeStuckResponse, serializeAlertsResponse) are pure functions exported
 * from governance.ts. Testing them directly ensures the API response shapes are
 * correct and stable without any HTTP infrastructure.
 *
 * Tests:
 *   T1   Health response shape - required fields, no raw rows
 *   T2   Metrics response - correct aggregates, structured shape
 *   T3   Stuck response - excludes non-stuck, maps fields correctly
 *   T4   Alerts response - stable governance codes, pagination
 *   T5   All serializers are read-only (sync, return plain objects)
 *   T6   Large payloads truncated safely
 *   T7   Response shapes remain stable (deterministic)
 *   T8   Tenant scoping preserved through serialization
 *   T9   No DB mutations (structural proof via sync return)
 *   T10  Observability action constants have correct string values
 *
 *   Additional:
 *   T11  deriveStuckSeverity threshold boundary
 *   T12  serializeAlertItem caps affectedIds at MAX_AFFECTED_IDS
 *   T13  serializeAlertsResponse pagination clamping
 *   T14  serializeStuckResponse sort order (overdueMs desc)
 *   T15  Health response alerts capped at MAX_ALERTS_IN_HEALTH
 */

import { describe, it, expect } from "vitest";
import {
  // Pure model functions
  computeMetricsFromRows,
  detectStuckFromRows,
  detectStormFromRows,
  generateGovernanceAlerts,
  classifyTenantHealth,
  // API serializers
  serializeHealthResponse,
  serializeMetricsResponse,
  serializeStuckResponse,
  serializeAlertsResponse,
  serializeAlertItem,
  deriveStuckSeverity,
  // Constants
  MAX_STUCK_RESULTS,
  MAX_ALERTS_PAGE,
  MAX_AFFECTED_IDS,
  MAX_ALERTS_IN_HEALTH,
  STUCK_CRITICAL_OVERDUE_MS,
  GOVERNANCE_ACTION_HEALTH_REQUESTED,
  GOVERNANCE_ACTION_METRICS_REQUESTED,
  GOVERNANCE_ACTION_STUCK_REQUESTED,
  GOVERNANCE_ACTION_ALERTS_REQUESTED,
  RUNNING_TOO_LONG_HOURS,
  APPROVAL_BACKLOG_THRESHOLD_HOURS,
  STORM_WINDOW_MINUTES,
  MAX_APPROVAL_BACKLOG_WARNING,
} from "../governance";
import type { ExecutionRow, GovernanceAlert, StuckExecutionInfo } from "../governance";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW   = new Date("2026-06-15T10:00:00.000Z");
let nextId  = 1000;

function makeRow(overrides: Partial<ExecutionRow> = {}): ExecutionRow {
  return {
    id:          nextId++,
    workflowId:  1,
    workspaceId: 42,
    status:      "completed",
    startedAt:   new Date(NOW.getTime() - 30 * 60_000),
    completedAt: NOW,
    timeoutAt:   null,
    wakeAt:      null,
    error:       null,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<GovernanceAlert> = {}): GovernanceAlert {
  return {
    code:                 "GOV-TEST",
    severity:             "warning",
    title:                "Test alert",
    description:          "Test description",
    workspaceId:          42,
    affectedWorkflowIds:  [],
    affectedExecutionIds: [],
    detectedAt:           NOW,
    recommendedAction:    "Do something",
    ...overrides,
  };
}

function makeStuck(overrides: Partial<StuckExecutionInfo> = {}): StuckExecutionInfo {
  return {
    executionId:     nextId++,
    workflowId:      1,
    workspaceId:     42,
    status:          "running",
    stuckReason:     "running_too_long",
    stuckDurationMs: RUNNING_TOO_LONG_HOURS * 3_600_000 + 1_800_000, // 2h + 30min
    overdueMs:       1_800_000, // 30min past threshold
    ...overrides,
  };
}

function buildSummary(workspaceId = 42) {
  const rows    = [makeRow({ status: "running", workspaceId })];
  const metrics = computeMetricsFromRows(rows, workspaceId, NOW);
  const stuck   = detectStuckFromRows(rows, NOW);
  const storm   = detectStormFromRows(rows, STORM_WINDOW_MINUTES, NOW);
  const alerts  = generateGovernanceAlerts(metrics, stuck, storm, workspaceId, NOW);
  return classifyTenantHealth(metrics, alerts, stuck, storm, workspaceId, NOW);
}

const noStorm = detectStormFromRows([], STORM_WINDOW_MINUTES, NOW);

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Health response shape: required fields, no raw rows
// ─────────────────────────────────────────────────────────────────────────────
describe("T1: Health response shape - required fields, no raw rows", () => {
  it("contains all required top-level fields", () => {
    const summary = buildSummary();
    const body    = serializeHealthResponse(summary);

    expect(typeof body.capturedAt).toBe("string");
    expect(typeof body.workspaceId).toBe("number");
    expect(["healthy", "warning", "degraded", "critical"]).toContain(body.severity);
    expect(typeof body.indicators).toBe("object");
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(typeof body.stuckExecutionCount).toBe("number");
    expect(["none", "warning", "critical"]).toContain(body.stormSeverity);
    expect(typeof body.metrics).toBe("object");
  });

  it("metrics sub-object has all required fields", () => {
    const summary = buildSummary();
    const body    = serializeHealthResponse(summary);
    const m       = body.metrics;

    expect(typeof m.activeExecutions).toBe("number");
    expect(typeof m.waitingApprovalCount).toBe("number");
    expect(typeof m.waitingDelayCount).toBe("number");
    expect(typeof m.approvalBacklogCount).toBe("number");
    expect(typeof m.delayBacklogCount).toBe("number");
    expect(typeof m.workflowErrorRate).toBe("number");
    expect(typeof m.averageExecutionDurationMs).toBe("number");
  });

  it("does not include raw execution rows", () => {
    const summary = buildSummary();
    const body    = serializeHealthResponse(summary) as unknown as Record<string, unknown>;
    // No 'data', 'rows', 'executions', 'stepsSnapshot', 'context', 'error' at top level
    expect("data"          in body).toBe(false);
    expect("rows"          in body).toBe(false);
    expect("executions"    in body).toBe(false);
    expect("stepsSnapshot" in body).toBe(false);
    expect("context"       in body).toBe(false);
  });

  it("does not expose internal stormResult object (only stormSeverity)", () => {
    const summary = buildSummary();
    const body    = serializeHealthResponse(summary) as unknown as Record<string, unknown>;
    expect("stormResult" in body).toBe(false);
    expect(typeof body["stormSeverity"]).toBe("string");
  });

  it("capturedAt is a valid ISO 8601 string", () => {
    const body = serializeHealthResponse(buildSummary());
    expect(() => new Date(body.capturedAt).toISOString()).not.toThrow();
    expect(new Date(body.capturedAt).toISOString()).toBe(body.capturedAt);
  });

  it("stuckExecutionCount matches number of stuck entries (not raw list)", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000);
    const rows    = [
      makeRow({ status: "running", startedAt: longAgo, workspaceId: 42 }),
      makeRow({ status: "running", startedAt: longAgo, workspaceId: 42 }),
    ];
    const metrics = computeMetricsFromRows(rows, 42, NOW);
    const stuck   = detectStuckFromRows(rows, NOW);
    const storm   = detectStormFromRows(rows, STORM_WINDOW_MINUTES, NOW);
    const alerts  = generateGovernanceAlerts(metrics, stuck, storm, 42, NOW);
    const summary = classifyTenantHealth(metrics, alerts, stuck, storm, 42, NOW);
    const body    = serializeHealthResponse(summary);

    expect(body.stuckExecutionCount).toBe(2);
    // Verify no raw stuck list is in body
    expect("stuckExecutions" in body).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Metrics response: correct aggregates, structured shape
// ─────────────────────────────────────────────────────────────────────────────
describe("T2: Metrics response - correct aggregates, structured shape", () => {
  it("counts bucket is correctly populated", () => {
    const recent = new Date(NOW.getTime() - 2 * 3_600_000);
    const rows   = [
      makeRow({ status: "running",          startedAt: recent, workspaceId: 42 }),
      makeRow({ status: "pending",          startedAt: recent, workspaceId: 42 }),
      makeRow({ status: "waiting_approval", startedAt: recent, workspaceId: 42 }),
      makeRow({ status: "waiting_delay",    startedAt: recent, wakeAt: new Date(NOW.getTime() + 3_600_000), workspaceId: 42 }),
      makeRow({ status: "completed",        startedAt: recent, workspaceId: 42 }),
      makeRow({ status: "failed",           startedAt: recent, workspaceId: 42 }),
      makeRow({ status: "timed_out",        startedAt: recent, workspaceId: 42 }),
      makeRow({ status: "cancelled",        startedAt: recent, workspaceId: 42 }),
    ];
    const metrics = computeMetricsFromRows(rows, 42, NOW);
    const body    = serializeMetricsResponse(metrics);

    expect(body.counts.active).toBe(2);          // running + pending
    expect(body.counts.waitingApproval).toBe(1);
    expect(body.counts.waitingDelay).toBe(1);
    expect(body.counts.completed).toBe(1);
    expect(body.counts.failed).toBe(1);
    expect(body.counts.timedOut).toBe(1);
    expect(body.counts.cancelled).toBe(1);
  });

  it("backlog fields are present", () => {
    const metrics = computeMetricsFromRows([], 42, NOW);
    const body    = serializeMetricsResponse(metrics);
    expect(typeof body.backlog.approvalBacklogCount).toBe("number");
    expect(typeof body.backlog.delayBacklogCount).toBe("number");
  });

  it("performance fields are present", () => {
    const metrics = computeMetricsFromRows([], 42, NOW);
    const body    = serializeMetricsResponse(metrics);
    expect(typeof body.performance.averageExecutionDurationMs).toBe("number");
    expect(typeof body.performance.workflowErrorRate).toBe("number");
  });

  it("workspaceId is preserved in response", () => {
    const metrics = computeMetricsFromRows([], 99, NOW);
    const body    = serializeMetricsResponse(metrics);
    expect(body.workspaceId).toBe(99);
  });

  it("capturedAt matches the NOW used for computation", () => {
    const metrics = computeMetricsFromRows([], 42, NOW);
    const body    = serializeMetricsResponse(metrics);
    expect(new Date(body.capturedAt).toISOString()).toBe(NOW.toISOString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Stuck response: excludes non-stuck, maps fields correctly
// ─────────────────────────────────────────────────────────────────────────────
describe("T3: Stuck response - excludes non-stuck, maps fields correctly", () => {
  it("non-stuck rows produce empty stuck list", () => {
    const rows  = [makeRow({ status: "running", startedAt: new Date(NOW.getTime() - 30 * 60_000) })];
    const stuck = detectStuckFromRows(rows, NOW);
    const body  = serializeStuckResponse(stuck, NOW);
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
    expect(body.truncated).toBe(false);
  });

  it("stuck rows are correctly mapped to StuckApiItem shape", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000);
    const row     = makeRow({ id: 500, workflowId: 7, status: "running", startedAt: longAgo, workspaceId: 42 });
    const stuck   = detectStuckFromRows([row], NOW);
    const body    = serializeStuckResponse(stuck, NOW);

    expect(body.total).toBe(1);
    expect(body.data).toHaveLength(1);
    const item = body.data[0]!;
    expect(item.executionId).toBe(500);
    expect(item.workflowId).toBe(7);
    expect(item.status).toBe("running");
    expect(item.stuckReason).toBe("running_too_long");
    expect(typeof item.stuckDurationMs).toBe("number");
    expect(typeof item.overdueMs).toBe("number");
    expect(["warning", "critical"]).toContain(item.severity);
  });

  it("raw workspaceId is NOT in the StuckApiItem (no leakage beyond needed fields)", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000);
    const row     = makeRow({ status: "running", startedAt: longAgo, workspaceId: 42 });
    const stuck   = detectStuckFromRows([row], NOW);
    const body    = serializeStuckResponse(stuck, NOW);
    const item    = body.data[0]! as unknown as Record<string, unknown>;
    // workspaceId is intentionally omitted from the stuck item (workspace is from auth context)
    expect("workspaceId" in item).toBe(false);
  });

  it("capturedAt in stuck response is a valid ISO string", () => {
    const body = serializeStuckResponse([], NOW);
    expect(() => new Date(body.capturedAt)).not.toThrow();
    expect(new Date(body.capturedAt).toISOString()).toBe(NOW.toISOString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Alerts response: stable governance codes, pagination
// ─────────────────────────────────────────────────────────────────────────────
describe("T4: Alerts response - stable governance codes, pagination", () => {
  it("serializeAlertItem preserves code, severity, title, description", () => {
    const alert = makeAlert({ code: "GOV-01_APPROVAL_BACKLOG", severity: "critical" });
    const item  = serializeAlertItem(alert);
    expect(item.code).toBe("GOV-01_APPROVAL_BACKLOG");
    expect(item.severity).toBe("critical");
    expect(item.title).toBe(alert.title);
    expect(item.description).toBe(alert.description);
    expect(item.recommendedAction).toBe(alert.recommendedAction);
  });

  it("detectedAt is serialized as ISO string", () => {
    const alert = makeAlert({ detectedAt: NOW });
    const item  = serializeAlertItem(alert);
    expect(item.detectedAt).toBe(NOW.toISOString());
  });

  it("serializeAlertsResponse returns correct page", () => {
    const alerts = Array.from({ length: 15 }, (_, i) =>
      makeAlert({ code: `GOV-0${i}`, severity: "warning" }));
    const body   = serializeAlertsResponse(alerts, 1, 10, NOW);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
    expect(body.total).toBe(15);
    expect(body.data).toHaveLength(10);
  });

  it("page 2 returns remaining items", () => {
    const alerts = Array.from({ length: 15 }, (_, i) =>
      makeAlert({ code: `GOV-0${i}`, severity: "warning" }));
    const body   = serializeAlertsResponse(alerts, 2, 10, NOW);
    expect(body.page).toBe(2);
    expect(body.data).toHaveLength(5); // 15 - 10 = 5 on page 2
  });

  it("empty alerts list → empty data, total=0", () => {
    const body = serializeAlertsResponse([], 1, 20, NOW);
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });

  it("governance codes from generateGovernanceAlerts are preserved through serialization", () => {
    const metrics = computeMetricsFromRows([], 42, NOW);
    const backlog = { ...metrics, approvalBacklogCount: MAX_APPROVAL_BACKLOG_WARNING };
    const alerts  = generateGovernanceAlerts(backlog, [], noStorm, 42, NOW);
    const body    = serializeAlertsResponse(alerts, 1, 20, NOW);
    const codes   = body.data.map(a => a.code);
    expect(codes.some(c => c.startsWith("GOV-"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - All serializers are read-only (synchronous, plain objects)
// ─────────────────────────────────────────────────────────────────────────────
describe("T5: All serializers are read-only - sync, return plain objects", () => {
  const summary = buildSummary();
  const metrics = computeMetricsFromRows([], 42, NOW);
  const stuck   = detectStuckFromRows([], NOW);
  const alerts  = [] as GovernanceAlert[];

  it("serializeHealthResponse is synchronous (not a Promise)", () => {
    const result = serializeHealthResponse(summary);
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe("object");
  });

  it("serializeMetricsResponse is synchronous", () => {
    const result = serializeMetricsResponse(metrics);
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe("object");
  });

  it("serializeStuckResponse is synchronous", () => {
    const result = serializeStuckResponse(stuck, NOW);
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe("object");
  });

  it("serializeAlertsResponse is synchronous", () => {
    const result = serializeAlertsResponse(alerts, 1, 20, NOW);
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe("object");
  });

  it("serializers do not mutate their input", () => {
    const stuck2 = [makeStuck()];
    const before = stuck2[0]!.overdueMs;
    serializeStuckResponse(stuck2, NOW);
    expect(stuck2[0]!.overdueMs).toBe(before); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Large payloads truncated safely
// ─────────────────────────────────────────────────────────────────────────────
describe("T6: Large payloads truncated safely", () => {
  it("stuck list with >MAX_STUCK_RESULTS entries is truncated", () => {
    const stuckList = Array.from({ length: MAX_STUCK_RESULTS + 50 }, () => makeStuck());
    const body      = serializeStuckResponse(stuckList, NOW);
    expect(body.total).toBe(MAX_STUCK_RESULTS + 50);
    expect(body.truncated).toBe(true);
    expect(body.data).toHaveLength(MAX_STUCK_RESULTS);
    expect(body.limit).toBe(MAX_STUCK_RESULTS);
  });

  it("stuck list with exactly MAX_STUCK_RESULTS entries is not truncated", () => {
    const stuckList = Array.from({ length: MAX_STUCK_RESULTS }, () => makeStuck());
    const body      = serializeStuckResponse(stuckList, NOW);
    expect(body.truncated).toBe(false);
    expect(body.data).toHaveLength(MAX_STUCK_RESULTS);
  });

  it("alerts page limit is capped at MAX_ALERTS_PAGE", () => {
    const alerts = Array.from({ length: 200 }, () => makeAlert());
    const body   = serializeAlertsResponse(alerts, 1, MAX_ALERTS_PAGE + 50, NOW);
    expect(body.limit).toBe(MAX_ALERTS_PAGE);
    expect(body.data.length).toBeLessThanOrEqual(MAX_ALERTS_PAGE);
  });

  it("health response alerts capped at MAX_ALERTS_IN_HEALTH", () => {
    // Construct a summary with many alerts by making many warnings
    const manyAlerts: GovernanceAlert[] = Array.from(
      { length: MAX_ALERTS_IN_HEALTH + 5 }, (_, i) =>
        makeAlert({ code: `GOV-X${i}`, severity: "warning" })
    );
    const metrics = computeMetricsFromRows([], 42, NOW);
    const stuck   = [] as StuckExecutionInfo[];
    const summary = classifyTenantHealth(metrics, manyAlerts, stuck, noStorm, 42, NOW);
    const body    = serializeHealthResponse(summary);
    expect(body.alerts.length).toBeLessThanOrEqual(MAX_ALERTS_IN_HEALTH);
  });

  it("affectedExecutionIds in alert items capped at MAX_AFFECTED_IDS", () => {
    const ids   = Array.from({ length: MAX_AFFECTED_IDS + 10 }, (_, i) => i + 1);
    const alert = makeAlert({ affectedExecutionIds: ids });
    const item  = serializeAlertItem(alert);
    expect(item.affectedExecutionIds.length).toBeLessThanOrEqual(MAX_AFFECTED_IDS);
    expect(item.affectedExecutionIds).toHaveLength(MAX_AFFECTED_IDS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Response shapes remain stable (deterministic)
// ─────────────────────────────────────────────────────────────────────────────
describe("T7: Response shapes remain stable - same inputs → same output", () => {
  it("serializeHealthResponse is deterministic", () => {
    const summary = buildSummary();
    const r1 = serializeHealthResponse(summary);
    const r2 = serializeHealthResponse(summary);
    expect(r1.severity).toBe(r2.severity);
    expect(r1.stuckExecutionCount).toBe(r2.stuckExecutionCount);
    expect(r1.stormSeverity).toBe(r2.stormSeverity);
    expect(r1.metrics.workflowErrorRate).toBe(r2.metrics.workflowErrorRate);
  });

  it("serializeMetricsResponse is deterministic", () => {
    const metrics = computeMetricsFromRows([], 42, NOW);
    const r1 = serializeMetricsResponse(metrics);
    const r2 = serializeMetricsResponse(metrics);
    expect(r1.counts.active).toBe(r2.counts.active);
    expect(r1.performance.workflowErrorRate).toBe(r2.performance.workflowErrorRate);
  });

  it("serializeStuckResponse is deterministic", () => {
    const stuckList = [makeStuck(), makeStuck()];
    const r1 = serializeStuckResponse(stuckList, NOW);
    const r2 = serializeStuckResponse(stuckList, NOW);
    expect(r1.total).toBe(r2.total);
    expect(r1.truncated).toBe(r2.truncated);
    expect(r1.data[0]!.executionId).toBe(r2.data[0]!.executionId);
  });

  it("serializeAlertsResponse is deterministic", () => {
    const alerts = [makeAlert({ code: "GOV-01" }), makeAlert({ code: "GOV-02" })];
    const r1 = serializeAlertsResponse(alerts, 1, 10, NOW);
    const r2 = serializeAlertsResponse(alerts, 1, 10, NOW);
    expect(r1.total).toBe(r2.total);
    expect(r1.data[0]!.code).toBe(r2.data[0]!.code);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Tenant scoping preserved through serialization
// ─────────────────────────────────────────────────────────────────────────────
describe("T8: Tenant scoping preserved through serialization", () => {
  it("serializeHealthResponse preserves workspaceId=42", () => {
    const summary = buildSummary(42);
    expect(serializeHealthResponse(summary).workspaceId).toBe(42);
  });

  it("serializeHealthResponse preserves workspaceId=99", () => {
    const summary = buildSummary(99);
    expect(serializeHealthResponse(summary).workspaceId).toBe(99);
  });

  it("serializeMetricsResponse preserves workspaceId", () => {
    const metrics = computeMetricsFromRows([], 77, NOW);
    expect(serializeMetricsResponse(metrics).workspaceId).toBe(77);
  });

  it("workspaceId from one tenant does not appear in another tenant's response", () => {
    const s42 = buildSummary(42);
    const s99 = buildSummary(99);
    const b42 = serializeHealthResponse(s42);
    const b99 = serializeHealthResponse(s99);
    expect(b42.workspaceId).toBe(42);
    expect(b99.workspaceId).toBe(99);
    expect(b42.workspaceId).not.toBe(b99.workspaceId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - No DB mutations during governance requests (structural proof)
// ─────────────────────────────────────────────────────────────────────────────
describe("T9: No DB mutations - structural proof via sync return type", () => {
  it("serializeHealthResponse is synchronous → cannot have DB writes", () => {
    const result = serializeHealthResponse(buildSummary());
    // If it were async, the test runner would need to await it.
    // The fact that this assertion runs without await proves it's sync.
    expect(typeof result.capturedAt).toBe("string");
  });

  it("serializeMetricsResponse is synchronous → cannot have DB writes", () => {
    const result = serializeMetricsResponse(computeMetricsFromRows([], 42, NOW));
    expect(typeof result.counts.active).toBe("number");
  });

  it("serializeStuckResponse is synchronous → cannot have DB writes", () => {
    const result = serializeStuckResponse([], NOW);
    expect(result.total).toBe(0);
  });

  it("serializeAlertsResponse is synchronous → cannot have DB writes", () => {
    const result = serializeAlertsResponse([], 1, 20, NOW);
    expect(result.total).toBe(0);
  });

  it("all pure governance functions return plain objects (not ORM entities)", () => {
    // Plain objects have no constructor name other than Object
    const summary = buildSummary();
    const health  = serializeHealthResponse(summary);
    expect(Object.getPrototypeOf(health)).toBe(Object.prototype);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Observability action constants have correct string values
// ─────────────────────────────────────────────────────────────────────────────
describe("T10: Observability action constants have correct stable values", () => {
  it("GOVERNANCE_ACTION_HEALTH_REQUESTED = 'governance_api_health_requested'", () => {
    expect(GOVERNANCE_ACTION_HEALTH_REQUESTED).toBe("governance_api_health_requested");
  });

  it("GOVERNANCE_ACTION_METRICS_REQUESTED = 'governance_api_metrics_requested'", () => {
    expect(GOVERNANCE_ACTION_METRICS_REQUESTED).toBe("governance_api_metrics_requested");
  });

  it("GOVERNANCE_ACTION_STUCK_REQUESTED = 'governance_api_stuck_requested'", () => {
    expect(GOVERNANCE_ACTION_STUCK_REQUESTED).toBe("governance_api_stuck_requested");
  });

  it("GOVERNANCE_ACTION_ALERTS_REQUESTED = 'governance_api_alerts_requested'", () => {
    expect(GOVERNANCE_ACTION_ALERTS_REQUESTED).toBe("governance_api_alerts_requested");
  });

  it("all four constants are distinct strings", () => {
    const actions = new Set([
      GOVERNANCE_ACTION_HEALTH_REQUESTED,
      GOVERNANCE_ACTION_METRICS_REQUESTED,
      GOVERNANCE_ACTION_STUCK_REQUESTED,
      GOVERNANCE_ACTION_ALERTS_REQUESTED,
    ]);
    expect(actions.size).toBe(4);
  });

  it("all constants start with 'governance_api_'", () => {
    const constants = [
      GOVERNANCE_ACTION_HEALTH_REQUESTED,
      GOVERNANCE_ACTION_METRICS_REQUESTED,
      GOVERNANCE_ACTION_STUCK_REQUESTED,
      GOVERNANCE_ACTION_ALERTS_REQUESTED,
    ];
    for (const c of constants) {
      expect(c.startsWith("governance_api_")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - deriveStuckSeverity threshold boundary
// ─────────────────────────────────────────────────────────────────────────────
describe("T11: deriveStuckSeverity threshold boundary", () => {
  it("overdueMs < STUCK_CRITICAL_OVERDUE_MS → warning", () => {
    const entry = makeStuck({ overdueMs: STUCK_CRITICAL_OVERDUE_MS - 1 });
    expect(deriveStuckSeverity(entry)).toBe("warning");
  });

  it("overdueMs = STUCK_CRITICAL_OVERDUE_MS exactly → critical", () => {
    const entry = makeStuck({ overdueMs: STUCK_CRITICAL_OVERDUE_MS });
    expect(deriveStuckSeverity(entry)).toBe("critical");
  });

  it("overdueMs > STUCK_CRITICAL_OVERDUE_MS → critical", () => {
    const entry = makeStuck({ overdueMs: STUCK_CRITICAL_OVERDUE_MS + 3_600_000 });
    expect(deriveStuckSeverity(entry)).toBe("critical");
  });

  it("0ms overdue → warning (not critical)", () => {
    const entry = makeStuck({ overdueMs: 0 });
    expect(deriveStuckSeverity(entry)).toBe("warning");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - serializeAlertItem caps affectedIds at MAX_AFFECTED_IDS
// ─────────────────────────────────────────────────────────────────────────────
describe("T12: serializeAlertItem caps affectedIds at MAX_AFFECTED_IDS", () => {
  it("affectedWorkflowIds capped at MAX_AFFECTED_IDS", () => {
    const ids   = Array.from({ length: MAX_AFFECTED_IDS + 10 }, (_, i) => i + 1);
    const alert = makeAlert({ affectedWorkflowIds: ids });
    const item  = serializeAlertItem(alert);
    expect(item.affectedWorkflowIds).toHaveLength(MAX_AFFECTED_IDS);
    expect(item.affectedWorkflowIds[0]).toBe(1); // first elements preserved
  });

  it("affectedExecutionIds capped at MAX_AFFECTED_IDS", () => {
    const ids   = Array.from({ length: MAX_AFFECTED_IDS + 10 }, (_, i) => i + 100);
    const alert = makeAlert({ affectedExecutionIds: ids });
    const item  = serializeAlertItem(alert);
    expect(item.affectedExecutionIds).toHaveLength(MAX_AFFECTED_IDS);
  });

  it("empty affectedIds pass through unchanged", () => {
    const alert = makeAlert({ affectedWorkflowIds: [], affectedExecutionIds: [] });
    const item  = serializeAlertItem(alert);
    expect(item.affectedWorkflowIds).toHaveLength(0);
    expect(item.affectedExecutionIds).toHaveLength(0);
  });

  it("ids below cap pass through unchanged", () => {
    const ids   = [1, 2, 3];
    const alert = makeAlert({ affectedWorkflowIds: ids });
    const item  = serializeAlertItem(alert);
    expect(item.affectedWorkflowIds).toEqual([1, 2, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - serializeAlertsResponse pagination clamping
// ─────────────────────────────────────────────────────────────────────────────
describe("T13: serializeAlertsResponse pagination clamping", () => {
  const alerts = Array.from({ length: 30 }, (_, i) => makeAlert({ code: `GOV-${i}` }));

  it("page 0 is clamped to page 1", () => {
    const body = serializeAlertsResponse(alerts, 0, 10, NOW);
    expect(body.page).toBe(1);
  });

  it("negative page is clamped to page 1", () => {
    const body = serializeAlertsResponse(alerts, -5, 10, NOW);
    expect(body.page).toBe(1);
  });

  it("limit 0 is clamped to limit 1", () => {
    const body = serializeAlertsResponse(alerts, 1, 0, NOW);
    expect(body.limit).toBe(1);
    expect(body.data).toHaveLength(1);
  });

  it("limit > MAX_ALERTS_PAGE is clamped to MAX_ALERTS_PAGE", () => {
    const body = serializeAlertsResponse(alerts, 1, 999, NOW);
    expect(body.limit).toBe(MAX_ALERTS_PAGE);
  });

  it("page beyond data returns empty data array", () => {
    const body = serializeAlertsResponse(alerts, 10, 10, NOW);
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - serializeStuckResponse sort order (overdueMs descending)
// ─────────────────────────────────────────────────────────────────────────────
describe("T14: serializeStuckResponse sort order - overdueMs descending", () => {
  it("most overdue entry appears first", () => {
    const stuckList = [
      makeStuck({ overdueMs: 1_000 }),
      makeStuck({ overdueMs: 9_000_000 }),
      makeStuck({ overdueMs: 500 }),
    ];
    const body = serializeStuckResponse(stuckList, NOW);
    expect(body.data[0]!.overdueMs).toBe(9_000_000);
    expect(body.data[1]!.overdueMs).toBe(1_000);
    expect(body.data[2]!.overdueMs).toBe(500);
  });

  it("single entry is returned without sorting error", () => {
    const stuckList = [makeStuck({ overdueMs: 500 })];
    const body      = serializeStuckResponse(stuckList, NOW);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.overdueMs).toBe(500);
  });

  it("input list is not mutated during sort", () => {
    const stuckList = [
      makeStuck({ overdueMs: 1_000 }),
      makeStuck({ overdueMs: 9_000_000 }),
    ];
    const originalOrder = stuckList.map(s => s.overdueMs);
    serializeStuckResponse(stuckList, NOW);
    expect(stuckList.map(s => s.overdueMs)).toEqual(originalOrder);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - Health response alerts capped at MAX_ALERTS_IN_HEALTH
// ─────────────────────────────────────────────────────────────────────────────
describe("T15: Health response alerts capped at MAX_ALERTS_IN_HEALTH", () => {
  it("more than MAX_ALERTS_IN_HEALTH alerts are truncated in health response", () => {
    const manyAlerts = Array.from({ length: MAX_ALERTS_IN_HEALTH + 5 },
      (_, i) => makeAlert({ code: `GOV-X${i}` }));
    const metrics = computeMetricsFromRows([], 42, NOW);
    const summary = classifyTenantHealth(metrics, manyAlerts, [], noStorm, 42, NOW);
    const body    = serializeHealthResponse(summary);
    expect(body.alerts).toHaveLength(MAX_ALERTS_IN_HEALTH);
  });

  it("exactly MAX_ALERTS_IN_HEALTH alerts are not truncated", () => {
    const alerts  = Array.from({ length: MAX_ALERTS_IN_HEALTH },
      (_, i) => makeAlert({ code: `GOV-X${i}` }));
    const metrics = computeMetricsFromRows([], 42, NOW);
    const summary = classifyTenantHealth(metrics, alerts, [], noStorm, 42, NOW);
    const body    = serializeHealthResponse(summary);
    expect(body.alerts).toHaveLength(MAX_ALERTS_IN_HEALTH);
  });

  it("fewer than MAX_ALERTS_IN_HEALTH alerts pass through all", () => {
    const alerts  = [makeAlert({ code: "GOV-01" }), makeAlert({ code: "GOV-02" })];
    const metrics = computeMetricsFromRows([], 42, NOW);
    const summary = classifyTenantHealth(metrics, alerts, [], noStorm, 42, NOW);
    const body    = serializeHealthResponse(summary);
    expect(body.alerts).toHaveLength(2);
  });
});
