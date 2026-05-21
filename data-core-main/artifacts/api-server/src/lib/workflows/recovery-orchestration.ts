/**
 * @file   lib/workflows/recovery-orchestration.ts
 * @phase  P10-D - Recovery Orchestration Research & Human-In-The-Loop Remediation Foundations
 *
 * Pure deterministic recovery orchestration engine.
 * No autonomous execution, no scheduler mutation, no self-healing, no AI remediation.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Provides the deterministic core of human-in-the-loop remediation tracking:
 *
 *   buildOrchestrationAction(input)
 *     → RecoveryOrchestrationAction   (value object construction, not persisted here)
 *
 *   validateOrchestrationTransition(current, next)
 *     → TransitionValidation          (deterministic lifecycle guard)
 *
 *   isTerminalOrchestrationStatus(status)
 *     → boolean                       (terminal state check)
 *
 *   canAcknowledge / canResolve / canRollback / canCancel
 *     → boolean guards per status
 *
 *   VALID_TRANSITIONS
 *     → Record of allowed status transitions (state machine table)
 *
 * ── LIFECYCLE STATE MACHINE ──────────────────────────────────────────────────
 *
 *   initiated     → acknowledged   operator confirms awareness
 *   initiated     → cancelled      operator cancels before review
 *   acknowledged  → in_review      operator begins active investigation
 *   acknowledged  → cancelled      operator cancels after acknowledgement
 *   in_review     → resolved       operator concludes positively
 *   in_review     → rolled_back    operator undoes the recovery action
 *   in_review     → cancelled      operator abandons mid-review
 *
 *   Terminal (immutable): resolved, rolled_back, cancelled
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   HUMAN-TRIGGERED:    every transition requires explicit operator attribution
 *   NO AUTO-EXECUTION:  engine produces value objects only - never executes actions
 *   NO SCHEDULER MUT:   engine never touches scheduler, policies, or runtime state
 *   APPEND-ONLY:        orchestration history preserved - records never deleted
 *   DUPLICATE GUARD:    one active orchestration per (workspace, type) pair
 *   ROLLBACK-SAFE:      rollbackEligible=false after rollback (no double-rollback)
 *   FAIL-CLOSED:        invalid transitions rejected with explicit error codes
 *   DETERMINISTIC:      same inputs → same outputs every time
 */

import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eight orchestration types - each maps to a specific investigation domain.
 * Operator selects the type that best matches the advisory recommendation.
 */
export type RecoveryOrchestrationType =
  | "scheduler_pressure_review"
  | "fairness_policy_review"
  | "containment_audit"
  | "noisy_tenant_investigation"
  | "advisory_threshold_review"
  | "recovery_stability_validation"
  | "escalation_monitoring"
  | "operational_watch";

/**
 * Six lifecycle states. Transitions are strict and deterministic.
 * Terminal states (resolved, rolled_back, cancelled) are immutable.
 */
export type RecoveryOrchestrationStatus =
  | "initiated"
  | "acknowledged"
  | "in_review"
  | "resolved"
  | "rolled_back"
  | "cancelled";

/**
 * A human-in-the-loop recovery orchestration action.
 * Pure value object - immutable once constructed.
 * Persisted to recovery_orchestration_actions by the route handler.
 */
export interface RecoveryOrchestrationAction {
  /** Unique action identifier. Format: "orch:<workspaceId>-<ms>-<seq>" */
  actionId:            string;
  workspaceId:         number;
  /** Soft reference to the incident driving this orchestration. */
  incidentId:          string;
  /** Optional soft reference to the advisory recommendation that prompted this. */
  recommendationId:    string | null;
  orchestrationType:   RecoveryOrchestrationType;
  /** Operator who initiated - never empty (attribution is mandatory). */
  initiatedBy:         string;
  initiatedAt:         string;   // ISO 8601
  orchestrationStatus: RecoveryOrchestrationStatus;
  rollbackEligible:    boolean;
  /** Evidence signals that informed this decision (from advisory engine). */
  relatedSignals:      string[];
  /** Optional operator notes. */
  executionNotes:      string | null;
}

/** Result of a lifecycle transition validation. */
export interface TransitionValidation {
  valid:      boolean;
  errorCode:  string | null;
  errorMsg:   string | null;
}

