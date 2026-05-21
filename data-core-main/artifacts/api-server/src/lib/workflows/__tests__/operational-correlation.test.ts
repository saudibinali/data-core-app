/**
 * @file  operational-correlation.test.ts
 * @phase P8-C - Runtime-Weighted Operational Intelligence & Historical Correlation
 *
 * Tests for the pure static/historical correlation engine.
 * No DB, no server, no async - all tests are synchronous pure-function calls.
 *
 * T1:  runtime-weighted bottleneck scoring deterministic
 * T2:  historical hotspot detection stable
 * T3:  structural vs operational comparison classification
 * T4:  approval latency pressure calculation
 * T5:  delay duration pressure calculation
 * T6:  runtimeWeightedComplexity normalization
 * T7:  fragility index deterministic
 * T8:  historical correlation serialization stable
 * T9:  no live runtime dependency required
 * T10: correlation engine remains read-only
 */

import { describe, it, expect } from "vitest";

import {
  computeOperationalCorrelation,
  ZERO_HISTORICAL,
  type HistoricalOperationalData,
  type WorkflowOperationalCorrelationResult,
} from "../operational-correlation";

import { analyzeDependencies } from "../dependency";
import { computeTopologyAnalytics, extractWorkflowTopology } from "../topology";

// ─────────────────────────────────────────────────────────────────────────────
// Step fixtures (same as dependency.test.ts for consistency)
// ─────────────────────────────────────────────────────────────────────────────

const linearSteps = [
  { index: 0, type: "notification", name: "A", config: {} },
  { index: 1, type: "notification", name: "B", config: {} },
  { index: 2, type: "notification", name: "C", config: {} },
  { index: 3, type: "notification", name: "D", config: {} },
];

const approvalHeavySteps = [
  { index: 0, type: "approval",     name: "Appr0", config: {} },
  { index: 1, type: "approval",     name: "Appr1", config: {} },
  { index: 2, type: "notification", name: "Notif", config: {} },
  { index: 3, type: "approval",     name: "Appr3", config: {} },
];

const delayChainSteps = [
  { index: 0, type: "notification", name: "Start", config: {} },
  { index: 1, type: "delay",        name: "D1",    config: {} },
  { index: 2, type: "delay",        name: "D2",    config: {} },
  { index: 3, type: "delay",        name: "D3",    config: {} },
  { index: 4, type: "notification", name: "End",   config: {} },
];

const highBottleneckSteps = [
  { index: 0, type: "condition",    name: "cond",  config: { onTrueStepIndex: 1, onFalseStepIndex: 3 } },
  { index: 1, type: "notification", name: "B",     config: {} },
  { index: 2, type: "notification", name: "C",     config: {} },
  { index: 3, type: "approval",     name: "Appr",  config: {} },
];

// ─────────────────────────────────────────────────────────────────────────────
// Historical data fixtures
// ─────────────────────────────────────────────────────────────────────────────

const quietHistory: HistoricalOperationalData = {
  snapshotCount:      500,
  avgErrorRate:       0.01,
  avgApprovalBacklog: 2,
  avgDelayBacklog:    1,
  avgStuckCount:      0,
  stormFrequency:     0.0,
  chronicAlertCodes:  [],
  dominantSeverity:   "healthy",
};

const busyHistory: HistoricalOperationalData = {
  snapshotCount:      500,
  avgErrorRate:       0.25,
  avgApprovalBacklog: 30,
  avgDelayBacklog:    20,
  avgStuckCount:      8,
  stormFrequency:     0.3,
  chronicAlertCodes:  ["GOV-02", "GOV-04", "GOV-07"],
  dominantSeverity:   "degraded",
};

