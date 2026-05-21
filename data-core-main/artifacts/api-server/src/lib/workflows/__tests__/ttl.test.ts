/**
 * P4-B: Lazy TTL - Unit Tests
 *
 * Tests for:
 *   isExecutionTimedOut()  - pure TTL guard
 *   isTerminalStatus()     - terminal state guard
 *   computeOverdueMs()     - overdue duration calculation
 *   computeTimeoutAt()     - deadline computation
 *
 * These are pure unit tests: no DB, no Express, no mocks.
 *
 * Test cases T1-T6 map to the acceptance criteria in the P4-B spec.
 */

import { describe, it, expect } from "vitest";
import {
  isExecutionTimedOut,
  isTerminalStatus,
  computeOverdueMs,
  computeTimeoutAt,
  TERMINAL_STATUSES,
} from "../ttl";

// ── T1: Execution times out between steps ─────────────────────────────────────

describe("T1 - isExecutionTimedOut: past deadline returns true", () => {
  it("returns true when timeoutAt is in the past", () => {
    const past = new Date(Date.now() - 1000); // 1 second ago
    expect(isExecutionTimedOut(past)).toBe(true);
  });

  it("returns true when timeoutAt is exactly 1ms in the past", () => {
    const now = new Date();
    const timeoutAt = new Date(now.getTime() - 1);
    expect(isExecutionTimedOut(timeoutAt, now)).toBe(true);
  });

  it("returns true when timeoutAt was set 25 hours ago (default TTL=24h exceeded)", () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(isExecutionTimedOut(twentyFiveHoursAgo)).toBe(true);
  });

  it("injectable 'now' parameter: timeout in the past relative to injected now", () => {
    const timeoutAt = new Date("2025-01-01T10:00:00Z");
    const now       = new Date("2025-01-01T11:00:00Z"); // 1 hour later
    expect(isExecutionTimedOut(timeoutAt, now)).toBe(true);
  });
});

// ── T2: Running step completes before timeout enforcement ──────────────────────
//
// The cooperative model means: the executor calls isExecutionTimedOut ONLY
// AFTER a step has fully completed.  This test verifies the behavioral contract:
// if the deadline is still in the future at the inter-step check, no timeout occurs.

describe("T2 - isExecutionTimedOut: future deadline returns false (step completes first)", () => {
  it("returns false when timeoutAt is in the future", () => {
    const future = new Date(Date.now() + 60_000); // 1 minute from now
    expect(isExecutionTimedOut(future)).toBe(false);
  });

  it("returns false when timeoutAt is exactly 1ms in the future", () => {
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + 1);
    expect(isExecutionTimedOut(timeoutAt, now)).toBe(false);
  });

  it("returns false when timeoutAt is 24h in the future (fresh execution)", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(isExecutionTimedOut(future)).toBe(false);
  });

  it("injectable 'now': deadline in the future relative to injected now", () => {
    const timeoutAt = new Date("2025-06-01T12:00:00Z");
    const now       = new Date("2025-06-01T11:00:00Z"); // 1 hour before deadline
    expect(isExecutionTimedOut(timeoutAt, now)).toBe(false);
  });

  it("isExecutionTimedOut at EXACT deadline time returns false (not strictly past)", () => {
    // now === timeoutAt - should NOT time out (> not >=)
    const deadline = new Date("2025-01-01T12:00:00.000Z");
    const now      = new Date("2025-01-01T12:00:00.000Z");
    expect(isExecutionTimedOut(deadline, now)).toBe(false);
  });
});

// ── T3: Terminal executions cannot be timed out ───────────────────────────────

