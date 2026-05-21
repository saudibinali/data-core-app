/**
 * @file   __tests__/governance-signals.test.ts
 * @phase  P8-F - Proactive Governance Signals & Advisory Intelligence Foundations
 *
 * T1   urgent governance signal generation
 * T2   critical degradation escalation signal
 * T3   signal deduplication stability
 * T4   cooldown windows prevent advisory storms
 * T5   fragility-growth advisory generation
 * T6   hotspot concentration advisory generation
 * T7   signal expiration handled correctly
 * T8   advisory serialization stable
 * T9   no live runtime dependency required
 * T10  advisory engine remains read-only
 */

import { describe, it, expect } from "vitest";
import {
  generateGovernanceSignals,
  makeSignalFingerprint,
  type GovernanceSignalInput,
  type GovernanceSignalContext,
  type GovernanceSignal,
  type WorkflowForecastSummary,
} from "../governance-signals";
import type {
  WorkflowComparativeIntelligence,
  WorkspaceHotspotConcentration,
} from "../comparative-intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed timestamp for deterministic output across all tests. */
const FIXED_TIME = new Date("2026-05-15T10:00:00.000Z");
const CTX: GovernanceSignalContext = { evaluationTime: FIXED_TIME, evaluationId: "test" };

/** Build a minimal WorkflowComparativeIntelligence fixture. */
function makeWF(
  overrides: Partial<WorkflowComparativeIntelligence> & { workflowId: number },
): WorkflowComparativeIntelligence {
  return {
    workflowId:                overrides.workflowId,
    workflowName:              overrides.workflowName              ?? `WF-${overrides.workflowId}`,
    stepCount:                 overrides.stepCount                 ?? 5,
    comparativeRiskScore:      overrides.comparativeRiskScore      ?? 10,
    runtimeWeightedComplexity: overrides.runtimeWeightedComplexity ?? 10,
    projectedComplexity:       overrides.projectedComplexity       ?? 10,
    fragilityLevel:            overrides.fragilityLevel            ?? "low",
    trendDirection:            overrides.trendDirection            ?? "stable",
    hotspotCount:              overrides.hotspotCount              ?? 0,
    operationalPriority:       overrides.operationalPriority       ?? "informational",
    workspaceRank:             overrides.workspaceRank             ?? 1,
    confidenceLevel:           overrides.confidenceLevel           ?? "high",
  };
}

/** Build a minimal WorkspaceHotspotConcentration fixture with safe defaults. */
function makeConcentration(
  overrides: Partial<WorkspaceHotspotConcentration> = {},
): WorkspaceHotspotConcentration {
  return {
    dominantWorkflowCount:       overrides.dominantWorkflowCount       ?? 0,
    concentrationRatio:          overrides.concentrationRatio          ?? 0,
    chronicHotspotWorkflowCount: overrides.chronicHotspotWorkflowCount ?? 0,
    criticallyDegradingCount:    overrides.criticallyDegradingCount    ?? 0,
    urgentOrCriticalCount:       overrides.urgentOrCriticalCount       ?? 0,
    topRiskWorkflowId:           overrides.topRiskWorkflowId           ?? null,
    topRiskScore:                overrides.topRiskScore                ?? 0,
  };
}

