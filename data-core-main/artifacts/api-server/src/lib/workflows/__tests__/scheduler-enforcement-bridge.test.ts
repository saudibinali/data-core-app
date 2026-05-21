/**
 * @file   __tests__/scheduler-enforcement-bridge.test.ts
 * @phase  P9-F - Adaptive Scheduling Research Foundations & Safe Enforcement Bridge
 *
 * T1  - effective weight resolution deterministic
 * T2  - expired policy ignored safely
 * T3  - rollback precedence preserved
 * T4  - multiple active policy conflict rejected
 * T5  - starvation floor preserved
 * T6  - research metrics serialization stable
 * T7  - enforcement mode transitions deterministic
 * T8  - stale policy rejected
 * T9  - observability events scoped correctly
 * T10 - no autonomous adaptation occurs
 */

import { describe, it, expect } from "vitest";
import {
  resolveEffectiveSchedulerWeight,
  buildAdaptiveResearchSnapshot,
  computeResearchMetrics,
  detectPolicyResolutionConflict,
  makeEnforcementBridgeId,
  emitEnforcementBridgeResolvedEvent,
  emitEffectiveWeightAppliedEvent,
  emitPolicyResolutionConflictEvent,
  emitResearchMetricRecordedEvent,
  SCHEDULER_WEIGHT_FLOOR,
  SCHEDULER_WEIGHT_CEILING,
  type SchedulerEnforcementBridge,
  type ResearchMetric,
  type AdaptiveResearchSnapshot,
  type EnforcementResolutionInput,
} from "../scheduler-enforcement-bridge";
import { type SchedulerFairnessPolicy } from "../fairness-policy";
import { type TenantWorkloadPartition } from "../workload-partition";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const NOW       = new Date("2026-05-15T14:00:00.000Z");
const FUTURE    = new Date("2026-05-15T16:00:00.000Z");  // 2h from NOW (policy not yet expired)
const PAST      = new Date("2026-05-15T12:00:00.000Z");  // 2h before NOW (policy expired)

function makeActivePolicy(
  overrides: Partial<SchedulerFairnessPolicy> = {},
): SchedulerFairnessPolicy {
  return {
    policyId:                "fp:7-1715788800000-1",
    workspaceId:             7,
    targetSchedulerWeight:   0.50,
    previousSchedulerWeight: 1.00,
    adjustmentReason:        "Workspace monopolizing executions",
    requestedBy:             "admin:1",
    approvedBy:              "admin:2",
    approvedAt:              "2026-05-15T13:00:00.000Z",
    expiresAt:               FUTURE.toISOString(),   // NOT expired at NOW
    rollbackEligible:        true,
    policyStatus:            "active",
    createdAt:               "2026-05-15T12:00:00.000Z",
    ...overrides,
  };
}

function makeExpiredPolicy(
  overrides: Partial<SchedulerFairnessPolicy> = {},
): SchedulerFairnessPolicy {
  return makeActivePolicy({
    expiresAt: PAST.toISOString(),  // expired at NOW
    ...overrides,
  });
}

function makeInput(
  overrides: Partial<EnforcementResolutionInput> = {},
): EnforcementResolutionInput {
  return {
    policies:       [],
    workspaceId:    7,
    advisoryWeight: 1.00,
    resolutionTime: NOW,
    ...overrides,
  };
}

