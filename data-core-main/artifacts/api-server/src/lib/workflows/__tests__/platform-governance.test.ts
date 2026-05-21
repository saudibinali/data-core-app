/**
 * @file   __tests__/platform-governance.test.ts
 * @phase  P9-D - Platform Workload Control Plane & Super-Admin Operational Visibility
 *
 * T1  - platform overview deterministic
 * T2  - fairness health classification stable
 * T3  - noisy tenant aggregation correct
 * T4  - containment distribution deterministic
 * T5  - top pressure workspaces ordered correctly
 * T6  - bounded payload serialization stable
 * T7  - super-admin access sentinel (no sensitive data exposed)
 * T8  - platform observability events scoped correctly
 * T9  - no scheduler mutation occurs
 * T10 - control plane remains read-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildPlatformGovernanceOverview,
  classifyPlatformFairnessHealth,
  computeContainmentDistribution,
  computeAdvisoryDistribution,
  computeTopPressureWorkspaces,
  computeSchedulerPressureSummary,
  detectNoisyTenants,
  buildPlatformWorkloadList,
  makePlatformScopeId,
  resetPlatformScopeSeq,
  emitPlatformGovernanceOverviewEvent,
  emitPlatformFairnessHealthEvent,
  emitPlatformNoisyTenantEvent,
  emitPlatformSchedulerPressureEvent,
  TOP_WORKSPACE_LIMIT,
  FAIRNESS_CRITICAL_SATURATED_COUNT,
  type PlatformGovernanceOverview,
  type ContainmentDistribution,
} from "../platform-governance";
import { evaluateWorkloadContainment } from "../workload-partition";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_TIME = new Date("2026-05-15T14:00:00.000Z");

const NAMES: Record<number, string> = {
  1: "Alpha",
  2: "Beta",
  3: "Gamma",
  4: "Delta",
  5: "Epsilon",
  6: "Zeta",
  7: "Eta",
};

const SCOPE_ID = "psc:1747317600000-1";

/** Low activity → "contained" (score ~2) */
function makeContainedPartition(workspaceId: number) {
  return evaluateWorkloadContainment(
    { workspaceId, activeExecutionCount: 2, delayedExecutionCount: 0 },
    { evaluationTime: FIXED_TIME },
  );
}

/** Moderate activity → "at_risk" (score ~40, elevated) */
function makeAtRiskPartition(workspaceId: number) {
  return evaluateWorkloadContainment(
    { workspaceId, activeExecutionCount: 40, delayedExecutionCount: 10 },
    { evaluationTime: FIXED_TIME },
  );
}

/** High activity → "pressured" (score ~65, high) */
function makePressuredPartition(workspaceId: number) {
  return evaluateWorkloadContainment(
    { workspaceId, activeExecutionCount: 50, delayedExecutionCount: 30 },
    { evaluationTime: FIXED_TIME },
  );
}

/**
 * Critical activity → "saturated" (score ~90, critical).
 * Requires hotspot + advisory to push score ≥ 75.
 */
function makeSaturatedPartition(workspaceId: number) {
  return evaluateWorkloadContainment(
    {
      workspaceId,
      activeExecutionCount:    50,
      delayedExecutionCount:   30,
      hotspotConcentrationRatio: 1.0,
      advisoryLevel:           "critical",
    },
    { evaluationTime: FIXED_TIME },
  );
}

/**
 * High executions claiming >60% of platform total → EXECUTION_MONOPOLY noisy.
 * platformActiveExecutions = 100, workspace active = 70 → 70% > 60% threshold.
 */
function makeNoisyPartition(workspaceId: number) {
  return evaluateWorkloadContainment(
    {
      workspaceId,
      activeExecutionCount:    70,
      delayedExecutionCount:   5,
      platformActiveExecutions: 100,
    },
    { evaluationTime: FIXED_TIME },
  );
}

