/**
 * @package     @workspace/core-events
 * @file        events.ts
 * @purpose     Typed event payload interfaces and concrete TypedEvent aliases
 *              for all well-known platform domain events.
 *
 * ── Naming convention ────────────────────────────────────────────────────────
 * Short form:  entity.action   (2-level, dot-separated)
 *              entity.sub_action  for compound actions (snake_case, NOT 3 levels)
 *
 * ── Ownership ─────────────────────────────────────────────────────────────────
 * Each event section is annotated with which api-server module is responsible
 * for publishing it.  Only that module should call appEventBus.emit() with that
 * event type.
 *
 * ── What lives here ──────────────────────────────────────────────────────────
 *   • Payload interfaces  (TicketCreatedPayload, etc.)
 *   • TypedEvent aliases  (TicketCreatedEvent = TypedEvent<"ticket.created", ...>)
 *
 * ── What does NOT live here ──────────────────────────────────────────────────
 *   • Event dispatch logic
 *   • Event listeners
 *   • Database access
 *   • Business rules
 *
 * ── Canonical domain events only ─────────────────────────────────────────────
 *   This file defines BUSINESS DOMAIN EVENTS — facts about things that happened
 *   in the business domain that external observers (workflows, audit, analytics)
 *   care about.
 *
 *   Infrastructure events (e.g. "a notification row was inserted") and meta
 *   events (e.g. "a workflow automation ran") do NOT belong here.  They are
 *   implementation details, not domain facts.
 *
 * ── Removed Events (Stabilization) ───────────────────────────────────────────
 *   notification.created — REMOVED.
 *     Rationale: This is an infrastructure side-effect, not a domain event.
 *     The existing SSE push (emitToUser inside insertNotification) already
 *     handles real-time delivery without a secondary event cascade.
 *     Re-introduce only if a WebSocket push system requires it, and wire it
 *     directly into the notification insertion service (not the domain bus).
 *
 *   workflow.executed — REMOVED.
 *     Rationale: This is a meta/self-referential event.  The WorkflowEngine is
 *     triggered by the bridge → eventDispatcher.  If workflow.executed were
 *     emitted on appEventBus, the bridge would forward it back to eventDispatcher,
 *     causing the WorkflowEngine to trigger on workflow.executed — infinite loop.
 *     Cycle detection is not implemented.  Re-introduce when cycle detection
 *     exists and there is a concrete external subscription use case.
 */

import type { TypedEvent } from "./types";

// ═══════════════════════════════════════════════════════════════════════════════
// TICKETS MODULE
// Publisher: artifacts/api-server/src/routes/tickets.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ticket.created — A new ticket has been opened.
 */
export interface TicketCreatedPayload {
  ticketId: number;
  title: string;
  /** "bug" | "feature" | "support" | "task" | "other" */
  ticketType: string;
  /** "low" | "medium" | "high" | "urgent" */
  priority: string;
  /** "open" | "in_progress" | "pending" | "resolved" | "closed" */
  status: string;
  createdByUserId: number;
  assigneeId?: number | null;
  departmentId?: number | null;
  category?: string | null;
}

export type TicketCreatedEvent = TypedEvent<"ticket.created", TicketCreatedPayload>;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * ticket.updated — One or more non-status fields on a ticket changed.
 *
 * ── Semantic boundary (canonical, as of Stabilization) ───────────────────────
 *   ticket.updated covers:  title, priority, assignee, department, description,
 *                           category, and any other editable fields.
 *
 *   The `changes` map MAY include the status key when a status change happens
 *   alongside other edits (Rule 2 of the dual-emit policy below).  In that case
 *   both ticket.updated AND ticket.status_changed are emitted.  Listeners that
 *   only care about status must subscribe to ticket.status_changed directly and
 *   must NOT branch on changes.status inside a ticket.updated listener.
 *
 * ── Canonical dual-emit policy (tickets.ts PATCH) ────────────────────────────
 *   Rule 1 — Status changed, no other fields changed:
 *     Emit ticket.status_changed ONLY.  Do NOT emit ticket.updated.
 *
 *   Rule 2 — Status changed AND other fields changed in the same request:
 *     Emit BOTH ticket.updated (full changes map) AND ticket.status_changed.
 *
 *   Rule 3 — Other fields changed, status unchanged:
 *     Emit ticket.updated ONLY.
 *
 *   Rule 4 — Nothing changed (empty diff):
 *     Emit nothing.
 */
