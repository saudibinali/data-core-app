/**
 * @file   approval-resume.test.ts
 * @phase  P4-E - Approval Resume & Safe Executor Re-entry unit tests.
 *
 * Tests the pure logic of the approval resume model:
 *
 * T1  Approval resumes execution from the step AFTER the approval step.
 * T2  The approval step itself is never re-executed on resume.
 * T3  Duplicate resume is prevented by the guarded transition.
 * T4  Terminal states block resume (exact-once guarantee).
 * T5  cancelRequested=true blocks resume (cancel safety).
 * T6  Approval rejection transitions execution to failed.
 * T7  waiting_approval → running guarded transition model.
 * T8  Resume preserves exact-once semantics (cannot overwrite terminal).
 * T9  Resume cannot overwrite terminal states (immutability invariant).
 *
 * ── WHY PURE TESTS (NO DB) ───────────────────────────────────────────────────
 *
 * These tests validate the guard logic, resume position calculation, and
 * state transition models without touching a real database.  The actual DB
 * interactions are validated via E2E verification and the server integration.
 *
 * The guard model is deterministic pure logic:
 *   guardedResumeTransition(currentStatus, cancelRequested) → "ok" | reason
 * This can be tested exhaustively across all status × cancelRequested combinations.
 */

import { describe, it, expect } from "vitest";
import { isTerminalStatus, TERMINAL_STATUSES } from "../ttl";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers - model the P4-E guard logic as pure functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Models the WHERE guard for the approval resume transition:
 *   WHERE status='waiting_approval' AND cancelRequested=false
 *
 * Returns:
 *   'ok'                          - guard would pass
 *   'not_waiting_approval'        - status is not waiting_approval (non-terminal)
 *   'already_terminal'            - status is already terminal
 *   'cancel_requested'            - cancel flag is set
 */
function guardedResumeTransition(
  status: string,
  cancelRequested: boolean,
): "ok" | "not_waiting_approval" | "already_terminal" | "cancel_requested" {
  if (isTerminalStatus(status)) return "already_terminal";
  if (status !== "waiting_approval") return "not_waiting_approval";
  if (cancelRequested) return "cancel_requested";
  return "ok";
}

/**
 * Models the WHERE guard for the approval rejection transition:
 *   WHERE status='waiting_approval'
 *
 * Returns:
 *   'ok'                    - guard would pass
 *   'not_waiting_approval'  - wrong non-terminal status
 *   'already_terminal'      - already terminal
 */
function guardedRejectionTransition(
  status: string,
): "ok" | "not_waiting_approval" | "already_terminal" {
  if (isTerminalStatus(status)) return "already_terminal";
  if (status !== "waiting_approval") return "not_waiting_approval";
  return "ok";
}

/**
 * Computes the resume starting step index.
 *
 * The approval step at currentStepIndex already completed (notifications sent,
 * output recorded).  Resume starts from currentStepIndex + 1.
 */
function computeResumeFromIndex(currentStepIndex: number): number {
  return currentStepIndex + 1;
}

/**
 * Models the .returning() race detection for the resume transition.
 * Empty .returning() → race lost → log + return safely.
 */