function makeInput(partitions: ReturnType<typeof makeContainedPartition>[], overrides = {}) {
  return {
    workspaceCount: partitions.length,
    partitions,
    workspaceNames: NAMES,
    requestScopeId: SCOPE_ID,
    generationTime: FIXED_TIME,
    ...overrides,
  };
}

function buildOverview(partitions: ReturnType<typeof makeContainedPartition>[]): PlatformGovernanceOverview {
  return buildPlatformGovernanceOverview(makeInput(partitions));
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - platform overview deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: platform overview deterministic", () => {
  it("same input + same time → identical JSON output", () => {
    const partitions = [makeContainedPartition(1), makeAtRiskPartition(2)];
    const input = makeInput(partitions);
    const o1 = buildPlatformGovernanceOverview(input);
    const o2 = buildPlatformGovernanceOverview(input);
    expect(JSON.stringify(o1)).toBe(JSON.stringify(o2));
  });

  it("requestScopeId is preserved from input", () => {
    const overview = buildOverview([makeContainedPartition(1)]);
    expect(overview.requestScopeId).toBe(SCOPE_ID);
  });

  it("generatedAt matches injected generation time", () => {
    const overview = buildOverview([makeContainedPartition(1)]);
    expect(overview.generatedAt).toBe(FIXED_TIME.toISOString());
  });

  it("totalWorkspaces matches input workspaceCount", () => {
    const partitions = [makeContainedPartition(1), makeContainedPartition(2)];
    const overview = buildPlatformGovernanceOverview(makeInput(partitions, { workspaceCount: 5 }));
    expect(overview.totalWorkspaces).toBe(5);
  });

  it("noisyTenantCount counts only noisy partitions", () => {
    const partitions = [
      makeContainedPartition(1),
      makeNoisyPartition(2),
      makeNoisyPartition(3),
    ];
    const overview = buildOverview(partitions);
    expect(overview.noisyTenantCount).toBe(2);
  });

  it("empty platform produces deterministic zero overview", () => {
    const o1 = buildPlatformGovernanceOverview(makeInput([]));
    const o2 = buildPlatformGovernanceOverview(makeInput([]));
    expect(JSON.stringify(o1)).toBe(JSON.stringify(o2));
    expect(o1.totalWorkspaces).toBe(0);
    expect(o1.fairnessHealth).toBe("healthy");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - fairness health classification stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: fairness health classification stable", () => {
  const zeroDistribution: ContainmentDistribution = {
    contained: 10, at_risk: 0, pressured: 0, saturated: 0, total: 10,
  };

  it("empty platform → 'healthy'", () => {
    expect(classifyPlatformFairnessHealth(zeroDistribution, 0, 0)).toBe("healthy");
  });

  it("all contained, no noisy → 'healthy'", () => {
    expect(classifyPlatformFairnessHealth(zeroDistribution, 0, 10)).toBe("healthy");
  });

  it(`${FAIRNESS_CRITICAL_SATURATED_COUNT} saturated partitions → 'critical'`, () => {
    const dist: ContainmentDistribution = {
      contained: 7, at_risk: 0, pressured: 0, saturated: FAIRNESS_CRITICAL_SATURATED_COUNT, total: 10,
    };
    expect(classifyPlatformFairnessHealth(dist, 0, 10)).toBe("critical");
  });

  it("1 saturated partition → 'degraded'", () => {
    const dist: ContainmentDistribution = {
      contained: 9, at_risk: 0, pressured: 0, saturated: 1, total: 10,
    };
    expect(classifyPlatformFairnessHealth(dist, 0, 10)).toBe("degraded");
  });

  it("50% pressured+saturated fraction → 'critical'", () => {
    const dist: ContainmentDistribution = {
      contained: 5, at_risk: 0, pressured: 3, saturated: 2, total: 10,
    };
    expect(classifyPlatformFairnessHealth(dist, 0, 10)).toBe("critical");
  });

  it("high noisy fraction (50%+) → 'critical'", () => {
    const dist: ContainmentDistribution = {
      contained: 10, at_risk: 0, pressured: 0, saturated: 0, total: 10,
    };
    expect(classifyPlatformFairnessHealth(dist, 6, 10)).toBe("critical");
  });

  it("25% noisy fraction → 'degraded'", () => {
    const dist: ContainmentDistribution = {
      contained: 10, at_risk: 0, pressured: 0, saturated: 0, total: 10,
    };
    // 3/10 = 30% > 25% threshold → degraded (not stressed)
    expect(classifyPlatformFairnessHealth(dist, 3, 10)).toBe("degraded");
  });

  it("10% noisy fraction → 'stressed'", () => {
    const dist: ContainmentDistribution = {
      contained: 10, at_risk: 0, pressured: 0, saturated: 0, total: 10,
    };
    expect(classifyPlatformFairnessHealth(dist, 1, 10)).toBe("stressed");
  });

  it("classification is stable across repeated calls", () => {
    const dist: ContainmentDistribution = {
      contained: 5, at_risk: 3, pressured: 2, saturated: 0, total: 10,
    };
    const r1 = classifyPlatformFairnessHealth(dist, 1, 10);
    const r2 = classifyPlatformFairnessHealth(dist, 1, 10);
    expect(r1).toBe(r2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - noisy tenant aggregation correct
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: noisy tenant aggregation correct", () => {
  it("only noisy partitions appear in noisy tenant list", () => {
    const partitions = [
      makeContainedPartition(1),
      makeNoisyPartition(2),
      makeContainedPartition(3),
      makeNoisyPartition(4),
    ];
    const noisy = detectNoisyTenants(partitions, NAMES);
    expect(noisy.length).toBe(2);
    expect(noisy.every(t => t.noisyCategories.length > 0)).toBe(true);
  });

  it("noisy tenants sorted by pressureScore DESC", () => {
    const partitions = [
      makeNoisyPartition(2),  // same pressure
      makeNoisyPartition(4),  // same pressure, higher workspaceId
    ];
    const noisy = detectNoisyTenants(partitions, NAMES);
    // Both noisy with same score → tie-break by workspaceId ASC
    expect(noisy[0]!.workspaceId).toBe(2);
    expect(noisy[1]!.workspaceId).toBe(4);
  });

  it("noisy tenant records use workspaceName from map", () => {
    const partitions = [makeNoisyPartition(2)];
    const noisy = detectNoisyTenants(partitions, NAMES);
    expect(noisy[0]!.workspaceName).toBe("Beta");
  });

  it("absent workspaceName falls back to 'workspace:<id>'", () => {
    const partitions = [makeNoisyPartition(99)];
    const noisy = detectNoisyTenants(partitions, {});
    expect(noisy[0]!.workspaceName).toBe("workspace:99");
  });

  it("empty partitions → empty noisy list", () => {
    expect(detectNoisyTenants([], {})).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - containment distribution deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: containment distribution deterministic", () => {
  it("counts each containmentStatus correctly", () => {
    const partitions = [
      makeContainedPartition(1),
      makeContainedPartition(2),
      makeAtRiskPartition(3),
      makePressuredPartition(4),
      makeSaturatedPartition(5),
    ];
    const dist = computeContainmentDistribution(partitions);
    expect(dist.contained).toBe(2);
    expect(dist.at_risk).toBe(1);
    expect(dist.pressured).toBe(1);
    expect(dist.saturated).toBe(1);
    expect(dist.total).toBe(5);
  });

  it("total equals sum of all status counts", () => {
    const partitions = [
      makeContainedPartition(1),
      makeAtRiskPartition(2),
      makeSaturatedPartition(3),
    ];
    const dist = computeContainmentDistribution(partitions);
    expect(dist.contained + dist.at_risk + dist.pressured + dist.saturated)
      .toBe(dist.total);
  });

  it("empty partitions → all zeros", () => {
    const dist = computeContainmentDistribution([]);
    expect(dist).toEqual({ contained: 0, at_risk: 0, pressured: 0, saturated: 0, total: 0 });
  });

  it("same input → same distribution (deterministic)", () => {
    const partitions = [makeAtRiskPartition(3), makeContainedPartition(1)];
    const d1 = computeContainmentDistribution(partitions);
    const d2 = computeContainmentDistribution(partitions);
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
  });

  it("advisory distribution total matches partition count", () => {
    const partitions = [
      makeContainedPartition(1),
      makeAtRiskPartition(2),
      makePressuredPartition(3),
    ];
    const dist = computeAdvisoryDistribution(partitions);
    expect(dist.none + dist.low + dist.medium + dist.high + dist.critical).toBe(dist.total);
    expect(dist.total).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - top pressure workspaces ordered correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: top pressure workspaces ordered correctly", () => {
  it("sorted DESC by pressureScore", () => {
    const partitions = [
      makeContainedPartition(1),   // low score
      makePressuredPartition(2),   // high score
      makeAtRiskPartition(3),      // moderate score
      makeSaturatedPartition(4),   // highest score
    ];
    const top = computeTopPressureWorkspaces(partitions, NAMES, 4);
    expect(top[0]!.pressureScore).toBeGreaterThanOrEqual(top[1]!.pressureScore);
    expect(top[1]!.pressureScore).toBeGreaterThanOrEqual(top[2]!.pressureScore);
    expect(top[2]!.pressureScore).toBeGreaterThanOrEqual(top[3]!.pressureScore);
  });

  it("limited to specified limit", () => {
    const partitions = Array.from({ length: 15 }, (_, i) => makeContainedPartition(i + 1));
    const top = computeTopPressureWorkspaces(partitions, NAMES, 10);
    expect(top.length).toBe(10);
  });

  it("TOP_WORKSPACE_LIMIT defaults applied in buildPlatformGovernanceOverview", () => {
    const partitions = Array.from({ length: TOP_WORKSPACE_LIMIT + 5 }, (_, i) =>
      makeContainedPartition(i + 1),
    );
    const overview = buildOverview(partitions);
    expect(overview.topPressureWorkspaces.length).toBeLessThanOrEqual(TOP_WORKSPACE_LIMIT);
  });

  it("workspaceId preserved in top workspace entry", () => {
    const partitions = [makeSaturatedPartition(5)];
    const top = computeTopPressureWorkspaces(partitions, NAMES, 1);
    expect(top[0]!.workspaceId).toBe(5);
  });

  it("tie-breaking by workspaceId ASC is deterministic", () => {
    // Two contained partitions (same score ~2)
    const p1 = makeContainedPartition(10);
    const p2 = makeContainedPartition(3);
    const top = computeTopPressureWorkspaces([p1, p2], {}, 2);
    // Lower workspaceId wins tie
    expect(top[0]!.workspaceId).toBe(3);
    expect(top[1]!.workspaceId).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - bounded payload serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: bounded payload serialization stable", () => {
  it("PlatformGovernanceOverview is fully JSON-serializable", () => {
    const partitions = [makeContainedPartition(1), makeNoisyPartition(2)];
    const overview = buildOverview(partitions);
    expect(() => JSON.stringify(overview)).not.toThrow();
  });

  it("no undefined values in overview JSON", () => {
    const partitions = [makeContainedPartition(1), makeSaturatedPartition(2)];
    const json = JSON.stringify(buildOverview(partitions));
    expect(json).not.toContain('"undefined"');
    expect(json).not.toContain(':undefined');
  });

  it("JSON round-trip preserves all top-level fields", () => {
    const overview = buildOverview([makeContainedPartition(1), makeAtRiskPartition(2)]);
    const parsed = JSON.parse(JSON.stringify(overview)) as PlatformGovernanceOverview;
    expect(parsed.fairnessHealth).toBe(overview.fairnessHealth);
    expect(parsed.noisyTenantCount).toBe(overview.noisyTenantCount);
    expect(parsed.totalWorkspaces).toBe(overview.totalWorkspaces);
    expect(parsed.requestScopeId).toBe(overview.requestScopeId);
  });

  it("workload list is fully JSON-serializable", () => {
    const partitions = [makeContainedPartition(1), makePressuredPartition(2)];
    const list = buildPlatformWorkloadList(partitions, NAMES);
    expect(() => JSON.stringify(list)).not.toThrow();
    expect(JSON.parse(JSON.stringify(list))).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - super-admin access sentinel (no sensitive data exposed)
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: super-admin access sentinel", () => {
  it("NoisyTenantRecord only exposes permitted fields - no tokens or config", () => {
    const record = detectNoisyTenants([makeNoisyPartition(2)], NAMES)[0]!;
    const keys = Object.keys(record);
    // Only these 7 fields must be present
    expect(keys.sort()).toEqual([
      "activeExecutionCount",
      "containmentStatus",
      "delayedExecutionCount",
      "noisyCategories",
      "pressureScore",
      "workspaceId",
      "workspaceName",
    ].sort());
  });

  it("TopPressureWorkspace has no internal config or sensitive fields", () => {
    const top = computeTopPressureWorkspaces([makeContainedPartition(1)], NAMES, 1)[0]!;
    const keys = Object.keys(top);
    expect(keys).not.toContain("passwordHash");
    expect(keys).not.toContain("jwtSecret");
    expect(keys).not.toContain("connectionString");
  });

  it("makePlatformScopeId generates non-empty string with expected prefix", () => {
    const id = makePlatformScopeId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(id.startsWith("psc:")).toBe(true);
  });

  it("empty platform overview contains no private workspace data", () => {
    const overview = buildPlatformGovernanceOverview({
      workspaceCount:  0,
      partitions:      [],
      workspaceNames:  {},
      requestScopeId:  "psc:test-0",
      generationTime:  FIXED_TIME,
    });
    expect(overview.topPressureWorkspaces).toEqual([]);
    expect(overview.noisyTenantCount).toBe(0);
    expect(overview.fairnessHealth).toBe("healthy");
  });

  it("platformWorkloadEntry only has operational fields", () => {
    const entry = buildPlatformWorkloadList([makeContainedPartition(1)], NAMES)[0]!;
    const keys = Object.keys(entry);
    expect(keys.sort()).toEqual([
      "activeExecutionCount",
      "containmentStatus",
      "delayedExecutionCount",
      "evaluatedAt",
      "executionPressureLevel",
      "noisyBehaviorCodes",
      "noisyBehaviorDetected",
      "partitionId",
      "pressureScore",
      "schedulerWeight",
      "workspaceId",
      "workspaceName",
    ].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - platform observability events scoped correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: platform observability events scoped correctly", () => {
  const dist: ContainmentDistribution = {
    contained: 8, at_risk: 1, pressured: 1, saturated: 0, total: 10,
  };

  it("emitPlatformGovernanceOverviewEvent does not throw", () => {
    expect(() =>
      emitPlatformGovernanceOverviewEvent("psc:test-1", 10, "healthy", 0, dist, FIXED_TIME.toISOString()),
    ).not.toThrow();
  });

  it("emitPlatformFairnessHealthEvent does not throw", () => {
    expect(() =>
      emitPlatformFairnessHealthEvent("psc:test-2", 10, "stressed", 1, dist),
    ).not.toThrow();
  });

  it("emitPlatformNoisyTenantEvent does not throw", () => {
    expect(() =>
      emitPlatformNoisyTenantEvent("psc:test-3", 10, "degraded", 2, dist),
    ).not.toThrow();
  });

  it("emitPlatformSchedulerPressureEvent does not throw", () => {
    expect(() =>
      emitPlatformSchedulerPressureEvent("psc:test-4", 10, "critical", 5, dist),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - no scheduler mutation occurs
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: no scheduler mutation occurs", () => {
  it("computeContainmentDistribution does not mutate input partitions", () => {
    const partitions = [makeContainedPartition(1), makeAtRiskPartition(2)];
    const snapshot = JSON.stringify(partitions);
    computeContainmentDistribution(partitions);
    expect(JSON.stringify(partitions)).toBe(snapshot);
  });

  it("buildPlatformGovernanceOverview does not mutate input partitions", () => {
    const partitions = [makeContainedPartition(1), makePressuredPartition(2)];
    const input = makeInput(partitions);
    const snapshot = JSON.stringify(partitions);
    buildPlatformGovernanceOverview(input);
    expect(JSON.stringify(partitions)).toBe(snapshot);
  });

  it("TopPressureWorkspace noisyBehaviorCodes is a copy - not aliased", () => {
    const partition = makeNoisyPartition(2);
    const top = computeTopPressureWorkspaces([partition], NAMES, 1);
    top[0]!.noisyBehaviorCodes.push("ADVISORY_STORM");
    expect(partition.noisyBehaviorCodes).not.toContain("ADVISORY_STORM");
  });

  it("NoisyTenantRecord noisyCategories is a copy - not aliased", () => {
    const partition = makeNoisyPartition(2);
    const noisy = detectNoisyTenants([partition], NAMES);
    noisy[0]!.noisyCategories.push("ADVISORY_STORM");
    expect(partition.noisyBehaviorCodes).not.toContain("ADVISORY_STORM");
  });

  it("computeSchedulerPressureSummary does not mutate partitions", () => {
    const partitions = [makeContainedPartition(1), makePressuredPartition(2)];
    const snapshot = JSON.stringify(partitions);
    computeSchedulerPressureSummary(partitions);
    expect(JSON.stringify(partitions)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - control plane remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: control plane remains read-only", () => {
  it("buildPlatformGovernanceOverview returns no function properties", () => {
    const overview = buildOverview([makeContainedPartition(1)]);
    const allValues = Object.values(overview);
    const nested = JSON.stringify(overview);
    expect(nested).not.toContain('"function"');
    expect(allValues.every(v => typeof v !== "function")).toBe(true);
  });

  it("computeTopPressureWorkspaces returns plain objects (no class instances)", () => {
    const top = computeTopPressureWorkspaces([makeContainedPartition(1)], NAMES, 1);
    expect(top[0]!.constructor).toBe(Object);
  });

  it("engine functions have no async behavior", () => {
    const result = buildPlatformGovernanceOverview(makeInput([makeContainedPartition(1)]));
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("scheduler pressure summary is deterministic", () => {
    const partitions = [makeContainedPartition(1), makeAtRiskPartition(2)];
    const s1 = computeSchedulerPressureSummary(partitions);
    const s2 = computeSchedulerPressureSummary(partitions);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });

  it("makePlatformScopeId generates unique IDs (non-repeating)", () => {
    beforeEach(() => resetPlatformScopeSeq());
    const id1 = makePlatformScopeId();
    const id2 = makePlatformScopeId();
    expect(id1).not.toBe(id2);
  });

  it("workload list sort order is stable (deterministic pagination)", () => {
    const partitions = [
      makeAtRiskPartition(3),
      makeContainedPartition(1),
      makePressuredPartition(2),
    ];
    const l1 = buildPlatformWorkloadList(partitions, NAMES);
    const l2 = buildPlatformWorkloadList(partitions, NAMES);
    expect(JSON.stringify(l1)).toBe(JSON.stringify(l2));
    // First entry should be highest pressure
    expect(l1[0]!.pressureScore).toBeGreaterThanOrEqual(l1[1]!.pressureScore);
  });
});