/** Build a minimal GovernanceSignalInput. */
function makeInput(
  partial: Partial<GovernanceSignalInput> & { workspaceId?: number } = {},
): GovernanceSignalInput {
  return {
    rankedWorkflows:      partial.rankedWorkflows      ?? [],
    hotspotConcentration: partial.hotspotConcentration ?? makeConcentration(),
    workspaceId:          partial.workspaceId          ?? 1,
    totalWorkflows:       partial.totalWorkflows        ?? (partial.rankedWorkflows?.length ?? 0),
    workflowForecasts:    partial.workflowForecasts,
    priorSignalFingerprints: partial.priorSignalFingerprints,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const WF_LOW = makeWF({
  workflowId:           1,
  workflowName:         "Low Risk WF",
  comparativeRiskScore: 8,
  fragilityLevel:       "low",
  trendDirection:       "stable",
  operationalPriority:  "informational",
  workspaceRank:        4,
});

const WF_WATCH = makeWF({
  workflowId:           2,
  workflowName:         "Watch WF",
  comparativeRiskScore: 20,
  fragilityLevel:       "moderate",
  trendDirection:       "stable",
  operationalPriority:  "watch",
  workspaceRank:        3,
});

const WF_URGENT = makeWF({
  workflowId:                3,
  workflowName:              "Urgent WF",
  comparativeRiskScore:      60,
  runtimeWeightedComplexity: 55,
  projectedComplexity:       62,
  fragilityLevel:            "high",
  trendDirection:            "degrading",
  hotspotCount:              2,
  operationalPriority:       "urgent",
  workspaceRank:             2,
});

const WF_CRITICAL = makeWF({
  workflowId:                4,
  workflowName:              "Critical WF",
  comparativeRiskScore:      90,
  runtimeWeightedComplexity: 85,
  projectedComplexity:       92,
  fragilityLevel:            "critical",
  trendDirection:            "critically_degrading",
  hotspotCount:              3,
  operationalPriority:       "critical",
  workspaceRank:             1,
});

const WF_ESCALATING = makeWF({
  workflowId:           5,
  workflowName:         "Escalating WF",
  comparativeRiskScore: 40,
  fragilityLevel:       "moderate",
  trendDirection:       "critically_degrading",
  operationalPriority:  "elevated",
  workspaceRank:        2,
});

const HIGH_CONCENTRATION = makeConcentration({
  dominantWorkflowCount:       3,
  concentrationRatio:          0.60,
  chronicHotspotWorkflowCount: 2,
  criticallyDegradingCount:    1,
  urgentOrCriticalCount:       3,
  topRiskWorkflowId:           4,
  topRiskScore:                90,
});

const MODERATE_CONCENTRATION = makeConcentration({
  dominantWorkflowCount:       1,
  concentrationRatio:          0.30,
  chronicHotspotWorkflowCount: 1,
  criticallyDegradingCount:    1,
  urgentOrCriticalCount:       1,
  topRiskWorkflowId:           4,
  topRiskScore:                80,
});

const LOW_CONCENTRATION = makeConcentration({
  dominantWorkflowCount:       0,
  concentrationRatio:          0.10,
  chronicHotspotWorkflowCount: 0,
  criticallyDegradingCount:    0,
  urgentOrCriticalCount:       0,
  topRiskWorkflowId:           null,
  topRiskScore:                0,
});

const FORECAST_LOW_STORM: WorkflowForecastSummary = {
  workflowId: 1,
  projectedStormRisk: 0.05,
  projectedBacklogPressure: 0.10,
};

const FORECAST_HIGH_STORM: WorkflowForecastSummary = {
  workflowId: 3,
  projectedStormRisk: 0.40,
  projectedBacklogPressure: 0.35,
};

const FORECAST_MEDIUM_STORM: WorkflowForecastSummary = {
  workflowId: 4,
  projectedStormRisk: 0.20,
  projectedBacklogPressure: 0.25,
};

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Urgent governance signal generation
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 urgent governance signal generation", () => {
  it("emits GOV-WORKFLOW-URGENT for a workflow with operationalPriority=urgent", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_URGENT], totalWorkflows: 1 }),
      CTX,
    );
    const urgentSignals = result.signals.filter(s => s.signalCode === "GOV-WORKFLOW-URGENT");
    expect(urgentSignals).toHaveLength(1);
    expect(urgentSignals[0]!.affectedWorkflowId).toBe(WF_URGENT.workflowId);
    expect(urgentSignals[0]!.severity).toBe("high");
    expect(urgentSignals[0]!.category).toBe("operational_priority");
  });

  it("advisory level for urgent-only workflow is at least urgent", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_URGENT], totalWorkflows: 1 }),
      CTX,
    );
    const validLevels = ["urgent", "critical"] as const;
    expect(validLevels).toContain(result.advisoryLevel);
  });

  it("does NOT emit GOV-WORKFLOW-URGENT for informational or watch workflows", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_LOW, WF_WATCH], totalWorkflows: 2 }),
      CTX,
    );
    const urgentSignals = result.signals.filter(s => s.signalCode === "GOV-WORKFLOW-URGENT");
    expect(urgentSignals).toHaveLength(0);
  });

  it("advisory message for GOV-WORKFLOW-URGENT contains workflow name and score", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_URGENT], totalWorkflows: 1 }),
      CTX,
    );
    const sig = result.signals.find(s => s.signalCode === "GOV-WORKFLOW-URGENT")!;
    expect(sig.advisoryMessage).toContain(WF_URGENT.workflowName);
    expect(sig.advisoryMessage).toContain(String(WF_URGENT.comparativeRiskScore));
  });

  it("GOV-WORKFLOW-URGENT supporting indicators list workspaceRank and operationalPriority", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_URGENT], totalWorkflows: 1 }),
      CTX,
    );
    const sig = result.signals.find(s => s.signalCode === "GOV-WORKFLOW-URGENT")!;
    expect(sig.supportingIndicators.some(i => i.startsWith("workspaceRank:"))).toBe(true);
    expect(sig.supportingIndicators.some(i => i === "operationalPriority:urgent")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Critical degradation escalation signal
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 critical degradation escalation signal", () => {
  it("emits GOV-WORKFLOW-ESCALATING for critically_degrading trend", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_ESCALATING], totalWorkflows: 1 }),
      CTX,
    );
    const escalatingSignals = result.signals.filter(s => s.signalCode === "GOV-WORKFLOW-ESCALATING");
    expect(escalatingSignals).toHaveLength(1);
    expect(escalatingSignals[0]!.affectedWorkflowId).toBe(WF_ESCALATING.workflowId);
    expect(escalatingSignals[0]!.category).toBe("degradation");
  });

  it("emits GOV-WORKFLOW-ESCALATING independently from GOV-WORKFLOW-CRITICAL (different dimensions)", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    const codes = result.signals.map(s => s.signalCode);
    expect(codes).toContain("GOV-WORKFLOW-CRITICAL");
    expect(codes).toContain("GOV-WORKFLOW-ESCALATING");
  });

  it("advisory level for critically_degrading trend is at least elevated", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_ESCALATING], totalWorkflows: 1 }),
      CTX,
    );
    const validLevels = ["elevated", "urgent", "critical"] as const;
    expect(validLevels).toContain(result.advisoryLevel);
  });

  it("does NOT emit GOV-WORKFLOW-ESCALATING for stable or degrading trends", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_LOW, WF_WATCH, WF_URGENT], totalWorkflows: 3 }),
      CTX,
    );
    const escalatingSignals = result.signals.filter(s => s.signalCode === "GOV-WORKFLOW-ESCALATING");
    expect(escalatingSignals).toHaveLength(0);
  });

  it("GOV-WORKFLOW-ESCALATING advisory message describes trend acceleration", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_ESCALATING], totalWorkflows: 1 }),
      CTX,
    );
    const sig = result.signals.find(s => s.signalCode === "GOV-WORKFLOW-ESCALATING")!;
    expect(sig.advisoryMessage).toContain(WF_ESCALATING.workflowName);
    expect(sig.advisoryMessage.toLowerCase()).toMatch(/trend|degrading|accelerat/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Signal deduplication stability
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 signal deduplication stability", () => {
  it("each (signalCode, workflowId) pair is emitted at most once per evaluation", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows: [WF_CRITICAL, WF_URGENT, WF_ESCALATING],
        totalWorkflows: 3,
      }),
      CTX,
    );
    const fingerprints = result.signals.map(s =>
      makeSignalFingerprint(s.signalCode, s.affectedWorkflowId, s.workspaceId),
    );
    const unique = new Set(fingerprints);
    expect(fingerprints.length).toBe(unique.size);
  });

  it("calling the engine twice with identical inputs yields the same deduplication result", () => {
    const input = makeInput({ rankedWorkflows: [WF_CRITICAL, WF_URGENT], totalWorkflows: 2 });
    const r1 = generateGovernanceSignals(input, CTX);
    const r2 = generateGovernanceSignals(input, CTX);
    expect(r1.totalSignals).toBe(r2.totalSignals);
    expect(r1.deduplicatedCount).toBe(r2.deduplicatedCount);
    expect(r1.signals.map(s => s.signalCode)).toEqual(r2.signals.map(s => s.signalCode));
  });

  it("workspace-level concentration signal is never duplicated even if called multiple times", () => {
    const input = makeInput({
      rankedWorkflows: [WF_CRITICAL, WF_URGENT],
      hotspotConcentration: HIGH_CONCENTRATION,
      totalWorkflows: 5,
    });
    const r1 = generateGovernanceSignals(input, CTX);
    const concentrationSignals = r1.signals.filter(
      s => s.signalCode === "GOV-HOTSPOT-CONCENTRATION",
    );
    expect(concentrationSignals.length).toBeLessThanOrEqual(1);
  });

  it("signals are sorted: critical severity first, then high, then by signalCode ASC", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows: [WF_CRITICAL, WF_URGENT],
        hotspotConcentration: HIGH_CONCENTRATION,
        totalWorkflows: 5,
      }),
      CTX,
    );
    for (let i = 1; i < result.signals.length; i++) {
      const prev = result.signals[i - 1]!;
      const curr = result.signals[i]!;
      const sevOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      const prevW = sevOrder[prev.severity] ?? 0;
      const currW = sevOrder[curr.severity] ?? 0;
      expect(prevW).toBeGreaterThanOrEqual(currW);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Cooldown windows prevent advisory storms
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 cooldown windows prevent advisory storms", () => {
  it("prior fingerprints suppress matching signals (external cooldown)", () => {
    const urgentFp = makeSignalFingerprint("GOV-WORKFLOW-URGENT", WF_URGENT.workflowId, 1);
    const input = makeInput({
      rankedWorkflows: [WF_URGENT],
      totalWorkflows: 1,
      priorSignalFingerprints: new Set([urgentFp]),
    });
    const result = generateGovernanceSignals(input, CTX);
    const urgentSignals = result.signals.filter(s => s.signalCode === "GOV-WORKFLOW-URGENT");
    expect(urgentSignals).toHaveLength(0);
    expect(result.deduplicatedCount).toBeGreaterThanOrEqual(1);
  });

  it("suppressed signals are counted in deduplicatedCount", () => {
    const criticalFp  = makeSignalFingerprint("GOV-WORKFLOW-CRITICAL",  WF_CRITICAL.workflowId, 1);
    const escalateFp  = makeSignalFingerprint("GOV-WORKFLOW-ESCALATING", WF_CRITICAL.workflowId, 1);
    const input = makeInput({
      rankedWorkflows: [WF_CRITICAL],
      totalWorkflows: 1,
      priorSignalFingerprints: new Set([criticalFp, escalateFp]),
    });
    const result = generateGovernanceSignals(input, CTX);
    expect(result.deduplicatedCount).toBeGreaterThanOrEqual(2);
  });

  it("non-matching prior fingerprints do not suppress unrelated signals", () => {
    const unrelatedFp = makeSignalFingerprint("GOV-WORKFLOW-URGENT", 999, 1);
    const input = makeInput({
      rankedWorkflows: [WF_CRITICAL],
      totalWorkflows: 1,
      priorSignalFingerprints: new Set([unrelatedFp]),
    });
    const result = generateGovernanceSignals(input, CTX);
    const criticalSignals = result.signals.filter(s => s.signalCode === "GOV-WORKFLOW-CRITICAL");
    expect(criticalSignals).toHaveLength(1);
  });

  it("empty priorSignalFingerprints set behaves same as no prior fingerprints", () => {
    const withEmpty = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1, priorSignalFingerprints: new Set() }),
      CTX,
    );
    const withUndefined = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    expect(withEmpty.totalSignals).toBe(withUndefined.totalSignals);
    expect(withEmpty.deduplicatedCount).toBe(withUndefined.deduplicatedCount);
  });

  it("suppressing all signals yields informational advisory level", () => {
    const input = makeInput({ rankedWorkflows: [WF_URGENT], totalWorkflows: 1 });
    const firstRun = generateGovernanceSignals(input, CTX);
    const allFingerprints = new Set(
      firstRun.signals.map(s =>
        makeSignalFingerprint(s.signalCode, s.affectedWorkflowId, s.workspaceId),
      ),
    );
    const secondRun = generateGovernanceSignals(
      { ...input, priorSignalFingerprints: allFingerprints },
      CTX,
    );
    expect(secondRun.advisoryLevel).toBe("informational");
    expect(secondRun.totalSignals).toBe(0);
    expect(secondRun.deduplicatedCount).toBe(firstRun.totalSignals);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Fragility-growth advisory generation
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 fragility-growth advisory generation", () => {
  it("emits GOV-FRAGILITY-GROWTH for fragilityLevel=high with severity=high", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_URGENT], totalWorkflows: 1 }),
      CTX,
    );
    const fragilitySignals = result.signals.filter(s => s.signalCode === "GOV-FRAGILITY-GROWTH");
    expect(fragilitySignals).toHaveLength(1);
    expect(fragilitySignals[0]!.severity).toBe("high");
    expect(fragilitySignals[0]!.affectedWorkflowId).toBe(WF_URGENT.workflowId);
  });

  it("emits GOV-FRAGILITY-GROWTH for fragilityLevel=critical with severity=critical", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    const fragilitySignals = result.signals.filter(s => s.signalCode === "GOV-FRAGILITY-GROWTH");
    const criticalFragility = fragilitySignals.find(s => s.severity === "critical");
    expect(criticalFragility).toBeDefined();
    expect(criticalFragility!.category).toBe("fragility");
  });

  it("does NOT emit GOV-FRAGILITY-GROWTH for fragilityLevel=low or moderate", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_LOW, WF_WATCH], totalWorkflows: 2 }),
      CTX,
    );
    const fragilitySignals = result.signals.filter(s => s.signalCode === "GOV-FRAGILITY-GROWTH");
    expect(fragilitySignals).toHaveLength(0);
  });

  it("GOV-FRAGILITY-GROWTH advisory message contains fragilityLevel and rWC", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_URGENT], totalWorkflows: 1 }),
      CTX,
    );
    const sig = result.signals.find(s => s.signalCode === "GOV-FRAGILITY-GROWTH")!;
    expect(sig.advisoryMessage).toContain(WF_URGENT.fragilityLevel);
    expect(sig.advisoryMessage).toContain(String(WF_URGENT.runtimeWeightedComplexity));
  });

  it("GOV-FRAGILITY-GROWTH supporting indicators include fragilityLevel and hotspotCount", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    const sig = result.signals.find(s => s.signalCode === "GOV-FRAGILITY-GROWTH")!;
    expect(sig.supportingIndicators.some(i => i.startsWith("fragilityLevel:"))).toBe(true);
    expect(sig.supportingIndicators.some(i => i.startsWith("hotspotCount:"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Hotspot concentration advisory generation
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 hotspot concentration advisory generation", () => {
  it("emits GOV-HOTSPOT-CONCENTRATION when concentrationRatio exceeds threshold (> 0.25)", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:      [WF_CRITICAL, WF_URGENT],
        hotspotConcentration: MODERATE_CONCENTRATION,
        totalWorkflows:       5,
      }),
      CTX,
    );
    const concentrationSignals = result.signals.filter(
      s => s.signalCode === "GOV-HOTSPOT-CONCENTRATION",
    );
    expect(concentrationSignals).toHaveLength(1);
    expect(concentrationSignals[0]!.affectedWorkflowId).toBeNull();
    expect(concentrationSignals[0]!.category).toBe("hotspot_concentration");
  });

  it("concentration signal has severity=critical when ratio >= 0.50", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:      [WF_CRITICAL, WF_URGENT],
        hotspotConcentration: HIGH_CONCENTRATION,
        totalWorkflows:       5,
      }),
      CTX,
    );
    const sig = result.signals.find(s => s.signalCode === "GOV-HOTSPOT-CONCENTRATION")!;
    expect(sig.severity).toBe("critical");
  });

  it("does NOT emit GOV-HOTSPOT-CONCENTRATION when concentrationRatio is below threshold", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:      [WF_LOW, WF_WATCH],
        hotspotConcentration: LOW_CONCENTRATION,
        totalWorkflows:       10,
      }),
      CTX,
    );
    const concentrationSignals = result.signals.filter(
      s => s.signalCode === "GOV-HOTSPOT-CONCENTRATION",
    );
    expect(concentrationSignals).toHaveLength(0);
  });

  it("concentration advisory message cites dominantCount and totalWorkflows", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:      [WF_CRITICAL, WF_URGENT],
        hotspotConcentration: HIGH_CONCENTRATION,
        totalWorkflows:       5,
      }),
      CTX,
    );
    const sig = result.signals.find(s => s.signalCode === "GOV-HOTSPOT-CONCENTRATION")!;
    expect(sig.advisoryMessage).toContain(String(HIGH_CONCENTRATION.dominantWorkflowCount));
    expect(sig.advisoryMessage).toContain("5");
  });

  it("concentration signal supporting indicators include concentrationRatio and urgentOrCriticalCount", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:      [WF_CRITICAL],
        hotspotConcentration: HIGH_CONCENTRATION,
        totalWorkflows:       5,
      }),
      CTX,
    );
    const sig = result.signals.find(s => s.signalCode === "GOV-HOTSPOT-CONCENTRATION")!;
    expect(sig.supportingIndicators.some(i => i.startsWith("concentrationRatio:"))).toBe(true);
    expect(sig.supportingIndicators.some(i => i.startsWith("urgentOrCriticalCount:"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - Signal expiration handled correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 signal expiration handled correctly", () => {
  it("expiresAt is strictly after generatedAt for every signal", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:      [WF_CRITICAL, WF_URGENT, WF_ESCALATING],
        hotspotConcentration: HIGH_CONCENTRATION,
        totalWorkflows:       3,
        workflowForecasts:    [FORECAST_HIGH_STORM],
      }),
      CTX,
    );
    for (const sig of result.signals) {
      expect(new Date(sig.expiresAt).getTime()).toBeGreaterThan(
        new Date(sig.generatedAt).getTime(),
      );
    }
  });

  it("GOV-WORKFLOW-CRITICAL expires in 60 minutes", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    const sig = result.signals.find(s => s.signalCode === "GOV-WORKFLOW-CRITICAL")!;
    const ttlMs = new Date(sig.expiresAt).getTime() - new Date(sig.generatedAt).getTime();
    expect(ttlMs).toBe(60 * 60 * 1000);
  });

  it("GOV-STORM-RISK-GROWTH expires later than GOV-WORKFLOW-CRITICAL (longer TTL)", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:   [WF_CRITICAL],
        totalWorkflows:    1,
        workflowForecasts: [{ workflowId: WF_CRITICAL.workflowId, projectedStormRisk: 0.40, projectedBacklogPressure: 0.25 }],
      }),
      CTX,
    );
    const criticalSig  = result.signals.find(s => s.signalCode === "GOV-WORKFLOW-CRITICAL")!;
    const stormSig     = result.signals.find(s => s.signalCode === "GOV-STORM-RISK-GROWTH")!;
    expect(stormSig).toBeDefined();
    expect(new Date(stormSig.expiresAt).getTime()).toBeGreaterThan(
      new Date(criticalSig.expiresAt).getTime(),
    );
  });

  it("generatedAt equals evaluationTime for all signals (deterministic timestamp)", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    for (const sig of result.signals) {
      expect(sig.generatedAt).toBe(FIXED_TIME.toISOString());
    }
  });

  it("evaluatedAt equals evaluationTime", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    expect(result.evaluatedAt).toBe(FIXED_TIME.toISOString());
  });

  it("expiresAt values are valid ISO 8601 date strings", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_URGENT, WF_CRITICAL], totalWorkflows: 2 }),
      CTX,
    );
    for (const sig of result.signals) {
      expect(() => new Date(sig.expiresAt)).not.toThrow();
      expect(new Date(sig.expiresAt).toISOString()).toBe(sig.expiresAt);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Advisory serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 advisory serialization stable", () => {
  it("result round-trips losslessly through JSON.stringify / JSON.parse", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:      [WF_CRITICAL, WF_URGENT, WF_ESCALATING],
        hotspotConcentration: HIGH_CONCENTRATION,
        totalWorkflows:       3,
      }),
      CTX,
    );
    const serialized   = JSON.stringify(result);
    const deserialized = JSON.parse(serialized) as typeof result;
    expect(deserialized.totalSignals).toBe(result.totalSignals);
    expect(deserialized.advisoryLevel).toBe(result.advisoryLevel);
    expect(deserialized.signals).toHaveLength(result.signals.length);
  });

  it("every signal has all required fields", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:      [WF_CRITICAL, WF_URGENT],
        hotspotConcentration: HIGH_CONCENTRATION,
        totalWorkflows:       5,
      }),
      CTX,
    );
    for (const sig of result.signals) {
      expect(sig.signalCode).toBeDefined();
      expect(sig.severity).toBeDefined();
      expect(sig.category).toBeDefined();
      expect(sig.workspaceId).toBeDefined();
      expect(sig.advisoryMessage).toBeTruthy();
      expect(Array.isArray(sig.supportingIndicators)).toBe(true);
      expect(sig.generatedAt).toBeTruthy();
      expect(sig.expiresAt).toBeTruthy();
    }
  });

  it("advisoryLevel is always a valid GovernanceAdvisoryLevel enum value", () => {
    const validLevels = ["informational", "advisory", "elevated", "urgent", "critical"];
    const cases = [
      makeInput({ rankedWorkflows: [] }),
      makeInput({ rankedWorkflows: [WF_LOW, WF_WATCH] }),
      makeInput({ rankedWorkflows: [WF_URGENT] }),
      makeInput({ rankedWorkflows: [WF_CRITICAL] }),
    ];
    for (const input of cases) {
      const result = generateGovernanceSignals(input, CTX);
      expect(validLevels).toContain(result.advisoryLevel);
    }
  });

  it("result contains no undefined values (JSON-safe output)", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    const json = JSON.stringify(result);
    expect(json).not.toContain("undefined");
    expect(json.length).toBeGreaterThan(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - No live runtime dependency required
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 no live runtime dependency required", () => {
  it("runs with empty workflow list without crashing", () => {
    const result = generateGovernanceSignals(makeInput({}), CTX);
    expect(result.totalSignals).toBe(0);
    expect(result.advisoryLevel).toBe("informational");
    expect(result.signals).toHaveLength(0);
  });

  it("handles all-zero / all-low-risk input gracefully", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_LOW, WF_WATCH], totalWorkflows: 2 }),
      CTX,
    );
    expect(result.signals.length).toBeGreaterThanOrEqual(0);
    expect(result.advisoryLevel).toBeDefined();
  });

  it("handles maximum-intensity scenario without throwing", () => {
    const maxInput = makeInput({
      rankedWorkflows: Array.from({ length: 20 }, (_, i) =>
        makeWF({
          workflowId:           i + 1,
          comparativeRiskScore: 100,
          fragilityLevel:       "critical",
          trendDirection:       "critically_degrading",
          operationalPriority:  "critical",
          workspaceRank:        i + 1,
        }),
      ),
      hotspotConcentration: HIGH_CONCENTRATION,
      totalWorkflows:       20,
    });
    expect(() => generateGovernanceSignals(maxInput, CTX)).not.toThrow();
  });

  it("storm risk signals are gracefully skipped when workflowForecasts is absent", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    const stormSignals = result.signals.filter(s => s.signalCode === "GOV-STORM-RISK-GROWTH");
    expect(stormSignals).toHaveLength(0);
  });

  it("emits GOV-STORM-RISK-GROWTH when forecast data is provided with high storm risk", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:   [WF_URGENT],
        totalWorkflows:    1,
        workflowForecasts: [FORECAST_HIGH_STORM],
      }),
      CTX,
    );
    const stormSignals = result.signals.filter(s => s.signalCode === "GOV-STORM-RISK-GROWTH");
    expect(stormSignals).toHaveLength(1);
    expect(stormSignals[0]!.severity).toBe("high");
    expect(stormSignals[0]!.affectedWorkflowId).toBe(FORECAST_HIGH_STORM.workflowId);
  });

  it("does NOT emit GOV-STORM-RISK-GROWTH for low projected storm risk", () => {
    const result = generateGovernanceSignals(
      makeInput({
        rankedWorkflows:   [WF_LOW],
        totalWorkflows:    1,
        workflowForecasts: [FORECAST_LOW_STORM],
      }),
      CTX,
    );
    const stormSignals = result.signals.filter(s => s.signalCode === "GOV-STORM-RISK-GROWTH");
    expect(stormSignals).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Advisory engine remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 advisory engine remains read-only", () => {
  it("input rankedWorkflows array is not mutated by the engine", () => {
    const wfs = [WF_CRITICAL, WF_URGENT, WF_ESCALATING];
    const original = wfs.map(w => w.workflowId);
    generateGovernanceSignals(makeInput({ rankedWorkflows: wfs, totalWorkflows: 3 }), CTX);
    expect(wfs.map(w => w.workflowId)).toEqual(original);
  });

  it("input workflow objects are not mutated by the engine", () => {
    const wf = { ...WF_CRITICAL };
    const originalScore = wf.comparativeRiskScore;
    const originalPriority = wf.operationalPriority;
    generateGovernanceSignals(makeInput({ rankedWorkflows: [wf], totalWorkflows: 1 }), CTX);
    expect(wf.comparativeRiskScore).toBe(originalScore);
    expect(wf.operationalPriority).toBe(originalPriority);
  });

  it("calling the engine twice with same input and time yields identical outputs", () => {
    const input = makeInput({
      rankedWorkflows:      [WF_CRITICAL, WF_URGENT, WF_ESCALATING],
      hotspotConcentration: HIGH_CONCENTRATION,
      totalWorkflows:       3,
    });
    const r1 = generateGovernanceSignals(input, CTX);
    const r2 = generateGovernanceSignals(input, CTX);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("output signal arrays from two calls are independent (no shared reference)", () => {
    const input = makeInput({ rankedWorkflows: [WF_URGENT], totalWorkflows: 1 });
    const r1 = generateGovernanceSignals(input, CTX);
    const r2 = generateGovernanceSignals(input, CTX);
    r1.signals.push({} as GovernanceSignal);
    expect(r2.signals.length).not.toBe(r1.signals.length);
  });

  it("result contains only plain data - no functions, no class instances, no circular refs", () => {
    const result = generateGovernanceSignals(
      makeInput({ rankedWorkflows: [WF_CRITICAL], totalWorkflows: 1 }),
      CTX,
    );
    expect(() => JSON.stringify(result)).not.toThrow();
    for (const sig of result.signals) {
      expect(typeof sig.signalCode).toBe("string");
      expect(typeof sig.severity).toBe("string");
      expect(typeof sig.advisoryMessage).toBe("string");
      expect(Array.isArray(sig.supportingIndicators)).toBe(true);
    }
  });
});
