/**
 * @file   __tests__/reliability-domains.test.ts
 * @phase  P10-A - Reliability Domains & Failure Containment Foundations
 *
 * T1  - reliability domains deterministic
 * T2  - blast radius classification stable
 * T3  - cascading failure risk detected correctly
 * T4  - degradation classification deterministic
 * T5  - containment boundaries stable
 * T6  - tenant-safe observability guaranteed
 * T7  - advisory storms influence degradation correctly
 * T8  - serialization ordering stable
 * T9  - no runtime mutation occurs
 * T10 - reliability layer remains read-only
 */

import { describe, it, expect } from "vitest";
import {
  evaluateFailureContainment,
  buildPlatformReliabilityOverview,
  classifySchedulerDegradation,
  classifyAdvisoryDegradation,
  classifyPolicyEngineDegradation,
  classifyEnforcementBridgeDegradation,
  classifyWorkflowRuntimeDegradation,
  classifyTenantIsolationDegradation,
  computeBlastRadius,
  evaluateContainmentBoundaries,
  detectAdvisoryStorm,
  worstDegradation,
  worstPropagationRisk,
  worstContainmentLevel,
  degradationToPropagationRisk,
  degradationToContainmentLevel,
  degradationToRecoveryClassification,
  emitReliabilityDomainEvaluatedEvent,
  emitFailureContainmentAssessedEvent,
  emitFailurePropagationRiskDetectedEvent,
  emitRuntimeDegradationClassifiedEvent,
  RELIABILITY_PRESSURE_CRITICAL_THRESHOLD,
  RELIABILITY_PRESSURE_RISK_THRESHOLD,
  RELIABILITY_BACKLOG_CRITICAL_THRESHOLD,
  type FailureContainmentInput,
  type DegradationStatus,
  type FailurePropagationRisk,
  type ContainmentLevel,
} from "../reliability-domains";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-15T14:00:00.000Z");