export interface TicketUpdatedPayload {
  ticketId: number;
  /** Map of changed field names to their new values. */
  changes: Record<string, unknown>;
  updatedByUserId: number;
  /** Snapshot of fields BEFORE the update — useful for audit diff. */
  previousValues?: Record<string, unknown>;
}

export type TicketUpdatedEvent = TypedEvent<"ticket.updated", TicketUpdatedPayload>;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * ticket.status_changed — The status of a ticket moved from one value to another.
 *
 * ── When to emit ──────────────────────────────────────────────────────────────
 *   Emit whenever the status transitions, regardless of whether other fields also
 *   changed.  See the dual-emit policy on TicketUpdatedPayload for the complete
 *   emission rules.
 *
 * ── Status transitions ────────────────────────────────────────────────────────
 *   open → in_progress → pending → resolved → closed (any direction)
 *   Terminal states for "notify creator" logic: "closed", "resolved".
 *
 * ── Payload enrichment (added in Stabilization) ───────────────────────────────
 *   `title` and `createdByUserId` are included so notification listeners can
 *   construct messages without an extra DB round-trip.  The emitter (tickets.ts)
 *   already has both values from the pre-update DB fetch and the returning() call.
 *
 * ── Listener responsibilities ─────────────────────────────────────────────────
 *   activity.ts:          → write action = "status_changed" to activity_logs
 *   notifications-bus.ts: → notify ticket creator on terminal status (closed/resolved)
 *   bridge (wildcard):    → forward to eventDispatcher → workspace_event_logs + WorkflowEngine
 */
export interface TicketStatusChangedPayload {
  ticketId: number;
  /** Previous status value. */
  fromStatus: string;
  /** New status value. */
  toStatus: string;
  changedByUserId: number;
  /**
   * Current ticket title at the time of the status change.
   * Included to avoid a DB query in notification listeners.
   * Use ticket.title (post-update value from .returning()).
   */
  title: string;
  /**
   * User ID of the original ticket creator.
   * Included to avoid a DB query in the "notify creator on close" listener.
   * Use oldTicket.createdByUserId (pre-update fetch — unchanged by PATCH).
   */
  createdByUserId: number;
  /** Optional note or reason for the status change. */
  comment?: string;
}

export type TicketStatusChangedEvent = TypedEvent<
  "ticket.status_changed",
  TicketStatusChangedPayload
>;

// ═══════════════════════════════════════════════════════════════════════════════
// FORMS MODULE
// Publisher: artifacts/api-server/src/routes/forms.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * form.submitted — A user submitted a form response.
 *
 * CANONICAL name — existing registry uses legacy "forms.form.submitted".
 * The `formId` + `submissionId` pair uniquely identifies the submission.
 * `answers` is Record<string, unknown> because form schemas are dynamic.
 *
 * ── Event ownership boundary ──────────────────────────────────────────────────
 * This event is the ONLY event type that forms.ts should ever emit on the bus.
 *
 * It is intentionally GENERIC — it represents "a user submitted a form",
 * not "a leave request was made" or "an approval was requested".
 *
 * Do NOT make forms.ts emit domain-typed events such as:
 *   ✗  leave.requested    — requires a structured leave_requests DB record
 *   ✗  approval.created   — requires a structured approvals DB record + approver
 *   ✗  hr.{slug}.submitted — dynamic, no typed payload contract possible
 *
 * Domain events have TYPED payloads that differ fundamentally from this
 * payload.  Emitting them with generic form data (snake_case field names,
 * unvalidated, uncomputed values) is a silent contract violation — TypeScript
 * will not catch it because eventDispatcher.dispatch() accepts any data.
 *
 * Domain events (leave.requested, approval.created, etc.) must come from
 * their DEDICATED domain routes that validate, compute, and persist the
 * structured data before emitting.
 *
 * ── workflowEventHint ─────────────────────────────────────────────────────────
 * `workflowEventHint` carries the value of formDefinitionsTable.workflowEvent
 * (a free-text string set by workspace admins or seed data, e.g. "hr.form.submitted",
 * "leave.form.submitted", "hr.annual-leave.submitted").
 *
 * It is NOT a bus event type.  It is metadata for the WorkflowEngine:
 *   • The WorkflowEngine (engine.ts) currently matches on payload.event exactly.
 *     When workflowEventHint support is added, the engine will match on this
 *     field as a SECONDARY key — enabling per-form workflow triggers without
 *     polluting EventTypeMap with dynamic event names.
 *   • Bus listeners (activity.ts, notifications-bus.ts) should use `owningModule`
 *     and `answers` for any form-specific logic — NOT workflowEventHint.
 *   • Value origin: formDefinitionsTable.workflowEvent column (set at form creation).
 *     For HR service forms: e.g. "hr.annual-leave.submitted" (admin-created slug).
 *     For generic forms: e.g. "hr.form.submitted", "system.form.submitted".
 *     For forms with no config: null (this field will be omitted).
 *
 * ── What workflowEventHint is NOT ────────────────────────────────────────────
 * It must NEVER contain a domain event name (leave.requested, approval.created)
 * because that would conflate "the workflow trigger string" with "a domain event",
 * creating the same contract violation that the pre-migration stabilization fixes.
 */
