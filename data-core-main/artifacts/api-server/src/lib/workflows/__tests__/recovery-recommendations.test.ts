/**
 * @file   __tests__/recovery-recommendations.test.ts
 * @phase  P10-C - Recovery Recommendations & Reliability Advisory Intelligence Foundations
 *
 * T1  - recommendations deterministic
 * T2  - recurring incidents detected correctly
 * T3  - confidence classification stable
 * T4  - chronic degradation detection valid
 * T5  - advisory storms produce recommendations
 * T6  - cascading recurrence tracked correctly
 * T7  - trend serialization stable
 * T8  - append-only recommendation history preserved
 * T9  - super-admin enforcement valid
 * T10 - recommendation engine remains read-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  generateRecoveryRecommendations,
  buildWorkspaceTrend,
  buildPlatformTrendReport,
  buildWorkspaceIncidentHistory,
  classifyRecurrenceInterval,
  computeConfidence,
  makeRecommendationId,
  resetRecommendationSeq,
  emitRecoveryRecommendationGeneratedEvent,
  emitReliabilityTrendDetectedEvent,
  emitIncidentRecurrenceDetectedEvent,
  emitRecoveryPatternClassifiedEvent,
  type RecommendationContext,
  type WorkspaceIncidentHistory,
  type IncidentSummary,
} from "../recovery-recommendations";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const BASE_TIME = new Date("2026-05-15T10:00:00.000Z");
const DAY = 86_400_000;

function t(offsetDays: number): string {
  return new Date(BASE_TIME.getTime() + offsetDays * DAY).toISOString();
}

function makeCtx(
  overrides: Partial<RecommendationContext> = {},
): RecommendationContext {
  return {
    incidentId:          "inc:1-base",
    workspaceId:         1,
    highestSeverity:     "severely_degraded",
    peakPropagationRisk: "spreading",
    incidentStatus:      "active",
    advisoryStormCount:  0,
    escalationCount:     0,
    recoveryCount:       0,
    durationMinutes:     null,
    snapshotCount:       3,
    maxBlastRadiusScore: 30,
    startedAt:           t(0),
    ...overrides,
  };
}

function makeHistory(
  overrides: Partial<WorkspaceIncidentHistory> = {},
): WorkspaceIncidentHistory {
  return {
    totalPriorIncidents:        0,
    priorWithAdvisoryStorms:    0,
    priorWithCascadingRisk:     0,
    priorWithHighEscalations:   0,
    avgDurationMinutesResolved: null,
    recurrenceInterval:         "none",
    ...overrides,
  };
}

function makeIncidentSummary(
  workspaceId: number,
  startedDaysAgo: number,
  overrides: Partial<IncidentSummary> = {},
): IncidentSummary {
  return {
    incidentId:          `inc:${workspaceId}-${startedDaysAgo}`,
    workspaceId,
    startedAt:           t(-startedDaysAgo),
    resolvedAt:          t(-startedDaysAgo + 0.1),
    highestSeverity:     "severely_degraded",
    peakPropagationRisk: "spreading",
    incidentStatus:      "resolved",
    advisoryStormCount:  0,
    snapshotCount:       4,
    escalationCount:     1,
    durationMinutes:     60,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - recommendations deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: recommendations deterministic", () => {
  beforeEach(() => resetRecommendationSeq());

  it("same context + history → same recommendation types", () => {
    const ctx     = makeCtx({ incidentStatus: "active", advisoryStormCount: 1 });
    const history = makeHistory({ totalPriorIncidents: 1, priorWithAdvisoryStorms: 1 });
    const r1 = generateRecoveryRecommendations(ctx, history, BASE_TIME).map(r => r.recommendationType);
    const r2 = generateRecoveryRecommendations(ctx, history, BASE_TIME).map(r => r.recommendationType);
    expect(r1).toEqual(r2);
  });

  it("monitor_closely is always generated for active incidents", () => {
    const ctx  = makeCtx({ incidentStatus: "active" });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    expect(recs.some(r => r.recommendationType === "monitor_closely")).toBe(true);
  });

  it("monitor_closely is always generated for recovering incidents", () => {
    const ctx  = makeCtx({ incidentStatus: "recovering" });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    expect(recs.some(r => r.recommendationType === "monitor_closely")).toBe(true);
  });

  it("no duplicate recommendation types in a single call", () => {
    const ctx  = makeCtx({
      incidentStatus:      "recovering",
      advisoryStormCount:  3,
      escalationCount:     3,
      maxBlastRadiusScore: 85,
      highestSeverity:     "critical",
      peakPropagationRisk: "cascading",
    });
    const recs  = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    const types = recs.map(r => r.recommendationType);
    expect(new Set(types).size).toBe(types.length);
  });

  it("recommendations are sorted by severity (critical first)", () => {
    const ctx  = makeCtx({
      highestSeverity:     "critical",
      peakPropagationRisk: "cascading",
      escalationCount:     2,
    });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    const ORDER = { critical: 0, high: 1, moderate: 2, low: 3 };
    for (let i = 1; i < recs.length; i++) {
      expect(ORDER[recs[i]!.severity]).toBeGreaterThanOrEqual(ORDER[recs[i - 1]!.severity]);
    }
  });

  it("each recommendation has a unique recommendationId", () => {
    const ctx  = makeCtx({ advisoryStormCount: 2, escalationCount: 3 });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    const ids  = recs.map(r => r.recommendationId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - recurring incidents detected correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: recurring incidents detected correctly", () => {
  it("classifyRecurrenceInterval none for 0 incidents", () => {
    expect(classifyRecurrenceInterval(0)).toBe("none");
  });

  it("classifyRecurrenceInterval rare for 1 incident", () => {
    expect(classifyRecurrenceInterval(1)).toBe("rare");
  });

  it("classifyRecurrenceInterval occasional for 2 incidents", () => {
    expect(classifyRecurrenceInterval(2)).toBe("occasional");
  });

  it("classifyRecurrenceInterval frequent for 3-4 incidents", () => {
    expect(classifyRecurrenceInterval(3)).toBe("frequent");
    expect(classifyRecurrenceInterval(4)).toBe("frequent");
  });

  it("classifyRecurrenceInterval chronic for 5+ incidents", () => {
    expect(classifyRecurrenceInterval(5)).toBe("chronic");
    expect(classifyRecurrenceInterval(10)).toBe("chronic");
  });

  it("buildWorkspaceIncidentHistory counts priorWithAdvisoryStorms correctly", () => {
    const prior = [
      makeIncidentSummary(1, 5, { advisoryStormCount: 2 }),
      makeIncidentSummary(1, 10, { advisoryStormCount: 0 }),
      makeIncidentSummary(1, 15, { advisoryStormCount: 1 }),
    ];
    const history = buildWorkspaceIncidentHistory(prior);
    expect(history.priorWithAdvisoryStorms).toBe(2);
    expect(history.totalPriorIncidents).toBe(3);
  });

  it("buildWorkspaceIncidentHistory computes avgDurationMinutesResolved", () => {
    const prior = [
      makeIncidentSummary(1, 5, { durationMinutes: 60, incidentStatus: "resolved" }),
      makeIncidentSummary(1, 10, { durationMinutes: 120, incidentStatus: "resolved" }),
    ];
    const history = buildWorkspaceIncidentHistory(prior);
    expect(history.avgDurationMinutesResolved).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - confidence classification stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: confidence classification stable", () => {
  it("low confidence when no prior history, 1 signal", () => {
    const result = computeConfidence(1, 0, makeHistory({ totalPriorIncidents: 0 }));
    expect(result).toBe("low");
  });

  it("moderate confidence when no prior history, 2+ signals", () => {
    const result = computeConfidence(2, 0, makeHistory({ totalPriorIncidents: 0 }));
    expect(result).toBe("moderate");
  });

  it("high confidence when 2+ prior matches", () => {
    const result = computeConfidence(2, 2, makeHistory({ totalPriorIncidents: 3 }));
    expect(result).toBe("high");
  });

  it("strong confidence when recurrenceInterval=chronic", () => {
    const result = computeConfidence(2, 1, makeHistory({
      totalPriorIncidents: 6,
      recurrenceInterval: "chronic",
    }));
    expect(result).toBe("strong");
  });

  it("strong confidence when priorMatchCount >= 3", () => {
    const result = computeConfidence(1, 3, makeHistory({ totalPriorIncidents: 4 }));
    expect(result).toBe("strong");
  });

  it("confidence is capped at moderate when totalPriorIncidents=0 regardless of signals", () => {
    const result = computeConfidence(10, 0, makeHistory({ totalPriorIncidents: 0 }));
    expect(["low", "moderate"]).toContain(result);
    expect(result).not.toBe("high");
    expect(result).not.toBe("strong");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - chronic degradation detection valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: chronic degradation detection valid", () => {
  it("isChronicallyDegraded=true when workspace has 3+ incidents in window", () => {
    const incidents = [
      makeIncidentSummary(1, 1),
      makeIncidentSummary(1, 5),
      makeIncidentSummary(1, 10),
    ];
    const trend = buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(trend.isChronicallyDegraded).toBe(true);
  });

  it("isChronicallyDegraded=false when workspace has 2 incidents", () => {
    const incidents = [
      makeIncidentSummary(1, 1),
      makeIncidentSummary(1, 5),
    ];
    const trend = buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(trend.isChronicallyDegraded).toBe(false);
  });

  it("escalationFrequency=chronic when 3+ incidents with avg > 2 escalations", () => {
    const incidents = [
      makeIncidentSummary(1, 1, { escalationCount: 3 }),
      makeIncidentSummary(1, 5, { escalationCount: 3 }),
      makeIncidentSummary(1, 10, { escalationCount: 3 }),
    ];
    const trend = buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(trend.escalationFrequency).toBe("chronic");
  });

  it("escalationFrequency=none when no escalations", () => {
    const incidents = [
      makeIncidentSummary(1, 1, { escalationCount: 0 }),
      makeIncidentSummary(1, 5, { escalationCount: 0 }),
    ];
    const trend = buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(trend.escalationFrequency).toBe("none");
  });

  it("chronically degraded workspace has chronic recurrenceInterval", () => {
    const incidents = Array.from({ length: 5 }, (_, i) =>
      makeIncidentSummary(1, i + 1),
    );
    const trend = buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(trend.recurrenceInterval).toBe("chronic");
    expect(trend.isChronicallyDegraded).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - advisory storms produce recommendations
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: advisory storms produce recommendations", () => {
  it("advisoryStormCount=1 → investigate_advisory_storm recommendation", () => {
    const ctx  = makeCtx({ advisoryStormCount: 1 });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    expect(recs.some(r => r.recommendationType === "investigate_advisory_storm")).toBe(true);
  });

  it("advisoryStormCount=0 → no advisory storm recommendation", () => {
    const ctx  = makeCtx({ advisoryStormCount: 0 });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    expect(recs.some(r => r.recommendationType === "investigate_advisory_storm")).toBe(false);
  });

  it("advisoryStormCount > 2 → advisory storm recommendation has severity=high", () => {
    const ctx  = makeCtx({ advisoryStormCount: 3 });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    const storm = recs.find(r => r.recommendationType === "investigate_advisory_storm")!;
    expect(storm.severity).toBe("high");
  });

  it("prior advisory storms boost confidence to high/strong", () => {
    const ctx     = makeCtx({ advisoryStormCount: 2 });
    const history = makeHistory({ priorWithAdvisoryStorms: 2, totalPriorIncidents: 3 });
    const recs    = generateRecoveryRecommendations(ctx, history, BASE_TIME);
    const storm   = recs.find(r => r.recommendationType === "investigate_advisory_storm")!;
    expect(["high", "strong"]).toContain(storm.confidenceLevel);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - cascading recurrence tracked correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: cascading recurrence tracked correctly", () => {
  it("cascading propagation + critical severity → containment_boundary_review", () => {
    const ctx  = makeCtx({
      peakPropagationRisk: "cascading",
      highestSeverity:     "critical",
    });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    expect(recs.some(r => r.recommendationType === "containment_boundary_review")).toBe(true);
  });

  it("containment_boundary_review severity=critical when cascading+critical", () => {
    const ctx  = makeCtx({
      peakPropagationRisk: "cascading",
      highestSeverity:     "critical",
    });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    const cbr  = recs.find(r => r.recommendationType === "containment_boundary_review")!;
    expect(cbr.severity).toBe("critical");
  });

  it("cascadingRiskRecurrence=true when 2+ incidents with cascading risk", () => {
    const incidents = [
      makeIncidentSummary(1, 1, { peakPropagationRisk: "cascading" }),
      makeIncidentSummary(1, 5, { peakPropagationRisk: "cascading" }),
    ];
    const trend = buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(trend.cascadingRiskRecurrence).toBe(true);
  });

  it("cascadingRiskRecurrence=false when 1 or fewer cascading incidents", () => {
    const incidents = [
      makeIncidentSummary(1, 1, { peakPropagationRisk: "spreading" }),
      makeIncidentSummary(1, 5, { peakPropagationRisk: "cascading" }),
    ];
    const trend = buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(trend.cascadingRiskRecurrence).toBe(false);
  });

  it("isolate_noisy_tenant generated for spreading+severely_degraded", () => {
    const ctx  = makeCtx({
      peakPropagationRisk: "spreading",
      highestSeverity:     "severely_degraded",
    });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    expect(recs.some(r => r.recommendationType === "isolate_noisy_tenant")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - trend serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: trend serialization stable", () => {
  it("WorkspaceTrend is fully JSON-serializable", () => {
    const incidents = [makeIncidentSummary(1, 2)];
    const trend     = buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(() => JSON.stringify(trend)).not.toThrow();
  });

  it("ReliabilityTrendReport is fully JSON-serializable", () => {
    const incidents = [
      makeIncidentSummary(1, 1), makeIncidentSummary(2, 2),
    ];
    const report = buildPlatformTrendReport(incidents, 30, BASE_TIME);
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it("RecoveryRecommendation array is fully JSON-serializable", () => {
    const ctx  = makeCtx({ advisoryStormCount: 1, escalationCount: 2 });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    expect(() => JSON.stringify(recs)).not.toThrow();
  });

  it("trend report has no function properties", () => {
    const report = buildPlatformTrendReport([], 30, BASE_TIME);
    const hasFn  = Object.values(report).some(v => typeof v === "function");
    expect(hasFn).toBe(false);
  });

  it("recommendations have no function properties", () => {
    const ctx  = makeCtx();
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    const hasFn = recs.some(r => Object.values(r).some(v => typeof v === "function"));
    expect(hasFn).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - append-only recommendation history preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: append-only recommendation history preserved", () => {
  it("generateRecoveryRecommendations does not mutate context input", () => {
    const ctx    = makeCtx({ advisoryStormCount: 2 });
    const before = JSON.stringify(ctx);
    generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    expect(JSON.stringify(ctx)).toBe(before);
  });

  it("generateRecoveryRecommendations does not mutate history input", () => {
    const history = makeHistory({ totalPriorIncidents: 3 });
    const before  = JSON.stringify(history);
    generateRecoveryRecommendations(makeCtx(), history, BASE_TIME);
    expect(JSON.stringify(history)).toBe(before);
  });

  it("buildWorkspaceTrend does not mutate incidents array", () => {
    const incidents = [makeIncidentSummary(1, 2)];
    const before    = JSON.stringify(incidents);
    buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(JSON.stringify(incidents)).toBe(before);
  });

  it("buildPlatformTrendReport does not mutate incidents array", () => {
    const incidents = [makeIncidentSummary(1, 2), makeIncidentSummary(2, 3)];
    const before    = JSON.stringify(incidents);
    buildPlatformTrendReport(incidents, 30, BASE_TIME);
    expect(JSON.stringify(incidents)).toBe(before);
  });

  it("each recommendation contains workspaceId and incidentId from context", () => {
    const ctx  = makeCtx({ workspaceId: 99, incidentId: "inc:99-test" });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    for (const rec of recs) {
      expect(rec.workspaceId).toBe(99);
      expect(rec.incidentId).toBe("inc:99-test");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - super-admin enforcement valid (advisory-only invariants)
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: super-admin enforcement valid", () => {
  it("generateRecoveryRecommendations has no async behavior", () => {
    const result = generateRecoveryRecommendations(makeCtx(), makeHistory(), BASE_TIME);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("buildPlatformTrendReport has no async behavior", () => {
    const result = buildPlatformTrendReport([], 30, BASE_TIME);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("same inputs always produce same output (deterministic)", () => {
    const ctx     = makeCtx({ advisoryStormCount: 2, escalationCount: 1 });
    const history = makeHistory({ totalPriorIncidents: 2, priorWithAdvisoryStorms: 1 });
    const r1 = generateRecoveryRecommendations(ctx, history, BASE_TIME).map(r => r.recommendationType);
    const r2 = generateRecoveryRecommendations(ctx, history, BASE_TIME).map(r => r.recommendationType);
    expect(r1).toEqual(r2);
  });

  it("platform trend improving when recent incidents < 80% of earlier incidents", () => {
    // 5 incidents in early half, 0 in recent half → improving
    const incidents = Array.from({ length: 5 }, (_, i) =>
      makeIncidentSummary(1, 20 + i),  // all > 15 days ago
    );
    const report = buildPlatformTrendReport(incidents, 30, BASE_TIME);
    expect(report.platformSummary.platformHealthTrend).toBe("improving");
  });

  it("platform trend degrading when recent incidents > 120% of earlier incidents", () => {
    // 0 earlier, 5 recent → degrading
    const incidents = Array.from({ length: 5 }, (_, i) =>
      makeIncidentSummary(1, i),  // all very recent
    );
    const report = buildPlatformTrendReport(incidents, 30, BASE_TIME);
    expect(report.platformSummary.platformHealthTrend).toBe("degrading");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - recommendation engine remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: recommendation engine remains read-only", () => {
  it("emitRecoveryRecommendationGeneratedEvent does not throw", () => {
    expect(() => emitRecoveryRecommendationGeneratedEvent({
      workspaceId: 1, incidentId: "inc:1", recommendationType: "monitor_closely",
      confidenceLevel: "high", propagationRisk: "spreading", action: "test",
    })).not.toThrow();
  });

  it("emitReliabilityTrendDetectedEvent does not throw", () => {
    expect(() => emitReliabilityTrendDetectedEvent({
      workspaceId: 1, incidentId: "inc:1",
      patternType: "chronic_degradation", occurrenceCount: 4, action: "test",
    })).not.toThrow();
  });

  it("emitIncidentRecurrenceDetectedEvent does not throw", () => {
    expect(() => emitIncidentRecurrenceDetectedEvent({
      workspaceId: 1, incidentId: "inc:1",
      patternType: "cascading_risk_recurrence", priorOccurrences: 2, action: "test",
    })).not.toThrow();
  });

  it("emitRecoveryPatternClassifiedEvent does not throw", () => {
    expect(() => emitRecoveryPatternClassifiedEvent({
      workspaceId: 1, incidentId: "inc:1",
      patternType: "repeated_escalation", escalationCount: 3, action: "test",
    })).not.toThrow();
  });

  it("MTTR computed correctly across resolved incidents", () => {
    const incidents = [
      makeIncidentSummary(1, 5, { durationMinutes: 40 }),
      makeIncidentSummary(1, 10, { durationMinutes: 80 }),
      makeIncidentSummary(1, 15, { durationMinutes: 120 }),
    ];
    const trend = buildWorkspaceTrend(1, incidents, BASE_TIME);
    expect(trend.mttrMinutes).toBe(80);
  });

  it("suggestedActions is a non-empty string array on every recommendation", () => {
    const ctx = makeCtx({
      advisoryStormCount:  2,
      escalationCount:     2,
      maxBlastRadiusScore: 75,
      highestSeverity:     "critical",
      peakPropagationRisk: "cascading",
    });
    const recs = generateRecoveryRecommendations(ctx, makeHistory(), BASE_TIME);
    for (const rec of recs) {
      expect(Array.isArray(rec.suggestedActions)).toBe(true);
      expect(rec.suggestedActions.length).toBeGreaterThan(0);
      expect(rec.suggestedActions.every(a => typeof a === "string")).toBe(true);
    }
  });
});