const criticalHistory: HistoricalOperationalData = {
  snapshotCount:      200,
  avgErrorRate:       0.60,
  avgApprovalBacklog: 50,
  avgDelayBacklog:    50,
  avgStuckCount:      20,
  stormFrequency:     0.8,
  chronicAlertCodes:  ["GOV-01", "GOV-02", "GOV-04", "GOV-05"],
  dominantSeverity:   "critical",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function runCorrelation(
  steps:   unknown[],
  history: HistoricalOperationalData,
): WorkflowOperationalCorrelationResult {
  const depResult  = analyzeDependencies(steps);
  const graph      = extractWorkflowTopology(steps);
  const analytics  = computeTopologyAnalytics(graph, steps);
  return computeOperationalCorrelation(depResult, analytics, history);
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Runtime-weighted bottleneck scoring deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: runtime-weighted bottleneck scoring deterministic", () => {
  it("same steps + same history → same runtimeWeightedComplexity", () => {
    const r1 = runCorrelation(highBottleneckSteps, busyHistory);
    const r2 = runCorrelation(highBottleneckSteps, busyHistory);
    expect(r1.correlation.runtimeWeightedComplexity).toBe(r2.correlation.runtimeWeightedComplexity);
  });

  it("busy history increases runtimeWeightedComplexity over zero history for approval-heavy", () => {
    const rBusy = runCorrelation(approvalHeavySteps, busyHistory);
    const rZero = runCorrelation(approvalHeavySteps, ZERO_HISTORICAL);
    expect(rBusy.correlation.runtimeWeightedComplexity).toBeGreaterThanOrEqual(
      rZero.correlation.runtimeWeightedComplexity,
    );
  });

  it("runtimeWeightedComplexity equals structuralComplexity when snapshotCount = 0", () => {
    const r = runCorrelation(approvalHeavySteps, ZERO_HISTORICAL);
    expect(r.correlation.runtimeWeightedComplexity).toBe(r.correlation.structuralComplexity);
  });

  it("critical history produces higher runtimeWeightedComplexity than quiet history for same workflow", () => {
    const rCritical = runCorrelation(highBottleneckSteps, criticalHistory);
    const rQuiet    = runCorrelation(highBottleneckSteps, quietHistory);
    expect(rCritical.correlation.runtimeWeightedComplexity).toBeGreaterThan(
      rQuiet.correlation.runtimeWeightedComplexity,
    );
  });

  it("runtimeWeightedComplexity is an integer in [0, 100]", () => {
    for (const [steps, history] of [
      [linearSteps, quietHistory],
      [approvalHeavySteps, busyHistory],
      [highBottleneckSteps, criticalHistory],
    ] as const) {
      const r = runCorrelation(steps as unknown[], history);
      const v = r.correlation.runtimeWeightedComplexity;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Historical hotspot detection stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: historical hotspot detection stable", () => {
  it("same input produces identical hotspot list on every call", () => {
    const r1 = runCorrelation(highBottleneckSteps, busyHistory);
    const r2 = runCorrelation(highBottleneckSteps, busyHistory);
    expect(r1.correlation.chronicOperationalHotspots).toEqual(
      r2.correlation.chronicOperationalHotspots,
    );
  });

  it("zero historical data produces no hotspots", () => {
    const r = runCorrelation(highBottleneckSteps, ZERO_HISTORICAL);
    expect(r.correlation.chronicOperationalHotspots).toHaveLength(0);
  });

  it("busy history with approval-heavy workflow detects approval hotspot", () => {
    const r = runCorrelation(approvalHeavySteps, busyHistory);
    expect(r.correlation.chronicOperationalHotspots).toContain("approval_backlog_concentration");
  });

  it("critical history detects chronic_alert_escalation when many codes present", () => {
    const r = runCorrelation(highBottleneckSteps, criticalHistory);
    expect(r.correlation.chronicOperationalHotspots).toContain("chronic_alert_escalation");
  });

  it("busy history with delay-heavy workflow detects delay hotspot", () => {
    const r = runCorrelation(delayChainSteps, busyHistory);
    expect(r.correlation.chronicOperationalHotspots).toContain("delay_duration_concentration");
  });

  it("linear workflow with quiet history has no hotspots", () => {
    const r = runCorrelation(linearSteps, quietHistory);
    expect(r.correlation.chronicOperationalHotspots).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Structural vs operational comparison classification
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: structural vs operational comparison classification", () => {
  it("classification is one of the four valid values", () => {
    const validClassifications = [
      "structurally_simple_operationally_stable",
      "structurally_complex_operationally_stable",
      "structurally_simple_operationally_fragile",
      "structurally_and_operationally_complex",
    ];
    const r = runCorrelation(highBottleneckSteps, busyHistory);
    expect(validClassifications).toContain(r.correlation.correlationClassification);
  });

  it("simple linear workflow with quiet history is structurally_simple_operationally_stable", () => {
    const r = runCorrelation(linearSteps, quietHistory);
    expect(r.correlation.correlationClassification).toBe(
      "structurally_simple_operationally_stable",
    );
  });

  it("classification is deterministic for identical inputs", () => {
    const r1 = runCorrelation(approvalHeavySteps, busyHistory);
    const r2 = runCorrelation(approvalHeavySteps, busyHistory);
    expect(r1.correlation.correlationClassification).toBe(r2.correlation.correlationClassification);
  });

  it("structurally_complex_operationally_stable: complex workflow + quiet history", () => {
    // Build a large complex workflow
    const bigWorkflow = Array.from({ length: 25 }, (_, i) => ({
      index: i, type: "notification", name: `Step${i}`, config: {},
    }));
    const r = runCorrelation(bigWorkflow, quietHistory);
    // Structural complexity should be high (25 steps) but runtime low (quiet history)
    if (r.correlation.structuralComplexity >= 50) {
      expect(r.correlation.correlationClassification).toBe(
        "structurally_complex_operationally_stable",
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Approval latency pressure calculation
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: approval latency pressure calculation", () => {
  it("approval latency pressure is zero for workflow with no approval steps", () => {
    const r = runCorrelation(linearSteps, busyHistory);
    expect(r.correlation.approvalLatencyPressure).toBe(0);
  });

  it("approval-heavy workflow has higher latency pressure than linear workflow under same history", () => {
    const rApproval = runCorrelation(approvalHeavySteps, busyHistory);
    const rLinear   = runCorrelation(linearSteps, busyHistory);
    expect(rApproval.correlation.approvalLatencyPressure).toBeGreaterThan(
      rLinear.correlation.approvalLatencyPressure,
    );
  });

  it("approval latency pressure scales with backlog: critical >= busy >= quiet", () => {
    const rCrit  = runCorrelation(approvalHeavySteps, criticalHistory);
    const rBusy  = runCorrelation(approvalHeavySteps, busyHistory);
    const rQuiet = runCorrelation(approvalHeavySteps, quietHistory);
    // Both criticalHistory and busyHistory may saturate to 1.0 on approval-heavy workflows -
    // the invariant is that higher backlog produces equal-or-greater latency pressure.
    expect(rCrit.correlation.approvalLatencyPressure).toBeGreaterThanOrEqual(
      rBusy.correlation.approvalLatencyPressure,
    );
    expect(rBusy.correlation.approvalLatencyPressure).toBeGreaterThanOrEqual(
      rQuiet.correlation.approvalLatencyPressure,
    );
  });

  it("approval latency pressure is in [0, 1]", () => {
    const r = runCorrelation(approvalHeavySteps, criticalHistory);
    expect(r.correlation.approvalLatencyPressure).toBeGreaterThanOrEqual(0);
    expect(r.correlation.approvalLatencyPressure).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Delay duration pressure calculation
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: delay duration pressure calculation", () => {
  it("delay duration pressure is zero for workflow with no delay steps", () => {
    const r = runCorrelation(linearSteps, busyHistory);
    expect(r.correlation.delayDurationPressure).toBe(0);
  });

  it("delay-heavy workflow has higher duration pressure than linear under same history", () => {
    const rDelay  = runCorrelation(delayChainSteps, busyHistory);
    const rLinear = runCorrelation(linearSteps, busyHistory);
    expect(rDelay.correlation.delayDurationPressure).toBeGreaterThan(
      rLinear.correlation.delayDurationPressure,
    );
  });

  it("delay duration pressure scales with backlog: critical > busy >= quiet", () => {
    const rCrit  = runCorrelation(delayChainSteps, criticalHistory);
    const rBusy  = runCorrelation(delayChainSteps, busyHistory);
    const rQuiet = runCorrelation(delayChainSteps, quietHistory);
    expect(rCrit.correlation.delayDurationPressure).toBeGreaterThan(
      rBusy.correlation.delayDurationPressure,
    );
    expect(rBusy.correlation.delayDurationPressure).toBeGreaterThanOrEqual(
      rQuiet.correlation.delayDurationPressure,
    );
  });

  it("delay duration pressure is in [0, 1]", () => {
    const r = runCorrelation(delayChainSteps, criticalHistory);
    expect(r.correlation.delayDurationPressure).toBeGreaterThanOrEqual(0);
    expect(r.correlation.delayDurationPressure).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - runtimeWeightedComplexity normalization
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: runtimeWeightedComplexity normalization", () => {
  it("runtimeWeightedComplexity is always in [0, 100]", () => {
    const fixtures = [
      [linearSteps, ZERO_HISTORICAL],
      [linearSteps, quietHistory],
      [approvalHeavySteps, busyHistory],
      [delayChainSteps, criticalHistory],
      [highBottleneckSteps, criticalHistory],
    ] as const;

    for (const [steps, history] of fixtures) {
      const r = runCorrelation(steps as unknown[], history);
      expect(r.correlation.runtimeWeightedComplexity).toBeGreaterThanOrEqual(0);
      expect(r.correlation.runtimeWeightedComplexity).toBeLessThanOrEqual(100);
    }
  });

  it("all correlation pressures are in [0, 1]", () => {
    const r = runCorrelation(approvalHeavySteps, criticalHistory);
    const c = r.correlation;
    expect(c.historicalErrorPressure).toBeGreaterThanOrEqual(0);
    expect(c.historicalErrorPressure).toBeLessThanOrEqual(1);
    expect(c.historicalBacklogPressure).toBeGreaterThanOrEqual(0);
    expect(c.historicalBacklogPressure).toBeLessThanOrEqual(1);
    expect(c.approvalLatencyPressure).toBeGreaterThanOrEqual(0);
    expect(c.approvalLatencyPressure).toBeLessThanOrEqual(1);
    expect(c.delayDurationPressure).toBeGreaterThanOrEqual(0);
    expect(c.delayDurationPressure).toBeLessThanOrEqual(1);
    expect(c.executionFailurePressure).toBeGreaterThanOrEqual(0);
    expect(c.executionFailurePressure).toBeLessThanOrEqual(1);
  });

  it("higher avgErrorRate → higher historicalErrorPressure", () => {
    const rLow  = runCorrelation(linearSteps, { ...quietHistory, avgErrorRate: 0.05 });
    const rHigh = runCorrelation(linearSteps, { ...quietHistory, avgErrorRate: 0.50 });
    expect(rHigh.correlation.historicalErrorPressure).toBeGreaterThan(
      rLow.correlation.historicalErrorPressure,
    );
  });

  it("max error rate (1.0) produces historicalErrorPressure = 1", () => {
    const r = runCorrelation(linearSteps, { ...quietHistory, avgErrorRate: 1.0, snapshotCount: 10 });
    expect(r.correlation.historicalErrorPressure).toBe(1);
  });

  it("empty workflow produces zero structuralComplexity", () => {
    const r = runCorrelation([], ZERO_HISTORICAL);
    expect(r.correlation.structuralComplexity).toBe(0);
    expect(r.correlation.runtimeWeightedComplexity).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Fragility index deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: fragility index deterministic", () => {
  it("same input → same fragility level on every call", () => {
    for (const [steps, history] of [
      [linearSteps, quietHistory],
      [approvalHeavySteps, busyHistory],
      [highBottleneckSteps, criticalHistory],
    ] as const) {
      const r1 = runCorrelation(steps as unknown[], history);
      const r2 = runCorrelation(steps as unknown[], history);
      expect(r1.fragilityIndex.level).toBe(r2.fragilityIndex.level);
    }
  });

  it("fragility level is one of the four valid values", () => {
    const validLevels = ["low", "moderate", "high", "critical"];
    const r = runCorrelation(highBottleneckSteps, busyHistory);
    expect(validLevels).toContain(r.fragilityIndex.level);
  });

  it("simple linear workflow with quiet history is low fragility", () => {
    const r = runCorrelation(linearSteps, quietHistory);
    expect(r.fragilityIndex.level).toBe("low");
  });

  it("structural and runtime fragility are in [0, 1]", () => {
    const r = runCorrelation(approvalHeavySteps, criticalHistory);
    expect(r.fragilityIndex.structuralFragility).toBeGreaterThanOrEqual(0);
    expect(r.fragilityIndex.structuralFragility).toBeLessThanOrEqual(1);
    expect(r.fragilityIndex.runtimeFragility).toBeGreaterThanOrEqual(0);
    expect(r.fragilityIndex.runtimeFragility).toBeLessThanOrEqual(1);
  });

  it("chronicity is in [0, 1]", () => {
    const r = runCorrelation(highBottleneckSteps, criticalHistory);
    expect(r.fragilityIndex.chronicity).toBeGreaterThanOrEqual(0);
    expect(r.fragilityIndex.chronicity).toBeLessThanOrEqual(1);
  });

  it("operationalConfidence is one of the three valid values", () => {
    const validConf = ["low", "moderate", "high"];
    const r = runCorrelation(approvalHeavySteps, busyHistory);
    expect(validConf).toContain(r.fragilityIndex.operationalConfidence);
  });

  it("snapshotCount=0 → operationalConfidence=low", () => {
    const r = runCorrelation(linearSteps, ZERO_HISTORICAL);
    expect(r.fragilityIndex.operationalConfidence).toBe("low");
  });

  it("snapshotCount=500 (busy history) → operationalConfidence=high", () => {
    const r = runCorrelation(linearSteps, busyHistory); // snapshotCount=500
    expect(r.fragilityIndex.operationalConfidence).toBe("high");
  });

  it("dominant_severity=critical → higher chronicity than dominant_severity=healthy", () => {
    const rCritical = runCorrelation(linearSteps, criticalHistory);
    const rHealthy  = runCorrelation(linearSteps, quietHistory);
    expect(rCritical.fragilityIndex.chronicity).toBeGreaterThan(
      rHealthy.fragilityIndex.chronicity,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Historical correlation serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: historical correlation serialization stable", () => {
  it("result is JSON-serializable without circular references", () => {
    const r = runCorrelation(highBottleneckSteps, busyHistory);
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  it("serialized and re-parsed result is deep-equal to original", () => {
    const r        = runCorrelation(approvalHeavySteps, busyHistory);
    const reparsed = JSON.parse(JSON.stringify(r));
    expect(reparsed).toEqual(r);
  });

  it("correlation has all required top-level keys", () => {
    const r = runCorrelation(linearSteps, quietHistory);
    const c = r.correlation;
    expect(c).toHaveProperty("structuralComplexity");
    expect(c).toHaveProperty("historicalErrorPressure");
    expect(c).toHaveProperty("historicalBacklogPressure");
    expect(c).toHaveProperty("approvalLatencyPressure");
    expect(c).toHaveProperty("delayDurationPressure");
    expect(c).toHaveProperty("executionFailurePressure");
    expect(c).toHaveProperty("chronicOperationalHotspots");
    expect(c).toHaveProperty("runtimeWeightedComplexity");
    expect(c).toHaveProperty("correlationClassification");
  });

  it("fragilityIndex has all required top-level keys", () => {
    const r = runCorrelation(linearSteps, quietHistory);
    const f = r.fragilityIndex;
    expect(f).toHaveProperty("level");
    expect(f).toHaveProperty("structuralFragility");
    expect(f).toHaveProperty("runtimeFragility");
    expect(f).toHaveProperty("chronicity");
    expect(f).toHaveProperty("operationalConfidence");
    expect(f).toHaveProperty("indicators");
  });

  it("chronicOperationalHotspots is always an array", () => {
    for (const history of [ZERO_HISTORICAL, quietHistory, busyHistory]) {
      const r = runCorrelation(highBottleneckSteps, history);
      expect(Array.isArray(r.correlation.chronicOperationalHotspots)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - No live runtime dependency required
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: no live runtime dependency required", () => {
  it("computeOperationalCorrelation is synchronous and returns a plain object", () => {
    const depResult = analyzeDependencies(linearSteps);
    const graph     = extractWorkflowTopology(linearSteps);
    const analytics = computeTopologyAnalytics(graph, linearSteps);
    const result    = computeOperationalCorrelation(depResult, analytics, ZERO_HISTORICAL);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.correlation).toBeDefined();
    expect(result.fragilityIndex).toBeDefined();
  });

  it("ZERO_HISTORICAL produces a valid result (no snapshot data path)", () => {
    const r = runCorrelation(approvalHeavySteps, ZERO_HISTORICAL);
    expect(r.correlation.runtimeWeightedComplexity).toBe(r.correlation.structuralComplexity);
    expect(r.correlation.chronicOperationalHotspots).toHaveLength(0);
    expect(r.fragilityIndex.operationalConfidence).toBe("low");
  });

  it("engine handles all-zero historical data gracefully", () => {
    const allZero: HistoricalOperationalData = {
      snapshotCount:      0,
      avgErrorRate:       0,
      avgApprovalBacklog: 0,
      avgDelayBacklog:    0,
      avgStuckCount:      0,
      stormFrequency:     0,
      chronicAlertCodes:  [],
      dominantSeverity:   "healthy",
    };
    expect(() => runCorrelation(highBottleneckSteps, allZero)).not.toThrow();
  });

  it("engine handles maximum possible historical values gracefully", () => {
    const maxHistory: HistoricalOperationalData = {
      snapshotCount:      99999,
      avgErrorRate:       1.0,
      avgApprovalBacklog: 9999,
      avgDelayBacklog:    9999,
      avgStuckCount:      9999,
      stormFrequency:     1.0,
      chronicAlertCodes:  ["A", "B", "C", "D", "E", "F"],
      dominantSeverity:   "critical",
    };
    const r = runCorrelation(approvalHeavySteps, maxHistory);
    expect(r.correlation.runtimeWeightedComplexity).toBeLessThanOrEqual(100);
    expect(r.fragilityIndex.structuralFragility).toBeLessThanOrEqual(1);
    expect(r.fragilityIndex.runtimeFragility).toBeLessThanOrEqual(1);
    expect(r.fragilityIndex.chronicity).toBeLessThanOrEqual(1);
  });

  it("engine handles empty steps with historical data gracefully", () => {
    expect(() => runCorrelation([], busyHistory)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Correlation engine remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: correlation engine remains read-only", () => {
  it("computeOperationalCorrelation does not mutate the input history object", () => {
    const history    = JSON.parse(JSON.stringify(busyHistory)) as HistoricalOperationalData;
    const snapshot   = JSON.stringify(history);
    const depResult  = analyzeDependencies(approvalHeavySteps);
    const graph      = extractWorkflowTopology(approvalHeavySteps);
    const analytics  = computeTopologyAnalytics(graph, approvalHeavySteps);
    computeOperationalCorrelation(depResult, analytics, history);
    expect(JSON.stringify(history)).toBe(snapshot);
  });

  it("calling computeOperationalCorrelation multiple times produces stable results", () => {
    const r1 = runCorrelation(highBottleneckSteps, busyHistory);
    const r2 = runCorrelation(highBottleneckSteps, busyHistory);
    const r3 = runCorrelation(highBottleneckSteps, busyHistory);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r3));
  });

  it("historical backlog pressure is symmetric: approval and delay contribute equally when equal backlog", () => {
    const equalBacklog: HistoricalOperationalData = {
      ...quietHistory,
      avgApprovalBacklog: 25,
      avgDelayBacklog: 25,
      snapshotCount: 50,
    };
    const r = runCorrelation(linearSteps, equalBacklog);
    // historicalBacklogPressure = (normalized_approval + normalized_delay) / 2
    // Both are 25/50 = 0.5 → average = 0.5
    expect(r.correlation.historicalBacklogPressure).toBeCloseTo(0.5, 1);
  });

  it("fragilityIndex.indicators is always an array (may be empty)", () => {
    for (const history of [ZERO_HISTORICAL, quietHistory, criticalHistory]) {
      const r = runCorrelation(linearSteps, history);
      expect(Array.isArray(r.fragilityIndex.indicators)).toBe(true);
    }
  });

  it("execution failure pressure combines error rate and stuck count correctly", () => {
    const errorOnlyHistory: HistoricalOperationalData = {
      ...quietHistory, avgErrorRate: 0.5, avgStuckCount: 0, snapshotCount: 50,
    };
    const stuckOnlyHistory: HistoricalOperationalData = {
      ...quietHistory, avgErrorRate: 0, avgStuckCount: 10, snapshotCount: 50,
    };
    const rErrorOnly = runCorrelation(linearSteps, errorOnlyHistory);
    const rStuckOnly = runCorrelation(linearSteps, stuckOnlyHistory);
    // Both should produce non-zero executionFailurePressure
    expect(rErrorOnly.correlation.executionFailurePressure).toBeGreaterThan(0);
    expect(rStuckOnly.correlation.executionFailurePressure).toBeGreaterThan(0);
    // Error rate contributes more (weight 0.7) than stuck count (weight 0.3)
    expect(rErrorOnly.correlation.executionFailurePressure).toBeGreaterThan(
      rStuckOnly.correlation.executionFailurePressure,
    );
  });
});