export interface FormSubmittedPayload {
  submissionId: number;
  formId: number;
  formName: string;
  /** Which module owns this form, e.g. "hr", "system", "approvals". */
  owningModule: string;
  submittedByUserId: number;
  departmentId?: number | null;
  /** Key-value map of field names to submitted values. */
  answers: Record<string, unknown>;
  /**
   * Optional WorkflowEngine trigger hint — carries formDefinitionsTable.workflowEvent.
   *
   * This is a WORKFLOW ROUTING HINT, not a bus event type.  The WorkflowEngine
   * uses it to match workflow_definitions.trigger_event when a form-specific
   * workflow is configured (e.g. "hr.annual-leave.submitted").
   *
   * NEVER put domain event names here (leave.requested, approval.created).
   * Those are separate domain events owned by dedicated domain routes.
   *
   * Omit (leave undefined) if formDefinitionsTable.workflowEvent is null.
   */
  workflowEventHint?: string;
}

export type FormSubmittedEvent = TypedEvent<"form.submitted", FormSubmittedPayload>;

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVALS MODULE
// Publisher: artifacts/api-server/src/routes/approvals.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * approval.created — An approval request has been created and is awaiting action.
 *
 * CANONICAL name — legacy code uses "approval.requested".
 * The LEGACY_EVENT_NAMES map in constants.ts records this rename.
 *
 * ── Workflow template compatibility ───────────────────────────────────────────
 *   Any workflow_definitions row with trigger_event = "approval.requested" will
 *   NOT fire because the bridge now dispatches "approval.created".
 *   Run: pnpm --filter @workspace/scripts run check-workflow-triggers
 *   If rows found, migrate:
 *     UPDATE workflow_definitions
 *     SET trigger_event = 'approval.created'
 *     WHERE trigger_event = 'approval.requested';
 *
 * `entityType` + `entityId` are generic — approvals work for tickets, HR requests,
 * form submissions, and future entity types.
 */
export interface ApprovalCreatedPayload {
  approvalId: number;
  /** e.g. "ticket", "hr.leave_request", "form_submission" */
  entityType: string;
  entityId: number;
  entityLabel?: string;
  requestedByUserId: number;
  assignedToUserId: number;
  /** Reason or context message for the approver. */
  requestNote?: string;
  departmentId?: number | null;
}

export type ApprovalCreatedEvent = TypedEvent<"approval.created", ApprovalCreatedPayload>;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * approval.completed — An approval request has reached a terminal state
 * (approved OR rejected).
 *
 * CANONICAL unified concept — legacy code uses two separate events:
 *   "approval.approved"  (outcome = "approved")
 *   "approval.rejected"  (outcome = "rejected")
 *
 * ── Workflow template compatibility ───────────────────────────────────────────
 *   Workflow definitions with trigger_event IN ('approval.approved','approval.rejected')
 *   will not fire.  Run check-workflow-triggers script and migrate:
 *     UPDATE workflow_definitions
 *     SET trigger_event = 'approval.completed'
 *     WHERE trigger_event IN ('approval.approved', 'approval.rejected');
 */
