/**
 * @file   simulation.ts
 * @phase  P6-B - Simulation Engine & Workflow Preview Foundations
 *
 * Pure deterministic traversal engine.  Produces a complete prediction of
 * workflow execution shape - routing, branching, approval points, delay
 * timelines, skipped steps - WITHOUT any DB writes, notifications, scheduler
 * interaction, or production state mutation.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   simulate(steps, context) → SimulationResult
 *
 *   1. Runs validateWorkflow() to collect per-step errors + engine warnings.
 *   2. Builds a successor graph and identifies all structurally reachable steps
 *      via BFS from position 0.
 *   3. Traverses steps using the same forward cursor model as executor.ts
 *      runStepLoop - but with zero DB writes:
 *        • condition → evaluateConditions() against simulated trigger data
 *        • approval  → simulatedApprovalDecisions map (default "approve")
 *        • delay     → computeWakeAt() for wakeAt + duration estimate
 *        • others    → mark "executed", advance cursor
 *   4. After traversal, classifies all non-visited reachable steps as "skipped"
 *      and all structurally unreachable steps as "unreachable".
 *   5. Estimates total wall-clock duration (delay wait + approval wait + overhead).
 *   6. Attaches per-step governance warning codes to each SimulatedStepRecord.
 *   7. Emits four structured observability events (no DB required).
 *
 * ── WHAT THIS FILE DOES NOT DO ───────────────────────────────────────────────
 *
 *   • NEVER imports or calls: db, any step handler (notification/task/approval/
 *     assignment/status-update), scheduler.ts, or any executor.ts write path.
 *   • NEVER creates DB records, approval rows, activity logs, or notifications.
 *   • NEVER registers timers or interacts with the scheduling infrastructure.
 *   • The safety guarantee is STRUCTURAL - enforced by the import graph, not
 *     by runtime checks.
 *
 * ── DETERMINISM GUARANTEE ────────────────────────────────────────────────────
 *
 *   Given identical (steps, context) inputs, simulate() always returns
 *   structurally identical results.  Variability sources are:
 *     • simulatedNow defaults to new Date() - inject a fixed value for tests.
 *     • evaluateConditions() is deterministic for the same triggerData.
 *     • computeWakeAt() is deterministic for the same simulatedNow.
 *
 * ── DEPENDENCY GRAPH ─────────────────────────────────────────────────────────
 *
 *   simulation.ts → validator.ts     (validateWorkflow, types)
 *   simulation.ts → validation-engine.ts (GovernanceNotice, EstimatedMetrics)
 *   simulation.ts → steps/delay.ts   (computeWakeAt - pure)
 *   simulation.ts → conditions.ts    (evaluateConditions - pure)
 *   simulation.ts → logger.ts        (structured observability events only)
 *   simulation.ts → types.ts         (WorkflowStep, WorkflowCondition, etc.)
 *
 *   NO import of db, executor.ts write paths, or any step handler.
 */

import { logger } from "../logger";
import { evaluateConditions } from "./conditions";
import { computeWakeAt } from "./steps/delay";
import { validateWorkflow } from "./validator";
import type {
  WorkflowStep,
  ConditionStep,
  ApprovalStep,
  DelayStep,
} from "./types";
import type {
  ValidationError,
  ValidationWarning,
  GovernanceNotice,
  EstimatedExecutionMetrics,
} from "./validator";

// ── Governance constants ───────────────────────────────────────────────────────

/** Nominal wall-clock overhead per non-waiting step (ms). */
const STEP_OVERHEAD_MS = 200;

/**
 * Nominal approval wait time when no timeoutHours is configured.
 * Represents a typical human decision cycle (1 business day).
 */
const DEFAULT_APPROVAL_WAIT_HOURS = 24;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulated decision for an approval step.
 *
 * "approve"  - execution continues past the approval step.
 * "reject"   - execution stops immediately (simulatedStatus="rejected").
 * "timeout"  - uses the step's `onTimeout` config to determine next action:
 *              "auto_approve" → continue; "auto_reject" → stop.
 *              If onTimeout is absent → stop (simulatedStatus="timed_out").
 */
export type SimulationApprovalDecision = "approve" | "reject" | "timeout";

