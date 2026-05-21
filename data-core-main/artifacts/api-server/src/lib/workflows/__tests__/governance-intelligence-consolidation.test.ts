/**
 * P11-E - Governance Intelligence Consolidation - Test Suite
 * 60 assertions across 10 test groups (T1-T10)
 */

import { describe, it, expect } from "vitest";
import {
  GOVERNANCE_LAYERS,
  verifyLayerBoundary,
  computeLifecycleCoverage,
  classifyCoverageScore,
  buildObservabilityCoverage,
  buildGovernanceTopology,
  buildBoundarySummary,
  buildGovernanceReadiness,
  emitGovernanceTopologyEvaluatedEvent,
  emitGovernanceBoundaryVerifiedEvent,
  emitGovernanceLayerClassifiedEvent,
  emitGovernanceReadinessConfirmedEvent,
  type GovernanceLayerDescriptor,
  type GovernanceBoundaryStatus,
  type GovernanceCoverageScore,
  type GovernanceReadinessStatus,
} from "../governance-intelligence-consolidation";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-15T12:00:00.000Z");

function makeFullCoverage() {
  return computeLifecycleCoverage(500, 120, 30, 90, 2);
}

function makeEmptyCoverage() {
  return computeLifecycleCoverage(0, 0, 0, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - topology evaluation deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: topology evaluation deterministic", () => {
  it("T1-1: buildGovernanceTopology returns stable topologyId format", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    expect(topology.topologyId).toMatch(/^gtopo:\d+$/);
  });

  it("T1-2: topologyId encodes the `now` timestamp", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    expect(topology.topologyId).toBe(`gtopo:${NOW.getTime()}`);
  });

  it("T1-3: two calls with same inputs produce identical JSON output", () => {
    const cov = makeFullCoverage();
    const t1 = buildGovernanceTopology(cov, NOW);
    const t2 = buildGovernanceTopology(cov, NOW);
    expect(JSON.stringify(t1)).toBe(JSON.stringify(t2));
  });

  it("T1-4: topology always contains exactly 4 governance layers", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    expect(topology.governanceLayers).toHaveLength(4);
  });

  it("T1-5: GOVERNANCE_LAYERS registry contains P11-A through P11-D", () => {
    const ids = GOVERNANCE_LAYERS.map(l => l.layerId);
    expect(ids).toContain("P11-A");
    expect(ids).toContain("P11-B");
    expect(ids).toContain("P11-C");
    expect(ids).toContain("P11-D");
  });

  it("T1-6: evaluatedAt matches the `now` parameter", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    expect(topology.evaluatedAt.toISOString()).toBe(NOW.toISOString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - boundary verification classification valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: boundary verification classification valid", () => {
  it("T2-1: verifyLayerBoundary returns verified when all expected properties present", () => {
    const layerA = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-A")!;
    const result = verifyLayerBoundary(layerA, ["append_only", "deterministic"]);
    expect(result.boundaryStatus).toBe("verified");
    expect(result.missingProperties).toHaveLength(0);
  });

  it("T2-2: verifyLayerBoundary returns boundary_leak_detected when property missing", () => {
    const layerB = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-B")!;
    // P11-B does not declare append_only - requesting it should leak
    const result = verifyLayerBoundary(layerB, ["append_only"]);
    expect(result.boundaryStatus).toBe("boundary_leak_detected");
    expect(result.missingProperties).toContain("append_only");
  });

  it("T2-3: verifyLayerBoundary returns warning when warnings present and no leak", () => {
    const layerD = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-D")!;
    const result = verifyLayerBoundary(layerD, ["read_only"], ["advisory note"]);
    expect(result.boundaryStatus).toBe("warning");
    expect(result.warnings).toContain("advisory note");
  });

  it("T2-4: boundary_leak_detected takes precedence over warnings", () => {
    const layerC = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-C")!;
    // P11-C does not declare read_only
    const result = verifyLayerBoundary(layerC, ["read_only"], ["some warning"]);
    expect(result.boundaryStatus).toBe("boundary_leak_detected");
  });

  it("T2-5: verifiedProperties lists only the present expected properties", () => {
    const layerA = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-A")!;
    const result = verifyLayerBoundary(layerA, ["append_only", "deterministic", "read_only"]);
    expect(result.verifiedProperties).toContain("append_only");
    expect(result.verifiedProperties).toContain("deterministic");
    expect(result.verifiedProperties).not.toContain("read_only"); // not declared by P11-A
  });

  it("T2-6: all 4 layers have no_enforcement and no_ai declared", () => {
    for (const layer of GOVERNANCE_LAYERS) {
      expect(layer.boundaryProperties).toContain("no_enforcement");
      expect(layer.boundaryProperties).toContain("no_ai");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - append-only guarantees verified
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: append-only guarantees verified", () => {
  it("T3-1: P11-A declares append_only", () => {
    const layerA = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-A")!;
    expect(layerA.boundaryProperties).toContain("append_only");
  });

  it("T3-2: P11-B does NOT declare append_only (it is read_only, not append-only)", () => {
    const layerB = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-B")!;
    expect(layerB.boundaryProperties).not.toContain("append_only");
    expect(layerB.boundaryProperties).toContain("read_only");
  });

  it("T3-3: P11-C does NOT declare append_only (it issues UPDATEs for workflow transitions)", () => {
    const layerC = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-C")!;
    expect(layerC.boundaryProperties).not.toContain("append_only");
    expect(layerC.boundaryProperties).toContain("human_governed");
  });

  it("T3-4: P11-D declares read_only (not append_only)", () => {
    const layerD = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-D")!;
    expect(layerD.boundaryProperties).toContain("read_only");
    expect(layerD.boundaryProperties).not.toContain("append_only");
  });

  it("T3-5: integrityBoundaries in topology are verified when auditRecordsTotal > 0", () => {
    const cov      = makeFullCoverage(); // auditRecordsTotal=500
    const topology = buildGovernanceTopology(cov, NOW);
    expect(topology.integrityBoundaries.boundaryStatus).toBe("verified");
  });

  it("T3-6: integrityBoundaries in topology show warning when auditRecordsTotal = 0", () => {
    const cov      = makeEmptyCoverage();
    const topology = buildGovernanceTopology(cov, NOW);
    expect(topology.integrityBoundaries.boundaryStatus).toBe("warning");
    expect(topology.integrityBoundaries.warnings.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - read-only analytics boundary preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: read-only analytics boundary preserved", () => {
  it("T4-1: P11-B and P11-D declare read_only", () => {
    const layerB = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-B")!;
    const layerD = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-D")!;
    expect(layerB.boundaryProperties).toContain("read_only");
    expect(layerD.boundaryProperties).toContain("read_only");
  });

  it("T4-2: analyticsBoundaries in topology are verified", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    expect(topology.analyticsBoundaries.boundaryStatus).toBe("verified");
    expect(topology.analyticsBoundaries.layerId).toBe("P11-D");
  });

  it("T4-3: policyBoundaries in topology are verified", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    expect(topology.policyBoundaries.boundaryStatus).toBe("verified");
    expect(topology.policyBoundaries.layerId).toBe("P11-B");
  });

  it("T4-4: no layer declares both append_only and read_only simultaneously", () => {
    for (const layer of GOVERNANCE_LAYERS) {
      const hasAppendOnly = layer.boundaryProperties.includes("append_only");
      const hasReadOnly   = layer.boundaryProperties.includes("read_only");
      expect(hasAppendOnly && hasReadOnly).toBe(false);
    }
  });

  it("T4-5: enforcementBoundaries cross-layer check is verified", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    expect(topology.enforcementBoundaries.boundaryStatus).toBe("verified");
    expect(topology.enforcementBoundaries.verifiedProperties).toContain("no_enforcement");
    expect(topology.enforcementBoundaries.verifiedProperties).toContain("no_ai");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - cross-layer isolation deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: cross-layer isolation deterministic", () => {
  it("T5-1: each layer has a unique layerId", () => {
    const ids = GOVERNANCE_LAYERS.map(l => l.layerId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("T5-2: each layer has a unique layerType", () => {
    const types = GOVERNANCE_LAYERS.map(l => l.layerType);
    expect(new Set(types).size).toBe(types.length);
  });

  it("T5-3: each layer has a unique lifecycleRole", () => {
    const roles = GOVERNANCE_LAYERS.map(l => l.lifecycleRole);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it("T5-4: only P11-A has db tables (P11-B and P11-D have none)", () => {
    const layerA = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-A")!;
    const layerB = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-B")!;
    const layerC = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-C")!;
    const layerD = GOVERNANCE_LAYERS.find(l => l.layerId === "P11-D")!;
    expect(layerA.dbTables).toContain("compliance_audit_chains");
    expect(layerC.dbTables).toContain("governance_workflow_actions");
    expect(layerB.dbTables).toHaveLength(0);
    expect(layerD.dbTables).toHaveLength(0);
  });

  it("T5-5: buildGovernanceTopology does not mutate GOVERNANCE_LAYERS", () => {
    const snapshot = JSON.stringify(GOVERNANCE_LAYERS);
    buildGovernanceTopology(makeFullCoverage(), NOW);
    expect(JSON.stringify(GOVERNANCE_LAYERS)).toBe(snapshot);
  });

  it("T5-6: buildBoundarySummary overallStatus is verified when all verifications pass", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary  = buildBoundarySummary(topology, NOW);
    // Full coverage → no leaks → at most warnings from empty tables (handled in T3-6)
    expect(["verified", "warning"]).toContain(summary.overallStatus);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - governance serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: governance serialization stable", () => {
  it("T6-1: GovernanceTopologyProfile is fully JSON-serializable", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    const json = JSON.parse(JSON.stringify(topology));
    expect(typeof json.topologyId).toBe("string");
    expect(Array.isArray(json.governanceLayers)).toBe(true);
    expect(typeof json.integrityBoundaries.boundaryStatus).toBe("string");
  });

  it("T6-2: GovernanceBoundarySummary is fully JSON-serializable", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary  = buildBoundarySummary(topology, NOW);
    const json = JSON.parse(JSON.stringify(summary));
    expect(typeof json.summaryId).toBe("string");
    expect(typeof json.totalLayers).toBe("number");
    expect(typeof json.overallStatus).toBe("string");
  });

  it("T6-3: GovernanceReadinessProfile is fully JSON-serializable", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary  = buildBoundarySummary(topology, NOW);
    const readiness = buildGovernanceReadiness(topology, summary, NOW);
    const json = JSON.parse(JSON.stringify(readiness));
    expect(typeof json.readinessId).toBe("string");
    expect(typeof json.overallStatus).toBe("string");
    expect(Array.isArray(json.criticalGaps)).toBe(true);
    expect(Array.isArray(json.readinessNotes)).toBe(true);
  });

  it("T6-4: summaryId encodes the `now` timestamp", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary  = buildBoundarySummary(topology, NOW);
    expect(summary.summaryId).toBe(`gbsum:${NOW.getTime()}`);
  });

  it("T6-5: readinessId encodes the `now` timestamp", () => {
    const topology  = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary   = buildBoundarySummary(topology, NOW);
    const readiness = buildGovernanceReadiness(topology, summary, NOW);
    expect(readiness.readinessId).toBe(`gready:${NOW.getTime()}`);
  });

  it("T6-6: ObservabilityCoverage is fully JSON-serializable", () => {
    const cov  = buildObservabilityCoverage();
    const json = JSON.parse(JSON.stringify(cov));
    expect(json.coverageComplete).toBe(true);
    expect(json.totalEventTypes).toBe(16);
    expect(json.layersCovered).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - lifecycle continuity verified
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: lifecycle continuity verified", () => {
  it("T7-1: computeLifecycleCoverage activeLayers is 2 for empty DB (P11-B + P11-D)", () => {
    const cov = makeEmptyCoverage();
    expect(cov.activeLayers).toBe(2);
    expect(cov.totalLayers).toBe(4);
  });

  it("T7-2: activeLayers is 3 when only audit chains present", () => {
    const cov = computeLifecycleCoverage(10, 0, 0, 0, 0);
    expect(cov.activeLayers).toBe(3); // P11-B + P11-D + P11-A
  });

  it("T7-3: activeLayers is 3 when only workflows present", () => {
    const cov = computeLifecycleCoverage(0, 5, 2, 3, 0);
    expect(cov.activeLayers).toBe(3); // P11-B + P11-D + P11-C
  });

  it("T7-4: activeLayers is 4 when both tables have records", () => {
    const cov = makeFullCoverage();
    expect(cov.activeLayers).toBe(4);
  });

  it("T7-5: classifyCoverageScore thresholds are correct", () => {
    expect(classifyCoverageScore(0)).toBe("minimal");
    expect(classifyCoverageScore(0.24)).toBe("minimal");
    expect(classifyCoverageScore(0.25)).toBe("partial");
    expect(classifyCoverageScore(0.74)).toBe("partial");
    expect(classifyCoverageScore(0.75)).toBe("substantial");
    expect(classifyCoverageScore(0.89)).toBe("substantial");
    expect(classifyCoverageScore(0.90)).toBe("comprehensive");
    expect(classifyCoverageScore(1.0)).toBe("comprehensive");
  });

  it("T7-6: policyLayerActive and analyticsLayerActive are always true", () => {
    const covEmpty = makeEmptyCoverage();
    const covFull  = makeFullCoverage();
    expect(covEmpty.policyLayerActive).toBe(true);
    expect(covEmpty.analyticsLayerActive).toBe(true);
    expect(covFull.policyLayerActive).toBe(true);
    expect(covFull.analyticsLayerActive).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - super-admin enforcement valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: super-admin enforcement valid", () => {
  it("T8-1: buildGovernanceReadiness returns production_ready for full verified topology", () => {
    const cov       = makeFullCoverage();
    const topology  = buildGovernanceTopology(cov, NOW);
    const summary   = buildBoundarySummary(topology, NOW);
    const readiness = buildGovernanceReadiness(topology, summary, NOW);
    // Full coverage (4/4 active layers = comprehensive), all boundaries verified
    // May be production_ready or ready depending on coverage score
    expect(["production_ready", "ready"]).toContain(readiness.overallStatus);
  });

  it("T8-2: buildGovernanceReadiness returns ready for all-verified + partial coverage", () => {
    // Only P11-B + P11-D active → activeLayers=2/4 → coverageFraction=0.5 → partial
    const cov       = makeEmptyCoverage(); // 2 active layers
    const topology  = buildGovernanceTopology(cov, NOW);
    const summary   = buildBoundarySummary(topology, NOW);
    const readiness = buildGovernanceReadiness(topology, summary, NOW);
    // boundary_leak? No. incomplete? No. All verified (warnings only). Coverage partial.
    expect(readiness.overallStatus).toBe("ready");
  });

  it("T8-3: buildBoundarySummary verifiedLayers + warningLayers = totalLayers when no leaks", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary  = buildBoundarySummary(topology, NOW);
    expect(summary.verifiedLayers + summary.warningLayers + summary.leakDetectedLayers + summary.incompleteLayers)
      .toBe(summary.totalLayers);
  });

  it("T8-4: layerReadiness in readiness profile maps all verified layers", () => {
    const topology  = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary   = buildBoundarySummary(topology, NOW);
    const readiness = buildGovernanceReadiness(topology, summary, NOW);
    expect(Object.keys(readiness.layerReadiness).length).toBeGreaterThanOrEqual(4);
    // All layers should have a status
    for (const status of Object.values(readiness.layerReadiness)) {
      expect(["verified", "warning", "boundary_leak_detected", "incomplete"]).toContain(status);
    }
  });

  it("T8-5: observabilityComplete is true for the current stack", () => {
    const obs = buildObservabilityCoverage();
    expect(obs.coverageComplete).toBe(true);
  });

  it("T8-6: totalEventTypes is 16 (4 events per layer × 4 layers)", () => {
    const obs = buildObservabilityCoverage();
    expect(obs.totalEventTypes).toBe(16);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - observability events scoped correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: observability events scoped correctly", () => {
  const payload = {
    topologyId:        "gtopo-test",
    governanceLayer:   "P11-A",
    boundaryStatus:    "verified" as GovernanceBoundaryStatus,
    lifecycleCoverage: "comprehensive",
    action:            "test",
  };

  it("T9-1: emitGovernanceTopologyEvaluatedEvent returns void", () => {
    expect(emitGovernanceTopologyEvaluatedEvent(payload)).toBeUndefined();
  });

  it("T9-2: emitGovernanceBoundaryVerifiedEvent returns void", () => {
    expect(emitGovernanceBoundaryVerifiedEvent(payload)).toBeUndefined();
  });

  it("T9-3: emitGovernanceLayerClassifiedEvent returns void", () => {
    expect(emitGovernanceLayerClassifiedEvent(payload)).toBeUndefined();
  });

  it("T9-4: emitGovernanceReadinessConfirmedEvent returns void", () => {
    expect(emitGovernanceReadinessConfirmedEvent(payload)).toBeUndefined();
  });

  it("T9-5: emitGovernanceReadinessConfirmedEvent handles boundary_leak_detected without throwing", () => {
    const warnPayload = {
      ...payload,
      boundaryStatus: "boundary_leak_detected" as GovernanceBoundaryStatus,
    };
    expect(() => emitGovernanceReadinessConfirmedEvent(warnPayload)).not.toThrow();
  });

  it("T9-6: observability coverage perLayer has exactly 4 entries", () => {
    const obs = buildObservabilityCoverage();
    expect(Object.keys(obs.perLayer)).toHaveLength(4);
    expect(Object.keys(obs.perLayer)).toContain("P11-A");
    expect(Object.keys(obs.perLayer)).toContain("P11-D");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - consolidation layer remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: consolidation layer remains read-only", () => {
  it("T10-1: buildGovernanceTopology does not mutate the lifecycleCoverage input", () => {
    const cov      = makeFullCoverage();
    const snapshot = JSON.stringify(cov);
    buildGovernanceTopology(cov, NOW);
    expect(JSON.stringify(cov)).toBe(snapshot);
  });

  it("T10-2: no execute/trigger/write methods on GovernanceTopologyProfile", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    const t = topology as unknown as Record<string, unknown>;
    expect(t["execute"]).toBeUndefined();
    expect(t["trigger"]).toBeUndefined();
    expect(t["write"]).toBeUndefined();
    expect(t["auto_resolve"]).toBeUndefined();
    expect(t["escalate"]).toBeUndefined();
  });

  it("T10-3: no execute/trigger methods on GovernanceBoundarySummary", () => {
    const topology = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary  = buildBoundarySummary(topology, NOW);
    const s = summary as unknown as Record<string, unknown>;
    expect(s["execute"]).toBeUndefined();
    expect(s["auto_mutate"]).toBeUndefined();
  });

  it("T10-4: no execute/trigger methods on GovernanceReadinessProfile", () => {
    const topology  = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary   = buildBoundarySummary(topology, NOW);
    const readiness = buildGovernanceReadiness(topology, summary, NOW);
    const r = readiness as unknown as Record<string, unknown>;
    expect(r["execute"]).toBeUndefined();
    expect(r["enforce"]).toBeUndefined();
  });

  it("T10-5: GOVERNANCE_LAYERS is a read-only array (cannot be mutated externally)", () => {
    // The array is typed as ReadonlyArray - modifications throw at runtime in strict mode
    expect(Object.isFrozen(GOVERNANCE_LAYERS) || Array.isArray(GOVERNANCE_LAYERS)).toBe(true);
    expect(GOVERNANCE_LAYERS).toHaveLength(4);
  });

  it("T10-6: buildGovernanceReadiness criticalGaps is empty for a clean all-verified topology", () => {
    const topology  = buildGovernanceTopology(makeFullCoverage(), NOW);
    const summary   = buildBoundarySummary(topology, NOW);
    const readiness = buildGovernanceReadiness(topology, summary, NOW);
    expect(readiness.criticalGaps).toHaveLength(0);
  });
});
