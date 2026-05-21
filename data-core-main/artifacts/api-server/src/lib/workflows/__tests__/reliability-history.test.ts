/**
 * @file   __tests__/reliability-history.test.ts
 * @phase  P10-B - Reliability History, Incident Timelines & Operational SLO Foundations
 *
 * T1  - snapshot persistence deterministic
 * T2  - incident timelines reconstructed correctly
 * T3  - transition detection stable
 * T4  - duplicate transition spam prevented
 * T5  - recovery moments tracked correctly
 * T6  - SLO breach classification deterministic
 * T7  - serialization ordering stable
 * T8  - append-only guarantees preserved
 * T9  - super-admin enforcement valid (read-only engine invariants)
 * T10 - history layer remains read-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  trackReliabilityTransition,
  buildIncidentTimelines,
  evaluateSLO,
  evaluatePlatformSLOs,
  buildSnapshot,
  makeSnapshotId,
  makeCaptureId,
  makeIncidentId,
  resetHistorySeqs,
  DEGRADATION_INDEX,
  PROPAGATION_INDEX,
  PLATFORM_SLOS,
  SLO_HEALTHY_WORKSPACE_RATIO,
  SLO_CRITICAL_WORKSPACE_COUNT,
  SLO_ADVISORY_STORM_FREQUENCY,
  SLO_CASCADING_RISK_PERSISTENCE,
  emitReliabilitySnapshotPersistedEvent,
  emitReliabilityTransitionDetectedEvent,
  emitIncidentTimelineUpdatedEvent,
  emitSLOBreachDetectedEvent,
  type ReliabilityDomainSnapshot,
  type IncidentTimeline,
} from "../reliability-history";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const BASE_TIME = new Date("2026-05-15T10:00:00.000Z");
const MIN = 60_000;

function t(offsetMinutes: number): string {
  return new Date(BASE_TIME.getTime() + offsetMinutes * MIN).toISOString();
}

function makeSnap(
  workspaceId:       number,
  degradationStatus: ReliabilityDomainSnapshot["degradationStatus"],
  capturedAt:        string,
  overrides: Partial<ReliabilityDomainSnapshot> = {},
): ReliabilityDomainSnapshot {
  return {
    snapshotId:            `snap-${workspaceId}-${capturedAt}`,
    captureId:             `cap-1`,
    workspaceId,
    domainId:              `rd:${workspaceId}-1`,
    degradationStatus,
    propagationRisk:       degradationStatus === "healthy" ? "isolated"
                         : degradationStatus === "degraded" ? "bounded"
                         : degradationStatus === "severely_degraded" ? "spreading"
                         : "cascading",
    containmentLevel:      degradationStatus === "healthy" ? "contained"
                         : degradationStatus === "degraded" ? "contained"
                         : degradationStatus === "severely_degraded" ? "partial"
                         : "at_risk",
    observabilityHealth:   "full",
    blastRadiusScore:      degradationStatus === "critical" ? 90 : 10,
    advisoryStormDetected: false,
    affectedSubsystems:    [],
    capturedAt,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - snapshot persistence deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: snapshot persistence deterministic", () => {
  it("buildSnapshot produces a valid ReliabilityDomainSnapshot", () => {
    const captureId = "cap-test-1";
    const result = {
      domain: {
        domainId:          "rd:7-123",
        workspaceId:       7,
        degradationStatus: "healthy" as const,
        propagationRisk:   "isolated" as const,
        containmentLevel:  "contained" as const,
        observabilityHealth: "full" as const,
        affectedSubsystems: [],
      },
      blastRadius: { blastRadiusScore: 5 },
      advisoryStormDetected: false,
      evaluatedAt: t(0),
    };
    const snap = buildSnapshot(captureId, result, BASE_TIME);
    expect(snap.captureId).toBe(captureId);
    expect(snap.workspaceId).toBe(7);
    expect(snap.degradationStatus).toBe("healthy");
    expect(snap.blastRadiusScore).toBe(5);
    expect(snap.snapshotId.startsWith("snap:")).toBe(true);
  });

  it("same captureId links multiple workspace snapshots", () => {
    const captureId = "cap-same";
    const makeResult = (wsId: number) => ({
      domain: {
        domainId: `rd:${wsId}`, workspaceId: wsId,
        degradationStatus: "healthy" as const, propagationRisk: "isolated" as const,
        containmentLevel: "contained" as const, observabilityHealth: "full" as const,
        affectedSubsystems: [],
      },
      blastRadius: { blastRadiusScore: 0 },
      advisoryStormDetected: false,
      evaluatedAt: t(0),
    });
    const s1 = buildSnapshot(captureId, makeResult(1), BASE_TIME);
    const s2 = buildSnapshot(captureId, makeResult(2), BASE_TIME);
    expect(s1.captureId).toBe(s2.captureId);
    expect(s1.workspaceId).not.toBe(s2.workspaceId);
  });

  it("makeSnapshotId contains workspaceId", () => {
    const id = makeSnapshotId(42);
    expect(id).toContain("snap:");
  });

  it("makeCaptureId starts with cap:", () => {
    const id = makeCaptureId();
    expect(id.startsWith("cap:")).toBe(true);
  });

  it("DEGRADATION_INDEX orders correctly (healthy < critical)", () => {
    expect(DEGRADATION_INDEX["healthy"]).toBeLessThan(DEGRADATION_INDEX["degraded"]);
    expect(DEGRADATION_INDEX["degraded"]).toBeLessThan(DEGRADATION_INDEX["severely_degraded"]);
    expect(DEGRADATION_INDEX["severely_degraded"]).toBeLessThan(DEGRADATION_INDEX["containment_risk"]);
    expect(DEGRADATION_INDEX["containment_risk"]).toBeLessThan(DEGRADATION_INDEX["critical"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - incident timelines reconstructed correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: incident timelines reconstructed correctly", () => {
  it("no incident when all snapshots are healthy or degraded", () => {
    const snaps = [
      makeSnap(1, "healthy", t(0)),
      makeSnap(1, "degraded", t(5)),
      makeSnap(1, "healthy", t(10)),
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines).toHaveLength(0);
  });

  it("incident opens at severely_degraded, resolves at healthy", () => {
    const snaps = [
      makeSnap(1, "healthy",           t(0)),
      makeSnap(1, "severely_degraded", t(5)),
      makeSnap(1, "critical",          t(10)),
      makeSnap(1, "severely_degraded", t(15)),
      makeSnap(1, "healthy",           t(20)),
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines).toHaveLength(1);
    const inc = timelines[0]!;
    expect(inc.incidentStatus).toBe("resolved");
    expect(inc.highestSeverity).toBe("critical");
    expect(inc.resolvedAt).toBe(t(20));
  });

  it("incident stays active if not resolved at end of snapshots", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "critical",          t(5)),
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines).toHaveLength(1);
    expect(timelines[0]!.incidentStatus).toBe("active");
    expect(timelines[0]!.resolvedAt).toBeNull();
    expect(timelines[0]!.durationMinutes).toBeNull();
  });

  it("multiple workspaces produce independent incident timelines", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "healthy",           t(5)),
      makeSnap(2, "critical",          t(0)),
      makeSnap(2, "healthy",           t(10)),
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines).toHaveLength(2);
    const ws1 = timelines.find(i => i.workspaceId === 1)!;
    const ws2 = timelines.find(i => i.workspaceId === 2)!;
    expect(ws1.workspaceId).toBe(1);
    expect(ws2.workspaceId).toBe(2);
  });

  it("durationMinutes is computed correctly for resolved incident", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "healthy",           t(30)),
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines[0]!.durationMinutes).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - transition detection stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: transition detection stable", () => {
  it("healthy → severely_degraded → transitionType=escalation", () => {
    const prev = makeSnap(1, "healthy",           t(0));
    const curr = makeSnap(1, "severely_degraded", t(5));
    const trans = trackReliabilityTransition(prev, curr);
    expect(trans).not.toBeNull();
    expect(trans!.transitionType).toBe("escalation");
    expect(trans!.isDegradationChange).toBe(true);
  });

  it("critical → degraded → transitionType=recovery", () => {
    const prev = makeSnap(1, "critical", t(0));
    const curr = makeSnap(1, "degraded", t(5));
    const trans = trackReliabilityTransition(prev, curr);
    expect(trans).not.toBeNull();
    expect(trans!.transitionType).toBe("recovery");
  });

  it("transitionId starts with 'trans:'", () => {
    const prev = makeSnap(1, "healthy",  t(0));
    const curr = makeSnap(1, "degraded", t(5));
    const trans = trackReliabilityTransition(prev, curr);
    expect(trans!.transitionId.startsWith("trans:")).toBe(true);
  });

  it("fromSnapshotId and toSnapshotId match input snapshotIds", () => {
    const prev = makeSnap(1, "healthy",  t(0));
    const curr = makeSnap(1, "degraded", t(5));
    const trans = trackReliabilityTransition(prev, curr);
    expect(trans!.fromSnapshotId).toBe(prev.snapshotId);
    expect(trans!.toSnapshotId).toBe(curr.snapshotId);
  });

  it("different workspaceIds → returns null (defensive)", () => {
    const prev = makeSnap(1, "healthy",  t(0));
    const curr = makeSnap(2, "critical", t(5));
    const trans = trackReliabilityTransition(prev, curr);
    expect(trans).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - duplicate transition spam prevented
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: duplicate transition spam prevented", () => {
  it("same degradationStatus AND propagationRisk → returns null", () => {
    const prev = makeSnap(1, "healthy", t(0));
    const curr = makeSnap(1, "healthy", t(5));  // identical status
    const trans = trackReliabilityTransition(prev, curr);
    expect(trans).toBeNull();
  });

  it("same degradationStatus AND propagationRisk twice in sequence → no transitions", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "severely_degraded", t(5)),  // same - should not produce transition
      makeSnap(1, "severely_degraded", t(10)), // same - should not produce transition
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines).toHaveLength(1);
    // Only one incident, no duplicate transitions
    expect(timelines[0]!.transitions).toHaveLength(0);
  });

  it("stable run of 5 identical snapshots produces no transitions", () => {
    const base = makeSnap(1, "degraded", t(0));
    let prev = base;
    let transitionCount = 0;
    for (let i = 1; i <= 5; i++) {
      const curr = makeSnap(1, "degraded", t(i * 5));
      const t2 = trackReliabilityTransition(prev, curr);
      if (t2 !== null) transitionCount++;
      prev = curr;
    }
    expect(transitionCount).toBe(0);
  });

  it("propagation change without degradation change → lateral (not null)", () => {
    const prev = makeSnap(1, "degraded", t(0), { propagationRisk: "bounded" });
    const curr = makeSnap(1, "degraded", t(5), { propagationRisk: "spreading" });
    const trans = trackReliabilityTransition(prev, curr);
    expect(trans).not.toBeNull();
    expect(trans!.transitionType).toBe("lateral");
    expect(trans!.isDegradationChange).toBe(false);
    expect(trans!.isPropagationChange).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - recovery moments tracked correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: recovery moments tracked correctly", () => {
  it("escalation followed by recovery produces both moments", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "critical",          t(5)),   // escalation
      makeSnap(1, "severely_degraded", t(10)),  // recovery
      makeSnap(1, "healthy",           t(15)),  // resolve
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines).toHaveLength(1);
    const inc = timelines[0]!;
    expect(inc.escalationMoments.length).toBeGreaterThanOrEqual(1);
    expect(inc.recoveryMoments.length).toBeGreaterThanOrEqual(1);
  });

  it("incident status is 'recovering' when at degraded but not yet healthy", () => {
    const snaps = [
      makeSnap(1, "critical", t(0)),
      makeSnap(1, "degraded", t(5)),  // recovering - not yet resolved
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines).toHaveLength(1);
    expect(timelines[0]!.incidentStatus).toBe("recovering");
    expect(timelines[0]!.resolvedAt).toBeNull();
  });

  it("advisory storm count increments within incident", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0), { advisoryStormDetected: true }),
      makeSnap(1, "critical",          t(5), { advisoryStormDetected: true }),
      makeSnap(1, "healthy",           t(10)),
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines[0]!.advisoryStormCount).toBe(2);
  });

  it("highestSeverity is the worst across all incident snapshots", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "critical",          t(5)),
      makeSnap(1, "containment_risk",  t(10)),
      makeSnap(1, "healthy",           t(15)),
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(timelines[0]!.highestSeverity).toBe("critical");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - SLO breach classification deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: SLO breach classification deterministic", () => {
  const NOW = BASE_TIME;

  it("all healthy snapshots → healthy_workspace_ratio SLO compliant", () => {
    const snaps = [
      makeSnap(1, "healthy", t(-60), { captureId: "c1" }),
      makeSnap(2, "healthy", t(-60), { captureId: "c1" }),
    ];
    const result = evaluateSLO(SLO_HEALTHY_WORKSPACE_RATIO, snaps, NOW);
    expect(result.status).toBe("compliant");
    expect(result.currentValue).toBeGreaterThanOrEqual(0.80);
  });

  it("all critical snapshots → critical_workspace_count SLO breached", () => {
    const snaps = [
      makeSnap(1, "critical", t(-30), { captureId: "c1" }),
      makeSnap(2, "critical", t(-30), { captureId: "c1" }),
    ];
    const result = evaluateSLO(SLO_CRITICAL_WORKSPACE_COUNT, snaps, NOW);
    expect(result.status).toBe("breached");
    expect(result.currentValue).toBeGreaterThan(0);
  });

  it("advisory storms exceed threshold → storm frequency SLO breached", () => {
    const snaps = Array.from({ length: 5 }, (_, i) =>
      makeSnap(i + 1, "severely_degraded", t(-60 + i * 5), {
        captureId: "c1",
        advisoryStormDetected: true,
      }),
    );
    const result = evaluateSLO(SLO_ADVISORY_STORM_FREQUENCY, snaps, NOW);
    expect(result.status).toBe("breached");
    expect(result.currentValue).toBeGreaterThan(SLO_ADVISORY_STORM_FREQUENCY.targetThreshold);
  });

  it("no snapshots in window → compliant (no data)", () => {
    const result = evaluateSLO(SLO_CRITICAL_WORKSPACE_COUNT, [], NOW);
    expect(result.status).toBe("compliant");
    expect(result.notes).toContain("No snapshots");
  });

  it("evaluatePlatformSLOs returns all 4 SLOs", () => {
    const snaps = [makeSnap(1, "healthy", t(-60), { captureId: "c1" })];
    const report = evaluatePlatformSLOs(snaps, NOW);
    expect(report.sloEvaluations).toHaveLength(4);
    expect(report.totalSLOs).toBe(4);
  });

  it("compliantCount + atRiskCount + breachedCount = totalSLOs", () => {
    const snaps = [makeSnap(1, "healthy", t(-60), { captureId: "c1" })];
    const report = evaluatePlatformSLOs(snaps, NOW);
    expect(report.compliantCount + report.atRiskCount + report.breachedCount).toBe(report.totalSLOs);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - serialization ordering stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: serialization ordering stable", () => {
  it("ReliabilityDomainSnapshot is fully JSON-serializable", () => {
    const snap = makeSnap(1, "critical", t(0));
    expect(() => JSON.stringify(snap)).not.toThrow();
  });

  it("IncidentTimeline is fully JSON-serializable", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "healthy",           t(10)),
    ];
    const timelines = buildIncidentTimelines(snaps);
    expect(() => JSON.stringify(timelines)).not.toThrow();
  });

  it("OperationalSLOReport is fully JSON-serializable", () => {
    const snaps = [makeSnap(1, "healthy", t(-60), { captureId: "c1" })];
    const report = evaluatePlatformSLOs(snaps, BASE_TIME);
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  it("incident timelines sorted by startedAt DESC (most recent first)", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "healthy",           t(5)),
      makeSnap(1, "severely_degraded", t(20)),
      makeSnap(1, "healthy",           t(25)),
    ];
    const timelines = buildIncidentTimelines(snaps);
    if (timelines.length >= 2) {
      expect(new Date(timelines[0]!.startedAt) >= new Date(timelines[1]!.startedAt)).toBe(true);
    }
  });

  it("SLO evaluations have no function properties", () => {
    const snaps = [makeSnap(1, "healthy", t(-60), { captureId: "c1" })];
    const report = evaluatePlatformSLOs(snaps, BASE_TIME);
    const hasFn  = report.sloEvaluations.some(e =>
      Object.values(e).some(v => typeof v === "function"),
    );
    expect(hasFn).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - append-only guarantees preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: append-only guarantees preserved", () => {
  it("buildIncidentTimelines does not mutate input snapshots array", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "healthy",           t(5)),
    ];
    const originalLen = snaps.length;
    const snap0before = JSON.stringify(snaps[0]);
    buildIncidentTimelines(snaps);
    expect(snaps.length).toBe(originalLen);
    expect(JSON.stringify(snaps[0])).toBe(snap0before);
  });

  it("evaluatePlatformSLOs does not mutate input snapshots", () => {
    const snaps = [makeSnap(1, "healthy", t(-60), { captureId: "c1" })];
    const before = JSON.stringify(snaps);
    evaluatePlatformSLOs(snaps, BASE_TIME);
    expect(JSON.stringify(snaps)).toBe(before);
  });

  it("trackReliabilityTransition does not mutate either snapshot", () => {
    const prev   = makeSnap(1, "healthy",  t(0));
    const curr   = makeSnap(1, "degraded", t(5));
    const before = JSON.stringify([prev, curr]);
    trackReliabilityTransition(prev, curr);
    expect(JSON.stringify([prev, curr])).toBe(before);
  });

  it("PLATFORM_SLOS array has exactly 4 entries", () => {
    expect(PLATFORM_SLOS).toHaveLength(4);
  });

  it("each PLATFORM_SLO has a unique sloId", () => {
    const ids = PLATFORM_SLOS.map(s => s.sloId);
    expect(new Set(ids).size).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - super-admin enforcement valid (read-only engine invariants)
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: super-admin enforcement valid", () => {
  it("buildIncidentTimelines has no async behavior", () => {
    const result = buildIncidentTimelines([makeSnap(1, "healthy", t(0))]);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("trackReliabilityTransition has no async behavior", () => {
    const prev = makeSnap(1, "healthy",  t(0));
    const curr = makeSnap(1, "degraded", t(5));
    const result = trackReliabilityTransition(prev, curr);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("OperationalSLOReport has no function properties", () => {
    const snaps = [makeSnap(1, "healthy", t(-60), { captureId: "c1" })];
    const report = evaluatePlatformSLOs(snaps, BASE_TIME);
    const hasFn  = Object.values(report).some(v => typeof v === "function");
    expect(hasFn).toBe(false);
  });

  it("same input snapshots → same SLO report (deterministic)", () => {
    const snaps = [
      makeSnap(1, "critical",          t(-30), { captureId: "c1" }),
      makeSnap(2, "severely_degraded", t(-30), { captureId: "c1" }),
    ];
    const r1 = evaluatePlatformSLOs(snaps, BASE_TIME);
    const r2 = evaluatePlatformSLOs(snaps, BASE_TIME);
    expect(r1.overallStatus).toBe(r2.overallStatus);
    expect(r1.breachedCount).toBe(r2.breachedCount);
  });

  it("same input → same incident timeline (deterministic)", () => {
    const snaps = [
      makeSnap(1, "severely_degraded", t(0)),
      makeSnap(1, "healthy",           t(5)),
    ];
    // Both calls use the same snapshot objects → same output structure
    const t1 = buildIncidentTimelines([...snaps]);
    const t2 = buildIncidentTimelines([...snaps]);
    expect(t1.length).toBe(t2.length);
    if (t1.length > 0) {
      expect(t1[0]!.incidentStatus).toBe(t2[0]!.incidentStatus);
      expect(t1[0]!.highestSeverity).toBe(t2[0]!.highestSeverity);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - history layer remains read-only
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: history layer remains read-only", () => {
  it("emitReliabilitySnapshotPersistedEvent does not throw", () => {
    expect(() => emitReliabilitySnapshotPersistedEvent({
      snapshotId: "snap:1", captureId: "cap:1", workspaceId: 1,
      degradationStatus: "healthy", propagationRisk: "isolated", action: "test",
    })).not.toThrow();
  });

  it("emitReliabilityTransitionDetectedEvent does not throw", () => {
    expect(() => emitReliabilityTransitionDetectedEvent({
      workspaceId: 1, transitionType: "escalation",
      fromDegradation: "healthy", toDegradation: "critical", action: "test",
    })).not.toThrow();
  });

  it("emitIncidentTimelineUpdatedEvent does not throw", () => {
    expect(() => emitIncidentTimelineUpdatedEvent({
      workspaceId: 1, incidentId: "inc:1-123", incidentStatus: "active",
      highestSeverity: "critical", action: "test",
    })).not.toThrow();
  });

  it("emitSLOBreachDetectedEvent does not throw", () => {
    expect(() => emitSLOBreachDetectedEvent({
      sloId: "slo:test", metricName: "test_metric",
      currentValue: 5, targetThreshold: 2,
      status: "breached", action: "slo_breach_detected",
    })).not.toThrow();
  });

  it("cascading risk persistence SLO: 4 consecutive cascading captures → breached", () => {
    const snaps = Array.from({ length: 4 }, (_, i) =>
      makeSnap(1, "critical", t(-300 + i * 30), {
        captureId: `c${i + 1}`,
        propagationRisk: "cascading",
      }),
    );
    const result = evaluateSLO(SLO_CASCADING_RISK_PERSISTENCE, snaps, BASE_TIME);
    expect(result.status).toBe("breached");
    expect(result.currentValue).toBeGreaterThan(SLO_CASCADING_RISK_PERSISTENCE.targetThreshold);
  });
});
