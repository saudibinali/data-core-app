/**
 * @file   __tests__/workload-partition.test.ts
 * @phase  P9-B - Workload Partitioning & Execution Containment Foundations
 *
 * T1  - partition pressure scoring deterministic
 * T2  - noisy tenant detection stable
 * T3  - scheduler fairness semantics valid
 * T4  - high execution pressure classified correctly
 * T5  - chronic backlog tenant detection
 * T6  - advisory concentration scoring stable
 * T7  - partition serialization deterministic
 * T8  - no tenant starvation semantics
 * T9  - no runtime throttling occurs
 * T10 - partition engine remains read-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateWorkloadContainment,
  computePartitionPressureScore,
  classifyExecutionPressure,
  computeContainmentStatus,
  computeSchedulerWeight,
  classifyAdvisoryPressure,
  detectNoisyBehavior,
  makePartitionId,
  type TenantWorkloadPartition,
  type WorkloadContainmentInput,
} from "../workload-partition";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_TIME = new Date("2026-05-15T12:00:00.000Z");

function makeInput(overrides: Partial<WorkloadContainmentInput> = {}): WorkloadContainmentInput {
  return {
    workspaceId:          7,
    activeExecutionCount:  0,
    delayedExecutionCount: 0,
    ...overrides,
  };
}

function evaluate(overrides: Partial<WorkloadContainmentInput> = {}): TenantWorkloadPartition {
  return evaluateWorkloadContainment(makeInput(overrides), { evaluationTime: FIXED_TIME });
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - partition pressure scoring deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: partition pressure scoring deterministic", () => {
  it("zero input yields zero total pressure score", () => {
    const score = computePartitionPressureScore({
      active:  0,
      delayed: 0,
    });
    expect(score.total).toBe(0);
    expect(score.activeExecutionScore).toBe(0);
    expect(score.delayedBacklogScore).toBe(0);
    expect(score.hotspotDensityScore).toBe(0);
    expect(score.complexityScore).toBe(0);
    expect(score.advisoryScore).toBe(0);
  });

  it("active execution score saturates at 40 for very high active count", () => {
    const score = computePartitionPressureScore({ active: 100, delayed: 0 });
    expect(score.activeExecutionScore).toBe(40);
  });

  it("delayed backlog score saturates at 25 for very high delayed count", () => {
    const score = computePartitionPressureScore({ active: 0, delayed: 100 });
    expect(score.delayedBacklogScore).toBe(25);
  });

  it("hotspot density score = floor(concentrationRatio × 20)", () => {
    const score50 = computePartitionPressureScore({ active: 0, delayed: 0, hotspotConcentrationRatio: 0.5 });
    expect(score50.hotspotDensityScore).toBe(10);

    const score100 = computePartitionPressureScore({ active: 0, delayed: 0, hotspotConcentrationRatio: 1.0 });
    expect(score100.hotspotDensityScore).toBe(20);
  });

  it("advisory score maps correctly to each advisory level", () => {
    const none    = computePartitionPressureScore({ active: 0, delayed: 0, advisoryLevel: "informational" });
    const low     = computePartitionPressureScore({ active: 0, delayed: 0, advisoryLevel: "advisory" });
    const medium  = computePartitionPressureScore({ active: 0, delayed: 0, advisoryLevel: "elevated" });
    const high    = computePartitionPressureScore({ active: 0, delayed: 0, advisoryLevel: "urgent" });
    const crit    = computePartitionPressureScore({ active: 0, delayed: 0, advisoryLevel: "critical" });

    expect(none.advisoryScore).toBe(1);
    expect(low.advisoryScore).toBe(2);
    expect(medium.advisoryScore).toBe(3);
    expect(high.advisoryScore).toBe(4);
    expect(crit.advisoryScore).toBe(5);
  });

  it("total score is clamped to maximum 100", () => {
    const score = computePartitionPressureScore({
      active:  1000,
      delayed: 1000,
      hotspotConcentrationRatio:    1.0,
      maxRuntimeWeightedComplexity: 100,
      advisoryLevel:                "critical",
    });
    expect(score.total).toBe(100);
  });

  it("same inputs always produce same score", () => {
    const a = computePartitionPressureScore({ active: 15, delayed: 8, hotspotConcentrationRatio: 0.3 });
    const b = computePartitionPressureScore({ active: 15, delayed: 8, hotspotConcentrationRatio: 0.3 });
    expect(a.total).toBe(b.total);
    expect(a.activeExecutionScore).toBe(b.activeExecutionScore);
    expect(a.delayedBacklogScore).toBe(b.delayedBacklogScore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - noisy tenant detection stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: noisy tenant detection stable", () => {
  it("no noisy behavior for clean low-pressure workspace", () => {
    const result = detectNoisyBehavior({
      workspaceId: 7,
      active:      2,
      delayed:     0,
      batchSize:   10,
    });
    expect(result.detected).toBe(false);
    expect(result.codes).toHaveLength(0);
    expect(result.reasons).toHaveLength(0);
  });

  it("EXECUTION_MONOPOLY detected when tenant holds >50% of platform active", () => {
    const result = detectNoisyBehavior({
      workspaceId:              7,
      active:                   60,
      delayed:                  0,
      batchSize:                10,
      platformActiveExecutions: 100,
    });
    expect(result.detected).toBe(true);
    expect(result.codes).toContain("EXECUTION_MONOPOLY");
    expect(result.reasons[0]).toContain("60%");
  });

  it("EXECUTION_MONOPOLY not triggered when platform count is absent", () => {
    const result = detectNoisyBehavior({
      workspaceId: 7,
      active:      9999,
      delayed:     0,
      batchSize:   10,
      // platformActiveExecutions absent
    });
    expect(result.codes).not.toContain("EXECUTION_MONOPOLY");
  });

  it("ADVISORY_STORM detected when 11+ signals with urgent advisory", () => {
    const result = detectNoisyBehavior({
      workspaceId:        7,
      active:             0,
      delayed:            0,
      batchSize:          10,
      totalActiveSignals: 15,
      advisoryLevel:      "urgent",
    });
    expect(result.detected).toBe(true);
    expect(result.codes).toContain("ADVISORY_STORM");
  });

  it("ADVISORY_STORM not triggered with high signal count but low advisory", () => {
    const result = detectNoisyBehavior({
      workspaceId:        7,
      active:             0,
      delayed:            0,
      batchSize:          10,
      totalActiveSignals: 20,
      advisoryLevel:      "advisory", // low advisory
    });
    expect(result.codes).not.toContain("ADVISORY_STORM");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - scheduler fairness semantics valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: scheduler fairness semantics valid", () => {
  it("schedulerWeight is 1.0 for contained workspace", () => {
    expect(computeSchedulerWeight("contained")).toBe(1.00);
  });

  it("schedulerWeight is 0.75 for at_risk workspace", () => {
    expect(computeSchedulerWeight("at_risk")).toBe(0.75);
  });

  it("schedulerWeight is 0.50 for pressured workspace", () => {
    expect(computeSchedulerWeight("pressured")).toBe(0.50);
  });

  it("schedulerWeight is 0.25 for saturated workspace - never zero", () => {
    expect(computeSchedulerWeight("saturated")).toBe(0.25);
    expect(computeSchedulerWeight("saturated")).toBeGreaterThan(0);
  });

  it("classifyAdvisoryPressure maps all governance advisory levels correctly", () => {
    expect(classifyAdvisoryPressure("informational")).toBe("none");
    expect(classifyAdvisoryPressure("advisory")).toBe("low");
    expect(classifyAdvisoryPressure("elevated")).toBe("medium");
    expect(classifyAdvisoryPressure("urgent")).toBe("high");
    expect(classifyAdvisoryPressure("critical")).toBe("critical");
    expect(classifyAdvisoryPressure(undefined)).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - high execution pressure classified correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: high execution pressure classified correctly", () => {
  it("classifyExecutionPressure returns normal for score 0-25", () => {
    expect(classifyExecutionPressure(0)).toBe("normal");
    expect(classifyExecutionPressure(25)).toBe("normal");
  });

  it("classifyExecutionPressure returns elevated for score 26-50", () => {
    expect(classifyExecutionPressure(26)).toBe("elevated");
    expect(classifyExecutionPressure(50)).toBe("elevated");
  });

  it("classifyExecutionPressure returns high for score 51-75", () => {
    expect(classifyExecutionPressure(51)).toBe("high");
    expect(classifyExecutionPressure(75)).toBe("high");
  });

  it("classifyExecutionPressure returns critical for score 76-100", () => {
    expect(classifyExecutionPressure(76)).toBe("critical");
    expect(classifyExecutionPressure(100)).toBe("critical");
  });

  it("very high active count + backlog produces high or critical pressure", () => {
    // active=50 → 40, delayed=15 → floor(15/30 × 25)=12; total=52 → "high"
    const partition = evaluate({ activeExecutionCount: 50, delayedExecutionCount: 15 });
    expect(["high", "critical"]).toContain(partition.executionPressureLevel);
    expect(["pressured", "saturated"]).toContain(partition.containmentStatus);
  });

  it("combined active+delayed+hotspot pressure reaches maximum 100", () => {
    // active=50 → 40, delayed=30 → 25, hotspot=1.0 → 20, maxRWC=100 → 10, critical → 5
    // total = 40+25+20+10+5 = 100
    const partition = evaluate({
      activeExecutionCount:          50,
      delayedExecutionCount:         30,
      hotspotConcentrationRatio:     1.0,
      maxRuntimeWeightedComplexity:  100,
      advisoryLevel:                 "critical",
    });
    expect(partition.executionPressureLevel).toBe("critical");
    expect(partition.containmentStatus).toBe("saturated");
    expect(partition.pressureScore.total).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - chronic backlog tenant detection
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: chronic backlog tenant detection", () => {
  it("SCHEDULER_BACKLOG_FLOOD detected when delayed > batchSize × 5", () => {
    const result = detectNoisyBehavior({
      workspaceId:   7,
      active:        0,
      delayed:       55,  // > 10 × 5 = 50
      batchSize:     10,
    });
    expect(result.detected).toBe(true);
    expect(result.codes).toContain("SCHEDULER_BACKLOG_FLOOD");
    expect(result.reasons[0]).toContain("55 delayed");
  });

  it("SCHEDULER_BACKLOG_FLOOD not triggered at exactly the threshold", () => {
    const result = detectNoisyBehavior({
      workspaceId:   7,
      active:        0,
      delayed:       50,  // = 10 × 5 exactly, NOT above
      batchSize:     10,
    });
    expect(result.codes).not.toContain("SCHEDULER_BACKLOG_FLOOD");
  });

  it("CHRONIC_HOTSPOT_FLOOD detected when ≥3 urgent/critical + concentration >50%", () => {
    const result = detectNoisyBehavior({
      workspaceId:                    7,
      active:                         0,
      delayed:                        0,
      batchSize:                      10,
      urgentOrCriticalWorkflowCount:  4,
      hotspotConcentrationRatio:      0.65,
    });
    expect(result.detected).toBe(true);
    expect(result.codes).toContain("CHRONIC_HOTSPOT_FLOOD");
    expect(result.reasons.some(r => r.includes("4 workflows"))).toBe(true);
  });

  it("CHRONIC_HOTSPOT_FLOOD not triggered with 3+ urgent/critical but low concentration", () => {
    const result = detectNoisyBehavior({
      workspaceId:                    7,
      active:                         0,
      delayed:                        0,
      batchSize:                      10,
      urgentOrCriticalWorkflowCount:  5,
      hotspotConcentrationRatio:      0.3,  // below 50%
    });
    expect(result.codes).not.toContain("CHRONIC_HOTSPOT_FLOOD");
  });

  it("backlog pressure contributes to elevated delayedBacklogScore", () => {
    const score = computePartitionPressureScore({
      active:  0,
      delayed: 30, // saturates delayed score
    });
    expect(score.delayedBacklogScore).toBe(25);
    expect(score.total).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - advisory concentration scoring stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: advisory concentration scoring stable", () => {
  it("hotspot concentration ratio = 1.0 maximizes hotspotDensityScore at 20", () => {
    const score = computePartitionPressureScore({
      active:                    0,
      delayed:                   0,
      hotspotConcentrationRatio: 1.0,
    });
    expect(score.hotspotDensityScore).toBe(20);
  });

  it("hotspot concentration ratio = 0.25 → hotspotDensityScore = 5", () => {
    const score = computePartitionPressureScore({
      active:                    0,
      delayed:                   0,
      hotspotConcentrationRatio: 0.25,
    });
    expect(score.hotspotDensityScore).toBe(5);
  });

  it("concentration ratio clamped to 0-1 range", () => {
    const over = computePartitionPressureScore({ active: 0, delayed: 0, hotspotConcentrationRatio: 2.0 });
    const neg  = computePartitionPressureScore({ active: 0, delayed: 0, hotspotConcentrationRatio: -0.5 });
    expect(over.hotspotDensityScore).toBe(20); // clamped to 1.0
    expect(neg.hotspotDensityScore).toBe(0);   // clamped to 0
  });

  it("complexity score = floor(maxRWC / 100 × 10)", () => {
    const score80  = computePartitionPressureScore({ active: 0, delayed: 0, maxRuntimeWeightedComplexity: 80 });
    const score50  = computePartitionPressureScore({ active: 0, delayed: 0, maxRuntimeWeightedComplexity: 50 });
    const score100 = computePartitionPressureScore({ active: 0, delayed: 0, maxRuntimeWeightedComplexity: 100 });
    expect(score80.complexityScore).toBe(8);
    expect(score50.complexityScore).toBe(5);
    expect(score100.complexityScore).toBe(10);
  });

  it("full governance advisory = critical adds 5 to pressure score", () => {
    const withAdvisory    = computePartitionPressureScore({ active: 0, delayed: 0, advisoryLevel: "critical" });
    const withoutAdvisory = computePartitionPressureScore({ active: 0, delayed: 0 });
    expect(withAdvisory.total - withoutAdvisory.total).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - partition serialization deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: partition serialization deterministic", () => {
  it("evaluateWorkloadContainment output is JSON round-trip safe", () => {
    const partition = evaluate({
      activeExecutionCount:  10,
      delayedExecutionCount: 5,
      advisoryLevel:         "elevated",
    });
    const json   = JSON.stringify(partition);
    const parsed = JSON.parse(json) as TenantWorkloadPartition;
    expect(parsed.workspaceId).toBe(partition.workspaceId);
    expect(parsed.partitionId).toBe(partition.partitionId);
    expect(parsed.executionPressureLevel).toBe(partition.executionPressureLevel);
    expect(parsed.pressureScore.total).toBe(partition.pressureScore.total);
  });

  it("partition result contains no undefined values", () => {
    const partition = evaluate({ activeExecutionCount: 20, advisoryLevel: "urgent" });
    const json      = JSON.stringify(partition);
    expect(json).not.toContain('"undefined"');
    expect(json).not.toContain('undefined');
  });

  it("evaluatedAt is a valid ISO 8601 string", () => {
    const partition = evaluate();
    expect(partition.evaluatedAt).toBe(FIXED_TIME.toISOString());
  });

  it("partitionId format is 'part:<workspaceId>'", () => {
    for (const wsId of [1, 7, 99]) {
      expect(makePartitionId(wsId)).toBe(`part:${wsId}`);
      const p = evaluateWorkloadContainment(
        makeInput({ workspaceId: wsId }),
        { evaluationTime: FIXED_TIME },
      );
      expect(p.partitionId).toBe(`part:${wsId}`);
    }
  });

  it("two calls with same input + time yield identical JSON", () => {
    const input = makeInput({
      activeExecutionCount:  12,
      delayedExecutionCount: 3,
      advisoryLevel:         "elevated",
      hotspotConcentrationRatio: 0.4,
    });
    const p1 = evaluateWorkloadContainment(input, { evaluationTime: FIXED_TIME });
    const p2 = evaluateWorkloadContainment(input, { evaluationTime: FIXED_TIME });
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - no tenant starvation semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: no tenant starvation semantics", () => {
  it("schedulerWeight is never zero regardless of pressure", () => {
    const extremePartition = evaluate({
      activeExecutionCount:          100,
      delayedExecutionCount:         200,
      hotspotConcentrationRatio:     1.0,
      maxRuntimeWeightedComplexity:  100,
      advisoryLevel:                 "critical",
    });
    expect(extremePartition.schedulerWeight).toBeGreaterThan(0);
    expect(extremePartition.schedulerWeight).toBe(0.25); // minimum guaranteed
  });

  it("minimum scheduler weight is 0.25 (no starvation floor)", () => {
    // No matter how many noisy behaviors are detected
    const result = detectNoisyBehavior({
      workspaceId:              7,
      active:                   80,
      delayed:                  200,
      batchSize:                10,
      platformActiveExecutions: 100,
      totalActiveSignals:       50,
      advisoryLevel:            "critical",
      urgentOrCriticalWorkflowCount: 10,
      hotspotConcentrationRatio:     0.9,
    });
    expect(result.detected).toBe(true);
    // Even if noisy, schedulerWeight from the containment engine stays at 0.25
    const weight = computeSchedulerWeight(computeContainmentStatus(classifyExecutionPressure(100)));
    expect(weight).toBe(0.25);
    expect(weight).toBeGreaterThan(0);
  });

  it("noisy tenant detected does not cause schedulerWeight below 0.25", () => {
    const partition = evaluate({
      workspaceId:              7,
      activeExecutionCount:     80,
      delayedExecutionCount:    300,
      platformActiveExecutions: 100,
      totalActiveSignals:       50,
      advisoryLevel:            "critical",
    });
    expect(partition.schedulerWeight).toBeGreaterThanOrEqual(0.25);
    expect(partition.noisyBehaviorDetected).toBe(true);
  });

  it("clean workspace always gets weight 1.0", () => {
    const clean = evaluate({
      activeExecutionCount:  0,
      delayedExecutionCount: 0,
    });
    expect(clean.schedulerWeight).toBe(1.0);
    expect(clean.containmentStatus).toBe("contained");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - no runtime throttling occurs
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: no runtime throttling occurs", () => {
  it("evaluateWorkloadContainment returns advisory result, not a control signal", () => {
    const partition = evaluate({
      activeExecutionCount:  50,
      advisoryLevel:         "critical",
    });
    // Result is a TenantWorkloadPartition (pure data) - no actionable control
    expect(typeof partition).toBe("object");
    expect(partition.containmentStatus).toBeDefined();
    // No properties that would indicate execution blocking
    const keys = Object.keys(partition);
    expect(keys).not.toContain("blocked");
    expect(keys).not.toContain("throttled");
    expect(keys).not.toContain("paused");
    expect(keys).not.toContain("rejected");
  });

  it("detection of EXECUTION_MONOPOLY does NOT change execution counts", () => {
    const inputBefore = makeInput({
      activeExecutionCount:     80,
      platformActiveExecutions: 100,
    });
    const activeCountBefore = inputBefore.activeExecutionCount;
    evaluateWorkloadContainment(inputBefore, { evaluationTime: FIXED_TIME });
    // Input is unchanged after evaluation
    expect(inputBefore.activeExecutionCount).toBe(activeCountBefore);
  });

  it("critical pressure + noisy behavior only affects advisory output - never DB state", () => {
    // evaluateWorkloadContainment is pure - no observable side effects
    // Call it 5 times with extreme input and verify idempotent advisory output
    const input = makeInput({
      activeExecutionCount:      100,
      delayedExecutionCount:     100,
      platformActiveExecutions:  100,
      advisoryLevel:             "critical",
      totalActiveSignals:        50,
    });
    const results = Array.from({ length: 5 }, () =>
      evaluateWorkloadContainment(input, { evaluationTime: FIXED_TIME }),
    );
    // All results should be identical
    for (const r of results) {
      expect(r.executionPressureLevel).toBe(results[0]!.executionPressureLevel);
      expect(r.schedulerWeight).toBe(results[0]!.schedulerWeight);
    }
  });

  it("partition engine result has no async capabilities (no Promise, no callback)", () => {
    const partition = evaluate({ activeExecutionCount: 10 });
    // Plain object check - no then(), no catch(), no Symbol.iterator override
    expect(typeof (partition as unknown as { then?: unknown }).then).not.toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - partition engine remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: partition engine remains read-only", () => {
  it("input object is not mutated by evaluateWorkloadContainment", () => {
    const input = makeInput({
      activeExecutionCount:          20,
      delayedExecutionCount:         8,
      hotspotConcentrationRatio:     0.4,
      maxRuntimeWeightedComplexity:  60,
      advisoryLevel:                 "elevated",
    });
    const snapshot = JSON.stringify(input);
    evaluateWorkloadContainment(input, { evaluationTime: FIXED_TIME });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("output pressure score components sum ≤ total (no phantom contribution)", () => {
    const input  = makeInput({ activeExecutionCount: 15, delayedExecutionCount: 10 });
    const result = evaluateWorkloadContainment(input, { evaluationTime: FIXED_TIME });
    const { activeExecutionScore, delayedBacklogScore, hotspotDensityScore,
            complexityScore, advisoryScore, total } = result.pressureScore;
    const componentSum = activeExecutionScore + delayedBacklogScore +
                         hotspotDensityScore + complexityScore + advisoryScore;
    // total = min(componentSum, 100)
    expect(total).toBe(Math.min(componentSum, 100));
  });

  it("noisyBehaviorReasons array is independent between calls", () => {
    const input = makeInput({ activeExecutionCount: 80, platformActiveExecutions: 100 });
    const r1 = evaluateWorkloadContainment(input, { evaluationTime: FIXED_TIME });
    const r2 = evaluateWorkloadContainment(input, { evaluationTime: FIXED_TIME });
    // Mutating r1 doesn't affect r2
    r1.noisyBehaviorReasons.push("injected reason");
    expect(r2.noisyBehaviorReasons).not.toContain("injected reason");
  });

  it("negative execution counts are sanitized to zero - no NaN propagation", () => {
    const partition = evaluateWorkloadContainment(
      { workspaceId: 7, activeExecutionCount: -5, delayedExecutionCount: -10 },
      { evaluationTime: FIXED_TIME },
    );
    expect(partition.activeExecutionCount).toBe(0);
    expect(partition.delayedExecutionCount).toBe(0);
    expect(Number.isNaN(partition.pressureScore.total)).toBe(false);
    expect(partition.pressureScore.total).toBe(0);
  });

  it("result is plain JSON-serializable - no class instances or circular refs", () => {
    const partition = evaluate({
      activeExecutionCount:  30,
      delayedExecutionCount: 15,
      advisoryLevel:         "urgent",
      platformActiveExecutions: 100,
    });
    // Should not throw
    expect(() => JSON.stringify(partition)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(partition)) as TenantWorkloadPartition;
    expect(parsed.partitionId).toBe(partition.partitionId);
    expect(parsed.noisyBehaviorCodes).toEqual(partition.noisyBehaviorCodes);
  });
});
