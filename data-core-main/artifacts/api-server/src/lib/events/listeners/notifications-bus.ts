/**
 * @file        listeners/notifications-bus.ts
 * @purpose     Notification creation driven by the typed EventBus (appEventBus).
 *              Listens for domain events and inserts rows into `notifications`,
 *              then triggers SSE push to connected browser clients.
 *
 * ── PHASE 0/1 TRACEABILITY ADDITIONS ──────────────────────────────────────────
 *   busEventId (Phase 1-C):
 *     Every notification insert now includes busEventId = event.id (UUID).
 *     This allows reverse-lookup: given a workspace_event_log, find all
 *     notifications it generated:
 *       SELECT * FROM notifications WHERE bus_event_id = '<uuid>'
 *     NULL for notifications created before Phase 0/1.
 *
 *   Listener timing (Phase 1-D):
 *     Each listener logs { listener, eventId, duration_ms, success } at DEBUG level.
 *     High-volume diagnostics - debug only, not suitable for info stream.
 *
 * ── MIGRATION STATUS PER EVENT ────────────────────────────────────────────────
 *   Event                │ Listener  │ Route emits? │ Legacy removed? │ Status
 *   ─────────────────────│───────────│──────────────│─────────────────│──────────────
 *   approval.created     │ ACTIVE    │ YES (T04)    │ YES             │ ✅ MIGRATED
 *   approval.completed   │ ACTIVE    │ YES (T04)    │ YES             │ ✅ MIGRATED
 *   ticket.created       │ ACTIVE    │ YES (T06-A)  │ YES             │ ✅ MIGRATED
 *   ticket.updated       │ ACTIVE    │ YES (T06-B)  │ YES             │ ✅ MIGRATED
 *   ticket.status_changed│ ACTIVE    │ YES (T06-B)  │ YES             │ ✅ MIGRATED
 *   employee.created     │ ACTIVE    │ YES (T07)    │ YES (T07)       │ ✅ MIGRATED
 *   form.submitted       │ ACTIVE    │ YES          │ N/A             │ ⏳ READY (no recipients defined)
 *   leave.requested      │ ACTIVE    │ YES (Phase 1)│ N/A             │ ✅ NEW
 *   leave.approved       │ ACTIVE    │ YES (Phase 1)│ N/A             │ ✅ NEW
 *   leave.rejected       │ ACTIVE    │ YES (Phase 1)│ N/A             │ ✅ NEW
 *   leave.withdrawn      │ ACTIVE    │ YES (Phase 1)│ N/A             │ ✅ NEW
 *
 *   KEY INVARIANT: A PENDING listener must NEVER fire while its legacy path is
 *   still active - doing so creates DUPLICATE notifications.  Only activate by
 *   adding the bus emit AND removing the legacy path in the same commit.
 *
 * ── NOTIFICATION TYPE STRING POLICY ──────────────────────────────────────────
 *   All "you've been assigned to a ticket" notifications use type = "ticket_assigned".
 *   This unifies previously inconsistent types:
 *     ticket.created listener → was "ticket_assigned"  ← no change
 *     ticket.updated listener → was "assigned"  ← CHANGED to "ticket_assigned"
 *
 *   IMPORTANT: Existing "assigned" rows in the DB are NOT retroactively updated.
 *   The frontend must treat both "assigned" and "ticket_assigned" as the same
 *   semantic type until a data migration is run.
 *   TODO(data migration): UPDATE notifications SET type = 'ticket_assigned'
 *     WHERE type = 'assigned';  - run when frontend is updated to use one type.
 *
 * ── NOTIFICATION OWNERSHIP TABLE ─────────────────────────────────────────────
 *   Event               │ notif.type         │ Recipient(s)            │ ticketId
 *   ────────────────────│────────────────────│─────────────────────────│──────────────
 *   approval.created    │ "approval_request"  │ assignedToUserId       │ entityId
 *   approval.completed  │ "approval_decision" │ requestedByUserId      │ entityId
 *   ticket.created      │ "ticket_assigned"   │ assigneeId (if set)    │ ticketId
 *   ticket.updated      │ "ticket_assigned"   │ new assigneeUserId     │ ticketId
 *   ticket.status_changed│ "ticket_closed"    │ ticket.createdByUserId │ ticketId
 *   employee.created    │ "employee_created"  │ workspace admins       │ null
 *   form.submitted      │ "form_submitted"    │ (TBD - no recipients)  │ null
 *   leave.requested     │ "leave_request"     │ currentApproverId      │ null
 *   leave.approved      │ "leave_approved"    │ employeeUserId         │ null
 *   leave.rejected      │ "leave_rejected"    │ employeeUserId         │ null
 *   leave.withdrawn     │ "leave_withdrawn"   │ currentApproverId      │ null
 *
 * ── SSE INTEGRATION ──────────────────────────────────────────────────────────
 *   Each listener calls emitToUser() AFTER the DB insert succeeds.
 *   SSE failure is silent - if the user is offline, emitToUser is a no-op.
 *
 * ── ticket.status_changed payload enrichment (Stabilization) ─────────────────
 *   The listener previously fetched ticket data from DB (createdByUserId, title).
 *   These fields are now included in TicketStatusChangedPayload itself, eliminating
 *   the extra DB round-trip.  The emitter (tickets.ts) has both values at emit time.
 *
 * ── DUPLICATE PROTECTION ─────────────────────────────────────────────────────
 *   Uses IdempotencyGuard from ../idempotency (extracted in Stabilization).
 *   This file uses its OWN guard instance - independent from activity.ts.
 *   In-memory only - does NOT survive server restarts.
 *   TODO(future): Persist processed event IDs for cross-restart dedup.
 *
 * ── LEGACY SYSTEMS - what is NOT replaced ────────────────────────────────────
 *   Inline inserts in route handlers (no bus emit for these yet):
 *   - comments.ts POST: "comment_added" → ticket creator
 *   - calendar.ts: "calendar" → event invitees
 *   - messages.ts: "message" → recipients
 *   Action: KEEP - do NOT remove until the corresponding bus emit is added.
 */

