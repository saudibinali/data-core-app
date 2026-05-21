/**
 * @file        listeners/activity.ts
 * @purpose     Activity record creation driven by the typed EventBus (appEventBus).
 *              Listens for domain events and inserts rows into `activity_logs`.
 *
 * ── OBSERVABILITY ROLE ────────────────────────────────────────────────────────
 *   Layer 3 (Business Activity History) in the four-layer observability model.
 *   Produces human-readable action records for the workspace timeline UI.
 *
 *   NOT the primary event store - that is workspace_event_logs.
 *   NOT notification delivery - that is notifications-bus.ts.
 *
 * ── PHASE 0/1 TRACEABILITY ADDITIONS ──────────────────────────────────────────
 *   Every activity_log row now includes:
 *
 *   workspaceId (Phase 1-A):
 *     Direct workspace isolation column. Eliminates the JOIN chain required before:
 *       • Ticket rows:     JOIN tickets ON tickets.workspace_id = ?
 *       • Non-ticket rows: JOIN users ON users.workspace_id = ?
 *     Now: WHERE workspace_id = ? directly on activity_logs.
 *     Source: event.workspace.workspaceId
 *
 *   busEventId (Phase 1-B):
 *     UUID of the appEventBus event that created this row. Value = event.id.
 *     Cross-reference with workspace_event_logs:
 *       SELECT * FROM workspace_event_logs WHERE payload->>'_busEventId' = busEventId
 *     Enables: "show me the event log for this activity row" and reverse.
 *     NULL for rows inserted before Phase 0/1 (legacy data).
 *
 *   Listener timing (Phase 1-D):
 *     Each listener logs { listener, eventId, duration_ms, success } at DEBUG level.
 *     Never at INFO - these are high-volume and belong in the log aggregator,
 *     not the structured info stream.
 *
 * ── MIGRATION STATUS PER EVENT ────────────────────────────────────────────────
 *   Event                │ Listener  │ Route emits?  │ Status
 *   ─────────────────────│───────────│───────────────│────────────────────────
 *   approval.created     │ ACTIVE    │ YES (T04)     │ ✅ MIGRATED
 *   approval.completed   │ ACTIVE    │ YES (T04)     │ ✅ MIGRATED
 *   employee.created     │ ACTIVE    │ YES (T07)     │ ✅ MIGRATED
 *   ticket.created       │ ACTIVE    │ YES (T06-A)   │ ✅ MIGRATED
 *   ticket.updated       │ ACTIVE    │ YES (T06-B)   │ ✅ MIGRATED
 *   ticket.status_changed│ ACTIVE    │ YES (Stab.)   │ ✅ MIGRATED
 *   form.submitted       │ ACTIVE    │ NO            │ ⏳ READY - needs emitter
 *   leave.requested      │ ACTIVE    │ YES (Phase 1) │ ✅ NEW
 *   leave.approved       │ ACTIVE    │ YES (Phase 1) │ ✅ NEW
 *   leave.rejected       │ ACTIVE    │ YES (Phase 1) │ ✅ NEW
 *   leave.withdrawn      │ ACTIVE    │ YES (Phase 1) │ ✅ NEW
 *
 * ── ACTIVITY OWNERSHIP TABLE ──────────────────────────────────────────────────
 *   Event                │ action               │ ticketId            │ userId
 *   ─────────────────────│──────────────────────│─────────────────────│──────────────────
 *   approval.created     │ "approval_requested" │ entityId (ticket)   │ requestedByUserId
 *   approval.completed   │ "approval_completed" │ entityId (ticket)   │ decidedByUserId
 *   employee.created     │ "employee_created"   │ null                │ employeeUserId
 *   ticket.created       │ "ticket_created"     │ ticketId            │ createdByUserId
 *   ticket.updated       │ "assigned"           │ ticketId            │ updatedByUserId
 *   ticket.updated       │ "ticket_updated"     │ ticketId            │ updatedByUserId
 *   ticket.status_changed│ "status_changed"     │ ticketId            │ changedByUserId
 *   form.submitted       │ "form_submitted"     │ null                │ submittedByUserId
 *   leave.requested      │ "leave_requested"    │ null                │ employeeUserId
 *   leave.approved       │ "leave_approved"     │ null                │ approvedByUserId
 *   leave.rejected       │ "leave_rejected"     │ null                │ rejectedByUserId
 *   leave.withdrawn      │ "leave_withdrawn"    │ null                │ employeeUserId
 *
 * ── DUPLICATE PROTECTION ─────────────────────────────────────────────────────
 *   Uses IdempotencyGuard from ../idempotency (extracted in Stabilization).
 *   Each listener file has its OWN IdempotencyGuard instance - they share the
 *   class but not the state.  This is required so activity.ts and
 *   notifications-bus.ts can each independently process the same event.id.
 *   TODO(future): Persist processed event IDs for cross-restart dedup.
 */