/**
 * Status of an individual step record in the simulation result.
 *
 * "executed"    - visited and completed on this traversal path.
 * "skipped"     - structurally reachable but bypassed by routing on this run.
 * "unreachable" - structurally unreachable from step 0 by any path.
 * "paused_delay"- delay step: simulated as a wait point, execution continues
 *                 after wakeAt (included in duration estimate).
 */
export type SimulatedStepStatus =
  | "executed"
  | "skipped"
  | "unreachable"
  | "paused_delay";

/** Per-step simulation record - one entry in traversalPath / skippedSteps / unreachableSteps. */
export interface SimulatedStepRecord {
  stepIndex:  number;
  stepName:   string;
  stepType:   string;
  status:     SimulatedStepStatus;

  // ── Condition step fields ──────────────────────────────────────────────────
  conditionMatched?:  boolean;
  branchTaken?:       "true" | "false" | "linear";
  onTrueStepIndex?:   number | null;
  onFalseStepIndex?:  number | null;

  // ── Approval step fields ───────────────────────────────────────────────────
  approvalDecision?:   SimulationApprovalDecision;
  approvalTimeoutHours?: number;
  onTimeout?:          "auto_approve" | "auto_reject" | "escalate";

  // ── Delay step fields ─────────────────────────────────────────────────────
  wakeAt?:        Date;
  delayMs?:       number;
  delayMinutes?:  number;
  delayMode?:     "relative" | "absolute";

  /**
   * Estimated contribution of this step to the total wall-clock duration (ms).
   * For non-visited steps (skipped/unreachable), this is 0.
   */
  estimatedDurationMs: number;

  /**
   * Governance warning / notice codes that mention this step by stepIndex.
   * Populated from validateWorkflow() + validation engine output.
   */
  stepWarnings: string[];
}

/**
 * Simulated final status of the workflow execution.
 *
 * "completed"      - traversal reached the end of the step array normally.
 * "rejected"       - an approval step was rejected; execution stopped.
 * "timed_out"      - an approval step timed out with auto_reject semantics.
 * "empty_workflow" - no steps to simulate.
 * "failed"         - simulation hit an unrecoverable configuration error
 *                    (e.g., delay step with invalid config).
 */
export type SimulatedStatus =
  | "completed"
  | "rejected"
  | "timed_out"
  | "empty_workflow"
  | "failed";

/**
 * SimulationContext - all inputs to a simulation run.
 *
 * All fields are pure data.  Identical contexts always produce identical results.
 * No DB access, no runtime state queries.
 */
export interface SimulationContext {
  /** Trigger event type for this workflow (e.g. "ticket.created"). */
  triggerEvent: string;

  /**
   * Simulated event payload.
   * Used by condition steps to evaluate their ConditionGroup.
   * Provide representative values to see realistic branching.
   */
  triggerData: Record<string, unknown>;

  /** Workspace ID - included in observability events. */
  workspaceId: number;

  /** Workflow definition ID - included in observability events. */
  workflowId?: number;

  /** Workflow version - included in observability events. */
  workflowVersion?: number | null;

  /**
   * Simulated approval decisions, keyed by step.index.
   *
   * If an approval step's index is absent, defaults to "approve" (most
   * optimistic path - execution continues).
   *
   * "approve"  → continue past the approval step.
   * "reject"   → execution stops immediately.
   * "timeout"  → apply the step's onTimeout policy:
   *              "auto_approve" → continue; "auto_reject" → stop;
   *              absent / "escalate" → stop (simulatedStatus="timed_out").
   */
  approvalDecisions?: Record<number, SimulationApprovalDecision>;

  /**
   * Reference clock for delay step computation.
   * Defaults to new Date() at simulate() call time.
   * Inject a fixed value for deterministic tests.
   */
  simulatedNow?: Date;
}

/** Full simulation output - predictive traversal of one workflow execution path. */
export interface SimulationResult {
  workflowId:       number | undefined;
  workspaceId:      number;
  workflowVersion:  number | null | undefined;

  /** How the simulation ended. */
  simulatedStatus: SimulatedStatus;

  /**
   * Steps visited in execution order on this traversal path.
   * Always in execution sequence order.
   */
  traversalPath: SimulatedStepRecord[];

  /**
   * Steps that are structurally reachable from step 0 but were bypassed by
   * routing on this specific traversal path (condition branch not taken).
   */
  skippedSteps: SimulatedStepRecord[];