export interface ApprovalCompletedPayload {
  approvalId: number;
  entityType: string;
  entityId: number;
  entityLabel?: string;
  /** "approved" | "rejected" */
  outcome: "approved" | "rejected";
  decidedByUserId: number;
  requestedByUserId: number;
  responseNote?: string;
  /** Duration from request to decision, in milliseconds. */
  resolutionTimeMs?: number;
}

export type ApprovalCompletedEvent = TypedEvent<"approval.completed", ApprovalCompletedPayload>;

// ═══════════════════════════════════════════════════════════════════════════════
// HR MODULE — LEAVE DOMAIN
//
// Publisher: artifacts/api-server/src/routes/leave.ts  (Phase 1, not yet built)
//            Until then: NO current publisher for most events.
//            leave.requested is referenced in registry.ts but has no emitter yet.
//
// ── Leave domain vs. forms module boundary ────────────────────────────────────
//   The forms module emits ONLY form.submitted (generic).
//   Leave-specific domain events (leave.requested, leave.approved, etc.) must
//   come from the dedicated leave route (/hr/leave-requests, Phase 1).
//   A leave request submitted via a form should trigger:
//     forms.ts  → form.submitted (generic, workflowEventHint: "hr.form.submitted")
//     leave.ts  → leave.requested (domain, with structured leave_requests record)
//   These are two separate events serving different concerns.
//
// ── Why leave domain owns its approval lifecycle ──────────────────────────────
//   The generic approvalsTable is coupled to ticketId NOT NULL — it cannot hold
//   leave approval records without a schema migration that would break the
//   approvals module.  Leave approvals have domain-specific state: multi-step
//   chains, SLA per step, balance enforcement, attendance side effects.
//   The approvals module is intentionally excluded from the leave lifecycle.
//   Dedicated leave_approval_steps table handles the chain (Phase 1).
//
// ── Leave lifecycle summary ───────────────────────────────────────────────────
//   draft → pending → pending_approval → approved / rejected
//   pending_approval → cancelled (by HR/admin)
//   pending → withdrawn (by employee)
//   approved → cancelled (before start date)
//   Each state transition emits the corresponding event below.
//
// ── Synchronous vs. async responsibility ─────────────────────────────────────
//   SYNCHRONOUS (in route handler, before HTTP response):
//     balance check, conflict check, policy eligibility,
//     businessDaysCount calculation, leave_requests INSERT,
//     hrLeaveBalancesTable.pending += daysRequested
//   ASYNCHRONOUS (via appEventBus listeners):
//     activity logs, notifications, attendance records, calendar events
//
// ── Registry ──────────────────────────────────────────────────────────────────
//   All leave events are registered in registry.ts under module "hr".
//   BUG-001 (resolved in Cleanup Sprint): the duplicate "forms" registration
//   of "leave.requested" was removed. Canonical owner is module "hr".
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * leave.requested — An employee submitted a leave request.
 *
 * Emitted when: a leave_requests record is created with status "pending" or
 * "pending_approval".  Fired after balance reservation is written synchronously.
 *
 * NAMING NOTE: "requested" is passive-voice, unlike most of the catalog
 * (created, updated, submitted, completed).  This is preserved intentionally
 * to match the existing EVENTS.LEAVE_REQUESTED constant and the registry entry.
 * When the full leave lifecycle is implemented, standardise the namespace in
 * one migration ticket (leave.requested → leave.submitted or keep as-is).
 *
 * Consumers:
 *   activity.ts         — "leave_requested" activity log entry
 *   notifications-bus.ts — notify the first approver in the chain
 *   WorkflowEngine       — trigger any configured leave workflows
 */
export interface LeaveRequestedPayload {
  /** FK to leave_requests.id (Phase 1 table). */
  leaveRequestId: number;
  employeeUserId: number;
  /** "annual" | "sick" | "unpaid" | "maternity" | "emergency" | "other" */
  leaveType: string;
  /** ISO date string, e.g. "2026-06-01". */
  startDate: string;
  /** ISO date string, e.g. "2026-06-10". */
  endDate: string;
  /** Business days count (excluding weekends + public holidays). */
  daysRequested: number;
  departmentId?: number | null;
  employeeNote?: string;
  /** FK to hr_leave_policies.id — null if policy not resolved at request time. */
  leavePolicyId?: number | null;
  /** True when the policy requires manager/HR approval (from hrLeavePoliciesTable). */
  requiresApproval: boolean;
}