import { db } from "@workspace/db";
import {
  usersTable,
  leaveRequestsTable,
  leaveApprovalStepsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { EVENT_TYPES } from "@workspace/core-events";
import { appEventBus } from "../app-bus";
import { logger } from "../../logger";
import { IdempotencyGuard } from "../idempotency";
import {
  dispatchUserNotification,
  dispatchUserNotifications,
} from "../../notifications/dispatch";

// ── Per-file IdempotencyGuard instance ───────────────────────────────────────
//
// IMPORTANT: Each listener file uses its OWN guard instance.
// activity.ts has a separate instance - they must NOT share state.
// Two different listeners reacting to the same event.id are independent.

const dedup = new IdempotencyGuard();

function logListenerError(listenerName: string, error: unknown): void {
  logger.error(
    {
      listener: listenerName,
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    },
    `[notif-bus] ${listenerName} failed`,
  );
}

async function notifyWorkspaceAdmins(args: {
  workspaceId: number;
  actorUserId?: number;
  type: string;
  title: string;
  message: string;
  busEventId: string;
}): Promise<void> {
  const admins = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.workspaceId, args.workspaceId),
        eq(usersTable.status, "active"),
      ),
    );

  const adminIds = admins
    .filter(u => (u.role === "admin" || u.role === "super_admin") && u.id !== args.actorUserId)
    .map(u => u.id) as number[];

  if (adminIds.length === 0) return;

  await dispatchUserNotifications(
    args.workspaceId,
    adminIds.map((adminId) => ({
      userId: adminId,
      type: args.type,
      title: args.title,
      message: args.message,
      ticketId: null,
      busEventId: args.busEventId,
      enqueueEmail: false,
    })),
  );
}

// ── Listener: approval.created ─────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (T04)
//
// Notification:
//   Recipient = assignedToUserId
//   type      = "approval_request"
//   Guard: entityType === "ticket" only

appEventBus.subscribe(EVENT_TYPES.APPROVAL_CREATED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, approvalId: event.data.approvalId }, "[notif-bus] approval.created duplicate skipped");
    return;
  }

  if (event.data.entityType !== "ticket") {
    logger.debug({ entityType: event.data.entityType }, "[notif-bus] approval.created - non-ticket entity, skipping");
    return;
  }

  const t0 = Date.now();
  try {
    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: event.data.assignedToUserId as number,
      type: "approval_request",
      title: "Approval Required",
      message: "You have a new approval request",
      ticketId: event.data.entityId as number,
      busEventId: event.id,
      emailTemplateKey: "workflow.step.pending",
      templateVars: {
        title: "Approval Required",
        message: "You have a new approval request",
      },
    });
    logger.debug({ listener: "notif-bus.approval.created", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ approvalId: event.data.approvalId, recipientId: event.data.assignedToUserId }, "[notif-bus] approval.created → notification sent");
  } catch (err) {
    logger.debug({ listener: "notif-bus.approval.created", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("approval.created", err);
  }
});

