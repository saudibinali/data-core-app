/**
 * @package     @workspace/core-events
 * @file        constants.ts
 * @purpose     Event type string constants, the EventTypeMap discriminated union,
 *              and the AnyTypedEvent union for exhaustive type narrowing.
 *
 * ── Naming Convention ─────────────────────────────────────────────────────────
 *   Canonical:   entity.action           (2-level, lowercase, dot-separated)
 *   Compound:    entity.sub_action       (snake_case, NOT a 3rd dot level)
 *
 *   Examples:
 *     ticket.created        ✓
 *     ticket.status_changed ✓  (compound action via snake_case)
 *     forms.form.submitted  ✗  (legacy — 3-level, superseded by form.submitted)
 *     ticket.statusChanged  ✗  (camelCase not used)
 *
 *   Why entity.action?
 *     • Already used by ~95% of existing events — minimal migration surface
 *     • Reads naturally in workflow trigger UI: "when [ticket] is [created]"
 *     • Consistent with industry patterns (Stripe, GitHub webhooks)
 *     • 2-level stays flat and searchable; no 3-level ambiguity
 *
 * ── Canonical domain events only ─────────────────────────────────────────────
 *   EVENT_TYPES contains BUSINESS DOMAIN EVENTS only — things that happened in
 *   the business domain that external observers (workflows, audit, analytics)
 *   care about.
 *
 *   Do NOT add infrastructure events (e.g. "a row was inserted into a table")
 *   or meta events (e.g. "the workflow engine ran") to this catalog.  These are
 *   implementation details, not domain facts.  Adding them risks:
 *     • notification.created → recursive cascade (event about an event)
 *     • workflow.executed    → infinite loop via bridge → WorkflowEngine
 *
 * ── Events removed in Stabilization ──────────────────────────────────────────
 *   NOTIFICATION_CREATED — removed.  Infrastructure event, not domain event.
 *     SSE push already handled inside insertNotification().  No listener or
 *     emitter existed.  Re-introduce only when WebSocket push system is built
 *     and cycle detection is in place.
 *
 *   WORKFLOW_EXECUTED — removed.  Meta event, not domain event.
 *     Loop risk: bridge forwards it to eventDispatcher → WorkflowEngine triggers
 *     on it → emits workflow.executed → loop.  Re-introduce only when cycle
 *     detection is implemented in the WorkflowEngine.
 *
 * ── Conflict Map — Canonical → Existing api-server name ──────────────────────
 *   canonical               existing                 action needed
 *   ─────────────────────── ──────────────────────── ──────────────────────────
 *   ticket.created          ticket.created           ✓ MATCH — no change
 *   ticket.updated          ticket.updated           ✓ MATCH — no change
 *   ticket.status_changed   (not in EVENTS map)      ADD to EVENTS (Ticket 03)
 *   form.submitted          forms.form.submitted     RENAME legacy (Ticket 03)
 *   approval.created        approval.requested       RENAME preferred (Ticket 03)
 *   approval.completed      (no unified concept)     ADD (Ticket 03)
 *   leave.requested         leave.requested          ✓ MATCH — no change
 *   employee.created        employee.created         ✓ MATCH — no change
 *
 * ── Promotion policy for legacy EVENTS entries ────────────────────────────────
 *   Events in api-server EVENTS map but NOT in EVENT_TYPES are legacy-only events.
 *   They are promoted to EVENT_TYPES when:
 *     a) A route migrates from eventDispatcher.dispatch() to appEventBus.emit(), OR
 *     b) A new bus listener is created for that event.
 *   Until promoted, they reach only workspace_event_logs + WorkflowEngine
 *   (via the legacy eventDispatcher path).
 *
 *   Not-yet-promoted events (as of Phase 0):
 *     EMPLOYEE_UPDATED, EMPLOYEE_DELETED, EMPLOYEE_RESIGNED
 *     TICKET_COMMENTED    ← HIGH IMPORTANCE — comment notifications are inline
 *     DEPARTMENT_CREATED, DEPARTMENT_UPDATED
 *     GROUP_CREATED, GROUP_MEMBER_ADDED
 *     MEETING_CREATED, MEETING_UPDATED
 *     USER_LOGGED_IN
 *
 *   Promoted in Phase 0 (Leave Domain taxonomy):
 *     LEAVE_APPROVED, LEAVE_REJECTED, LEAVE_CANCELLED, LEAVE_WITHDRAWN,
 *     LEAVE_BALANCE_ADJUSTED  ← full lifecycle added; no emitter yet (Phase 1)
 *
 * ── Bugs documented here ──────────────────────────────────────────────────────
 *   BUG-001: "leave.requested" registered twice in registry.ts — once under
 *            module "hr" and once under module "forms" with different schemas.
 *            RESOLVED (Cleanup Sprint): duplicate "forms" entry removed.
 *            Canonical owner is module "hr".
 *
 * ── Ownership ─────────────────────────────────────────────────────────────────
 * This file is the single source of truth for event type strings.
 * api-server/src/lib/events/types.ts defines a local EVENTS object that
 * partially overlaps — it will be superseded by this file in Ticket 03.
 */