export type LeaveRequestedEvent = TypedEvent<"leave.requested", LeaveRequestedPayload>;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * leave.approved — A leave request reached the final "approved" state.
 *
 * Emitted when: the last approval step is completed (or auto-approved when
 * requiresApproval = false).
 *
 * This event triggers the core side-effect chain:
 *   • hrLeaveBalancesTable: pending -= days, used += days
 *   • hrEmployeeLeavesTable: write approved record
 *   • hr_attendance: write "on_leave" records for each leave day
 *   • Calendar: optionally create a calendar block for the leave period
 *
 * Consumers:
 *   activity.ts         — "leave_approved" activity log entry
 *   notifications-bus.ts — notify the employee of the decision
 *   Leave balance listener — update balances atomically
 *   Attendance listener   — write attendance rows (async, after commit)
 */
export interface LeaveApprovedPayload {
  leaveRequestId: number;
  employeeUserId: number;
  /** "annual" | "sick" | "unpaid" | "maternity" | "emergency" | "other" */
  leaveType: string;
  startDate: string;
  endDate: string;
  /** Approved business days (stored at request creation; not recomputed). */
  daysApproved: number;
  /** The user who gave the final approval decision. */
  approvedByUserId: number;
  leavePolicyId?: number | null;
  departmentId?: number | null;
}

export type LeaveApprovedEvent = TypedEvent<"leave.approved", LeaveApprovedPayload>;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * leave.rejected — A leave request was rejected by an approver.
 *
 * Emitted when: any approver in the chain rejects the request.
 * The balance reservation (pending) is released synchronously before emit.
 *
 * Consumers:
 *   activity.ts         — "leave_rejected" activity log entry
 *   notifications-bus.ts — notify the employee of the rejection
 */
export interface LeaveRejectedPayload {
  leaveRequestId: number;
  employeeUserId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  /** The approver who rejected the request. */
  rejectedByUserId: number;
  /** Optional note from the rejecting approver. */
  rejectionReason?: string;
  departmentId?: number | null;
}

export type LeaveRejectedEvent = TypedEvent<"leave.rejected", LeaveRejectedPayload>;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * leave.cancelled — An approved or pending leave request was cancelled by HR/admin.
 *
 * Emitted when: an HR manager or admin cancels a leave that was already
 * approved or still pending approval.  This is an admin-side action; for
 * employee self-cancellation of a pending request, see leave.withdrawn.
 *
 * If wasApproved = true AND the leave hasn't started yet, balances are restored.
 * Future attendance records for this leave are voided.
 *
 * Consumers:
 *   activity.ts         — "leave_cancelled" activity log entry
 *   notifications-bus.ts — notify the employee of the cancellation
 *   Balance listener     — conditional balance restore (when wasApproved)
 *   Attendance listener  — void future attendance records (when wasApproved)
 */
export interface LeaveCancelledPayload {
  leaveRequestId: number;
  employeeUserId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  cancelledByUserId: number;
  /**
   * True if the leave had already been approved before cancellation.
   * Determines whether balance restoration and attendance voiding are needed.
   */
  wasApproved: boolean;
  departmentId?: number | null;
}

export type LeaveCancelledEvent = TypedEvent<"leave.cancelled", LeaveCancelledPayload>;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * leave.withdrawn — An employee withdrew their own pending leave request.
 *
 * Emitted when: the employee self-cancels a request that is still pending
 * or pending_approval (before any approval decision).
 * The pending balance reservation is released synchronously before emit.
 *
 * Distinct from leave.cancelled (which is an admin action on any status).
 *
 * Consumers:
 *   activity.ts         — "leave_withdrawn" activity log entry
 *   Balance listener     — restore pending balance reservation
 */
export interface LeaveWithdrawnPayload {
  leaveRequestId: number;
  employeeUserId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  departmentId?: number | null;
}

export type LeaveWithdrawnEvent = TypedEvent<"leave.withdrawn", LeaveWithdrawnPayload>;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * leave.balance_adjusted — An HR manager manually adjusted a leave balance.
 *
 * Emitted when: HR updates hrLeaveBalancesTable.manualAdjustment for an
 * employee (e.g. carry-over correction, policy change, exceptional grant).
 *
 * adjustmentDays is signed: positive = grant, negative = deduction.
 *
 * Consumers:
 *   activity.ts         — "leave_balance_adjusted" activity log entry
 *   notifications-bus.ts — optionally notify the employee (product decision)
 */
