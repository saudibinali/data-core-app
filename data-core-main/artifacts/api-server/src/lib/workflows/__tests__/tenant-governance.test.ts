/**
 * @file   __tests__/tenant-governance.test.ts
 * @phase  P9-C - Tenant Governance APIs & Operational Visibility Foundations
 *
 * T1  - tenant overview isolated correctly
 * T2  - partition pressure visibility deterministic
 * T3  - fairness status serialization stable
 * T4  - isolation health classification deterministic
 * T5  - cross-tenant visibility blocked
 * T6  - audit serialization stable ordering
 * T7  - hotspot summaries tenant-safe
 * T8  - advisory summaries isolated correctly
 * T9  - scope ambiguity fails closed
 * T10 - governance APIs remain read-only
 */

import { describe, it, expect } from "vitest";
import {
  buildTenantGovernanceView,
  computePartitionPressureSummary,
  computeSchedulerFairnessStatus,
  classifyIsolationHealth,
  computeHotspotSummary,
  computeAdvisorySummary,
  classifyHotspotLevel,
  deriveOperationalPriority,
  type TenantGovernanceView,
  type TenantGovernanceViewInput,
} from "../tenant-governance";
import {
  buildTenantIsolationContext,
  assessTenantIsolationRisk,
  TenantIsolationViolation,
} from "../tenant-isolation";
import { evaluateWorkloadContainment } from "../workload-partition";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_TIME = new Date("2026-05-15T14:00:00.000Z");
const WS_ID = 7;

function makeIsoContext(workspaceId = WS_ID) {
  return buildTenantIsolationContext({ workspaceId, evaluationContext: "test" });
}

function makePartition(workspaceId = WS_ID, overrides = {}) {
  return evaluateWorkloadContainment(
    { workspaceId, activeExecutionCount: 0, delayedExecutionCount: 0, ...overrides },
    { evaluationTime: FIXED_TIME },
  );
}

function makeIsolationRisk(workspaceId = WS_ID) {
  return assessTenantIsolationRisk({ context: makeIsoContext(workspaceId) });
}

function makeInput(overrides: Partial<TenantGovernanceViewInput> = {}): TenantGovernanceViewInput {
  return {
    isoContext:   makeIsoContext(),
    partition:    makePartition(),
    isolationRisk: makeIsolationRisk(),
    ...overrides,
  };
}

