/**
 * @file        workflows/ttl.ts
 * @purpose     Pure TTL (Time-To-Live) guard utilities for P4-B: Lazy TTL.
 *
 * ── WHY COOPERATIVE TIMEOUT (NOT PREEMPTIVE) ─────────────────────────────────
 *
 * Preemptive timeout (Promise.race + setTimeout per execution) risks leaving a
 * step handler in an inconsistent state - it may have partially updated the DB,
 * sent a notification, or created a task.  Cutting execution mid-step would
 * orphan those side effects with no cleanup path.
 *
 * The cooperative model guarantees:
 *   • Every step either fully completes (output written to DB) or is never started.
 *   • The timeout is checked BETWEEN steps - never during a running step.
 *   • A step that runs longer than the TTL will still complete - the TTL
 *     applies to the WORKFLOW as a whole, not to individual steps.
 *
 * Trade-off: an execution where one step takes 25 hours will time out only after
 * that step completes, not at the 24h mark.  This is acceptable because:
 *   a) Individual steps should be short-lived (< seconds).  Long-running steps
 *      are a sign of an integration problem, not a workflow design issue.
 *   b) The stuck diagnostics endpoint (GET /executions/stuck) will surface
 *      such executions for manual admin intervention.
 *   c) A future background sweeper (Phase 5+) will forcibly mark executions
 *      that never reach an inter-step boundary (e.g., stuck approval steps).
 *
 * ── WHY NO SCHEDULER ─────────────────────────────────────────────────────────
 *
 * Adding a cron or setTimeout per execution requires:
 *   • Distributed timer management and persistence of timer IDs.
 *   • Handling process restarts (timers are lost on server restart).
 *   • Coordination across multiple server instances in future.
 *
 * The lazy model avoids all of this.  The TTL is checked on the next inter-step
 * boundary after the deadline passes - at most one step late.  For the current
 * workflow types (all linear, short-running steps), this is sufficient.
 *
 * ── STATUS DIFFERENTIATION ───────────────────────────────────────────────────
 *
 *   timed_out   = execution ran for too long regardless of step success/failure.
 *                 All steps may have succeeded; the workflow just ran too slowly.
 *                 Set by the executor at inter-step boundary (lazy) OR by
 *                 POST /executions/:id/timeout (admin force-timeout).
 *
 *   failed      = a step returned { success: false } or threw an error.
 *                 The workflow attempted the step and it didn't work.
 *
 *   cancelled   = (future P4-C) explicit admin or user cancellation.
 *                 Active intent to stop - different from passive deadline expiry.
 *
 * ── BACKWARD COMPATIBILITY ───────────────────────────────────────────────────
 *
 * Existing rows in workflow_executions have timeout_at = NULL.
 * isExecutionTimedOut(null) returns false - no timeout is enforced for legacy rows.
 * This requires zero data migration.
 */

/**
 * Terminal execution statuses - executions in these states cannot be further
 * transitioned by the TTL system or the admin force-timeout action.
 *
 * Used by POST /executions/:id/timeout to reject invalid requests gracefully.
 *
 * Note: 'waiting_approval' is NOT terminal - an approval-paused execution
 * may still be force-timed-out by an admin.
 */
export const TERMINAL_STATUSES = [
  "completed",
  "failed",
  "error",
  "timed_out",
  "cancelled", // future P4-C
] as const;

export type TerminalStatus = typeof TERMINAL_STATUSES[number];

/**
 * Returns true if the given status is a terminal (non-resumable) status.
 *
 * Terminal executions must not be transitioned to timed_out, cancelled, or
 * any other status - they have already reached a definitive final state.
 *
 * @param status  The current execution status string.
 */
export function isTerminalStatus(status: string): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * P4-B: Lazy TTL guard - pure function, no side effects.
 *
 * Returns true if the execution deadline has passed and the execution should
 * be transitioned to status='timed_out'.
 *
 * Returns false (no timeout) when:
 *   • timeoutAt is null or undefined - legacy execution with no deadline set.
 *   • The current time is before or exactly at the deadline.
 *
 * This function is called at the inter-step boundary inside the executor loop.
 * The executor calls it AFTER the current step has fully completed (output
 * recorded in DB) and BEFORE initiating the next step.  It never interrupts
 * a running step.
 *
 * The `now` parameter is injectable for unit tests (avoids Date.now() mocking).
 *
 * @param timeoutAt  The absolute deadline for the execution.  NULL = no deadline.
 * @param now        Current time reference.  Defaults to new Date().
 * @returns          true if the execution has exceeded its TTL, false otherwise.
 */
export function isExecutionTimedOut(
  timeoutAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (timeoutAt == null) return false;
  return now > timeoutAt;
}

/**
 * Computes the default timeout timestamp for a new execution.
 *
 * @param ttlHours  Number of hours from now to set as the deadline.
 * @param from      Reference time.  Defaults to new Date().
 * @returns         The absolute deadline as a Date object.
 */
export function computeTimeoutAt(ttlHours: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + ttlHours * 60 * 60 * 1000);
}

/**
 * Computes how many milliseconds overdue an execution is.
 *
 * Used for structured log fields and the stuck diagnostics endpoint to surface
 * how long an execution has been stuck past its deadline.
 *
 * Returns 0 if timeoutAt is null (no deadline) or if the deadline hasn't passed.
 *
 * @param timeoutAt  The execution deadline.
 * @param now        Current time reference.  Defaults to new Date().
 */
export function computeOverdueMs(
  timeoutAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (timeoutAt == null) return 0;
  const diff = now.getTime() - timeoutAt.getTime();
  return Math.max(0, diff);
}
