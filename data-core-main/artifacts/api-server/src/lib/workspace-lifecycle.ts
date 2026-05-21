/**
 * @file   lib/workspace-lifecycle.ts
 * @phase  P13-B - Workspace Lifecycle Management & Controlled State Transitions
 *
 * Pure state machine for workspace lifecycle. No DB, no HTTP - fully testable.
 *
 * SAFETY CONTRACT:
 *   - All functions are pure - no side effects, no DB writes, no mutations.
 *   - No delete, hard archive, HR mutation, billing, payment, or external notice logic.
 *   - All transitions are deterministic and validated before execution.
 *   - Invalid transitions, missing reason, or missing confirmation → rejected.
 *   - Reason minimum length enforced (REASON_MIN_LENGTH characters).
 *   - Actor must be super_admin - validated by validateLifecycleActorRole().
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type WorkspaceLifecycleState =
  | "pending_activation"
  | "active"
  | "suspended"
  | "locked"
  | "archived";

export type WorkspaceLifecycleAction =
  | "activate"
  | "suspend"
  | "restore"
  | "lock"
  | "archive";

export type LifecycleActionSeverity = "standard" | "warning" | "critical";

// ─────────────────────────────────────────────────────────────────────────────
// DB Status ↔ Lifecycle State Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps WorkspaceLifecycleState to the workspaces.status DB column value.
 * Used for write operations (UPDATE workspaces SET status = ...).
 */
export const LIFECYCLE_STATE_TO_DB_STATUS: Record<WorkspaceLifecycleState, string> = {
  pending_activation: "pending_activation",
  active:             "active",
  suspended:          "suspended",
  locked:             "locked",
  archived:           "disabled",
} as const;

/**
 * Derives the lifecycle state from the raw workspaces.status DB column value.
 * Used for read operations - never for write.
 */
export function deriveLifecycleState(workspaceStatus: string): WorkspaceLifecycleState {
  switch (workspaceStatus) {
    case "active":    return "active";
    case "suspended": return "suspended";
    case "locked":    return "locked";
    case "disabled":  return "archived";
    default:          return "pending_activation";
  }
}

/**
 * Returns the DB column value for a given lifecycle state.
 * Use for write operations only.
 */