function buildView(overrides: Partial<TenantGovernanceViewInput> = {}): TenantGovernanceView {
  return buildTenantGovernanceView(makeInput(overrides), { generationTime: FIXED_TIME });
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - tenant overview isolated correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: tenant overview isolated correctly", () => {
  it("view workspaceId matches isoContext workspaceId", () => {
    const view = buildView();
    expect(view.workspaceId).toBe(WS_ID);
  });

  it("tenantBoundaryId derived from isoContext", () => {
    const view = buildView();
    expect(view.tenantBoundaryId).toBe(`ws:${WS_ID}`);
  });

  it("requestScopeId is present and non-empty", () => {
    const view = buildView();
    expect(typeof view.requestScopeId).toBe("string");
    expect(view.requestScopeId.length).toBeGreaterThan(0);
  });

  it("generatedAt matches the supplied generation time", () => {
    const view = buildView();
    expect(view.generatedAt).toBe(FIXED_TIME.toISOString());
  });

  it("different workspaceIds produce different tenantBoundaryIds", () => {
    const view7   = buildTenantGovernanceView({
      isoContext:    buildTenantIsolationContext({ workspaceId: 7 }),
      partition:     makePartition(7),
      isolationRisk: assessTenantIsolationRisk({ context: buildTenantIsolationContext({ workspaceId: 7 }) }),
    }, { generationTime: FIXED_TIME });
    const view42  = buildTenantGovernanceView({
      isoContext:    buildTenantIsolationContext({ workspaceId: 42 }),
      partition:     makePartition(42),
      isolationRisk: assessTenantIsolationRisk({ context: buildTenantIsolationContext({ workspaceId: 42 }) }),
    }, { generationTime: FIXED_TIME });
    expect(view7.tenantBoundaryId).toBe("ws:7");
    expect(view42.tenantBoundaryId).toBe("ws:42");
    expect(view7.tenantBoundaryId).not.toBe(view42.tenantBoundaryId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - partition pressure visibility deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: partition pressure visibility deterministic", () => {
  it("partitionPressure.total matches partition.pressureScore.total", () => {
    const partition = makePartition(WS_ID, { activeExecutionCount: 20 });
    const view = buildTenantGovernanceView(
      { isoContext: makeIsoContext(), partition, isolationRisk: makeIsolationRisk() },
      { generationTime: FIXED_TIME },
    );
    expect(view.partitionPressure.total).toBe(partition.pressureScore.total);
  });

  it("partitionPressure.activeExecutionCount preserved", () => {
    const partition = makePartition(WS_ID, { activeExecutionCount: 15 });
    const summary = computePartitionPressureSummary(partition);
    expect(summary.activeExecutionCount).toBe(15);
  });

  it("partitionPressure.delayedExecutionCount preserved", () => {
    const partition = makePartition(WS_ID, { delayedExecutionCount: 8 });
    const summary = computePartitionPressureSummary(partition);
    expect(summary.delayedExecutionCount).toBe(8);
  });

  it("same partition input always produces same summary", () => {
    const partition = makePartition(WS_ID, { activeExecutionCount: 25, delayedExecutionCount: 10 });
    const s1 = computePartitionPressureSummary(partition);
    const s2 = computePartitionPressureSummary(partition);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });

  it("pressure components are copied (not aliased)", () => {
    const partition = makePartition(WS_ID, { activeExecutionCount: 10 });
    const summary = computePartitionPressureSummary(partition);
    // Mutating the summary's pressureComponents should not affect original
    (summary.pressureComponents as { total: number }).total = 9999;
    expect(partition.pressureScore.total).not.toBe(9999);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - fairness status serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: fairness status serialization stable", () => {
  it("contained partition → fairnessLevel='fair', starvationRisk='none'", () => {
    const partition = makePartition(WS_ID, { activeExecutionCount: 0 });
    const status = computeSchedulerFairnessStatus(partition);
    expect(status.fairnessLevel).toBe("fair");
    expect(status.starvationRisk).toBe("none");
    expect(status.schedulerWeight).toBe(1.0);
  });

  it("pressured partition → fairnessLevel='constrained', starvationRisk='moderate'", () => {
    const partition = makePartition(WS_ID, {
      activeExecutionCount: 50,
      delayedExecutionCount: 15,
    });
    // score = 40+12 = 52 → "high" → "pressured" → weight=0.50
    const status = computeSchedulerFairnessStatus(partition);
    expect(status.fairnessLevel).toBe("constrained");
    expect(status.starvationRisk).toBe("moderate");
    expect(status.schedulerWeight).toBe(0.50);
  });

  it("saturated partition → fairnessLevel='at_minimum', starvationRisk='high'", () => {
    const partition = makePartition(WS_ID, {
      activeExecutionCount:          50,
      delayedExecutionCount:         30,
      hotspotConcentrationRatio:     1.0,
      maxRuntimeWeightedComplexity:  100,
      advisoryLevel:                 "critical",
    });
    const status = computeSchedulerFairnessStatus(partition);
    expect(status.fairnessLevel).toBe("at_minimum");
    expect(status.starvationRisk).toBe("high");
    expect(status.schedulerWeight).toBe(0.25);
  });

  it("noisyBehaviorCodes array is independent from partition's array", () => {
    const partition = makePartition(WS_ID, {
      activeExecutionCount:     80,
      platformActiveExecutions: 100,
    });
    const status = computeSchedulerFairnessStatus(partition);
    // Mutating status.noisyBehaviorCodes should not affect partition
    status.noisyBehaviorCodes.push("ADVISORY_STORM");
    expect(partition.noisyBehaviorCodes).not.toContain("ADVISORY_STORM");
  });

  it("SchedulerFairnessStatus is fully JSON-serializable", () => {
    const status = computeSchedulerFairnessStatus(makePartition());
    expect(() => JSON.stringify(status)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(status));
    expect(parsed.fairnessLevel).toBe(status.fairnessLevel);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - isolation health classification deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: isolation health classification deterministic", () => {
  it("TenantRiskLevel 'low' → IsolationHealthStatus 'healthy'", () => {
    expect(classifyIsolationHealth("low")).toBe("healthy");
  });

  it("TenantRiskLevel 'moderate' → IsolationHealthStatus 'warning'", () => {
    expect(classifyIsolationHealth("moderate")).toBe("warning");
  });

  it("TenantRiskLevel 'high' → IsolationHealthStatus 'elevated'", () => {
    expect(classifyIsolationHealth("high")).toBe("elevated");
  });

  it("TenantRiskLevel 'critical' → IsolationHealthStatus 'critical'", () => {
    expect(classifyIsolationHealth("critical")).toBe("critical");
  });

  it("clean workspace risk assessment yields 'healthy' isolation health", () => {
    const risk = assessTenantIsolationRisk({ context: makeIsoContext() });
    const view = buildView({ isolationRisk: risk });
    expect(view.isolationHealth).toBe("healthy");
  });

  it("isolation health classification is stable across multiple calls", () => {
    for (const level of ["low", "moderate", "high", "critical"] as const) {
      const r1 = classifyIsolationHealth(level);
      const r2 = classifyIsolationHealth(level);
      expect(r1).toBe(r2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - cross-tenant visibility blocked
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: cross-tenant visibility blocked", () => {
  it("throws TenantIsolationViolation when partition.workspaceId ≠ isoContext.workspaceId", () => {
    const isoCtx7   = buildTenantIsolationContext({ workspaceId: 7 });
    const partition9 = makePartition(9); // different workspace
    const risk      = makeIsolationRisk();

    expect(() =>
      buildTenantGovernanceView(
        { isoContext: isoCtx7, partition: partition9, isolationRisk: risk },
        { generationTime: FIXED_TIME },
      ),
    ).toThrow(TenantIsolationViolation);
  });

  it("thrown violation has code CROSS_WORKSPACE_ACCESS", () => {
    const isoCtx7   = buildTenantIsolationContext({ workspaceId: 7 });
    const partition9 = makePartition(9);
    const risk      = makeIsolationRisk();

    try {
      buildTenantGovernanceView(
        { isoContext: isoCtx7, partition: partition9, isolationRisk: risk },
        { generationTime: FIXED_TIME },
      );
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TenantIsolationViolation);
      expect((e as TenantIsolationViolation).code).toBe("CROSS_WORKSPACE_ACCESS");
    }
  });

  it("governance view only contains own workspace data - no cross-workspace fields", () => {
    const view = buildView();
    expect(view.workspaceId).toBe(WS_ID);
    // Verify no other workspace's ID appears in top-level fields
    const serialized = JSON.stringify(view);
    // Should only contain workspace ID 7, not 9 or any other
    expect(serialized).not.toContain('"workspaceId":9');
  });

  it("different workspace IDs produce fully independent views", () => {
    const view7  = buildTenantGovernanceView({
      isoContext:    buildTenantIsolationContext({ workspaceId: 7 }),
      partition:     makePartition(7),
      isolationRisk: assessTenantIsolationRisk({ context: buildTenantIsolationContext({ workspaceId: 7 }) }),
    }, { generationTime: FIXED_TIME });

    const view42 = buildTenantGovernanceView({
      isoContext:    buildTenantIsolationContext({ workspaceId: 42 }),
      partition:     makePartition(42),
      isolationRisk: assessTenantIsolationRisk({ context: buildTenantIsolationContext({ workspaceId: 42 }) }),
    }, { generationTime: FIXED_TIME });

    expect(view7.workspaceId).toBe(7);
    expect(view42.workspaceId).toBe(42);
    expect(view7.tenantBoundaryId).not.toBe(view42.tenantBoundaryId);
    expect(view7.requestScopeId).not.toBe(view42.requestScopeId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - audit serialization stable ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: audit serialization stable ordering", () => {
  it("TenantGovernanceView JSON round-trip preserves all top-level fields", () => {
    const view = buildView();
    const json = JSON.stringify(view);
    const parsed = JSON.parse(json) as TenantGovernanceView;

    expect(parsed.workspaceId).toBe(view.workspaceId);
    expect(parsed.tenantBoundaryId).toBe(view.tenantBoundaryId);
    expect(parsed.isolationHealth).toBe(view.isolationHealth);
    expect(parsed.containmentStatus).toBe(view.containmentStatus);
    expect(parsed.generatedAt).toBe(view.generatedAt);
  });

  it("no undefined values appear in serialized governance view", () => {
    const view = buildView({
      hotspotConcentration:   undefined,
      governanceSignals:      undefined,
      topOperationalPriority: undefined,
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain('"undefined"');
    expect(json).not.toContain('undefined');
  });

  it("same inputs + same time → identical JSON across calls", () => {
    const input = makeInput({ partition: makePartition(WS_ID, { activeExecutionCount: 10 }) });
    const v1 = buildTenantGovernanceView(input, { generationTime: FIXED_TIME });
    const v2 = buildTenantGovernanceView(input, { generationTime: FIXED_TIME });
    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
  });

  it("generatedAt is a valid ISO 8601 string", () => {
    const view = buildView();
    expect(view.generatedAt).toBe(FIXED_TIME.toISOString());
    expect(() => new Date(view.generatedAt)).not.toThrow();
  });

  it("view with all optional fields absent is fully serializable", () => {
    const minimal = buildView();
    expect(() => JSON.stringify(minimal)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(minimal));
    expect(parsed.hotspotSummary.hotspotLevel).toBe("none");
    expect(parsed.advisorySummary.advisoryLevel).toBe("informational");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - hotspot summaries tenant-safe
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: hotspot summaries tenant-safe", () => {
  it("absent hotspot → safe zero defaults, hotspotLevel='none'", () => {
    const summary = computeHotspotSummary(undefined);
    expect(summary.hotspotLevel).toBe("none");
    expect(summary.dominantWorkflowCount).toBe(0);
    expect(summary.concentrationRatio).toBe(0);
    expect(summary.urgentOrCriticalCount).toBe(0);
  });

  it("classifyHotspotLevel: concentration ≥ 0.70 → 'critical'", () => {
    expect(classifyHotspotLevel(0.70, 0)).toBe("critical");
    expect(classifyHotspotLevel(0.90, 0)).toBe("critical");
  });

  it("classifyHotspotLevel: urgentOrCritical ≥ 5 → 'critical' (even with low concentration)", () => {
    expect(classifyHotspotLevel(0.05, 5)).toBe("critical");
  });

  it("classifyHotspotLevel: max of two dimensions is returned", () => {
    // concentration = moderate (0.35), urgency = critical (5+)
    expect(classifyHotspotLevel(0.35, 6)).toBe("critical");
    // concentration = critical (0.80), urgency = none (0)
    expect(classifyHotspotLevel(0.80, 0)).toBe("critical");
  });

  it("hotspot summary preserves all source fields from WorkspaceHotspotConcentration", () => {
    const summary = computeHotspotSummary({
      dominantWorkflowCount:       3,
      concentrationRatio:          0.4,
      urgentOrCriticalCount:       2,
      topRiskScore:                85,
      topRiskWorkflowId:           42,
      chronicHotspotWorkflowCount: 1,
      criticallyDegradingCount:    0,
    });
    expect(summary.dominantWorkflowCount).toBe(3);
    expect(summary.concentrationRatio).toBe(0.4);
    expect(summary.urgentOrCriticalCount).toBe(2);
    expect(summary.topRiskScore).toBe(85);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - advisory summaries isolated correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: advisory summaries isolated correctly", () => {
  it("absent governance signals → informational defaults, zero signals", () => {
    const summary = computeAdvisorySummary(undefined);
    expect(summary.advisoryLevel).toBe("informational");
    expect(summary.advisoryPressureLevel).toBe("none");
    expect(summary.totalSignals).toBe(0);
    expect(summary.criticalSignalCount).toBe(0);
    expect(summary.highSignalCount).toBe(0);
  });

  it("advisory summary maps all GovernanceAdvisoryLevel values to AdvisoryPressureLevel", () => {
    const levels = [
      { input: "informational", expected: "none"     },
      { input: "advisory",      expected: "low"      },
      { input: "elevated",      expected: "medium"   },
      { input: "urgent",        expected: "high"     },
      { input: "critical",      expected: "critical" },
    ] as const;

    for (const { input, expected } of levels) {
      const summary = computeAdvisorySummary({
        workspaceId:    WS_ID,
        advisoryLevel:  input,
        totalSignals:   0,
        signals:        [],
        deduplicatedCount: 0,
        evaluatedAt:    FIXED_TIME.toISOString(),
      });
      expect(summary.advisoryPressureLevel).toBe(expected);
    }
  });

  it("criticalSignalCount and highSignalCount count signal severity correctly", () => {
    const summary = computeAdvisorySummary({
      workspaceId:    WS_ID,
      advisoryLevel:  "critical",
      totalSignals:   5,
      deduplicatedCount: 5,
      evaluatedAt:    FIXED_TIME.toISOString(),
      signals: [
        { severity: "critical" } as never,
        { severity: "critical" } as never,
        { severity: "high"     } as never,
        { severity: "medium"   } as never,
        { severity: "low"      } as never,
      ],
    });
    expect(summary.criticalSignalCount).toBe(2);
    expect(summary.highSignalCount).toBe(1);
    expect(summary.totalSignals).toBe(5);
  });

  it("governance view embeds advisory summary with correct advisory level", () => {
    const view = buildView({
      governanceSignals: {
        workspaceId:       WS_ID,
        advisoryLevel:     "urgent",
        totalSignals:      3,
        deduplicatedCount: 3,
        evaluatedAt:       FIXED_TIME.toISOString(),
        signals:           [],
      },
    });
    expect(view.advisorySummary.advisoryLevel).toBe("urgent");
    expect(view.advisorySummary.advisoryPressureLevel).toBe("high");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - scope ambiguity fails closed
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: scope ambiguity fails closed", () => {
  it("partition workspaceId 0 mismatch throws CROSS_WORKSPACE_ACCESS", () => {
    const isoCtx  = buildTenantIsolationContext({ workspaceId: 7 });
    // Build a partition with a different workspaceId by coercing
    const partition99 = makePartition(99);
    expect(() =>
      buildTenantGovernanceView(
        { isoContext: isoCtx, partition: partition99, isolationRisk: makeIsolationRisk() },
        { generationTime: FIXED_TIME },
      ),
    ).toThrow(TenantIsolationViolation);
  });

  it("TenantIsolationViolation from scope check is instanceof Error", () => {
    const isoCtx  = buildTenantIsolationContext({ workspaceId: 1 });
    const partition2 = makePartition(2);
    try {
      buildTenantGovernanceView(
        { isoContext: isoCtx, partition: partition2, isolationRisk: makeIsolationRisk(1) },
        { generationTime: FIXED_TIME },
      );
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(TenantIsolationViolation);
    }
  });

  it("deriveOperationalPriority falls back to 'informational' with no inputs", () => {
    expect(deriveOperationalPriority()).toBe("informational");
  });

  it("explicit topOperationalPriority always wins over inferred values", () => {
    const explicit = deriveOperationalPriority(
      { dominantWorkflowCount: 10, concentrationRatio: 0.9,
        urgentOrCriticalCount: 5, topRiskScore: 100, topRiskWorkflowId: 1,
        chronicHotspotWorkflowCount: 3, criticallyDegradingCount: 2 },
      "watch", // explicit = "watch" beats hotspot which would give "critical"
    );
    expect(explicit).toBe("watch");
  });

  it("classifyIsolationHealth is total (no unhandled value)", () => {
    // All 4 risk levels are handled
    const results = (["low", "moderate", "high", "critical"] as const).map(classifyIsolationHealth);
    expect(results).toEqual(["healthy", "warning", "elevated", "critical"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - governance APIs remain read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: governance APIs remain read-only", () => {
  it("buildTenantGovernanceView does not mutate the input object", () => {
    const input = makeInput({
      partition: makePartition(WS_ID, { activeExecutionCount: 15 }),
    });
    const snapshot = JSON.stringify(input);
    buildTenantGovernanceView(input, { generationTime: FIXED_TIME });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("governance view result contains no async capabilities", () => {
    const view = buildView();
    expect(typeof (view as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("computeAdvisorySummary does not mutate the input signals array", () => {
    const signals = [{ severity: "critical" }, { severity: "high" }] as never[];
    const result = {
      workspaceId: WS_ID, advisoryLevel: "critical" as const,
      totalSignals: 2, deduplicatedCount: 2,
      evaluatedAt: FIXED_TIME.toISOString(), signals,
    };
    const before = signals.length;
    computeAdvisorySummary(result);
    expect(signals.length).toBe(before);
  });

  it("computeHotspotSummary does not mutate the input hotspot object", () => {
    const hotspot = {
      dominantWorkflowCount: 2, concentrationRatio: 0.5,
      urgentOrCriticalCount: 1, topRiskScore: 75,
      topRiskWorkflowId: 10, chronicHotspotWorkflowCount: 0,
      criticallyDegradingCount: 0,
    };
    const ratioBefore = hotspot.concentrationRatio;
    computeHotspotSummary(hotspot);
    expect(hotspot.concentrationRatio).toBe(ratioBefore);
  });

  it("full governance view is JSON-serializable with no class instances", () => {
    const view = buildView({
      hotspotConcentration: {
        dominantWorkflowCount: 2, concentrationRatio: 0.4,
        urgentOrCriticalCount: 1, topRiskScore: 72,
        topRiskWorkflowId: 5, chronicHotspotWorkflowCount: 0,
        criticallyDegradingCount: 0,
      },
      governanceSignals: {
        workspaceId: WS_ID, advisoryLevel: "elevated",
        totalSignals: 3, deduplicatedCount: 3,
        evaluatedAt: FIXED_TIME.toISOString(),
        signals: [],
      },
    });
    expect(() => JSON.stringify(view)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(view));
    expect(parsed.hotspotSummary.hotspotLevel).toBeDefined();
    expect(parsed.advisorySummary.totalSignals).toBe(3);
  });
});
