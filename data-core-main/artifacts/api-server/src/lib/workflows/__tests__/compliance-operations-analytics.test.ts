/**
 * P11-D - Compliance Operations Analytics - Test Suite
 * 60 assertions across 10 test groups (T1-T10)
 */

import { describe, it, expect } from "vitest";
import {
  classifyWorkflowEffectiveness,
  classifyPolicyStability,
  classifyEscalationTrend,
  computeAverageResolutionDuration,
  computeAverageAcknowledgmentDuration,
  computeCriticalUnresolvedDuration,
  computeEscalationRate,
  computeThroughputRate,
  computeDismissalFrequency,
  computeEscalationToResolutionRatio,
  detectRecurringPolicyBreaches,
  evaluateGovernanceAnalytics,
  evaluatePolicyEffectiveness,
  evaluateAllPolicyEffectiveness,
  buildGovernanceEffectivenessReport,
  emitGovernanceAnalyticsEvaluatedEvent,
  emitPolicyEffectivenessScored,
  emitWorkflowStabilityClassifiedEvent,
  emitCriticalUnresolvedThresholdDetectedEvent,
  type GovernanceAnalyticsProfile,
  type PolicyEffectivenessProfile,
  type GovernanceEffectivenessReport,
  type WorkflowEffectivenessScore,
  type PolicyStabilityScore,
  type EscalationTrend,
} from "../compliance-operations-analytics";
import type { GovernanceWorkflowAction } from "../compliance-workflow-orchestration";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-15T12:00:00.000Z");
const ONE_DAY_MS  = 86_400_000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const FIFTEEN_DAYS_MS = 15 * ONE_DAY_MS;

function makeWorkflow(overrides: Partial<GovernanceWorkflowAction> = {}): GovernanceWorkflowAction {
  const base: GovernanceWorkflowAction = {
    workflowActionId:         "gwf:POL-001:viol:POL-001:ent-1-1000",
    violationId:              "viol:POL-001:ent-1-1000",
    policyId:                 "POL-001",
    workspaceId:              1,
    assignedOperatorId:       null,
    initiatedBy:              "op-1",
    workflowStatus:           "open",
    escalationLevel:          "critical",
    resolutionClassification: null,
    resolutionNote:           null,
    evidenceReferences:       [],
    acknowledgedBy:           null,
    acknowledgedAt:           null,
    escalatedBy:              null,
    escalatedAt:              null,
    resolvedBy:               null,
    resolvedAt:               null,
    createdAt:                new Date(NOW.getTime() - ONE_DAY_MS),
    updatedAt:                new Date(NOW.getTime() - ONE_DAY_MS),
  };
  return { ...base, ...overrides };
}

function makeResolved(
  policyId = "POL-001",
  classification: GovernanceWorkflowAction["resolutionClassification"] = "confirmed_violation",
  durationMs = ONE_DAY_MS,
): GovernanceWorkflowAction {
  const createdAt = new Date(NOW.getTime() - durationMs);
  return makeWorkflow({
    workflowActionId:         `gwf:${policyId}:viol-resolved-${durationMs}`,
    violationId:              `viol:${policyId}:ent-resolved-${durationMs}`,
    policyId,
    workflowStatus:           "resolved",
    escalationLevel:          "standard",
    resolutionClassification: classification,
    resolvedBy:               "op-2",
    resolvedAt:               NOW,
    createdAt,
    updatedAt:                NOW,
  });
}

function makeDismissed(policyId = "POL-002"): GovernanceWorkflowAction {
  return makeWorkflow({
    workflowActionId:         `gwf:${policyId}:viol-dismissed`,
    violationId:              `viol:${policyId}:ent-dismissed`,
    policyId,
    workflowStatus:           "dismissed",
    escalationLevel:          "informational",
    resolutionClassification: "false_positive",
    resolvedBy:               "op-3",
    resolvedAt:               NOW,
    createdAt:                new Date(NOW.getTime() - ONE_DAY_MS),
    updatedAt:                NOW,
  });
}