export interface LeaveBalanceAdjustedPayload {
  /** FK to hr_leave_balances.id (the adjusted row). */
  leaveBalanceId: number;
  /** FK to employees.id. */
  employeeId: number;
  employeeUserId: number;
  /** "annual" | "sick" | "unpaid" | etc. */
  leaveType: string;
  year: number;
  /** Signed adjustment in days: positive = grant additional days, negative = deduct. */
  adjustmentDays: number;
  /** Human-readable reason for the adjustment (required for audit trail). */
  reason: string;
  adjustedByUserId: number;
  leavePolicyId?: number | null;
}

export type LeaveBalanceAdjustedEvent = TypedEvent<"leave.balance_adjusted", LeaveBalanceAdjustedPayload>;

// ═══════════════════════════════════════════════════════════════════════════════
// HR MODULE — WORKFORCE ATTENDANCE (P20-B)
// Publisher: artifacts/api-server/src/lib/workforce-attendance/pipeline.ts
// ═══════════════════════════════════════════════════════════════════════════════

export interface AttendanceRawReceivedPayload {
  rawEventId: number;
  employeeId: number;
  sourceCode: string;
  duplicate: boolean;
}

export type AttendanceRawReceivedEvent = TypedEvent<
  "attendance.raw.received",
  AttendanceRawReceivedPayload
>;

export interface AttendanceEventNormalizedPayload {
  rawEventId: number;
  eventId: number;
  employeeId: number;
}

export type AttendanceEventNormalizedEvent = TypedEvent<
  "attendance.event.normalized",
  AttendanceEventNormalizedPayload
>;

export interface AttendanceDayCalculatedPayload {
  employeeId: number;
  localDate: string;
  summaryId: number;
  legacyAttendanceId: number;
  status: string;
}

export type AttendanceDayCalculatedEvent = TypedEvent<
  "attendance.day.calculated",
  AttendanceDayCalculatedPayload
>;

// ═══════════════════════════════════════════════════════════════════════════════
// HR MODULE — WORKFORCE INTEGRATION (P20-E)
// ═══════════════════════════════════════════════════════════════════════════════

export interface AttendanceSyncFailedPayload {
  integrationId: number;
  name: string;
  connectorKey: string;
  error: string;
}

export type AttendanceSyncFailedEvent = TypedEvent<
  "attendance.sync.failed",
  AttendanceSyncFailedPayload
>;

export interface AttendanceSyncCompletedPayload {
  integrationId: number;
  name: string;
  ingested: number;
  failed: number;
}

export type AttendanceSyncCompletedEvent = TypedEvent<
  "attendance.sync.completed",
  AttendanceSyncCompletedPayload
>;

export interface AttendanceIntegrationDisabledPayload {
  integrationId: number;
  name: string;
  connectorKey: string;
}

export type AttendanceIntegrationDisabledEvent = TypedEvent<
  "attendance.integration.disabled",
  AttendanceIntegrationDisabledPayload
>;

// ═══════════════════════════════════════════════════════════════════════════════
// HR MODULE — PAYROLL (P21-C)
// ═══════════════════════════════════════════════════════════════════════════════

export interface PayrollRunEventPayload {
  runId: number;
  runType?: string;
  payslipId?: number;
  employeeId?: number;
}

export type PayrollRunCreatedEvent = TypedEvent<"payroll.run.created", PayrollRunEventPayload>;
export type PayrollRunReviewEvent = TypedEvent<"payroll.run.review", PayrollRunEventPayload>;
export type PayrollRunApprovedEvent = TypedEvent<"payroll.run.approved", PayrollRunEventPayload>;
export type PayrollPayslipIssuedEvent = TypedEvent<"payroll.payslip.issued", PayrollRunEventPayload>;

// ═══════════════════════════════════════════════════════════════════════════════
// HR MODULE — EMPLOYEES
// Publisher: artifacts/api-server/src/routes/hr.ts  or  /users.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * employee.created — A new employee account has been created in the system.
 *
 * Matches existing EVENTS.EMPLOYEE_CREATED — no rename needed.
 * Bus emit not yet added to admin.ts; activity.ts + notifications-bus.ts
 * listeners are READY — awaiting the emitter migration.
 */
