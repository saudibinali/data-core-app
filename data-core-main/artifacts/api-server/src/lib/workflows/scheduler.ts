/**
 * @file   scheduler.ts
 * @phase  P6-A - Scheduling Infrastructure & Delayed Workflow Execution Foundations
 *
 * Single-process deterministic scheduler for delayed workflow executions.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 * WorkflowScheduler is a poll-based in-process scheduler that:
 *
 *   1. Polls the DB every POLL_INTERVAL_MS for executions in status='waiting_delay'
 *      with wake_at <= now().
 *   2. For each candidate, calls resumeDelayedExecution() which performs a
 *      guarded acquisition (UPDATE WHERE status='waiting_delay' → 'running').
 *   3. If the acquisition wins, resumeDelayedExecution() reconstructs the
 *      context and re-enters runStepLoop from scheduledStepIndex.
 *   4. Emits a scheduler_poll_cycle structured log event after each cycle.
 *
 * ── DESIGN DECISIONS ─────────────────────────────────────────────────────────
 *
 * POLLING (NOT TIMERS):
 *   No per-execution setTimeout is registered.  All wake-up timing comes from
 *   the DB column workflow_executions.wake_at.  The scheduler polls at a fixed
 *   interval and picks up any execution whose wake_at has passed.  This means:
 *     • Process restart safety: no timers to re-register on restart.
 *     • Bounded staleness: at most POLL_INTERVAL_MS late for any wake-up.
 *     • DB-backed durability: wake_at survives crashes.
 *
 * SETTIMEOUT LOOP (NOT setInterval):
 *   Using `setTimeout(...).finally(() => _schedule())` means the next poll
 *   starts AFTER the current one completes - preventing overlapping poll cycles
 *   if a single cycle takes longer than the interval.
 *
 * GUARDED ACQUISITION:
 *   The scheduler uses resumeDelayedExecution()'s guarded UPDATE (P4-D model)
 *   to acquire executions.  A SELECT + UPDATE pattern ensures that even if two
 *   scheduler instances (current: one per process) try to pick up the same
 *   execution, exactly one wins.  The loser's .returning() is empty → race
 *   lost → skip silently.  This is future-safe for multi-instance deployments.
 *
 * SINGLE-PROCESS:
 *   The current architecture runs one Node.js process per API server instance.
 *   The scheduler lives inside that process and starts when the server starts.
 *   In a future multi-process or multi-replica deployment, the guarded
 *   acquisition model already prevents duplicate wakes - no code change needed.
 *
 * BATCH SIZE:
 *   The scheduler picks at most BATCH_SIZE executions per cycle.  If more are
 *   due, they are picked up in the next cycle.  This prevents a single large
 *   backlog from blocking the event loop for too long.
 *
 * ── WHAT THIS FILE DOES NOT DO ───────────────────────────────────────────────
 *
 * - No reminder engine, no escalation policies, no retries.
 * - No cron expression language, no distributed coordinator.
 * - No Kafka, no queue infrastructure, no Temporal-style orchestration.
 * - No per-execution timer IDs stored or managed.
 *
 * This is intentionally the minimal deterministic delayed execution
 * infrastructure needed for P6-A.
 */