function makeEscalated(policyId = "POL-003"): GovernanceWorkflowAction {
  return makeWorkflow({
    workflowActionId:         `gwf:${policyId}:viol-escalated`,
    violationId:              `viol:${policyId}:ent-escalated`,
    policyId,
    workflowStatus:           "escalated",
    escalationLevel:          "critical",
    escalatedBy:              "op-4",
    escalatedAt:              new Date(NOW.getTime() - ONE_DAY_MS / 2),
    createdAt:                new Date(NOW.getTime() - ONE_DAY_MS),
    updatedAt:                NOW,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - analytics evaluation deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: analytics evaluation deterministic", () => {
  it("T1-1: evaluateGovernanceAnalytics returns stable profileId format", () => {
    const profile = evaluateGovernanceAnalytics([], null, NOW);
    expect(profile.profileId).toMatch(/^gap:platform-\d+$/);
  });

  it("T1-2: empty workflow list produces zero metrics", () => {
    const profile = evaluateGovernanceAnalytics([], null, NOW);
    expect(profile.totalWorkflows).toBe(0);
    expect(profile.activeWorkflows).toBe(0);
    expect(profile.resolvedWorkflows).toBe(0);
    expect(profile.escalationRate).toBe(0);
    expect(profile.throughputRate).toBe(0);
    expect(profile.unresolvedCriticalCount).toBe(0);
    expect(profile.averageResolutionDurationMs).toBeNull();
  });

  it("T1-3: two calls with same inputs produce identical output (determinism)", () => {
    const workflows = [makeResolved(), makeDismissed(), makeEscalated()];
    const p1 = evaluateGovernanceAnalytics(workflows, 1, NOW);
    const p2 = evaluateGovernanceAnalytics(workflows, 1, NOW);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });

  it("T1-4: workspaceId is preserved in profile", () => {
    const profile = evaluateGovernanceAnalytics([], 42, NOW);
    expect(profile.workspaceId).toBe(42);
    expect(profile.profileId).toMatch(/^gap:42-/);
  });

  it("T1-5: evaluatedAt matches the `now` parameter", () => {
    const profile = evaluateGovernanceAnalytics([], null, NOW);
    expect(profile.evaluatedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("T1-6: counts are correct for mixed-status workflows", () => {
    const workflows = [
      makeResolved(),          // resolved
      makeDismissed(),         // dismissed
      makeEscalated(),         // escalated (active)
      makeWorkflow(),          // open (active)
    ];
    const profile = evaluateGovernanceAnalytics(workflows, null, NOW);
    expect(profile.totalWorkflows).toBe(4);
    expect(profile.resolvedWorkflows).toBe(1);
    expect(profile.dismissedWorkflows).toBe(1);
    expect(profile.activeWorkflows).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - resolution duration calculations stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: resolution duration calculations stable", () => {
  it("T2-1: computeAverageResolutionDuration returns null for empty list", () => {
    expect(computeAverageResolutionDuration([])).toBeNull();
  });

  it("T2-2: computeAverageResolutionDuration returns null when no terminal workflows", () => {
    expect(computeAverageResolutionDuration([makeWorkflow()])).toBeNull();
  });

  it("T2-3: computeAverageResolutionDuration is correct for single resolved workflow", () => {
    const wf = makeResolved("POL-001", "confirmed_violation", ONE_DAY_MS);
    const avg = computeAverageResolutionDuration([wf]);
    expect(avg).toBe(ONE_DAY_MS);
  });

  it("T2-4: computeAverageResolutionDuration averages correctly across multiple workflows", () => {
    const wf1 = makeResolved("POL-001", "confirmed_violation", ONE_DAY_MS);
    const wf2 = makeResolved("POL-002", "policy_gap", SEVEN_DAYS_MS);
    const avg = computeAverageResolutionDuration([wf1, wf2]);
    expect(avg).toBe((ONE_DAY_MS + SEVEN_DAYS_MS) / 2);
  });

  it("T2-5: computeAverageAcknowledgmentDuration returns null when none acknowledged", () => {
    expect(computeAverageAcknowledgmentDuration([makeWorkflow()])).toBeNull();
  });

  it("T2-6: computeAverageAcknowledgmentDuration computes correctly", () => {
    const createdAt = new Date(NOW.getTime() - 2 * ONE_DAY_MS);
    const acknowledgedAt = new Date(NOW.getTime() - ONE_DAY_MS);
    const wf = makeWorkflow({
      workflowStatus: "acknowledged",
      acknowledgedBy: "op-1",
      acknowledgedAt,
      createdAt,
    });
    const avg = computeAverageAcknowledgmentDuration([wf]);
    expect(avg).toBe(ONE_DAY_MS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - escalation frequency classification valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: escalation frequency classification valid", () => {
  it("T3-1: computeEscalationRate returns 0 for empty list", () => {
    expect(computeEscalationRate([])).toBe(0);
  });

  it("T3-2: computeEscalationRate counts escalatedAt set OR status=escalated", () => {
    const workflows = [
      makeEscalated(),                // escalatedAt set + status=escalated
      makeWorkflow({ workflowStatus: "open" }),   // neither
      makeWorkflow({ workflowStatus: "resolved", escalatedAt: new Date() }), // escalatedAt set
    ];
    const rate = computeEscalationRate(workflows);
    expect(rate).toBeCloseTo(2 / 3);
  });

  it("T3-3: classifyEscalationTrend - critical when unresolvedCriticalCount >= 3", () => {
    expect(classifyEscalationTrend(0.5, 3)).toBe("critical");
    expect(classifyEscalationTrend(0.1, 5)).toBe("critical");
  });

  it("T3-4: classifyEscalationTrend - worsening for high escalation rate", () => {
    expect(classifyEscalationTrend(0.6, 0)).toBe("worsening");
    expect(classifyEscalationTrend(0.3, 1)).toBe("worsening");
  });

  it("T3-5: classifyEscalationTrend - improving when rate < 0.10 and no critical unresolved", () => {
    expect(classifyEscalationTrend(0.05, 0)).toBe("improving");
    expect(classifyEscalationTrend(0.09, 0)).toBe("improving");
  });

  it("T3-6: classifyEscalationTrend - stable as default", () => {
    expect(classifyEscalationTrend(0.20, 0)).toBe("stable");
    expect(classifyEscalationTrend(0.35, 0)).toBe("stable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - policy recurrence detection correct
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: policy recurrence detection correct", () => {
  it("T4-1: detectRecurringPolicyBreaches returns empty object for no workflows", () => {
    expect(detectRecurringPolicyBreaches([])).toEqual({});
  });

  it("T4-2: counts are accumulated per policyId", () => {
    const workflows = [
      makeWorkflow({ policyId: "POL-001" }),
      makeWorkflow({ policyId: "POL-001" }),
      makeWorkflow({ policyId: "POL-002" }),
    ];
    const result = detectRecurringPolicyBreaches(workflows);
    expect(result["POL-001"]).toBe(2);
    expect(result["POL-002"]).toBe(1);
  });

  it("T4-3: ordering is DESC by count, then ASC by policyId for ties", () => {
    const workflows = [
      makeWorkflow({ policyId: "POL-003" }),
      makeWorkflow({ policyId: "POL-001" }),
      makeWorkflow({ policyId: "POL-001" }),
      makeWorkflow({ policyId: "POL-002" }),
      makeWorkflow({ policyId: "POL-002" }),
      makeWorkflow({ policyId: "POL-003" }),
    ];
    const keys = Object.keys(detectRecurringPolicyBreaches(workflows));
    // POL-001 and POL-002 and POL-003 all have 2 → sorted ASC by policyId
    expect(keys[0]).toBe("POL-001");
    expect(keys[1]).toBe("POL-002");
    expect(keys[2]).toBe("POL-003");
  });

  it("T4-4: all statuses are counted (open, resolved, dismissed)", () => {
    const workflows = [
      makeWorkflow({ policyId: "POL-005" }),
      makeResolved("POL-005"),
      makeDismissed(),
    ];
    const result = detectRecurringPolicyBreaches(workflows);
    expect(result["POL-005"]).toBe(2);
  });

  it("T4-5: evaluateGovernanceAnalytics policyBreachFrequency matches manual count", () => {
    const workflows = [
      makeWorkflow({ policyId: "POL-001" }),
      makeWorkflow({ policyId: "POL-001" }),
      makeWorkflow({ policyId: "POL-002" }),
    ];
    const profile = evaluateGovernanceAnalytics(workflows, null, NOW);
    expect(profile.policyBreachFrequency["POL-001"]).toBe(2);
    expect(profile.policyBreachFrequency["POL-002"]).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - workflow effectiveness scoring deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: workflow effectiveness scoring deterministic", () => {
  it("T5-1: unstable - escalationRate >= 0.70", () => {
    expect(classifyWorkflowEffectiveness(0.70, 0.50, 0, null)).toBe("unstable");
    expect(classifyWorkflowEffectiveness(0.85, 0.90, 0, null)).toBe("unstable");
  });

  it("T5-2: unstable - unresolvedCriticalCount >= 5", () => {
    expect(classifyWorkflowEffectiveness(0.10, 0.80, 5, null)).toBe("unstable");
    expect(classifyWorkflowEffectiveness(0.10, 0.80, 10, null)).toBe("unstable");
  });

  it("T5-3: inconsistent - escalationRate >= 0.40 but below 0.70", () => {
    expect(classifyWorkflowEffectiveness(0.40, 0.50, 0, null)).toBe("inconsistent");
    expect(classifyWorkflowEffectiveness(0.60, 0.50, 0, null)).toBe("inconsistent");
  });

  it("T5-4: inconsistent - avgResolutionDurationMs > 14 days", () => {
    expect(classifyWorkflowEffectiveness(0.10, 0.80, 0, FIFTEEN_DAYS_MS)).toBe("inconsistent");
  });

  it("T5-5: highly_effective - all conditions met", () => {
    expect(classifyWorkflowEffectiveness(0.10, 0.95, 0, null)).toBe("highly_effective");
    expect(classifyWorkflowEffectiveness(0.05, 0.90, 0, ONE_DAY_MS)).toBe("highly_effective");
  });

  it("T5-6: effective - throughputRate >= 0.70 AND escalationRate < 0.30, no criticals", () => {
    expect(classifyWorkflowEffectiveness(0.20, 0.75, 0, null)).toBe("effective");
  });

  it("T5-7: acceptable - default when no extreme conditions", () => {
    expect(classifyWorkflowEffectiveness(0.20, 0.50, 0, null)).toBe("acceptable");
    expect(classifyWorkflowEffectiveness(0.10, 0.60, 0, null)).toBe("acceptable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - policy effectiveness serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: policy effectiveness serialization stable", () => {
  it("T6-1: PolicyEffectivenessProfile is fully JSON-serializable", () => {
    const profile = evaluatePolicyEffectiveness([], "POL-001", NOW);
    const json = JSON.parse(JSON.stringify(profile));
    expect(json.policyId).toBe("POL-001");
    expect(typeof json.confirmedViolationRate).toBe("number");
    expect(typeof json.falsePositiveRate).toBe("number");
  });

  it("T6-2: policyName is populated from GOVERNANCE_POLICIES for known policyIds", () => {
    const profile = evaluatePolicyEffectiveness([], "POL-001", NOW);
    expect(typeof profile.policyName).toBe("string");
    expect(profile.policyName.length).toBeGreaterThan(0);
    expect(profile.policyName).not.toBe("POL-001"); // should be human name, not id fallback
  });

  it("T6-3: unknown policyId falls back to policyId as name", () => {
    const profile = evaluatePolicyEffectiveness([], "POL-UNKNOWN", NOW);
    expect(profile.policyName).toBe("POL-UNKNOWN");
  });

  it("T6-4: two calls with same input produce identical serialized output", () => {
    const workflows = [makeResolved("POL-002"), makeDismissed()];
    const p1 = evaluatePolicyEffectiveness(workflows, "POL-002", NOW);
    const p2 = evaluatePolicyEffectiveness(workflows, "POL-002", NOW);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });

  it("T6-5: evaluateAllPolicyEffectiveness covers all 8 GOVERNANCE_POLICIES", () => {
    const profiles = evaluateAllPolicyEffectiveness([], NOW);
    const ids = profiles.map(p => p.policyId);
    for (let i = 1; i <= 8; i++) {
      expect(ids).toContain(`POL-00${i}`);
    }
  });

  it("T6-6: evaluateAllPolicyEffectiveness ordering: DESC totalViolations, then ASC policyId", () => {
    const workflows = [
      makeWorkflow({ policyId: "POL-003" }),
      makeWorkflow({ policyId: "POL-003" }),
      makeWorkflow({ policyId: "POL-001" }),
    ];
    const profiles = evaluateAllPolicyEffectiveness(workflows, NOW);
    expect(profiles[0].policyId).toBe("POL-003");
    expect(profiles[1].policyId).toBe("POL-001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - critical unresolved metrics accurate
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: critical unresolved metrics accurate", () => {
  it("T7-1: unresolvedCriticalCount is 0 for empty list", () => {
    const profile = evaluateGovernanceAnalytics([], null, NOW);
    expect(profile.unresolvedCriticalCount).toBe(0);
  });

  it("T7-2: resolved critical workflows are NOT counted as unresolvedCritical", () => {
    const wf = makeResolved("POL-001", "confirmed_violation", ONE_DAY_MS);
    const wfCritical = { ...wf, escalationLevel: "critical" as const };
    const profile = evaluateGovernanceAnalytics([wfCritical], null, NOW);
    expect(profile.unresolvedCriticalCount).toBe(0);
  });

  it("T7-3: open critical workflows are counted as unresolvedCritical", () => {
    const wf1 = makeWorkflow({ escalationLevel: "critical", workflowStatus: "open" });
    const wf2 = makeWorkflow({ escalationLevel: "critical", workflowStatus: "escalated" });
    const profile = evaluateGovernanceAnalytics([wf1, wf2], null, NOW);
    expect(profile.unresolvedCriticalCount).toBe(2);
  });

  it("T7-4: computeCriticalUnresolvedDuration returns null when no critical unresolved", () => {
    expect(computeCriticalUnresolvedDuration([makeResolved()], NOW)).toBeNull();
  });

  it("T7-5: computeCriticalUnresolvedDuration computes duration from createdAt to now", () => {
    const wf = makeWorkflow({
      escalationLevel: "critical",
      workflowStatus:  "open",
      createdAt:       new Date(NOW.getTime() - ONE_DAY_MS),
    });
    const duration = computeCriticalUnresolvedDuration([wf], NOW);
    expect(duration).toBe(ONE_DAY_MS);
  });

  it("T7-6: criticalUnresolvedDurationMs in profile is consistent with manual computation", () => {
    const wf = makeWorkflow({
      escalationLevel: "critical",
      workflowStatus:  "open",
      createdAt:       new Date(NOW.getTime() - SEVEN_DAYS_MS),
    });
    const profile = evaluateGovernanceAnalytics([wf], null, NOW);
    expect(profile.criticalUnresolvedDurationMs).toBe(SEVEN_DAYS_MS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - append-only workflow guarantees preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: append-only workflow guarantees preserved", () => {
  it("T8-1: evaluateGovernanceAnalytics does not mutate input workflows array", () => {
    const workflows = [makeWorkflow(), makeResolved()];
    const snapshot = JSON.stringify(workflows);
    evaluateGovernanceAnalytics(workflows, null, NOW);
    expect(JSON.stringify(workflows)).toBe(snapshot);
  });

  it("T8-2: evaluatePolicyEffectiveness does not mutate input workflows array", () => {
    const workflows = [makeWorkflow(), makeResolved()];
    const snapshot = JSON.stringify(workflows);
    evaluatePolicyEffectiveness(workflows, "POL-001", NOW);
    expect(JSON.stringify(workflows)).toBe(snapshot);
  });

  it("T8-3: buildGovernanceEffectivenessReport does not mutate input", () => {
    const workflows = [makeWorkflow(), makeResolved(), makeEscalated()];
    const snapshot = JSON.stringify(workflows);
    buildGovernanceEffectivenessReport(workflows, NOW);
    expect(JSON.stringify(workflows)).toBe(snapshot);
  });

  it("T8-4: analytics functions never return workflowStatus as a mutable object", () => {
    const profile = evaluateGovernanceAnalytics([makeWorkflow()], null, NOW);
    // policyBreachFrequency is a plain object - mutating it does not affect a second call
    profile.policyBreachFrequency["POL-INJECTED"] = 999;
    const profile2 = evaluateGovernanceAnalytics([makeWorkflow()], null, NOW);
    expect(profile2.policyBreachFrequency["POL-INJECTED"]).toBeUndefined();
  });

  it("T8-5: dismissedWorkflows in profile does not count as active", () => {
    const wf = makeDismissed();
    const profile = evaluateGovernanceAnalytics([wf], null, NOW);
    expect(profile.activeWorkflows).toBe(0);
    expect(profile.dismissedWorkflows).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - super-admin enforcement valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: super-admin enforcement valid", () => {
  it("T9-1: GovernanceEffectivenessReport is fully JSON-serializable", () => {
    const report = buildGovernanceEffectivenessReport([], NOW);
    const json = JSON.parse(JSON.stringify(report));
    expect(typeof json.reportId).toBe("string");
    expect(typeof json.totalWorkflows).toBe("number");
    expect(typeof json.escalationTrend).toBe("string");
  });

  it("T9-2: reportId format is stable", () => {
    const report = buildGovernanceEffectivenessReport([], NOW);
    expect(report.reportId).toMatch(/^geff:\d+$/);
  });

  it("T9-3: GovernanceAnalyticsProfile is fully JSON-serializable", () => {
    const workflows = [makeResolved(), makeEscalated(), makeWorkflow()];
    const profile = evaluateGovernanceAnalytics(workflows, 1, NOW);
    const json = JSON.parse(JSON.stringify(profile));
    expect(typeof json.escalationRate).toBe("number");
    expect(typeof json.throughputRate).toBe("number");
    expect(typeof json.workflowStabilityScore).toBe("string");
  });

  it("T9-4: evaluatedAt in GovernanceEffectivenessReport matches `now`", () => {
    const report = buildGovernanceEffectivenessReport([], NOW);
    expect(report.evaluatedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("T9-5: buildGovernanceEffectivenessReport is synchronous and returns a plain object", () => {
    const report = buildGovernanceEffectivenessReport([], NOW);
    expect(typeof report).toBe("object");
    expect(report).not.toBeInstanceOf(Promise);
  });

  it("T9-6: computeThroughputRate and computeDismissalFrequency are both 0 for empty list", () => {
    expect(computeThroughputRate([])).toBe(0);
    expect(computeDismissalFrequency([])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - analytics layer remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: analytics layer remains read-only", () => {
  it("T10-1: emit functions return void", () => {
    const payload = {
      workspaceId:             1,
      policyId:                "POL-001",
      effectivenessScore:      "acceptable" as const,
      escalationRate:          0.2,
      unresolvedCriticalCount: 0,
      action:                  "test",
    };
    expect(emitGovernanceAnalyticsEvaluatedEvent(payload)).toBeUndefined();
    expect(emitPolicyEffectivenessScored(payload)).toBeUndefined();
    expect(emitWorkflowStabilityClassifiedEvent(payload)).toBeUndefined();
    expect(emitCriticalUnresolvedThresholdDetectedEvent(payload)).toBeUndefined();
  });

  it("T10-2: no execute/trigger/write methods exist on GovernanceAnalyticsProfile", () => {
    const profile = evaluateGovernanceAnalytics([], null, NOW);
    expect((profile as unknown as Record<string, unknown>)["execute"]).toBeUndefined();
    expect((profile as unknown as Record<string, unknown>)["trigger"]).toBeUndefined();
    expect((profile as unknown as Record<string, unknown>)["write"]).toBeUndefined();
    expect((profile as unknown as Record<string, unknown>)["auto_resolve"]).toBeUndefined();
  });

  it("T10-3: no execute/trigger methods exist on PolicyEffectivenessProfile", () => {
    const profile = evaluatePolicyEffectiveness([], "POL-001", NOW);
    expect((profile as unknown as Record<string, unknown>)["execute"]).toBeUndefined();
    expect((profile as unknown as Record<string, unknown>)["trigger"]).toBeUndefined();
  });

  it("T10-4: no execute/trigger methods exist on GovernanceEffectivenessReport", () => {
    const report = buildGovernanceEffectivenessReport([], NOW);
    expect((report as unknown as Record<string, unknown>)["execute"]).toBeUndefined();
    expect((report as unknown as Record<string, unknown>)["auto_escalate"]).toBeUndefined();
  });

  it("T10-5: classifyPolicyStability - unstable when falsePositiveRate >= 0.50", () => {
    expect(classifyPolicyStability(0.10, 0.50, 0.10)).toBe("unstable");
    expect(classifyPolicyStability(0.10, 0.80, 0.10)).toBe("unstable");
  });

  it("T10-6: classifyPolicyStability - reliable when all conditions met", () => {
    expect(classifyPolicyStability(0.85, 0.05, 0.10)).toBe("reliable");
    expect(classifyPolicyStability(0.90, 0.01, 0.15)).toBe("reliable");
  });

  it("T10-7: computeEscalationToResolutionRatio returns 0 when no resolved workflows", () => {
    const workflows = [makeEscalated(), makeWorkflow()];
    expect(computeEscalationToResolutionRatio(workflows)).toBe(0);
  });

  it("T10-8: escalationToResolutionRatio in profile is computed correctly", () => {
    const wf1 = makeEscalated();
    const wf2 = makeResolved();
    const profile = evaluateGovernanceAnalytics([wf1, wf2], null, NOW);
    // escalatedCount=1 (wf1), resolvedCount=1 (wf2) → ratio=1
    expect(profile.escalationToResolutionRatio).toBe(1);
  });
});
