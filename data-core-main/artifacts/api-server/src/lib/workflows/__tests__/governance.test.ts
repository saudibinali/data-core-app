/**
 * @file   __tests__/governance.test.ts
 * @phase  P6-C - Operational Governance & Platform Monitoring Foundations
 *
 * Pure model tests for the operational governance engine.
 * All tests operate on plain in-memory data - no DB, no HTTP.
 *
 * Tests:
 *   T1   Tenant metrics aggregation - counts by status
 *   T2   Approval backlog detection - waiting_approval > threshold
 *   T3   Delay backlog detection - waiting_delay past wake_at
 *   T4   Stuck execution detection - running too long, approval overdue, delay overdue
 *   T5   Automation storm detection - burst within rolling window
 *   T6   Severity classification - healthy / warning / degraded / critical
 *   T7   Metrics deterministic - same inputs → identical outputs
 *   T8   Cancelled / timed_out excluded from active counts
 *   T9   workflowErrorRate calculation
 *   T10  Health summaries generated without DB side effects (structural proof)
 *
 *   Additional:
 *   T11  generateGovernanceAlerts emits correct codes
 *   T12  classifyIndicators per-dimension severity
 *   T13  classifyOverallSeverity escalation logic
 *   T14  Stuck execution info fields are correct
 *   T15  Storm detection threshold boundaries
 */

import { describe, it, expect } from "vitest";
import {
  computeMetricsFromRows,
  detectStuckFromRows,
  detectStormFromRows,
  generateGovernanceAlerts,
  classifyIndicators,
  classifyOverallSeverity,
  classifyTenantHealth,
  // Exported thresholds
  APPROVAL_BACKLOG_THRESHOLD_HOURS,
  DELAY_OVERDUE_GRACE_MINUTES,
  RUNNING_TOO_LONG_HOURS,
  HIGH_ERROR_RATE_THRESHOLD,
  CRITICAL_ERROR_RATE_THRESHOLD,
  MAX_ACTIVE_WARNING,
  MAX_ACTIVE_CRITICAL,
  MAX_APPROVAL_BACKLOG_WARNING,
  MAX_APPROVAL_BACKLOG_CRITICAL,
  DELAY_BACKLOG_WARNING,
  DELAY_BACKLOG_CRITICAL,
  STORM_THRESHOLD_WARNING,
  STORM_THRESHOLD_CRITICAL,
  STORM_WINDOW_MINUTES,
} from "../governance";
import type { ExecutionRow, GovernanceAlert } from "../governance";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-01T12:00:00.000Z");

let nextId = 1;