// ── Listener: approval.completed ──────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (T04)
//
// Notification:
//   Recipient = requestedByUserId
//   type      = "approval_decision"
//   Guard: entityType === "ticket", self-decision check

appEventBus.subscribe(EVENT_TYPES.APPROVAL_COMPLETED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, approvalId: event.data.approvalId }, "[notif-bus] approval.completed duplicate skipped");
    return;
  }

  if (event.data.entityType !== "ticket") {
    logger.debug({ entityType: event.data.entityType }, "[notif-bus] approval.completed - non-ticket entity, skipping");
    return;
  }

  if (event.data.decidedByUserId === event.data.requestedByUserId) {
    logger.debug({ approvalId: event.data.approvalId }, "[notif-bus] approval.completed - self-decision, skipping");
    return;
  }

  const isApproved = event.data.outcome === "approved";

  const t0 = Date.now();
  try {
    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: event.data.requestedByUserId as number,
      type: "approval_decision",
      title: isApproved ? "Approval Approved" : "Approval Rejected",
      message: `Your approval request has been ${event.data.outcome}`,
      ticketId: event.data.entityId as number,
      busEventId: event.id,
      enqueueEmail: false,
    });
    logger.debug({ listener: "notif-bus.approval.completed", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ approvalId: event.data.approvalId, outcome: event.data.outcome }, "[notif-bus] approval.completed → notification sent");
  } catch (err) {
    logger.debug({ listener: "notif-bus.approval.completed", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("approval.completed", err);
  }
});

// ── Listener: ticket.created ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (T06-A)
//   Legacy removed: notifications.ts TICKET_CREATED listener removed.
//
// Notification:
//   Recipient = assigneeId (only if set AND ≠ createdByUserId)
//   type      = "ticket_assigned"
//   Guard: no assignee, self-assignment

appEventBus.subscribe(EVENT_TYPES.TICKET_CREATED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, ticketId: event.data.ticketId }, "[notif-bus] ticket.created duplicate skipped");
    return;
  }

  if (!event.data.assigneeId) return;
  if (event.data.assigneeId === event.data.createdByUserId) return;

  const t0 = Date.now();
  try {
    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: event.data.assigneeId as number,
      type: "ticket_assigned",
      title: "New Ticket Assigned",
      message: `You have been assigned ticket: ${event.data.title}`,
      ticketId: event.data.ticketId as number,
      busEventId: event.id,
      enqueueEmail: false,
    });
    logger.debug({ listener: "notif-bus.ticket.created", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ ticketId: event.data.ticketId, assigneeId: event.data.assigneeId }, "[notif-bus] ticket.created → assignee notification sent");
  } catch (err) {
    logger.debug({ listener: "notif-bus.ticket.created", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("ticket.created", err);
  }
});

// ── Listener: ticket.updated ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (T06-B)
//   Legacy removed: inline notificationsTable insert + emitToUser removed.
//
// Notification (only when assigneeId changes):
//   Recipient = event.data.changes.assigneeId (new assignee)
//   type      = "ticket_assigned"  ← unified with ticket.created (Stabilization)
//
// NOTE: Previously used type = "assigned".  Changed to "ticket_assigned" for
//   consistency.  Existing "assigned" rows in the DB are unaffected.
//   TODO(data migration): UPDATE notifications SET type = 'ticket_assigned'
//     WHERE type = 'assigned';
//
// Guard: no assigneeId change, self-assignment, same assignee (no-op)

