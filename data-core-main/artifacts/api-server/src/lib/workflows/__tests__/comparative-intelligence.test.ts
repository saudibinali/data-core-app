/**
 * @file   __tests__/comparative-intelligence.test.ts
 * @phase  P8-E - Cross-Workflow Comparative Intelligence & Risk Ranking Foundations
 *
 * T1  comparativeRiskScore deterministic
 * T2  workspace ranking stable ordering
 * T3  tie-breaking deterministic
 * T4  operationalPriority classification stable
 * T5  degrading workflows ranked higher
 * T6  confidence penalties reduce ranking
 * T7  hotspot concentration detection stable
 * T8  comparative serialization stable
 * T9  no live runtime dependency required
 * T10 comparative engine remains read-only
 */

import { describe, it, expect } from "vitest";
import {
  computeComparativeIntelligence,
  type WorkflowIntelligenceSnapshot,
  type ComparativeIntelligenceInput,
} from "../comparative-intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A healthy, structurally simple workflow with no history. */
const SNAPSHOT_LOW: WorkflowIntelligenceSnapshot = {
  workflowId:                1,
  workflowName:              "Low Risk WF",
  stepCount:                 3,
  runtimeWeightedComplexity: 10,
  structuralComplexity:      10,
  fragilityLevel:            "low",
  hotspotCount:              0,
  projectedComplexity:       10,
  trendDirection:            "stable",
  confidenceLevel:           "high",
};

/** A moderate-complexity workflow with some pressure. */
const SNAPSHOT_MODERATE: WorkflowIntelligenceSnapshot = {
  workflowId:                2,
  workflowName:              "Moderate WF",
  stepCount:                 8,
  runtimeWeightedComplexity: 40,
  structuralComplexity:      35,
  fragilityLevel:            "moderate",
  hotspotCount:              1,
  projectedComplexity:       45,
  trendDirection:            "degrading",
  confidenceLevel:           "moderate",
};

/** A high-complexity workflow with heavy operational pressure. */
const SNAPSHOT_HIGH: WorkflowIntelligenceSnapshot = {
  workflowId:                3,
  workflowName:              "High Risk WF",
  stepCount:                 15,
  runtimeWeightedComplexity: 70,
  structuralComplexity:      65,
  fragilityLevel:            "high",
  hotspotCount:              2,
  projectedComplexity:       75,
  trendDirection:            "degrading",
  confidenceLevel:           "high",
};

/** A critically degrading workflow - the worst case. */
const SNAPSHOT_CRITICAL: WorkflowIntelligenceSnapshot = {
  workflowId:                4,
  workflowName:              "Critical WF",
  stepCount:                 20,
  runtimeWeightedComplexity: 85,
  structuralComplexity:      80,
  fragilityLevel:            "critical",
  hotspotCount:              3,
  projectedComplexity:       90,
  trendDirection:            "critically_degrading",
  confidenceLevel:           "high",
};

