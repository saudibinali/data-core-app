/**
 * @file  dependency.test.ts
 * @phase P8-B - Advanced Workflow Analytics & Dependency Intelligence Foundations
 *
 * Tests for the pure static dependency intelligence engine.
 * No DB, no server, no async - all tests are synchronous pure-function calls.
 *
 * T1:  convergence node detection
 * T2:  divergence node detection
 * T3:  bottleneck scoring stability
 * T4:  approval bottleneck classification
 * T5:  delay accumulation pressure calculation
 * T6:  execution pressure deterministic behavior
 * T7:  dependency graph serialization stable
 * T8:  risk classification deterministic
 * T9:  no runtime dependencies required
 * T10: dependency engine remains read-only
 */

import { describe, it, expect } from "vitest";

import {
  analyzeDependencies,
  extractDependencyGraph,
  computeExecutionPressure,
  assessDependencyRisk,
} from "../dependency";
import {
  extractWorkflowTopology,
  computeTopologyAnalytics,
} from "../topology";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Linear: A → B → C → D
 * Indexes  0   1   2   3
 * No conditions, no branching.
 */
const linearSteps = [
  { index: 0, type: "notification", name: "A", config: {} },
  { index: 1, type: "notification", name: "B", config: {} },
  { index: 2, type: "notification", name: "C", config: {} },
  { index: 3, type: "notification", name: "D", config: {} },
];

/**
 * Diamond:
 *   cond(0) → true→ B(1), false→ C(2)
 *   B(1) linear → C(2)           ← C gets both false_branch(0→2) AND linear(1→2)
 *   C(2) linear → D(3)
 *
 * Expected: C is a convergence node (in-degree 2).
 *           cond is a divergence node.
 */
const diamondSteps = [
  { index: 0, type: "condition",    name: "cond",  config: { onTrueStepIndex: 1, onFalseStepIndex: 2 } },
  { index: 1, type: "notification", name: "B",     config: {} },
  { index: 2, type: "notification", name: "C",     config: {} },
  { index: 3, type: "notification", name: "D",     config: {} },
];

/**
 * ApprovalHeavy: approval → approval → notification → approval
 * Each approval has increasing fan-in due to linear advance.
 */
const approvalHeavySteps = [
  { index: 0, type: "approval",     name: "Appr0", config: {} },
  { index: 1, type: "approval",     name: "Appr1", config: {} },
  { index: 2, type: "notification", name: "Notif", config: {} },
  { index: 3, type: "approval",     name: "Appr3", config: {} },
];

/**
 * DelayChain: notif → delay → delay → delay → notif
 * 3 consecutive delay steps on the only path.
 */
const delayChainSteps = [
  { index: 0, type: "notification", name: "Start", config: {} },
  { index: 1, type: "delay",        name: "D1",    config: {} },
  { index: 2, type: "delay",        name: "D2",    config: {} },
  { index: 3, type: "delay",        name: "D3",    config: {} },
  { index: 4, type: "notification", name: "End",   config: {} },
];

/**
 * HighBottleneck:
 *   cond(0) → true→B(1), false→Appr(3)    [index=3 is a forward ref, skips pos=2]
 *   B(1)    → linear → C(2)
 *   C(2)    → linear → Appr(3)
 *   Appr(3) → terminal
 *
 * Appr(3) has in-degree 2:
 *   - cond(0) via false_branch
 *   - C(2)    via linear
 * AND it is an approval step AND a convergence node → clearly a bottleneck.
 */