export function lifecycleStateToDbStatus(state: WorkspaceLifecycleState): string {
  return LIFECYCLE_STATE_TO_DB_STATUS[state];
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Model
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkspaceLifecycleActionDef {
  label:                string;
  description:          string;
  allowedFrom:          WorkspaceLifecycleState[];
  targetState:          WorkspaceLifecycleState;
  severity:             LifecycleActionSeverity;
  requiresReason:       true;
  requiresConfirmation: true;
  isDestructive:        false;
  auditEventType:       string;
}

/**
 * Authoritative action model - defines all lifecycle transitions.
 *
 * Transition table:
 *   activate: pending_activation → active
 *   suspend:  active | locked | archived → suspended
 *   restore:  suspended | locked | archived → active
 *   lock:     active | suspended → locked
 *   archive:  active | suspended | locked → archived
 *
 * All actions:
 *   - requiresReason = true (minimum REASON_MIN_LENGTH characters)
 *   - requiresConfirmation = true (explicit boolean true)
 *   - isDestructive = false (no data deletion, soft archive only)
 */
export const LIFECYCLE_ACTION_MODEL: Record<WorkspaceLifecycleAction, WorkspaceLifecycleActionDef> = {
  activate: {
    label:                "Activate",
    description:          "Activate this workspace and make it fully operational.",
    allowedFrom:          ["pending_activation"],
    targetState:          "active",
    severity:             "standard",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    auditEventType:       "workspace_lifecycle_activated",
  },
  suspend: {
    label:                "Suspend",
    description:          "Suspend this workspace. Users will be unable to access it until restored.",
    allowedFrom:          ["active", "locked", "archived"],
    targetState:          "suspended",
    severity:             "warning",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    auditEventType:       "workspace_lifecycle_suspended",
  },
  restore: {
    label:                "Restore",
    description:          "Restore this workspace to active operational status.",
    allowedFrom:          ["suspended", "locked", "archived"],
    targetState:          "active",
    severity:             "standard",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    auditEventType:       "workspace_lifecycle_restored",
  },
  lock: {
    label:                "Lock",
    description:          "Lock this workspace pending administrative review. Access is restricted.",
    allowedFrom:          ["active", "suspended"],
    targetState:          "locked",
    severity:             "warning",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    auditEventType:       "workspace_lifecycle_locked",
  },
  archive: {
    label:                "Archive",
    description:          "Archive this workspace. Data is preserved but the workspace is no longer operational.",
    allowedFrom:          ["active", "suspended", "locked"],
    targetState:          "archived",
    severity:             "critical",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    auditEventType:       "workspace_lifecycle_archived",
  },
} as const;

/** All known lifecycle actions in declaration order. */
export const ALL_LIFECYCLE_ACTIONS: WorkspaceLifecycleAction[] = [
  "activate", "suspend", "restore", "lock", "archive",
];

// ─────────────────────────────────────────────────────────────────────────────
// Transition Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given action is allowed from the current lifecycle state.
 * This is the single source of truth for transition legality.
 */
export function isTransitionAllowed(
  currentState: WorkspaceLifecycleState,
  action:        WorkspaceLifecycleAction,
): boolean {
  return (LIFECYCLE_ACTION_MODEL[action].allowedFrom as readonly WorkspaceLifecycleState[]).includes(currentState);
}

/**
 * Returns all actions that are allowed from the given current lifecycle state.
 * Used to drive both backend validation and frontend UI rendering.
 */
export function getAllowedActionsFrom(
  currentState: WorkspaceLifecycleState,
): WorkspaceLifecycleAction[] {
  return ALL_LIFECYCLE_ACTIONS.filter(action =>
    isTransitionAllowed(currentState, action),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Validation
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum number of characters required in the transition reason field. */
export const REASON_MIN_LENGTH = 10;

export interface LifecycleRequest {
  action:        string;
  reason:        string;
  confirmation:  boolean;
  internalNote?: string;
}

export type LifecycleValidationResult =
  | { valid: false; error: string; code: string }
  | { valid: true;  action: WorkspaceLifecycleAction };

/**
 * Validates a lifecycle transition request.
 * Returns { valid: true, action } on success.
 * Returns { valid: false, error, code } on any validation failure.
 *
 * Validation order:
 *   1. Action must be a known action
 *   2. Reason must be non-empty and meet minimum length
 *   3. Confirmation must be explicitly true
 *   4. Transition must be allowed from current state
 */
export function validateLifecycleRequest(
  req:          LifecycleRequest,
  currentState: WorkspaceLifecycleState,
): LifecycleValidationResult {
  if (!ALL_LIFECYCLE_ACTIONS.includes(req.action as WorkspaceLifecycleAction)) {
    return {
      valid: false,
      error: `Unknown lifecycle action: "${req.action}"`,
      code:  "UNKNOWN_ACTION",
    };
  }

  const action = req.action as WorkspaceLifecycleAction;

  if (!req.reason || typeof req.reason !== "string" || req.reason.trim().length < REASON_MIN_LENGTH) {
    return {
      valid: false,
      error: `Reason is required and must be at least ${REASON_MIN_LENGTH} characters`,
      code:  "REASON_REQUIRED",
    };
  }

  if (req.confirmation !== true) {
    return {
      valid: false,
      error: "Confirmation is required to proceed with this lifecycle action",
      code:  "CONFIRMATION_REQUIRED",
    };
  }

  if (!isTransitionAllowed(currentState, action)) {
    return {
      valid: false,
      error: `Action "${action}" is not allowed from state "${currentState}"`,
      code:  "TRANSITION_NOT_ALLOWED",
    };
  }

  return { valid: true, action };
}

/**
 * Returns true if the given role is allowed to perform lifecycle transitions.
 * Only super_admin may initiate controlled workspace lifecycle changes.
 */
export function validateLifecycleActorRole(role: string | undefined): boolean {
  return role === "super_admin";
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Payload Builder
// ─────────────────────────────────────────────────────────────────────────────

export interface LifecycleAuditPayload {
  eventType:     string;
  tenantId:      string;
  workspaceId:   number;
  actorId:       number;
  action:        WorkspaceLifecycleAction;
  previousState: WorkspaceLifecycleState;
  targetState:   WorkspaceLifecycleState;
  reason:        string;
  internalNote:  string | null;
  occurredAt:    string;
}

/**
 * Builds a structured audit payload for a lifecycle transition event.
 * Pure function - no side effects, no DB writes.
 * The caller is responsible for persisting this payload.
 */
export function buildLifecycleAuditPayload(
  params: {
    tenantId:      string;
    workspaceId:   number;
    actorId:       number;
    action:        WorkspaceLifecycleAction;
    previousState: WorkspaceLifecycleState;
    targetState:   WorkspaceLifecycleState;
    reason:        string;
    internalNote:  string | null;
    now:           Date;
  },
): LifecycleAuditPayload {
  const def = LIFECYCLE_ACTION_MODEL[params.action];
  return {
    eventType:     def.auditEventType,
    tenantId:      params.tenantId,
    workspaceId:   params.workspaceId,
    actorId:       params.actorId,
    action:        params.action,
    previousState: params.previousState,
    targetState:   params.targetState,
    reason:        params.reason,
    internalNote:  params.internalNote,
    occurredAt:    params.now.toISOString(),
  };
}
