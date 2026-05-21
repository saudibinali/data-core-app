/**
 * @package @workspace/core-approvals
 * @purpose  Shared contracts for the multi-level approval system.
 *
 * Approval flows can be attached to tickets, HR requests, form submissions,
 * or any entity that requires human sign-off before proceeding.
 *
 * Ownership:  Platform Core — approval logic is owned here, not in individual modules.
 * Future:     Add multi-step sequential/parallel approval chains,
 *             delegation rules, and escalation policies.
 *
 * Note on primitives: ISOTimestamp, WorkspaceId, UserId are intentionally re-declared
 * here so this package remains independent. When core-approvals graduates from
 * placeholder to a real implementation package, these will be imported from
 * @workspace/core-events with proper project references declared.
 */

// ── Shared primitives (re-declared for package independence) ──────────────────

/** ISO-8601 timestamp string. */
export type ISOTimestamp = string;

/** Opaque workspace identifier. */
export type WorkspaceId = number;

/** Opaque user identifier. Undefined for system-generated actions. */
export type UserId = number | undefined;

// ── Approval status ───────────────────────────────────────────────────────────

/** Every approval request passes through these states exactly once. */
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

// ── Entity reference ──────────────────────────────────────────────────────────

/**
 * ApprovalEntityRef — points to the entity (ticket, form submission, HR request…)
 * that this approval is gating. Intentionally generic to stay module-agnostic.
 */
export interface ApprovalEntityRef {
  /** The entity type, e.g. "ticket", "hr.leave_request", "form_submission". */
  entityType: string;

  /** Primary key of the entity in its domain table. */
  entityId: number;

  /** Human-readable label for notification / audit copy. */
  entityLabel?: string;
}

// ── Approval context ──────────────────────────────────────────────────────────

/**
 * ApprovalContext — the full request that is handed to an approver.
 *
 * Future: extend with `stepIndex` for multi-step chains,
 *         `delegateTo` for out-of-office delegation.
 */
export interface ApprovalContext {
  id: number;
  workspaceId: WorkspaceId;
  entity: ApprovalEntityRef;

  /** User who must act on this approval. */
  assignedTo: UserId;

  /** User who created / requested the approval. */
  requestedBy: UserId;

  status: ApprovalStatus;

  /** Optional message shown to the approver. */
  requestNote?: string;

  /** Approver's response note (set on approve or reject). */
  responseNote?: string;

  createdAt: ISOTimestamp;
  resolvedAt?: ISOTimestamp;
}

// ── Decision record ───────────────────────────────────────────────────────────

/**
 * ApprovalDecision — the payload submitted when an approver acts.
 */
export interface ApprovalDecision {
  approvalId: number;
  decision: "approved" | "rejected";
  note?: string;
  decidedBy: UserId;
  decidedAt: ISOTimestamp;
}