import type {
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketStatusChangedEvent,
  FormSubmittedEvent,
  ApprovalCreatedEvent,
  ApprovalCompletedEvent,
  LeaveRequestedEvent,
  LeaveApprovedEvent,
  LeaveRejectedEvent,
  LeaveCancelledEvent,
  LeaveWithdrawnEvent,
  LeaveBalanceAdjustedEvent,
  AttendanceRawReceivedEvent,
  AttendanceEventNormalizedEvent,
  AttendanceDayCalculatedEvent,
  AttendanceSyncFailedEvent,
  AttendanceSyncCompletedEvent,
  AttendanceIntegrationDisabledEvent,
  PayrollRunCreatedEvent,
  PayrollRunReviewEvent,
  PayrollRunApprovedEvent,
  PayrollPayslipIssuedEvent,
  EmployeeCreatedEvent,
  ProcurementVendorActivatedEvent,
  ProcurementPrSubmittedEvent,
  ProcurementRfqSentEvent,
  ProcurementPoApprovedEvent,
  ProcurementOverrideRequestedEvent,
  InventoryReceiptPostedEvent,
  InventoryReceiptVoidedEvent,
  InventoryMovementPostedEvent,
  InventoryIssuePostedEvent,
  InventoryTransferCompletedEvent,
  InventoryReservationCreatedEvent,
  InventoryAdjustmentPostedEvent,
  InventoryCountPostedEvent,
  InventoryReservationExpiredEvent,
  InventoryCountCompletedEvent,
} from "./events";

// ── EVENT_TYPES constant object ───────────────────────────────────────────────

/**
 * EVENT_TYPES — canonical event type string constants.
 *
 * Use these instead of raw strings to benefit from autocomplete and refactoring:
 *   import { EVENT_TYPES } from "@workspace/core-events";
 *   appEventBus.emit({ type: EVENT_TYPES.TICKET_CREATED, ... });
 *
 * The `as const` assertion makes values literal string types, enabling
 * TypeScript to infer the discriminated union in EventTypeMap.
 *
 * Adding a new event:
 *   1. Define MyNewPayload + TypedEvent alias in events.ts
 *   2. Add constant below: MY_NEW_EVENT: "entity.action"
 *   3. Add to EventTypeMap: "entity.action": MyNewEvent["data"]
 *   4. Add to AnyTypedEvent union
 *   5. Ensure a route emits it (never add to catalog without an emitter plan)
 */
