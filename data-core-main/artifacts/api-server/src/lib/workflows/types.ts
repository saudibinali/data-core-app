// ── Step Types ────────────────────────────────────────────────────────────────

export type StepType =
  | "notification"
  | "approval"
  | "task"
  | "condition"
  | "status_update"
  | "assignment"
  | "delay";

// ── Condition ─────────────────────────────────────────────────────────────────

export type ConditionOperator =
  | "eq" | "neq" | "gt" | "lt" | "gte" | "lte"
  | "contains" | "not_contains" | "in" | "not_in" | "exists";

export interface WorkflowCondition {
  field: string;
  operator: ConditionOperator;
  value: unknown;
}

export type ConditionLogic = "and" | "or";

export interface ConditionGroup {
  logic: ConditionLogic;
  conditions: WorkflowCondition[];
}

// ── Steps ─────────────────────────────────────────────────────────────────────

export interface BaseStep {
  index: number;
  type: StepType;
  name: string;
  conditions?: ConditionGroup;
}

export interface NotificationStep extends BaseStep {
  type: "notification";
  config: {
    recipientType: "assignee" | "creator" | "manager" | "department" | "role" | "specific";
    recipientIds?: number[];
    recipientRole?: string;
    title: string;
    titleAr?: string;
    message: string;
    messageAr?: string;
    link?: string;
  };
}

export interface ApprovalStep extends BaseStep {
  type: "approval";
  config: {
    approvalType: "single" | "multi" | "sequential" | "parallel" | "conditional";
    approverType: "role" | "specific" | "manager" | "department_head";
    approverRole?: string;
    approverIds?: number[];
    title: string;
    timeoutHours?: number;
    onTimeout?: "auto_approve" | "auto_reject" | "escalate";
  };
}

export interface TaskStep extends BaseStep {
  type: "task";
  config: {
    title: string;
    description?: string;
    assigneeType: "role" | "specific" | "manager" | "department_head" | "creator";
    assigneeId?: number;
    assigneeRole?: string;
    priority: "low" | "medium" | "high" | "urgent";
    dueDays?: number;
  };
}

export interface ConditionStep extends BaseStep {
  type: "condition";
  config: {
    conditions: ConditionGroup;
    // ── P5-C: Deterministic single-target routing ────────────────────────────
    // onTrueStepIndex:  the step.index to jump to when condition evaluates true.
    //   null = no routing; executor continues linearly to the next array step.
    // onFalseStepIndex: the step.index to jump to when condition evaluates false.
    //   null = no routing; executor continues linearly to the next array step.
    //
    // CONSTRAINTS (enforced by validator + executor):
    //   • target index must be > current step.index (forward-only, no loops).
    //   • target must reference an existing step.index in the workflow steps array.
    //   • null is valid and means "fall through to next step linearly".
    //
    // DEPRECATED (P5-C): the old onTrue/onFalse number[] fields are removed.
    //   Any existing JSONB data using onTrue/onFalse will not be re-activated
    //   (condition steps with routing were blocked until now by WG-03).
    onTrueStepIndex:  number | null;
    onFalseStepIndex: number | null;
  };
}

export interface StatusUpdateStep extends BaseStep {
  type: "status_update";
  config: {
    entity: "ticket" | "approval" | "workflow_task";
    entityIdField: string;
    newStatus: string;
  };
}

export interface AssignmentStep extends BaseStep {
  type: "assignment";
  config: {
    entity: "ticket";
    entityIdField: string;
    assigneeType: "role" | "specific" | "round_robin";
    assigneeRole?: string;
    assigneeId?: number;
  };
}

export interface DelayStep extends BaseStep {
  type: "delay";
  config: {
    // ── P6-A: Exactly one of these must be set ──────────────────────────────
    //
    // delayForMinutes   - relative delay: N minutes from step execution time.
    //                     Must be a positive integer ≤ MAX_DELAY_MINUTES (30 days).
    //
    // delayUntilTimestamp - absolute delay: ISO 8601 timestamp.
    //                     The execution resumes at or after this absolute time.
    //                     Useful for "wait until next business day" patterns.
    //
    // Exactly one of the two must be present - both together are ambiguous and
    // blocked by WG-04_DELAY_AMBIGUOUS at publish time.  The validator enforces
    // this before activation.
    delayForMinutes?:      number;
    delayUntilTimestamp?:  string;
  };
}