export interface EmployeeCreatedPayload {
  employeeUserId: number;
  employeeNumber: string;
  fullName: string;
  /** "admin" | "manager" | "member" */
  role: string;
  departmentId?: number | null;
  email?: string | null;
  position?: string | null;
  /** True when created directly by admin (vs. invitation flow). */
  isDirectCreate: boolean;
}

export type EmployeeCreatedEvent = TypedEvent<"employee.created", EmployeeCreatedPayload>;

// ═══════════════════════════════════════════════════════════════════════════════
// PROCUREMENT MODULE (P24-C)
// Publisher: artifacts/api-server/src/routes/procurement.ts and procurement services
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * procurement.vendor.activated — A vendor moved to active status.
 */
export interface ProcurementVendorActivatedPayload {
  vendorId: number;
  vendorCode: string;
  legalName: string;
  activatedByUserId: number;
}
export type ProcurementVendorActivatedEvent = TypedEvent<
  "procurement.vendor.activated",
  ProcurementVendorActivatedPayload
>;

/**
 * procurement.pr.submitted — A purchase request was submitted for approvals / processing.
 */
export interface ProcurementPrSubmittedPayload {
  prId: number;
  requestNumber: string;
  estimatedTotal: string;
  currencyCode: string;
  submittedByUserId: number;
}
export type ProcurementPrSubmittedEvent = TypedEvent<
  "procurement.pr.submitted",
  ProcurementPrSubmittedPayload
>;

/**
 * procurement.rfq.sent — An RFQ was sent (internal lifecycle; no supplier portal).
 */
export interface ProcurementRfqSentPayload {
  rfqId: number;
  rfqNumber: string;
  title: string;
  sentByUserId: number;
}
export type ProcurementRfqSentEvent = TypedEvent<
  "procurement.rfq.sent",
  ProcurementRfqSentPayload
>;

/**
 * procurement.po.approved — A purchase order reached approved status (typically from workflow decision).
 */
export interface ProcurementPoApprovedPayload {
  poId: number;
  poNumber: string;
  approvedByUserId: number;
}
export type ProcurementPoApprovedEvent = TypedEvent<
  "procurement.po.approved",
  ProcurementPoApprovedPayload
>;

/**
 * procurement.override.requested — An override was requested (policy/break-glass governance).
 */
export interface ProcurementOverrideRequestedPayload {
  entityType: string;
  entityId: string;
  reason: string;
  requestedByUserId: number;
}
export type ProcurementOverrideRequestedEvent = TypedEvent<
  "procurement.override.requested",
  ProcurementOverrideRequestedPayload
>;

// ── Inventory (P25-B) — domain event payloads ───────────────────────────────

/** Shared minimal payload for inventory domain events (extended at emit sites). */
export interface InventoryDomainEventPayload {
  workspaceId: number;
  documentId: number;
  referenceNumber?: string;
}

export type InventoryReceiptPostedEvent = TypedEvent<
  "inventory.receipt.posted",
  InventoryDomainEventPayload
>;
export type InventoryReceiptVoidedEvent = TypedEvent<
  "inventory.receipt.voided",
  InventoryDomainEventPayload
>;
export type InventoryMovementPostedEvent = TypedEvent<
  "inventory.movement.posted",
  InventoryDomainEventPayload & { movementType?: string }
>;
export type InventoryIssuePostedEvent = TypedEvent<
  "inventory.issue.posted",
  InventoryDomainEventPayload
>;
export type InventoryTransferCompletedEvent = TypedEvent<
  "inventory.transfer.completed",
  InventoryDomainEventPayload
>;
export type InventoryReservationCreatedEvent = TypedEvent<
  "inventory.reservation.created",
  InventoryDomainEventPayload
>;
export type InventoryAdjustmentPostedEvent = TypedEvent<
  "inventory.adjustment.posted",
  InventoryDomainEventPayload
>;
export type InventoryCountPostedEvent = TypedEvent<
  "inventory.count.posted",
  InventoryDomainEventPayload
>;
export type InventoryReservationExpiredEvent = TypedEvent<
  "inventory.reservation.expired",
  InventoryDomainEventPayload
>;
export type InventoryCountCompletedEvent = TypedEvent<
  "inventory.count.completed",
  InventoryDomainEventPayload
>;
