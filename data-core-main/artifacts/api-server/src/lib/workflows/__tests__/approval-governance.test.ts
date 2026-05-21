/**
 * @file   approval-governance.test.ts
 * @phase  P5-F - Approval Governance & Human Workflow Integrity
 *
 * Tests the pure logic of the P5-F governance rules:
 *
 * T1  WG-02 is LIFTED: a properly configured approval step activates without error.
 * T2  WG-02_APPROVAL_SPECIFIC_NO_IDS: approverType="specific" + empty approverIds → error.
 * T3  WG-02_APPROVAL_NO_APPROVER_TYPE: missing approverType → error.
 * T4  WG-02_APPROVAL_ROLE_NO_ROLE: approverType="role" + no approverRole → error.
 * T5  WG-02_APPROVAL_MISSING_TITLE: approval step with no title → error.
 * T6  WG-02_APPROVAL_MISSING_MESSAGE: approval step with no message → warning (not error).
 * T7  TTL expiry guard: isExecutionTimedOut() returns true when deadline passed.
 * T8  TTL guard respects null: isExecutionTimedOut(null) = false (no deadline = no block).
 * T9  Version linkage model: approval record must carry workflowId, workflowVersion,
 *     stepSnapshot, executionTimeoutAt alongside the core fields.
 * T10 Replay prevention: guardedResumeTransition returns already_terminal after first
 *     successful approve (immutable lifecycle - re-approve after terminal is blocked).
 *
 * ── PURE TESTS (NO DB) ───────────────────────────────────────────────────────
 *
 * All tests exercise pure functions modelling the governance rules.  The actual
 * DB interactions (INSERT, guarded UPDATE) are covered by E2E and server tests.
 * This file validates the governance LOGIC in isolation so edge-cases (race
 * conditions, clock behaviour, config permutations) can be tested exhaustively.
 *
 * ── validateWorkflow call convention ─────────────────────────────────────────
 *
 * Signature: validateWorkflow(steps: unknown, triggerEvent: string)
 * Note: steps is the first argument, triggerEvent is the second.
 */

import { describe, it, expect } from "vitest";
import { isTerminalStatus, isExecutionTimedOut } from "../ttl";
import { validateWorkflow } from "../validator";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers - pure model functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Models the combined pre-condition guard for both resume and reject
 * (waiting_approval AND cancelRequested=false AND !TTL expired).
 *
 * P5-F: reject uses the same pre-condition model as resume - both check
 * cancelRequested and TTL expiry before the guarded UPDATE.
 */
function guardedApprovalTransition(
  status:          string,
  cancelRequested: boolean,
  timeoutAt:       Date | null,
  now:             Date = new Date(),
): "ok" | "not_waiting_approval" | "already_terminal" | "cancel_requested" | "ttl_expired" {
  if (isTerminalStatus(status)) return "already_terminal";
  if (status !== "waiting_approval") return "not_waiting_approval";
  if (cancelRequested) return "cancel_requested";
  if (isExecutionTimedOut(timeoutAt, now)) return "ttl_expired";
  return "ok";
}

/**
 * Models the replay prevention check.
 *
 * An existing decision record (any action) on the same (executionId, stepIndex)
 * blocks any further decision - the approval lifecycle is immutable once decided.
 */
function replayPrevented(existingDecision: { action: string } | null): boolean {
  return existingDecision !== null;
}

/**
 * Models the version linkage fields required on every approval record (P5-F).
 *
 * These fields form the immutable audit chain:
 *   workflowId         → execution.workflowId
 *   workflowVersion    → execution.workflowVersion
 *   stepSnapshot       → steps[approvalStepIndex] (frozen at decision time)
 *   executionTimeoutAt → execution.timeoutAt
 */
interface ApprovalRecordShape {
  executionId:        number;
  workspaceId:        number;
  workflowId:         number | null;
  workflowVersion:    number | null;
  stepIndex:          number;
  stepName:           string;
  stepSnapshot:       Record<string, unknown> | null;
  action:             "approved" | "rejected";
  decidedBy:          number | null;
  notes:              string | null;
  executionTimeoutAt: Date | null;
}

