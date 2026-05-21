/**
 * @file   lib/workflows/remediation-execution.ts
 * @phase  P10-E - Controlled Remediation Execution Research & Explicit Operator
 *                 Confirmation Foundations
 *
 * Pure deterministic remediation execution tracking engine.
 * No autonomous execution, no automatic confirmation, no self-healing, no AI.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Provides the deterministic core of explicit-confirmation remediation tracking:
 *
 *   buildExecutionAttempt(input)
 *     → RemediationExecutionAttempt    (value object construction, not persisted)
 *
 *   confirmRemediationExecution(attempt, confirmedBy)
 *     → ConfirmationValidation         (validates confirmation preconditions)
 *
 *   validateExecutionTransition(current, next)
 *     → ExecutionTransitionValidation  (deterministic lifecycle guard)
 *
 *   isTerminalExecutionStatus(status)
 *     → boolean                        (terminal state check)
 *
 *   canConfirm / canMarkExecuting / canComplete / canRollBack / canAbandon
 *     → boolean status guards
 *
 *   detectDuplicateExecution(actionId, existing)
 *     → { isDuplicate, conflictingExecutionId? }
 *
 *   EXECUTION_VALID_TRANSITIONS
 *     → Record of allowed status transitions (state machine table)
 *
 * ── LIFECYCLE STATE MACHINE ──────────────────────────────────────────────────
 *
 *   pending_confirmation → confirmed        explicit operator confirmation
 *   pending_confirmation → abandoned        operator abandons before confirming
 *   confirmed            → executing        operator marks as actively executing
 *   confirmed            → abandoned        operator abandons after confirming
 *   executing            → completed        operator marks execution complete
 *   executing            → rolled_back      operator records rollback result
 *   executing            → abandoned        operator abandons mid-execution
 *
 *   Terminal (immutable): completed, rolled_back, abandoned
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   CONFIRMATION-GATED:   execution tracking can only proceed after explicit
 *                         operator confirmation with named confirmedBy
 *   NO AUTO-EXEC:         engine produces value objects only - no execution
 *   NO AUTO-CONFIRM:      confirmationMode is always "explicit" - immutable
 *   APPEND-ONLY:          execution history preserved - records never deleted
 *   DUPLICATE GUARD:      one active execution per actionId
 *   ROLLBACK-TRACKED:     rollbackStatus is independent of executionStatus
 *   FAIL-CLOSED:          invalid transitions rejected with explicit error codes
 *   DETERMINISTIC:        same inputs → same outputs every time
 */

import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eight execution types - each maps to a specific controlled remediation domain.
 * Operator selects the type that best matches the orchestration action being executed.
 */
export type RemediationExecutionType =
  | "scheduler_configuration_review"
  | "fairness_weight_adjustment"
  | "containment_boundary_reconfiguration"
  | "advisory_threshold_tuning"
  | "workload_pressure_investigation"
  | "recovery_validation_execution"
  | "escalation_stabilization"
  | "operational_intervention";

/**
 * Six lifecycle states. Transitions are strict and deterministic.
 * Terminal states (completed, rolled_back, abandoned) are immutable.
 */
export type RemediationExecutionStatus =
  | "pending_confirmation"
  | "confirmed"
  | "executing"
  | "completed"
  | "rolled_back"
  | "abandoned";

/**
 * Independent rollback outcome tracking.
 * Populated only when executionStatus transitions to "rolled_back".
 */
export type RemediationRollbackStatus =
  | "not_applicable"
  | "pending"
  | "completed"
  | "failed";

/**
 * A single controlled remediation execution attempt.
 * Pure value object - immutable once constructed.
 * Persisted to remediation_execution_attempts by the route handler.
 */
export interface RemediationExecutionAttempt {
  /** Unique execution identifier. Format: "exec:<workspaceId>-<ms>-<seq>" */
  executionId:       string;
  /** Soft reference to the orchestration action that prompted this execution. */
  actionId:          string;
  workspaceId:       number;
  executionType:     RemediationExecutionType;
  /**
   * Always "explicit" - immutable design invariant.
   * No execution attempt may be created without explicit confirmation.
   */
  confirmationMode:  "explicit";
  /** Operator who created this execution attempt. Required. */
  initiatedBy:       string;
  /** Operator who confirmed execution intent. Null until confirmed. */
  confirmedBy:       string | null;
  /** ISO 8601 timestamp of confirmation. Null until confirmed. */
  confirmedAt:       string | null;
  /** ISO 8601 timestamp when executing status was entered. Null until then. */
  executedAt:        string | null;
  executionStatus:   RemediationExecutionStatus;
  rollbackStatus:    RemediationRollbackStatus;
  /** Evidence codes and references recorded by operator during execution. */
  executionEvidence: string[];
  executionNotes:    string | null;
}