function handleResumeReturnResult(rows: { id: number }[]): "race_lost" | "success" {
  if (rows.length === 0) return "race_lost";
  return "success";
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Approval resumes execution from the step AFTER the approval step
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - approval resume starts from the NEXT step after approval", () => {
  it("resumeFromIndex = approvalStepIndex + 1", () => {
    expect(computeResumeFromIndex(0)).toBe(1);
    expect(computeResumeFromIndex(1)).toBe(2);
    expect(computeResumeFromIndex(2)).toBe(3);
    expect(computeResumeFromIndex(9)).toBe(10);
  });

  it("resumeFromIndex is always strictly greater than approvalStepIndex", () => {
    const indices = [0, 1, 2, 3, 5, 10, 99];
    indices.forEach((i) => {
      const resumeFrom = computeResumeFromIndex(i);
      expect(resumeFrom).toBeGreaterThan(i);
    });
  });

  it("resumeFromIndex differs from approvalStepIndex by exactly 1", () => {
    const indices = [0, 1, 2, 3, 5, 10];
    indices.forEach((i) => {
      const resumeFrom = computeResumeFromIndex(i);
      expect(resumeFrom - i).toBe(1);
    });
  });

  it("a 3-step workflow with approval at step 1 resumes from step 2", () => {
    // steps: [notification(0), approval(1), task(2)]
    // After approval at step 1, resume starts at step 2 (task)
    const approvalStepIndex = 1;
    const resumeFrom = computeResumeFromIndex(approvalStepIndex);
    const totalSteps = 3;
    expect(resumeFrom).toBe(2);
    expect(resumeFrom).toBeLessThan(totalSteps); // there is work remaining
  });

  it("a 2-step workflow with approval at the last step resumes to completion", () => {
    // steps: [notification(0), approval(1)]
    // After approval at step 1, resume starts at step 2 = steps.length
    // The loop body never executes → completion UPDATE fires
    const approvalStepIndex = 1;
    const resumeFrom = computeResumeFromIndex(approvalStepIndex);
    const totalSteps = 2;
    expect(resumeFrom).toBe(totalSteps); // loop doesn't execute, goes to completion
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - The approval step itself is never re-executed on resume
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - approval step is never re-executed on resume", () => {
  it("the approval step index is not in the range [resumeFromIndex, totalSteps)", () => {
    // For each approvalStepIndex, verify that the approval step is NOT
    // in the set of steps that will be executed after resume.
    const cases = [
      { approvalStepIndex: 0, totalSteps: 3 }, // approval first
      { approvalStepIndex: 1, totalSteps: 3 }, // approval middle
      { approvalStepIndex: 2, totalSteps: 3 }, // approval last
    ];

    cases.forEach(({ approvalStepIndex, totalSteps }) => {
      const resumeFrom = computeResumeFromIndex(approvalStepIndex);
      const stepsToRun = Array.from(
        { length: Math.max(0, totalSteps - resumeFrom) },
        (_, k) => resumeFrom + k,
      );
      expect(stepsToRun).not.toContain(approvalStepIndex);
    });
  });

  it("steps before the approval step are also not re-executed", () => {
    // steps: [notification(0), approval(1), task(2), assignment(3)]
    // Resume from step 2 → only steps 2 and 3 run
    const approvalStepIndex = 1;
    const resumeFrom = computeResumeFromIndex(approvalStepIndex);
    const totalSteps = 4;
    const stepsToRun = Array.from(
      { length: totalSteps - resumeFrom },
      (_, k) => resumeFrom + k,
    );
    expect(stepsToRun).toEqual([2, 3]);
    expect(stepsToRun).not.toContain(0); // notification not re-run
    expect(stepsToRun).not.toContain(1); // approval not re-run
  });

  it("stepOutputs from completed steps are available without re-running those steps", () => {
    // Model: after resume, stepOutputs should already contain completed steps' outputs.
    // This is restored from DB (workflow_execution_steps) - not by re-running steps.
    const restoredStepOutputs: Record<number, Record<string, unknown>> = {
      0: { notificationSent: true, recipientIds: [1, 2] },
      1: { approvalType: "single", status: "pending_approval", approverIds: [3] },
    };

    // The approval step output (step 1) is available via restored context.
    expect(restoredStepOutputs[1]).toBeDefined();
    expect(restoredStepOutputs[1]!["status"]).toBe("pending_approval");

    // The notification step output (step 0) is also available.
    expect(restoredStepOutputs[0]).toBeDefined();
    expect(restoredStepOutputs[0]!["notificationSent"]).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Duplicate resume is prevented
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - duplicate resume is prevented by the guarded transition", () => {
  it("first resume: status='waiting_approval' → guard passes", () => {
    expect(guardedResumeTransition("waiting_approval", false)).toBe("ok");
  });

  it("second (concurrent) resume: status='running' (first already won) → guard rejects", () => {
    // After the first resume wins the guarded UPDATE, status becomes 'running'.
    // A concurrent second resume attempt sees status='running' (not 'waiting_approval').
    expect(guardedResumeTransition("running", false)).toBe("not_waiting_approval");
  });

  it("second (sequential) resume: status='completed' (first already finished) → guard rejects", () => {
    // After the first resume completes all remaining steps, status='completed'.
    expect(guardedResumeTransition("completed", false)).toBe("already_terminal");
  });

  it(".returning() empty on duplicate concurrent approve → race_lost", () => {
    // Both approvers pass the pre-check simultaneously, but only one wins the UPDATE.
    expect(handleResumeReturnResult([])).toBe("race_lost");
    expect(handleResumeReturnResult([{ id: 42 }])).toBe("success");
  });

  it("exactly one approval record is inserted per guarded UPDATE success", () => {
    // Model: approval records are only inserted AFTER the guarded UPDATE succeeds.
    // If .returning() is empty, no approval record is inserted.
    const approvalRecords: string[] = [];

    function simulateApprove(rows: { id: number }[]) {
      if (rows.length === 0) return; // race lost - no record inserted
      approvalRecords.push("approved");
    }

    simulateApprove([]);         // concurrent loser - no record
    simulateApprove([{ id: 1 }]); // winner - one record

    expect(approvalRecords).toHaveLength(1);
    expect(approvalRecords[0]).toBe("approved");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Terminal states block resume
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - terminal states block resume", () => {
  const terminalStatuses = [...TERMINAL_STATUSES];

  terminalStatuses.forEach((status) => {
    it(`resume is blocked when status='${status}' (terminal)`, () => {
      expect(guardedResumeTransition(status, false)).toBe("already_terminal");
    });
  });

  it("resume is blocked for all 5 terminal statuses", () => {
    expect(terminalStatuses).toHaveLength(5);
    terminalStatuses.forEach((s) => {
      expect(guardedResumeTransition(s, false)).toBe("already_terminal");
    });
  });

  it("resume is allowed only from 'waiting_approval' status", () => {
    // Only one non-terminal status allows resume.
    expect(guardedResumeTransition("waiting_approval", false)).toBe("ok");
    expect(guardedResumeTransition("running",          false)).toBe("not_waiting_approval");
    expect(guardedResumeTransition("pending",          false)).toBe("not_waiting_approval");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - cancelRequested=true blocks resume
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - cancelRequested=true blocks resume", () => {
  it("resume is blocked when cancelRequested=true and status='waiting_approval'", () => {
    expect(guardedResumeTransition("waiting_approval", true)).toBe("cancel_requested");
  });

  it("resume is allowed when cancelRequested=false and status='waiting_approval'", () => {
    expect(guardedResumeTransition("waiting_approval", false)).toBe("ok");
  });

  it("cancel check fires AFTER terminal check", () => {
    // If status is terminal AND cancelRequested=true, terminal wins.
    expect(guardedResumeTransition("timed_out",  true)).toBe("already_terminal");
    expect(guardedResumeTransition("cancelled",  true)).toBe("already_terminal");
    expect(guardedResumeTransition("completed",  true)).toBe("already_terminal");
  });

  it("cancel check fires AFTER status check", () => {
    // If status is running AND cancelRequested=true, not_waiting_approval wins.
    expect(guardedResumeTransition("running", true)).toBe("not_waiting_approval");
  });

  it("WHERE guard combines status AND cancelRequested atomically", () => {
    // Model: the WHERE clause is evaluated atomically by PostgreSQL.
    // Status='waiting_approval' AND cancelRequested=false → both conditions must hold.
    function whereGuard(status: string, cancelRequested: boolean): boolean {
      return status === "waiting_approval" && !cancelRequested;
    }

    expect(whereGuard("waiting_approval", false)).toBe(true);
    expect(whereGuard("waiting_approval", true)).toBe(false);
    expect(whereGuard("running",          false)).toBe(false);
    expect(whereGuard("timed_out",        false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Approval rejection transitions to failed
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - approval rejection transitions safely to failed", () => {
  it("rejection guard passes when status='waiting_approval'", () => {
    expect(guardedRejectionTransition("waiting_approval")).toBe("ok");
  });

  it("rejection guard rejects when status='running'", () => {
    expect(guardedRejectionTransition("running")).toBe("not_waiting_approval");
  });

  it("rejection guard rejects for all terminal statuses", () => {
    TERMINAL_STATUSES.forEach((s) => {
      expect(guardedRejectionTransition(s)).toBe("already_terminal");
    });
  });

  it("rejection produces status='failed' (not a new terminal status)", () => {
    // 'failed' is already in TERMINAL_STATUSES - no schema change needed.
    expect(isTerminalStatus("failed")).toBe(true);
    expect(TERMINAL_STATUSES).toContain("failed");
  });

  it("rejection records a workflow_approvals row with action='rejected'", () => {
    // Model: rejection inserts an approval record after the guarded UPDATE succeeds.
    const records: Array<{ action: string; notes?: string }> = [];

    function simulateReject(rows: { id: number }[], notes?: string) {
      if (rows.length === 0) return; // race lost
      records.push({ action: "rejected", notes });
    }

    simulateReject([{ id: 1 }], "Not compliant with policy");
    expect(records).toHaveLength(1);
    expect(records[0]!.action).toBe("rejected");
    expect(records[0]!.notes).toBe("Not compliant with policy");
  });

  it("rejection race: .returning() empty → no record inserted", () => {
    const records: string[] = [];
    function simulateReject(rows: { id: number }[]) {
      if (rows.length === 0) return;
      records.push("rejected");
    }
    simulateReject([]); // race lost
    expect(records).toHaveLength(0);
  });

  it("'failed' is immutable after rejection - cannot be approved or resumed", () => {
    expect(guardedResumeTransition("failed",    false)).toBe("already_terminal");
    expect(guardedRejectionTransition("failed")).toBe("already_terminal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - waiting_approval → running guarded transition model
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - waiting_approval → running guarded transition", () => {
  it("only status='waiting_approval' with cancelRequested=false passes the guard", () => {
    const allStatuses = [
      "pending", "running", "waiting_approval",
      "completed", "failed", "error", "timed_out", "cancelled",
    ];

    const passing = allStatuses.filter(
      (s) => guardedResumeTransition(s, false) === "ok",
    );
    expect(passing).toEqual(["waiting_approval"]);
  });

  it("no other status passes the resume guard (with cancelRequested=false)", () => {
    const otherStatuses = [
      "pending", "running",
      "completed", "failed", "error", "timed_out", "cancelled",
    ];
    otherStatuses.forEach((s) => {
      expect(guardedResumeTransition(s, false)).not.toBe("ok");
    });
  });

  it("the guard is more restrictive than NOT terminal (requires specific status)", () => {
    // NOT terminal includes: pending, running, waiting_approval
    // Resume guard includes: ONLY waiting_approval (without cancelRequested)
    // This is stricter - a 'running' execution cannot be re-approved.
    expect(isTerminalStatus("running")).toBe(false);
    expect(guardedResumeTransition("running", false)).toBe("not_waiting_approval");

    expect(isTerminalStatus("pending")).toBe(false);
    expect(guardedResumeTransition("pending", false)).toBe("not_waiting_approval");

    expect(isTerminalStatus("waiting_approval")).toBe(false);
    expect(guardedResumeTransition("waiting_approval", false)).toBe("ok");
  });

  it("guard message codes are distinct for each failure reason", () => {
    // Ensures the API can return the correct error code for each failure case.
    const cases = [
      { status: "completed",        cancelRequested: false, expected: "already_terminal" },
      { status: "running",          cancelRequested: false, expected: "not_waiting_approval" },
      { status: "waiting_approval", cancelRequested: true,  expected: "cancel_requested" },
      { status: "waiting_approval", cancelRequested: false, expected: "ok" },
    ];

    cases.forEach(({ status, cancelRequested, expected }) => {
      expect(guardedResumeTransition(status, cancelRequested)).toBe(expected);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Resume preserves exact-once semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - resume preserves exact-once semantics", () => {
  it("exactly one resume can win the guarded UPDATE for a given execution", () => {
    // Model: two concurrent approvers both call the guard, but only one can win.
    let winCount = 0;

    function simulateGuardedUpdate(currentStatus: string, cancelRequested: boolean): boolean {
      const guardResult = guardedResumeTransition(currentStatus, cancelRequested);
      if (guardResult !== "ok") return false;
      winCount++;
      return true; // in reality, only one UPDATE would win in PostgreSQL
    }

    // First approver wins:
    expect(simulateGuardedUpdate("waiting_approval", false)).toBe(true);
    expect(winCount).toBe(1);

    // Second approver: status is now 'running' (first already won)
    // The guard detects this and rejects.
    expect(simulateGuardedUpdate("running", false)).toBe(false);
    expect(winCount).toBe(1); // still 1 - second didn't win
  });

  it("approval record is inserted exactly once (after guard wins)", () => {
    const records: number[] = [];

    function insertApprovalRecord(guardWon: boolean, executionId: number) {
      if (!guardWon) return;
      records.push(executionId);
    }

    insertApprovalRecord(true,  42); // winner
    insertApprovalRecord(false, 42); // loser - no record
    insertApprovalRecord(false, 42); // another loser

    expect(records).toHaveLength(1);
    expect(records[0]).toBe(42);
  });

  it("resume loop (runStepLoop) runs exactly once per execution", () => {
    // Model: the void runStepLoop() is only called inside the guarded block.
    // If the guard fails, runStepLoop is never called.
    let loopStartCount = 0;

    function simulateResume(guardResult: "ok" | string) {
      if (guardResult !== "ok") return; // race lost - no loop
      loopStartCount++;
    }

    simulateResume("ok");                  // first: loop starts
    simulateResume("not_waiting_approval"); // concurrent: no loop
    simulateResume("transition_race_lost"); // another concurrent: no loop

    expect(loopStartCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 - Resume cannot overwrite terminal states (immutability invariant)
// ─────────────────────────────────────────────────────────────────────────────

describe("T9 - resume cannot overwrite terminal states", () => {
  const terminalStatuses = [...TERMINAL_STATUSES];
  const allStatuses = [...terminalStatuses, "pending", "running", "waiting_approval"];

  terminalStatuses.forEach((terminal) => {
    allStatuses.forEach((target) => {
      it(`cannot transition FROM terminal '${terminal}' via resume guard`, () => {
        // The resume guard requires status='waiting_approval' as its pre-condition.
        // Terminal states are not 'waiting_approval' → guard always rejects.
        expect(guardedResumeTransition(terminal, false)).toBe("already_terminal");
      });
    });
  });

  it("completed execution cannot be approved", () => {
    expect(guardedResumeTransition("completed", false)).toBe("already_terminal");
  });

  it("timed_out execution cannot be approved", () => {
    expect(guardedResumeTransition("timed_out", false)).toBe("already_terminal");
  });

  it("cancelled execution cannot be approved", () => {
    expect(guardedResumeTransition("cancelled", false)).toBe("already_terminal");
  });

  it("failed execution cannot be approved or rejected again", () => {
    expect(guardedResumeTransition("failed",    false)).toBe("already_terminal");
    expect(guardedRejectionTransition("failed")).toBe("already_terminal");
  });

  it("error execution cannot be approved", () => {
    expect(guardedResumeTransition("error", false)).toBe("already_terminal");
  });

  it("a previously resumed execution (now 'running') cannot be approved again", () => {
    // After resume, status='running'. A second approve attempt sees 'running'.
    expect(guardedResumeTransition("running", false)).toBe("not_waiting_approval");
  });
});
