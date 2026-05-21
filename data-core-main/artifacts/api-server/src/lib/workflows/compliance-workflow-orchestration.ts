/**
 * @file   lib/workflows/compliance-workflow-orchestration.ts
 * @phase  P11-C - Compliance Workflow Orchestration & Human-Acknowledged Governance Resolution
 *
 * Deterministic append-only governance workflow orchestration engine.
 * HUMAN-GOVERNED: all state transitions require explicit human action.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 *
 *   Provides pure functions for creating and transitioning governance workflow
 *   actions that track the human-reviewed lifecycle of a GovernanceViolation.
 *
 *   initiateGovernanceWorkflow(input, now)
 *     → WorkflowInitiationResult      (new workflow or DUPLICATE error)
 *
 *   acknowledgeWorkflow(existing, acknowledgedBy, note, now)
 *     → WorkflowTransitionResult      (open → acknowledged)
 *
 *   escalateWorkflow(existing, escalatedBy, newLevel, reason, now)
 *     → WorkflowTransitionResult      (open/acknowledged/under_review → escalated)
 *
 *   resolveWorkflow(existing, resolvedBy, classification, note, now)
 *     → WorkflowTransitionResult      (any non-terminal → resolved | dismissed)
 *
 *   classifyEscalationLevel(severity)
 *     → GovernanceEscalationLevel     (violation severity → escalation tier)
 *
 *   buildWorkflowSummary(workflowActions, now)
 *     → GovernanceWorkflowSummary     (aggregate health stats)
 *
 * ── STATUS TRANSITION MAP ────────────────────────────────────────────────────
 *
 *   open          → acknowledged   via acknowledgeWorkflow()
 *   open          → escalated      via escalateWorkflow()   (bypass for critical)
 *   acknowledged  → escalated      via escalateWorkflow()
 *   acknowledged  → resolved       via resolveWorkflow()
 *   under_review  → escalated      via escalateWorkflow()
 *   under_review  → resolved       via resolveWorkflow()
 *   escalated     → resolved       via resolveWorkflow()
 *   open          → resolved       via resolveWorkflow()    (direct, with classification)
 *
 *   resolved  (terminal) - no further transitions
 *   dismissed (terminal) - no further transitions (dismiss = resolve with "false_positive"
 *                          or "operational_exception" classification + workflowStatus="dismissed")
 *
 * ── SAFETY INVARIANTS ────────────────────────────────────────────────────────
 *
 *   HUMAN-GOVERNED:  every transition requires an explicit human operatorId
 *   NO AUTO-RESOLVE: the engine never transitions a workflow without being called
 *   APPEND-ONLY:     the engine returns new-state objects; DB writes use UPDATE
 *                    on the single row (workflow lifecycle is one row per violation)
 *   FAIL-CLOSED:     invalid transitions return an error, never silently proceed
 *   DETERMINISTIC:   same inputs → same output state, every time
 *   NO ENFORCEMENT:  resolution does not trigger any downstream action
 */

import { logger } from "../logger";
import type { PolicySeverity } from "./governance-policy-intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// GOVERNANCE WORKFLOW TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type GovernanceWorkflowStatus =
  | "open"
  | "acknowledged"
  | "under_review"
  | "escalated"
  | "resolved"
  | "dismissed";

export type GovernanceEscalationLevel =
  | "informational"
  | "standard"
  | "elevated"
  | "critical";

export type ResolutionClassification =
  | "confirmed_violation"
  | "false_positive"
  | "operational_exception"
  | "policy_gap"
  | "unresolved_pending_review";

/** Terminal states - no further transitions allowed. */
const TERMINAL_STATUSES: ReadonlySet<GovernanceWorkflowStatus> = new Set([
  "resolved",
  "dismissed",
]);

/**
 * A governance workflow action tracks the human-reviewed lifecycle of one
 * GovernanceViolation from detection to resolution.
 */
export interface GovernanceWorkflowAction {
  workflowActionId:         string;   // "gwf:<policyId>:<violationId>-<createdAtMs>"
  violationId:              string;   // from GovernanceViolation.violationId
  policyId:                 string;   // from GovernanceViolation.policyId
  workspaceId:              number | null;
  assignedOperatorId:       string | null;
  initiatedBy:              string;   // operator who opened the workflow
  workflowStatus:           GovernanceWorkflowStatus;
  escalationLevel:          GovernanceEscalationLevel;
  resolutionClassification: ResolutionClassification | null;
  resolutionNote:           string | null;
  evidenceReferences:       string[];
  acknowledgedBy:           string | null;
  acknowledgedAt:           Date | null;
  escalatedBy:              string | null;
  escalatedAt:              Date | null;
  resolvedBy:               string | null;
  resolvedAt:               Date | null;
  createdAt:                Date;
  updatedAt:                Date;
}