  /**
   * Steps that cannot be reached by ANY execution path from step 0.
   * These are flagged by WG-TOPO-01 in the validation engine.
   */
  unreachableSteps: SimulatedStepRecord[];

  /** Approval steps from traversalPath (convenience subset). */
  approvalPoints: SimulatedStepRecord[];

  /** Delay steps from traversalPath (convenience subset). */
  delayPoints: SimulatedStepRecord[];

  /**
   * Estimated total wall-clock duration for this execution path.
   * Sum of: delay step waits + approval wait estimates + step overhead.
   * This is a simulation estimate, not a runtime guarantee.
   */
  estimatedDurationMs: number;

  /**
   * Human-readable duration label (e.g. "2 days 3 hours" or "45 minutes").
   */
  estimatedDurationLabel: string;

  /** Per-step validation errors from validateWorkflow(). */
  validationErrors:   ValidationError[];
  /** Per-step validation warnings from validateWorkflow(). */
  validationWarnings: ValidationWarning[];
  /** Structural governance notices from the validation engine (P5-D). */
  governanceNotices:  GovernanceNotice[];
  /** Deterministic execution metrics from the validation engine. */
  estimatedMetrics:   EstimatedExecutionMetrics;

  /** Simulation-specific notices (not from validator/engine). */
  simulationWarnings: string[];

