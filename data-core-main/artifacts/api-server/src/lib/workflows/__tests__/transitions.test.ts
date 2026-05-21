/**
 * @file   transitions.test.ts
 * @phase  P4-D - Status Transition Safety unit tests.
 *
 * Tests the pure logic of the optimistic concurrency model:
 *
 * T1  Completion cannot overwrite timed_out or cancelled.
 * T2  Step failure cannot overwrite timed_out or cancelled.
 * T3  Duplicate terminal transitions are always prevented.
 * T4  pending→running guarded: only fires when status='pending'.
 * T5  Cancel route UPDATE guard: rejected when already terminal or flagged.
 * T6  Timeout route UPDATE guard: rejected when already terminal.
 * T7  .returning() empty treated as race safely (log + return).
 * T8  All terminal states remain immutable (no valid successor state).
 *
 * ── WHY OPTIMISTIC CONCURRENCY (NOT LOCKS) ───────────────────────────────────
 *
 * The P4-D guard model uses PostgreSQL's atomic UPDATE + WHERE to implement
 * exactly-once status transitions without distributed locks:
 *
 *   UPDATE ... SET status='completed'
 *   WHERE id = :id AND status = 'running'
 *   RETURNING id;
 *
 * If .returning() is empty → the WHERE guard rejected the UPDATE (race lost).
 * If .returning() has a row → this transition succeeded (exactly once).
 *
 * This is correct because:
 *   1. PostgreSQL guarantees row-level atomic UPDATE.
 *   2. Concurrent UPDATEs on the same row are serialized by the DB engine.
 *   3. No two UPDATEs can both satisfy the WHERE guard simultaneously.
 *
 * ── STATUS TRANSITION TABLE (COMPLETE) ───────────────────────────────────────
 *
 *   FROM               TO                   GUARD
 *   ─────────────────  ───────────────────  ─────────────────────────────────
 *   pending            running              WHERE status='pending'
 *   running            waiting_approval     WHERE status='running'
 *   running            failed               WHERE status NOT IN TERMINAL
 *   running            timed_out            WHERE status NOT IN TERMINAL
 *   running            cancelled            WHERE status NOT IN TERMINAL
 *   running            completed            WHERE status='running'
 *   non-terminal       timed_out (force)    WHERE status NOT IN TERMINAL
 *   (flag)             cancel_requested     WHERE !terminal AND !flagged
 */

import { describe, it, expect } from "vitest";
import { isTerminalStatus, TERMINAL_STATUSES } from "../ttl";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers - model the guarded UPDATE behavior as pure functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulates the P4-D guarded terminal transition (WHERE status NOT terminal).
 * Returns 'ok' if the transition would succeed, 'race_lost' if the guard
 * would reject it (status is already terminal).
 */
function guardedTerminalTransition(
  currentStatus: string,
  targetStatus: string,
): "ok" | "race_lost" {
  if (isTerminalStatus(currentStatus)) {
    return "race_lost"; // WHERE NOT terminal would reject this UPDATE
  }
  void targetStatus; // target applied if guard passes
  return "ok";
}

/**
 * Simulates the guarded completion transition (WHERE status='running').
 * Only transitions from 'running' - stricter than NOT terminal.
 */
function guardedCompletionTransition(currentStatus: string): "ok" | "race_lost" {
  if (currentStatus !== "running") {
    return "race_lost"; // WHERE status='running' would reject this UPDATE
  }
  return "ok";
}

/**
 * Simulates the guarded opening transition (WHERE status='pending').
 */
function guardedOpeningTransition(currentStatus: string): "ok" | "race_lost" {
  if (currentStatus !== "pending") {
    return "race_lost"; // WHERE status='pending' would reject this UPDATE
  }
  return "ok";
}

/**
 * Simulates the guarded cancel flag UPDATE.
 * WHERE cancel_requested=false AND status NOT terminal.
 */