function makePartition(overrides: Partial<TenantWorkloadPartition> = {}): TenantWorkloadPartition {
  return {
    partitionId:           "p:7-1",
    workspaceId:           7,
    activeExecutionCount:  2,
    delayedExecutionCount: 1,
    pressureScore:         { total: 15, activeExecutionScore: 10, delayedBacklogScore: 5, hotspotDensityScore: 0, complexityScore: 0, advisoryScore: 0 },
    executionPressureLevel:"normal",
    containmentStatus:     "contained",
    advisoryPressureLevel: "none",
    schedulerWeight:       1.00,
    noisyBehaviorDetected: false,
    noisyBehaviorCodes:    [],
    noisyBehaviorReasons:  [],
    evaluatedAt:           NOW.toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - effective weight resolution deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: effective weight resolution deterministic", () => {
  it("no policies → effectiveWeight = advisoryWeight", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ advisoryWeight: 0.75 }));
    expect(bridge.effectiveSchedulerWeight).toBe(0.75);
  });

  it("active non-expired policy → effectiveWeight = policy.targetSchedulerWeight", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeActivePolicy({ targetSchedulerWeight: 0.50 })], advisoryWeight: 1.00 }),
    );
    expect(bridge.effectiveSchedulerWeight).toBe(0.50);
  });

  it("same input → same bridge output (deterministic)", () => {
    const input = makeInput({ policies: [makeActivePolicy()], advisoryWeight: 1.00 });
    const r1 = resolveEffectiveSchedulerWeight({ ...input, resolutionTime: NOW });
    const r2 = resolveEffectiveSchedulerWeight({ ...input, resolutionTime: NOW });
    expect(r1.bridge.effectiveSchedulerWeight).toBe(r2.bridge.effectiveSchedulerWeight);
    expect(r1.bridge.enforcementStatus).toBe(r2.bridge.enforcementStatus);
  });

  it("bridge.sourcePolicyId = policy.policyId when resolved", () => {
    const policy = makeActivePolicy({ policyId: "fp:7-test-1" });
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [policy] }));
    expect(bridge.sourcePolicyId).toBe("fp:7-test-1");
  });

  it("bridge.appliedAt is a valid ISO string", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ resolutionTime: NOW }));
    expect(new Date(bridge.appliedAt).toISOString()).toBe(NOW.toISOString());
  });

  it("advisory weight is preserved in advisorySchedulerWeight even when policy overrides it", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeActivePolicy({ targetSchedulerWeight: 0.25 })], advisoryWeight: 1.00 }),
    );
    expect(bridge.advisorySchedulerWeight).toBe(1.00);
    expect(bridge.effectiveSchedulerWeight).toBe(0.25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - expired policy ignored safely
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: expired policy ignored safely", () => {
  it("active policy with past expiresAt → status=stale, effectiveWeight=advisoryWeight", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeExpiredPolicy()], advisoryWeight: 1.00 }),
    );
    expect(bridge.enforcementStatus).toBe("stale");
    expect(bridge.effectiveSchedulerWeight).toBe(1.00);
  });

  it("stale policy → sourcePolicyId is null", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeExpiredPolicy()], advisoryWeight: 0.75 }),
    );
    expect(bridge.sourcePolicyId).toBeNull();
  });

  it("multiple stale policies → still status=stale, effectiveWeight=advisory", () => {
    const stale1 = makeExpiredPolicy({ policyId: "fp:7-1", targetSchedulerWeight: 0.25 });
    const stale2 = makeExpiredPolicy({ policyId: "fp:7-2", targetSchedulerWeight: 0.50 });
    const { bridge, stalePoliciesFound } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [stale1, stale2], advisoryWeight: 1.00 }),
    );
    expect(bridge.enforcementStatus).toBe("stale");
    expect(stalePoliciesFound).toBe(2);
    expect(bridge.effectiveSchedulerWeight).toBe(1.00);
  });

  it("stale policy → resolutionNotes mentions expiry", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeExpiredPolicy()], advisoryWeight: 1.00 }),
    );
    const notes = bridge.resolutionNotes.join(" ").toLowerCase();
    expect(notes.includes("stale") || notes.includes("expir")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - rollback precedence preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: rollback precedence preserved", () => {
  it("rolled_back policy is not 'active' → not picked up by resolver", () => {
    const rolledBack: SchedulerFairnessPolicy = {
      ...makeActivePolicy(),
      policyStatus: "rolled_back",
    };
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [rolledBack], advisoryWeight: 0.75 }),
    );
    expect(bridge.enforcementStatus).toBe("no_active_policy");
    expect(bridge.effectiveSchedulerWeight).toBe(0.75);
  });

  it("pending policy → not picked up (resolver only handles 'active' status)", () => {
    const pending: SchedulerFairnessPolicy = {
      ...makeActivePolicy(),
      policyStatus: "pending",
      approvedBy:   null,
      approvedAt:   null,
    };
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [pending], advisoryWeight: 1.00 }),
    );
    expect(bridge.enforcementStatus).toBe("no_active_policy");
  });

  it("rollbackReference = policy.previousSchedulerWeight when resolved from active policy", () => {
    const policy = makeActivePolicy({ previousSchedulerWeight: 0.75 });
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [policy] }));
    expect(bridge.rollbackReference).toBe("0.75");
  });

  it("rollbackReference = null when no active policy", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [] }));
    expect(bridge.rollbackReference).toBeNull();
  });

  it("rollbackReference = null when policy is stale", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeExpiredPolicy()] }),
    );
    expect(bridge.rollbackReference).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - multiple active policy conflict rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: multiple active policy conflict rejected", () => {
  it("two non-expired active policies for same workspace → status=conflict", () => {
    const p1 = makeActivePolicy({ policyId: "fp:7-1", targetSchedulerWeight: 0.25 });
    const p2 = makeActivePolicy({ policyId: "fp:7-2", targetSchedulerWeight: 0.50 });
    const { bridge, conflictDetected } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [p1, p2] }),
    );
    expect(bridge.enforcementStatus).toBe("conflict");
    expect(conflictDetected).toBe(true);
  });

  it("conflict → effectiveWeight = SCHEDULER_WEIGHT_FLOOR (fail-closed)", () => {
    const p1 = makeActivePolicy({ policyId: "fp:7-1" });
    const p2 = makeActivePolicy({ policyId: "fp:7-2" });
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [p1, p2] }));
    expect(bridge.effectiveSchedulerWeight).toBe(SCHEDULER_WEIGHT_FLOOR);
  });

  it("conflict → enforcementMode = advisory_only (fail-closed)", () => {
    const p1 = makeActivePolicy({ policyId: "fp:7-1" });
    const p2 = makeActivePolicy({ policyId: "fp:7-2" });
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [p1, p2] }));
    expect(bridge.enforcementMode).toBe("advisory_only");
  });

  it("detectPolicyResolutionConflict returns conflict for 2+ live active policies", () => {
    const p1 = makeActivePolicy({ policyId: "fp:7-1" });
    const p2 = makeActivePolicy({ policyId: "fp:7-2" });
    const conflict = detectPolicyResolutionConflict([p1, p2], 7, NOW);
    expect(conflict).not.toBeNull();
    expect(conflict!.conflictingPolicyIds).toHaveLength(2);
  });

  it("detectPolicyResolutionConflict returns null for single live policy", () => {
    const conflict = detectPolicyResolutionConflict([makeActivePolicy()], 7, NOW);
    expect(conflict).toBeNull();
  });

  it("conflict → conflictCount=1 in AdaptiveResearchSnapshot", () => {
    const p1 = makeActivePolicy({ policyId: "fp:7-1" });
    const p2 = makeActivePolicy({ policyId: "fp:7-2" });
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [p1, p2] }));
    const snapshot = buildAdaptiveResearchSnapshot(
      [bridge],
      [makePartition()],
      { 7: "Test WS" },
      "scope-1",
      NOW,
    );
    expect(snapshot.conflictCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - starvation floor preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: starvation floor preserved", () => {
  it("SCHEDULER_WEIGHT_FLOOR constant is 0.25", () => {
    expect(SCHEDULER_WEIGHT_FLOOR).toBe(0.25);
  });

  it("active policy targeting 0.25 (floor) → effectiveWeight = 0.25", () => {
    const policy = makeActivePolicy({ targetSchedulerWeight: 0.25 });
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [policy] }));
    expect(bridge.effectiveSchedulerWeight).toBe(0.25);
    expect(bridge.enforcementStatus).toBe("resolved");
  });

  it("resolveEffectiveSchedulerWeight never returns effectiveWeight < 0.25", () => {
    // Simulate an edge case where advisory weight is somehow below floor
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [], advisoryWeight: 0.10 }),
    );
    expect(bridge.effectiveSchedulerWeight).toBeGreaterThanOrEqual(SCHEDULER_WEIGHT_FLOOR);
  });

  it("conflict path also respects starvation floor (returns exactly floor)", () => {
    const p1 = makeActivePolicy({ policyId: "fp:7-1" });
    const p2 = makeActivePolicy({ policyId: "fp:7-2" });
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [p1, p2] }));
    expect(bridge.effectiveSchedulerWeight).toBe(SCHEDULER_WEIGHT_FLOOR);
    expect(bridge.effectiveSchedulerWeight).toBeGreaterThanOrEqual(SCHEDULER_WEIGHT_FLOOR);
  });

  it("floor_applied status when policy target is below floor (defensive path)", () => {
    // This is a defensive case - P9-E should prevent it, but bridge must handle it
    const lowPolicy = makeActivePolicy({ targetSchedulerWeight: 0.10 });
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [lowPolicy] }));
    expect(bridge.effectiveSchedulerWeight).toBe(SCHEDULER_WEIGHT_FLOOR);
    expect(bridge.enforcementStatus).toBe("floor_applied");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - research metrics serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: research metrics serialization stable", () => {
  it("ResearchMetric is fully JSON-serializable", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput());
    const metric = computeResearchMetrics(bridge, makePartition(), "Test WS", NOW);
    expect(() => JSON.stringify(metric)).not.toThrow();
  });

  it("AdaptiveResearchSnapshot is fully JSON-serializable", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput());
    const snapshot = buildAdaptiveResearchSnapshot([bridge], [makePartition()], { 7: "WS" }, "scope-1", NOW);
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it("JSON round-trip preserves all ResearchMetric fields", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [makeActivePolicy()] }));
    const metric  = computeResearchMetrics(bridge, makePartition(), "WS-Name", NOW);
    const parsed  = JSON.parse(JSON.stringify(metric)) as ResearchMetric;
    expect(parsed.workspaceId).toBe(metric.workspaceId);
    expect(parsed.effectiveWeight).toBe(metric.effectiveWeight);
    expect(parsed.enforcementMode).toBe(metric.enforcementMode);
    expect(parsed.weightDelta).toBe(metric.weightDelta);
    expect(parsed.containmentStatus).toBe(metric.containmentStatus);
  });

  it("weightDelta = effectiveWeight - advisoryWeight", () => {
    const policy  = makeActivePolicy({ targetSchedulerWeight: 0.50 });
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [policy], advisoryWeight: 1.00 }),
    );
    const metric = computeResearchMetrics(bridge, makePartition(), "WS", NOW);
    expect(metric.weightDelta).toBeCloseTo(0.50 - 1.00, 4);
    expect(metric.weightDelta).toBeLessThan(0);
  });

  it("no undefined values in serialized ResearchMetric", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput());
    const metric = computeResearchMetrics(bridge, makePartition(), "WS", NOW);
    expect(JSON.stringify(metric)).not.toContain('"undefined"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - enforcement mode transitions deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: enforcement mode transitions deterministic", () => {
  it("no active policy → enforcementMode = 'advisory_only'", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput({ policies: [] }));
    expect(bridge.enforcementMode).toBe("advisory_only");
  });

  it("active non-expired policy → enforcementMode = 'operator_confirmed'", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeActivePolicy()] }),
    );
    expect(bridge.enforcementMode).toBe("operator_confirmed");
  });

  it("requestedMode = research_shadow + active policy → enforcementMode = 'research_shadow'", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeActivePolicy()], requestedMode: "research_shadow" }),
    );
    expect(bridge.enforcementMode).toBe("research_shadow");
  });

  it("research_shadow → effectiveWeight = advisoryWeight (not policy target)", () => {
    const policy = makeActivePolicy({ targetSchedulerWeight: 0.25 });
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [policy], advisoryWeight: 1.00, requestedMode: "research_shadow" }),
    );
    expect(bridge.effectiveSchedulerWeight).toBe(1.00);
    expect(bridge.advisorySchedulerWeight).toBe(1.00);
  });

  it("conflict → enforcementMode = 'advisory_only' regardless of requestedMode", () => {
    const p1 = makeActivePolicy({ policyId: "fp:7-1" });
    const p2 = makeActivePolicy({ policyId: "fp:7-2" });
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [p1, p2], requestedMode: "operator_confirmed" }),
    );
    expect(bridge.enforcementMode).toBe("advisory_only");
  });

  it("stale → enforcementMode = 'advisory_only'", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeExpiredPolicy()] }),
    );
    expect(bridge.enforcementMode).toBe("advisory_only");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - stale policy rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: stale policy rejected", () => {
  it("active policy with past expiresAt → enforcementStatus = 'stale'", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeExpiredPolicy()] }),
    );
    expect(bridge.enforcementStatus).toBe("stale");
  });

  it("stale policy does not affect effectiveWeight", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [makeExpiredPolicy({ targetSchedulerWeight: 0.25 })], advisoryWeight: 1.00 }),
    );
    expect(bridge.effectiveSchedulerWeight).toBe(1.00);
  });

  it("stale + live policy for same workspace → live policy wins (status=resolved)", () => {
    const stale = makeExpiredPolicy({ policyId: "fp:7-stale" });
    const live  = makeActivePolicy({ policyId: "fp:7-live", targetSchedulerWeight: 0.50 });
    const { bridge, stalePoliciesFound } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [stale, live], advisoryWeight: 1.00 }),
    );
    expect(bridge.enforcementStatus).toBe("resolved");
    expect(bridge.effectiveSchedulerWeight).toBe(0.50);
    expect(stalePoliciesFound).toBe(1);
  });

  it("multiple stale policies → status = 'stale', NOT 'conflict'", () => {
    const s1 = makeExpiredPolicy({ policyId: "fp:7-s1" });
    const s2 = makeExpiredPolicy({ policyId: "fp:7-s2" });
    const { bridge, conflictDetected } = resolveEffectiveSchedulerWeight(
      makeInput({ policies: [s1, s2] }),
    );
    expect(bridge.enforcementStatus).toBe("stale");
    expect(conflictDetected).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - observability events scoped correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: observability events scoped correctly", () => {
  const dummyPayload = {
    workspaceId:              7,
    sourcePolicyId:           "fp:7-test",
    effectiveSchedulerWeight: 0.50,
    enforcementMode:          "operator_confirmed" as const,
    enforcementStatus:        "resolved" as const,
    action:                   "test",
  };

  it("emitEnforcementBridgeResolvedEvent does not throw", () => {
    expect(() => emitEnforcementBridgeResolvedEvent(dummyPayload)).not.toThrow();
  });

  it("emitEffectiveWeightAppliedEvent does not throw", () => {
    expect(() => emitEffectiveWeightAppliedEvent(dummyPayload)).not.toThrow();
  });

  it("emitPolicyResolutionConflictEvent does not throw", () => {
    expect(() => emitPolicyResolutionConflictEvent({
      ...dummyPayload,
      sourcePolicyId:    null,
      enforcementStatus: "conflict" as const,
      action:            "conflict_detected",
    })).not.toThrow();
  });

  it("emitResearchMetricRecordedEvent does not throw", () => {
    expect(() => emitResearchMetricRecordedEvent(dummyPayload)).not.toThrow();
  });

  it("makeEnforcementBridgeId returns 'eb:'-prefixed unique IDs", () => {
    const id1 = makeEnforcementBridgeId();
    const id2 = makeEnforcementBridgeId();
    expect(id1.startsWith("eb:")).toBe(true);
    expect(id1).not.toBe(id2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - no autonomous adaptation occurs
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: no autonomous adaptation occurs", () => {
  it("resolveEffectiveSchedulerWeight has no async behavior", () => {
    const result = resolveEffectiveSchedulerWeight(makeInput());
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("computeResearchMetrics has no async behavior", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput());
    const metric = computeResearchMetrics(bridge, makePartition(), "WS", NOW);
    expect(typeof (metric as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("buildAdaptiveResearchSnapshot is pure - does not mutate input bridges", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput());
    const bridges    = [bridge];
    const snapshot   = JSON.stringify(bridges);
    buildAdaptiveResearchSnapshot(bridges, [makePartition()], {}, "scope-1", NOW);
    expect(JSON.stringify(bridges)).toBe(snapshot);
  });

  it("resolveEffectiveSchedulerWeight does not mutate input policies array", () => {
    const policies = [makeActivePolicy()];
    const snapshot = JSON.stringify(policies);
    resolveEffectiveSchedulerWeight(makeInput({ policies }));
    expect(JSON.stringify(policies)).toBe(snapshot);
  });

  it("AdaptiveResearchSnapshot has no function properties", () => {
    const { bridge } = resolveEffectiveSchedulerWeight(makeInput());
    const snp = buildAdaptiveResearchSnapshot([bridge], [makePartition()], {}, "s", NOW);
    const hasFn = Object.values(snp).some(v => typeof v === "function");
    expect(hasFn).toBe(false);
  });

  it("AdaptiveResearchSnapshot weight delta distribution sums to total workspaces", () => {
    const b1 = resolveEffectiveSchedulerWeight(makeInput({ policies: [makeActivePolicy({ targetSchedulerWeight: 0.50 })], advisoryWeight: 1.00 })).bridge;
    const b2 = resolveEffectiveSchedulerWeight(makeInput({ policies: [], advisoryWeight: 0.75, workspaceId: 8 })).bridge;
    const snp = buildAdaptiveResearchSnapshot([b1, b2], [makePartition(), makePartition({ workspaceId: 8 })], {}, "s", NOW);
    const { reduced, unchanged, increased } = snp.weightDeltaDistribution;
    expect(reduced + unchanged + increased).toBe(snp.totalWorkspaces);
  });
});
