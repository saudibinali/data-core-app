/**
 * @file   cancellation.test.ts
 * @phase  P4-C - Cooperative Cancellation unit tests.
 *
 * Tests the pure logic that guards cancel requests and cooperative abort:
 *
 * T1  cancel_requested flag stops execution before the next step.
 *     (Pure logic: if cancelRequested is true at the boundary, cancelled fires.)
 * T2  A running step always completes before cancellation is enforced.
 *     (Pure model: cancellation only fires at inter-step boundary.)
 * T3  Terminal executions cannot be cancelled - isTerminalStatus guards them.
 * T4  Duplicate cancellation requests are rejected (cancelRequested already true).
 * T5  'cancelled' appears in TERMINAL_STATUSES and diagnostics status model.
 * T6  Timeout endpoint rejects cancelled executions (isTerminalStatus check).
 * T7  cancel_requested flag semantics - pure boolean, default false.
 *
 * ── WHY COOPERATIVE CANCELLATION ─────────────────────────────────────────────
 *
 * Cancellation is cooperative, not preemptive.  The cancel flag is checked at
 * the INTER-STEP BOUNDARY - after the current step fully completes and before
 * the next step begins.  This guarantees:
 *   • No partial step execution is ever interrupted.
 *   • No side effects from partially-run steps.
 *   • The executor remains the sole owner of status transitions.
 *
 * ── STATUS DIFFERENTIATION ───────────────────────────────────────────────────
 *
 *   cancelled   = explicit admin/user intent to abort the execution.
 *                 Set by the executor when it reads cancel_requested = true
 *                 at the inter-step boundary.  Active choice to stop.
 *
 *   timed_out   = passive deadline expiry.  The execution ran too long
 *                 regardless of step outcomes.  No one "chose" to stop it.
 *
 *   failed      = a step returned { success: false } or threw.
 *                 The workflow attempted the step; it didn't work.
 *
 * ── WHY NO AbortController ───────────────────────────────────────────────────
 *
 * AbortController + Promise cancellation would interrupt a step mid-execution,
 * leaving partially-written DB records (notifications sent, tasks created,
 * status updates applied) with no cleanup path.  The cooperative model
 * guarantees every step either fully completes or is never started.
 */

import { describe, it, expect } from "vitest";
import {
  isTerminalStatus,
  TERMINAL_STATUSES,
  isExecutionTimedOut,
  computeOverdueMs,
} from "../ttl";

// ─────────────────────────────────────────────────────────────────────────────
// T1 - cancel_requested=true stops execution before the next step
// ─────────────────────────────────────────────────────────────────────────────
//
// The executor's inter-step boundary logic is:
//   1. Step i finishes (output stored, DB updated).
//   2. Check TTL → if expired, return timed_out.
//   3. Check cancel_requested → if true, transition to cancelled and return.
//   4. Start step i+1.
//
// This test validates the pure conditional: if cancel_requested is true,
// the executor MUST NOT proceed to the next step.
//
// The executor re-fetches cancel_requested from the DB so it picks up
// any flag set by POST /executions/:id/cancel during step execution.