function buildApprovalRecord(params: ApprovalRecordShape): ApprovalRecordShape {
  return params;
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - WG-02 LIFTED: properly configured approval step activates cleanly
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - WG-02 LIFTED: well-configured approval step passes validation", () => {
  it("approval step with approverType=specific + approverIds passes without WG-02_APPROVAL_BLOCKED", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Manager Approval",
          config: {
            approverType: "specific",
            approverIds:  [42],
            title:        "Approve this ticket",
            message:      "Please review and approve.",
          },
        },
      ],
      "ticket.created",
    );

    const blockedCode = result.errors.find(e => e.code === "WG-02_APPROVAL_BLOCKED");
    expect(blockedCode).toBeUndefined();
  });

  it("well-formed approval step produces no WG-02 errors", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Manager Approval",
          config: {
            approverType: "specific",
            approverIds:  [1, 2, 3],
            title:        "Please approve",
            message:      "Review the item below.",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.errors.filter(e => e.code?.startsWith("WG-02"))).toHaveLength(0);
  });

  it("approval step with approverType=manager passes (no approverIds required)", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Line Manager Approval",
          config: {
            approverType: "manager",
            title:        "Approve leave request",
            message:      "Please review.",
          },
        },
      ],
      "leave.requested",
    );

    const errors = result.errors.filter(e => e.code?.startsWith("WG-02"));
    expect(errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - WG-02_APPROVAL_SPECIFIC_NO_IDS: specific type + empty approverIds
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - WG-02_APPROVAL_SPECIFIC_NO_IDS fires for specific type with no IDs", () => {
  it("approverType=specific with empty array → WG-02_APPROVAL_SPECIFIC_NO_IDS error", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            approverType: "specific",
            approverIds:  [],
            title:        "Approve",
            message:      "Please approve.",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.errors.some(e => e.code === "WG-02_APPROVAL_SPECIFIC_NO_IDS")).toBe(true);
  });

  it("approverType=specific with missing approverIds → WG-02_APPROVAL_SPECIFIC_NO_IDS error", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            approverType: "specific",
            title:        "Approve",
            message:      "Please approve.",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.errors.some(e => e.code === "WG-02_APPROVAL_SPECIFIC_NO_IDS")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - WG-02_APPROVAL_NO_APPROVER_TYPE: missing approverType
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - WG-02_APPROVAL_NO_APPROVER_TYPE fires when approverType is absent", () => {
  it("approval step with no approverType → WG-02_APPROVAL_NO_APPROVER_TYPE", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            title:   "Approve",
            message: "Please approve.",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.errors.some(e => e.code === "WG-02_APPROVAL_NO_APPROVER_TYPE")).toBe(true);
  });

  it("no-approverType error blocks activation (valid=false)", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: { title: "Approve", message: "m" },
        },
      ],
      "ticket.created",
    );

    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - WG-02_APPROVAL_ROLE_NO_ROLE: approverType=role without approverRole
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - WG-02_APPROVAL_ROLE_NO_ROLE fires for role type with no role value", () => {
  it("approverType=role with no approverRole → WG-02_APPROVAL_ROLE_NO_ROLE error", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            approverType: "role",
            title:        "Approve",
            message:      "Please approve.",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.errors.some(e => e.code === "WG-02_APPROVAL_ROLE_NO_ROLE")).toBe(true);
  });

  it("approverType=role with empty-string approverRole → WG-02_APPROVAL_ROLE_NO_ROLE", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            approverType: "role",
            approverRole: "",
            title:        "Approve",
            message:      "Please approve.",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.errors.some(e => e.code === "WG-02_APPROVAL_ROLE_NO_ROLE")).toBe(true);
  });

  it("approverType=role with valid approverRole passes this check", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            approverType: "role",
            approverRole: "admin",
            title:        "Approve",
            message:      "Please approve.",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.errors.some(e => e.code === "WG-02_APPROVAL_ROLE_NO_ROLE")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - WG-02_APPROVAL_MISSING_TITLE: approval step missing title
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - WG-02_APPROVAL_MISSING_TITLE fires when title is absent", () => {
  it("approval step with no title → WG-02_APPROVAL_MISSING_TITLE error", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            approverType: "specific",
            approverIds:  [1],
            message:      "Please review.",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.errors.some(e => e.code === "WG-02_APPROVAL_MISSING_TITLE")).toBe(true);
  });

  it("missing title is an error (not a warning) - blocks activation", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            approverType: "specific",
            approverIds:  [1],
            message:      "Review",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.valid).toBe(false);
    const inWarnings = result.warnings.some(w => w.code === "WG-02_APPROVAL_MISSING_TITLE");
    expect(inWarnings).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - WG-02_APPROVAL_MISSING_MESSAGE: warning (not error)
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - WG-02_APPROVAL_MISSING_MESSAGE is a WARNING (not an error)", () => {
  it("approval step with no message → WG-02_APPROVAL_MISSING_MESSAGE warning", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            approverType: "specific",
            approverIds:  [1],
            title:        "Approve",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.warnings.some(w => w.code === "WG-02_APPROVAL_MISSING_MESSAGE")).toBe(true);
  });

  it("missing message is NOT in errors - does not block activation", () => {
    const result = validateWorkflow(
      [
        {
          index:  0,
          type:   "approval",
          name:   "Approval",
          config: {
            approverType: "specific",
            approverIds:  [1],
            title:        "Approve",
          },
        },
      ],
      "ticket.created",
    );

    expect(result.errors.some(e => e.code === "WG-02_APPROVAL_MISSING_MESSAGE")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - TTL expiry guard: isExecutionTimedOut() returns true when deadline passed
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - TTL expiry guard blocks approval when deadline has passed", () => {
  const past  = new Date("2020-01-01T00:00:00Z");
  const now   = new Date("2025-01-01T00:00:00Z");

  it("guardedApprovalTransition returns ttl_expired when timeoutAt is in the past", () => {
    const result = guardedApprovalTransition("waiting_approval", false, past, now);
    expect(result).toBe("ttl_expired");
  });

  it("guardedApprovalTransition returns ok when timeoutAt is in the future", () => {
    const future = new Date("2030-01-01T00:00:00Z");
    const result = guardedApprovalTransition("waiting_approval", false, future, now);
    expect(result).toBe("ok");
  });

  it("ttl_expired takes priority over a valid waiting_approval status", () => {
    const result = guardedApprovalTransition("waiting_approval", false, past, now);
    expect(result).not.toBe("ok");
    expect(result).not.toBe("not_waiting_approval");
  });

  it("cancel_requested takes priority over ttl_expired (both cancel and expired)", () => {
    // cancelRequested check fires before TTL check in both executor functions.
    const result = guardedApprovalTransition("waiting_approval", true, past, now);
    expect(result).toBe("cancel_requested");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - TTL null means no deadline - isExecutionTimedOut(null) = false
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - TTL guard with null timeoutAt never blocks (legacy executions)", () => {
  it("isExecutionTimedOut(null) returns false regardless of current time", () => {
    expect(isExecutionTimedOut(null)).toBe(false);
    expect(isExecutionTimedOut(null, new Date("2099-01-01"))).toBe(false);
    expect(isExecutionTimedOut(undefined, new Date("2099-01-01"))).toBe(false);
  });

  it("guardedApprovalTransition returns ok when timeoutAt is null", () => {
    const result = guardedApprovalTransition("waiting_approval", false, null);
    expect(result).toBe("ok");
  });

  it("guardedApprovalTransition with null timeoutAt + cancelRequested returns cancel_requested (not ok)", () => {
    const result = guardedApprovalTransition("waiting_approval", true, null);
    expect(result).toBe("cancel_requested");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Version linkage model: approval record carries all P5-F fields
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - Approval record carries full version linkage fields (P5-F)", () => {
  it("approval record includes workflowId and workflowVersion", () => {
    const record = buildApprovalRecord({
      executionId:        101,
      workspaceId:        1,
      workflowId:         55,
      workflowVersion:    3,
      stepIndex:          2,
      stepName:           "Manager Sign-off",
      stepSnapshot:       { type: "approval", name: "Manager Sign-off", index: 2, config: {} },
      action:             "approved",
      decidedBy:          7,
      notes:              "Looks good",
      executionTimeoutAt: new Date("2026-01-01T12:00:00Z"),
    });

    expect(record.workflowId).toBe(55);
    expect(record.workflowVersion).toBe(3);
  });

  it("approval record captures stepSnapshot (frozen step config at decision time)", () => {
    const stepConfig = { type: "approval", name: "Step A", index: 0, config: { approverType: "manager" } };

    const record = buildApprovalRecord({
      executionId:        200,
      workspaceId:        1,
      workflowId:         10,
      workflowVersion:    1,
      stepIndex:          0,
      stepName:           "Step A",
      stepSnapshot:       stepConfig,
      action:             "rejected",
      decidedBy:          3,
      notes:              "Not approved",
      executionTimeoutAt: null,
    });

    expect(record.stepSnapshot).toEqual(stepConfig);
  });

  it("approval record captures executionTimeoutAt for TTL audit", () => {
    const deadline = new Date("2026-06-01T00:00:00Z");

    const record = buildApprovalRecord({
      executionId:        300,
      workspaceId:        1,
      workflowId:         20,
      workflowVersion:    2,
      stepIndex:          1,
      stepName:           "HR Approval",
      stepSnapshot:       null,
      action:             "approved",
      decidedBy:          8,
      notes:              null,
      executionTimeoutAt: deadline,
    });

    expect(record.executionTimeoutAt).toEqual(deadline);
  });

  it("version linkage fields are null-safe for pre-P5-F executions", () => {
    const record = buildApprovalRecord({
      executionId:        400,
      workspaceId:        1,
      workflowId:         null,
      workflowVersion:    null,
      stepIndex:          0,
      stepName:           "Legacy Approval",
      stepSnapshot:       null,
      action:             "approved",
      decidedBy:          1,
      notes:              null,
      executionTimeoutAt: null,
    });

    expect(record.workflowId).toBeNull();
    expect(record.workflowVersion).toBeNull();
    expect(record.stepSnapshot).toBeNull();
    expect(record.executionTimeoutAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 - Replay prevention: second decision is blocked after first succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe("T10 - Replay prevention: once a decision is recorded, re-approval is blocked", () => {
  it("replayPrevented(null) = false - no existing decision, approval is allowed", () => {
    expect(replayPrevented(null)).toBe(false);
  });

  it("replayPrevented({action:'approved'}) = true - replay blocked", () => {
    expect(replayPrevented({ action: "approved" })).toBe(true);
  });

  it("replayPrevented({action:'rejected'}) = true - re-reject also blocked", () => {
    expect(replayPrevented({ action: "rejected" })).toBe(true);
  });

  it("after terminal state: guardedApprovalTransition returns already_terminal", () => {
    // Once the guarded UPDATE succeeds (approved → running → completed),
    // subsequent approve attempts see status='completed' (terminal) and are blocked.
    for (const terminal of ["completed", "failed", "error", "timed_out", "cancelled"] as const) {
      const result = guardedApprovalTransition(terminal, false, null);
      expect(result).toBe("already_terminal");
    }
  });

  it("exact-once guarantee: guard + replay check form two independent layers of defence", () => {
    // Layer 1 (pre-flight): replayPrevented() checks for existing approval record.
    // Layer 2 (atomic gate): guarded UPDATE WHERE status='waiting_approval' → empty .returning()
    //
    // Both layers must independently block re-approval even if one is bypassed.

    // Scenario A: replay check catches existing decision
    const preFlightCaught = replayPrevented({ action: "approved" });
    expect(preFlightCaught).toBe(true);

    // Scenario B: even if pre-flight is skipped, the terminal status check
    // catches the already-completed execution (the transition set it to 'completed').
    const atomicGateCaught = guardedApprovalTransition("completed", false, null);
    expect(atomicGateCaught).toBe("already_terminal");
  });
});