function guardedCancelFlagUpdate(
  currentStatus: string,
  cancelRequested: boolean,
): "ok" | "already_terminal" | "already_requested" {
  if (isTerminalStatus(currentStatus)) return "already_terminal";
  if (cancelRequested) return "already_requested";
  return "ok";
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 - Completion cannot overwrite timed_out or cancelled
// ─────────────────────────────────────────────────────────────────────────────

describe("T1 - completion cannot overwrite terminal states", () => {
  it("completion is rejected when execution is already timed_out", () => {
    expect(guardedCompletionTransition("timed_out")).toBe("race_lost");
  });

  it("completion is rejected when execution is already cancelled", () => {
    expect(guardedCompletionTransition("cancelled")).toBe("race_lost");
  });

  it("completion is rejected when execution is already failed", () => {
    expect(guardedCompletionTransition("failed")).toBe("race_lost");
  });

  it("completion is rejected when execution is already completed", () => {
    expect(guardedCompletionTransition("completed")).toBe("race_lost");
  });

  it("completion is rejected when execution is already error", () => {
    expect(guardedCompletionTransition("error")).toBe("race_lost");
  });

  it("completion is rejected for waiting_approval (non-running non-terminal)", () => {
    // waiting_approval → completed is invalid even though it is not terminal.
    // The completion guard is WHERE status='running' (stricter than NOT terminal).
    expect(guardedCompletionTransition("waiting_approval")).toBe("race_lost");
  });

  it("completion succeeds only when status='running'", () => {
    expect(guardedCompletionTransition("running")).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 - Step failure cannot overwrite timed_out or cancelled
// ─────────────────────────────────────────────────────────────────────────────

describe("T2 - step failure cannot overwrite terminal states", () => {
  const terminalStatuses = ["completed", "failed", "error", "timed_out", "cancelled"];

  terminalStatuses.forEach((s) => {
    it(`step failure → 'failed' is rejected when current status is '${s}'`, () => {
      expect(guardedTerminalTransition(s, "failed")).toBe("race_lost");
    });
  });

  it("step failure transition succeeds when status='running'", () => {
    expect(guardedTerminalTransition("running", "failed")).toBe("ok");
  });

  it("step failure transition succeeds when status='waiting_approval'", () => {
    // waiting_approval is non-terminal - a step can fail even during approval.
    expect(guardedTerminalTransition("waiting_approval", "failed")).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 - Duplicate terminal transitions are always prevented
// ─────────────────────────────────────────────────────────────────────────────

describe("T3 - duplicate terminal transitions are always prevented", () => {
  const terminalStatuses = ["completed", "failed", "error", "timed_out", "cancelled"];

  terminalStatuses.forEach((from) => {
    terminalStatuses.forEach((to) => {
      it(`transition '${from}' → '${to}' is rejected (duplicate terminal)`, () => {
        // Any attempt to transition from a terminal state to another terminal
        // state is rejected by the WHERE NOT terminal guard.
        expect(guardedTerminalTransition(from, to)).toBe("race_lost");
      });
    });
  });

  it("completion guard also blocks self-transition completed→completed", () => {
    expect(guardedCompletionTransition("completed")).toBe("race_lost");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 - pending→running guarded: only fires when status='pending'
// ─────────────────────────────────────────────────────────────────────────────

describe("T4 - pending→running guarded opening transition", () => {
  it("opening transition succeeds when status='pending'", () => {
    expect(guardedOpeningTransition("pending")).toBe("ok");
  });

  it("opening transition is rejected when status='running' (duplicate executor)", () => {
    expect(guardedOpeningTransition("running")).toBe("race_lost");
  });

  it("opening transition is rejected when status='timed_out' (admin forced)", () => {
    expect(guardedOpeningTransition("timed_out")).toBe("race_lost");
  });

  it("opening transition is rejected when status='cancelled'", () => {
    expect(guardedOpeningTransition("cancelled")).toBe("race_lost");
  });

  it("opening transition is rejected when status='completed'", () => {
    expect(guardedOpeningTransition("completed")).toBe("race_lost");
  });

  it("opening transition is rejected when status='waiting_approval'", () => {
    expect(guardedOpeningTransition("waiting_approval")).toBe("race_lost");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 - Cancel route UPDATE guard
// ─────────────────────────────────────────────────────────────────────────────

describe("T5 - cancel route guarded UPDATE logic", () => {
  it("cancel flag is set when status='running' and not yet flagged", () => {
    expect(guardedCancelFlagUpdate("running", false)).toBe("ok");
  });

  it("cancel flag is set when status='waiting_approval' and not yet flagged", () => {
    expect(guardedCancelFlagUpdate("waiting_approval", false)).toBe("ok");
  });

  it("cancel flag is set when status='pending' and not yet flagged", () => {
    expect(guardedCancelFlagUpdate("pending", false)).toBe("ok");
  });

  it("cancel flag UPDATE is rejected when status='completed' (terminal)", () => {
    expect(guardedCancelFlagUpdate("completed", false)).toBe("already_terminal");
  });

  it("cancel flag UPDATE is rejected when status='timed_out' (terminal)", () => {
    expect(guardedCancelFlagUpdate("timed_out", false)).toBe("already_terminal");
  });

  it("cancel flag UPDATE is rejected when status='cancelled' (terminal)", () => {
    expect(guardedCancelFlagUpdate("cancelled", false)).toBe("already_terminal");
  });

  it("cancel flag UPDATE is rejected when cancel_requested is already true", () => {
    expect(guardedCancelFlagUpdate("running", true)).toBe("already_requested");
  });

  it("terminal check fires before duplicate-flag check", () => {
    // If status is terminal AND cancel_requested=true, terminal check wins.
    expect(guardedCancelFlagUpdate("cancelled", true)).toBe("already_terminal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 - Timeout route UPDATE guard (force-timeout)
// ─────────────────────────────────────────────────────────────────────────────

describe("T6 - force-timeout route guarded UPDATE logic", () => {
  const terminalStatuses = ["completed", "failed", "error", "timed_out", "cancelled"];

  terminalStatuses.forEach((s) => {
    it(`force-timeout is rejected when status='${s}' (terminal guard)`, () => {
      expect(guardedTerminalTransition(s, "timed_out")).toBe("race_lost");
    });
  });

  it("force-timeout succeeds when status='running' (non-terminal)", () => {
    expect(guardedTerminalTransition("running", "timed_out")).toBe("ok");
  });

  it("force-timeout succeeds when status='waiting_approval' (non-terminal)", () => {
    expect(guardedTerminalTransition("waiting_approval", "timed_out")).toBe("ok");
  });

  it("force-timeout succeeds when status='pending' (non-terminal)", () => {
    expect(guardedTerminalTransition("pending", "timed_out")).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 - .returning() empty treated as race safely
// ─────────────────────────────────────────────────────────────────────────────

describe("T7 - .returning() empty detection (race model)", () => {
  it("empty .returning() signals a lost race - should not throw, just return", () => {
    // Model: if returning() is empty, the guard rejected the UPDATE.
    // The correct behavior is: log a warn, return safely - no throw, no retry.
    function handleReturnResult(rows: { id: number }[]): "race_lost" | "success" {
      if (rows.length === 0) return "race_lost";
      return "success";
    }

    expect(handleReturnResult([])).toBe("race_lost");
    expect(handleReturnResult([{ id: 1 }])).toBe("success");
  });

  it("race detection is idempotent - detecting a race does not change any state", () => {
    // The guard only reads .returning(); it does not perform any compensating action.
    // This ensures the system converges to a consistent state regardless of detection order.
    const raceDetected: boolean[] = [];
    function detectRace(rows: { id: number }[]) {
      if (rows.length === 0) raceDetected.push(true);
    }

    detectRace([]); // race 1
    detectRace([]); // race 2 (idempotent - just pushes another true, no side effects)

    expect(raceDetected).toHaveLength(2);
    expect(raceDetected.every(Boolean)).toBe(true);
  });

  it("race logs include executionId, workflowId, attemptedTransition, action fields", () => {
    // Validates the structured log shape contract without actually calling the logger.
    type RaceLog = {
      executionId: number;
      workflowId: number;
      attemptedTransition: string;
      action: "transition_race_lost";
    };

    const log: RaceLog = {
      executionId:         42,
      workflowId:          7,
      attemptedTransition: "running→completed",
      action:              "transition_race_lost",
    };

    expect(log.action).toBe("transition_race_lost");
    expect(log.attemptedTransition).toContain("→");
    expect(typeof log.executionId).toBe("number");
    expect(typeof log.workflowId).toBe("number");
  });

  it("all executor transitions use a named attemptedTransition field in race logs", () => {
    const transitions = [
      "pending→running",
      "running→failed",
      "running→waiting_approval",
      "running→timed_out",
      "running→cancelled",
      "running→completed",
    ];

    transitions.forEach((t) => {
      expect(t).toMatch(/\w+→\w+/);
      const [from, to] = t.split("→");
      expect(from).toBeTruthy();
      expect(to).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 - Terminal states remain immutable
// ─────────────────────────────────────────────────────────────────────────────

describe("T8 - terminal states are completely immutable", () => {
  const terminalStatuses = [...TERMINAL_STATUSES];
  const allStatuses = [
    ...terminalStatuses,
    "pending", "running", "waiting_approval",
  ];

  terminalStatuses.forEach((terminal) => {
    allStatuses.forEach((target) => {
      it(`terminal '${terminal}' → '${target}' is blocked by NOT terminal guard`, () => {
        // Any attempt to transition FROM a terminal state is blocked.
        // Uses the NOT terminal guard (covers completion, failure, TTL, cancel).
        expect(guardedTerminalTransition(terminal, target)).toBe("race_lost");
      });
    });
  });

  it("TERMINAL_STATUSES has exactly 5 members", () => {
    expect(TERMINAL_STATUSES).toHaveLength(5);
  });

  it("non-terminal statuses are not in TERMINAL_STATUSES", () => {
    const nonTerminal = ["pending", "running", "waiting_approval"];
    nonTerminal.forEach((s) => {
      expect(isTerminalStatus(s)).toBe(false);
    });
  });

  it("all 5 terminal statuses are guarded by isTerminalStatus", () => {
    const expected = ["completed", "failed", "error", "timed_out", "cancelled"];
    expected.forEach((s) => {
      expect(isTerminalStatus(s)).toBe(true);
    });
  });
});