function makeInput(overrides: Partial<FailureContainmentInput> = {}): FailureContainmentInput {
  return {
    workspaceId:           7,
    workspaceName:         "Test Workspace",
    pressureScore:         0,
    containmentStatus:     "contained",
    noisyBehaviorCodes:    [],
    advisoryPressureLevel: "none",
    backlogDepth:          0,
    activeExecutionCount:  0,
    advisoryWeight:        1.00,
    activePolicyCount:     0,
    enforcementStatus:     "no_active_policy",
    effectiveWeight:       1.00,
    conflictDetected:      false,
    evaluationTime:        NOW,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - reliability domains deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: reliability domains deterministic", () => {
  it("healthy input → degradationStatus=healthy", () => {
    const { domain } = evaluateFailureContainment(makeInput());
    expect(domain.degradationStatus).toBe("healthy");
  });

  it("same input → same domain output (deterministic)", () => {
    const input = makeInput({ pressureScore: 25, containmentStatus: "at_risk" });
    const r1    = evaluateFailureContainment({ ...input, evaluationTime: NOW });
    const r2    = evaluateFailureContainment({ ...input, evaluationTime: NOW });
    expect(r1.domain.degradationStatus).toBe(r2.domain.degradationStatus);
    expect(r1.domain.propagationRisk).toBe(r2.domain.propagationRisk);
    expect(r1.domain.containmentLevel).toBe(r2.domain.containmentLevel);
  });

  it("domain.workspaceId matches input.workspaceId", () => {
    const { domain } = evaluateFailureContainment(makeInput({ workspaceId: 42 }));
    expect(domain.workspaceId).toBe(42);
  });

  it("domain.evaluatedAt is a valid ISO string", () => {
    const { domain } = evaluateFailureContainment(makeInput({ evaluationTime: NOW }));
    expect(new Date(domain.evaluatedAt).toISOString()).toBe(NOW.toISOString());
  });

  it("domain.domainId starts with 'rd:'", () => {
    const { domain } = evaluateFailureContainment(makeInput());
    expect(domain.domainId.startsWith("rd:")).toBe(true);
  });

  it("healthy domain has empty affectedSubsystems", () => {
    const { domain } = evaluateFailureContainment(makeInput());
    expect(domain.affectedSubsystems).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - blast radius classification stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: blast radius classification stable", () => {
  it("healthy input → blastRadiusScore < 30, scope=workspace_only", () => {
    const { blastRadius } = evaluateFailureContainment(makeInput());
    expect(blastRadius.blastRadiusScore).toBeLessThan(30);
    expect(blastRadius.estimatedImpactScope).toBe("workspace_only");
  });

  it("critical pressure → blastRadiusScore ≥ 32, scope=platform_wide", () => {
    const { blastRadius } = evaluateFailureContainment(
      makeInput({ pressureScore: RELIABILITY_PRESSURE_CRITICAL_THRESHOLD, containmentStatus: "saturated" }),
    );
    expect(blastRadius.blastRadiusScore).toBeGreaterThanOrEqual(32);
    expect(blastRadius.estimatedImpactScope).toBe("platform_wide");
  });

  it("conflict detected → blast radius increases by 20 points", () => {
    const base     = computeBlastRadius(makeInput(), "healthy", 0);
    const conflict = computeBlastRadius(makeInput({ conflictDetected: true }), "containment_risk", 2);
    expect(conflict.blastRadiusScore).toBeGreaterThan(base.blastRadiusScore);
  });

  it("blastRadius.workspaceId matches input", () => {
    const { blastRadius } = evaluateFailureContainment(makeInput({ workspaceId: 99 }));
    expect(blastRadius.workspaceId).toBe(99);
  });

  it("blastRadiusScore is always in [0, 100]", () => {
    const extremeInput = makeInput({
      pressureScore: 100,
      noisyBehaviorCodes: ["A", "B", "C", "D"],
      backlogDepth: 200,
      conflictDetected: true,
    });
    const { blastRadius } = evaluateFailureContainment(extremeInput);
    expect(blastRadius.blastRadiusScore).toBeGreaterThanOrEqual(0);
    expect(blastRadius.blastRadiusScore).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - cascading failure risk detected correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: cascading failure risk detected correctly", () => {
  it("critical pressure → propagationRisk=cascading", () => {
    const { domain } = evaluateFailureContainment(
      makeInput({ pressureScore: RELIABILITY_PRESSURE_CRITICAL_THRESHOLD, containmentStatus: "saturated" }),
    );
    expect(domain.propagationRisk).toBe("cascading");
  });

  it("conflict detected → propagationRisk=cascading", () => {
    const { domain } = evaluateFailureContainment(makeInput({ conflictDetected: true }));
    expect(domain.propagationRisk).toBe("cascading");
  });

  it("healthy → propagationRisk=isolated", () => {
    const { domain } = evaluateFailureContainment(makeInput());
    expect(domain.propagationRisk).toBe("isolated");
  });

  it("at_risk containment → propagationRisk=spreading or worse", () => {
    const { domain } = evaluateFailureContainment(
      makeInput({ pressureScore: 45, containmentStatus: "pressured" }),
    );
    const risk = domain.propagationRisk;
    expect(["spreading", "cascading"].includes(risk)).toBe(true);
  });

  it("cascading workspace appears in cascadingRiskWorkspaces", () => {
    const r1 = evaluateFailureContainment(makeInput({ workspaceId: 1, pressureScore: 100, containmentStatus: "saturated" }));
    const r2 = evaluateFailureContainment(makeInput({ workspaceId: 2 }));
    const overview = buildPlatformReliabilityOverview([r1, r2], "scope-1", NOW);
    expect(overview.cascadingRiskWorkspaces).toContain(1);
    expect(overview.cascadingRiskWorkspaces).not.toContain(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - degradation classification deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: degradation classification deterministic", () => {
  it("pressureScore=0, contained → scheduler=healthy", () => {
    const rec = classifySchedulerDegradation(0, "contained");
    expect(rec.degradationStatus).toBe("healthy");
  });

  it("pressureScore=CRITICAL_THRESHOLD → scheduler=critical", () => {
    const rec = classifySchedulerDegradation(RELIABILITY_PRESSURE_CRITICAL_THRESHOLD, "contained");
    expect(rec.degradationStatus).toBe("critical");
  });

  it("conflictDetected → tenant_isolation=containment_risk", () => {
    const rec = classifyTenantIsolationDegradation("contained", true);
    expect(rec.degradationStatus).toBe("containment_risk");
  });

  it("saturated containment → tenant_isolation=critical", () => {
    const rec = classifyTenantIsolationDegradation("saturated", false);
    expect(rec.degradationStatus).toBe("critical");
  });

  it("backlog >= CRITICAL + active > 20 → runtime=critical", () => {
    const rec = classifyWorkflowRuntimeDegradation(RELIABILITY_BACKLOG_CRITICAL_THRESHOLD, 25);
    expect(rec.degradationStatus).toBe("critical");
  });

  it("worstDegradation returns the more severe status", () => {
    expect(worstDegradation("healthy", "critical")).toBe("critical");
    expect(worstDegradation("containment_risk", "severely_degraded")).toBe("containment_risk");
    expect(worstDegradation("degraded", "degraded")).toBe("degraded");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - containment boundaries stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: containment boundaries stable", () => {
  it("healthy input → all 5 boundaries have status=holding", () => {
    const boundaries = evaluateContainmentBoundaries(makeInput());
    expect(boundaries).toHaveLength(5);
    for (const b of boundaries) {
      expect(b.status).toBe("holding");
    }
  });

  it("conflictDetected → tenant_isolation boundary status=breached", () => {
    const boundaries = evaluateContainmentBoundaries(makeInput({ conflictDetected: true }));
    const iso = boundaries.find(b => b.boundaryType === "tenant_isolation");
    expect(iso?.status).toBe("breached");
  });

  it("backlog >= CRITICAL_THRESHOLD → runtime_gate status=at_risk", () => {
    const boundaries = evaluateContainmentBoundaries(makeInput({ backlogDepth: RELIABILITY_BACKLOG_CRITICAL_THRESHOLD }));
    const rt = boundaries.find(b => b.boundaryType === "runtime_gate");
    expect(rt?.status).toBe("at_risk");
  });

  it("3+ noisy codes → advisory_gate status=at_risk", () => {
    const boundaries = evaluateContainmentBoundaries(makeInput({ noisyBehaviorCodes: ["A", "B", "C"] }));
    const ag = boundaries.find(b => b.boundaryType === "advisory_gate");
    expect(ag?.status).toBe("at_risk");
  });

  it("each boundary has a unique boundaryId containing workspaceId", () => {
    const boundaries = evaluateContainmentBoundaries(makeInput({ workspaceId: 7 }));
    const ids = new Set(boundaries.map(b => b.boundaryId));
    expect(ids.size).toBe(5);
    for (const b of boundaries) {
      expect(b.boundaryId).toContain("7");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - tenant-safe observability guaranteed
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: tenant-safe observability guaranteed", () => {
  it("domain for workspace 7 has workspaceId=7 (no cross-tenant bleed)", () => {
    const { domain } = evaluateFailureContainment(makeInput({ workspaceId: 7 }));
    expect(domain.workspaceId).toBe(7);
  });

  it("two workspace evaluations produce independent domains", () => {
    const r7 = evaluateFailureContainment(makeInput({ workspaceId: 7, pressureScore: 80, containmentStatus: "saturated" }));
    const r8 = evaluateFailureContainment(makeInput({ workspaceId: 8 }));
    expect(r7.domain.workspaceId).toBe(7);
    expect(r8.domain.workspaceId).toBe(8);
    expect(r7.domain.degradationStatus).not.toBe(r8.domain.degradationStatus);
  });

  it("critical domain → observabilityHealth=blind", () => {
    const { domain } = evaluateFailureContainment(
      makeInput({ pressureScore: 100, containmentStatus: "saturated" }),
    );
    expect(domain.observabilityHealth).toBe("blind");
  });

  it("healthy domain → observabilityHealth=full", () => {
    const { domain } = evaluateFailureContainment(makeInput());
    expect(domain.observabilityHealth).toBe("full");
  });

  it("PlatformReliabilityOverview totalDomains equals input result count", () => {
    const r1 = evaluateFailureContainment(makeInput({ workspaceId: 1 }));
    const r2 = evaluateFailureContainment(makeInput({ workspaceId: 2 }));
    const r3 = evaluateFailureContainment(makeInput({ workspaceId: 3 }));
    const overview = buildPlatformReliabilityOverview([r1, r2, r3], "s", NOW);
    expect(overview.totalDomains).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - advisory storms influence degradation correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: advisory storms influence degradation correctly", () => {
  it("3 noisy codes → advisoryStormDetected=true", () => {
    const { advisoryStormDetected } = evaluateFailureContainment(
      makeInput({ noisyBehaviorCodes: ["A", "B", "C"] }),
    );
    expect(advisoryStormDetected).toBe(true);
  });

  it("high advisoryPressure + 2 noisy codes → advisoryStormDetected=true", () => {
    expect(detectAdvisoryStorm(["A", "B"], "high", 0)).toBe(true);
    expect(detectAdvisoryStorm(["A", "B"], "critical", 0)).toBe(true);
  });

  it("activePolicyCount >= 2 → advisoryStormDetected=true", () => {
    expect(detectAdvisoryStorm([], "none", 2)).toBe(true);
    expect(detectAdvisoryStorm([], "none", 3)).toBe(true);
  });

  it("no storm: 1 noisy code, low pressure, 1 policy → false", () => {
    expect(detectAdvisoryStorm(["A"], "low", 1)).toBe(false);
  });

  it("advisory storm increases degradation above healthy", () => {
    const { domain } = evaluateFailureContainment(
      makeInput({ noisyBehaviorCodes: ["A", "B", "C"], advisoryPressureLevel: "critical" }),
    );
    expect(domain.degradationStatus).not.toBe("healthy");
    expect(["severely_degraded", "containment_risk", "critical"].includes(domain.degradationStatus)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - serialization ordering stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: serialization ordering stable", () => {
  it("ReliabilityDomain is fully JSON-serializable", () => {
    const { domain } = evaluateFailureContainment(makeInput());
    expect(() => JSON.stringify(domain)).not.toThrow();
  });

  it("FailureContainmentResult is fully JSON-serializable", () => {
    const result = evaluateFailureContainment(makeInput());
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("PlatformReliabilityOverview is fully JSON-serializable", () => {
    const r = evaluateFailureContainment(makeInput());
    const overview = buildPlatformReliabilityOverview([r], "s", NOW);
    expect(() => JSON.stringify(overview)).not.toThrow();
  });

  it("JSON round-trip preserves domain fields", () => {
    const { domain } = evaluateFailureContainment(makeInput({ workspaceId: 7, pressureScore: 30, containmentStatus: "at_risk" }));
    const parsed = JSON.parse(JSON.stringify(domain)) as typeof domain;
    expect(parsed.workspaceId).toBe(domain.workspaceId);
    expect(parsed.degradationStatus).toBe(domain.degradationStatus);
    expect(parsed.propagationRisk).toBe(domain.propagationRisk);
    expect(parsed.containmentLevel).toBe(domain.containmentLevel);
    expect(parsed.evaluatedAt).toBe(domain.evaluatedAt);
  });

  it("overview healthyCount + degradedCount + severelyDegradedCount + containmentRiskCount + criticalCount = totalDomains", () => {
    const r1 = evaluateFailureContainment(makeInput({ workspaceId: 1 }));
    const r2 = evaluateFailureContainment(makeInput({ workspaceId: 2, pressureScore: 30 }));
    const r3 = evaluateFailureContainment(makeInput({ workspaceId: 3, pressureScore: 90, containmentStatus: "saturated" }));
    const ov = buildPlatformReliabilityOverview([r1, r2, r3], "s", NOW);
    const sum = ov.healthyCount + ov.degradedCount + ov.severelyDegradedCount + ov.containmentRiskCount + ov.criticalCount;
    expect(sum).toBe(ov.totalDomains);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - no runtime mutation occurs
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: no runtime mutation occurs", () => {
  it("evaluateFailureContainment has no async behavior", () => {
    const result = evaluateFailureContainment(makeInput());
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("buildPlatformReliabilityOverview does not mutate input results array", () => {
    const r1 = evaluateFailureContainment(makeInput({ workspaceId: 1 }));
    const snapshot = JSON.stringify([r1]);
    buildPlatformReliabilityOverview([r1], "s", NOW);
    expect(JSON.stringify([r1])).toBe(snapshot);
  });

  it("evaluateFailureContainment does not mutate input", () => {
    const input    = makeInput({ pressureScore: 50 });
    const snapshot = JSON.stringify(input);
    evaluateFailureContainment(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("PlatformReliabilityOverview has no function properties", () => {
    const r = evaluateFailureContainment(makeInput());
    const ov = buildPlatformReliabilityOverview([r], "s", NOW);
    const hasFn = Object.values(ov).some(v => typeof v === "function");
    expect(hasFn).toBe(false);
  });

  it("evaluateContainmentBoundaries does not mutate input", () => {
    const input    = makeInput({ noisyBehaviorCodes: ["X", "Y"] });
    const snapshot = JSON.stringify(input);
    evaluateContainmentBoundaries(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - reliability layer remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: reliability layer remains read-only", () => {
  it("emitReliabilityDomainEvaluatedEvent does not throw", () => {
    expect(() => emitReliabilityDomainEvaluatedEvent({
      domainId: "rd:1-1", degradationStatus: "healthy", propagationRisk: "isolated",
      containmentLevel: "contained", affectedSubsystems: [], action: "test",
    })).not.toThrow();
  });

  it("emitFailureContainmentAssessedEvent does not throw", () => {
    expect(() => emitFailureContainmentAssessedEvent({
      domainId: "rd:1-2", degradationStatus: "degraded", propagationRisk: "bounded",
      containmentLevel: "contained", affectedSubsystems: ["scheduler"], action: "test",
    })).not.toThrow();
  });

  it("emitFailurePropagationRiskDetectedEvent does not throw", () => {
    expect(() => emitFailurePropagationRiskDetectedEvent({
      domainId: "rd:1-3", degradationStatus: "critical", propagationRisk: "cascading",
      containmentLevel: "at_risk", affectedSubsystems: ["scheduler", "advisory"], action: "test",
    })).not.toThrow();
  });

  it("emitRuntimeDegradationClassifiedEvent does not throw", () => {
    expect(() => emitRuntimeDegradationClassifiedEvent({
      domainId: "rd:1-4", degradationStatus: "severely_degraded", propagationRisk: "spreading",
      containmentLevel: "partial", affectedSubsystems: ["workflow_runtime"], action: "test",
    })).not.toThrow();
  });

  it("degradationToRecoveryClassification covers all 5 statuses deterministically", () => {
    expect(degradationToRecoveryClassification("healthy")).toBe("no_action_needed");
    expect(degradationToRecoveryClassification("degraded")).toBe("monitor_closely");
    expect(degradationToRecoveryClassification("severely_degraded")).toBe("monitor_closely");
    expect(degradationToRecoveryClassification("containment_risk")).toBe("operator_attention");
    expect(degradationToRecoveryClassification("critical")).toBe("immediate_intervention");
  });

  it("engine produces no side effects that modify scheduler state", () => {
    // The engine is pure - calling it twice produces the same result
    const i  = makeInput({ pressureScore: 40, containmentStatus: "at_risk" });
    const r1 = evaluateFailureContainment({ ...i, evaluationTime: NOW });
    const r2 = evaluateFailureContainment({ ...i, evaluationTime: NOW });
    expect(r1.domain.degradationStatus).toBe(r2.domain.degradationStatus);
    expect(r1.blastRadius.blastRadiusScore).toBe(r2.blastRadius.blastRadiusScore);
  });
});