describe("T3 - isTerminalStatus: terminal executions rejected", () => {
  it("returns true for 'completed'", () => {
    expect(isTerminalStatus("completed")).toBe(true);
  });

  it("returns true for 'failed'", () => {
    expect(isTerminalStatus("failed")).toBe(true);
  });

  it("returns true for 'error'", () => {
    expect(isTerminalStatus("error")).toBe(true);
  });

  it("returns true for 'timed_out'", () => {
    expect(isTerminalStatus("timed_out")).toBe(true);
  });

  it("returns true for 'cancelled' (future P4-C)", () => {
    expect(isTerminalStatus("cancelled")).toBe(true);
  });

  it("returns false for 'running' - can be timed out", () => {
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("returns false for 'waiting_approval' - can be admin-forced to timed_out", () => {
    expect(isTerminalStatus("waiting_approval")).toBe(false);
  });

  it("returns false for 'pending' - can be timed out", () => {
    expect(isTerminalStatus("pending")).toBe(false);
  });

  it("returns false for unknown statuses", () => {
    expect(isTerminalStatus("unknown_state")).toBe(false);
    expect(isTerminalStatus("")).toBe(false);
  });

  it("TERMINAL_STATUSES has exactly 5 entries - no accidental additions", () => {
    expect(TERMINAL_STATUSES).toHaveLength(5);
  });

  it("all entries in TERMINAL_STATUSES pass isTerminalStatus", () => {
    for (const s of TERMINAL_STATUSES) {
      expect(isTerminalStatus(s)).toBe(true);
    }
  });
});

// ── T4: Stuck diagnostics - overdue computation ───────────────────────────────
//
// The stuck endpoint filters WHERE timeout_at < now() in DB.
// At the unit level, we test the overdue duration calculation used in the
// stuck endpoint response and structured logs.

describe("T4 - computeOverdueMs: stuck execution overdue calculation", () => {
  it("returns positive ms for past deadline", () => {
    const timeoutAt = new Date("2025-01-01T10:00:00Z");
    const now       = new Date("2025-01-01T11:00:00Z"); // 1 hour later
    const overdue   = computeOverdueMs(timeoutAt, now);
    expect(overdue).toBe(60 * 60 * 1000); // exactly 1 hour in ms
  });

  it("returns 0 for future deadline (not overdue)", () => {
    const timeoutAt = new Date("2025-01-01T12:00:00Z");
    const now       = new Date("2025-01-01T11:00:00Z"); // 1 hour before
    expect(computeOverdueMs(timeoutAt, now)).toBe(0);
  });

  it("returns 0 for exact deadline match (not yet overdue)", () => {
    const t = new Date("2025-01-01T12:00:00Z");
    expect(computeOverdueMs(t, t)).toBe(0);
  });

  it("returns 0 for null timeoutAt (legacy rows - never overdue)", () => {
    expect(computeOverdueMs(null)).toBe(0);
    expect(computeOverdueMs(undefined)).toBe(0);
  });

  it("handles large overdue values (days)", () => {
    const timeoutAt = new Date("2025-01-01T00:00:00Z");
    const now       = new Date("2025-01-08T00:00:00Z"); // 7 days later
    expect(computeOverdueMs(timeoutAt, now)).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

// ── T5: Legacy executions without timeout_at don't break ─────────────────────

describe("T5 - legacy rows (timeout_at = NULL) handled safely", () => {
  it("isExecutionTimedOut(null) returns false - no timeout enforced", () => {
    expect(isExecutionTimedOut(null)).toBe(false);
  });

  it("isExecutionTimedOut(undefined) returns false - no timeout enforced", () => {
    expect(isExecutionTimedOut(undefined)).toBe(false);
  });

  it("computeOverdueMs(null) returns 0 - no overdue for legacy rows", () => {
    expect(computeOverdueMs(null)).toBe(0);
  });

  it("computeOverdueMs(undefined) returns 0", () => {
    expect(computeOverdueMs(undefined)).toBe(0);
  });

  it("isExecutionTimedOut with null is safe to call at every inter-step boundary", () => {
    // Simulate being called hundreds of times (executor loop)
    for (let i = 0; i < 100; i++) {
      expect(isExecutionTimedOut(null)).toBe(false);
    }
  });
});

// ── T6: timed_out appears in status system ────────────────────────────────────
//
// Verifies that 'timed_out' is correctly classified in the status taxonomy:
//   - It IS a terminal status (cannot be re-timed-out or re-failed)
//   - It is NOT treated as "success" by any helper
//   - The TERMINAL_STATUSES list contains it

describe("T6 - timed_out appears correctly in the status system", () => {
  it("'timed_out' is in TERMINAL_STATUSES", () => {
    expect(TERMINAL_STATUSES).toContain("timed_out");
  });

  it("isTerminalStatus('timed_out') is true - prevents double-timeout", () => {
    expect(isTerminalStatus("timed_out")).toBe(true);
  });

  it("isExecutionTimedOut does not depend on status string - only on the timestamp", () => {
    // The TTL guard is pure timestamp comparison; it doesn't know about status.
    // Status checks (is it terminal?) are separate from timeout checks.
    const past = new Date(Date.now() - 1000);
    // Even a 'timed_out' execution would return true here - the route guard
    // (isTerminalStatus) is what prevents the DB update in that case.
    expect(isExecutionTimedOut(past)).toBe(true);
  });

  it("'timed_out' is distinct from 'failed' - different error semantics", () => {
    // Both are terminal, but they represent different failure modes:
    // - failed: step threw error or returned { success: false }
    // - timed_out: execution ran too long (steps may have all succeeded)
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("timed_out")).toBe(true);
    // They're different strings
    expect("timed_out").not.toBe("failed");
  });
});

// ── computeTimeoutAt: deadline derivation ─────────────────────────────────────

describe("computeTimeoutAt - deadline derivation", () => {
  it("returns date exactly N hours from the reference time", () => {
    const from = new Date("2025-01-01T00:00:00Z");
    const result = computeTimeoutAt(24, from);
    expect(result.toISOString()).toBe("2025-01-02T00:00:00.000Z");
  });

  it("returns date 1 hour from now for TTL=1", () => {
    const from = new Date("2025-06-01T10:00:00Z");
    const result = computeTimeoutAt(1, from);
    expect(result.getTime()).toBe(from.getTime() + 60 * 60 * 1000);
  });

  it("fractional hours (0.5 = 30 minutes)", () => {
    const from = new Date("2025-01-01T00:00:00Z");
    const result = computeTimeoutAt(0.5, from);
    expect(result.getTime()).toBe(from.getTime() + 30 * 60 * 1000);
  });

  it("result is always in the future relative to 'from'", () => {
    const from = new Date();
    const result = computeTimeoutAt(24, from);
    expect(result.getTime()).toBeGreaterThan(from.getTime());
  });

  it("computeTimeoutAt(24) produces a timestamp that isExecutionTimedOut returns false for", () => {
    // A freshly computed 24h deadline should NOT be timed out yet
    const timeoutAt = computeTimeoutAt(24);
    expect(isExecutionTimedOut(timeoutAt)).toBe(false);
  });

  it("a deadline in the past (negative TTL equivalent) should be detected as timed out", () => {
    // Simulate a deadline that was set in the past (e.g., legacy row with old value)
    const from   = new Date("2025-01-01T00:00:00Z");
    const past   = computeTimeoutAt(24, from); // deadline: 2025-01-02T00:00:00Z
    const future = new Date("2025-01-03T00:00:00Z"); // checking at Jan 3 → overdue
    expect(isExecutionTimedOut(past, future)).toBe(true);
  });
});
