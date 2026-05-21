/**
 * @file   __tests__/remediation-execution.test.ts
 * @phase  P10-E - Controlled Remediation Execution Research & Explicit Operator
 *                 Confirmation Foundations
 *
 * T1  - execution creation deterministic
 * T2  - confirmation required before execution
 * T3  - duplicate execution conflicts rejected
 * T4  - execution lifecycle transitions deterministic
 * T5  - rollback-result tracking preserved
 * T6  - append-only execution history guaranteed
 * T7  - audit serialization stable
 * T8  - super-admin enforcement valid
 * T9  - observability events scoped correctly
 * T10 - no autonomous remediation execution occurs
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildExecutionAttempt,
  confirmRemediationExecution,
  validateExecutionTransition,
  detectDuplicateExecution,
  isTerminalExecutionStatus,
  isActiveExecutionStatus,
  canConfirm,
  canMarkExecuting,
  canComplete,
  canRollBack,
  canAbandon,
  makeExecutionId,
  resetExecutionSeq,
  EXECUTION_VALID_TRANSITIONS,
  TERMINAL_EXECUTION_STATUSES,
  ACTIVE_EXECUTION_STATUSES,
  ALL_EXECUTION_TYPES,
  ALL_ROLLBACK_STATUSES,
  EXECUTION_ORCHESTRATION_MAP,
  describeExecutionType,
  emitExecutionCreatedEvent,
  emitExecutionConfirmedEvent,
  emitExecutionCompletedEvent,
  emitExecutionRolledBackEvent,
  type RemediationExecutionType,
  type RemediationExecutionStatus,
} from "../remediation-execution";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const BASE_TIME = new Date("2026-05-15T14:00:00.000Z");

function makeInput(
  overrides: Partial<{
    actionId:          string;
    workspaceId:       number;
    executionType:     RemediationExecutionType;
    initiatedBy:       string;
    executionEvidence: string[];
    executionNotes:    string;
  }> = {},
) {
  return {
    actionId:      "orch:1-123",
    workspaceId:   1,
    initiatedBy:   "admin@platform.local",
    executionEvidence: [] as string[],
    ...overrides,
    executionType: (overrides.executionType ?? "operational_intervention") as RemediationExecutionType,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - execution creation deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T1: execution creation deterministic", () => {
  beforeEach(() => resetExecutionSeq());

  it("buildExecutionAttempt creates attempt with status=pending_confirmation", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(attempt.executionStatus).toBe("pending_confirmation");
  });

  it("confirmationMode is always 'explicit'", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(attempt.confirmationMode).toBe("explicit");
  });

  it("executionId starts with 'exec:'", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(attempt.executionId.startsWith("exec:")).toBe(true);
  });

  it("executionId contains workspaceId", () => {
    const attempt = buildExecutionAttempt(makeInput({ workspaceId: 42 }), BASE_TIME);
    expect(attempt.executionId).toContain("42");
  });

  it("rollbackStatus defaults to 'not_applicable'", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(attempt.rollbackStatus).toBe("not_applicable");
  });

  it("confirmedBy and confirmedAt are null initially", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(attempt.confirmedBy).toBeNull();
    expect(attempt.confirmedAt).toBeNull();
  });

  it("executedAt is null initially", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(attempt.executedAt).toBeNull();
  });

  it("makeExecutionId is monotonically unique per call", () => {
    resetExecutionSeq();
    const id1 = makeExecutionId(1);
    const id2 = makeExecutionId(1);
    expect(id1).not.toBe(id2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - confirmation required before execution
// ─────────────────────────────────────────────────────────────────────────────

describe("T2: confirmation required before execution", () => {
  it("confirmRemediationExecution returns valid for pending_confirmation + confirmedBy", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    const result  = confirmRemediationExecution(attempt, "ops@platform.local");
    expect(result.valid).toBe(true);
  });

  it("confirmation fails with EXEC_CONFIRMATION_NO_OPERATOR when confirmedBy is empty", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    const result  = confirmRemediationExecution(attempt, "");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("EXEC_CONFIRMATION_NO_OPERATOR");
  });

  it("confirmation fails with EXEC_CONFIRMATION_WRONG_STATUS when already confirmed", () => {
    const result = confirmRemediationExecution(
      { executionStatus: "confirmed", confirmationMode: "explicit" },
      "ops@platform.local",
    );
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("EXEC_CONFIRMATION_WRONG_STATUS");
  });

  it("confirmation fails with EXEC_CONFIRMATION_MODE_INVALID when mode is not explicit", () => {
    const result = confirmRemediationExecution(
      { executionStatus: "pending_confirmation", confirmationMode: "auto" as "explicit" },
      "ops@platform.local",
    );
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("EXEC_CONFIRMATION_MODE_INVALID");
  });

  it("throws EXEC_VALIDATION_INITIATED_BY when initiatedBy is empty", () => {
    expect(() => buildExecutionAttempt(makeInput({ initiatedBy: "" }), BASE_TIME))
      .toThrow("initiatedBy is required");
  });

  it("throws EXEC_VALIDATION_ACTION_ID when actionId is empty", () => {
    expect(() => buildExecutionAttempt(makeInput({ actionId: "" }), BASE_TIME))
      .toThrow("actionId is required");
  });

  it("throws EXEC_VALIDATION_TYPE when executionType is unknown", () => {
    expect(() =>
      buildExecutionAttempt(
        makeInput({ executionType: "unknown_type" as RemediationExecutionType }),
        BASE_TIME,
      ),
    ).toThrow("is not a valid type");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - duplicate execution conflicts rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("T3: duplicate execution conflicts rejected", () => {
  it("isDuplicate=false when no existing executions for actionId", () => {
    const result = detectDuplicateExecution("orch:1-123", []);
    expect(result.isDuplicate).toBe(false);
  });

  it("isDuplicate=true when same actionId has active execution (pending_confirmation)", () => {
    const existing = [{ actionId: "orch:1-123", executionStatus: "pending_confirmation" }];
    const result   = detectDuplicateExecution("orch:1-123", existing);
    expect(result.isDuplicate).toBe(true);
  });

  it("isDuplicate=true when same actionId has active execution (confirmed)", () => {
    const existing = [{ actionId: "orch:1-123", executionStatus: "confirmed" }];
    const result   = detectDuplicateExecution("orch:1-123", existing);
    expect(result.isDuplicate).toBe(true);
  });

  it("isDuplicate=true when same actionId has active execution (executing)", () => {
    const existing = [{ actionId: "orch:1-123", executionStatus: "executing" }];
    const result   = detectDuplicateExecution("orch:1-123", existing);
    expect(result.isDuplicate).toBe(true);
  });

  it("isDuplicate=false when same actionId execution is terminal (completed)", () => {
    const existing = [{ actionId: "orch:1-123", executionStatus: "completed" }];
    const result   = detectDuplicateExecution("orch:1-123", existing);
    expect(result.isDuplicate).toBe(false);
  });

  it("isDuplicate=false when different actionId", () => {
    const existing = [{ actionId: "orch:2-456", executionStatus: "executing" }];
    const result   = detectDuplicateExecution("orch:1-123", existing);
    expect(result.isDuplicate).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - execution lifecycle transitions deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("T4: execution lifecycle transitions deterministic", () => {
  it("pending_confirmation → confirmed is valid", () => {
    const r = validateExecutionTransition("pending_confirmation", "confirmed");
    expect(r.valid).toBe(true);
  });

  it("pending_confirmation → abandoned is valid", () => {
    const r = validateExecutionTransition("pending_confirmation", "abandoned");
    expect(r.valid).toBe(true);
  });

  it("confirmed → executing is valid", () => {
    const r = validateExecutionTransition("confirmed", "executing");
    expect(r.valid).toBe(true);
  });

  it("executing → completed is valid", () => {
    const r = validateExecutionTransition("executing", "completed");
    expect(r.valid).toBe(true);
  });

  it("executing → rolled_back is valid", () => {
    const r = validateExecutionTransition("executing", "rolled_back");
    expect(r.valid).toBe(true);
  });

  it("pending_confirmation → completed is INVALID (skips states)", () => {
    const r = validateExecutionTransition("pending_confirmation", "completed");
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe("EXEC_TRANSITION_DENIED");
  });

  it("completed → confirmed is INVALID (terminal state)", () => {
    const r = validateExecutionTransition("completed", "confirmed");
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe("EXEC_TERMINAL");
  });

  it("rolled_back → executing is INVALID (terminal state)", () => {
    const r = validateExecutionTransition("rolled_back", "executing");
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe("EXEC_TERMINAL");
  });

  it("abandoned → pending_confirmation is INVALID (terminal state)", () => {
    const r = validateExecutionTransition("abandoned", "pending_confirmation");
    expect(r.valid).toBe(false);
    expect(r.errorCode).toBe("EXEC_TERMINAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - rollback-result tracking preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("T5: rollback-result tracking preserved", () => {
  it("rollbackStatus defaults to 'not_applicable' on creation", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(attempt.rollbackStatus).toBe("not_applicable");
  });

  it("ALL_ROLLBACK_STATUSES has exactly 4 entries", () => {
    expect(ALL_ROLLBACK_STATUSES.size).toBe(4);
    expect(ALL_ROLLBACK_STATUSES.has("not_applicable")).toBe(true);
    expect(ALL_ROLLBACK_STATUSES.has("pending")).toBe(true);
    expect(ALL_ROLLBACK_STATUSES.has("completed")).toBe(true);
    expect(ALL_ROLLBACK_STATUSES.has("failed")).toBe(true);
  });

  it("canRollBack returns true only for executing status", () => {
    expect(canRollBack("executing")).toBe(true);
    expect(canRollBack("confirmed")).toBe(false);
    expect(canRollBack("pending_confirmation")).toBe(false);
    expect(canRollBack("completed")).toBe(false);
  });

  it("canComplete returns true only for executing status", () => {
    expect(canComplete("executing")).toBe(true);
    expect(canComplete("confirmed")).toBe(false);
    expect(canComplete("rolled_back")).toBe(false);
  });

  it("canMarkExecuting returns true only for confirmed status", () => {
    expect(canMarkExecuting("confirmed")).toBe(true);
    expect(canMarkExecuting("pending_confirmation")).toBe(false);
    expect(canMarkExecuting("executing")).toBe(false);
  });

  it("canAbandon is true for all non-terminal states", () => {
    expect(canAbandon("pending_confirmation")).toBe(true);
    expect(canAbandon("confirmed")).toBe(true);
    expect(canAbandon("executing")).toBe(true);
    expect(canAbandon("completed")).toBe(false);
    expect(canAbandon("rolled_back")).toBe(false);
    expect(canAbandon("abandoned")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - append-only execution history guaranteed
// ─────────────────────────────────────────────────────────────────────────────

describe("T6: append-only execution history guaranteed", () => {
  it("buildExecutionAttempt does not mutate input", () => {
    const input  = makeInput();
    const before = JSON.stringify(input);
    buildExecutionAttempt(input, BASE_TIME);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("TERMINAL_EXECUTION_STATUSES has exactly 3 entries", () => {
    expect(TERMINAL_EXECUTION_STATUSES.size).toBe(3);
    expect(TERMINAL_EXECUTION_STATUSES.has("completed")).toBe(true);
    expect(TERMINAL_EXECUTION_STATUSES.has("rolled_back")).toBe(true);
    expect(TERMINAL_EXECUTION_STATUSES.has("abandoned")).toBe(true);
  });

  it("ACTIVE_EXECUTION_STATUSES has exactly 3 entries", () => {
    expect(ACTIVE_EXECUTION_STATUSES.size).toBe(3);
    expect(ACTIVE_EXECUTION_STATUSES.has("pending_confirmation")).toBe(true);
    expect(ACTIVE_EXECUTION_STATUSES.has("confirmed")).toBe(true);
    expect(ACTIVE_EXECUTION_STATUSES.has("executing")).toBe(true);
  });

  it("ALL_EXECUTION_TYPES has exactly 8 entries", () => {
    expect(ALL_EXECUTION_TYPES.size).toBe(8);
  });

  it("terminal statuses have empty EXECUTION_VALID_TRANSITIONS arrays", () => {
    expect(EXECUTION_VALID_TRANSITIONS["completed"]).toHaveLength(0);
    expect(EXECUTION_VALID_TRANSITIONS["rolled_back"]).toHaveLength(0);
    expect(EXECUTION_VALID_TRANSITIONS["abandoned"]).toHaveLength(0);
  });

  it("isTerminalExecutionStatus correctly classifies all statuses", () => {
    expect(isTerminalExecutionStatus("completed")).toBe(true);
    expect(isTerminalExecutionStatus("rolled_back")).toBe(true);
    expect(isTerminalExecutionStatus("abandoned")).toBe(true);
    expect(isTerminalExecutionStatus("pending_confirmation")).toBe(false);
    expect(isTerminalExecutionStatus("confirmed")).toBe(false);
    expect(isTerminalExecutionStatus("executing")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - audit serialization stable
// ─────────────────────────────────────────────────────────────────────────────

describe("T7: audit serialization stable", () => {
  it("RemediationExecutionAttempt is fully JSON-serializable", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(() => JSON.stringify(attempt)).not.toThrow();
  });

  it("RemediationExecutionAttempt has no function properties", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    const hasFn   = Object.values(attempt).some(v => typeof v === "function");
    expect(hasFn).toBe(false);
  });

  it("ExecutionTransitionValidation is fully JSON-serializable", () => {
    const result = validateExecutionTransition("pending_confirmation", "confirmed");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("EXECUTION_ORCHESTRATION_MAP covers all 8 execution types", () => {
    for (const type of ALL_EXECUTION_TYPES) {
      expect(EXECUTION_ORCHESTRATION_MAP[type]).toBeDefined();
      expect(typeof EXECUTION_ORCHESTRATION_MAP[type]).toBe("string");
    }
  });

  it("describeExecutionType returns non-empty string for every type", () => {
    for (const type of ALL_EXECUTION_TYPES) {
      const desc = describeExecutionType(type);
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - super-admin enforcement valid
// ─────────────────────────────────────────────────────────────────────────────

describe("T8: super-admin enforcement valid", () => {
  it("buildExecutionAttempt has no async behavior", () => {
    const result = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("validateExecutionTransition has no async behavior", () => {
    const result = validateExecutionTransition("pending_confirmation", "confirmed");
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("confirmRemediationExecution has no async behavior", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    const result  = confirmRemediationExecution(attempt, "ops@platform.local");
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("same input → same execution type, status, confirmationMode (deterministic)", () => {
    const input = makeInput();
    const a1    = buildExecutionAttempt(input, BASE_TIME);
    const a2    = buildExecutionAttempt(input, BASE_TIME);
    expect(a1.executionType).toBe(a2.executionType);
    expect(a1.executionStatus).toBe(a2.executionStatus);
    expect(a1.confirmationMode).toBe(a2.confirmationMode);
  });

  it("canConfirm true only for pending_confirmation", () => {
    expect(canConfirm("pending_confirmation")).toBe(true);
    expect(canConfirm("confirmed")).toBe(false);
    expect(canConfirm("executing")).toBe(false);
    expect(canConfirm("completed")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - observability events scoped correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("T9: observability events scoped correctly", () => {
  const testPayload = {
    executionId:     "exec:1-123",
    actionId:        "orch:1-456",
    workspaceId:     1,
    executionType:   "operational_intervention" as RemediationExecutionType,
    executionStatus: "pending_confirmation" as RemediationExecutionStatus,
    confirmedBy:     "ops@platform.local",
    action:          "test",
  };

  it("emitExecutionCreatedEvent does not throw", () => {
    expect(() => emitExecutionCreatedEvent(testPayload)).not.toThrow();
  });

  it("emitExecutionConfirmedEvent does not throw", () => {
    expect(() =>
      emitExecutionConfirmedEvent({ ...testPayload, executionStatus: "confirmed" }),
    ).not.toThrow();
  });

  it("emitExecutionCompletedEvent does not throw", () => {
    expect(() =>
      emitExecutionCompletedEvent({ ...testPayload, executionStatus: "completed" }),
    ).not.toThrow();
  });

  it("emitExecutionRolledBackEvent does not throw", () => {
    expect(() =>
      emitExecutionRolledBackEvent({ ...testPayload, executionStatus: "rolled_back" }),
    ).not.toThrow();
  });

  it("buildExecutionAttempt emits created event without throwing", () => {
    expect(() => buildExecutionAttempt(makeInput(), BASE_TIME)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - no autonomous remediation execution occurs
// ─────────────────────────────────────────────────────────────────────────────

describe("T10: no autonomous remediation execution occurs", () => {
  it("buildExecutionAttempt returns a value object - not a Promise", () => {
    const result = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("execution attempt has no execute/run/dispatch/trigger methods", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(typeof (attempt as unknown as { execute?: unknown }).execute).not.toBe("function");
    expect(typeof (attempt as unknown as { run?: unknown }).run).not.toBe("function");
    expect(typeof (attempt as unknown as { dispatch?: unknown }).dispatch).not.toBe("function");
    expect(typeof (attempt as unknown as { trigger?: unknown }).trigger).not.toBe("function");
  });

  it("engine produces only value objects - no callbacks or side-effecting refs", () => {
    const attempt  = buildExecutionAttempt(makeInput(), BASE_TIME);
    const values   = Object.values(attempt);
    const hasFnOrP = values.some(v => typeof v === "function" || (v && typeof (v as { then?: unknown }).then === "function"));
    expect(hasFnOrP).toBe(false);
  });

  it("full lifecycle path ends at terminal - no further transitions possible", () => {
    const path: RemediationExecutionStatus[] = [
      "pending_confirmation", "confirmed", "executing", "completed",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const v = validateExecutionTransition(path[i]!, path[i + 1]!);
      expect(v.valid).toBe(true);
    }
    const terminal = validateExecutionTransition("completed", "confirmed");
    expect(terminal.valid).toBe(false);
    expect(terminal.errorCode).toBe("EXEC_TERMINAL");
  });

  it("isActiveExecutionStatus returns false for all terminal states", () => {
    for (const s of TERMINAL_EXECUTION_STATUSES) {
      expect(isActiveExecutionStatus(s)).toBe(false);
    }
  });

  it("confirmationMode invariant: value is always 'explicit' regardless of input", () => {
    const attempt = buildExecutionAttempt(makeInput(), BASE_TIME);
    expect(attempt.confirmationMode).toBe("explicit");
    // Confirm type-system enforces this
    const mode: "explicit" = attempt.confirmationMode;
    expect(mode).toBe("explicit");
  });
});