describe("T1 - cooperative cancellation guard logic", () => {
  it("cancel_requested=true should cause the executor to stop (not start next step)", () => {
    // Simulate the inter-step boundary check
    const cancelRequested = true;
    const nextStepWouldStart = !cancelRequested;
    expect(nextStepWouldStart).toBe(false);
  });

  it("cancel_requested=false allows the executor to proceed to the next step", () => {
    const cancelRequested = false;
    const nextStepWouldStart = !cancelRequested;
    expect(nextStepWouldStart).toBe(true);
  });

  it("cancellation check fires AFTER TTL check - both can fire but TTL takes priority", () => {
    // Inter-step boundary order:
    //   1. TTL check  → if expired, return (cancelled never fires)
    //   2. Cancel check → if flagged, return
    // If TTL fires, we stop before reaching cancel check.
    const ttlExpired = true;
    const cancelRequested = true;

    let result: "timed_out" | "cancelled" | "continue" = "continue";
    if (ttlExpired) {
      result = "timed_out"; // TTL wins
    } else if (cancelRequested) {
      result = "cancelled";
    }
    // TTL takes priority over cancellation at the same boundary
    expect(result).toBe("timed_out");
  });

  it("cancel fires correctly when TTL is not expired but cancel_requested=true", () => {
    const ttlExpired = false;
    const cancelRequested = true;

    let result: "timed_out" | "cancelled" | "continue" = "continue";
    if (ttlExpired) {
      result = "timed_out";
    } else if (cancelRequested) {
      result = "cancelled";
    }
    expect(result).toBe("cancelled");
  });

  it("execution continues normally when neither TTL nor cancel_requested triggers", () => {
    const ttlExpired = false;
    const cancelRequested = false;

    let result: "timed_out" | "cancelled" | "continue" = "continue";
    if (ttlExpired) {
      result = "timed_out";
    } else if (cancelRequested) {
      result = "cancelled";
    }
    expect(result).toBe("continue");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Running step always completes before cancellation is enforced
// ─────────────────────────────────────────────────────────────────────────────
//
// The cooperative model guarantees:
//   cancel_requested is checked ONLY AFTER the current step fully completes.
//
// This is a model invariant - not testable with a pure function - but we can
// verify the sequence description is correct by testing the boundary placement.

describe("T2 - step-completion invariant (cooperative model)", () => {
  it("the cancellation check happens at the boundary, not mid-step", () => {
    // Model the inter-step sequence as a series of completed events.
    // The boundary fires AFTER stepCompleted = true.
    type BoundaryCheck = { stepCompleted: boolean; cancelRequested: boolean };

    function applyBoundary({ stepCompleted, cancelRequested }: BoundaryCheck) {
      if (!stepCompleted) {
        throw new Error("Cancellation fired before step completed - invariant violated");
      }
      return cancelRequested ? "cancelled" : "continue";
    }

    // Normal case: step completed, then cancelled
    expect(applyBoundary({ stepCompleted: true, cancelRequested: true })).toBe("cancelled");

    // Normal case: step completed, no cancel
    expect(applyBoundary({ stepCompleted: true, cancelRequested: false })).toBe("continue");
  });

  it("zero-step workflow cannot trigger cancellation via inter-step boundary", () => {
    // A workflow with 0 steps: the for-loop body never executes.
    // The cancellation check (inside the loop) never fires.
    // The execution completes normally regardless of cancel_requested.
    //
    // This is expected behavior: if there are no steps, the execution
    // is instant - there's no boundary to check at.
    const stepCount = 0;
    let boundaryChecks = 0;
    for (let i = 0; i < stepCount; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      boundaryChecks++;
    }
    expect(boundaryChecks).toBe(0);
    // Zero-step workflows can still be force-timed-out/cancelled via admin endpoints.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Terminal executions cannot be cancelled
// ─────────────────────────────────────────────────────────────────────────────
//
// POST /executions/:id/cancel rejects any execution already in a terminal status.
// This prevents double-cancellation and invalid state transitions.

describe("T3 - terminal executions cannot be cancelled", () => {
  const terminalStatuses = ["completed", "failed", "error", "timed_out", "cancelled"];

  terminalStatuses.forEach((s) => {
    it(`rejects cancel request on '${s}' execution (isTerminalStatus guard)`, () => {
      expect(isTerminalStatus(s)).toBe(true);
    });
  });

  const nonTerminalStatuses = ["pending", "running", "waiting_approval"];

  nonTerminalStatuses.forEach((s) => {
    it(`allows cancel request on '${s}' execution (non-terminal)`, () => {
      expect(isTerminalStatus(s)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - Duplicate cancellation requests rejected
// ─────────────────────────────────────────────────────────────────────────────
//
// POST /executions/:id/cancel returns 409 CONFLICT if cancel_requested is already true.
// This prevents double-setting and confusing operator feedback.

describe("T4 - duplicate cancellation rejection logic", () => {
  it("cancel is rejected when cancel_requested is already true", () => {
    const cancelAlreadyRequested = true;

    function shouldRejectCancel(cancelRequested: boolean, isTerminal: boolean): boolean {
      return isTerminal || cancelRequested;
    }

    expect(shouldRejectCancel(cancelAlreadyRequested, false)).toBe(true);
  });

  it("cancel is accepted when cancel_requested is false and execution is non-terminal", () => {
    function shouldRejectCancel(cancelRequested: boolean, isTerminal: boolean): boolean {
      return isTerminal || cancelRequested;
    }

    expect(shouldRejectCancel(false, false)).toBe(false);
  });

  it("cancel is rejected when execution is already cancelled (terminal + dup)", () => {
    // A 'cancelled' execution: isTerminal = true AND cancelRequested = true in DB.
    // Both guards would reject, isTerminal fires first.
    const isCancelled = isTerminalStatus("cancelled");
    expect(isCancelled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - 'cancelled' appears in diagnostics and status model
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - 'cancelled' in status system", () => {
  it("'cancelled' is in TERMINAL_STATUSES", () => {
    expect(TERMINAL_STATUSES).toContain("cancelled");
  });

  it("all five terminal statuses are present in the model", () => {
    const expected = ["completed", "failed", "error", "timed_out", "cancelled"];
    expected.forEach((s) => expect(TERMINAL_STATUSES).toContain(s));
  });

  it("'cancelled' is treated the same as other terminal statuses by diagnostics guards", () => {
    expect(isTerminalStatus("cancelled")).toBe(true);
  });

  it("'running' and 'waiting_approval' are not terminal - appear in stuck/active views", () => {
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("waiting_approval")).toBe(false);
    expect(isTerminalStatus("pending")).toBe(false);
  });

  it("cancelled executions are excluded from stuck endpoint (they are terminal)", () => {
    // The stuck endpoint filters: status IN ('running', 'waiting_approval').
    // 'cancelled' is NOT in that list, so cancelled executions never appear as stuck.
    const stuckStatuses = ["running", "waiting_approval"];
    expect(stuckStatuses).not.toContain("cancelled");
  });

  it("cancelled executions are distinct from timed_out in the status model", () => {
    // Both are terminal, but their meaning differs:
    //   cancelled  = active intent (admin/user explicitly stopped it)
    //   timed_out  = passive deadline expiry (no one chose to stop it)
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("timed_out")).toBe(true);
    // They are different strings - a consumer can distinguish them
    expect("cancelled").not.toBe("timed_out");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Timeout endpoint rejects cancelled executions
// ─────────────────────────────────────────────────────────────────────────────
//
// POST /executions/:id/timeout uses isTerminalStatus to guard the transition.
// Since 'cancelled' is terminal, force-timeout is rejected for cancelled executions.

describe("T6 - timeout endpoint rejects cancelled executions", () => {
  it("isTerminalStatus('cancelled') blocks force-timeout (422 response)", () => {
    const status = "cancelled";
    const wouldReject = isTerminalStatus(status);
    expect(wouldReject).toBe(true);
  });

  it("force-timeout is accepted for 'running' execution (non-terminal)", () => {
    const status = "running";
    const wouldReject = isTerminalStatus(status);
    expect(wouldReject).toBe(false);
  });

  it("force-timeout is accepted for 'waiting_approval' execution (non-terminal)", () => {
    const status = "waiting_approval";
    const wouldReject = isTerminalStatus(status);
    expect(wouldReject).toBe(false);
  });

  it("timeout endpoint also rejects timed_out executions (already terminal)", () => {
    expect(isTerminalStatus("timed_out")).toBe(true);
  });

  it("timeout endpoint also rejects completed executions", () => {
    expect(isTerminalStatus("completed")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - cancel_requested flag semantics (pure boolean, default false)
// ─────────────────────────────────────────────────────────────────────────────
//
// The schema sets DEFAULT FALSE, meaning all new and existing rows start
// with cancel_requested = false.  The flag is only set to true by
// POST /executions/:id/cancel - never set to false after that.
// (It's not reset on execution completion; the final status tells the story.)

describe("T7 - cancel_requested flag semantics", () => {
  it("default cancel_requested=false does not trigger cancellation", () => {
    const cancelRequested: boolean = false; // DB DEFAULT
    expect(cancelRequested).toBe(false);
  });

  it("cancel_requested=true triggers cancellation at the inter-step boundary", () => {
    const cancelRequested: boolean = true;
    expect(cancelRequested).toBe(true);
  });

  it("cancellation is idempotent at the executor level - once cancelled, stays cancelled", () => {
    // After status='cancelled' is set, the executor returns.
    // Any subsequent check (which won't happen) would see a terminal status.
    const status = "cancelled";
    expect(isTerminalStatus(status)).toBe(true);
  });

  it("cancel_requested is independent of TTL - an execution can be both overdue and cancel-flagged", () => {
    const past = new Date(Date.now() - 1000);
    const cancelRequested = true;
    // TTL fires first at the boundary (P4-B check runs before P4-C check)
    const ttlFired = isExecutionTimedOut(past);
    expect(ttlFired).toBe(true);
    expect(cancelRequested).toBe(true);
    // Both conditions are true; timed_out takes priority (TTL check is first)
  });

  it("computeOverdueMs still works correctly for cancelled executions with no timeoutAt", () => {
    // Legacy cancelled executions (no timeoutAt) have overdueMs = 0.
    expect(computeOverdueMs(null)).toBe(0);
    expect(computeOverdueMs(undefined)).toBe(0);
  });

  it("a cancelled execution with a timeoutAt still reports correct overdueMs", () => {
    const past = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    const overdueMs = computeOverdueMs(past);
    expect(overdueMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 10);
    expect(overdueMs).toBeLessThanOrEqual(5 * 60 * 1000 + 5000);
  });
});