  /** Summary counters for this simulation run. */
  metrics: {
    visitedStepCount:     number;
    skippedStepCount:     number;
    unreachableStepCount: number;
    conditionCount:       number;
    approvalCount:        number;
    delayCount:           number;
    totalDelayMs:         number;
    totalApprovalWaitMs:  number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the successor adjacency map (array position → [successor positions]).
 *
 * Mirrors the logic in validation-engine.ts buildSuccessors().
 * Inlined here to keep simulation.ts dependency-free from that internal module.
 */
function buildSuccessors(steps: WorkflowStep[]): Map<number, number[]> {
  const succs = new Map<number, number[]>();

  for (let i = 0; i < steps.length; i++) {
    const step       = steps[i]!;
    const linearNext = i + 1;

    if (step.type === "condition") {
      const cs = step as ConditionStep;
      const trueIdx  = cs.config.onTrueStepIndex;
      const falseIdx = cs.config.onFalseStepIndex;

      // Resolve step.index targets to array positions.
      const trueTarget  = trueIdx  !== null ? steps.findIndex(s => s.index === trueIdx)  : -1;
      const falseTarget = falseIdx !== null ? steps.findIndex(s => s.index === falseIdx) : -1;

      const truePos  = trueTarget  >= 0 ? trueTarget  : linearNext;
      const falsePos = falseTarget >= 0 ? falseTarget : linearNext;

      const neighbors: number[] = [];
      if (truePos  < steps.length) neighbors.push(truePos);
      if (falsePos < steps.length && falsePos !== truePos) neighbors.push(falsePos);
      succs.set(i, neighbors);
    } else {
      succs.set(i, linearNext < steps.length ? [linearNext] : []);
    }
  }

  return succs;
}

/**
 * BFS reachability from startPos following the successor graph.
 * Returns the set of all reachable array positions.
 */
function bfsReachable(startPos: number, succs: Map<number, number[]>): Set<number> {
  const visited = new Set<number>();
  const queue   = [startPos];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (const next of (succs.get(curr) ?? [])) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

/**
 * Inline cursor resolution - mirrors resolveNextCursor() from executor.ts.
 *
 * Pure function: resolves the next array cursor position from a step result.
 * Returns { nextCursor } on success or { error, code } on routing violation.
 *
 * NOTE: Kept in sync with executor.ts resolveNextCursor().  If the routing
 * logic changes there, update this function too.  A future P7-A refactor will
 * extract this to a shared routing.ts module.
 */
function resolveSimulationCursor(
  nextStepIndex: number | undefined,
  currentStep:   WorkflowStep,
  steps:         WorkflowStep[],
): { nextCursor: number } | { error: string; code: string } {
  if (nextStepIndex === undefined) {
    const currentPos = steps.findIndex(s => s.index === currentStep.index);
    return { nextCursor: currentPos + 1 };
  }

  const targetIdx     = nextStepIndex;
  const targetArrayPos = steps.findIndex(s => s.index === targetIdx);

  if (targetIdx === currentStep.index) {
    return { error: `Self-loop detected at step ${currentStep.index}`, code: "SELF_LOOP" };
  }
  if (targetIdx < currentStep.index) {
    return { error: `Backward jump from step ${currentStep.index} to ${targetIdx}`, code: "BACKWARD_JUMP" };
  }
  if (targetArrayPos === -1) {
    return { error: `Route target step ${targetIdx} not found`, code: "ROUTE_NOT_FOUND" };
  }
  return { nextCursor: targetArrayPos };
}

/**
 * Estimate the wall-clock duration contribution of one step.
 *
 * Approval: timeoutHours (config) or DEFAULT_APPROVAL_WAIT_HOURS × 3 600 000 ms.
 *           Only counted when decision="approve" or decision="timeout" with
 *           auto_approve - the execution waited for a decision.
 * Delay:    pre-computed delayMs.
 * Others:   STEP_OVERHEAD_MS constant.
 */
function estimateStepDurationMs(
  step:             WorkflowStep,
  approvalDecision: SimulationApprovalDecision | undefined,
  delayMs:          number | undefined,
): number {
  if (step.type === "delay") {
    return delayMs ?? 0;
  }
  if (step.type === "approval") {
    const as = step as ApprovalStep;
    // "approve" path: we waited for a decision - estimate it as the step timeout
    // (or a nominal default).  "reject" path: the approval ended immediately.
    if (approvalDecision === "reject") return 0;
    const waitHours = as.config.timeoutHours ?? DEFAULT_APPROVAL_WAIT_HOURS;
    return waitHours * 3_600_000;
  }
  return STEP_OVERHEAD_MS;
}

/**
 * Format a duration in milliseconds as a human-readable string.
 * Examples: "less than 1 minute", "45 minutes", "3 hours 20 minutes",
 *           "2 days 3 hours".
 */
export function formatDurationMs(ms: number): string {
  if (ms <= 0)             return "instant";
  if (ms < 60_000)         return "less than 1 minute";

  const totalMinutes = Math.round(ms / 60_000);
  const totalHours   = Math.floor(totalMinutes / 60);
  const minutes      = totalMinutes % 60;
  const days         = Math.floor(totalHours / 24);
  const hours        = totalHours % 24;

  if (totalMinutes < 60)  return `${totalMinutes} minute${totalMinutes !== 1 ? "s" : ""}`;
  if (days === 0) {
    const h = `${hours} hour${hours !== 1 ? "s" : ""}`;
    if (minutes === 0) return h;
    return `${h} ${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }
  const d = `${days} day${days !== 1 ? "s" : ""}`;
  if (hours === 0) return d;
  return `${d} ${hours} hour${hours !== 1 ? "s" : ""}`;
}

/**
 * Build a lookup: stepIndex → array of warning/notice codes mentioning it.
 */
function buildStepWarningIndex(
  errors:   ValidationError[],
  warnings: ValidationWarning[],
  notices:  GovernanceNotice[],
): Map<number, string[]> {
  const idx = new Map<number, string[]>();

  const add = (stepIndex: number | undefined, code: string) => {
    if (stepIndex === undefined) return;
    const arr = idx.get(stepIndex) ?? [];
    arr.push(code);
    idx.set(stepIndex, arr);
  };

  for (const e of errors)   add(e.stepIndex, e.code);
  for (const w of warnings) add(w.stepIndex, w.code);
  for (const n of notices)  add(n.stepIndex, n.code);

  return idx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: simulate()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * simulate(steps, context) → SimulationResult
 *
 * Deterministic predictive traversal of one workflow execution path.
 *
 * SAFETY GUARANTEE:
 *   This function and all functions it calls are PURE (no DB, no I/O,
 *   no scheduler, no step-handler side effects).  The only I/O is the
 *   structured log events emitted via logger - these are fire-and-forget
 *   and do not affect the return value.
 *
 * @param steps    The workflow's step array (from workflow_definitions.steps).
 * @param context  Simulation inputs: trigger data, approval decisions, clock.
 */
export function simulate(
  steps:   WorkflowStep[],
  context: SimulationContext,
): SimulationResult {
  const now = context.simulatedNow ?? new Date();

  // ── Observability: workflow_simulation_started ─────────────────────────────
  logger.info(
    {
      workflowId:      context.workflowId ?? null,
      workspaceId:     context.workspaceId,
      workflowVersion: context.workflowVersion ?? null,
      stepCount:       steps.length,
      triggerEvent:    context.triggerEvent,
      simulatedNow:    now.toISOString(),
      action:          "workflow_simulation_started",
    },
    "[governance] P6-B: Workflow simulation started",
  );

  // ── Empty workflow fast path ───────────────────────────────────────────────
  if (steps.length === 0) {
    const emptyMetrics: EstimatedExecutionMetrics = {
      maxExecutedSteps: 0, maxNotificationCount: 0,
      branchingPaths: 0, conditionStepCount: 0, notificationStepCount: 0,
    };
    const emptyResult: SimulationResult = {
      workflowId:           context.workflowId,
      workspaceId:          context.workspaceId,
      workflowVersion:      context.workflowVersion,
      simulatedStatus:      "empty_workflow",
      traversalPath:        [],
      skippedSteps:         [],
      unreachableSteps:     [],
      approvalPoints:       [],
      delayPoints:          [],
      estimatedDurationMs:  0,
      estimatedDurationLabel: "instant",
      validationErrors:     [],
      validationWarnings:   [],
      governanceNotices:    [],
      estimatedMetrics:     emptyMetrics,
      simulationWarnings:   ["Workflow has no steps - nothing to simulate."],
      metrics: {
        visitedStepCount: 0, skippedStepCount: 0, unreachableStepCount: 0,
        conditionCount: 0, approvalCount: 0, delayCount: 0,
        totalDelayMs: 0, totalApprovalWaitMs: 0,
      },
    };

    logger.info(
      { workflowId: context.workflowId ?? null, workspaceId: context.workspaceId,
        simulatedStatus: "empty_workflow", action: "workflow_simulation_completed" },
      "[governance] P6-B: Workflow simulation completed (empty workflow)",
    );
    return emptyResult;
  }

  // ── Step 1: Validation (for warnings + governance integration) ────────────
  //
  // Run full validation to collect per-step errors, warnings, engine warnings,
  // and notices.  These are folded into the SimulationResult and attached
  // per-step via the stepWarnings lookup.
  //
  // The simulation runs REGARDLESS of validation errors - even a workflow with
  // blocking errors can be previewed (the admin may want to understand its
  // structure before fixing the errors).
  const validation = validateWorkflow(steps, context.triggerEvent);

  const stepWarningIdx = buildStepWarningIndex(
    validation.errors,
    validation.warnings,
    validation.notices,
  );

  // ── Step 2: Build successor graph + BFS reachability ─────────────────────
  const succs      = buildSuccessors(steps);
  const reachable  = bfsReachable(0, succs);

  // ── Step 3: Cursor traversal ──────────────────────────────────────────────
  const traversalPath:  SimulatedStepRecord[] = [];
  const approvalPoints: SimulatedStepRecord[] = [];
  const delayPoints:    SimulatedStepRecord[] = [];

  let cursor:            number          = 0;
  let simulatedStatus:   SimulatedStatus = "completed";
  let estimatedDurationMs = 0;
  let totalDelayMs       = 0;
  let totalApprovalWaitMs = 0;
  let conditionCount     = 0;
  let approvalCount      = 0;
  let delayCount         = 0;
  const visitedArrayPositions = new Set<number>();
  const simulationWarnings: string[] = [];

  // Simulated step outputs - populated as each step "executes".
  // Used by condition steps that need to access prior-step data.
  const simulatedStepOutputs: Record<number, Record<string, unknown>> = {};

  while (cursor < steps.length) {
    const step    = steps[cursor]!;
    const arrayPos = cursor;
    visitedArrayPositions.add(arrayPos);

    const stepWarnCodes = stepWarningIdx.get(step.index) ?? [];

    // ── Condition step ───────────────────────────────────────────────────────
    if (step.type === "condition") {
      conditionCount++;
      const cs = step as ConditionStep;

      // Evaluate conditions against simulated data.
      // Merge triggerData + all prior simulated step outputs (flat view).
      const flatOutputs: Record<string, unknown> = {};
      for (const out of Object.values(simulatedStepOutputs)) {
        Object.assign(flatOutputs, out);
      }
      const data    = { ...context.triggerData, ...flatOutputs };
      const matched = evaluateConditions(cs.config.conditions, data);

      const selectedNextStepIndex: number | null = matched
        ? cs.config.onTrueStepIndex
        : cs.config.onFalseStepIndex;

      const branchTaken: "true" | "false" | "linear" =
        selectedNextStepIndex !== null
          ? (matched ? "true" : "false")
          : "linear";

      // ── Observability: workflow_simulation_branch_selected ─────────────────
      logger.info(
        {
          workflowId:          context.workflowId ?? null,
          workspaceId:         context.workspaceId,
          workflowVersion:     context.workflowVersion ?? null,
          stepIndex:           step.index,
          stepName:            step.name,
          conditionMatched:    matched,
          branchTaken,
          selectedNextStepIndex,
          simulatedPathCount:  traversalPath.length + 1,
          warningsCount:       stepWarnCodes.length,
          action:              "workflow_simulation_branch_selected",
        },
        "[governance] P6-B: Simulation branch selected",
      );

      const stepDurationMs = STEP_OVERHEAD_MS;
      estimatedDurationMs += stepDurationMs;

      simulatedStepOutputs[step.index] = { matched, selectedNextStepIndex };

      const record: SimulatedStepRecord = {
        stepIndex: step.index, stepName: step.name, stepType: step.type,
        status:             "executed",
        conditionMatched:   matched,
        branchTaken,
        onTrueStepIndex:    cs.config.onTrueStepIndex,
        onFalseStepIndex:   cs.config.onFalseStepIndex,
        estimatedDurationMs: stepDurationMs,
        stepWarnings:       stepWarnCodes,
      };
      traversalPath.push(record);

      // Resolve cursor via inline routing logic.
      const routeResult = resolveSimulationCursor(
        selectedNextStepIndex ?? undefined,
        step,
        steps,
      );
      if ("error" in routeResult) {
        simulationWarnings.push(
          `Routing error at step ${step.index} ("${step.name}"): ${routeResult.error}`,
        );
        simulatedStatus = "failed";
        break;
      }
      cursor = routeResult.nextCursor;
      continue;
    }

    // ── Approval step ────────────────────────────────────────────────────────
    if (step.type === "approval") {
      approvalCount++;
      const as       = step as ApprovalStep;
      const decision = context.approvalDecisions?.[step.index] ?? "approve";
      const waitMs   = estimateStepDurationMs(step, decision, undefined);

      estimatedDurationMs += waitMs;
      totalApprovalWaitMs += waitMs;

      simulatedStepOutputs[step.index] = { approvalDecision: decision };

      const record: SimulatedStepRecord = {
        stepIndex: step.index, stepName: step.name, stepType: step.type,
        status:               "executed",
        approvalDecision:     decision,
        approvalTimeoutHours: as.config.timeoutHours,
        onTimeout:            as.config.onTimeout,
        estimatedDurationMs:  waitMs,
        stepWarnings:         stepWarnCodes,
      };
      traversalPath.push(record);
      approvalPoints.push(record);

      if (decision === "reject") {
        simulatedStatus = "rejected";
        break;
      }

      if (decision === "timeout") {
        const policy = as.config.onTimeout;
        if (policy === "auto_approve") {
          // Continue - falls through to cursor++
        } else {
          // "auto_reject", "escalate", or absent → stop
          simulatedStatus = "timed_out";
          break;
        }
      }

      cursor++;
      continue;
    }

    // ── Delay step ───────────────────────────────────────────────────────────
    if (step.type === "delay") {
      delayCount++;
      const ds     = step as DelayStep;
      const result = computeWakeAt(ds.config, now);

      if ("error" in result) {
        simulationWarnings.push(
          `Delay step ${step.index} ("${step.name}") has invalid configuration ` +
          `(${result.code}): ${result.error}`,
        );
        // Treat as a failed step but continue traversal - show what comes after.
        const record: SimulatedStepRecord = {
          stepIndex: step.index, stepName: step.name, stepType: step.type,
          status:              "executed",
          estimatedDurationMs: 0,
          stepWarnings:        [...stepWarnCodes, result.code],
        };
        traversalPath.push(record);
        cursor++;
        continue;
      }

      const { wakeAt }    = result;
      const delayMs       = Math.max(0, wakeAt.getTime() - now.getTime());
      const delayMinutes  = Math.round(delayMs / 60_000);
      const mode          = ds.config.delayForMinutes !== undefined ? "relative" : "absolute";

      estimatedDurationMs += delayMs;
      totalDelayMs        += delayMs;

      simulatedStepOutputs[step.index] = {
        wakeAt: wakeAt.toISOString(), delayMs, delayMinutes, mode,
      };

      const record: SimulatedStepRecord = {
        stepIndex: step.index, stepName: step.name, stepType: step.type,
        status:              "paused_delay",
        wakeAt,
        delayMs,
        delayMinutes,
        delayMode:           mode,
        estimatedDurationMs: delayMs,
        stepWarnings:        stepWarnCodes,
      };
      traversalPath.push(record);
      delayPoints.push(record);

      cursor++;
      continue;
    }

    // ── All other steps (notification, task, status_update, assignment) ───────
    //
    // These steps have runtime side effects (sending notifications, creating
    // tasks, updating entity status, assigning entities).  The simulation
    // records them as "executed" without calling any handler.
    const stepDurationMs = STEP_OVERHEAD_MS;
    estimatedDurationMs += stepDurationMs;

    simulatedStepOutputs[step.index] = { simulated: true };

    const record: SimulatedStepRecord = {
      stepIndex: step.index, stepName: step.name, stepType: step.type,
      status:              "executed",
      estimatedDurationMs: stepDurationMs,
      stepWarnings:        stepWarnCodes,
    };
    traversalPath.push(record);
    cursor++;
  }

  // ── Step 4: Classify non-visited steps ───────────────────────────────────
  const skippedSteps:     SimulatedStepRecord[] = [];
  const unreachableSteps: SimulatedStepRecord[] = [];

  for (let i = 0; i < steps.length; i++) {
    if (visitedArrayPositions.has(i)) continue;

    const step          = steps[i]!;
    const stepWarnCodes = stepWarningIdx.get(step.index) ?? [];

    if (reachable.has(i)) {
      // Reachable but not visited on this traversal → skipped branch
      skippedSteps.push({
        stepIndex: step.index, stepName: step.name, stepType: step.type,
        status:              "skipped",
        estimatedDurationMs: 0,
        stepWarnings:        stepWarnCodes,
      });
    } else {
      // Not reachable by any path → structurally unreachable
      unreachableSteps.push({
        stepIndex: step.index, stepName: step.name, stepType: step.type,
        status:              "unreachable",
        estimatedDurationMs: 0,
        stepWarnings:        stepWarnCodes,
      });
    }
  }

  // ── Step 5: Assemble result ───────────────────────────────────────────────
  const estimatedDurationLabel = formatDurationMs(estimatedDurationMs);

  const result: SimulationResult = {
    workflowId:           context.workflowId,
    workspaceId:          context.workspaceId,
    workflowVersion:      context.workflowVersion,
    simulatedStatus,
    traversalPath,
    skippedSteps,
    unreachableSteps,
    approvalPoints,
    delayPoints,
    estimatedDurationMs,
    estimatedDurationLabel,
    validationErrors:     validation.errors,
    validationWarnings:   validation.warnings,
    governanceNotices:    validation.notices,
    estimatedMetrics:     validation.estimatedMetrics,
    simulationWarnings,
    metrics: {
      visitedStepCount:     traversalPath.length,
      skippedStepCount:     skippedSteps.length,
      unreachableStepCount: unreachableSteps.length,
      conditionCount,
      approvalCount,
      delayCount,
      totalDelayMs,
      totalApprovalWaitMs,
    },
  };

  // ── Observability: workflow_simulation_completed ──────────────────────────
  logger.info(
    {
      workflowId:           context.workflowId ?? null,
      workspaceId:          context.workspaceId,
      workflowVersion:      context.workflowVersion ?? null,
      simulatedStatus,
      visitedStepCount:     traversalPath.length,
      skippedStepCount:     skippedSteps.length,
      unreachableStepCount: unreachableSteps.length,
      approvalCount,
      delayCount,
      estimatedDurationMs,
      estimatedDurationLabel,
      simulatedPathCount:   traversalPath.length,
      warningsCount:        validation.warnings.length + validation.notices.length,
      action:               "workflow_simulation_completed",
    },
    "[governance] P6-B: Workflow simulation completed",
  );

  return result;
}
