/**
 * @file   executor.ts
 * @purpose Workflow step executor - initial execution, approval resume, and
 *          rejection.  Enforces cooperative governance at inter-step boundaries.
 *
 * ── TRANSITION OWNERSHIP MODEL ────────────────────────────────────────────────
 *
 * The executor is the SOLE owner of execution status transitions.
 * Route handlers signal intent (cancel_requested flag, approve/reject calls)
 * but NEVER mutate status directly without going through the guarded functions
 * in this file.
 *
 * All status-changing UPDATEs use WHERE guards + .returning() race detection
 * (P4-D model).  Empty .returning() → another transition won → log + return.
 *
 * ── COMPLETE STATUS TRANSITION TABLE ─────────────────────────────────────────
 *
 *   FROM               TO                   GUARD                       OWNER
 *   ─────────────────  ───────────────────  ──────────────────────────  ──────────
 *   pending            running              status='pending'            executor (initial)
 *   running            waiting_approval     status='running'            executor
 *   running            failed               status NOT terminal         executor
 *   running            timed_out (TTL)      status NOT terminal         executor
 *   running            cancelled            status NOT terminal         executor
 *   running            completed            status='running'            executor
 *   waiting_approval   running (resume)     status='waiting_approval'   resumeExecution (P4-E)
 *                                           AND cancelRequested=false
 *   waiting_approval   failed (rejection)   status='waiting_approval'   rejectExecution (P4-E)
 *   non-terminal       timed_out (force)    status NOT terminal         admin route (P4-B)
 *   (flag)             cancel_requested     !terminal AND !flagged      admin route (P4-C)
 *
 * ── APPROVAL RESUME ARCHITECTURE (P4-E) ──────────────────────────────────────
 *
 * When an executor reaches an approval step, it:
 *   1. Sends approval notifications (executeApprovalStep).
 *   2. Sets status='waiting_approval' and returns from the loop.
 *   3. The currentStepIndex column records the approval step's index (i).
 *
 * When an authorized user approves the execution:
 *   1. Route calls resumeExecution(executionId, resumedBy).
 *   2. resumeExecution() performs guarded UPDATE: waiting_approval → running.
 *   3. Context is reconstructed from DB (execution.context JSONB + step outputs).
 *   4. runStepLoop() re-enters from currentStepIndex + 1 (next step after approval).
 *   5. The approval step itself is NEVER re-run - no duplicate side effects.
 *
 * WHY RE-ENTRY FROM NEXT STEP (NOT CURRENT):
 *   The approval step already completed successfully (notifications sent,
 *   waitForApproval flag set).  Its output is already in workflow_execution_steps.
 *   Re-running it would:
 *     • Re-send approval notifications to approvers (duplicate).
 *     • Re-insert a step log entry for the same stepIndex.
 *     • Potentially confuse the approval audit trail.
 *   Starting from i+1 is safe: the completed step's output is already in
 *   stepOutputs (reconstructed from DB), so subsequent steps can read it.
 *
 * WHY IN-PROCESS (NOT QUEUED):
 *   The resume is a direct function call within the same Node.js process.
 *   No queue, no scheduler, no background worker.  The tradeoff is that if the
 *   process crashes between the guarded UPDATE and the first step of the resume,
 *   the execution will be stuck in 'running' until force-timed-out (P4-E limitation).
 *
 * ── WHY COOPERATIVE (NOT PREEMPTIVE) ─────────────────────────────────────────
 *
 * A preemptive abort (AbortController, Promise.race, worker kill) would cut
 * execution mid-step, orphaning DB writes with no compensation path.  The
 * cooperative model guarantees every step either fully completes or is never started.
 */