import { db } from "@workspace/db";
import { activityLogsTable } from "@workspace/db";
import { EVENT_TYPES } from "@workspace/core-events";
import { appEventBus } from "../app-bus";
import { logger } from "../../logger";
import { IdempotencyGuard } from "../idempotency";

// ── Per-file IdempotencyGuard instance ───────────────────────────────────────
//
// IMPORTANT: Each listener file instantiates its OWN guard.
// Do NOT import a singleton - activity.ts and notifications-bus.ts must each
// independently process the same event.id without suppressing each other.

const dedup = new IdempotencyGuard();

// ── Listener helper ───────────────────────────────────────────────────────────

function logListenerError(listenerName: string, error: unknown): void {
  logger.error(
    {
      listener: listenerName,
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    },
    `[activity] ${listenerName} failed`,
  );
}

// ── Listener: approval.created ─────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE
//   Source: approvals.ts - POST /approvals
//
// Activity mapping:
//   action   = "approval_requested"
//   ticketId = event.data.entityId   (when entityType === "ticket")
//   userId   = event.data.requestedByUserId
//   metadata = event.data.requestNote (optional)
//
// Entity guard: only "ticket" entityType writes to activity_logs today.
//   TODO(future): Add entityType column to activity_logs for generic support.

appEventBus.subscribe(EVENT_TYPES.APPROVAL_CREATED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, approvalId: event.data.approvalId }, "[activity] approval.created duplicate skipped");
    return;
  }

  if (event.data.entityType !== "ticket") {
    logger.debug({ entityType: event.data.entityType }, "[activity] approval.created - non-ticket entity, skipping activity_logs");
    return;
  }

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    event.data.entityId as number,
      userId:      event.data.requestedByUserId as number,
      action:      "approval_requested",
      metadata:    event.data.requestNote as string ?? null,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.approval.created", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ approvalId: event.data.approvalId, ticketId: event.data.entityId }, "[activity] approval.created → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.approval.created", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("approval.created", err);
  }
});

// ── Listener: approval.completed ──────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE
//   Source: approvals.ts - PATCH /approvals/:id
//
// Activity mapping:
//   action   = "approval_completed"
//   ticketId = event.data.entityId   (when entityType === "ticket")
//   userId   = event.data.decidedByUserId
//   metadata = event.data.outcome    ("approved" | "rejected") - UI reads this

appEventBus.subscribe(EVENT_TYPES.APPROVAL_COMPLETED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, approvalId: event.data.approvalId }, "[activity] approval.completed duplicate skipped");
    return;
  }

  if (event.data.entityType !== "ticket") {
    logger.debug({ entityType: event.data.entityType }, "[activity] approval.completed - non-ticket entity, skipping activity_logs");
    return;
  }

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    event.data.entityId as number,
      userId:      event.data.decidedByUserId as number,
      action:      "approval_completed",
      metadata:    event.data.outcome as string,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.approval.completed", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ approvalId: event.data.approvalId, outcome: event.data.outcome }, "[activity] approval.completed → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.approval.completed", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("approval.completed", err);
  }
});

// ── Listener: employee.created ────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (Ticket 07)
//   Emitter:  admin.ts POST /admin/users → appEventBus.emit(EMPLOYEE_CREATED)
//
// Activity mapping:
//   action   = "employee_created"
//   ticketId = null   ← not ticket-scoped; enriches "Recent Activity" dashboard feed
//   userId   = event.data.employeeUserId
//   metadata = "<fullName> (<employeeNumber>)"

appEventBus.subscribe(EVENT_TYPES.EMPLOYEE_CREATED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, employeeUserId: event.data.employeeUserId }, "[activity] employee.created duplicate skipped");
    return;
  }

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    null,
      userId:      event.data.employeeUserId as number,
      action:      "employee_created",
      metadata:    `${event.data.fullName} (${event.data.employeeNumber})`,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.employee.created", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ employeeUserId: event.data.employeeUserId, isDirectCreate: event.data.isDirectCreate }, "[activity] employee.created → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.employee.created", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("employee.created", err);
  }
});