export const EVENT_TYPES = {

  // ── Tickets ─────────────────────────────────────────────────────────────────
  /** A new ticket has been opened. */
  TICKET_CREATED:        "ticket.created",

  /**
   * Non-status fields on a ticket changed (title, priority, assignee, etc.).
   * See TicketUpdatedPayload dual-emit policy for when this is emitted vs
   * TICKET_STATUS_CHANGED.
   */
  TICKET_UPDATED:        "ticket.updated",

  /**
   * The status of a ticket moved from one value to another.
   * Always emitted on any status transition.
   * See TicketStatusChangedPayload for canonical dual-emit rules.
   */
  TICKET_STATUS_CHANGED: "ticket.status_changed",

  // ── Forms ────────────────────────────────────────────────────────────────────
  /**
   * A form submission was completed.
   * CANONICAL name — existing registry uses legacy "forms.form.submitted".
   */
  FORM_SUBMITTED:        "form.submitted",

  // ── Approvals ────────────────────────────────────────────────────────────────
  /**
   * An approval request was created and is awaiting a decision.
   * CANONICAL name — existing legacy code uses "approval.requested".
   * Run check-workflow-triggers to find workflow_definitions rows that need migration.
   */
  APPROVAL_CREATED:      "approval.created",

  /**
   * An approval reached a terminal state (approved or rejected).
   * NEW unified concept — legacy code uses separate .approved / .rejected events.
   * Run check-workflow-triggers to find workflow_definitions rows that need migration.
   */
  APPROVAL_COMPLETED:    "approval.completed",

  // ── HR — Leave lifecycle ─────────────────────────────────────────────────────
  //
  // All leave events are owned by the leave domain route (/hr/leave-requests).
  // The approvals module does NOT participate in leave approval — the leave
  // domain maintains its own leave_approval_steps chain (Phase 1).
  // See events.ts HR MODULE — LEAVE DOMAIN section for full lifecycle docs.

  /**
   * An employee submitted a leave request.
   * Emitted after the leave_requests record is created and balance reservation
   * is written.  See LeaveRequestedPayload for naming convention note.
   */
  LEAVE_REQUESTED:           "leave.requested",

  /**
   * A leave request reached the final approved state.
   * Emitted after the last approval step is completed (or auto-approved).
   * Triggers: balance used/pending update, attendance records, calendar block.
   */
  LEAVE_APPROVED:            "leave.approved",

  /**
   * A leave request was rejected by an approver.
   * Emitted after the rejection decision; balance reservation is released.
   */
  LEAVE_REJECTED:            "leave.rejected",

  /**
   * An approved or pending leave request was cancelled by HR/admin.
   * Distinct from leave.withdrawn (which is employee self-cancellation).
   * wasApproved field determines whether balance restore is needed.
   */
  LEAVE_CANCELLED:           "leave.cancelled",

  /**
   * An employee withdrew their own pending leave request before any approval.
   * Balance reservation is released synchronously before this event is emitted.
   */
  LEAVE_WITHDRAWN:           "leave.withdrawn",

  /**
   * An HR manager manually adjusted a leave balance (grant or deduction).
   * adjustmentDays is signed: positive = grant, negative = deduct.
   */
  LEAVE_BALANCE_ADJUSTED:    "leave.balance_adjusted",

  // ── HR — Workforce attendance (P20-B) ────────────────────────────────────────
  ATTENDANCE_RAW_RECEIVED:       "attendance.raw.received",
  ATTENDANCE_EVENT_NORMALIZED:   "attendance.event.normalized",
  ATTENDANCE_DAY_CALCULATED:     "attendance.day.calculated",
  ATTENDANCE_SYNC_FAILED:        "attendance.sync.failed",
  ATTENDANCE_SYNC_COMPLETED:     "attendance.sync.completed",
  ATTENDANCE_INTEGRATION_DISABLED: "attendance.integration.disabled",

  // ── HR — Payroll (P21-C) ─────────────────────────────────────────────────────
  PAYROLL_RUN_CREATED:   "payroll.run.created",
  PAYROLL_RUN_REVIEW:    "payroll.run.review",
  PAYROLL_RUN_APPROVED:  "payroll.run.approved",
  PAYROLL_PAYSLIP_ISSUED: "payroll.payslip.issued",

  // ── HR — Employees ───────────────────────────────────────────────────────────
  /** A new employee account was created in the system. */
  EMPLOYEE_CREATED:      "employee.created",

  // ── Procurement (P24-C) ─────────────────────────────────────────────────────
  PROCUREMENT_VENDOR_ACTIVATED: "procurement.vendor.activated",
  PROCUREMENT_PR_SUBMITTED:     "procurement.pr.submitted",
  PROCUREMENT_RFQ_SENT:         "procurement.rfq.sent",
  PROCUREMENT_PO_APPROVED:      "procurement.po.approved",
  PROCUREMENT_OVERRIDE_REQUESTED: "procurement.override.requested",

  // ── Inventory (P25-B) ───────────────────────────────────────────────────────
  INVENTORY_RECEIPT_POSTED:       "inventory.receipt.posted",
  INVENTORY_RECEIPT_VOIDED:       "inventory.receipt.voided",
  INVENTORY_MOVEMENT_POSTED:      "inventory.movement.posted",
  INVENTORY_ISSUE_POSTED:         "inventory.issue.posted",
  INVENTORY_TRANSFER_COMPLETED: "inventory.transfer.completed",
  INVENTORY_RESERVATION_CREATED:  "inventory.reservation.created",
  INVENTORY_ADJUSTMENT_POSTED:    "inventory.adjustment.posted",
  INVENTORY_COUNT_POSTED:         "inventory.count.posted",
  INVENTORY_RESERVATION_EXPIRED:  "inventory.reservation.expired",
  INVENTORY_COUNT_COMPLETED:      "inventory.count.completed",

} as const;