appEventBus.subscribe(EVENT_TYPES.TICKET_UPDATED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, ticketId: event.data.ticketId }, "[notif-bus] ticket.updated duplicate skipped");
    return;
  }

  const newAssigneeId = event.data.changes.assigneeId;
  if (typeof newAssigneeId !== "number") return;
  if (newAssigneeId === event.data.updatedByUserId) return;

  const oldAssigneeId = event.data.previousValues?.assigneeId;
  if (oldAssigneeId === newAssigneeId) return;

  const t0 = Date.now();
  try {
    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: newAssigneeId,
      type: "ticket_assigned",
      title: "Ticket Assigned to You",
      message: `You have been assigned to ticket #${event.data.ticketId}`,
      ticketId: event.data.ticketId as number,
      busEventId: event.id,
      enqueueEmail: false,
    });
    logger.debug({ listener: "notif-bus.ticket.updated", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ ticketId: event.data.ticketId, newAssigneeId }, "[notif-bus] ticket.updated → assignee notification sent");
  } catch (err) {
    logger.debug({ listener: "notif-bus.ticket.updated", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("ticket.updated", err);
  }
});

// ── Listener: ticket.status_changed ──────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (T06-B)
//   Legacy removed: notifications.ts TICKET_CLOSED listener removed (T06-B).
//
// Notification (only on terminal status: "closed" or "resolved"):
//   Recipient = event.data.createdByUserId (from payload - NO DB query needed)
//   type      = "ticket_closed"
//
// Guard: self-close (changedByUserId === createdByUserId) skips notification.

appEventBus.subscribe(EVENT_TYPES.TICKET_STATUS_CHANGED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, ticketId: event.data.ticketId }, "[notif-bus] ticket.status_changed duplicate skipped");
    return;
  }

  const { toStatus, ticketId, changedByUserId, createdByUserId, title } = event.data;

  if (toStatus !== "closed" && toStatus !== "resolved") return;
  if (changedByUserId === createdByUserId) return;

  const t0 = Date.now();
  try {
    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: createdByUserId as number,
      type: "ticket_closed",
      title: "Ticket Closed",
      message: `Your ticket "${title}" has been ${toStatus}`,
      ticketId: ticketId as number,
      busEventId: event.id,
      enqueueEmail: false,
    });
    logger.debug({ listener: "notif-bus.ticket.status_changed", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ ticketId, toStatus, creatorId: createdByUserId }, "[notif-bus] ticket.status_changed → creator notification sent");
  } catch (err) {
    logger.debug({ listener: "notif-bus.ticket.status_changed", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("ticket.status_changed", err);
  }
});

// ── Listener: employee.created ────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ ACTIVE (Ticket 07)
//   Emitter:  admin.ts POST /admin/users → appEventBus.emit(EMPLOYEE_CREATED)
//   Legacy removed: notifications.ts EMPLOYEE_CREATED eventDispatcher listener
//                   removed in the same commit (T07).
//
// Behavioural delta vs. legacy path:
//   NEW:  emitToUsers() called after DB insert → SSE push for real-time badge update
//   OLD:  notifyUsers() did NOT call emitToUsers - no SSE, only polling picked it up
//
// Notification:
//   Recipients = all workspace admins + super_admins (excluding the actor)
//   type       = "employee_created"
//   DB query:  fetches admin userIds from workspace at listener-call time.

appEventBus.subscribe(EVENT_TYPES.EMPLOYEE_CREATED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, employeeUserId: event.data.employeeUserId }, "[notif-bus] employee.created duplicate skipped");
    return;
  }

  const t0 = Date.now();
  try {
    const admins = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.workspaceId, event.workspace.workspaceId),
          eq(usersTable.status, "active"),
        ),
      );

    const adminIds = admins
      .filter(u => (u.role === "admin" || u.role === "super_admin") && u.id !== event.actor.userId)
      .map(u => u.id) as number[];

    if (adminIds.length === 0) {
      logger.debug({ listener: "notif-bus.employee.created", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
      return;
    }

    await dispatchUserNotifications(
      event.workspace.workspaceId,
      adminIds.map((adminId) => ({
        userId: adminId,
        type: "employee_created",
        title: "New Employee Added",
        message: `Employee ${event.data.employeeNumber} has been created in the system`,
        ticketId: null,
        busEventId: event.id,
        enqueueEmail: false,
      })),
    );

    logger.debug({ listener: "notif-bus.employee.created", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ employeeUserId: event.data.employeeUserId, notifiedAdmins: adminIds.length }, "[notif-bus] employee.created → admin notifications sent");
  } catch (err) {
    logger.debug({ listener: "notif-bus.employee.created", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("employee.created", err);
  }
});

// ── Listener: form.submitted ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ⏳ READY - route emits to appEventBus but no recipients defined.
//   Product clarification needed: who receives form submission notifications?
//   Placeholder: no-op until recipient logic is defined.

appEventBus.subscribe(EVENT_TYPES.FORM_SUBMITTED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, formId: event.data.formId }, "[notif-bus] form.submitted duplicate skipped");
    return;
  }

  logger.debug({ formId: event.data.formId }, "[notif-bus] form.submitted → recipient logic not yet defined, skipping insert");
});