// ── Listener: ticket.created ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (Ticket 06-A)
//   Source: tickets.ts - POST /tickets
//
// Activity mapping:
//   action   = "ticket_created"   ← matches UI label exactly
//   ticketId = event.data.ticketId
//   userId   = event.data.createdByUserId
//   metadata = event.data.title

appEventBus.subscribe(EVENT_TYPES.TICKET_CREATED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, ticketId: event.data.ticketId }, "[activity] ticket.created duplicate skipped");
    return;
  }

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    event.data.ticketId as number,
      userId:      event.data.createdByUserId as number,
      action:      "ticket_created",
      metadata:    event.data.title as string,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.ticket.created", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ ticketId: event.data.ticketId }, "[activity] ticket.created → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.ticket.created", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("ticket.created", err);
  }
});

// ── Listener: ticket.updated ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (Ticket 06-B, updated in Stabilization)
//   Source: tickets.ts - PATCH /tickets/:id
//
// ── Semantic boundary (Stabilization) ────────────────────────────────────────
//   Handles NON-STATUS field changes ONLY.  Status changes → ticket.status_changed.
//   When both status and other fields change (Rule 2 of dual-emit policy),
//   BOTH events are emitted and each listener handles its own concern.
//
// Activity mapping:
//   assigneeId changed → action = "assigned"
//   other field change → action = "ticket_updated"

appEventBus.subscribe(EVENT_TYPES.TICKET_UPDATED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, ticketId: event.data.ticketId }, "[activity] ticket.updated duplicate skipped");
    return;
  }

  const action = "assigneeId" in event.data.changes ? "assigned" : "ticket_updated";

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    event.data.ticketId as number,
      userId:      event.data.updatedByUserId as number,
      action,
      metadata:    null,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.ticket.updated", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ ticketId: event.data.ticketId, action }, "[activity] ticket.updated → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.ticket.updated", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("ticket.updated", err);
  }
});

// ── Listener: ticket.status_changed ──────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (added in Stabilization)
//   Source: tickets.ts - PATCH /tickets/:id
//
// ── Semantic ownership ────────────────────────────────────────────────────────
//   SOLE owner of "status_changed" activity log writes.
//   The ticket.updated listener does NOT write status_changed rows.
//
// Activity mapping:
//   action   = "status_changed"
//   metadata = "prevStatus -> newStatus"    (e.g. "open -> in_progress")

appEventBus.subscribe(EVENT_TYPES.TICKET_STATUS_CHANGED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, ticketId: event.data.ticketId }, "[activity] ticket.status_changed duplicate skipped");
    return;
  }

  const metadata = `${event.data.fromStatus} -> ${event.data.toStatus}`;

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    event.data.ticketId as number,
      userId:      event.data.changedByUserId as number,
      action:      "status_changed",
      metadata,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.ticket.status_changed", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ ticketId: event.data.ticketId, fromStatus: event.data.fromStatus, toStatus: event.data.toStatus }, "[activity] ticket.status_changed → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.ticket.status_changed", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("ticket.status_changed", err);
  }
});

// ── Listener: form.submitted ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ⏳ READY - no current form submission route emits to appEventBus
//   TODO: confirm forms.ts emitter status and add appEventBus.emit().
//
// Activity mapping:
//   action   = "form_submitted"
//   ticketId = null   ← forms are not ticket-scoped
//   userId   = event.data.submittedByUserId
//   metadata = event.data.formName

appEventBus.subscribe(EVENT_TYPES.FORM_SUBMITTED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, formId: event.data.formId }, "[activity] form.submitted duplicate skipped");
    return;
  }

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    null,
      userId:      event.data.submittedByUserId as number,
      action:      "form_submitted",
      metadata:    event.data.formName as string,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.form.submitted", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ formId: event.data.formId }, "[activity] form.submitted → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.form.submitted", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("form.submitted", err);
  }
});

// ── Listener: leave.requested ─────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ NEW (Phase 1)
//   Emitter: leave.ts - POST /hr/leave-requests
//
// Activity mapping:
//   action   = "leave_requested"
//   ticketId = null  ← leave requests are not ticket-scoped
//   userId   = event.data.employeeUserId  (the requesting employee)
//   metadata = "<leaveType> | <startDate> → <endDate> | <daysRequested>d"