/** P21-C payroll event aliases */
export const PAYROLL_EVENT_TYPES = {
  RUN_CREATED: EVENT_TYPES.PAYROLL_RUN_CREATED,
  RUN_REVIEW: EVENT_TYPES.PAYROLL_RUN_REVIEW,
  RUN_APPROVED: EVENT_TYPES.PAYROLL_RUN_APPROVED,
  PAYSLIP_ISSUED: EVENT_TYPES.PAYROLL_PAYSLIP_ISSUED,
} as const;

// ── EventTypeMap — typed payload registry ─────────────────────────────────────

/**
 * EventTypeMap — maps each canonical event type string to its typed payload interface.
 *
 * This is the authoritative registry for typed event narrowing.
 *
 * Usage:
 *   import type { EventTypeMap } from "@workspace/core-events";
 *   type MyPayload = EventTypeMap["ticket.created"];  // → TicketCreatedPayload
 */
export interface EventTypeMap {
  "ticket.created":          TicketCreatedEvent["data"];
  "ticket.updated":          TicketUpdatedEvent["data"];
  "ticket.status_changed":   TicketStatusChangedEvent["data"];
  "form.submitted":          FormSubmittedEvent["data"];
  "approval.created":        ApprovalCreatedEvent["data"];
  "approval.completed":      ApprovalCompletedEvent["data"];
  // ── Leave domain ─────────────────────────────────────────────────────────────
  "leave.requested":         LeaveRequestedEvent["data"];
  "leave.approved":          LeaveApprovedEvent["data"];
  "leave.rejected":          LeaveRejectedEvent["data"];
  "leave.cancelled":         LeaveCancelledEvent["data"];
  "leave.withdrawn":         LeaveWithdrawnEvent["data"];
  "leave.balance_adjusted":  LeaveBalanceAdjustedEvent["data"];
  "attendance.raw.received":       AttendanceRawReceivedEvent["data"];
  "attendance.event.normalized":   AttendanceEventNormalizedEvent["data"];
  "attendance.day.calculated":     AttendanceDayCalculatedEvent["data"];
  "attendance.sync.failed":        AttendanceSyncFailedEvent["data"];
  "attendance.sync.completed":     AttendanceSyncCompletedEvent["data"];
  "attendance.integration.disabled": AttendanceIntegrationDisabledEvent["data"];
  "payroll.run.created":     PayrollRunCreatedEvent["data"];
  "payroll.run.review":      PayrollRunReviewEvent["data"];
  "payroll.run.approved":    PayrollRunApprovedEvent["data"];
  "payroll.payslip.issued":  PayrollPayslipIssuedEvent["data"];
  // ── HR employees ─────────────────────────────────────────────────────────────
  "employee.created":        EmployeeCreatedEvent["data"];
  // ── Procurement ──────────────────────────────────────────────────────────────
  "procurement.vendor.activated": ProcurementVendorActivatedEvent["data"];
  "procurement.pr.submitted":     ProcurementPrSubmittedEvent["data"];
  "procurement.rfq.sent":         ProcurementRfqSentEvent["data"];
  "procurement.po.approved":      ProcurementPoApprovedEvent["data"];
  "procurement.override.requested": ProcurementOverrideRequestedEvent["data"];
  // ── Inventory ────────────────────────────────────────────────────────────────
  "inventory.receipt.posted":       InventoryReceiptPostedEvent["data"];
  "inventory.receipt.voided":       InventoryReceiptVoidedEvent["data"];
  "inventory.movement.posted":      InventoryMovementPostedEvent["data"];
  "inventory.issue.posted":         InventoryIssuePostedEvent["data"];
  "inventory.transfer.completed":   InventoryTransferCompletedEvent["data"];
  "inventory.reservation.created":  InventoryReservationCreatedEvent["data"];
  "inventory.adjustment.posted":    InventoryAdjustmentPostedEvent["data"];
  "inventory.count.posted":         InventoryCountPostedEvent["data"];
  "inventory.reservation.expired":  InventoryReservationExpiredEvent["data"];
  "inventory.count.completed":      InventoryCountCompletedEvent["data"];
}

