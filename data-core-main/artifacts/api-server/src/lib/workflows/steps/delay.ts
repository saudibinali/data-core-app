/**
 * @file   steps/delay.ts
 * @phase  P6-A - Scheduling Infrastructure & Delayed Workflow Execution Foundations
 *
 * Implements the delay step handler.  Computes the wake-up time from the step
 * configuration and returns a StepResult that signals the executor to pause the
 * execution in status='waiting_delay'.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 * 1. computeWakeAt()  - pure function that resolves the absolute wake-up time
 *    from the two supported delay configs:
 *      • delayForMinutes:      relative offset from now (N minutes)
 *      • delayUntilTimestamp:  absolute ISO 8601 timestamp
 *
 * 2. executeDelayStep() - async step handler called by the executor's dispatch
 *    switch.  Returns { success: true, waitForDelay: true, wakeAt } to signal
 *    the executor to pause and set status='waiting_delay'.
 *
 * ── WHAT THIS FILE DOES NOT DO ───────────────────────────────────────────────
 *
 * This file never writes to the DB.  All DB transitions happen in executor.ts
 * (guarded running→waiting_delay UPDATE) and scheduler.ts (guarded
 * waiting_delay→running acquisition).  The step handler is pure except for the
 * structured log event it emits.
 *
 * ── IMMUTABLE DELAY SEMANTICS ────────────────────────────────────────────────
 *
 * wakeAt is computed exactly once at step execution time and stored in the DB.
 * No runtime timer is registered.  If the process restarts:
 *   • wakeAt remains in DB → scheduler picks it up on the next poll cycle.
 *   • No timer re-registration is needed.
 *   • The computed wakeAt never changes after the initial pause.
 *
 * This is the "persisted wake-up model" described in the P6-A task spec.
 */

import { logger } from "../../logger";
import type { DelayStep, ExecutionContext, StepResult } from "../types";

// ── Governance constants ───────────────────────────────────────────────────────

/**
 * Maximum permitted delay duration.  Validator (WG-04_DELAY_EXCESSIVE_MINUTES)
 * blocks activation of any delay step that exceeds this limit.
 *
 * 30 days (43 200 minutes) is chosen as a reasonable upper bound for an
 * enterprise workflow.  Longer waits indicate a design smell: workflows that
 * span months should be modelled as separate triggered workflows, not single
 * long-running executions.
 */
export const MAX_DELAY_MINUTES = 43_200; // 30 days

// ─────────────────────────────────────────────────────────────────────────────
// Pure helper: computeWakeAt
//
// Resolves the absolute wake-up Date from the step config.
// Exported so tests can verify the computation without running the full handler.
//
// Returns:
//   { wakeAt: Date }              - success; resume at this absolute time.
//   { error: string; code: string } - computation failure; step should fail.
// ─────────────────────────────────────────────────────────────────────────────

export function computeWakeAt(
  config: DelayStep["config"],
  now: Date = new Date(),
): { wakeAt: Date } | { error: string; code: string } {
  const hasMinutes   = config.delayForMinutes    !== undefined;
  const hasTimestamp = config.delayUntilTimestamp !== undefined;

  // ── Relative delay: N minutes from now ─────────────────────────────────────
  if (hasMinutes && !hasTimestamp) {
    const minutes = config.delayForMinutes!;

    if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
      return {
        error: `delayForMinutes must be a finite number. Got: ${JSON.stringify(minutes)}`,
        code:  "DELAY_INVALID_MINUTES",
      };
    }
    if (minutes <= 0) {
      return {
        error: `delayForMinutes must be a positive number. Got: ${minutes}`,
        code:  "DELAY_NON_POSITIVE_MINUTES",
      };
    }
    if (minutes > MAX_DELAY_MINUTES) {
      return {
        error: `delayForMinutes (${minutes}) exceeds the maximum allowed delay of ${MAX_DELAY_MINUTES} minutes (30 days).`,
        code:  "DELAY_EXCESSIVE_MINUTES",
      };
    }

    return { wakeAt: new Date(now.getTime() + minutes * 60_000) };
  }

  // ── Absolute delay: ISO 8601 timestamp ────────────────────────────────────
  if (hasTimestamp && !hasMinutes) {
    const ts = config.delayUntilTimestamp!;

    if (typeof ts !== "string") {
      return {
        error: `delayUntilTimestamp must be an ISO 8601 string. Got: ${JSON.stringify(ts)}`,
        code:  "DELAY_INVALID_TIMESTAMP",
      };
    }

    const dt = new Date(ts);
    if (isNaN(dt.getTime())) {
      return {
        error: `delayUntilTimestamp "${ts}" is not a valid ISO 8601 date-time string.`,
        code:  "DELAY_INVALID_TIMESTAMP",
      };
    }

    return { wakeAt: dt };
  }

  // ── Both specified - ambiguous ─────────────────────────────────────────────
  if (hasMinutes && hasTimestamp) {
    return {
      error: "Delay step has both delayForMinutes and delayUntilTimestamp. Exactly one must be specified.",
      code:  "DELAY_AMBIGUOUS",
    };
  }

  // ── Neither specified ──────────────────────────────────────────────────────
  return {
    error: "Delay step has no delay duration. Must specify delayForMinutes or delayUntilTimestamp.",
    code:  "DELAY_NO_DURATION",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delay step handler
// ─────────────────────────────────────────────────────────────────────────────

export async function executeDelayStep(
  step:             DelayStep,
  ctx:              ExecutionContext,
  executionId:      number,
  workflowVersion?: number | null,
  now:              Date = new Date(),
): Promise<StepResult> {
  const resolved = computeWakeAt(step.config, now);

  if ("error" in resolved) {
    // Configuration error at runtime (should be caught by validator at publish
    // time, but defensively handled here so the execution fails cleanly).
    logger.error(
      {
        executionId,
        workflowVersion,
        workspaceId:    ctx.workspaceId,
        stepIndex:      step.index,
        stepName:       step.name,
        errorCode:      resolved.code,
        error:          resolved.error,
        action:         "execution_delay_config_error",
      },
      "[governance] P6-A: Delay step has invalid configuration - failing execution",
    );
    return { success: false, error: `Delay step configuration error (${resolved.code}): ${resolved.error}` };
  }

  const { wakeAt } = resolved;
  const delayMs      = Math.max(0, wakeAt.getTime() - now.getTime());
  const delayMinutes = Math.round(delayMs / 60_000);
  const mode         = step.config.delayForMinutes !== undefined ? "relative" : "absolute";

  // Structured audit event: execution_delay_started
  // This fires when the step resolves wakeAt and BEFORE the executor writes
  // the waiting_delay transition.  The executor emits its own log after the
  // guarded UPDATE succeeds.
  logger.info(
    {
      executionId,
      workflowVersion:  workflowVersion ?? null,
      workspaceId:      ctx.workspaceId,
      stepIndex:        step.index,
      stepName:         step.name,
      wakeAt:           wakeAt.toISOString(),
      delayMs,
      delayMinutes,
      mode,
      action:           "execution_delay_started",
    },
    "[governance] P6-A: Delay step - wake-at time resolved, execution will pause",
  );

  return {
    success:      true,
    waitForDelay: true,
    wakeAt,
    output: {
      wakeAt:       wakeAt.toISOString(),
      delayMs,
      delayMinutes,
      mode,
    },
  };
}