// ── Listener: leave.requested ─────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ NEW (Phase 1)
//   Emitter: leave.ts - POST /hr/leave-requests
//
// Notification strategy:
//   - Notify the designated approver (currentApproverId from the request row)
//     that a leave request requires their attention.
//   - If no approver is set (auto-approved path), skip notification.
//   - type = "leave_request"
//
// Note: currentApproverId is fetched from the DB because it's not in the payload.
// The leave request row is created in the route transaction before the event fires.

appEventBus.subscribe(EVENT_TYPES.LEAVE_REQUESTED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, leaveRequestId: event.data.leaveRequestId }, "[notif-bus] leave.requested duplicate skipped");
    return;
  }

  const { leaveRequestId, leaveType, startDate, endDate, daysRequested, requiresApproval } = event.data;

  if (!requiresApproval) {
    logger.debug({ leaveRequestId }, "[notif-bus] leave.requested - auto-approved, no approver notification needed");
    return;
  }

  const [leaveReq] = await db
    .select({ currentApproverId: leaveRequestsTable.currentApproverId })
    .from(leaveRequestsTable)
    .where(eq(leaveRequestsTable.id, leaveRequestId as number))
    .limit(1);

  if (!leaveReq?.currentApproverId) {
    logger.debug({ leaveRequestId }, "[notif-bus] leave.requested - no approver assigned, skipping notification");
    return;
  }

  const t0 = Date.now();
  const leaveMessage = `A ${leaveType} leave request (${startDate} → ${endDate}, ${daysRequested}d) requires your approval`;
  try {
    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: leaveReq.currentApproverId,
      type: "leave_request",
      title: "New Leave Request",
      message: leaveMessage,
      busEventId: event.id,
      emailTemplateKey: "leave.requested",
      templateVars: {
        leaveType: String(leaveType),
        startDate: String(startDate),
        endDate: String(endDate),
        message: leaveMessage,
      },
    });
    logger.debug({ listener: "notif-bus.leave.requested", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ leaveRequestId, recipientId: leaveReq.currentApproverId }, "[notif-bus] leave.requested → notification sent to approver");
  } catch (err) {
    logger.debug({ listener: "notif-bus.leave.requested", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("leave.requested", err);
  }
});

// ── Listener: leave.approved ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ NEW (Phase 1)
//   Emitter: leave.ts - PATCH /hr/leave-requests/:id/approve
//            Also emitted by POST /hr/leave-requests when requiresApproval = false.
//
// Notification strategy:
//   - Notify the employee that their leave request has been approved.
//   - type = "leave_approved"
//
// Recipient: the employee (event.data.employeeUserId)

appEventBus.subscribe(EVENT_TYPES.LEAVE_APPROVED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, leaveRequestId: event.data.leaveRequestId }, "[notif-bus] leave.approved duplicate skipped");
    return;
  }

  const { leaveRequestId, employeeUserId, leaveType, startDate, endDate, daysApproved } = event.data;

  const t0 = Date.now();
  const approvedMessage = `Your ${leaveType} leave (${startDate} → ${endDate}, ${daysApproved}d) has been approved`;
  try {
    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: employeeUserId as number,
      type: "leave_approved",
      title: "Leave Request Approved",
      message: approvedMessage,
      busEventId: event.id,
      emailTemplateKey: "leave.approved",
      templateVars: {
        leaveType: String(leaveType),
        message: approvedMessage,
      },
    });
    logger.debug({ listener: "notif-bus.leave.approved", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ leaveRequestId, employeeUserId }, "[notif-bus] leave.approved → notification sent to employee");
  } catch (err) {
    logger.debug({ listener: "notif-bus.leave.approved", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("leave.approved", err);
  }
});