// ── AnyTypedEvent — full discriminated union ──────────────────────────────────

/**
 * AnyTypedEvent — a discriminated union of all known typed events.
 *
 * TypeScript narrows this union automatically when you switch on `event.type`:
 *
 *   function handle(event: AnyTypedEvent) {
 *     switch (event.type) {
 *       case "ticket.created":
 *         // event.data is TicketCreatedPayload here ✓
 *         break;
 *       case "approval.completed":
 *         // event.data is ApprovalCompletedPayload here ✓
 *         break;
 *     }
 *   }
 */
export type AnyTypedEvent =
  | TicketCreatedEvent
  | TicketUpdatedEvent
  | TicketStatusChangedEvent
  | FormSubmittedEvent
  | ApprovalCreatedEvent
  | ApprovalCompletedEvent
  | LeaveRequestedEvent
  | LeaveApprovedEvent
  | LeaveRejectedEvent
  | LeaveCancelledEvent
  | LeaveWithdrawnEvent
  | LeaveBalanceAdjustedEvent
  | AttendanceRawReceivedEvent
  | AttendanceEventNormalizedEvent
  | AttendanceDayCalculatedEvent
  | AttendanceSyncFailedEvent
  | AttendanceSyncCompletedEvent
  | AttendanceIntegrationDisabledEvent
  | PayrollRunCreatedEvent
  | PayrollRunReviewEvent
  | PayrollRunApprovedEvent
  | PayrollPayslipIssuedEvent
  | EmployeeCreatedEvent
  | ProcurementVendorActivatedEvent
  | ProcurementPrSubmittedEvent
  | ProcurementRfqSentEvent
  | ProcurementPoApprovedEvent
  | ProcurementOverrideRequestedEvent
  | InventoryReceiptPostedEvent
  | InventoryReceiptVoidedEvent
  | InventoryMovementPostedEvent
  | InventoryIssuePostedEvent
  | InventoryTransferCompletedEvent
  | InventoryReservationCreatedEvent
  | InventoryAdjustmentPostedEvent
  | InventoryCountPostedEvent
  | InventoryReservationExpiredEvent
  | InventoryCountCompletedEvent;

/** Union of all canonical event type strings registered in EventTypeMap. */
export type EventType = keyof EventTypeMap;

/**
 * isEventType — type guard for narrowing a BaseEvent to a specific TypedEvent.
 *
 * Usage:
 *   import { isEventType, EVENT_TYPES } from "@workspace/core-events";
 *   if (isEventType(event, EVENT_TYPES.TICKET_CREATED)) {
 *     // event.data is TicketCreatedPayload here ✓
 *   }
 */
export type IsEventTypeFn = <T extends EventType>(
  event: { type: string },
  eventType: T,
) => event is { type: T; data: EventTypeMap[T] };

// ── Legacy name cross-reference ───────────────────────────────────────────────

/**
 * LEGACY_EVENT_NAMES — maps legacy api-server event names to their canonical equivalents.
 *
 * Read-only reference for migration planning.  Do NOT use these strings in new code.
 *
 * ── Workflow template migration required ──────────────────────────────────────
 *   The bridge dispatches canonical event names to workspace_event_logs.
 *   Any workflow_definitions row with trigger_event matching a legacy key will
 *   NOT fire.  Run: pnpm --filter @workspace/scripts run check-workflow-triggers
 *
 *   Legacy key              → Canonical equivalent
 *   "approval.requested"   → "approval.created"
 *   "approval.approved"    → "approval.completed"  (outcome = "approved")
 *   "approval.rejected"    → "approval.completed"  (outcome = "rejected")
 *   "forms.form.submitted" → "form.submitted"
 */
export const LEGACY_EVENT_NAMES: Readonly<Record<string, string>> = {
  "approval.requested":   EVENT_TYPES.APPROVAL_CREATED,
  "approval.approved":    EVENT_TYPES.APPROVAL_COMPLETED,
  "approval.rejected":    EVENT_TYPES.APPROVAL_COMPLETED,
  "forms.form.submitted": EVENT_TYPES.FORM_SUBMITTED,
} as const;