function run(snapshots: WorkflowIntelligenceSnapshot[]) {
  return computeComparativeIntelligence({ snapshots }, { workspaceId: 99 });
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - comparativeRiskScore deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: comparativeRiskScore deterministic", () => {
  it("identical inputs produce identical scores", () => {
    const r1 = run([SNAPSHOT_LOW, SNAPSHOT_MODERATE]);
    const r2 = run([SNAPSHOT_LOW, SNAPSHOT_MODERATE]);
    const scores1 = r1.rankedWorkflows.map(w => w.comparativeRiskScore);
    const scores2 = r2.rankedWorkflows.map(w => w.comparativeRiskScore);
    expect(scores1).toEqual(scores2);
  });

  it("score for low-risk workflow is lower than high-risk workflow", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_HIGH]);
    const lowWf   = r.rankedWorkflows.find(w => w.workflowId === 1)!;
    const highWf  = r.rankedWorkflows.find(w => w.workflowId === 3)!;
    expect(lowWf.comparativeRiskScore).toBeLessThan(highWf.comparativeRiskScore);
  });

  it("score is bounded to [0, 100]", () => {
    const r = run([SNAPSHOT_CRITICAL, SNAPSHOT_LOW]);
    for (const wf of r.rankedWorkflows) {
      expect(wf.comparativeRiskScore).toBeGreaterThanOrEqual(0);
      expect(wf.comparativeRiskScore).toBeLessThanOrEqual(100);
    }
  });

  it("score is an integer", () => {
    const r = run([SNAPSHOT_MODERATE, SNAPSHOT_HIGH]);
    for (const wf of r.rankedWorkflows) {
      expect(Number.isInteger(wf.comparativeRiskScore)).toBe(true);
    }
  });

  it("critical workflow has higher score than low workflow", () => {
    const r = run([SNAPSHOT_CRITICAL, SNAPSHOT_LOW]);
    const crit = r.rankedWorkflows.find(w => w.workflowId === 4)!;
    const low  = r.rankedWorkflows.find(w => w.workflowId === 1)!;
    expect(crit.comparativeRiskScore).toBeGreaterThan(low.comparativeRiskScore);
  });

  it("improving trend reduces score compared to stable (same base metrics)", () => {
    const stable: WorkflowIntelligenceSnapshot = {
      ...SNAPSHOT_LOW, workflowId: 10, trendDirection: "stable",   confidenceLevel: "high",
    };
    const improving: WorkflowIntelligenceSnapshot = {
      ...SNAPSHOT_LOW, workflowId: 11, trendDirection: "improving", confidenceLevel: "high",
    };
    const r = run([stable, improving]);
    const s = r.rankedWorkflows.find(w => w.workflowId === 10)!;
    const i = r.rankedWorkflows.find(w => w.workflowId === 11)!;
    expect(i.comparativeRiskScore).toBeLessThan(s.comparativeRiskScore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - workspace ranking stable ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: workspace ranking stable ordering", () => {
  it("ranks are 1-based and contiguous", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_MODERATE, SNAPSHOT_HIGH, SNAPSHOT_CRITICAL]);
    const ranks = r.rankedWorkflows.map(w => w.workspaceRank);
    expect(ranks).toEqual([1, 2, 3, 4]);
  });

  it("rank 1 has highest comparativeRiskScore", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_MODERATE, SNAPSHOT_HIGH, SNAPSHOT_CRITICAL]);
    const rank1Score  = r.rankedWorkflows[0]!.comparativeRiskScore;
    for (const wf of r.rankedWorkflows.slice(1)) {
      expect(rank1Score).toBeGreaterThanOrEqual(wf.comparativeRiskScore);
    }
  });

  it("critical workflow is ranked 1 among four workflows", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_MODERATE, SNAPSHOT_HIGH, SNAPSHOT_CRITICAL]);
    expect(r.rankedWorkflows[0]!.workflowId).toBe(4);  // SNAPSHOT_CRITICAL
  });

  it("empty input produces empty ranking", () => {
    const r = run([]);
    expect(r.rankedWorkflows).toHaveLength(0);
    expect(r.totalWorkflows).toBe(0);
  });

  it("single workflow gets rank 1", () => {
    const r = run([SNAPSHOT_HIGH]);
    expect(r.rankedWorkflows).toHaveLength(1);
    expect(r.rankedWorkflows[0]!.workspaceRank).toBe(1);
  });

  it("totalWorkflows equals snapshot count", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_MODERATE, SNAPSHOT_HIGH]);
    expect(r.totalWorkflows).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - tie-breaking deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: tie-breaking deterministic", () => {
  const tiedA: WorkflowIntelligenceSnapshot = {
    workflowId: 10, workflowName: "Tied A", stepCount: 5,
    runtimeWeightedComplexity: 30, structuralComplexity: 30,
    fragilityLevel: "low", hotspotCount: 0,
    projectedComplexity: 30, trendDirection: "stable", confidenceLevel: "high",
  };
  const tiedB: WorkflowIntelligenceSnapshot = {
    ...tiedA, workflowId: 11, workflowName: "Tied B",
  };
  const tiedC: WorkflowIntelligenceSnapshot = {
    ...tiedA, workflowId: 12, workflowName: "Tied C",
  };

  it("identical scores are broken by workflowId ASC", () => {
    const r = run([tiedC, tiedA, tiedB]);
    const ids = r.rankedWorkflows.map(w => w.workflowId);
    expect(ids).toEqual([10, 11, 12]);
  });

  it("tie-breaking is stable regardless of input order", () => {
    const r1 = run([tiedA, tiedB, tiedC]);
    const r2 = run([tiedC, tiedB, tiedA]);
    const ids1 = r1.rankedWorkflows.map(w => w.workflowId);
    const ids2 = r2.rankedWorkflows.map(w => w.workflowId);
    expect(ids1).toEqual(ids2);
  });

  it("two tied workflows - lower workflowId gets rank 1", () => {
    const r = run([tiedB, tiedA]);
    expect(r.rankedWorkflows[0]!.workflowId).toBe(10);
    expect(r.rankedWorkflows[1]!.workflowId).toBe(11);
  });

  it("different scores - higher score takes rank 1 regardless of workflowId order", () => {
    const highId: WorkflowIntelligenceSnapshot = { ...SNAPSHOT_HIGH, workflowId: 999 };
    const lowId:  WorkflowIntelligenceSnapshot = { ...SNAPSHOT_LOW,  workflowId: 1   };
    const r = run([lowId, highId]);
    expect(r.rankedWorkflows[0]!.workflowId).toBe(999);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - operationalPriority classification stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: operationalPriority classification stable", () => {
  it("low-risk workflow gets informational or watch priority", () => {
    const r = run([SNAPSHOT_LOW]);
    const p = r.rankedWorkflows[0]!.operationalPriority;
    expect(["informational", "watch"]).toContain(p);
  });

  it("critical workflow gets critical priority", () => {
    const r = run([SNAPSHOT_CRITICAL]);
    expect(r.rankedWorkflows[0]!.operationalPriority).toBe("critical");
  });

  it("priority levels are one of the valid 5 values", () => {
    const valid = ["informational", "watch", "elevated", "urgent", "critical"];
    const r = run([SNAPSHOT_LOW, SNAPSHOT_MODERATE, SNAPSHOT_HIGH, SNAPSHOT_CRITICAL]);
    for (const wf of r.rankedWorkflows) {
      expect(valid).toContain(wf.operationalPriority);
    }
  });

  it("high-score workflow (rWC=80, projected=80) gets urgent or critical", () => {
    const extreme: WorkflowIntelligenceSnapshot = {
      workflowId: 99, workflowName: "Extreme", stepCount: 20,
      runtimeWeightedComplexity: 80, structuralComplexity: 80,
      fragilityLevel: "high", hotspotCount: 2,
      projectedComplexity: 80, trendDirection: "stable", confidenceLevel: "high",
    };
    const r = run([extreme]);
    expect(["urgent", "critical"]).toContain(r.rankedWorkflows[0]!.operationalPriority);
  });

  it("critically_degrading trend escalates priority from watch toward elevated or above", () => {
    const base: WorkflowIntelligenceSnapshot = {
      workflowId: 50, workflowName: "Escalating", stepCount: 5,
      runtimeWeightedComplexity: 25, structuralComplexity: 25,
      fragilityLevel: "low", hotspotCount: 0,
      projectedComplexity: 28, trendDirection: "critically_degrading", confidenceLevel: "high",
    };
    const stable: WorkflowIntelligenceSnapshot = {
      ...base, workflowId: 51, trendDirection: "stable",
    };
    const rEscalated = run([base]);
    const rStable    = run([stable]);
    const LEVELS = { informational: 0, watch: 1, elevated: 2, urgent: 3, critical: 4 };
    const pEscalated = LEVELS[rEscalated.rankedWorkflows[0]!.operationalPriority];
    const pStable    = LEVELS[rStable.rankedWorkflows[0]!.operationalPriority];
    expect(pEscalated).toBeGreaterThanOrEqual(pStable);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - degrading workflows ranked higher
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: degrading workflows ranked higher", () => {
  it("degrading workflow ranks above identical stable workflow", () => {
    const degrading: WorkflowIntelligenceSnapshot = {
      workflowId: 20, workflowName: "Degrading", stepCount: 8,
      runtimeWeightedComplexity: 40, structuralComplexity: 40,
      fragilityLevel: "moderate", hotspotCount: 1,
      projectedComplexity: 42, trendDirection: "degrading", confidenceLevel: "high",
    };
    const stable: WorkflowIntelligenceSnapshot = {
      ...degrading, workflowId: 21, workflowName: "Stable", trendDirection: "stable",
    };
    const r = run([stable, degrading]);
    expect(r.rankedWorkflows[0]!.workflowId).toBe(20);
  });

  it("critically_degrading workflow ranks above degrading with same base metrics", () => {
    const critDeg: WorkflowIntelligenceSnapshot = {
      workflowId: 30, workflowName: "Crit Deg", stepCount: 10,
      runtimeWeightedComplexity: 50, structuralComplexity: 50,
      fragilityLevel: "high", hotspotCount: 2,
      projectedComplexity: 55, trendDirection: "critically_degrading", confidenceLevel: "high",
    };
    const deg: WorkflowIntelligenceSnapshot = {
      ...critDeg, workflowId: 31, workflowName: "Degrading", trendDirection: "degrading",
    };
    const r = run([deg, critDeg]);
    expect(r.rankedWorkflows[0]!.workflowId).toBe(30);
  });

  it("improving workflow ranks BELOW stable workflow with same base metrics", () => {
    const improving: WorkflowIntelligenceSnapshot = {
      workflowId: 40, workflowName: "Improving", stepCount: 6,
      runtimeWeightedComplexity: 35, structuralComplexity: 35,
      fragilityLevel: "moderate", hotspotCount: 0,
      projectedComplexity: 35, trendDirection: "improving", confidenceLevel: "high",
    };
    const stable: WorkflowIntelligenceSnapshot = {
      ...improving, workflowId: 41, workflowName: "Stable", trendDirection: "stable",
    };
    const r = run([improving, stable]);
    expect(r.rankedWorkflows[0]!.workflowId).toBe(41);
  });

  it("trend bonus increases comparativeRiskScore in correct order", () => {
    const base = { ...SNAPSHOT_LOW, confidenceLevel: "high" as const };
    const wf = (id: number, t: "critically_degrading" | "degrading" | "stable" | "improving") =>
      ({ ...base, workflowId: id, trendDirection: t } as WorkflowIntelligenceSnapshot);

    const r = run([wf(1, "improving"), wf(2, "stable"), wf(3, "degrading"), wf(4, "critically_degrading")]);
    const scores = Object.fromEntries(r.rankedWorkflows.map(w => [w.workflowId, w.comparativeRiskScore]));

    expect(scores[4]).toBeGreaterThan(scores[3]!);
    expect(scores[3]).toBeGreaterThan(scores[2]!);
    expect(scores[2]).toBeGreaterThan(scores[1]!);
  });

  it("all four trend directions produce distinct scores (same base metrics)", () => {
    const base = { ...SNAPSHOT_LOW, confidenceLevel: "high" as const };
    const wf = (id: number, t: "critically_degrading" | "degrading" | "stable" | "improving") =>
      ({ ...base, workflowId: id, trendDirection: t } as WorkflowIntelligenceSnapshot);

    const r = run([wf(1, "improving"), wf(2, "stable"), wf(3, "degrading"), wf(4, "critically_degrading")]);
    const scores = r.rankedWorkflows.map(w => w.comparativeRiskScore);
    const unique = new Set(scores);
    expect(unique.size).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - confidence penalties reduce ranking
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: confidence penalties reduce ranking", () => {
  it("high-confidence workflow scores higher than low-confidence (same signals)", () => {
    const hiConf: WorkflowIntelligenceSnapshot = {
      workflowId: 60, workflowName: "High Conf", stepCount: 10,
      runtimeWeightedComplexity: 50, structuralComplexity: 50,
      fragilityLevel: "high", hotspotCount: 2,
      projectedComplexity: 55, trendDirection: "degrading", confidenceLevel: "high",
    };
    const loConf: WorkflowIntelligenceSnapshot = {
      ...hiConf, workflowId: 61, workflowName: "Low Conf", confidenceLevel: "low",
    };
    const r = run([loConf, hiConf]);
    const hi = r.rankedWorkflows.find(w => w.workflowId === 60)!;
    const lo = r.rankedWorkflows.find(w => w.workflowId === 61)!;
    expect(hi.comparativeRiskScore).toBeGreaterThan(lo.comparativeRiskScore);
  });

  it("moderate-confidence workflow scores between high and low confidence", () => {
    const base: WorkflowIntelligenceSnapshot = {
      workflowId: 70, workflowName: "Base", stepCount: 10,
      runtimeWeightedComplexity: 50, structuralComplexity: 50,
      fragilityLevel: "high", hotspotCount: 2,
      projectedComplexity: 55, trendDirection: "degrading", confidenceLevel: "high",
    };
    const hiConf = base;
    const modConf: WorkflowIntelligenceSnapshot = { ...base, workflowId: 71, confidenceLevel: "moderate" };
    const loConf:  WorkflowIntelligenceSnapshot = { ...base, workflowId: 72, confidenceLevel: "low" };

    const r = run([loConf, modConf, hiConf]);
    const hi  = r.rankedWorkflows.find(w => w.workflowId === 70)!;
    const mod = r.rankedWorkflows.find(w => w.workflowId === 71)!;
    const lo  = r.rankedWorkflows.find(w => w.workflowId === 72)!;

    expect(hi.comparativeRiskScore).toBeGreaterThanOrEqual(mod.comparativeRiskScore);
    expect(mod.comparativeRiskScore).toBeGreaterThanOrEqual(lo.comparativeRiskScore);
  });

  it("confidence multipliers are monotonically decreasing low→high", () => {
    const base: WorkflowIntelligenceSnapshot = {
      workflowId: 80, workflowName: "Base", stepCount: 10,
      runtimeWeightedComplexity: 60, structuralComplexity: 60,
      fragilityLevel: "high", hotspotCount: 0,
      projectedComplexity: 60, trendDirection: "stable", confidenceLevel: "high",
    };
    const r = run([
      { ...base, workflowId: 80, confidenceLevel: "high"     },
      { ...base, workflowId: 81, confidenceLevel: "moderate" },
      { ...base, workflowId: 82, confidenceLevel: "low"      },
    ]);
    const scores = Object.fromEntries(r.rankedWorkflows.map(w => [w.workflowId, w.comparativeRiskScore]));
    expect(scores[80]).toBeGreaterThanOrEqual(scores[81]!);
    expect(scores[81]).toBeGreaterThanOrEqual(scores[82]!);
  });

  it("low-confidence workflow ranks lower than high-confidence (same scores before multiplier)", () => {
    const hiConf: WorkflowIntelligenceSnapshot = {
      workflowId: 90, workflowName: "HiConf",
      stepCount: 10, runtimeWeightedComplexity: 55, structuralComplexity: 55,
      fragilityLevel: "moderate", hotspotCount: 1,
      projectedComplexity: 55, trendDirection: "stable", confidenceLevel: "high",
    };
    const loConf: WorkflowIntelligenceSnapshot = { ...hiConf, workflowId: 91, workflowName: "LoConf", confidenceLevel: "low" };
    const r = run([loConf, hiConf]);
    expect(r.rankedWorkflows[0]!.workflowId).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - hotspot concentration detection stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: hotspot concentration detection stable", () => {
  it("no dominant workflows when all scores are low", () => {
    const r = run([SNAPSHOT_LOW]);
    expect(r.hotspotConcentration.dominantWorkflowCount).toBe(0);
    expect(r.hotspotConcentration.concentrationRatio).toBe(0);
  });

  it("critical workflow is counted as dominant (score >= 70)", () => {
    const r = run([SNAPSHOT_CRITICAL]);
    expect(r.hotspotConcentration.dominantWorkflowCount).toBe(1);
    expect(r.hotspotConcentration.concentrationRatio).toBe(1);
  });

  it("concentration ratio = dominantCount / totalCount", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_LOW, SNAPSHOT_CRITICAL]);
    const { dominantWorkflowCount, concentrationRatio } = r.hotspotConcentration;
    const expected = Math.round((dominantWorkflowCount / 3) * 1000) / 1000;
    expect(concentrationRatio).toBe(expected);
  });

  it("chronicHotspotWorkflowCount counts workflows with hotspotCount >= 2", () => {
    const wfHotspot: WorkflowIntelligenceSnapshot = {
      ...SNAPSHOT_HIGH, workflowId: 100, hotspotCount: 2,
    };
    const wfNoHotspot: WorkflowIntelligenceSnapshot = {
      ...SNAPSHOT_LOW, workflowId: 101, hotspotCount: 1,
    };
    const r = run([wfHotspot, wfNoHotspot]);
    expect(r.hotspotConcentration.chronicHotspotWorkflowCount).toBe(1);
  });

  it("criticallyDegradingCount counts critically_degrading workflows", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_CRITICAL]);
    expect(r.hotspotConcentration.criticallyDegradingCount).toBe(1);
  });

  it("topRiskWorkflowId is the rank-1 workflow's id", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_CRITICAL, SNAPSHOT_MODERATE]);
    expect(r.hotspotConcentration.topRiskWorkflowId).toBe(r.rankedWorkflows[0]!.workflowId);
  });

  it("empty input produces zero-filled concentration result", () => {
    const r = run([]);
    expect(r.hotspotConcentration.dominantWorkflowCount).toBe(0);
    expect(r.hotspotConcentration.concentrationRatio).toBe(0);
    expect(r.hotspotConcentration.topRiskWorkflowId).toBeNull();
    expect(r.hotspotConcentration.topRiskScore).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - comparative serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: comparative serialization stable", () => {
  it("result is JSON round-trip safe (no undefined, no circular refs)", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_MODERATE, SNAPSHOT_HIGH, SNAPSHOT_CRITICAL]);
    expect(() => JSON.stringify(r)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(r));
    expect(parsed.rankedWorkflows).toHaveLength(4);
    expect(parsed.hotspotConcentration).toBeDefined();
    expect(parsed.totalWorkflows).toBe(4);
  });

  it("each ranked workflow has all required fields", () => {
    const required = [
      "workflowId", "workflowName", "stepCount", "comparativeRiskScore",
      "runtimeWeightedComplexity", "projectedComplexity", "fragilityLevel",
      "trendDirection", "hotspotCount", "operationalPriority",
      "workspaceRank", "confidenceLevel",
    ];
    const r = run([SNAPSHOT_HIGH]);
    const wf = r.rankedWorkflows[0]!;
    for (const key of required) {
      expect(wf).toHaveProperty(key);
    }
  });

  it("hotspotConcentration has all required fields", () => {
    const required = [
      "dominantWorkflowCount", "concentrationRatio", "chronicHotspotWorkflowCount",
      "criticallyDegradingCount", "urgentOrCriticalCount",
      "topRiskWorkflowId", "topRiskScore",
    ];
    const r = run([SNAPSHOT_CRITICAL]);
    for (const key of required) {
      expect(r.hotspotConcentration).toHaveProperty(key);
    }
  });

  it("workspaceRanks are sequential integers starting at 1", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_MODERATE, SNAPSHOT_HIGH, SNAPSHOT_CRITICAL]);
    for (let i = 0; i < r.rankedWorkflows.length; i++) {
      expect(r.rankedWorkflows[i]!.workspaceRank).toBe(i + 1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - no live runtime dependency required
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: no live runtime dependency required", () => {
  it("runs successfully with zero snapshots (no DB, no network required)", () => {
    expect(() => run([])).not.toThrow();
  });

  it("runs successfully with all-zero metric snapshots", () => {
    const zero: WorkflowIntelligenceSnapshot = {
      workflowId: 1, workflowName: "Zero", stepCount: 0,
      runtimeWeightedComplexity: 0, structuralComplexity: 0,
      fragilityLevel: "low", hotspotCount: 0,
      projectedComplexity: 0, trendDirection: "stable", confidenceLevel: "low",
    };
    const r = run([zero]);
    expect(r.rankedWorkflows[0]!.comparativeRiskScore).toBeGreaterThanOrEqual(0);
    expect(r.rankedWorkflows[0]!.comparativeRiskScore).toBeLessThanOrEqual(100);
  });

  it("handles maximum values without overflow", () => {
    const max: WorkflowIntelligenceSnapshot = {
      workflowId: 99, workflowName: "Max", stepCount: 100,
      runtimeWeightedComplexity: 100, structuralComplexity: 100,
      fragilityLevel: "critical", hotspotCount: 999,
      projectedComplexity: 100, trendDirection: "critically_degrading", confidenceLevel: "high",
    };
    const r = run([max]);
    expect(r.rankedWorkflows[0]!.comparativeRiskScore).toBe(100);
  });

  it("snapshot array with 100 workflows processes without error", () => {
    const snapshots: WorkflowIntelligenceSnapshot[] = Array.from({ length: 100 }, (_, i) => ({
      workflowId: i + 1, workflowName: `WF${i + 1}`, stepCount: 5 + i,
      runtimeWeightedComplexity: i,   structuralComplexity: i,
      fragilityLevel: "low" as const, hotspotCount: 0,
      projectedComplexity: i,         trendDirection: "stable" as const,
      confidenceLevel: "moderate" as const,
    }));
    const r = run(snapshots);
    expect(r.totalWorkflows).toBe(100);
    expect(r.rankedWorkflows).toHaveLength(100);
  });

  it("result shape is consistent regardless of snapshot content", () => {
    const r = run([SNAPSHOT_LOW]);
    expect(typeof r.totalWorkflows).toBe("number");
    expect(Array.isArray(r.rankedWorkflows)).toBe(true);
    expect(typeof r.hotspotConcentration).toBe("object");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - comparative engine remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: comparative engine remains read-only", () => {
  it("input snapshot array is not mutated", () => {
    const snapshots: WorkflowIntelligenceSnapshot[] = [
      { ...SNAPSHOT_LOW },
      { ...SNAPSHOT_HIGH },
    ];
    const originalOrder = snapshots.map(s => s.workflowId);
    run(snapshots);
    expect(snapshots.map(s => s.workflowId)).toEqual(originalOrder);
  });

  it("input snapshot objects are not mutated", () => {
    const snap = { ...SNAPSHOT_CRITICAL };
    // Record original values (WorkflowIntelligenceSnapshot has no comparativeRiskScore - that is engine output only)
    const originalRwc    = snap.runtimeWeightedComplexity;
    const originalTrend  = snap.trendDirection;
    const originalFrag   = snap.fragilityLevel;
    run([snap]);
    expect(snap.runtimeWeightedComplexity).toBe(originalRwc);
    expect(snap.trendDirection).toBe(originalTrend);
    expect(snap.fragilityLevel).toBe(originalFrag);
  });

  it("calling the engine twice with same input yields identical results", () => {
    const snapshots = [SNAPSHOT_LOW, SNAPSHOT_MODERATE, SNAPSHOT_HIGH];
    const r1 = run(snapshots);
    const r2 = run(snapshots);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("output rankedWorkflows array is independent per call (not shared reference)", () => {
    const r1 = run([SNAPSHOT_LOW]);
    const r2 = run([SNAPSHOT_HIGH]);
    expect(r1.rankedWorkflows[0]!.workflowId).not.toBe(r2.rankedWorkflows[0]!.workflowId);
  });

  it("result contains no functions or class instances (plain data only)", () => {
    const r = run([SNAPSHOT_LOW, SNAPSHOT_CRITICAL]);
    const str = JSON.stringify(r);
    const parsed = JSON.parse(str);
    expect(typeof parsed.totalWorkflows).toBe("number");
    expect(Array.isArray(parsed.rankedWorkflows)).toBe(true);
  });
});