function makeRow(overrides: Partial<ExecutionRow> = {}): ExecutionRow {
  return {
    id:          nextId++,
    workflowId:  1,
    workspaceId: 10,
    status:      "completed",
    startedAt:   new Date(NOW.getTime() - 30 * 60_000), // 30 min ago
    completedAt: NOW,
    timeoutAt:   null,
    wakeAt:      null,
    error:       null,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<ReturnType<typeof computeMetricsFromRows>>) {
  const base = computeMetricsFromRows([], 10, NOW);
  return { ...base, ...overrides };
}

// Empty storm result helper
const noStorm = detectStormFromRows([], STORM_WINDOW_MINUTES, NOW);

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Tenant metrics aggregation
// ─────────────────────────────────────────────────────────────────────────────
describe("T1: Tenant metrics aggregation", () => {
  it("counts active executions (pending + running)", () => {
    const rows = [
      makeRow({ status: "pending" }),
      makeRow({ status: "running" }),
      makeRow({ status: "running" }),
      makeRow({ status: "completed" }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.activeExecutions).toBe(3); // pending + running
  });

  it("counts waitingApprovalCount and waitingDelayCount separately", () => {
    const rows = [
      makeRow({ status: "waiting_approval" }),
      makeRow({ status: "waiting_approval" }),
      makeRow({ status: "waiting_delay", wakeAt: new Date(NOW.getTime() + 3_600_000) }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.waitingApprovalCount).toBe(2);
    expect(m.waitingDelayCount).toBe(1);
    expect(m.activeExecutions).toBe(0); // approval/delay are separate buckets
  });

  it("counts recent completed, failed, timed_out, cancelled", () => {
    const recentAgo = new Date(NOW.getTime() - 2 * 3_600_000); // 2h ago (within 24h)
    const rows = [
      makeRow({ status: "completed", startedAt: recentAgo }),
      makeRow({ status: "completed", startedAt: recentAgo }),
      makeRow({ status: "failed",    startedAt: recentAgo }),
      makeRow({ status: "error",     startedAt: recentAgo }),
      makeRow({ status: "timed_out", startedAt: recentAgo }),
      makeRow({ status: "cancelled", startedAt: recentAgo }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.completedExecutions).toBe(2);
    expect(m.failedExecutions).toBe(2);    // failed + error
    expect(m.timedOutExecutions).toBe(1);
    expect(m.cancelledExecutions).toBe(1);
  });

  it("excludes terminal executions older than 24h from recent counts", () => {
    const oldAgo = new Date(NOW.getTime() - 25 * 3_600_000); // 25h ago
    const rows = [
      makeRow({ status: "completed", startedAt: oldAgo }),
      makeRow({ status: "failed",    startedAt: oldAgo }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.completedExecutions).toBe(0);
    expect(m.failedExecutions).toBe(0);
  });

  it("computes averageExecutionDurationMs from completed rows", () => {
    const start1 = new Date(NOW.getTime() - 5 * 60_000);  // 5 min ago
    const start2 = new Date(NOW.getTime() - 15 * 60_000); // 15 min ago
    const rows = [
      makeRow({ status: "completed", startedAt: start1, completedAt: NOW }),
      makeRow({ status: "completed", startedAt: start2, completedAt: NOW }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    // avg of 5min + 15min = 10 min
    expect(m.averageExecutionDurationMs).toBe(10 * 60_000);
  });

  it("capturedAt matches the provided now", () => {
    const m = computeMetricsFromRows([], 10, NOW);
    expect(m.capturedAt.toISOString()).toBe(NOW.toISOString());
    expect(m.workspaceId).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Approval backlog detection
// ─────────────────────────────────────────────────────────────────────────────
describe("T2: Approval backlog detection", () => {
  it("approvalBacklogCount = 0 for recent waiting_approval", () => {
    // Only 1h old - below APPROVAL_BACKLOG_THRESHOLD_HOURS (24h)
    const rows = [makeRow({ status: "waiting_approval", startedAt: new Date(NOW.getTime() - 3_600_000) })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.approvalBacklogCount).toBe(0);
    expect(m.waitingApprovalCount).toBe(1); // still counted as waiting
  });

  it("approvalBacklogCount = 1 for approval waiting > threshold", () => {
    const overdueStart = new Date(NOW.getTime() - (APPROVAL_BACKLOG_THRESHOLD_HOURS + 1) * 3_600_000);
    const rows = [makeRow({ status: "waiting_approval", startedAt: overdueStart })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.approvalBacklogCount).toBe(1);
  });

  it("approvalBacklogCount counts only backlogged ones, not all waiting", () => {
    const recentStart  = new Date(NOW.getTime() - 2 * 3_600_000);
    const overdueStart = new Date(NOW.getTime() - (APPROVAL_BACKLOG_THRESHOLD_HOURS + 2) * 3_600_000);
    const rows = [
      makeRow({ status: "waiting_approval", startedAt: recentStart }),  // NOT backlogged
      makeRow({ status: "waiting_approval", startedAt: overdueStart }), // backlogged
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.waitingApprovalCount).toBe(2);
    expect(m.approvalBacklogCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Delay backlog detection
// ─────────────────────────────────────────────────────────────────────────────
describe("T3: Delay backlog detection", () => {
  it("delayBacklogCount = 0 for delay with future wakeAt", () => {
    const rows = [makeRow({ status: "waiting_delay", wakeAt: new Date(NOW.getTime() + 3_600_000) })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.delayBacklogCount).toBe(0);
    expect(m.waitingDelayCount).toBe(1);
  });

  it("delayBacklogCount = 0 within grace period (wakeAt just passed)", () => {
    // 5 minutes past wakeAt, but grace period is DELAY_OVERDUE_GRACE_MINUTES
    const justPast = new Date(NOW.getTime() - 5 * 60_000);
    const rows = [makeRow({ status: "waiting_delay", wakeAt: justPast })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    // 5 min past, grace period is DELAY_OVERDUE_GRACE_MINUTES - if grace>5, not backlogged
    const expected = 5 * 60_000 > DELAY_OVERDUE_GRACE_MINUTES * 60_000 ? 1 : 0;
    expect(m.delayBacklogCount).toBe(expected);
  });

  it("delayBacklogCount = 1 for delay past wakeAt beyond grace period", () => {
    const overdueWakeAt = new Date(NOW.getTime() - (DELAY_OVERDUE_GRACE_MINUTES + 5) * 60_000);
    const rows = [makeRow({ status: "waiting_delay", wakeAt: overdueWakeAt })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.delayBacklogCount).toBe(1);
  });

  it("waiting_delay with null wakeAt does not count as backlog", () => {
    const rows = [makeRow({ status: "waiting_delay", wakeAt: null })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.delayBacklogCount).toBe(0);
    expect(m.waitingDelayCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Stuck execution detection
// ─────────────────────────────────────────────────────────────────────────────
describe("T4: Stuck execution detection", () => {
  it("running execution within threshold is not stuck", () => {
    const rows = [makeRow({ status: "running", startedAt: new Date(NOW.getTime() - 30 * 60_000) })];
    const stuck = detectStuckFromRows(rows, NOW);
    expect(stuck).toHaveLength(0);
  });

  it("running execution past RUNNING_TOO_LONG_HOURS threshold is stuck", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000);
    const rows = [makeRow({ id: 42, status: "running", startedAt: longAgo })];
    const stuck = detectStuckFromRows(rows, NOW);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.stuckReason).toBe("running_too_long");
    expect(stuck[0]!.executionId).toBe(42);
    expect(stuck[0]!.overdueMs).toBeGreaterThan(0);
  });

  it("waiting_approval past threshold is stuck with approval_overdue reason", () => {
    const overdueStart = new Date(NOW.getTime() - (APPROVAL_BACKLOG_THRESHOLD_HOURS + 1) * 3_600_000);
    const rows = [makeRow({ id: 55, status: "waiting_approval", startedAt: overdueStart })];
    const stuck = detectStuckFromRows(rows, NOW);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.stuckReason).toBe("approval_overdue");
    expect(stuck[0]!.executionId).toBe(55);
  });

  it("waiting_delay past wakeAt beyond grace period is stuck with delay_overdue reason", () => {
    const overdueWakeAt = new Date(NOW.getTime() - (DELAY_OVERDUE_GRACE_MINUTES + 30) * 60_000);
    const rows = [makeRow({ id: 77, status: "waiting_delay", wakeAt: overdueWakeAt })];
    const stuck = detectStuckFromRows(rows, NOW);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.stuckReason).toBe("delay_overdue");
    expect(stuck[0]!.executionId).toBe(77);
  });

  it("detects multiple stuck executions with different reasons in one call", () => {
    const rows = [
      makeRow({ status: "running", startedAt: new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000) }),
      makeRow({ status: "waiting_approval", startedAt: new Date(NOW.getTime() - (APPROVAL_BACKLOG_THRESHOLD_HOURS + 1) * 3_600_000) }),
      makeRow({ status: "waiting_delay", wakeAt: new Date(NOW.getTime() - (DELAY_OVERDUE_GRACE_MINUTES + 30) * 60_000) }),
    ];
    const stuck = detectStuckFromRows(rows, NOW);
    expect(stuck).toHaveLength(3);
    const reasons = stuck.map(s => s.stuckReason);
    expect(reasons).toContain("running_too_long");
    expect(reasons).toContain("approval_overdue");
    expect(reasons).toContain("delay_overdue");
  });

  it("stuckDurationMs and overdueMs are positive for stuck executions", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 2) * 3_600_000);
    const rows = [makeRow({ status: "running", startedAt: longAgo })];
    const stuck = detectStuckFromRows(rows, NOW);
    expect(stuck[0]!.stuckDurationMs).toBeGreaterThan(0);
    expect(stuck[0]!.overdueMs).toBeGreaterThan(0);
    expect(stuck[0]!.overdueMs).toBeLessThan(stuck[0]!.stuckDurationMs);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Automation storm detection
// ─────────────────────────────────────────────────────────────────────────────
describe("T5: Automation storm detection", () => {
  it("below warning threshold → severity=none", () => {
    const rows = Array.from({ length: STORM_THRESHOLD_WARNING - 1 },
      (_, i) => makeRow({ startedAt: new Date(NOW.getTime() - i * 10_000) }));
    const result = detectStormFromRows(rows, STORM_WINDOW_MINUTES, NOW);
    expect(result.severity).toBe("none");
    expect(result.count).toBe(STORM_THRESHOLD_WARNING - 1);
  });

  it("at warning threshold → severity=warning", () => {
    const rows = Array.from({ length: STORM_THRESHOLD_WARNING },
      (_, i) => makeRow({ startedAt: new Date(NOW.getTime() - i * 1_000) }));
    const result = detectStormFromRows(rows, STORM_WINDOW_MINUTES, NOW);
    expect(result.severity).toBe("warning");
  });

  it("at critical threshold → severity=critical", () => {
    const rows = Array.from({ length: STORM_THRESHOLD_CRITICAL },
      (_, i) => makeRow({ startedAt: new Date(NOW.getTime() - i * 100) }));
    const result = detectStormFromRows(rows, STORM_WINDOW_MINUTES, NOW);
    expect(result.severity).toBe("critical");
  });

  it("excludes executions outside the window", () => {
    const windowMs  = STORM_WINDOW_MINUTES * 60_000;
    // 2 rows inside window, 3 rows before window
    const rows = [
      makeRow({ startedAt: new Date(NOW.getTime() - 1_000) }),       // inside
      makeRow({ startedAt: new Date(NOW.getTime() - 60_000) }),      // inside (1min ago)
      makeRow({ startedAt: new Date(NOW.getTime() - (windowMs + 60_000)) }), // outside
      makeRow({ startedAt: new Date(NOW.getTime() - (windowMs + 120_000)) }), // outside
      makeRow({ startedAt: new Date(NOW.getTime() - (windowMs + 180_000)) }), // outside
    ];
    const result = detectStormFromRows(rows, STORM_WINDOW_MINUTES, NOW);
    expect(result.count).toBe(2);
    expect(result.severity).toBe("none"); // 2 < STORM_THRESHOLD_WARNING
  });

  it("windowMinutes is reflected in result", () => {
    const result = detectStormFromRows([], 10, NOW);
    expect(result.windowMinutes).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Severity classification
// ─────────────────────────────────────────────────────────────────────────────
describe("T6: Severity classification", () => {
  it("no alerts → healthy", () => {
    expect(classifyOverallSeverity([])).toBe("healthy");
  });

  it("one warning alert → warning", () => {
    const alerts: GovernanceAlert[] = [
      { code: "GOV-01", severity: "warning", title: "", description: "",
        workspaceId: 10, affectedWorkflowIds: [], affectedExecutionIds: [],
        detectedAt: NOW, recommendedAction: "" },
    ];
    expect(classifyOverallSeverity(alerts)).toBe("warning");
  });

  it("one critical alert → critical", () => {
    const alerts: GovernanceAlert[] = [
      { code: "GOV-03", severity: "critical", title: "", description: "",
        workspaceId: 10, affectedWorkflowIds: [], affectedExecutionIds: [],
        detectedAt: NOW, recommendedAction: "" },
    ];
    expect(classifyOverallSeverity(alerts)).toBe("critical");
  });

  it("more than 3 warning alerts → degraded", () => {
    const alerts: GovernanceAlert[] = Array.from({ length: 4 }, (_, i) => ({
      code: `GOV-0${i}`, severity: "warning" as const, title: "", description: "",
      workspaceId: 10, affectedWorkflowIds: [], affectedExecutionIds: [],
      detectedAt: NOW, recommendedAction: "",
    }));
    expect(classifyOverallSeverity(alerts)).toBe("degraded");
  });

  it("critical outranks degraded and warning", () => {
    const alerts: GovernanceAlert[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        code: `GOV-0${i}`, severity: "warning" as const, title: "", description: "",
        workspaceId: 10, affectedWorkflowIds: [], affectedExecutionIds: [],
        detectedAt: NOW, recommendedAction: "",
      })),
      { code: "GOV-X", severity: "critical" as const, title: "", description: "",
        workspaceId: 10, affectedWorkflowIds: [], affectedExecutionIds: [],
        detectedAt: NOW, recommendedAction: "" },
    ];
    expect(classifyOverallSeverity(alerts)).toBe("critical");
  });

  it("classifyTenantHealth.severity reflects worst dimension", () => {
    // Create a scenario with critical error rate → severity=critical
    const critMetrics = makeMetrics({ workflowErrorRate: CRITICAL_ERROR_RATE_THRESHOLD + 0.1,
                                       failedExecutions: 10, completedExecutions: 8 });
    const alerts      = generateGovernanceAlerts(critMetrics, [], noStorm, 10, NOW);
    const summary     = classifyTenantHealth(critMetrics, alerts, [], noStorm, 10, NOW);
    expect(summary.severity).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Metrics deterministic
// ─────────────────────────────────────────────────────────────────────────────
describe("T7: Metrics remain deterministic across repeated runs", () => {
  it("same rows + same now → identical metrics", () => {
    const rows = [
      makeRow({ status: "running" }),
      makeRow({ status: "waiting_approval", startedAt: new Date(NOW.getTime() - 2 * 3_600_000) }),
      makeRow({ status: "completed" }),
      makeRow({ status: "failed", startedAt: new Date(NOW.getTime() - 1 * 3_600_000) }),
    ];
    const m1 = computeMetricsFromRows(rows, 10, NOW);
    const m2 = computeMetricsFromRows(rows, 10, NOW);
    const m3 = computeMetricsFromRows(rows, 10, NOW);

    expect(m1.activeExecutions).toBe(m2.activeExecutions);
    expect(m2.activeExecutions).toBe(m3.activeExecutions);
    expect(m1.workflowErrorRate).toBe(m2.workflowErrorRate);
    expect(m1.approvalBacklogCount).toBe(m2.approvalBacklogCount);
    expect(m1.delayBacklogCount).toBe(m2.delayBacklogCount);
  });

  it("same rows + same now → identical stuck detection", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000);
    const rows = [makeRow({ status: "running", startedAt: longAgo })];
    const s1   = detectStuckFromRows(rows, NOW);
    const s2   = detectStuckFromRows(rows, NOW);
    expect(s1.length).toBe(s2.length);
    expect(s1[0]!.overdueMs).toBe(s2[0]!.overdueMs);
  });

  it("same rows + same now → identical storm detection", () => {
    const rows = Array.from({ length: STORM_THRESHOLD_WARNING + 5 },
      (_, i) => makeRow({ startedAt: new Date(NOW.getTime() - i * 1_000) }));
    const r1 = detectStormFromRows(rows, STORM_WINDOW_MINUTES, NOW);
    const r2 = detectStormFromRows(rows, STORM_WINDOW_MINUTES, NOW);
    expect(r1.count).toBe(r2.count);
    expect(r1.severity).toBe(r2.severity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Cancelled / timed_out excluded from active counts
// ─────────────────────────────────────────────────────────────────────────────
describe("T8: Cancelled and timed_out excluded from active counts", () => {
  it("cancelled executions are not counted as active", () => {
    const rows = [
      makeRow({ status: "cancelled" }),
      makeRow({ status: "cancelled" }),
      makeRow({ status: "running" }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.activeExecutions).toBe(1); // only the running one
  });

  it("timed_out executions are not counted as active", () => {
    const rows = [
      makeRow({ status: "timed_out" }),
      makeRow({ status: "running" }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.activeExecutions).toBe(1); // only running
  });

  it("cancelled recent executions are counted in cancelledExecutions", () => {
    const recentStart = new Date(NOW.getTime() - 2 * 3_600_000);
    const rows = [makeRow({ status: "cancelled", startedAt: recentStart })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.cancelledExecutions).toBe(1);
    expect(m.activeExecutions).toBe(0);
    expect(m.waitingApprovalCount).toBe(0);
    expect(m.waitingDelayCount).toBe(0);
  });

  it("timed_out recent executions appear in timedOutExecutions, not active", () => {
    const recentStart = new Date(NOW.getTime() - 1 * 3_600_000);
    const rows = [makeRow({ status: "timed_out", startedAt: recentStart })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.timedOutExecutions).toBe(1);
    expect(m.activeExecutions).toBe(0);
  });

  it("total active = running + pending only (not approval/delay/cancelled/timed_out)", () => {
    const rows = [
      makeRow({ status: "pending" }),
      makeRow({ status: "running" }),
      makeRow({ status: "waiting_approval" }),
      makeRow({ status: "waiting_delay", wakeAt: new Date(NOW.getTime() + 3_600_000) }),
      makeRow({ status: "cancelled" }),
      makeRow({ status: "timed_out" }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.activeExecutions).toBe(2);       // pending + running
    expect(m.waitingApprovalCount).toBe(1);
    expect(m.waitingDelayCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - workflowErrorRate calculation
// ─────────────────────────────────────────────────────────────────────────────
describe("T9: workflowErrorRate calculation", () => {
  const recentStart = new Date(NOW.getTime() - 2 * 3_600_000);

  it("0 completed + 0 failed → errorRate = 0 (no division by zero)", () => {
    const m = computeMetricsFromRows([], 10, NOW);
    expect(m.workflowErrorRate).toBe(0);
  });

  it("1 completed + 0 failed → errorRate = 0", () => {
    const rows = [makeRow({ status: "completed", startedAt: recentStart })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.workflowErrorRate).toBe(0);
  });

  it("0 completed + 1 failed → errorRate = 1.0", () => {
    const rows = [makeRow({ status: "failed", startedAt: recentStart })];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.workflowErrorRate).toBe(1);
  });

  it("1 completed + 1 failed → errorRate = 0.5", () => {
    const rows = [
      makeRow({ status: "completed", startedAt: recentStart }),
      makeRow({ status: "failed",    startedAt: recentStart }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.workflowErrorRate).toBe(0.5);
  });

  it("3 completed + 1 failed → errorRate = 0.25", () => {
    const rows = [
      makeRow({ status: "completed", startedAt: recentStart }),
      makeRow({ status: "completed", startedAt: recentStart }),
      makeRow({ status: "completed", startedAt: recentStart }),
      makeRow({ status: "failed",    startedAt: recentStart }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.workflowErrorRate).toBeCloseTo(0.25);
  });

  it("error status counts as failed for error rate", () => {
    const rows = [
      makeRow({ status: "completed", startedAt: recentStart }),
      makeRow({ status: "error",     startedAt: recentStart }),
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.workflowErrorRate).toBe(0.5);
  });

  it("old failures (outside 24h window) do not affect error rate", () => {
    const oldStart = new Date(NOW.getTime() - 25 * 3_600_000);
    const rows = [
      makeRow({ status: "completed", startedAt: recentStart }),
      makeRow({ status: "failed",    startedAt: oldStart }),  // too old
    ];
    const m = computeMetricsFromRows(rows, 10, NOW);
    expect(m.workflowErrorRate).toBe(0); // only 1 completed, 0 failed in window
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Health summaries generated without DB side effects
// ─────────────────────────────────────────────────────────────────────────────
describe("T10: Health summaries generated without DB side effects", () => {
  it("classifyTenantHealth returns a plain object (no DB)", () => {
    const metrics = computeMetricsFromRows([], 10, NOW);
    const alerts  = generateGovernanceAlerts(metrics, [], noStorm, 10, NOW);
    const summary = classifyTenantHealth(metrics, alerts, [], noStorm, 10, NOW);
    expect(typeof summary).toBe("object");
    expect(summary).not.toBeInstanceOf(Promise);
  });

  it("all pure functions return synchronously with no async", () => {
    // If any of these returned a Promise, this test would fail to use
    // the result as a plain object.
    const rows    = [makeRow({ status: "running" })];
    const metrics = computeMetricsFromRows(rows, 10, NOW);
    const stuck   = detectStuckFromRows(rows, NOW);
    const storm   = detectStormFromRows(rows, STORM_WINDOW_MINUTES, NOW);
    const alerts  = generateGovernanceAlerts(metrics, stuck, storm, 10, NOW);
    const summary = classifyTenantHealth(metrics, alerts, stuck, storm, 10, NOW);

    expect(metrics.activeExecutions).toBe(1);
    expect(Array.isArray(stuck)).toBe(true);
    expect(storm.windowMinutes).toBe(STORM_WINDOW_MINUTES);
    expect(Array.isArray(alerts)).toBe(true);
    expect(summary.workspaceId).toBe(10);
  });

  it("empty workspace → healthy, no alerts, no stuck", () => {
    const metrics = computeMetricsFromRows([], 10, NOW);
    const stuck   = detectStuckFromRows([], NOW);
    const storm   = detectStormFromRows([], STORM_WINDOW_MINUTES, NOW);
    const alerts  = generateGovernanceAlerts(metrics, stuck, storm, 10, NOW);
    const summary = classifyTenantHealth(metrics, alerts, stuck, storm, 10, NOW);
    expect(summary.severity).toBe("healthy");
    expect(summary.alerts).toHaveLength(0);
    expect(summary.stuckExecutions).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 - generateGovernanceAlerts emits correct codes
// ─────────────────────────────────────────────────────────────────────────────
describe("T11: generateGovernanceAlerts emits correct alert codes", () => {
  it("approval backlog warning → GOV-01_APPROVAL_BACKLOG at warning severity", () => {
    const metrics = makeMetrics({ approvalBacklogCount: MAX_APPROVAL_BACKLOG_WARNING });
    const alerts  = generateGovernanceAlerts(metrics, [], noStorm, 10, NOW);
    const alert   = alerts.find(a => a.code === "GOV-01_APPROVAL_BACKLOG");
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe("warning");
  });

  it("approval backlog critical → GOV-01_APPROVAL_BACKLOG at critical severity", () => {
    const metrics = makeMetrics({ approvalBacklogCount: MAX_APPROVAL_BACKLOG_CRITICAL });
    const alerts  = generateGovernanceAlerts(metrics, [], noStorm, 10, NOW);
    const alert   = alerts.find(a => a.code === "GOV-01_APPROVAL_BACKLOG");
    expect(alert?.severity).toBe("critical");
  });

  it("delay backlog → GOV-02_DELAY_BACKLOG", () => {
    const metrics = makeMetrics({ delayBacklogCount: DELAY_BACKLOG_WARNING });
    const alerts  = generateGovernanceAlerts(metrics, [], noStorm, 10, NOW);
    expect(alerts.some(a => a.code === "GOV-02_DELAY_BACKLOG")).toBe(true);
  });

  it("high error rate → GOV-03_HIGH_ERROR_RATE", () => {
    const metrics = makeMetrics({ workflowErrorRate: HIGH_ERROR_RATE_THRESHOLD + 0.05 });
    const alerts  = generateGovernanceAlerts(metrics, [], noStorm, 10, NOW);
    expect(alerts.some(a => a.code === "GOV-03_HIGH_ERROR_RATE")).toBe(true);
  });

  it("execution pressure → GOV-04_EXECUTION_PRESSURE", () => {
    const metrics = makeMetrics({ activeExecutions: MAX_ACTIVE_WARNING });
    const alerts  = generateGovernanceAlerts(metrics, [], noStorm, 10, NOW);
    expect(alerts.some(a => a.code === "GOV-04_EXECUTION_PRESSURE")).toBe(true);
  });

  it("stuck executions → GOV-05_STUCK_EXECUTIONS", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000);
    const rows    = [makeRow({ status: "running", startedAt: longAgo })];
    const stuck   = detectStuckFromRows(rows, NOW);
    const metrics = computeMetricsFromRows(rows, 10, NOW);
    const alerts  = generateGovernanceAlerts(metrics, stuck, noStorm, 10, NOW);
    expect(alerts.some(a => a.code === "GOV-05_STUCK_EXECUTIONS")).toBe(true);
  });

  it("automation storm → GOV-06_AUTOMATION_STORM", () => {
    const stormRows = Array.from({ length: STORM_THRESHOLD_WARNING + 1 },
      (_, i) => makeRow({ startedAt: new Date(NOW.getTime() - i * 1_000) }));
    const storm   = detectStormFromRows(stormRows, STORM_WINDOW_MINUTES, NOW);
    const metrics = computeMetricsFromRows([], 10, NOW);
    const alerts  = generateGovernanceAlerts(metrics, [], storm, 10, NOW);
    expect(alerts.some(a => a.code === "GOV-06_AUTOMATION_STORM")).toBe(true);
  });

  it("below all thresholds → no alerts", () => {
    const metrics = computeMetricsFromRows([], 10, NOW);
    const alerts  = generateGovernanceAlerts(metrics, [], noStorm, 10, NOW);
    expect(alerts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 - classifyIndicators per-dimension severity
// ─────────────────────────────────────────────────────────────────────────────
describe("T12: classifyIndicators per-dimension health", () => {
  it("healthy workspace → all indicators healthy", () => {
    const metrics = computeMetricsFromRows([], 10, NOW);
    const ind     = classifyIndicators(metrics, []);
    expect(ind.executionPressure).toBe("healthy");
    expect(ind.errorConcentration).toBe("healthy");
    expect(ind.approvalBacklog).toBe("healthy");
    expect(ind.delayBacklog).toBe("healthy");
    expect(ind.stuckExecutionRisk).toBe("healthy");
  });

  it("1 stuck execution → stuckExecutionRisk=warning", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000);
    const rows    = [makeRow({ status: "running", startedAt: longAgo })];
    const stuck   = detectStuckFromRows(rows, NOW);
    const metrics = computeMetricsFromRows(rows, 10, NOW);
    const ind     = classifyIndicators(metrics, stuck);
    expect(ind.stuckExecutionRisk).toBe("warning");
  });

  it("5+ stuck executions → stuckExecutionRisk=critical", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000);
    const rows    = Array.from({ length: 5 }, () => makeRow({ status: "running", startedAt: longAgo }));
    const stuck   = detectStuckFromRows(rows, NOW);
    const metrics = computeMetricsFromRows(rows, 10, NOW);
    const ind     = classifyIndicators(metrics, stuck);
    expect(ind.stuckExecutionRisk).toBe("critical");
  });

  it("critical error rate → errorConcentration=critical", () => {
    const metrics = makeMetrics({ workflowErrorRate: CRITICAL_ERROR_RATE_THRESHOLD + 0.1 });
    const ind     = classifyIndicators(metrics, []);
    expect(ind.errorConcentration).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T13 - classifyOverallSeverity escalation logic
// ─────────────────────────────────────────────────────────────────────────────
describe("T13: classifyOverallSeverity escalation logic", () => {
  it("empty alerts → healthy", () => {
    expect(classifyOverallSeverity([])).toBe("healthy");
  });

  it("1 warning → warning, not degraded", () => {
    const alerts: GovernanceAlert[] = [
      { code: "X", severity: "warning", title: "", description: "",
        workspaceId: 10, affectedWorkflowIds: [], affectedExecutionIds: [],
        detectedAt: NOW, recommendedAction: "" },
    ];
    expect(classifyOverallSeverity(alerts)).toBe("warning");
  });

  it("4 warnings → degraded", () => {
    const alerts: GovernanceAlert[] = Array.from({ length: 4 }, () => ({
      code: "X", severity: "warning" as const, title: "", description: "",
      workspaceId: 10, affectedWorkflowIds: [], affectedExecutionIds: [],
      detectedAt: NOW, recommendedAction: "",
    }));
    expect(classifyOverallSeverity(alerts)).toBe("degraded");
  });

  it("any critical → critical overrides degraded", () => {
    const alerts: GovernanceAlert[] = [
      ...Array.from({ length: 4 }, () => ({
        code: "X", severity: "warning" as const, title: "", description: "",
        workspaceId: 10, affectedWorkflowIds: [], affectedExecutionIds: [],
        detectedAt: NOW, recommendedAction: "",
      })),
      { code: "Y", severity: "critical" as const, title: "", description: "",
        workspaceId: 10, affectedWorkflowIds: [], affectedExecutionIds: [],
        detectedAt: NOW, recommendedAction: "" },
    ];
    expect(classifyOverallSeverity(alerts)).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T14 - StuckExecutionInfo fields correct
// ─────────────────────────────────────────────────────────────────────────────
describe("T14: StuckExecutionInfo fields are complete and correct", () => {
  it("all required fields are populated for running_too_long", () => {
    const longAgo = new Date(NOW.getTime() - (RUNNING_TOO_LONG_HOURS + 1) * 3_600_000);
    const row     = makeRow({ id: 111, workflowId: 22, workspaceId: 10, status: "running", startedAt: longAgo });
    const stuck   = detectStuckFromRows([row], NOW);
    expect(stuck).toHaveLength(1);
    const s = stuck[0]!;
    expect(s.executionId).toBe(111);
    expect(s.workflowId).toBe(22);
    expect(s.workspaceId).toBe(10);
    expect(s.status).toBe("running");
    expect(s.stuckReason).toBe("running_too_long");
    expect(typeof s.stuckDurationMs).toBe("number");
    expect(typeof s.overdueMs).toBe("number");
    expect(s.overdueMs).toBeGreaterThan(0);
    expect(s.stuckDurationMs).toBeGreaterThan(s.overdueMs);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T15 - Storm threshold boundaries
// ─────────────────────────────────────────────────────────────────────────────
describe("T15: Storm detection threshold boundary conditions", () => {
  function makeStormRows(count: number) {
    return Array.from({ length: count }, (_, i) =>
      makeRow({ startedAt: new Date(NOW.getTime() - i * 1_000) }));
  }

  it("STORM_THRESHOLD_WARNING - 1 → none", () => {
    const r = detectStormFromRows(makeStormRows(STORM_THRESHOLD_WARNING - 1), STORM_WINDOW_MINUTES, NOW);
    expect(r.severity).toBe("none");
  });

  it("STORM_THRESHOLD_WARNING exactly → warning", () => {
    const r = detectStormFromRows(makeStormRows(STORM_THRESHOLD_WARNING), STORM_WINDOW_MINUTES, NOW);
    expect(r.severity).toBe("warning");
  });

  it("STORM_THRESHOLD_CRITICAL - 1 → warning", () => {
    const r = detectStormFromRows(makeStormRows(STORM_THRESHOLD_CRITICAL - 1), STORM_WINDOW_MINUTES, NOW);
    expect(r.severity).toBe("warning");
  });

  it("STORM_THRESHOLD_CRITICAL exactly → critical", () => {
    const r = detectStormFromRows(makeStormRows(STORM_THRESHOLD_CRITICAL), STORM_WINDOW_MINUTES, NOW);
    expect(r.severity).toBe("critical");
  });
});