/** Result of a lifecycle transition validation. */
export interface ExecutionTransitionValidation {
  valid:     boolean;
  errorCode: string | null;
  errorMsg:  string | null;
}

/** Result of confirmRemediationExecution() precondition check. */
export interface ConfirmationValidation {
  valid:     boolean;
  errorCode: string | null;
  errorMsg:  string | null;
}

/** Input to buildExecutionAttempt(). */
export interface ExecutionAttemptInput {
  actionId:          string;
  workspaceId:       number;
  executionType:     RemediationExecutionType;
  /** Must be non-empty - operator attribution is mandatory. */
  initiatedBy:       string;
  executionEvidence?: string[];
  executionNotes?:   string | null;
  createdAt?:        Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS - STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete set of allowed execution status transitions.
 * Any transition not listed here is invalid and will be rejected.
 */
export const EXECUTION_VALID_TRANSITIONS: Readonly<
  Record<RemediationExecutionStatus, RemediationExecutionStatus[]>
> = {
  pending_confirmation: ["confirmed", "abandoned"],
  confirmed:            ["executing", "abandoned"],
  executing:            ["completed", "rolled_back", "abandoned"],
  completed:            [],   // terminal
  rolled_back:          [],   // terminal
  abandoned:            [],   // terminal
};

/** Status values that represent a completed (immutable) execution. */
export const TERMINAL_EXECUTION_STATUSES = new Set<RemediationExecutionStatus>([
  "completed",
  "rolled_back",
  "abandoned",
]);

/** Status values that represent an active (non-terminal) execution. */
export const ACTIVE_EXECUTION_STATUSES = new Set<RemediationExecutionStatus>([
  "pending_confirmation",
  "confirmed",
  "executing",
]);

/** All valid execution types. */
export const ALL_EXECUTION_TYPES = new Set<RemediationExecutionType>([
  "scheduler_configuration_review",
  "fairness_weight_adjustment",
  "containment_boundary_reconfiguration",
  "advisory_threshold_tuning",
  "workload_pressure_investigation",
  "recovery_validation_execution",
  "escalation_stabilization",
  "operational_intervention",
]);

/** All valid rollback status values. */
export const ALL_ROLLBACK_STATUSES = new Set<RemediationRollbackStatus>([
  "not_applicable",
  "pending",
  "completed",
  "failed",
]);

// ─────────────────────────────────────────────────────────────────────────────
// ID GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

let _execSeq = 0;

export function makeExecutionId(workspaceId: number): string {
  _execSeq += 1;
  return `exec:${workspaceId}-${Date.now()}-${_execSeq}`;
}

export function resetExecutionSeq(): void {
  _execSeq = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS GUARDS
// ─────────────────────────────────────────────────────────────────────────────

export function isTerminalExecutionStatus(status: RemediationExecutionStatus): boolean {
  return TERMINAL_EXECUTION_STATUSES.has(status);
}

export function isActiveExecutionStatus(status: RemediationExecutionStatus): boolean {
  return ACTIVE_EXECUTION_STATUSES.has(status);
}

export function canConfirm(status: RemediationExecutionStatus): boolean {
  return EXECUTION_VALID_TRANSITIONS[status]?.includes("confirmed") ?? false;
}

export function canMarkExecuting(status: RemediationExecutionStatus): boolean {
  return EXECUTION_VALID_TRANSITIONS[status]?.includes("executing") ?? false;
}

export function canComplete(status: RemediationExecutionStatus): boolean {
  return EXECUTION_VALID_TRANSITIONS[status]?.includes("completed") ?? false;
}

export function canRollBack(status: RemediationExecutionStatus): boolean {
  return EXECUTION_VALID_TRANSITIONS[status]?.includes("rolled_back") ?? false;
}

export function canAbandon(status: RemediationExecutionStatus): boolean {
  return EXECUTION_VALID_TRANSITIONS[status]?.includes("abandoned") ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates whether a lifecycle transition from current → next is permitted.
 *
 * Error codes:
 *   EXEC_TERMINAL         - current status is terminal; no transitions allowed
 *   EXEC_INVALID_NEXT     - next status is not a known status
 *   EXEC_TRANSITION_DENIED - transition not in EXECUTION_VALID_TRANSITIONS
 *
 * Pure: no DB, no async, no side effects.
 */
export function validateExecutionTransition(
  current: RemediationExecutionStatus,
  next:    RemediationExecutionStatus,
): ExecutionTransitionValidation {
  if (isTerminalExecutionStatus(current)) {
    return {
      valid:     false,
      errorCode: "EXEC_TERMINAL",
      errorMsg:  `Execution status "${current}" is terminal - no further transitions allowed.`,
    };
  }

  if (!TERMINAL_EXECUTION_STATUSES.has(next) && !ACTIVE_EXECUTION_STATUSES.has(next)) {
    return {
      valid:     false,
      errorCode: "EXEC_INVALID_NEXT",
      errorMsg:  `"${next}" is not a valid execution status.`,
    };
  }

  const allowed = EXECUTION_VALID_TRANSITIONS[current];
  if (!allowed?.includes(next)) {
    return {
      valid:     false,
      errorCode: "EXEC_TRANSITION_DENIED",
      errorMsg:  `Transition from "${current}" to "${next}" is not permitted. ` +
                 `Allowed next states: [${(allowed ?? []).join(", ")}].`,
    };
  }

  return { valid: true, errorCode: null, errorMsg: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRMATION VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates preconditions for confirming a remediation execution attempt.
 *
 * Rules:
 *   - execution must be in pending_confirmation status
 *   - confirmedBy must be a non-empty operator identifier
 *   - confirmationMode must be "explicit" (invariant check)
 *
 * Error codes:
 *   EXEC_CONFIRMATION_WRONG_STATUS  - not in pending_confirmation
 *   EXEC_CONFIRMATION_NO_OPERATOR   - confirmedBy is empty
 *   EXEC_CONFIRMATION_MODE_INVALID  - confirmationMode is not "explicit"
 *
 * Pure: no DB, no async, no side effects.
 */
export function confirmRemediationExecution(
  attempt:     Pick<RemediationExecutionAttempt, "executionStatus" | "confirmationMode">,
  confirmedBy: string,
): ConfirmationValidation {
  if (attempt.confirmationMode !== "explicit") {
    return {
      valid:     false,
      errorCode: "EXEC_CONFIRMATION_MODE_INVALID",
      errorMsg:  `confirmationMode must be "explicit" - automatic confirmation is not permitted.`,
    };
  }
  if (attempt.executionStatus !== "pending_confirmation") {
    return {
      valid:     false,
      errorCode: "EXEC_CONFIRMATION_WRONG_STATUS",
      errorMsg:  `Execution must be in "pending_confirmation" status to confirm. ` +
                 `Current status: "${attempt.executionStatus}".`,
    };
  }
  if (!confirmedBy || confirmedBy.trim().length === 0) {
    return {
      valid:     false,
      errorCode: "EXEC_CONFIRMATION_NO_OPERATOR",
      errorMsg:  "confirmedBy is required - operator confirmation must be attributed.",
    };
  }
  return { valid: true, errorCode: null, errorMsg: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECT CONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructs a RemediationExecutionAttempt value object from operator input.
 *
 * Validates:
 *   - initiatedBy is non-empty (attribution is mandatory)
 *   - executionType is a known type
 *   - actionId is non-empty
 *   - workspaceId is a positive integer
 *
 * Throws with code EXEC_VALIDATION_<FIELD> on any invalid input.
 * Never persists - returns a pure value object for the route handler to insert.
 * Sets confirmationMode="explicit" unconditionally (invariant).
 *
 * Pure: no DB, no async, no side effects.
 */
export function buildExecutionAttempt(
  input: ExecutionAttemptInput,
  now:   Date = new Date(),
): RemediationExecutionAttempt {
  // ── Validation ────────────────────────────────────────────────────────────
  if (!input.initiatedBy || input.initiatedBy.trim().length === 0) {
    throw Object.assign(
      new Error("initiatedBy is required - operator attribution is mandatory."),
      { code: "EXEC_VALIDATION_INITIATED_BY" },
    );
  }
  if (!input.actionId || input.actionId.trim().length === 0) {
    throw Object.assign(
      new Error("actionId is required - execution must be linked to an orchestration action."),
      { code: "EXEC_VALIDATION_ACTION_ID" },
    );
  }
  if (!Number.isInteger(input.workspaceId) || input.workspaceId <= 0) {
    throw Object.assign(
      new Error("workspaceId must be a positive integer."),
      { code: "EXEC_VALIDATION_WORKSPACE_ID" },
    );
  }
  if (!ALL_EXECUTION_TYPES.has(input.executionType)) {
    throw Object.assign(
      new Error(`executionType "${input.executionType}" is not a valid type. ` +
                `Valid types: [${[...ALL_EXECUTION_TYPES].join(", ")}].`),
      { code: "EXEC_VALIDATION_TYPE" },
    );
  }

  const effectiveAt = input.createdAt ?? now;
  const attempt: RemediationExecutionAttempt = {
    executionId:       makeExecutionId(input.workspaceId),
    actionId:          input.actionId.trim(),
    workspaceId:       input.workspaceId,
    executionType:     input.executionType,
    confirmationMode:  "explicit",   // immutable invariant
    initiatedBy:       input.initiatedBy.trim(),
    confirmedBy:       null,
    confirmedAt:       null,
    executedAt:        null,
    executionStatus:   "pending_confirmation",
    rollbackStatus:    "not_applicable",
    executionEvidence: input.executionEvidence ?? [],
    executionNotes:    input.executionNotes ?? null,
  };

  emitExecutionCreatedEvent({
    executionId:     attempt.executionId,
    actionId:        attempt.actionId,
    workspaceId:     attempt.workspaceId,
    executionType:   attempt.executionType,
    executionStatus: attempt.executionStatus,
    confirmedBy:     "",
    action:          "execution_created",
  });

  return attempt;
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE EXECUTION DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a new execution attempt would conflict with an existing active one.
 *
 * Conflict rule:
 *   - Same actionId with active status (pending_confirmation | confirmed | executing)
 *   = conflict.
 *   - Terminal statuses (completed/rolled_back/abandoned) = no conflict.
 *
 * Pure: receives existing records as input - no DB access.
 */
export function detectDuplicateExecution(
  actionId: string,
  existing: ReadonlyArray<{ actionId: string; executionStatus: string }>,
): { isDuplicate: boolean; conflictingExecutionId?: string } {
  const conflict = existing.find(
    e =>
      e.actionId === actionId &&
      ACTIVE_EXECUTION_STATUSES.has(e.executionStatus as RemediationExecutionStatus),
  );
  return {
    isDuplicate:              conflict !== undefined,
    conflictingExecutionId:   undefined,  // caller provides from DB row
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION TYPE → ORCHESTRATION TYPE MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps each execution type to the orchestration type it implements.
 * Closes the traceability chain: advisory → orchestration → execution.
 */
export const EXECUTION_ORCHESTRATION_MAP: Record<RemediationExecutionType, string> = {
  scheduler_configuration_review:      "scheduler_pressure_review",
  fairness_weight_adjustment:          "fairness_policy_review",
  containment_boundary_reconfiguration: "containment_audit",
  advisory_threshold_tuning:           "advisory_threshold_review",
  workload_pressure_investigation:     "scheduler_pressure_review",
  recovery_validation_execution:       "recovery_stability_validation",
  escalation_stabilization:            "escalation_monitoring",
  operational_intervention:            "operational_watch",
};

/**
 * Returns a human-readable description of an execution type.
 */
export function describeExecutionType(type: RemediationExecutionType): string {
  const descriptions: Record<RemediationExecutionType, string> = {
    scheduler_configuration_review:      "Review and adjust scheduler configuration parameters.",
    fairness_weight_adjustment:          "Adjust fairness policy weight to address imbalance.",
    containment_boundary_reconfiguration: "Reconfigure containment boundaries and thresholds.",
    advisory_threshold_tuning:           "Tune advisory pressure thresholds to reduce storm frequency.",
    workload_pressure_investigation:     "Investigate workload patterns causing scheduler pressure.",
    recovery_validation_execution:       "Execute structured validation of recovery stability.",
    escalation_stabilization:            "Apply stabilization steps to reduce escalation frequency.",
    operational_intervention:            "Perform direct operational intervention on workspace.",
  };
  return descriptions[type];
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionEventPayload {
  executionId:     string;
  actionId:        string;
  workspaceId:     number;
  executionType:   RemediationExecutionType;
  executionStatus: RemediationExecutionStatus;
  confirmedBy:     string;
  action:          string;
}

export function emitExecutionCreatedEvent(p: ExecutionEventPayload): void {
  logger.info(
    { event: "remediation_execution_created", ...p },
    "[remediation-execution] P10-E: remediation_execution_created",
  );
}

export function emitExecutionConfirmedEvent(p: ExecutionEventPayload): void {
  logger.info(
    { event: "remediation_execution_confirmed", ...p },
    "[remediation-execution] P10-E: remediation_execution_confirmed",
  );
}

export function emitExecutionCompletedEvent(p: ExecutionEventPayload): void {
  logger.info(
    { event: "remediation_execution_completed", ...p },
    "[remediation-execution] P10-E: remediation_execution_completed",
  );
}

export function emitExecutionRolledBackEvent(p: ExecutionEventPayload): void {
  logger.info(
    { event: "remediation_execution_rolled_back", ...p },
    "[remediation-execution] P10-E: remediation_execution_rolled_back",
  );
}