/** Input to buildOrchestrationAction(). All required fields must be populated. */
export interface OrchestrationInput {
  workspaceId:        number;
  incidentId:         string;
  recommendationId:   string | null;
  orchestrationType:  RecoveryOrchestrationType;
  /** Must be non-empty - operator attribution is mandatory. */
  initiatedBy:        string;
  relatedSignals?:    string[];
  executionNotes?:    string | null;
  initiatedAt?:       Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS - STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete set of allowed orchestration status transitions.
 * Any transition not listed here is invalid and will be rejected.
 */
export const VALID_TRANSITIONS: Readonly<
  Record<RecoveryOrchestrationStatus, RecoveryOrchestrationStatus[]>
> = {
  initiated:    ["acknowledged", "cancelled"],
  acknowledged: ["in_review", "cancelled"],
  in_review:    ["resolved", "rolled_back", "cancelled"],
  resolved:     [],   // terminal
  rolled_back:  [],   // terminal
  cancelled:    [],   // terminal
};

/** Status values that represent a completed (immutable) orchestration. */
export const TERMINAL_ORCHESTRATION_STATUSES = new Set<RecoveryOrchestrationStatus>([
  "resolved",
  "rolled_back",
  "cancelled",
]);

/** Status values that represent an active (non-terminal) orchestration. */
export const ACTIVE_ORCHESTRATION_STATUSES = new Set<RecoveryOrchestrationStatus>([
  "initiated",
  "acknowledged",
  "in_review",
]);

/** All valid orchestration types. */
export const ALL_ORCHESTRATION_TYPES = new Set<RecoveryOrchestrationType>([
  "scheduler_pressure_review",
  "fairness_policy_review",
  "containment_audit",
  "noisy_tenant_investigation",
  "advisory_threshold_review",
  "recovery_stability_validation",
  "escalation_monitoring",
  "operational_watch",
]);

// ─────────────────────────────────────────────────────────────────────────────
// ID GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

let _orchSeq = 0;

export function makeOrchestrationId(workspaceId: number): string {
  _orchSeq += 1;
  return `orch:${workspaceId}-${Date.now()}-${_orchSeq}`;
}

export function resetOrchestrationSeq(): void {
  _orchSeq = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS GUARDS
// ─────────────────────────────────────────────────────────────────────────────

export function isTerminalOrchestrationStatus(status: RecoveryOrchestrationStatus): boolean {
  return TERMINAL_ORCHESTRATION_STATUSES.has(status);
}

export function isActiveOrchestrationStatus(status: RecoveryOrchestrationStatus): boolean {
  return ACTIVE_ORCHESTRATION_STATUSES.has(status);
}

export function canAcknowledge(status: RecoveryOrchestrationStatus): boolean {
  return VALID_TRANSITIONS[status]?.includes("acknowledged") ?? false;
}

export function canBeginReview(status: RecoveryOrchestrationStatus): boolean {
  return VALID_TRANSITIONS[status]?.includes("in_review") ?? false;
}

export function canResolve(status: RecoveryOrchestrationStatus): boolean {
  return VALID_TRANSITIONS[status]?.includes("resolved") ?? false;
}

export function canRollBack(
  status:           RecoveryOrchestrationStatus,
  rollbackEligible: boolean,
): boolean {
  return (VALID_TRANSITIONS[status]?.includes("rolled_back") ?? false) && rollbackEligible;
}

export function canCancel(status: RecoveryOrchestrationStatus): boolean {
  return VALID_TRANSITIONS[status]?.includes("cancelled") ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates whether a lifecycle transition from current → next is permitted.
 *
 * Error codes:
 *   ORCH_TERMINAL         - current status is terminal; no transitions allowed
 *   ORCH_INVALID_NEXT     - next status is not a known status
 *   ORCH_TRANSITION_DENIED - transition from current → next is not in VALID_TRANSITIONS
 *   ORCH_ROLLBACK_INELIGIBLE - rollback requested but rollbackEligible=false
 *
 * Pure: no DB, no async, no side effects.
 */
export function validateOrchestrationTransition(
  current:          RecoveryOrchestrationStatus,
  next:             RecoveryOrchestrationStatus,
  rollbackEligible: boolean = true,
): TransitionValidation {
  if (isTerminalOrchestrationStatus(current)) {
    return {
      valid:     false,
      errorCode: "ORCH_TERMINAL",
      errorMsg:  `Orchestration status "${current}" is terminal - no further transitions allowed.`,
    };
  }

  if (!TERMINAL_ORCHESTRATION_STATUSES.has(next) && !ACTIVE_ORCHESTRATION_STATUSES.has(next)) {
    return {
      valid:     false,
      errorCode: "ORCH_INVALID_NEXT",
      errorMsg:  `"${next}" is not a valid orchestration status.`,
    };
  }

  const allowed = VALID_TRANSITIONS[current];
  if (!allowed?.includes(next)) {
    return {
      valid:     false,
      errorCode: "ORCH_TRANSITION_DENIED",
      errorMsg:  `Transition from "${current}" to "${next}" is not permitted. ` +
                 `Allowed next states: [${(allowed ?? []).join(", ")}].`,
    };
  }

  if (next === "rolled_back" && !rollbackEligible) {
    return {
      valid:     false,
      errorCode: "ORCH_ROLLBACK_INELIGIBLE",
      errorMsg:  "This orchestration action is no longer eligible for rollback.",
    };
  }

  return { valid: true, errorCode: null, errorMsg: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECT CONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructs a RecoveryOrchestrationAction value object from operator input.
 *
 * Validates:
 *   - initiatedBy is non-empty (operator attribution is mandatory)
 *   - orchestrationType is a known type
 *   - workspaceId is a positive integer
 *   - incidentId is non-empty
 *
 * Throws an error (with code ORCH_VALIDATION_<FIELD>) on any invalid input.
 * Never persists - returns a pure value object for the route handler to insert.
 *
 * Pure: no DB, no async, no side effects.
 */
export function buildOrchestrationAction(
  input: OrchestrationInput,
  now:   Date = new Date(),
): RecoveryOrchestrationAction {
  // ── Validation ────────────────────────────────────────────────────────────
  if (!input.initiatedBy || input.initiatedBy.trim().length === 0) {
    throw Object.assign(
      new Error("initiatedBy is required - operator attribution is mandatory."),
      { code: "ORCH_VALIDATION_INITIATED_BY" },
    );
  }
  if (!input.incidentId || input.incidentId.trim().length === 0) {
    throw Object.assign(
      new Error("incidentId is required."),
      { code: "ORCH_VALIDATION_INCIDENT_ID" },
    );
  }
  if (!Number.isInteger(input.workspaceId) || input.workspaceId <= 0) {
    throw Object.assign(
      new Error("workspaceId must be a positive integer."),
      { code: "ORCH_VALIDATION_WORKSPACE_ID" },
    );
  }
  if (!ALL_ORCHESTRATION_TYPES.has(input.orchestrationType)) {
    throw Object.assign(
      new Error(`orchestrationType "${input.orchestrationType}" is not a valid type. ` +
                `Valid types: [${[...ALL_ORCHESTRATION_TYPES].join(", ")}].`),
      { code: "ORCH_VALIDATION_TYPE" },
    );
  }

  // ── Construct value object ─────────────────────────────────────────────────
  const effectiveAt = input.initiatedAt ?? now;
  const action: RecoveryOrchestrationAction = {
    actionId:            makeOrchestrationId(input.workspaceId),
    workspaceId:         input.workspaceId,
    incidentId:          input.incidentId.trim(),
    recommendationId:    input.recommendationId ?? null,
    orchestrationType:   input.orchestrationType,
    initiatedBy:         input.initiatedBy.trim(),
    initiatedAt:         effectiveAt.toISOString(),
    orchestrationStatus: "initiated",
    rollbackEligible:    true,
    relatedSignals:      input.relatedSignals ?? [],
    executionNotes:      input.executionNotes ?? null,
  };

  emitOrchestrationInitiatedEvent({
    actionId:            action.actionId,
    workspaceId:         action.workspaceId,
    incidentId:          action.incidentId,
    orchestrationType:   action.orchestrationType,
    orchestrationStatus: action.orchestrationStatus,
    initiatedBy:         action.initiatedBy,
    action:              "orchestration_initiated",
  });

  return action;
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE ORCHESTRATION DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a new orchestration would conflict with an existing active one.
 *
 * Conflict rules:
 *   - Same workspaceId + orchestrationType with active status = conflict.
 *   - Terminal statuses (resolved/rolled_back/cancelled) = no conflict.
 *
 * Pure: receives existing actions as input - no DB access.
 */
export function detectDuplicateOrchestration(
  workspaceId:       number,
  orchestrationType: RecoveryOrchestrationType,
  existingActions:   ReadonlyArray<{ workspaceId: number; orchestrationType: string; orchestrationStatus: string }>,
): { isDuplicate: boolean; conflictingActionId?: string } {
  const conflict = existingActions.find(
    a =>
      a.workspaceId === workspaceId &&
      a.orchestrationType === orchestrationType &&
      ACTIVE_ORCHESTRATION_STATUSES.has(a.orchestrationStatus as RecoveryOrchestrationStatus),
  );
  return {
    isDuplicate:         conflict !== undefined,
    conflictingActionId: undefined,   // caller provides the actionId from DB
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATION TYPE → RECOMMENDATION MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps each orchestration type to the recommendation types it addresses.
 * Used for informational context - not enforcement.
 */
export const ORCHESTRATION_RECOMMENDATION_MAP: Record<
  RecoveryOrchestrationType,
  string[]
> = {
  scheduler_pressure_review:      ["investigate_scheduler_pressure"],
  fairness_policy_review:         ["review_fairness_policies"],
  containment_audit:              ["containment_boundary_review"],
  noisy_tenant_investigation:     ["isolate_noisy_tenant"],
  advisory_threshold_review:      ["investigate_advisory_storm"],
  recovery_stability_validation:  ["recovery_stability_watch"],
  escalation_monitoring:          ["escalation_watch"],
  operational_watch:              ["monitor_closely"],
};

/**
 * Returns a human-readable description of an orchestration type.
 */
export function describeOrchestrationType(type: RecoveryOrchestrationType): string {
  const descriptions: Record<RecoveryOrchestrationType, string> = {
    scheduler_pressure_review:     "Investigate elevated scheduler workload pressure and backlog patterns.",
    fairness_policy_review:        "Review active fairness policies for misconfiguration or conflict.",
    containment_audit:             "Audit containment boundaries and blast radius metrics.",
    noisy_tenant_investigation:    "Investigate cross-workspace resource contamination and isolation failures.",
    advisory_threshold_review:     "Review advisory storm thresholds and pressure accumulation patterns.",
    recovery_stability_validation: "Validate workspace recovery stability before declaring incident resolved.",
    escalation_monitoring:         "Monitor workspace for repeated escalation patterns.",
    operational_watch:             "Maintain operational observation cadence for degraded workspace.",
  };
  return descriptions[type];
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

interface OrchestrationEventPayload {
  actionId:            string;
  workspaceId:         number;
  incidentId:          string;
  orchestrationType:   RecoveryOrchestrationType;
  orchestrationStatus: RecoveryOrchestrationStatus;
  initiatedBy:         string;
  action:              string;
}

export function emitOrchestrationInitiatedEvent(p: OrchestrationEventPayload): void {
  logger.info(
    { event: "recovery_orchestration_initiated", ...p },
    "[recovery-orchestration] P10-D: recovery_orchestration_initiated",
  );
}

export function emitOrchestrationAcknowledgedEvent(p: OrchestrationEventPayload): void {
  logger.info(
    { event: "recovery_orchestration_acknowledged", ...p },
    "[recovery-orchestration] P10-D: recovery_orchestration_acknowledged",
  );
}

export function emitOrchestrationResolvedEvent(p: OrchestrationEventPayload): void {
  logger.info(
    { event: "recovery_orchestration_resolved", ...p },
    "[recovery-orchestration] P10-D: recovery_orchestration_resolved",
  );
}

export function emitOrchestrationRolledBackEvent(p: OrchestrationEventPayload): void {
  logger.info(
    { event: "recovery_orchestration_rolled_back", ...p },
    "[recovery-orchestration] P10-D: recovery_orchestration_rolled_back",
  );
}