const highBottleneckSteps = [
  { index: 0, type: "condition",    name: "cond",  config: { onTrueStepIndex: 1, onFalseStepIndex: 3 } },
  { index: 1, type: "notification", name: "B",     config: {} },
  { index: 2, type: "notification", name: "C",     config: {} },
  { index: 3, type: "approval",     name: "Appr",  config: {} },
];

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Convergence node detection
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: convergence node detection", () => {
  it("linear workflow has no convergence nodes", () => {
    const result = analyzeDependencies(linearSteps);
    expect(result.dependencyGraph.convergenceNodes).toHaveLength(0);
  });

  it("diamond workflow: step C (index=2) is a convergence node", () => {
    const result = analyzeDependencies(diamondSteps);
    const conv   = result.dependencyGraph.convergenceNodes;
    expect(conv.length).toBeGreaterThanOrEqual(1);
    const stepC = conv.find(c => c.stepName === "C");
    expect(stepC).toBeDefined();
    expect(stepC!.inDegree).toBeGreaterThanOrEqual(2);
  });

  it("convergence node inDegree reflects actual predecessor count", () => {
    const result = analyzeDependencies(diamondSteps);
    for (const cn of result.dependencyGraph.convergenceNodes) {
      expect(cn.inDegree).toBeGreaterThanOrEqual(2);
    }
  });

  it("convergence nodes have required fields", () => {
    const result = analyzeDependencies(diamondSteps);
    for (const cn of result.dependencyGraph.convergenceNodes) {
      expect(typeof cn.stepIndex).toBe("number");
      expect(typeof cn.stepName).toBe("string");
      expect(typeof cn.stepType).toBe("string");
      expect(typeof cn.inDegree).toBe("number");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Divergence node detection
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: divergence node detection", () => {
  it("linear workflow has no divergence nodes", () => {
    const result = analyzeDependencies(linearSteps);
    expect(result.dependencyGraph.divergenceNodes).toHaveLength(0);
  });

  it("diamond workflow: cond (index=0) is a divergence node", () => {
    const result = analyzeDependencies(diamondSteps);
    const divs   = result.dependencyGraph.divergenceNodes;
    expect(divs.length).toBeGreaterThanOrEqual(1);
    expect(divs).toContain(0); // stepIndex=0 is the condition step
  });

  it("conditionalNodes includes all condition steps", () => {
    const result = analyzeDependencies(diamondSteps);
    expect(result.dependencyGraph.conditionalNodes).toContain(0);
  });

  it("divergence and conditional node sets overlap on condition steps with distinct branches", () => {
    const result = analyzeDependencies(diamondSteps);
    const divSet  = new Set(result.dependencyGraph.divergenceNodes);
    const condSet = new Set(result.dependencyGraph.conditionalNodes);
    for (const si of divSet) {
      expect(condSet.has(si)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Bottleneck scoring stability
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: bottleneck scoring stability", () => {
  it("same input produces identical bottleneck scores on every call", () => {
    const r1 = analyzeDependencies(highBottleneckSteps);
    const r2 = analyzeDependencies(highBottleneckSteps);
    expect(r1.dependencyGraph.bottleneckNodes).toEqual(r2.dependencyGraph.bottleneckNodes);
  });

  it("linear workflow with no branching produces no bottlenecks", () => {
    const result = analyzeDependencies(linearSteps);
    expect(result.dependencyGraph.bottleneckNodes).toHaveLength(0);
  });

  it("bottleneck nodes are sorted by score descending", () => {
    const result = analyzeDependencies(highBottleneckSteps);
    const bns    = result.dependencyGraph.bottleneckNodes;
    for (let i = 1; i < bns.length; i++) {
      expect(bns[i - 1]!.score).toBeGreaterThanOrEqual(bns[i]!.score);
    }
  });

  it("bottleneck node scores are non-negative", () => {
    const result = analyzeDependencies(highBottleneckSteps);
    for (const bn of result.dependencyGraph.bottleneckNodes) {
      expect(bn.score).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Approval bottleneck classification
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: approval bottleneck classification", () => {
  it("approval step at convergence point is classified as bottleneck", () => {
    const result    = analyzeDependencies(highBottleneckSteps);
    const approvalBN = result.dependencyGraph.bottleneckNodes.find(
      b => b.stepType === "approval",
    );
    expect(approvalBN).toBeDefined();
    expect(approvalBN!.reasons.some(r => r.includes("approval"))).toBe(true);
  });

  it("approval bottleneck reasons mention human action", () => {
    const result = analyzeDependencies(highBottleneckSteps);
    const approvalBN = result.dependencyGraph.bottleneckNodes.find(
      b => b.stepType === "approval",
    );
    if (approvalBN) {
      const hasApprovalReason = approvalBN.reasons.some(r =>
        r.toLowerCase().includes("approval") || r.toLowerCase().includes("human"),
      );
      expect(hasApprovalReason).toBe(true);
    }
  });

  it("approval-heavy workflow has non-zero approval wait pressure", () => {
    const result = analyzeDependencies(approvalHeavySteps);
    expect(result.pressure.approvalWaitPressure).toBeGreaterThan(0);
  });

  it("approval wait pressure is between 0 and 1", () => {
    const result = analyzeDependencies(approvalHeavySteps);
    expect(result.pressure.approvalWaitPressure).toBeGreaterThanOrEqual(0);
    expect(result.pressure.approvalWaitPressure).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Delay accumulation pressure calculation
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: delay accumulation pressure calculation", () => {
  it("workflow with no delays has zero delay accumulation pressure", () => {
    const result = analyzeDependencies(linearSteps);
    expect(result.pressure.delayAccumulationPressure).toBe(0);
  });

  it("delay chain workflow has non-zero delay accumulation pressure", () => {
    const result = analyzeDependencies(delayChainSteps);
    expect(result.pressure.delayAccumulationPressure).toBeGreaterThan(0);
  });

  it("delay accumulation pressure is between 0 and 1", () => {
    const result = analyzeDependencies(delayChainSteps);
    expect(result.pressure.delayAccumulationPressure).toBeGreaterThanOrEqual(0);
    expect(result.pressure.delayAccumulationPressure).toBeLessThanOrEqual(1);
  });

  it("more delays on longest path → higher pressure than fewer delays", () => {
    const singleDelay = [
      { index: 0, type: "notification", name: "A", config: {} },
      { index: 1, type: "delay",        name: "D", config: {} },
      { index: 2, type: "notification", name: "B", config: {} },
    ];
    const r1 = analyzeDependencies(singleDelay);
    const r2 = analyzeDependencies(delayChainSteps);
    expect(r2.pressure.delayAccumulationPressure).toBeGreaterThanOrEqual(
      r1.pressure.delayAccumulationPressure,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Execution pressure deterministic behavior
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: execution pressure deterministic behavior", () => {
  const fixtures = [linearSteps, diamondSteps, approvalHeavySteps, delayChainSteps, highBottleneckSteps];

  for (const steps of fixtures) {
    it(`same input produces identical pressure for ${steps[0]!.name} fixture`, () => {
      const r1 = analyzeDependencies(steps);
      const r2 = analyzeDependencies(steps);
      expect(r1.pressure).toEqual(r2.pressure);
    });
  }

  it("operationalComplexityScore is integer in [0, 100]", () => {
    for (const steps of fixtures) {
      const r = analyzeDependencies(steps);
      const s = r.pressure.operationalComplexityScore;
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("all pressure metrics are in [0, 1]", () => {
    for (const steps of fixtures) {
      const r = analyzeDependencies(steps);
      const p = r.pressure;
      expect(p.estimatedFanoutPressure).toBeGreaterThanOrEqual(0);
      expect(p.estimatedFanoutPressure).toBeLessThanOrEqual(1);
      expect(p.approvalWaitPressure).toBeGreaterThanOrEqual(0);
      expect(p.approvalWaitPressure).toBeLessThanOrEqual(1);
      expect(p.delayAccumulationPressure).toBeGreaterThanOrEqual(0);
      expect(p.delayAccumulationPressure).toBeLessThanOrEqual(1);
      expect(p.dependencyCriticality).toBeGreaterThanOrEqual(0);
      expect(p.dependencyCriticality).toBeLessThanOrEqual(1);
    }
  });

  it("empty steps produce zero pressure across all metrics", () => {
    const r = analyzeDependencies([]);
    expect(r.pressure.estimatedFanoutPressure).toBe(0);
    expect(r.pressure.approvalWaitPressure).toBe(0);
    expect(r.pressure.delayAccumulationPressure).toBe(0);
    expect(r.pressure.dependencyCriticality).toBe(0);
    expect(r.pressure.operationalComplexityScore).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Dependency graph serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: dependency graph serialization stable", () => {
  it("result is JSON-serializable without circular references", () => {
    for (const steps of [linearSteps, diamondSteps, highBottleneckSteps]) {
      const result = analyzeDependencies(steps);
      expect(() => JSON.stringify(result)).not.toThrow();
    }
  });

  it("serialized and re-parsed result is deep-equal to original", () => {
    const result  = analyzeDependencies(diamondSteps);
    const reparsed = JSON.parse(JSON.stringify(result));
    expect(reparsed).toEqual(result);
  });

  it("dependency graph has all required top-level keys", () => {
    const result = analyzeDependencies(diamondSteps);
    const dg     = result.dependencyGraph;
    expect(dg).toHaveProperty("nodeSummaries");
    expect(dg).toHaveProperty("convergenceNodes");
    expect(dg).toHaveProperty("divergenceNodes");
    expect(dg).toHaveProperty("bottleneckNodes");
    expect(dg).toHaveProperty("conditionalNodes");
    expect(dg).toHaveProperty("synchronizationCandidates");
  });

  it("pressure has all required keys", () => {
    const result = analyzeDependencies(diamondSteps);
    const p      = result.pressure;
    expect(p).toHaveProperty("estimatedFanoutPressure");
    expect(p).toHaveProperty("approvalWaitPressure");
    expect(p).toHaveProperty("delayAccumulationPressure");
    expect(p).toHaveProperty("dependencyCriticality");
    expect(p).toHaveProperty("operationalComplexityScore");
  });

  it("risk has all required keys", () => {
    const result = analyzeDependencies(diamondSteps);
    const risk   = result.risk;
    expect(risk).toHaveProperty("level");
    expect(risk).toHaveProperty("bottleneckRisk");
    expect(risk).toHaveProperty("convergenceComplexity");
    expect(risk).toHaveProperty("operationalFragilityIndicators");
    expect(risk).toHaveProperty("reasons");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Risk classification deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: risk classification deterministic", () => {
  it("same input always produces the same risk level", () => {
    for (const steps of [linearSteps, diamondSteps, highBottleneckSteps, delayChainSteps]) {
      const r1 = analyzeDependencies(steps);
      const r2 = analyzeDependencies(steps);
      expect(r1.risk.level).toBe(r2.risk.level);
      expect(r1.risk.bottleneckRisk).toBe(r2.risk.bottleneckRisk);
      expect(r1.risk.convergenceComplexity).toBe(r2.risk.convergenceComplexity);
    }
  });

  it("risk level is one of the four valid values", () => {
    const validLevels = ["low", "moderate", "high", "critical"];
    for (const steps of [linearSteps, diamondSteps, approvalHeavySteps]) {
      const r = analyzeDependencies(steps);
      expect(validLevels).toContain(r.risk.level);
    }
  });

  it("linear workflow with no complexity markers is low risk", () => {
    const result = analyzeDependencies(linearSteps);
    expect(result.risk.level).toBe("low");
    expect(result.risk.bottleneckRisk).toBe("none");
    expect(result.risk.convergenceComplexity).toBe("none");
  });

  it("empty workflow is low risk", () => {
    const result = analyzeDependencies([]);
    expect(result.risk.level).toBe("low");
  });

  it("workflow with many bottlenecks has bottleneckRisk >= moderate", () => {
    const result = analyzeDependencies(highBottleneckSteps);
    const validHigherLevels = ["moderate", "high"];
    if (result.dependencyGraph.bottleneckNodes.length >= 1) {
      expect(validHigherLevels).toContain(result.risk.bottleneckRisk);
    }
  });

  it("reasons array contains objects with code and message", () => {
    const result = analyzeDependencies(highBottleneckSteps);
    for (const r of result.risk.reasons) {
      expect(typeof r.code).toBe("string");
      expect(typeof r.message).toBe("string");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - No runtime dependencies required
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: no runtime dependencies required", () => {
  it("dependency engine completes without any async operations", () => {
    // All functions are synchronous - if they return a value directly, no async
    const result = analyzeDependencies(diamondSteps);
    // Not a Promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.dependencyGraph).toBeDefined();
    expect(result.pressure).toBeDefined();
    expect(result.risk).toBeDefined();
  });

  it("extractDependencyGraph is a pure synchronous function", () => {
    const graph     = extractWorkflowTopology(diamondSteps);
    const analytics = computeTopologyAnalytics(graph, diamondSteps);
    const depGraph  = extractDependencyGraph(graph, analytics);
    expect(depGraph).not.toBeInstanceOf(Promise);
    expect(depGraph.nodeSummaries.length).toBe(diamondSteps.length);
  });

  it("computeExecutionPressure is a pure synchronous function", () => {
    const graph     = extractWorkflowTopology(diamondSteps);
    const analytics = computeTopologyAnalytics(graph, diamondSteps);
    const depGraph  = extractDependencyGraph(graph, analytics);
    const pressure  = computeExecutionPressure(graph, depGraph, analytics);
    expect(pressure).not.toBeInstanceOf(Promise);
    expect(typeof pressure.operationalComplexityScore).toBe("number");
  });

  it("assessDependencyRisk is a pure synchronous function", () => {
    const graph     = extractWorkflowTopology(diamondSteps);
    const analytics = computeTopologyAnalytics(graph, diamondSteps);
    const depGraph  = extractDependencyGraph(graph, analytics);
    const pressure  = computeExecutionPressure(graph, depGraph, analytics);
    const risk      = assessDependencyRisk(graph, depGraph, pressure);
    expect(risk).not.toBeInstanceOf(Promise);
    expect(typeof risk.level).toBe("string");
  });

  it("handles malformed/non-object steps without throwing", () => {
    const malformed = [null, undefined, 42, "string", {}, { index: 0, type: "notification", name: "ok", config: {} }];
    expect(() => analyzeDependencies(malformed as unknown[])).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Dependency engine remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: dependency engine remains read-only", () => {
  it("analyzeDependencies does not mutate the input steps array", () => {
    const steps    = JSON.parse(JSON.stringify(diamondSteps)) as typeof diamondSteps;
    const snapshot = JSON.stringify(steps);
    analyzeDependencies(steps);
    expect(JSON.stringify(steps)).toBe(snapshot);
  });

  it("calling analyzeDependencies multiple times produces stable results", () => {
    const r1 = analyzeDependencies(highBottleneckSteps);
    const r2 = analyzeDependencies(highBottleneckSteps);
    const r3 = analyzeDependencies(highBottleneckSteps);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r3));
  });

  it("nodeSummaries count equals step count for valid steps", () => {
    const result = analyzeDependencies(diamondSteps);
    expect(result.dependencyGraph.nodeSummaries.length).toBe(diamondSteps.length);
  });

  it("upstreamCount and downstreamCount are non-negative for all nodes", () => {
    const result = analyzeDependencies(diamondSteps);
    for (const ns of result.dependencyGraph.nodeSummaries) {
      expect(ns.upstreamCount).toBeGreaterThanOrEqual(0);
      expect(ns.downstreamCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("inDegree=0 for entry node of linear workflow", () => {
    const result  = analyzeDependencies(linearSteps);
    const entryNs = result.dependencyGraph.nodeSummaries.find(s => s.stepIndex === 0);
    expect(entryNs).toBeDefined();
    expect(entryNs!.inDegree).toBe(0);
  });

  it("outDegree=0 for terminal node of linear workflow", () => {
    const result      = analyzeDependencies(linearSteps);
    const terminalIdx = linearSteps.length - 1;
    const terminalNs  = result.dependencyGraph.nodeSummaries.find(s => s.stepIndex === terminalIdx);
    expect(terminalNs).toBeDefined();
    expect(terminalNs!.outDegree).toBe(0);
  });
});