import { db } from "@workspace/db";
import {
  workflowDefinitionsTable,
  workflowExecutionsTable,
  workflowExecutionStepsTable,
  workflowApprovalsTable,
} from "@workspace/db";
import { eq, and, not, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { evaluateConditions } from "./conditions";
import { buildResolvedData, createExecutionContext } from "./context";
import { isExecutionTimedOut, computeOverdueMs, TERMINAL_STATUSES } from "./ttl";
import { executeNotificationStep } from "./steps/notification";
import { executeTaskStep } from "./steps/task";
import { executeApprovalStep } from "./steps/approval";
import { executeConditionStep } from "./steps/condition";
import { executeStatusUpdateStep } from "./steps/status-update";
import { executeAssignmentStep } from "./steps/assignment";
import { executeDelayStep } from "./steps/delay";
import type {
  WorkflowStep,
  ExecutionContext,
  StepResult,
} from "./types";

// ── Shared guard expression ───────────────────────────────────────────────────
//
// Drizzle expression: WHERE status NOT IN (terminal statuses).
// Used by all terminal-transition guards to prevent overwriting a terminal state.
const notTerminal = (statusCol: typeof workflowExecutionsTable.status) =>
  not(inArray(statusCol, [...TERMINAL_STATUSES]));

// ─────────────────────────────────────────────────────────────────────────────
// Internal: executeStep dispatcher
// ─────────────────────────────────────────────────────────────────────────────

async function executeStep(
  step:            WorkflowStep,
  ctx:             ExecutionContext,
  executionId:     number,
  workflowVersion?: number | null,
): Promise<StepResult> {
  if (step.conditions) {
    const data = { ...ctx.triggerData, ...ctx.resolvedData };
    const passes = evaluateConditions(step.conditions, data);
    if (!passes) {
      return { success: true, output: { skipped: true, reason: "condition_not_met" } };
    }
  }

  switch (step.type) {
    case "notification":  return executeNotificationStep(step, ctx);
    case "task":          return executeTaskStep(step, ctx, executionId);
    // P5-F: pass executionId + workflowVersion so approval handler can emit
    // the structured approval_requested audit event with full traceability fields.
    case "approval":      return executeApprovalStep(step, ctx, executionId, workflowVersion ?? null);
    case "condition":     return executeConditionStep(step, ctx);
    case "status_update": return executeStatusUpdateStep(step, ctx);
    case "assignment":    return executeAssignmentStep(step, ctx);
    // P6-A: Delay step - computes wakeAt and returns waitForDelay=true.
    // The step handler itself does NOT write to the DB.  The guarded
    // running→waiting_delay transition happens in runStepLoop below.
    case "delay":
      return executeDelayStep(step, ctx, executionId, workflowVersion ?? null);
    default:
      return { success: false, error: `Unknown step type` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: runStepLoop
//
// Core step execution loop, shared by both initial execution (executeWorkflow)
// and approval resume (resumeExecution).  The caller is responsible for the
// status transition that precedes the loop (pending→running or
// waiting_approval→running) and for providing the correct startFromIndex.
//
// startFromIndex:
//   • Initial execution: 0  (all steps from the beginning)
//   • Approval resume:   currentStepIndex + 1  (skip the completed approval step)
//
// ── P5-C: Cursor-based traversal (replaces linear for-loop) ──────────────────
//
// The loop now uses a mutable `cursor` (array position) instead of a fixed
// increment.  After each step:
//
//   Non-condition step, or condition with null routing:
//     cursor++ - identical to the old for-loop behaviour.
//
//   Condition step with routing (nextStepIndex set):
//     resolveNextCursor() validates the target (forward-only, must exist),
//     then sets cursor to the target's array position.
//     If validation fails: guarded fail transition + return (safe halt).
//
// startFromIndex is always an array position (0-based), whether from initial
// execution (0) or approval resume (currentStepIndex + 1).  The cursor model
// preserves full backward compatibility with both callers.
//
// WHY A SHARED LOOP:
//   Both paths share identical inter-step governance (TTL check, cancellation
//   check, all P4-D guarded UPDATEs).  A single loop avoids duplication and
//   ensures governance invariants are always enforced - even on resumed paths.
// ─────────────────────────────────────────────────────────────────────────────

// ── P5-C: Pure routing resolver - exported for unit testing ──────────────────
//
// Resolves the next array cursor position given the result of a completed step.
// This is a PURE function with no side effects - all safety enforcement that
// requires DB writes stays in runStepLoop.
//
// Returns:
//   { nextCursor, routed }  - success; routed=true means a condition jump occurred.
//   { error, code }         - routing violation (backward jump or missing target).
//
// SAFETY CONTRACT:
//   The caller (runStepLoop) must halt the execution on any returned error.
//   This function never modifies state - it only computes the next cursor.
export function resolveNextCursor(
  result:      StepResult,
  currentStep: WorkflowStep,
  steps:       WorkflowStep[],
): { nextCursor: number; routed: boolean } | { error: string; code: "BACKWARD_JUMP" | "SELF_LOOP" | "ROUTE_NOT_FOUND" } {
  // Non-routing step (or condition step with null routing): linear advance.
  if (result.nextStepIndex === undefined) {
    const currentPos = steps.findIndex(s => s.index === currentStep.index);
    return { nextCursor: currentPos + 1, routed: false };
  }

  const targetIdx = result.nextStepIndex;

  // ── Safety rule 1: no self-loops ──────────────────────────────────────────
  if (targetIdx === currentStep.index) {
    return {
      error: `Condition routing self-loop: step ${currentStep.index} routes to itself.`,
      code:  "SELF_LOOP",
    };
  }

  // ── Safety rule 2: forward-only - no backward jumps ───────────────────────
  if (targetIdx < currentStep.index) {
    return {
      error: `Condition routing backward jump: target step index ${targetIdx} is before current step index ${currentStep.index}. Only forward routing is permitted.`,
      code:  "BACKWARD_JUMP",
    };
  }

  // ── Safety rule 3: target step must exist in the workflow ─────────────────
  const targetArrayPos = steps.findIndex(s => s.index === targetIdx);
  if (targetArrayPos === -1) {
    return {
      error: `Condition routing target not found: no step with index ${targetIdx} exists in this workflow (${steps.length} steps, indices: [${steps.map(s => s.index).join(", ")}]).`,
      code:  "ROUTE_NOT_FOUND",
    };
  }

  return { nextCursor: targetArrayPos, routed: true };
}

async function runStepLoop(
  executionId:     number,
  workflowId:      number,
  steps:           WorkflowStep[],
  ctx:             ExecutionContext,
  timeoutAt:       Date | null,
  startFromIndex:  number,
  workflowVersion?: number | null,
): Promise<void> {
  // P5-C: cursor-based traversal; starts at the given array position.
  // For non-condition steps (and condition steps with null routing) cursor++
  // is applied at the end of each iteration - identical to the old for-loop.
  // For condition steps with routing, resolveNextCursor() sets the new position.
  let cursor = startFromIndex;

  while (cursor < steps.length) {
    const step = steps[cursor]!;

    // Insert step log entry
    const [stepLog] = await db
      .insert(workflowExecutionStepsTable)
      .values({
        executionId,
        stepIndex: cursor,
        stepType:  step.type,
        stepName:  step.name,
        status:    "running",
        input: {
          step:    step as unknown as Record<string, unknown>,
          context: ctx  as unknown as Record<string, unknown>,
        },
        startedAt: new Date(),
      })
      .returning({ id: workflowExecutionStepsTable.id });

    let result: StepResult;
    try {
      result = await executeStep(step, ctx, executionId, workflowVersion);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = { success: false, error: msg };
    }

    // Update step log - always safe (append-only, keyed by primary key).
    await db
      .update(workflowExecutionStepsTable)
      .set({
        status:      result.success ? "completed" : "failed",
        output:      (result.output ?? null) as Record<string, unknown> | null,
        error:       result.error ?? null,
        completedAt: new Date(),
      })
      .where(eq(workflowExecutionStepsTable.id, stepLog!.id));

    // Update progress marker - not a terminal transition, no status guard needed.
    // currentStepIndex = cursor (array position) = step.index for well-formed workflows.
    await db
      .update(workflowExecutionsTable)
      .set({ currentStepIndex: cursor })
      .where(eq(workflowExecutionsTable.id, executionId));

    // ── P4-D: Guarded step-failure transition: running → failed ───────────────
    if (!result.success) {
      const [failedExec] = await db
        .update(workflowExecutionsTable)
        .set({ status: "failed", error: result.error ?? "Step failed", completedAt: new Date() })
        .where(and(
          eq(workflowExecutionsTable.id, executionId),
          notTerminal(workflowExecutionsTable.status),
        ))
        .returning({ id: workflowExecutionsTable.id });

      if (!failedExec) {
        logger.warn(
          { executionId, workflowId, workspaceId: ctx.workspaceId,
            attemptedTransition: "running→failed", action: "transition_race_lost",
            stepName: step.name, stepIndex: cursor },
          "[governance] P4-D: step-failure transition lost race (P4-D)",
        );
        return;
      }
      logger.warn(
        { executionId, step: step.name, error: result.error },
        "Workflow step failed - execution halted",
      );
      return;
    }

    // ── P4-D: Guarded approval-pause transition: running → waiting_approval ───
    //
    // WHY GUARDED HERE TOO (P4-E context):
    //   Even during the initial execution path, the waiting_approval transition
    //   must be guarded.  A concurrent force-timeout between step completion and
    //   this UPDATE would otherwise be overwritten.
    if (result.waitForApproval) {
      const [pausedExec] = await db
        .update(workflowExecutionsTable)
        .set({ status: "waiting_approval" })
        .where(and(
          eq(workflowExecutionsTable.id,     executionId),
          eq(workflowExecutionsTable.status, "running"),
        ))
        .returning({ id: workflowExecutionsTable.id });

      if (!pausedExec) {
        logger.warn(
          { executionId, workflowId, workspaceId: ctx.workspaceId,
            attemptedTransition: "running→waiting_approval", action: "transition_race_lost",
            stepName: step.name, stepIndex: cursor },
          "[governance] P4-D: approval-pause transition lost race (P4-D)",
        );
        return;
      }
      logger.info({ executionId, step: step.name }, "Workflow paused - waiting for approval");
      return;
    }

    // ── P6-A: Guarded delay-pause transition: running → waiting_delay ─────────
    //
    // Mirrors the waiting_approval model exactly:
    //   1. executeDelayStep() computed wakeAt and returned waitForDelay=true.
    //   2. Guarded UPDATE: WHERE status='running' → waiting_delay.
    //      If a concurrent force-timeout fires between step completion and this
    //      UPDATE, the WHERE guard prevents overwriting the timed_out status.
    //   3. Store wakeAt, waitingReason='delay', scheduledStepIndex=cursor+1.
    //      scheduledStepIndex is the step to resume FROM - the delay step itself
    //      is NEVER re-run (mirrors the approval resume model from P4-E).
    //   4. Return from loop.  The scheduler picks this up on the next poll cycle
    //      once wakeAt has passed.
    //
    // RESTART SAFETY:
    //   wakeAt + scheduledStepIndex are persisted here.  On server restart the
    //   scheduler reads them from DB - no timer re-registration needed.
    if (result.waitForDelay && result.wakeAt) {
      const resumeFromIndex = cursor + 1;
      const wakeAt          = result.wakeAt;

      const [pausedExec] = await db
        .update(workflowExecutionsTable)
        .set({
          status:             "waiting_delay",
          wakeAt,
          waitingReason:      "delay",
          scheduledStepIndex: resumeFromIndex,
        })
        .where(and(
          eq(workflowExecutionsTable.id,     executionId),
          eq(workflowExecutionsTable.status, "running"),
        ))
        .returning({ id: workflowExecutionsTable.id });

      if (!pausedExec) {
        logger.warn(
          { executionId, workflowId, workspaceId: ctx.workspaceId,
            attemptedTransition: "running→waiting_delay", action: "transition_race_lost",
            stepName: step.name, stepIndex: cursor },
          "[governance] P4-D: delay-pause transition lost race (P4-D)",
        );
        return;
      }

      logger.info(
        { executionId, workflowId, workspaceId: ctx.workspaceId,
          workflowVersion:    workflowVersion ?? null,
          wakeAt:             wakeAt.toISOString(),
          scheduledStepIndex: resumeFromIndex,
          stepName:           step.name,
          stepIndex:          cursor,
          action:             "execution_delay_paused" },
        "[governance] P6-A: Workflow execution paused - waiting for delay wake-up",
      );
      return;
    }

    // ── P4-A: Namespaced step outputs ─────────────────────────────────────────
    ctx.stepOutputs[step.index] = result.output ?? {};
    ctx.resolvedData = buildResolvedData(ctx.stepOutputs);

    // ── P4-B + P4-C + P4-D: Inter-step governance boundary ───────────────────
    //
    // Order: TTL check (P4-B) THEN cancellation check (P4-C).
    // TTL is a hard system deadline; cancellation is user intent.
    // Both use WHERE guards (P4-D) for exact-once safety.
    //
    // NOTE (P5-C): governance checks run BEFORE routing resolution.
    // This ensures TTL and cancellation are enforced even when a condition step
    // is about to jump - we never skip a governance boundary via routing.

    // ── P4-B + P4-D: TTL check → timed_out ────────────────────────────────────
    if (isExecutionTimedOut(timeoutAt)) {
      const now = new Date();
      const [timedOutExec] = await db
        .update(workflowExecutionsTable)
        .set({ status: "timed_out", completedAt: now })
        .where(and(
          eq(workflowExecutionsTable.id, executionId),
          notTerminal(workflowExecutionsTable.status),
        ))
        .returning({ id: workflowExecutionsTable.id });

      if (!timedOutExec) {
        logger.warn(
          { executionId, workflowId, workspaceId: ctx.workspaceId,
            attemptedTransition: "running→timed_out", action: "transition_race_lost",
            timeoutAt, overdueMs: computeOverdueMs(timeoutAt, now), completedStepIndex: cursor },
          "[governance] P4-D: TTL transition lost race (P4-D)",
        );
        return;
      }
      logger.warn(
        { executionId, workflowId, workspaceId: ctx.workspaceId,
          timeoutAt, overdueMs: computeOverdueMs(timeoutAt, now),
          completedStepIndex: cursor, completedStepName: step.name, totalSteps: steps.length },
        "[governance] Workflow execution timed out - TTL exceeded between steps (P4-B)",
      );
      return;
    }

    // ── P4-C + P4-D: Cancellation check → cancelled ───────────────────────────
    //
    // Re-fetch cancel_requested from DB to pick up any flag set externally.
    const [execState] = await db
      .select({ cancelRequested: workflowExecutionsTable.cancelRequested })
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.id, executionId));

    if (execState?.cancelRequested) {
      const now = new Date();
      const [cancelledExec] = await db
        .update(workflowExecutionsTable)
        .set({ status: "cancelled", completedAt: now })
        .where(and(
          eq(workflowExecutionsTable.id, executionId),
          notTerminal(workflowExecutionsTable.status),
        ))
        .returning({ id: workflowExecutionsTable.id });

      if (!cancelledExec) {
        logger.warn(
          { executionId, workflowId, workspaceId: ctx.workspaceId,
            attemptedTransition: "running→cancelled", action: "transition_race_lost",
            completedStepIndex: cursor },
          "[governance] P4-D: cancellation transition lost race (P4-D)",
        );
        return;
      }
      logger.warn(
        { executionId, workflowId, workspaceId: ctx.workspaceId,
          completedStepIndex: cursor, completedStepName: step.name,
          completedSteps: cursor + 1, totalSteps: steps.length, timeoutAt,
          action: "execution_cancelled" },
        "[governance] Workflow execution cancelled - cooperative cancellation (P4-C)",
      );
      return;
    }

    // ── P5-C: Routing resolution ───────────────────────────────────────────────
    //
    // Resolve the next cursor position.  For non-condition steps (and condition
    // steps with no routing configured), this is cursor+1 (linear advance).
    // For condition steps with a valid route, this jumps to the target position.
    //
    // Governance checks (TTL + cancel) already passed above - it is safe to
    // advance the cursor now.
    const routeResult = resolveNextCursor(result, step, steps);

    if ("error" in routeResult) {
      // ── Routing violation: fail the execution safely ───────────────────────
      //
      // This should never happen at runtime for validated workflows - the
      // validator (WG-03) catches invalid routes before activation.
      // If it occurs, it indicates a bug or a legacy snapshot with bad routing.
      logger.error(
        { executionId, workflowId, workspaceId: ctx.workspaceId,
          stepIndex:      step.index,
          stepName:       step.name,
          routeCode:      routeResult.code,
          routeError:     routeResult.error,
          nextStepIndex:  result.nextStepIndex,
          availableRoutes: steps.map(s => s.index),
          action:         "condition_route_invalid" },
        "[governance] P5-C: condition routing violation - failing execution safely",
      );

      const [failedExec] = await db
        .update(workflowExecutionsTable)
        .set({
          status:      "failed",
          error:       `Condition routing error (${routeResult.code}): ${routeResult.error}`,
          completedAt: new Date(),
        })
        .where(and(
          eq(workflowExecutionsTable.id, executionId),
          notTerminal(workflowExecutionsTable.status),
        ))
        .returning({ id: workflowExecutionsTable.id });

      if (!failedExec) {
        logger.warn(
          { executionId, action: "transition_race_lost" },
          "[governance] P4-D: routing-failure transition lost race",
        );
      }
      return;
    }

    if (routeResult.routed) {
      // ── Condition step took a routing jump ────────────────────────────────
      logger.info(
        { executionId, workflowId, workspaceId: ctx.workspaceId,
          stepIndex:        step.index,
          stepName:         step.name,
          matched:          result.output?.["matched"],
          selectedNextStep: result.nextStepIndex,
          availableRoutes:  result.output?.["nextSteps"],
          action:           "condition_route_selected" },
        "[governance] P5-C: condition route selected - jumping to target step",
      );
    } else if (step.type === "condition" && result.nextStepIndex === undefined) {
      // ── Condition step with no routing configured (null branches) ─────────
      // Emit INFO so diagnostics timelines can show the condition result and
      // confirm that linear fallthrough was the intended behaviour.
      logger.info(
        { executionId, workflowId, workspaceId: ctx.workspaceId,
          stepIndex: step.index,
          stepName:  step.name,
          matched:   result.output?.["matched"],
          action:    "condition_route_missing" },
        "[governance] P5-C: condition step has no routing configured - continuing linearly",
      );
    }

    cursor = routeResult.nextCursor;
  }

  // ── P4-D: Guarded completion transition: running → completed ─────────────────
  const [completedExec] = await db
    .update(workflowExecutionsTable)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(
      eq(workflowExecutionsTable.id,     executionId),
      eq(workflowExecutionsTable.status, "running"),
    ))
    .returning({ id: workflowExecutionsTable.id });

  if (!completedExec) {
    logger.warn(
      { executionId, workflowId, workspaceId: ctx.workspaceId,
        attemptedTransition: "running→completed", action: "transition_race_lost" },
      "[governance] P4-D: completion transition lost race (P4-D)",
    );
    return;
  }
  logger.info({ executionId, workflowId }, "Workflow execution completed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: executeWorkflow (initial execution)
//
// Called by engine.ts when a workflow is first triggered.  Transitions the
// execution from pending → running, then runs all steps from index 0.
// ─────────────────────────────────────────────────────────────────────────────

export async function executeWorkflow(
  executionId:      number,
  workflowId:       number,
  steps:            WorkflowStep[],
  ctx:              ExecutionContext,
  timeoutAt:        Date | null = null,
  workflowVersion?: number | null,
): Promise<void> {

  // ── P4-D: Guarded opening transition: pending → running ────────────────────
  const [openedExec] = await db
    .update(workflowExecutionsTable)
    .set({ status: "running" })
    .where(and(
      eq(workflowExecutionsTable.id,     executionId),
      eq(workflowExecutionsTable.status, "pending"),
    ))
    .returning({ id: workflowExecutionsTable.id });

  if (!openedExec) {
    logger.warn(
      { executionId, workflowId, workspaceId: ctx.workspaceId,
        attemptedTransition: "pending→running", action: "transition_race_lost" },
      "[governance] P4-D: opening transition lost race (P4-D)",
    );
    return;
  }

  await runStepLoop(executionId, workflowId, steps, ctx, timeoutAt, 0, workflowVersion ?? null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: resumeExecution (P4-E - approval re-entry)
//
// Called when an authorized user approves a paused execution.  Performs the
// guarded waiting_approval → running transition, reconstructs the execution
// context from DB, records the approval decision, and re-enters the step loop
// from the step AFTER the approval step.
//
// IDEMPOTENCY & RACE SAFETY:
//   The guarded UPDATE is the atomicity gate.  If two concurrent approvers call
//   this function simultaneously, exactly one will win the WHERE guard.  The
//   other will receive .returning() = [] and get TRANSITION_RACE_LOST.
//   No duplicate step execution, no duplicate approval records.
//
// CANCEL SAFETY:
//   WHERE cancelRequested=false prevents resume if cancel was requested while
//   the execution was waiting.  The caller should observe the cancellation and
//   not attempt to approve a cancelled execution.
//
// RETURN VALUE:
//   { success: true }               - resume started (loop running in background)
//   { success: false, code: ... }   - pre-condition failed or race lost
// ─────────────────────────────────────────────────────────────────────────────

export async function resumeExecution(
  executionId: number,
  resumedBy:   number,
  notes?:      string,
): Promise<{ success: boolean; code?: string; approvalStepIndex?: number }> {

  // ── Fetch execution state ──────────────────────────────────────────────────
  //
  // P5-A: Include stepsSnapshot and workflowVersion in the SELECT.
  //   stepsSnapshot - the immutable copy of steps stored at trigger time.
  //   workflowVersion - the definition version at trigger time (NULL until P7-A).
  //
  // These fields are the source of truth for the step configuration used during
  // resume.  If stepsSnapshot is present, the live workflow_definitions.steps
  // column is NOT consulted - completely eliminating definition drift risk.
  const [execution] = await db
    .select({
      id:               workflowExecutionsTable.id,
      workspaceId:      workflowExecutionsTable.workspaceId,
      workflowId:       workflowExecutionsTable.workflowId,
      status:           workflowExecutionsTable.status,
      currentStepIndex: workflowExecutionsTable.currentStepIndex,
      cancelRequested:  workflowExecutionsTable.cancelRequested,
      timeoutAt:        workflowExecutionsTable.timeoutAt,
      context:          workflowExecutionsTable.context,
      triggeredBy:      workflowExecutionsTable.triggeredBy,
      // P5-A: snapshot fields
      stepsSnapshot:    workflowExecutionsTable.stepsSnapshot,
      workflowVersion:  workflowExecutionsTable.workflowVersion,
    })
    .from(workflowExecutionsTable)
    .where(eq(workflowExecutionsTable.id, executionId));

  if (!execution) {
    return { success: false, code: "EXECUTION_NOT_FOUND" };
  }

  // ── Pre-condition: must be paused at approval ──────────────────────────────
  if (execution.status !== "waiting_approval") {
    return { success: false, code: execution.status === "cancelled" || TERMINAL_STATUSES.includes(execution.status as typeof TERMINAL_STATUSES[number])
      ? "EXECUTION_ALREADY_TERMINAL"
      : "EXECUTION_NOT_WAITING_APPROVAL",
    };
  }

  // ── Pre-condition: cancellation must not have been requested ───────────────
  //
  // If cancel was requested while waiting for approval, the execution is in a
  // limbo state: status='waiting_approval' but cancelRequested=true.
  // We refuse to resume it - the admin should let it time out or force-timeout.
  if (execution.cancelRequested) {
    return { success: false, code: "EXECUTION_CANCEL_REQUESTED" };
  }

  // ── P5-F: TTL expiry pre-check ─────────────────────────────────────────────
  //
  // If execution.timeoutAt has already passed, refuse the approval.  The TTL
  // background sweeper may not have fired yet (lazy cooperative TTL model from
  // P4-B) but the approval window is closed.
  //
  // This prevents a decider from approving an overdue execution and observing
  // the resume loop immediately time it out at the first inter-step boundary.
  // Failing early here is safer and produces a cleaner audit trail.
  if (isExecutionTimedOut(execution.timeoutAt)) {
    logger.warn(
      {
        executionId,
        workflowId:  execution.workflowId,
        workspaceId: execution.workspaceId,
        workflowVersion: execution.workflowVersion ?? null,
        resumedBy,
        timeoutAt: execution.timeoutAt,
        action:    "approval_resume_blocked_ttl_expired",
      },
      "[governance] P5-F: Approval resume rejected - execution TTL has expired",
    );
    return { success: false, code: "EXECUTION_TTL_EXPIRED" };
  }

  // ── P5-A: Resolve steps - snapshot first, live definition as legacy fallback
  //
  // SOURCE OF TRUTH SELECTION LOGIC:
  //
  //   A) stepsSnapshot IS NOT NULL (executions created after P5-A deployment):
  //      Use the frozen snapshot stored at trigger time.
  //      DO NOT fetch workflow_definitions.steps.
  //      This is the only path that guarantees definition-drift safety.
  //      Emit: action='execution_resume_using_snapshot'
  //
  //   B) stepsSnapshot IS NULL (executions created before P5-A deployment):
  //      Legacy fallback - fetch live workflow_definitions.steps.
  //      RISK: If the definition was edited since the execution was triggered,
  //      the resumed execution may run different steps than originally configured.
  //      Emit: action='legacy_resume_live_definition' (WARN - visible in prod logs)
  //
  // This dual-path model ensures backward compatibility while eliminating the
  // drift risk for all new executions.

  let steps: WorkflowStep[];

  if (execution.stepsSnapshot != null) {
    // ── Path A: Snapshot present - use frozen copy ─────────────────────────
    //
    // The snapshot was stored by engine.ts at trigger time using structuredClone().
    // It is a JSONB column containing the exact WorkflowStep[] that was active
    // when this execution was created.  No DB round-trip to workflow_definitions.
    steps = (execution.stepsSnapshot as unknown as WorkflowStep[]);

    logger.info(
      {
        executionId,
        workflowId:      execution.workflowId,
        workspaceId:     execution.workspaceId,
        workflowVersion: execution.workflowVersion,
        snapshotPresent: true,
        stepCount:       steps.length,
        resumedBy,
        action:          "execution_resume_using_snapshot",
      },
      "[governance] P5-A: Approval resume using immutable steps snapshot - definition drift impossible",
    );
  } else {
    // ── Path B: Legacy fallback - fetch live definition ────────────────────
    //
    // This path applies to executions created before P5-A was deployed.
    // These executions have stepsSnapshot=NULL and must fall back to the live
    // workflow_definitions.steps column.
    //
    // RISK WARNING: If the workflow definition was edited between the initial
    // trigger and this resume, the resumed execution will run from a potentially
    // different step configuration.  This is the definition drift scenario
    // that P5-A was designed to eliminate for new executions.
    //
    // ACTION FOR OPERATORS:
    //   If you see this log in production for a high-stakes execution (e.g.,
    //   an HR approval workflow), verify that the workflow definition has NOT
    //   been edited since the execution was triggered before approving.
    logger.warn(
      {
        executionId,
        workflowId:      execution.workflowId,
        workspaceId:     execution.workspaceId,
        workflowVersion: null,
        snapshotPresent: false,
        resumedBy,
        action:          "legacy_resume_live_definition",
      },
      "[governance] P5-A: Legacy approval resume - snapshot absent, using live definition (definition drift possible)",
    );

    const [workflowDef] = await db
      .select({
        id:    workflowDefinitionsTable.id,
        steps: workflowDefinitionsTable.steps,
      })
      .from(workflowDefinitionsTable)
      .where(eq(workflowDefinitionsTable.id, execution.workflowId));

    if (!workflowDef) {
      return { success: false, code: "WORKFLOW_NOT_FOUND" };
    }

    steps = (workflowDef.steps as unknown as WorkflowStep[]) ?? [];
  }

  const approvalStepIndex = execution.currentStepIndex;
  const resumeFromIndex   = approvalStepIndex + 1;

  // ── Reconstruct ExecutionContext from DB ───────────────────────────────────
  //
  // The in-memory context that existed during the initial run is gone - the
  // executor returned after the approval step.  We must rebuild it from:
  //   1. execution.context JSONB → triggerEvent, triggerData
  //   2. workflow_execution_steps completed rows → stepOutputs
  //
  // WHY RECONSTRUCT FROM STEP OUTPUTS:
  //   The approval step's output (approverIds, status: "pending_approval") was
  //   already stored in the step log by the first run.  We restore it into
  //   stepOutputs so subsequent steps can read ctx.resolvedData correctly.
  const storedCtx = execution.context as {
    triggerEvent?:    string;
    triggerData?:     Record<string, unknown>;
    _executionChain?: string[];
  };

  const completedStepRows = await db
    .select({
      stepIndex: workflowExecutionStepsTable.stepIndex,
      output:    workflowExecutionStepsTable.output,
    })
    .from(workflowExecutionStepsTable)
    .where(and(
      eq(workflowExecutionStepsTable.executionId, executionId),
      eq(workflowExecutionStepsTable.status, "completed"),
    ));

  const stepOutputs: Record<number, Record<string, unknown>> = {};
  for (const row of completedStepRows) {
    stepOutputs[row.stepIndex] = (row.output ?? {}) as Record<string, unknown>;
  }

  // Use createExecutionContext to ensure deep-clone safety on triggerData.
  const ctx = createExecutionContext(
    storedCtx.triggerEvent  ?? "unknown",
    storedCtx.triggerData   ?? {},
    execution.workspaceId,
    execution.triggeredBy   ?? undefined,
  );
  ctx.stepOutputs  = stepOutputs;
  ctx.resolvedData = buildResolvedData(stepOutputs);

  // ── P4-D + P4-E: Guarded resume transition: waiting_approval → running ─────
  //
  // WHERE status='waiting_approval' AND cancelRequested=false ensures:
  //   a) No concurrent resume can win twice (only one UPDATE wins the guard).
  //   b) Cancellation requested while waiting prevents resume.
  //   c) Force-timeout (which sets status='timed_out') prevents resume.
  //
  // This is the atomicity gate - everything before this is a pre-check.
  const [resumedExec] = await db
    .update(workflowExecutionsTable)
    .set({ status: "running" })
    .where(and(
      eq(workflowExecutionsTable.id,              executionId),
      eq(workflowExecutionsTable.status,          "waiting_approval"),
      eq(workflowExecutionsTable.cancelRequested, false),
    ))
    .returning({ id: workflowExecutionsTable.id });

  if (!resumedExec) {
    // Race: force-timeout, cancel, or duplicate approve fired simultaneously.
    logger.warn(
      { executionId, workflowId: execution.workflowId, workspaceId: execution.workspaceId,
        resumedBy, approvalStepIndex,
        attemptedTransition: "waiting_approval→running",
        action: "approval_resume_race_lost" },
      "[governance] P4-E: approval resume transition lost race (P4-E)",
    );
    return { success: false, code: "TRANSITION_RACE_LOST" };
  }

  // ── P5-F: Record approval decision with version linkage ───────────────────
  //
  // Inserted AFTER the guarded UPDATE succeeds so we never create an orphaned
  // approval record for a transition that didn't actually go through.
  //
  // Fields added in P5-F:
  //   workflowId          - direct reference without execution join
  //   workflowVersion     - version active at trigger time (for full audit chain)
  //   stepSnapshot        - frozen step config that governed this approval
  //   executionTimeoutAt  - TTL deadline at decision time (for overdue detection)
  const approvalStep = steps[approvalStepIndex];
  const [approvalRecord] = await db.insert(workflowApprovalsTable).values({
    executionId,
    workspaceId:        execution.workspaceId,
    workflowId:         execution.workflowId,
    workflowVersion:    execution.workflowVersion ?? null,
    stepIndex:          approvalStepIndex,
    stepName:           approvalStep?.name ?? `Step ${approvalStepIndex}`,
    stepSnapshot:       (approvalStep ?? null) as unknown as Record<string, unknown> | null,
    action:             "approved",
    decidedBy:          resumedBy,
    notes:              notes ?? null,
    executionTimeoutAt: execution.timeoutAt ?? null,
  }).returning({ id: workflowApprovalsTable.id });

  logger.info(
    {
      executionId,
      workflowId:      execution.workflowId,
      workspaceId:     execution.workspaceId,
      workflowVersion: execution.workflowVersion ?? null,
      approvalId:      approvalRecord?.id ?? null,
      decidedBy:       resumedBy,
      approvalStepIndex,
      resumeFromIndex,
      previousStatus:  "waiting_approval",
      action:          "approval_decision_recorded",
    },
    "[governance] P5-F: Approval decision recorded - approved; resuming execution",
  );

  // ── Re-enter the step loop from the step AFTER the approval step ───────────
  //
  // WHY NOT RE-RUN THE APPROVAL STEP:
  //   The approval step already completed (notifications sent, output recorded).
  //   Re-running it would: re-send notifications, create duplicate step log rows,
  //   and potentially re-pause the execution (waitForApproval=true again).
  //
  // The step loop is started in the background (void).  The caller receives
  // { success: true } immediately and can poll GET /executions/:id for status.
  // This matches the same pattern used by engine.ts for initial execution.
  void runStepLoop(
    executionId,
    execution.workflowId,
    steps,
    ctx,
    execution.timeoutAt,
    resumeFromIndex,
    execution.workflowVersion ?? null,
  ).then(() => {
    logger.info(
      { executionId, workflowId: execution.workflowId, approvalStepIndex,
        action: "approval_resume_completed" },
      "[governance] Workflow execution resume loop finished (P4-E)",
    );
  }).catch((err: unknown) => {
    logger.error(
      { err, executionId, workflowId: execution.workflowId },
      "Unhandled error in approval resume loop (P4-E)",
    );
  });

  return { success: true, approvalStepIndex };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: resumeDelayedExecution (P6-A - scheduler wake-up)
//
// Called by the WorkflowScheduler when wake_at has passed for a
// waiting_delay execution.  Performs the guarded waiting_delay → running
// transition, reconstructs the execution context from DB, and re-enters
// the step loop from the step AFTER the delay step.
//
// IDEMPOTENCY & RACE SAFETY:
//   The guarded UPDATE (WHERE status='waiting_delay') is the atomicity gate.
//   If two concurrent scheduler instances call this simultaneously, exactly
//   one wins.  The loser gets .returning() = [] → TRANSITION_RACE_LOST.
//   No duplicate step execution, no duplicate resume records.
//
// GOVERNANCE ORDER (mirrors resumeExecution P5-F):
//   1. Fetch execution - confirms it exists.
//   2. Pre-checks: terminal, wrong status, cancelRequested, TTL expired,
//      wakeAt not yet reached (scheduler guard, not a precondition failure).
//   3. Snapshot-first step resolution (P5-A model).
//   4. Guarded acquisition: waiting_delay → running.
//   5. Reconstruct ExecutionContext from persisted JSONB + completed step rows.
//   6. Re-enter runStepLoop from scheduledStepIndex.
//
// RETURN VALUE (string code for lightweight switch in scheduler):
//   "ok"                  - resume started (loop running in background)
//   "not_waiting_delay"   - status is not waiting_delay (already moved on)
//   "already_terminal"    - terminal status - nothing to do
//   "cancel_requested"    - cancelRequested=true; transitioned to cancelled
//   "ttl_expired"         - TTL passed; transitioned to timed_out
//   "wake_at_not_reached" - wakeAt is still in the future (scheduler guard)
//   "transition_race_lost"- guarded UPDATE found no row (concurrent acquire won)
// ─────────────────────────────────────────────────────────────────────────────

export async function resumeDelayedExecution(
  executionId: number,
  now:         Date = new Date(),
): Promise<
  | "ok"
  | "not_waiting_delay"
  | "already_terminal"
  | "cancel_requested"
  | "ttl_expired"
  | "wake_at_not_reached"
  | "transition_race_lost"
> {

  // ── Fetch execution state ──────────────────────────────────────────────────
  const [execution] = await db
    .select({
      id:                 workflowExecutionsTable.id,
      workspaceId:        workflowExecutionsTable.workspaceId,
      workflowId:         workflowExecutionsTable.workflowId,
      status:             workflowExecutionsTable.status,
      cancelRequested:    workflowExecutionsTable.cancelRequested,
      timeoutAt:          workflowExecutionsTable.timeoutAt,
      wakeAt:             workflowExecutionsTable.wakeAt,
      scheduledStepIndex: workflowExecutionsTable.scheduledStepIndex,
      workflowVersion:    workflowExecutionsTable.workflowVersion,
      context:            workflowExecutionsTable.context,
      stepsSnapshot:      workflowExecutionsTable.stepsSnapshot,
      triggeredBy:        workflowExecutionsTable.triggeredBy,
    })
    .from(workflowExecutionsTable)
    .where(eq(workflowExecutionsTable.id, executionId));

  if (!execution) {
    return "not_waiting_delay";
  }

  // ── Pre-condition: terminal state ─────────────────────────────────────────
  if (TERMINAL_STATUSES.includes(execution.status as typeof TERMINAL_STATUSES[number])) {
    return "already_terminal";
  }

  // ── Pre-condition: must be waiting for delay ───────────────────────────────
  if (execution.status !== "waiting_delay") {
    return "not_waiting_delay";
  }

  // ── Pre-condition: cancel requested ───────────────────────────────────────
  //
  // If cancel was requested while waiting for the delay, perform the
  // waiting_delay → cancelled transition here and return CANCEL_REQUESTED.
  // The guarded UPDATE prevents a concurrent force-timeout from racing.
  if (execution.cancelRequested) {
    const [cancelledExec] = await db
      .update(workflowExecutionsTable)
      .set({ status: "cancelled", completedAt: now })
      .where(and(
        eq(workflowExecutionsTable.id,     executionId),
        eq(workflowExecutionsTable.status, "waiting_delay"),
      ))
      .returning({ id: workflowExecutionsTable.id });

    if (cancelledExec) {
      logger.warn(
        { executionId, workflowId: execution.workflowId,
          workspaceId: execution.workspaceId, wakeAt: execution.wakeAt,
          action: "execution_delay_cancelled" },
        "[governance] P6-A: Delayed execution cancelled - cancelRequested=true at wake-up",
      );
    }
    return "cancel_requested";
  }

  // ── Pre-condition: TTL expiry ──────────────────────────────────────────────
  //
  // Lazy cooperative TTL model (P4-B): if timeoutAt has passed while the
  // execution was waiting for its delay, transition to timed_out here rather
  // than resuming.  This is the same model used at every inter-step boundary.
  if (isExecutionTimedOut(execution.timeoutAt, now)) {
    const [timedOutExec] = await db
      .update(workflowExecutionsTable)
      .set({ status: "timed_out", completedAt: now })
      .where(and(
        eq(workflowExecutionsTable.id,     executionId),
        eq(workflowExecutionsTable.status, "waiting_delay"),
      ))
      .returning({ id: workflowExecutionsTable.id });

    if (timedOutExec) {
      logger.warn(
        { executionId, workflowId: execution.workflowId,
          workspaceId: execution.workspaceId,
          workflowVersion: execution.workflowVersion ?? null,
          timeoutAt: execution.timeoutAt, wakeAt: execution.wakeAt,
          overdueMs: computeOverdueMs(execution.timeoutAt, now),
          action: "execution_delay_ttl_expired" },
        "[governance] P6-A: Delayed execution expired TTL before scheduler wake-up",
      );
    }
    return "ttl_expired";
  }

  // ── Pre-condition: wakeAt must have passed ────────────────────────────────
  //
  // Guard: if somehow the scheduler calls this too early (race between DB
  // read and this call), bail rather than resuming prematurely.
  if (execution.wakeAt && now < execution.wakeAt) {
    return "wake_at_not_reached";
  }

  // ── P5-A: Resolve steps - snapshot first, live definition as legacy fallback
  let steps: WorkflowStep[];

  if (execution.stepsSnapshot != null) {
    steps = (execution.stepsSnapshot as unknown as WorkflowStep[]);

    logger.info(
      { executionId, workflowId: execution.workflowId,
        workspaceId: execution.workspaceId, workflowVersion: execution.workflowVersion,
        snapshotPresent: true, stepCount: steps.length,
        action: "execution_delay_resume_using_snapshot" },
      "[governance] P6-A: Delay resume using immutable steps snapshot - definition drift impossible",
    );
  } else {
    logger.warn(
      { executionId, workflowId: execution.workflowId,
        workspaceId: execution.workspaceId, workflowVersion: null,
        snapshotPresent: false, action: "legacy_delay_resume_live_definition" },
      "[governance] P6-A: Legacy delay resume - snapshot absent, using live definition (definition drift possible)",
    );

    const [workflowDef] = await db
      .select({ steps: workflowDefinitionsTable.steps })
      .from(workflowDefinitionsTable)
      .where(eq(workflowDefinitionsTable.id, execution.workflowId));

    if (!workflowDef) {
      return "not_waiting_delay";
    }
    steps = (workflowDef.steps as unknown as WorkflowStep[]) ?? [];
  }

  const resumeFromIndex = execution.scheduledStepIndex ?? 0;

  // ── Reconstruct ExecutionContext from DB ───────────────────────────────────
  //
  // Mirrors the resumeExecution context reconstruction (P4-E):
  //   1. execution.context JSONB → triggerEvent, triggerData
  //   2. Completed step rows → stepOutputs (restores resolved data)
  const storedCtx = execution.context as {
    triggerEvent?:    string;
    triggerData?:     Record<string, unknown>;
    _executionChain?: string[];
  };

  const completedStepRows = await db
    .select({
      stepIndex: workflowExecutionStepsTable.stepIndex,
      output:    workflowExecutionStepsTable.output,
    })
    .from(workflowExecutionStepsTable)
    .where(and(
      eq(workflowExecutionStepsTable.executionId, executionId),
      eq(workflowExecutionStepsTable.status,      "completed"),
    ));

  const stepOutputs: Record<number, Record<string, unknown>> = {};
  for (const row of completedStepRows) {
    stepOutputs[row.stepIndex] = (row.output ?? {}) as Record<string, unknown>;
  }

  const ctx = createExecutionContext(
    storedCtx.triggerEvent ?? "unknown",
    storedCtx.triggerData  ?? {},
    execution.workspaceId,
    execution.triggeredBy  ?? undefined,
  );
  ctx.stepOutputs  = stepOutputs;
  ctx.resolvedData = buildResolvedData(stepOutputs);

  // ── P6-A: Guarded acquisition: waiting_delay → running ────────────────────
  //
  // WHERE status='waiting_delay' is the atomicity gate.
  // - If two concurrent schedulers both SELECT this execution and both call
  //   resumeDelayedExecution(), exactly one will win here.
  // - The loser's .returning() is empty → TRANSITION_RACE_LOST → skip.
  // Sets resumedAt so auditors can see when the scheduler acquired it.
  const [acquired] = await db
    .update(workflowExecutionsTable)
    .set({ status: "running", resumedAt: now })
    .where(and(
      eq(workflowExecutionsTable.id,     executionId),
      eq(workflowExecutionsTable.status, "waiting_delay"),
    ))
    .returning({ id: workflowExecutionsTable.id });

  if (!acquired) {
    logger.warn(
      { executionId, workflowId: execution.workflowId,
        workspaceId: execution.workspaceId,
        attemptedTransition: "waiting_delay→running",
        action: "transition_race_lost" },
      "[governance] P6-A: delay-resume transition lost race (P4-D)",
    );
    return "transition_race_lost";
  }

  logger.info(
    { executionId, workflowId: execution.workflowId,
      workspaceId: execution.workspaceId,
      workflowVersion: execution.workflowVersion ?? null,
      resumeFromIndex, wakeAt: execution.wakeAt?.toISOString() ?? null,
      now: now.toISOString(), action: "execution_delay_resumed" },
    "[governance] P6-A: Delayed execution resumed - scheduler wake-up acquired",
  );

  // ── Re-enter the step loop from the step AFTER the delay step ─────────────
  //
  // WHY NOT RE-RUN THE DELAY STEP:
  //   The delay step already completed (wakeAt stored, step log written).
  //   Re-running it would re-pause the execution and create a new wakeAt.
  //
  // The step loop is started in the background (void).  The scheduler returns
  // "ok" immediately and continues to the next candidate.
  void runStepLoop(
    executionId,
    execution.workflowId,
    steps,
    ctx,
    execution.timeoutAt,
    resumeFromIndex,
    execution.workflowVersion ?? null,
  ).catch((err: unknown) => {
    logger.error(
      { err, executionId, workflowId: execution.workflowId },
      "Unhandled error in delay-resume step loop (P6-A)",
    );
  });

  return "ok";
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: rejectExecution (P4-E - approval rejection)
//
// Called when an authorized user rejects a paused execution.  Performs the
// guarded waiting_approval → failed transition and records the rejection.
//
// WHY 'failed' (NOT A NEW 'rejected' STATUS):
//   'rejected' would require a new terminal status, schema migration, and
//   updates to all downstream checks (TERMINAL_STATUSES, diagnostics, etc.).
//   'failed' already covers "could not complete" semantics and is already
//   terminal.  The rejection decision record in workflow_approvals provides
//   full traceability of why it failed.
// ─────────────────────────────────────────────────────────────────────────────

export async function rejectExecution(
  executionId: number,
  rejectedBy:  number,
  notes?:      string,
): Promise<{ success: boolean; code?: string; approvalStepIndex?: number }> {

  // ── Fetch execution state ──────────────────────────────────────────────────
  //
  // P5-F: Also fetch workflowVersion, timeoutAt, cancelRequested, and
  // stepsSnapshot so the rejection path has full version linkage and can
  // perform TTL / cancel-requested pre-checks before the guarded UPDATE.
  const [execution] = await db
    .select({
      id:               workflowExecutionsTable.id,
      workspaceId:      workflowExecutionsTable.workspaceId,
      workflowId:       workflowExecutionsTable.workflowId,
      status:           workflowExecutionsTable.status,
      currentStepIndex: workflowExecutionsTable.currentStepIndex,
      cancelRequested:  workflowExecutionsTable.cancelRequested,
      timeoutAt:        workflowExecutionsTable.timeoutAt,
      workflowVersion:  workflowExecutionsTable.workflowVersion,
      stepsSnapshot:    workflowExecutionsTable.stepsSnapshot,
    })
    .from(workflowExecutionsTable)
    .where(eq(workflowExecutionsTable.id, executionId));

  if (!execution) {
    return { success: false, code: "EXECUTION_NOT_FOUND" };
  }

  if (execution.status !== "waiting_approval") {
    return {
      success: false,
      code: TERMINAL_STATUSES.includes(execution.status as typeof TERMINAL_STATUSES[number])
        ? "EXECUTION_ALREADY_TERMINAL"
        : "EXECUTION_NOT_WAITING_APPROVAL",
    };
  }

  // ── P5-F: Pre-condition - cancellation check ───────────────────────────────
  //
  // Mirrors the cancelRequested check in resumeExecution.  If cancel was
  // requested while waiting for approval, refuse the rejection as well - the
  // admin should let the cancellation proceed rather than recording a reject.
  if (execution.cancelRequested) {
    return { success: false, code: "EXECUTION_CANCEL_REQUESTED" };
  }

  // ── P5-F: TTL expiry pre-check ─────────────────────────────────────────────
  //
  // If the execution deadline has already passed, refuse the rejection.
  // The TTL sweeper will mark it timed_out at the next opportunity.
  // Failing early here avoids creating a spurious "rejected" record for an
  // execution that will be transitioned to timed_out anyway.
  if (isExecutionTimedOut(execution.timeoutAt)) {
    logger.warn(
      {
        executionId,
        workflowId:  execution.workflowId,
        workspaceId: execution.workspaceId,
        workflowVersion: execution.workflowVersion ?? null,
        rejectedBy,
        timeoutAt: execution.timeoutAt,
        action:    "approval_rejection_blocked_ttl_expired",
      },
      "[governance] P5-F: Approval rejection refused - execution TTL has expired",
    );
    return { success: false, code: "EXECUTION_TTL_EXPIRED" };
  }

  const approvalStepIndex = execution.currentStepIndex;

  // ── P4-D + P4-E: Guarded rejection transition: waiting_approval → failed ───
  //
  // WHERE status='waiting_approval' prevents rejecting an execution that was
  // force-timed-out between the pre-fetch and this UPDATE.
  const rejectionReason = notes
    ? `Approval rejected: ${notes}`
    : "Approval rejected by approver";

  const [rejectedExec] = await db
    .update(workflowExecutionsTable)
    .set({
      status:      "failed",
      error:       rejectionReason,
      completedAt: new Date(),
    })
    .where(and(
      eq(workflowExecutionsTable.id,     executionId),
      eq(workflowExecutionsTable.status, "waiting_approval"),
    ))
    .returning({ id: workflowExecutionsTable.id });

  if (!rejectedExec) {
    logger.warn(
      {
        executionId,
        workflowId:  execution.workflowId,
        workspaceId: execution.workspaceId,
        workflowVersion: execution.workflowVersion ?? null,
        rejectedBy,
        approvalStepIndex,
        attemptedTransition: "waiting_approval→failed",
        action: "transition_race_lost",
      },
      "[governance] P4-E: rejection transition lost race (P4-E)",
    );
    return { success: false, code: "TRANSITION_RACE_LOST" };
  }

  // ── Fetch step name + snapshot for the approval record ────────────────────
  //
  // P5-F: If stepsSnapshot is present, extract the step config directly
  // instead of querying step logs (avoids an extra round-trip on the happy path).
  const snapshot = execution.stepsSnapshot as unknown as WorkflowStep[] | null;
  const snapshotStep = snapshot?.find(s => s.index === approvalStepIndex) ?? null;

  const [stepRow] = await db
    .select({ stepName: workflowExecutionStepsTable.stepName })
    .from(workflowExecutionStepsTable)
    .where(and(
      eq(workflowExecutionStepsTable.executionId, executionId),
      eq(workflowExecutionStepsTable.stepIndex,   approvalStepIndex),
    ));

  // ── P5-F: Record rejection decision with version linkage ──────────────────
  //
  // Fields added in P5-F: workflowId, workflowVersion, stepSnapshot, executionTimeoutAt.
  const [approvalRecord] = await db.insert(workflowApprovalsTable).values({
    executionId,
    workspaceId:        execution.workspaceId,
    workflowId:         execution.workflowId,
    workflowVersion:    execution.workflowVersion ?? null,
    stepIndex:          approvalStepIndex,
    stepName:           snapshotStep?.name ?? stepRow?.stepName ?? `Step ${approvalStepIndex}`,
    stepSnapshot:       (snapshotStep ?? null) as unknown as Record<string, unknown> | null,
    action:             "rejected",
    decidedBy:          rejectedBy,
    notes:              notes ?? null,
    executionTimeoutAt: execution.timeoutAt ?? null,
  }).returning({ id: workflowApprovalsTable.id });

  logger.warn(
    {
      executionId,
      workflowId:      execution.workflowId,
      workspaceId:     execution.workspaceId,
      workflowVersion: execution.workflowVersion ?? null,
      approvalId:      approvalRecord?.id ?? null,
      decidedBy:       rejectedBy,
      approvalStepIndex,
      notes,
      previousStatus:  "waiting_approval",
      action:          "approval_decision_rejected",
    },
    "[governance] P5-F: Approval decision recorded - rejected; execution failed",
  );

  return { success: true, approvalStepIndex };
}