appEventBus.subscribe(EVENT_TYPES.LEAVE_REQUESTED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, leaveRequestId: event.data.leaveRequestId }, "[activity] leave.requested duplicate skipped");
    return;
  }

  const { leaveRequestId, employeeUserId, leaveType, startDate, endDate, daysRequested } = event.data;
  const metadata = `${leaveType} | ${startDate} → ${endDate} | ${daysRequested}d`;

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    null,
      userId:      employeeUserId as number,
      action:      "leave_requested",
      metadata,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.leave.requested", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ leaveRequestId, employeeUserId }, "[activity] leave.requested → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.leave.requested", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("leave.requested", err);
  }
});

// ── Listener: leave.approved ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ NEW (Phase 1)
//   Emitter: leave.ts - PATCH /hr/leave-requests/:id/approve
//            Also emitted by POST /hr/leave-requests when requiresApproval = false.
//
// Activity mapping:
//   action   = "leave_approved"
//   ticketId = null
//   userId   = event.data.approvedByUserId  (the approver, not the employee)
//   metadata = "<leaveType> | <startDate> → <endDate> | <daysApproved>d"

appEventBus.subscribe(EVENT_TYPES.LEAVE_APPROVED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, leaveRequestId: event.data.leaveRequestId }, "[activity] leave.approved duplicate skipped");
    return;
  }

  const { leaveRequestId, approvedByUserId, leaveType, startDate, endDate, daysApproved } = event.data;
  const metadata = `${leaveType} | ${startDate} → ${endDate} | ${daysApproved}d`;

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    null,
      userId:      approvedByUserId as number,
      action:      "leave_approved",
      metadata,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.leave.approved", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ leaveRequestId, approvedByUserId }, "[activity] leave.approved → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.leave.approved", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("leave.approved", err);
  }
});

// ── Listener: leave.rejected ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ NEW (Phase 1)
//   Emitter: leave.ts - PATCH /hr/leave-requests/:id/reject
//
// Activity mapping:
//   action   = "leave_rejected"
//   ticketId = null
//   userId   = event.data.rejectedByUserId  (the rejecting approver)
//   metadata = "<leaveType> | <startDate> → <endDate>"

appEventBus.subscribe(EVENT_TYPES.LEAVE_REJECTED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, leaveRequestId: event.data.leaveRequestId }, "[activity] leave.rejected duplicate skipped");
    return;
  }

  const { leaveRequestId, rejectedByUserId, leaveType, startDate, endDate } = event.data;
  const metadata = `${leaveType} | ${startDate} → ${endDate}`;

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    null,
      userId:      rejectedByUserId as number,
      action:      "leave_rejected",
      metadata,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.leave.rejected", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ leaveRequestId, rejectedByUserId }, "[activity] leave.rejected → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.leave.rejected", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("leave.rejected", err);
  }
});

// ── Listener: leave.withdrawn ─────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ NEW (Phase 1)
//   Emitter: leave.ts - PATCH /hr/leave-requests/:id/withdraw
//
// Activity mapping:
//   action   = "leave_withdrawn"
//   ticketId = null
//   userId   = event.data.employeeUserId  (the withdrawing employee)
//   metadata = "<leaveType> | <startDate> → <endDate>"

appEventBus.subscribe(EVENT_TYPES.LEAVE_WITHDRAWN, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, leaveRequestId: event.data.leaveRequestId }, "[activity] leave.withdrawn duplicate skipped");
    return;
  }

  const { leaveRequestId, employeeUserId, leaveType, startDate, endDate } = event.data;
  const metadata = `${leaveType} | ${startDate} → ${endDate}`;

  const t0 = Date.now();
  try {
    await db.insert(activityLogsTable).values({
      ticketId:    null,
      userId:      employeeUserId as number,
      action:      "leave_withdrawn",
      metadata,
      workspaceId: event.workspace.workspaceId,
      busEventId:  event.id,
    });
    logger.debug({ listener: "activity.leave.withdrawn", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[activity] timing");
    logger.info({ leaveRequestId, employeeUserId }, "[activity] leave.withdrawn → activity_logs");
  } catch (err) {
    logger.debug({ listener: "activity.leave.withdrawn", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[activity] timing");
    logListenerError("leave.withdrawn", err);
  }
});

// ── Export marker ─────────────────────────────────────────────────────────────

/**
 * registerActivityListeners - no-op marker for explicit import in index.ts.
 * All listeners are registered as a side-effect of importing this module.
 */
export function registerActivityListeners(): void {
  // Listeners registered at module load time - nothing to do here.
}
