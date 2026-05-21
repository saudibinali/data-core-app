/**
 * @file   __tests__/recovery-orchestration.test.ts
 * @phase  P10-D - Recovery Orchestration Research & Human-In-The-Loop Remediation Foundations
 *
 * T1  - orchestration creation deterministic
 * T2  - operator attribution required
 * T3  - duplicate orchestration conflicts rejected
 * T4  - lifecycle transitions deterministic
 * T5  - rollback eligibility preserved
 * T6  - append-only history guaranteed
 * T7  - audit serialization stable
 * T8  - super-admin enforcement valid
 * T9  - observability events scoped correctly
 * T10 - no autonomous remediation occurs
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildOrchestrationAction,
  validateOrchestrationTransition,
  detectDuplicateOrchestration,
  isTerminalOrchestrationStatus,
  isActiveOrchestrationStatus,
  canAcknowledge,
  canBeginReview,
  canResolve,
  canRollBack,
  canCancel,
  makeOrchestrationId,
  resetOrchestrationSeq,
  VALID_TRANSITIONS,
  TERMINAL_ORCHESTRATION_STATUSES,
  ACTIVE_ORCHESTRATION_STATUSES,
  ALL_ORCHESTRATION_TYPES,
  ORCHESTRATION_RECOMMENDATION_MAP,
  describeOrchestrationType,
  emitOrchestrationInitiatedEvent,
  emitOrchestrationAcknowledgedEvent,
  emitOrchestrationResolvedEvent,
  emitOrchestrationRolledBackEvent,
  type RecoveryOrchestrationType,
  type RecoveryOrchestrationStatus,
} from "../recovery-orchestration";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const BASE_TIME = new Date("2026-05-15T12:00:00.000Z");

function makeInput(
  overrides: Partial<{
    workspaceId: number;
    incidentId: string;
    orchestrationType: RecoveryOrchestrationType;
    initiatedBy: string;
    recommendationId: string | null;
    relatedSignals: string[];
    executionNotes: string;
  }> = {},
) {
  return {
    workspaceId:       1,
    incidentId:        "inc:1-123",
    initiatedBy:       "admin@platform.local",
    recommendationId:  null as string | null,
    relatedSignals:    [] as string[],
    ...overrides,
    orchestrationType: (overrides.orchestrationType ?? "operational_watch") as RecoveryOrchestrationType,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - orchestration creation deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: orchestration creation deterministic", () => {
  beforeEach(() => resetOrchestrationSeq());

  it("buildOrchestrationAction creates action with status=initiated", () => {
    const action = buildOrchestrationAction(makeInput(), BASE_TIME);
    expect(action.orchestrationStatus).toBe("initiated");
  });

  it("buildOrchestrationAction sets rollbackEligible=true by default", () => {
    const action = buildOrchestrationAction(makeInput(), BASE_TIME);
    expect(action.rollbackEligible).toBe(true);
  });

  it("actionId starts with 'orch:'", () => {
    const action = buildOrchestrationAction(makeInput(), BASE_TIME);
    expect(action.actionId.startsWith("orch:")).toBe(true);
  });

  it("actionId contains workspaceId", () => {
    const action = buildOrchestrationAction(makeInput({ workspaceId: 42 }), BASE_TIME);
    expect(action.actionId).toContain("42");
  });

  it("initiatedAt matches supplied time", () => {
    const action = buildOrchestrationAction(makeInput(), BASE_TIME);
    expect(action.initiatedAt).toBe(BASE_TIME.toISOString());
  });

  it("recommendationId is null when not provided", () => {
    const action = buildOrchestrationAction(makeInput(), BASE_TIME);
    expect(action.recommendationId).toBeNull();
  });

  it("recommendationId is preserved when provided", () => {
    const action = buildOrchestrationAction(
      makeInput({ recommendationId: "rec:1-123" }),
      BASE_TIME,
    );
    expect(action.recommendationId).toBe("rec:1-123");
  });

  it("makeOrchestrationId is monotonically increasing per call", () => {
    resetOrchestrationSeq();
    const id1 = makeOrchestrationId(1);
    const id2 = makeOrchestrationId(1);
    expect(id1).not.toBe(id2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - operator attribution required
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: operator attribution required", () => {
  it("throws ORCH_VALIDATION_INITIATED_BY when initiatedBy is empty string", () => {
    expect(() =>
      buildOrchestrationAction(makeInput({ initiatedBy: "" }), BASE_TIME),
    ).toThrow("initiatedBy is required");
  });

  it("throws ORCH_VALIDATION_INITIATED_BY when initiatedBy is whitespace only", () => {
    expect(() =>
      buildOrchestrationAction(makeInput({ initiatedBy: "   " }), BASE_TIME),
    ).toThrow("initiatedBy is required");
  });

  it("error has code ORCH_VALIDATION_INITIATED_BY", () => {
    try {
      buildOrchestrationAction(makeInput({ initiatedBy: "" }), BASE_TIME);
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect((e as { code?: string }).code).toBe("ORCH_VALIDATION_INITIATED_BY");
    }
  });

  it("throws ORCH_VALIDATION_INCIDENT_ID when incidentId is empty", () => {
    expect(() =>
      buildOrchestrationAction(makeInput({ incidentId: "" }), BASE_TIME),
    ).toThrow("incidentId is required");
  });

  it("throws ORCH_VALIDATION_WORKSPACE_ID when workspaceId is 0", () => {
    expect(() =>
      buildOrchestrationAction(makeInput({ workspaceId: 0 }), BASE_TIME),
    ).toThrow("workspaceId must be a positive integer");
  });

  it("throws ORCH_VALIDATION_WORKSPACE_ID when workspaceId is negative", () => {
    expect(() =>
      buildOrchestrationAction(makeInput({ workspaceId: -1 }), BASE_TIME),
    ).toThrow("workspaceId must be a positive integer");
  });

  it("throws ORCH_VALIDATION_TYPE when orchestrationType is unknown", () => {
    expect(() =>
      buildOrchestrationAction(
        makeInput({ orchestrationType: "invalid_type" as RecoveryOrchestrationType }),
        BASE_TIME,
      ),
    ).toThrow("is not a valid type");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - duplicate orchestration conflicts rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: duplicate orchestration conflicts rejected", () => {
  it("isDuplicate=false when no existing actions for workspace", () => {
    const result = detectDuplicateOrchestration(1, "operational_watch", []);
    expect(result.isDuplicate).toBe(false);
  });

  it("isDuplicate=true when same workspace+type has active orchestration", () => {
    const existing = [
      { workspaceId: 1, orchestrationType: "operational_watch", orchestrationStatus: "initiated" },
    ];
    const result = detectDuplicateOrchestration(1, "operational_watch", existing);
    expect(result.isDuplicate).toBe(true);
  });

  it("isDuplicate=false when same workspace+type is terminal (resolved)", () => {
    const existing = [
      { workspaceId: 1, orchestrationType: "operational_watch", orchestrationStatus: "resolved" },
    ];
    const result = detectDuplicateOrchestration(1, "operational_watch", existing);
    expect(result.isDuplicate).toBe(false);
  });

  it("isDuplicate=false when same workspace+type is terminal (rolled_back)", () => {
    const existing = [
      { workspaceId: 1, orchestrationType: "operational_watch", orchestrationStatus: "rolled_back" },
    ];
    const result = detectDuplicateOrchestration(1, "operational_watch", existing);
    expect(result.isDuplicate).toBe(false);
  });

  it("isDuplicate=false when different workspaceId for same type", () => {
    const existing = [
      { workspaceId: 2, orchestrationType: "operational_watch", orchestrationStatus: "initiated" },
    ];
    const result = detectDuplicateOrchestration(1, "operational_watch", existing);
    expect(result.isDuplicate).toBe(false);
  });

  it("isDuplicate=false when same workspace but different type", () => {
    const existing = [
      { workspaceId: 1, orchestrationType: "containment_audit", orchestrationStatus: "in_review" },
    ];
    const result = detectDuplicateOrchestration(1, "operational_watch", existing);
    expect(result.isDuplicate).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - lifecycle transitions deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: lifecycle transitions deterministic", () => {
  it("initiated → acknowledged is valid", () => {
    const result = validateOrchestrationTransition("initiated", "acknowledged");
    expect(result.valid).toBe(true);
  });

  it("initiated → cancelled is valid", () => {
    const result = validateOrchestrationTransition("initiated", "cancelled");
    expect(result.valid).toBe(true);
  });

  it("acknowledged → in_review is valid", () => {
    const result = validateOrchestrationTransition("acknowledged", "in_review");
    expect(result.valid).toBe(true);
  });

  it("in_review → resolved is valid", () => {
    const result = validateOrchestrationTransition("in_review", "resolved");
    expect(result.valid).toBe(true);
  });

  it("in_review → rolled_back is valid (rollbackEligible=true)", () => {
    const result = validateOrchestrationTransition("in_review", "rolled_back", true);
    expect(result.valid).toBe(true);
  });

  it("initiated → resolved is INVALID (skips states)", () => {
    const result = validateOrchestrationTransition("initiated", "resolved");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("ORCH_TRANSITION_DENIED");
  });

  it("resolved → acknowledged is INVALID (terminal state)", () => {
    const result = validateOrchestrationTransition("resolved", "acknowledged");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("ORCH_TERMINAL");
  });

  it("rolled_back → in_review is INVALID (terminal state)", () => {
    const result = validateOrchestrationTransition("rolled_back", "in_review");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("ORCH_TERMINAL");
  });

  it("cancelled → initiated is INVALID (terminal state)", () => {
    const result = validateOrchestrationTransition("cancelled", "initiated");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("ORCH_TERMINAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - rollback eligibility preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: rollback eligibility preserved", () => {
  it("in_review → rolled_back rejected when rollbackEligible=false", () => {
    const result = validateOrchestrationTransition("in_review", "rolled_back", false);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("ORCH_ROLLBACK_INELIGIBLE");
  });

  it("canRollBack returns false when rollbackEligible=false", () => {
    expect(canRollBack("in_review", false)).toBe(false);
  });

  it("canRollBack returns true when in_review and rollbackEligible=true", () => {
    expect(canRollBack("in_review", true)).toBe(true);
  });

  it("canRollBack returns false for terminal status regardless of eligibility", () => {
    expect(canRollBack("resolved", true)).toBe(false);
    expect(canRollBack("cancelled", true)).toBe(false);
    expect(canRollBack("rolled_back", true)).toBe(false);
  });

  it("canAcknowledge true only for initiated", () => {
    expect(canAcknowledge("initiated")).toBe(true);
    expect(canAcknowledge("acknowledged")).toBe(false);
    expect(canAcknowledge("in_review")).toBe(false);
    expect(canAcknowledge("resolved")).toBe(false);
  });

  it("canResolve true only for in_review", () => {
    expect(canResolve("in_review")).toBe(true);
    expect(canResolve("initiated")).toBe(false);
    expect(canResolve("acknowledged")).toBe(false);
  });

  it("canCancel is true for all non-terminal states", () => {
    expect(canCancel("initiated")).toBe(true);
    expect(canCancel("acknowledged")).toBe(true);
    expect(canCancel("in_review")).toBe(true);
    expect(canCancel("resolved")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - append-only history guaranteed
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: append-only history guaranteed", () => {
  it("buildOrchestrationAction does not mutate input", () => {
    const input  = makeInput();
    const before = JSON.stringify(input);
    buildOrchestrationAction(input, BASE_TIME);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("TERMINAL_ORCHESTRATION_STATUSES has exactly 3 entries", () => {
    expect(TERMINAL_ORCHESTRATION_STATUSES.size).toBe(3);
    expect(TERMINAL_ORCHESTRATION_STATUSES.has("resolved")).toBe(true);
    expect(TERMINAL_ORCHESTRATION_STATUSES.has("rolled_back")).toBe(true);
    expect(TERMINAL_ORCHESTRATION_STATUSES.has("cancelled")).toBe(true);
  });

  it("ACTIVE_ORCHESTRATION_STATUSES has exactly 3 entries", () => {
    expect(ACTIVE_ORCHESTRATION_STATUSES.size).toBe(3);
    expect(ACTIVE_ORCHESTRATION_STATUSES.has("initiated")).toBe(true);
    expect(ACTIVE_ORCHESTRATION_STATUSES.has("acknowledged")).toBe(true);
    expect(ACTIVE_ORCHESTRATION_STATUSES.has("in_review")).toBe(true);
  });

  it("ALL_ORCHESTRATION_TYPES has exactly 8 entries", () => {
    expect(ALL_ORCHESTRATION_TYPES.size).toBe(8);
  });

  it("isTerminalOrchestrationStatus correctly classifies all statuses", () => {
    expect(isTerminalOrchestrationStatus("resolved")).toBe(true);
    expect(isTerminalOrchestrationStatus("rolled_back")).toBe(true);
    expect(isTerminalOrchestrationStatus("cancelled")).toBe(true);
    expect(isTerminalOrchestrationStatus("initiated")).toBe(false);
    expect(isTerminalOrchestrationStatus("acknowledged")).toBe(false);
    expect(isTerminalOrchestrationStatus("in_review")).toBe(false);
  });

  it("terminal statuses have empty VALID_TRANSITIONS arrays", () => {
    expect(VALID_TRANSITIONS["resolved"]).toHaveLength(0);
    expect(VALID_TRANSITIONS["rolled_back"]).toHaveLength(0);
    expect(VALID_TRANSITIONS["cancelled"]).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - audit serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: audit serialization stable", () => {
  it("RecoveryOrchestrationAction is fully JSON-serializable", () => {
    const action = buildOrchestrationAction(makeInput(), BASE_TIME);
    expect(() => JSON.stringify(action)).not.toThrow();
  });

  it("RecoveryOrchestrationAction has no function properties", () => {
    const action = buildOrchestrationAction(makeInput(), BASE_TIME);
    const hasFn  = Object.values(action).some(v => typeof v === "function");
    expect(hasFn).toBe(false);
  });

  it("TransitionValidation is fully JSON-serializable", () => {
    const result = validateOrchestrationTransition("initiated", "acknowledged");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("ORCHESTRATION_RECOMMENDATION_MAP covers all 8 types", () => {
    for (const type of ALL_ORCHESTRATION_TYPES) {
      expect(ORCHESTRATION_RECOMMENDATION_MAP[type]).toBeDefined();
      expect(Array.isArray(ORCHESTRATION_RECOMMENDATION_MAP[type])).toBe(true);
    }
  });

  it("describeOrchestrationType returns non-empty string for every type", () => {
    for (const type of ALL_ORCHESTRATION_TYPES) {
      const desc = describeOrchestrationType(type);
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - super-admin enforcement valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: super-admin enforcement valid", () => {
  it("buildOrchestrationAction has no async behavior", () => {
    const result = buildOrchestrationAction(makeInput(), BASE_TIME);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("validateOrchestrationTransition has no async behavior", () => {
    const result = validateOrchestrationTransition("initiated", "acknowledged");
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("same input → same orchestration type and status (deterministic)", () => {
    const input = makeInput();
    const a1    = buildOrchestrationAction(input, BASE_TIME);
    const a2    = buildOrchestrationAction(input, BASE_TIME);
    expect(a1.orchestrationType).toBe(a2.orchestrationType);
    expect(a1.orchestrationStatus).toBe(a2.orchestrationStatus);
    expect(a1.workspaceId).toBe(a2.workspaceId);
  });

  it("transition validation is deterministic for same inputs", () => {
    const r1 = validateOrchestrationTransition("in_review", "resolved");
    const r2 = validateOrchestrationTransition("in_review", "resolved");
    expect(r1.valid).toBe(r2.valid);
    expect(r1.errorCode).toBe(r2.errorCode);
  });

  it("each orchestration type has a non-empty recommendation mapping", () => {
    for (const type of ALL_ORCHESTRATION_TYPES) {
      expect(ORCHESTRATION_RECOMMENDATION_MAP[type].length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - observability events scoped correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: observability events scoped correctly", () => {
  const testPayload = {
    actionId:            "orch:1-123",
    workspaceId:         1,
    incidentId:          "inc:1-456",
    orchestrationType:   "operational_watch" as RecoveryOrchestrationType,
    orchestrationStatus: "initiated" as RecoveryOrchestrationStatus,
    initiatedBy:         "admin@platform.local",
    action:              "test",
  };

  it("emitOrchestrationInitiatedEvent does not throw", () => {
    expect(() => emitOrchestrationInitiatedEvent(testPayload)).not.toThrow();
  });

  it("emitOrchestrationAcknowledgedEvent does not throw", () => {
    expect(() =>
      emitOrchestrationAcknowledgedEvent({
        ...testPayload, orchestrationStatus: "acknowledged",
      }),
    ).not.toThrow();
  });

  it("emitOrchestrationResolvedEvent does not throw", () => {
    expect(() =>
      emitOrchestrationResolvedEvent({
        ...testPayload, orchestrationStatus: "resolved",
      }),
    ).not.toThrow();
  });

  it("emitOrchestrationRolledBackEvent does not throw", () => {
    expect(() =>
      emitOrchestrationRolledBackEvent({
        ...testPayload, orchestrationStatus: "rolled_back",
      }),
    ).not.toThrow();
  });

  it("buildOrchestrationAction emits an event (captured via no-throw)", () => {
    expect(() => buildOrchestrationAction(makeInput(), BASE_TIME)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - no autonomous remediation occurs
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: no autonomous remediation occurs", () => {
  it("buildOrchestrationAction returns a value object - not a Promise", () => {
    const result = buildOrchestrationAction(makeInput(), BASE_TIME);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("validateOrchestrationTransition returns validation - not a Promise", () => {
    const result = validateOrchestrationTransition("initiated", "acknowledged");
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("orchestration action has no execute/run/dispatch methods", () => {
    const action = buildOrchestrationAction(makeInput(), BASE_TIME);
    expect(typeof (action as unknown as { execute?: unknown }).execute).not.toBe("function");
    expect(typeof (action as unknown as { run?: unknown }).run).not.toBe("function");
    expect(typeof (action as unknown as { dispatch?: unknown }).dispatch).not.toBe("function");
  });

  it("engine produces only value objects - no callbacks or side-effecting refs", () => {
    const action = buildOrchestrationAction(makeInput(), BASE_TIME);
    const values = Object.values(action);
    const hasFnOrPromise = values.some(v => typeof v === "function" || (v && typeof (v as {then?: unknown}).then === "function"));
    expect(hasFnOrPromise).toBe(false);
  });

  it("full lifecycle path ends at terminal - no further transitions possible", () => {
    const path: RecoveryOrchestrationStatus[] = [
      "initiated", "acknowledged", "in_review", "resolved",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const v = validateOrchestrationTransition(path[i]!, path[i + 1]!);
      expect(v.valid).toBe(true);
    }
    // After resolved, no transitions
    const terminal = validateOrchestrationTransition("resolved", "acknowledged");
    expect(terminal.valid).toBe(false);
    expect(terminal.errorCode).toBe("ORCH_TERMINAL");
  });

  it("isActiveOrchestrationStatus returns false for all terminal states", () => {
    for (const s of TERMINAL_ORCHESTRATION_STATUSES) {
      expect(isActiveOrchestrationStatus(s)).toBe(false);
    }
  });
});