/** Aggregate governance workflow health summary. */
export interface GovernanceWorkflowSummary {
  total:                  number;
  open:                   number;
  acknowledged:           number;
  underReview:            number;
  escalated:              number;
  resolved:               number;
  dismissed:              number;
  byEscalationLevel:      Record<GovernanceEscalationLevel, number>;
  byResolutionClass:      Partial<Record<ResolutionClassification, number>>;
  activeWorkflows:        number;  // total - (resolved + dismissed)
  criticalUnresolved:     number;  // escalationLevel="critical" AND not terminal
  evaluatedAt:            string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCALATION LEVEL COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a violation's policySeverity to an initial GovernanceEscalationLevel.
 * Deterministic: same severity always produces the same escalation level.
 */
export function classifyEscalationLevel(
  severity: PolicySeverity,
): GovernanceEscalationLevel {
  switch (severity) {
    case "critical": return "critical";
    case "high":     return "elevated";
    case "medium":   return "standard";
    case "low":      return "informational";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VALID TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if a transition from `current` to `next` is permitted.
 * Encodes the full transition graph.
 *
 * Pure: no side effects.
 */
export function isValidTransition(
  current: GovernanceWorkflowStatus,
  next:    GovernanceWorkflowStatus,
): boolean {
  if (TERMINAL_STATUSES.has(current)) return false;

  const allowed: Record<GovernanceWorkflowStatus, ReadonlySet<GovernanceWorkflowStatus>> = {
    open:         new Set(["acknowledged", "escalated", "resolved"]),
    acknowledged: new Set(["under_review", "escalated", "resolved"]),
    under_review: new Set(["escalated", "resolved"]),
    escalated:    new Set(["resolved"]),
    resolved:     new Set(),
    dismissed:    new Set(),
  };

  return allowed[current]?.has(next) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW INITIATION
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowInitiationInput {
  violationId:            string;
  policyId:               string;
  workspaceId:            number | null;
  initiatedBy:            string;           // operator ID
  assignedOperatorId?:    string | null;
  violationSeverity:      PolicySeverity;   // drives initial escalationLevel
  evidenceReferences?:    string[];
}

export type WorkflowInitiationError =
  | "DUPLICATE_ACTIVE_WORKFLOW"
  | "EMPTY_INITIATED_BY"
  | "EMPTY_VIOLATION_ID"
  | "EMPTY_POLICY_ID";

export interface WorkflowInitiationResult {
  workflow: GovernanceWorkflowAction | null;
  errors:   WorkflowInitiationError[];
}

/**
 * Creates the initial GovernanceWorkflowAction value object for a new violation workflow.
 *
 * DUPLICATE PREVENTION: callers must pass `existingActiveWorkflows` - a list of all
 * non-terminal workflows currently in the DB for this violationId. If any exist,
 * the function returns DUPLICATE_ACTIVE_WORKFLOW without creating a new record.
 *
 * Pure: no DB access. Returns a value object for the caller to INSERT.
 */
export function initiateGovernanceWorkflow(
  input:                   WorkflowInitiationInput,
  existingActiveWorkflows: ReadonlyArray<{ violationId: string; workflowStatus: GovernanceWorkflowStatus }>,
  now:                     Date = new Date(),
): WorkflowInitiationResult {
  const errors: WorkflowInitiationError[] = [];

  if (!input.violationId || input.violationId.trim() === "") {
    errors.push("EMPTY_VIOLATION_ID");
  }
  if (!input.policyId || input.policyId.trim() === "") {
    errors.push("EMPTY_POLICY_ID");
  }
  if (!input.initiatedBy || input.initiatedBy.trim() === "") {
    errors.push("EMPTY_INITIATED_BY");
  }

  if (errors.length > 0) return { workflow: null, errors };

  // Duplicate check: reject if any non-terminal workflow exists for this violationId
  const hasDuplicate = existingActiveWorkflows.some(
    w =>
      w.violationId === input.violationId &&
      !TERMINAL_STATUSES.has(w.workflowStatus),
  );
  if (hasDuplicate) {
    return { workflow: null, errors: ["DUPLICATE_ACTIVE_WORKFLOW"] };
  }

  const escalationLevel = classifyEscalationLevel(input.violationSeverity);

  const workflow: GovernanceWorkflowAction = {
    workflowActionId:         `gwf:${input.policyId}:${input.violationId}-${now.getTime()}`,
    violationId:              input.violationId,
    policyId:                 input.policyId,
    workspaceId:              input.workspaceId,
    assignedOperatorId:       input.assignedOperatorId ?? null,
    initiatedBy:              input.initiatedBy,
    workflowStatus:           "open",
    escalationLevel,
    resolutionClassification: null,
    resolutionNote:           null,
    evidenceReferences:       [...(input.evidenceReferences ?? [])],
    acknowledgedBy:           null,
    acknowledgedAt:           null,
    escalatedBy:              null,
    escalatedAt:              null,
    resolvedBy:               null,
    resolvedAt:               null,
    createdAt:                now,
    updatedAt:                now,
  };

  return { workflow, errors: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

export type WorkflowTransitionError =
  | "INVALID_TRANSITION"
  | "TERMINAL_STATE"
  | "EMPTY_OPERATOR"
  | "RESOLUTION_REQUIRES_CLASSIFICATION"
  | "INVALID_RESOLUTION_CLASSIFICATION"
  | "INVALID_ESCALATION_LEVEL";

export interface WorkflowTransitionResult {
  updated: GovernanceWorkflowAction | null;
  errors:  WorkflowTransitionError[];
}

/**
 * Acknowledges an open governance workflow.
 * Transition: open → acknowledged
 *
 * Acknowledgment records the operator who confirmed the violation is being
 * investigated. Moves workflowStatus to "acknowledged".
 *
 * Pure: returns updated value object. Caller writes to DB.
 */
export function acknowledgeWorkflow(
  existing:      GovernanceWorkflowAction,
  acknowledgedBy: string,
  note:          string | null,
  now:           Date = new Date(),
): WorkflowTransitionResult {
  if (!acknowledgedBy || acknowledgedBy.trim() === "") {
    return { updated: null, errors: ["EMPTY_OPERATOR"] };
  }
  if (!isValidTransition(existing.workflowStatus, "acknowledged")) {
    if (TERMINAL_STATUSES.has(existing.workflowStatus)) {
      return { updated: null, errors: ["TERMINAL_STATE"] };
    }
    return { updated: null, errors: ["INVALID_TRANSITION"] };
  }

  const updated: GovernanceWorkflowAction = {
    ...existing,
    workflowStatus:  "acknowledged",
    acknowledgedBy,
    acknowledgedAt:  now,
    resolutionNote:  note ?? existing.resolutionNote,
    updatedAt:       now,
  };

  return { updated, errors: [] };
}

/**
 * Escalates a governance workflow to a higher urgency level.
 * Allowed from: open, acknowledged, under_review
 * Target status: escalated
 *
 * The new escalation level must be ≥ the current level in the severity order.
 * Fail-closed: if the requested level is lower than current, reject.
 *
 * Pure: returns updated value object. Caller writes to DB.
 */
export function escalateWorkflow(
  existing:        GovernanceWorkflowAction,
  escalatedBy:     string,
  newLevel:        GovernanceEscalationLevel,
  reason:          string | null,
  now:             Date = new Date(),
): WorkflowTransitionResult {
  if (!escalatedBy || escalatedBy.trim() === "") {
    return { updated: null, errors: ["EMPTY_OPERATOR"] };
  }
  if (!isValidTransition(existing.workflowStatus, "escalated")) {
    if (TERMINAL_STATUSES.has(existing.workflowStatus)) {
      return { updated: null, errors: ["TERMINAL_STATE"] };
    }
    return { updated: null, errors: ["INVALID_TRANSITION"] };
  }

  const LEVEL_ORDER: Record<GovernanceEscalationLevel, number> = {
    informational: 0,
    standard:      1,
    elevated:      2,
    critical:      3,
  };

  if (LEVEL_ORDER[newLevel] < LEVEL_ORDER[existing.escalationLevel]) {
    return { updated: null, errors: ["INVALID_ESCALATION_LEVEL"] };
  }

  const updated: GovernanceWorkflowAction = {
    ...existing,
    workflowStatus:  "escalated",
    escalationLevel: newLevel,
    escalatedBy,
    escalatedAt:     now,
    resolutionNote:  reason ?? existing.resolutionNote,
    updatedAt:       now,
  };

  return { updated, errors: [] };
}

const VALID_RESOLUTION_CLASSIFICATIONS: ReadonlySet<ResolutionClassification> = new Set([
  "confirmed_violation",
  "false_positive",
  "operational_exception",
  "policy_gap",
  "unresolved_pending_review",
]);

/**
 * Resolves (or dismisses) a governance workflow.
 * Allowed from: any non-terminal state.
 * Target status: resolved | dismissed
 *
 * dismissed = workflowStatus is "dismissed"
 *   → triggered when resolutionClassification is "false_positive" or
 *     "operational_exception" AND caller sets dismissed=true.
 *
 * Resolution requires:
 *   - resolvedBy (non-empty operator ID)
 *   - resolutionClassification (one of the 5 valid values)
 *
 * Pure: returns updated value object. Caller writes to DB.
 */
export function resolveWorkflow(
  existing:                GovernanceWorkflowAction,
  resolvedBy:              string,
  resolutionClassification: ResolutionClassification,
  note:                    string | null,
  dismiss:                 boolean = false,
  now:                     Date = new Date(),
): WorkflowTransitionResult {
  if (!resolvedBy || resolvedBy.trim() === "") {
    return { updated: null, errors: ["EMPTY_OPERATOR"] };
  }
  if (!resolutionClassification) {
    return { updated: null, errors: ["RESOLUTION_REQUIRES_CLASSIFICATION"] };
  }
  if (!VALID_RESOLUTION_CLASSIFICATIONS.has(resolutionClassification)) {
    return { updated: null, errors: ["INVALID_RESOLUTION_CLASSIFICATION"] };
  }
  if (!isValidTransition(existing.workflowStatus, "resolved")) {
    if (TERMINAL_STATUSES.has(existing.workflowStatus)) {
      return { updated: null, errors: ["TERMINAL_STATE"] };
    }
    return { updated: null, errors: ["INVALID_TRANSITION"] };
  }

  const targetStatus: GovernanceWorkflowStatus = dismiss ? "dismissed" : "resolved";

  const updated: GovernanceWorkflowAction = {
    ...existing,
    workflowStatus:           targetStatus,
    resolutionClassification,
    resolutionNote:           note ?? existing.resolutionNote,
    resolvedBy,
    resolvedAt:               now,
    updatedAt:                now,
  };

  return { updated, errors: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds an aggregate governance workflow health summary.
 * Pure: no DB, no async, no side effects.
 */
export function buildWorkflowSummary(
  workflowActions: ReadonlyArray<GovernanceWorkflowAction>,
  now:             Date = new Date(),
): GovernanceWorkflowSummary {
  const byLevel: Record<GovernanceEscalationLevel, number> = {
    informational: 0,
    standard:      0,
    elevated:      0,
    critical:      0,
  };
  const byResClass: Partial<Record<ResolutionClassification, number>> = {};

  let open = 0, acknowledged = 0, underReview = 0, escalated = 0, resolved = 0, dismissed = 0;
  let criticalUnresolved = 0;

  for (const w of workflowActions) {
    switch (w.workflowStatus) {
      case "open":          open++;          break;
      case "acknowledged":  acknowledged++;  break;
      case "under_review":  underReview++;   break;
      case "escalated":     escalated++;     break;
      case "resolved":      resolved++;      break;
      case "dismissed":     dismissed++;     break;
    }

    byLevel[w.escalationLevel]++;

    if (w.resolutionClassification) {
      byResClass[w.resolutionClassification] =
        (byResClass[w.resolutionClassification] ?? 0) + 1;
    }

    if (
      w.escalationLevel === "critical" &&
      !TERMINAL_STATUSES.has(w.workflowStatus)
    ) {
      criticalUnresolved++;
    }
  }

  const activeWorkflows = workflowActions.length - resolved - dismissed;

  return {
    total:             workflowActions.length,
    open,
    acknowledged,
    underReview,
    escalated,
    resolved,
    dismissed,
    byEscalationLevel: byLevel,
    byResolutionClass: byResClass,
    activeWorkflows,
    criticalUnresolved,
    evaluatedAt:       now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABILITY EVENTS
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowEventPayload {
  workflowActionId: string;
  violationId:      string;
  policyId:         string;
  escalationLevel:  string;
  workflowStatus:   string;
  action:           string;
}

export function emitGovernanceWorkflowInitiatedEvent(p: WorkflowEventPayload): void {
  logger.info(
    { event: "governance_workflow_initiated", ...p },
    "[compliance-workflow] P11-C: governance_workflow_initiated",
  );
}

export function emitGovernanceWorkflowAcknowledgedEvent(p: WorkflowEventPayload): void {
  logger.info(
    { event: "governance_workflow_acknowledged", ...p },
    "[compliance-workflow] P11-C: governance_workflow_acknowledged",
  );
}

export function emitGovernanceWorkflowEscalatedEvent(p: WorkflowEventPayload): void {
  logger.warn(
    { event: "governance_workflow_escalated", ...p },
    "[compliance-workflow] P11-C: governance_workflow_escalated - ESCALATION REQUIRED",
  );
}

export function emitGovernanceWorkflowResolvedEvent(p: WorkflowEventPayload): void {
  logger.info(
    { event: "governance_workflow_resolved", ...p },
    "[compliance-workflow] P11-C: governance_workflow_resolved",
  );
}