export type WorkflowStep =
  | NotificationStep
  | ApprovalStep
  | TaskStep
  | ConditionStep
  | StatusUpdateStep
  | AssignmentStep
  | DelayStep;

// ── Workflow Definition (runtime shape) ───────────────────────────────────────

export interface WorkflowDefinitionRuntime {
  id: number;
  workspaceId: number;
  key: string;
  name: string;
  triggerEvent: string;
  module: string;
  conditions: ConditionGroup | null;
  steps: WorkflowStep[];
  isActive: boolean;
}

// ── Execution Context ─────────────────────────────────────────────────────────

export interface ExecutionContext {
  triggerEvent: string;

  /**
   * The raw payload from the triggering event.
   *
   * P4-A: This is a deep clone of the original event payload (via structuredClone
   * in createExecutionContext). Mutations to nested objects inside step handlers
   * cannot affect the original payload or propagate to other concurrent executions.
   */
  triggerData: Record<string, unknown>;

  workspaceId: number;
  triggeredBy?: number;

  /**
   * P4-A: Namespaced step outputs (Phase 4 - Context Isolation).
   *
   * Each step stores its output exclusively under its own index key:
   *   stepOutputs[step.index] = result.output
   *
   * This prevents cross-step key collision (WG-15): a key written by step 2
   * cannot silently overwrite the same key written by step 0, and is scoped
   * only to step 2's own slot.
   *
   * The executor populates this; step handlers do not write to it directly.
   * Reading specific prior-step outputs:  ctx.stepOutputs[2]?.taskId
   *
   * Migration: In Phase 6, step handlers will be updated to reference
   * ctx.stepOutputs[i] directly instead of the flat resolvedData view.
   */
  stepOutputs: Record<number, Record<string, unknown>>;

  /**
   * P4-A: Backward-compatible flat view of all step outputs.
   *
   * Computed by buildResolvedData(stepOutputs) and stored back here after
   * every step write. Step handlers continue reading ctx.resolvedData exactly
   * as before - zero handler changes are required for Phase 4.
   *
   * Merge order: ascending step index, so later steps shadow earlier ones on
   * key collision (matching the original linear-merge behavior).
   *
   * @deprecated Will be removed in Phase 7 once all handlers use stepOutputs.
   */
  resolvedData: Record<string, unknown>;
}

// ── Step Result ───────────────────────────────────────────────────────────────

export interface StepResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  waitForApproval?: boolean;
  /**
   * P5-C: Deterministic routing signal from a condition step.
   *
   * When set, the executor jumps to the step with this step.index value instead
   * of advancing linearly to the next array position.
   *
   * Set only by executeConditionStep when onTrueStepIndex / onFalseStepIndex is
   * non-null.  All other step types must never set this field.
   *
   * SAFETY RULES (enforced in runStepLoop):
   *   • nextStepIndex must be > current step.index (forward-only).
   *   • A step with this index must exist in the steps array.
   *   • Violations cause an immediate guarded fail transition.
   */
  nextStepIndex?: number;
  /**
   * P6-A: Delay pause signal from a delay step.
   *
   * When true, the executor must transition the execution to status='waiting_delay'
   * and persist wakeAt before returning from the loop.  The scheduler will resume
   * the execution after wakeAt has passed using a guarded acquisition UPDATE.
   *
   * Set only by executeDelayStep - never by any other step handler.
   */
  waitForDelay?: boolean;
  /**
   * P6-A: The absolute time at which the scheduler should resume this execution.
   *
   * Computed by executeDelayStep from the step config (delayForMinutes or
   * delayUntilTimestamp).  Always set alongside waitForDelay=true.
   * Stored in workflow_executions.wake_at by the executor before returning.
   */
  wakeAt?: Date;
}
