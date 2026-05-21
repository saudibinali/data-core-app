/**
 * @file        routes/approvals.ts
 *
 * ACTIVITY MIGRATION STATUS (Ticket 04):
 *   ✅ approval_requested  - removed inline db.insert(activityLogsTable);
 *                             now emitted via appEventBus → listeners/activity.ts
 *   ✅ approval_completed  - removed inline db.insert(activityLogsTable);
 *                             now emitted via appEventBus → listeners/activity.ts
 *
 * NOTIFICATION MIGRATION STATUS (Ticket 05):
 *   ✅ approval_request    - removed inline db.insert(notificationsTable) from POST /approvals;
 *                             now handled by listeners/notifications-bus.ts
 *                             (approval.created event → "approval_request" notif → approver)
 *   ✅ approval_decision   - removed inline db.insert(notificationsTable) from PATCH /approvals/:id;
 *                             now handled by listeners/notifications-bus.ts
 *                             (approval.completed event → "approval_decision" notif → requester)
 *
 * Both notification inserts are now fire-and-forget via appEventBus.emit().
 * The bus listener (notifications-bus.ts) handles DB insert + SSE push.
 * Behavior is identical to the previous inline inserts - same type/title/message/ticketId.
 * SSE push was NOT present in the old inline path; the new listener adds it.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { approvalsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreateApprovalBody, UpdateApprovalBody, UpdateApprovalParams, ListApprovalsQueryParams } from "@workspace/api-zod";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { appEventBus, EVENT_TYPES } from "../lib/events";

const router: IRouter = Router();

const approvalBase = {
  id: approvalsTable.id,
  ticketId: approvalsTable.ticketId,
  requestedByUserId: approvalsTable.requestedByUserId,
  requestedByName: sql<string>`req_user.full_name`,
  approverUserId: approvalsTable.approverUserId,
  approverName: sql<string>`approver_user.full_name`,
  status: approvalsTable.status,
  comment: approvalsTable.comment,
  createdAt: approvalsTable.createdAt,
  updatedAt: approvalsTable.updatedAt,
};

router.get("/approvals", requireAuth, requirePermission("approvals.view"), async (req, res): Promise<void> => {
  const params = ListApprovalsQueryParams.safeParse(req.query);
  const filters = params.success ? params.data : {};

  let query = db
    .select(approvalBase)
    .from(approvalsTable)
    .leftJoin(sql`users req_user`, sql`req_user.id = ${approvalsTable.requestedByUserId}`)
    .leftJoin(sql`users approver_user`, sql`approver_user.id = ${approvalsTable.approverUserId}`)
    .$dynamic();

  if (filters.status) {
    query = query.where(eq(approvalsTable.status, filters.status));
  }
  if (filters.ticketId) {
    query = query.where(eq(approvalsTable.ticketId, filters.ticketId));
  }

  const approvals = await query.orderBy(approvalsTable.createdAt);
  res.json(approvals);
});

// ── POST /approvals - create a new approval request ───────────────────────────
//
// Activity flow (Ticket 04):
//   OLD: await db.insert(activityLogsTable).values({ action: "approval_requested", ... })
//   NEW: void appEventBus.emit({ type: EVENT_TYPES.APPROVAL_CREATED, ... })
//        → listeners/activity.ts handles the activityLogsTable insert
//
// Notification flow (Ticket 05):
//   OLD: await db.insert(notificationsTable).values({ type: "approval_request", ... })
//   NEW: same appEventBus.emit() above is also consumed by:
//        → listeners/notifications-bus.ts → notifies the approver + SSE push
//
// Both activity and notification creation are fire-and-forget (void emit).
// The bus handles error isolation - listener failures never block the HTTP response.

router.post("/approvals", requireAuth, requirePermission("approvals.manage"), async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateApprovalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!req.userId) {
    res.status(401).json({ error: "User profile not found" });
    return;
  }

  const [approval] = await db.insert(approvalsTable).values({
    ticketId: parsed.data.ticketId,
    requestedByUserId: req.userId,
    approverUserId: parsed.data.approverUserId,
    status: "pending",
    comment: parsed.data.comment ?? null,
  }).returning();

  // ── Bus emit: approval.created ────────────────────────────────────────────
  // Consumed by TWO listeners simultaneously (both registered in lib/events/index.ts):
  //   1. listeners/activity.ts       → writes activityLogsTable (action: "approval_requested")
  //   2. listeners/notifications-bus.ts → writes notificationsTable + SSE push to approver
  //
  // workspaceId guard: super_admins have no workspaceId - skip emit for them.
  if (req.workspaceId) {
    void appEventBus.emit({
      type:      EVENT_TYPES.APPROVAL_CREATED,
      module:    "approvals",
      workspace: { workspaceId: req.workspaceId },
      actor:     { userId: req.userId, role: req.userRole },
      metadata:  {
        // Idempotency key prevents double-processing if the emit fires twice.
        idempotencyKey: `approval-created-${approval!.id}`,
        requestId:      String(req.id),
      },
      data: {
        approvalId:          approval!.id,
        entityType:          "ticket",
        entityId:            parsed.data.ticketId,
        requestedByUserId:   req.userId,
        assignedToUserId:    parsed.data.approverUserId,
        requestNote:         parsed.data.comment ?? undefined,
      },
    });
  }

  const [full] = await db.select(approvalBase).from(approvalsTable)
    .leftJoin(sql`users req_user`, sql`req_user.id = ${approvalsTable.requestedByUserId}`)
    .leftJoin(sql`users approver_user`, sql`approver_user.id = ${approvalsTable.approverUserId}`)
    .where(eq(approvalsTable.id, approval!.id));

  res.status(201).json(full);
});

// ── PATCH /approvals/:id - decide on an approval (approve / reject) ───────────
//
// Activity flow (Ticket 04):
//   OLD: await db.insert(activityLogsTable).values({ action: "approval_completed",
//                                                    metadata: parsed.data.status })
//   NEW: void appEventBus.emit({ type: EVENT_TYPES.APPROVAL_COMPLETED, ... })
//        → listeners/activity.ts handles the activityLogsTable insert
//
// Notification flow (Ticket 05):
//   OLD: await db.insert(notificationsTable).values({ type: "approval_decision", ... })
//   NEW: same appEventBus.emit() above is also consumed by:
//        → listeners/notifications-bus.ts → notifies the requester + SSE push

router.patch("/approvals/:id", requireAuth, requirePermission("approvals.manage"), async (req: AuthRequest, res): Promise<void> => {
  const params = UpdateApprovalParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateApprovalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [approval] = await db
    .update(approvalsTable)
    .set({ status: parsed.data.status, comment: parsed.data.comment ?? null })
    .where(eq(approvalsTable.id, params.data.id))
    .returning();

  if (!approval) {
    res.status(404).json({ error: "Approval not found" });
    return;
  }

  if (req.userId) {
    // ── Bus emit: approval.completed ──────────────────────────────────────────
    // Consumed by TWO listeners simultaneously:
    //   1. listeners/activity.ts       → writes activityLogsTable (action: "approval_completed")
    //   2. listeners/notifications-bus.ts → writes notificationsTable + SSE push to requester
    //
    // ticketId guard: non-ticket approvals (HR leave, forms) don't write to
    // the ticket-scoped notifications table (handled by listeners themselves).
    if (req.workspaceId && approval.ticketId) {
      void appEventBus.emit({
        type:      EVENT_TYPES.APPROVAL_COMPLETED,
        module:    "approvals",
        workspace: { workspaceId: req.workspaceId },
        actor:     { userId: req.userId, role: req.userRole },
        metadata:  {
          idempotencyKey: `approval-completed-${approval.id}`,
          requestId:      String(req.id),
        },
        data: {
          approvalId:          approval.id,
          entityType:          "ticket",
          entityId:            approval.ticketId,
          outcome:             parsed.data.status as "approved" | "rejected",
          decidedByUserId:     req.userId,
          requestedByUserId:   approval.requestedByUserId ?? req.userId,
          responseNote:        parsed.data.comment ?? undefined,
        },
      });
    }
  }

  const [full] = await db.select(approvalBase).from(approvalsTable)
    .leftJoin(sql`users req_user`, sql`req_user.id = ${approvalsTable.requestedByUserId}`)
    .leftJoin(sql`users approver_user`, sql`approver_user.id = ${approvalsTable.approverUserId}`)
    .where(eq(approvalsTable.id, approval.id));

  res.json(full);
});

export default router;