import { db } from "@workspace/db";
import { workflowExecutionsTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { logger } from "../logger";
import { resumeDelayedExecution } from "./executor";

// ── Scheduler constants ───────────────────────────────────────────────────────

/**
 * How often the scheduler polls the DB for due delayed executions.
 *
 * 15 seconds provides a good balance:
 *   • Bounded staleness: any delayed execution resumes within 15s of wakeAt.
 *   • Low DB pressure: one SELECT per 15s regardless of execution volume.
 *   • Fast enough for enterprise workflows (most delays are minutes/hours).
 *
 * Reduce for lower-latency requirements (minimum: ~1 second to avoid
 * excessive DB load).  Increase for very low-volume deployments.
 */
const POLL_INTERVAL_MS = 15_000;

/**
 * Maximum number of due delayed executions to process per poll cycle.
 *
 * Prevents a large backlog (e.g., after server downtime) from flooding the
 * event loop in a single cycle.  Remaining executions are picked up in
 * subsequent cycles.
 */
const BATCH_SIZE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowScheduler
// ─────────────────────────────────────────────────────────────────────────────

export class WorkflowScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  /**
   * Start the scheduler polling loop.
   * Idempotent - calling start() on an already-running scheduler is a no-op.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    logger.info(
      {
        pollIntervalMs: POLL_INTERVAL_MS,
        batchSize:      BATCH_SIZE,
        action:         "scheduler_started",
      },
      "[governance] P6-A: Workflow scheduler started - polling for delayed executions",
    );

    this._schedule();
  }

  /**
   * Stop the scheduler polling loop.
   * Any in-flight poll cycle completes naturally - stop() just prevents the
   * next cycle from being scheduled.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    logger.info(
      { action: "scheduler_stopped" },
      "[governance] P6-A: Workflow scheduler stopped",
    );
  }

  /**
   * Schedule the next poll cycle using setTimeout.
   *
   * Using setTimeout (not setInterval) ensures the next cycle starts AFTER
   * the current one completes.  If pollOnce() takes 14 seconds, the next
   * poll starts 15 seconds later - not simultaneously.
   */
  private _schedule(): void {
    if (!this.running) return;

    this.timer = setTimeout(() => {
      void this.pollOnce()
        .catch((err: unknown) => {
          logger.error(
            { err, action: "scheduler_poll_error" },
            "[governance] P6-A: Scheduler poll cycle threw an unexpected error",
          );
        })
        .finally(() => {
          this._schedule();
        });
    }, POLL_INTERVAL_MS);
  }

  /**
   * Execute one poll cycle.
   *
   * 1. SELECT up to BATCH_SIZE executions WHERE status='waiting_delay'
   *    AND wake_at <= now.
   * 2. For each candidate, call resumeDelayedExecution() which performs a
   *    guarded acquisition.  If the acquisition wins, the execution is resumed
   *    in-process.  If lost (race), the candidate is silently skipped.
   * 3. Emit a scheduler_poll_cycle structured log event.
   *
   * @param now  Injectable time reference for testing.  Defaults to new Date().
   * @returns    Statistics for this poll cycle.
   */
  async pollOnce(now: Date = new Date()): Promise<{
    found:   number;
    resumed: number;
    skipped: number;
  }> {
    // ── SELECT due delayed executions ─────────────────────────────────────────
    //
    // Composite index idx_wf_exec_wake on (status, wake_at) makes this
    // query sub-second at scale.  LIMIT prevents processing more than
    // BATCH_SIZE per cycle - backlog is processed across multiple cycles.
    const candidates = await db
      .select({
        id:     workflowExecutionsTable.id,
        wakeAt: workflowExecutionsTable.wakeAt,
      })
      .from(workflowExecutionsTable)
      .where(and(
        eq(workflowExecutionsTable.status, "waiting_delay"),
        lte(workflowExecutionsTable.wakeAt, now),
      ))
      .limit(BATCH_SIZE);

    let resumed = 0;
    let skipped = 0;

    // ── Process each candidate with guarded acquisition ───────────────────────
    //
    // resumeDelayedExecution() performs a P4-D guarded UPDATE so each
    // execution is acquired exactly once even under concurrent schedulers.
    //
    // Result codes that are NOT "ok":
    //   "already_terminal"     - execution reached terminal state while waiting
    //   "cancel_requested"     - cancel was requested; executor transitioned to cancelled
    //   "ttl_expired"          - TTL passed; executor transitioned to timed_out
    //   "wake_at_not_reached"  - should not happen (candidates filtered by wake_at)
    //   "transition_race_lost" - another concurrent acquire won (safe to skip)
    //   "not_waiting_delay"    - status changed between SELECT and UPDATE (safe)
    for (const candidate of candidates) {
      try {
        const result = await resumeDelayedExecution(candidate.id, now);

        if (result === "ok") {
          resumed++;
        } else {
          skipped++;

          // Log non-ok, non-race results for observability - these indicate
          // governance decisions (cancelled, timed_out) worth surfacing.
          if (result !== "transition_race_lost" && result !== "not_waiting_delay") {
            logger.info(
              {
                executionId: candidate.id,
                wakeAt:      candidate.wakeAt?.toISOString() ?? null,
                result,
                action:      "execution_delay_resume_blocked",
              },
              `[governance] P6-A: Scheduler skipped delayed execution - ${result}`,
            );
          }
        }
      } catch (err: unknown) {
        skipped++;
        logger.error(
          {
            err,
            executionId: candidate.id,
            action:      "execution_delay_resume_error",
          },
          "[governance] P6-A: Scheduler: unexpected error resuming delayed execution",
        );
      }
    }

    // ── Emit scheduler_poll_cycle audit event ─────────────────────────────────
    logger.info(
      {
        found:   candidates.length,
        resumed,
        skipped,
        now:     now.toISOString(),
        action:  "scheduler_poll_cycle",
      },
      "[governance] P6-A: Scheduler poll cycle complete",
    );

    return { found: candidates.length, resumed, skipped };
  }
}

/**
 * Singleton scheduler instance.
 *
 * Started by engine.ts when the WorkflowEngine starts.
 * The same instance is used by tests (via pollOnce() without start()/stop()).
 */
export const workflowScheduler = new WorkflowScheduler();