// ── Listener: leave.rejected ──────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ NEW (Phase 1)
//   Emitter: leave.ts - PATCH /hr/leave-requests/:id/reject
//
// Notification strategy:
//   - Notify the employee that their leave request has been rejected.
//   - type = "leave_rejected"
//
// Recipient: the employee (event.data.employeeUserId)

appEventBus.subscribe(EVENT_TYPES.LEAVE_REJECTED, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, leaveRequestId: event.data.leaveRequestId }, "[notif-bus] leave.rejected duplicate skipped");
    return;
  }

  const { leaveRequestId, employeeUserId, leaveType, startDate, endDate, rejectionReason } = event.data;

  const t0 = Date.now();
  try {
    const message = rejectionReason
      ? `Your ${leaveType} leave (${startDate} → ${endDate}) was rejected: ${rejectionReason}`
      : `Your ${leaveType} leave request (${startDate} → ${endDate}) has been rejected`;

    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: employeeUserId as number,
      type: "leave_rejected",
      title: "Leave Request Rejected",
      message,
      busEventId: event.id,
      emailTemplateKey: "leave.rejected",
      templateVars: {
        leaveType: String(leaveType),
        message,
      },
    });
    logger.debug({ listener: "notif-bus.leave.rejected", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ leaveRequestId, employeeUserId }, "[notif-bus] leave.rejected → notification sent to employee");
  } catch (err) {
    logger.debug({ listener: "notif-bus.leave.rejected", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("leave.rejected", err);
  }
});

// ── Listener: leave.withdrawn ─────────────────────────────────────────────────
//
// MIGRATION STATUS: ✅ NEW (Phase 1)
//   Emitter: leave.ts - PATCH /hr/leave-requests/:id/withdraw
//
// Notification strategy:
//   - Notify the approver (if one was assigned) that the leave request has been
//     withdrawn by the employee and no further action is required.
//   - type = "leave_withdrawn"
//
// Recipient: the current approver (fetched from the approval step)
// Note: After withdrawal, currentApproverId is set to null on the request row,
//   so we query the first approval step to find the original approver.

appEventBus.subscribe(EVENT_TYPES.LEAVE_WITHDRAWN, async (event) => {
  if (!dedup.isNew(event.id)) {
    logger.warn({ eventId: event.id, leaveRequestId: event.data.leaveRequestId }, "[notif-bus] leave.withdrawn duplicate skipped");
    return;
  }

  const { leaveRequestId, leaveType, startDate, endDate } = event.data;

  const [step] = await db
    .select({ approverUserId: leaveApprovalStepsTable.approverUserId })
    .from(leaveApprovalStepsTable)
    .where(
      and(
        eq(leaveApprovalStepsTable.leaveRequestId, leaveRequestId as number),
        eq(leaveApprovalStepsTable.stepOrder, 1),
      ),
    )
    .limit(1);

  if (!step) {
    logger.debug({ leaveRequestId }, "[notif-bus] leave.withdrawn - no approval step found, skipping approver notification");
    return;
  }

  const t0 = Date.now();
  try {
    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: step.approverUserId,
      type: "leave_withdrawn",
      title: "Leave Request Withdrawn",
      message: `A ${leaveType} leave request (${startDate} → ${endDate}) has been withdrawn by the employee`,
      busEventId: event.id,
      enqueueEmail: false,
    });
    logger.debug({ listener: "notif-bus.leave.withdrawn", eventId: event.id, duration_ms: Date.now() - t0, success: true }, "[notif-bus] timing");
    logger.info({ leaveRequestId, approverUserId: step.approverUserId }, "[notif-bus] leave.withdrawn → notification sent to approver");
  } catch (err) {
    logger.debug({ listener: "notif-bus.leave.withdrawn", eventId: event.id, duration_ms: Date.now() - t0, success: false }, "[notif-bus] timing");
    logListenerError("leave.withdrawn", err);
  }
});

// ── Export marker ─────────────────────────────────────────────────────────────

/**
 * registerNotificationBusListeners - no-op marker for explicit import in index.ts.
 * All listeners are registered as a side-effect of importing this module.
 */
export function registerNotificationBusListeners(): void {
  // Listeners registered at module load time - nothing to do here.
}
