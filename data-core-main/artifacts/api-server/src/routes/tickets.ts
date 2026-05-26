import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { ticketsTable, usersTable, departmentsTable, ticketCCTable, commentsTable, activityLogsTable, approvalsTable } from "@workspace/db";
import { eq, and, sql, desc, ilike } from "drizzle-orm";
import {
  CreateTicketBody, GetTicketParams, UpdateTicketBody, UpdateTicketParams,
  DeleteTicketParams, ListTicketsQueryParams, AddTicketCCBody, AddTicketCCParams,
  RemoveTicketCCBody, RemoveTicketCCParams
} from "@workspace/api-zod";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { appEventBus, EVENT_TYPES } from "../lib/events";
import { parseListPagination } from "../lib/list-pagination";

const router: IRouter = Router();

const ticketBase = {
  id: ticketsTable.id,
  title: ticketsTable.title,
  description: ticketsTable.description,
  status: ticketsTable.status,
  priority: ticketsTable.priority,
  departmentId: ticketsTable.departmentId,
  departmentName: departmentsTable.name,
  createdByUserId: ticketsTable.createdByUserId,
  createdByName: sql<string>`creator.full_name`,
  assigneeUserId: ticketsTable.assigneeUserId,
  assigneeName: sql<string>`assignee.full_name`,
  commentCount: sql<number>`(select count(*)::int from ticket_comments where ticket_id = ${ticketsTable.id})`,
  createdAt: ticketsTable.createdAt,
  updatedAt: ticketsTable.updatedAt,
};

router.get("/tickets", requireAuth, requirePermission("tickets.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.json([]);
    return;
  }

  const params = ListTicketsQueryParams.safeParse(req.query);
  const filters = params.success ? params.data : {};

  const conditions: ReturnType<typeof eq>[] = [eq(ticketsTable.workspaceId, req.workspaceId)];
  if (filters.status) conditions.push(eq(ticketsTable.status, filters.status));
  if (filters.priority) conditions.push(eq(ticketsTable.priority, filters.priority));
  if (filters.departmentId) conditions.push(eq(ticketsTable.departmentId, filters.departmentId));
  if (filters.assigneeId) conditions.push(eq(ticketsTable.assigneeUserId, filters.assigneeId));
  if (filters.search) conditions.push(ilike(ticketsTable.title, `%${filters.search}%`));

  const { limit, offset } = parseListPagination(req.query as Record<string, unknown>);

  const tickets = await db
    .select(ticketBase)
    .from(ticketsTable)
    .leftJoin(departmentsTable, eq(ticketsTable.departmentId, departmentsTable.id))
    .leftJoin(sql`users creator`, sql`creator.id = ${ticketsTable.createdByUserId}`)
    .leftJoin(sql`users assignee`, sql`assignee.id = ${ticketsTable.assigneeUserId}`)
    .where(and(...conditions))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.setHeader("X-Total-Count", String(tickets.length));
  res.setHeader("X-Limit", String(limit));
  res.setHeader("X-Offset", String(offset));
  res.json(tickets);
});

router.get("/tickets/stats", requireAuth, requirePermission("tickets.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.json({ byStatus: [], byPriority: [], total: 0 });
    return;
  }

  const wid = req.workspaceId;
  const [byStatus, byPriority, total] = await Promise.all([
    db.select({ status: ticketsTable.status, count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.workspaceId, wid)).groupBy(ticketsTable.status),
    db.select({ priority: ticketsTable.priority, count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.workspaceId, wid)).groupBy(ticketsTable.priority),
    db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(eq(ticketsTable.workspaceId, wid)),
  ]);

  res.json({ byStatus, byPriority, total: total[0]?.count ?? 0 });
});

router.post("/tickets", requireAuth, requirePermission("tickets.create"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId || !req.userId) {
    res.status(401).json({ error: "User profile not found" });
    return;
  }

  const parsed = CreateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { ccUserIds, ...ticketData } = parsed.data;

  const [ticket] = await db.insert(ticketsTable).values({
    ...ticketData,
    workspaceId: req.workspaceId,
    createdByUserId: req.userId,
    status: "open",
  }).returning();

  if (ccUserIds && ccUserIds.length > 0) {
    await db.insert(ticketCCTable).values(ccUserIds.map(userId => ({ ticketId: ticket!.id, userId })));
  }

  const [full] = await db.select(ticketBase).from(ticketsTable)
    .leftJoin(departmentsTable, eq(ticketsTable.departmentId, departmentsTable.id))
    .leftJoin(sql`users creator`, sql`creator.id = ${ticketsTable.createdByUserId}`)
    .leftJoin(sql`users assignee`, sql`assignee.id = ${ticketsTable.assigneeUserId}`)
    .where(eq(ticketsTable.id, ticket!.id));

  res.status(201).json(full);

  // ── Bus: ticket.created ───────────────────────────────────────────────────────
  // Fanout: activity.ts → activity_logs | notifications-bus.ts → notif + SSE
  //         bridge → eventDispatcher → workspace_event_logs + WorkflowEngine
  // ticketsTable has no ticketType column → "general" is the platform default.
  void appEventBus.emit({
    type:      EVENT_TYPES.TICKET_CREATED,
    module:    "tickets",
    workspace: { workspaceId: req.workspaceId! },
    actor:     { userId: req.userId, role: req.userRole },
    metadata:  { idempotencyKey: `ticket-created-${ticket!.id}`, requestId: String(req.id) },
    data: {
      ticketId:        ticket!.id,
      title:           ticket!.title,
      ticketType:      "general",           // no ticketType column in schema - default
      priority:        ticket!.priority,
      status:          ticket!.status,
      createdByUserId: req.userId!,
      assigneeId:      ticket!.assigneeUserId ?? null,
      departmentId:    ticket!.departmentId ?? null,
    },
  });
});

router.get("/tickets/:id", requireAuth, requirePermission("tickets.view"), async (req: AuthRequest, res): Promise<void> => {
  const params = GetTicketParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [eq(ticketsTable.id, params.data.id)];
  if (req.workspaceId) conditions.push(eq(ticketsTable.workspaceId, req.workspaceId));

  const [ticket] = await db.select(ticketBase).from(ticketsTable)
    .leftJoin(departmentsTable, eq(ticketsTable.departmentId, departmentsTable.id))
    .leftJoin(sql`users creator`, sql`creator.id = ${ticketsTable.createdByUserId}`)
    .leftJoin(sql`users assignee`, sql`assignee.id = ${ticketsTable.assigneeUserId}`)
    .where(and(...conditions));

  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const [ccUsers, comments, activityLogs, approvals] = await Promise.all([
    db.select({ id: usersTable.id, fullName: usersTable.fullName, email: usersTable.email, avatarUrl: usersTable.avatarUrl })
      .from(ticketCCTable).innerJoin(usersTable, eq(ticketCCTable.userId, usersTable.id)).where(eq(ticketCCTable.ticketId, params.data.id)),

    db.select({
      id: commentsTable.id, ticketId: commentsTable.ticketId, authorId: commentsTable.authorId,
      authorName: usersTable.fullName, authorAvatarUrl: usersTable.avatarUrl,
      content: commentsTable.content, isInternal: commentsTable.isInternal,
      createdAt: commentsTable.createdAt, updatedAt: commentsTable.updatedAt,
    }).from(commentsTable).leftJoin(usersTable, eq(commentsTable.authorId, usersTable.id)).where(eq(commentsTable.ticketId, params.data.id)).orderBy(commentsTable.createdAt),

    db.select({
      id: activityLogsTable.id, ticketId: activityLogsTable.ticketId, userId: activityLogsTable.userId,
      userName: usersTable.fullName, action: activityLogsTable.action, metadata: activityLogsTable.metadata,
      createdAt: activityLogsTable.createdAt,
    }).from(activityLogsTable).leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id)).where(eq(activityLogsTable.ticketId, params.data.id)).orderBy(activityLogsTable.createdAt),

    db.select({
      id: approvalsTable.id, ticketId: approvalsTable.ticketId,
      requestedByUserId: approvalsTable.requestedByUserId, requestedByName: sql<string>`req_user.full_name`,
      approverUserId: approvalsTable.approverUserId, approverName: sql<string>`approver_user.full_name`,
      status: approvalsTable.status, comment: approvalsTable.comment,
      createdAt: approvalsTable.createdAt, updatedAt: approvalsTable.updatedAt,
    }).from(approvalsTable)
      .leftJoin(sql`users req_user`, sql`req_user.id = ${approvalsTable.requestedByUserId}`)
      .leftJoin(sql`users approver_user`, sql`approver_user.id = ${approvalsTable.approverUserId}`)
      .where(eq(approvalsTable.ticketId, params.data.id)),
  ]);

  res.json({ ...ticket, ccUsers, comments, activityLogs, approvals });
});

router.patch("/tickets/:id", requireAuth, requirePermission("tickets.edit"), async (req: AuthRequest, res): Promise<void> => {
  const params = UpdateTicketParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const whereConditions = [eq(ticketsTable.id, params.data.id)];
  if (req.workspaceId) whereConditions.push(eq(ticketsTable.workspaceId, req.workspaceId));

  const [oldTicket] = await db.select().from(ticketsTable).where(and(...whereConditions));
  if (!oldTicket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const [ticket] = await db.update(ticketsTable).set(parsed.data).where(and(...whereConditions)).returning();

  // Inline activity/notification inserts removed - handled by bus listeners.
  // See: activity.ts, notifications-bus.ts for the canonical side-effect handlers.

  const [full] = await db.select(ticketBase).from(ticketsTable)
    .leftJoin(departmentsTable, eq(ticketsTable.departmentId, departmentsTable.id))
    .leftJoin(sql`users creator`, sql`creator.id = ${ticketsTable.createdByUserId}`)
    .leftJoin(sql`users assignee`, sql`assignee.id = ${ticketsTable.assigneeUserId}`)
    .where(eq(ticketsTable.id, params.data.id));

  res.json(full);

  // ── Bus: canonical dual-emit policy (Stabilization) ──────────────────────────
  // Source of truth: tickets.ts (emitter) → appEventBus → listeners:
  //   ├─ activity.ts:          ticket.updated        → activity_logs (assigned / ticket_updated)
  //   ├─ activity.ts:          ticket.status_changed → activity_logs ("status_changed")
  //   ├─ notifications-bus.ts: ticket.updated        → assignee notification + SSE
  //   ├─ notifications-bus.ts: ticket.status_changed → creator notification on close/resolve
  //   └─ bridge.ts:            subscribeToAll        → eventDispatcher → workspace_event_logs + WorkflowEngine
  //
  // ── Canonical dual-emit rules ─────────────────────────────────────────────────
  //   Rule 1 - Status changed ONLY (no other fields changed):
  //     Emit TICKET_STATUS_CHANGED only.  Do NOT emit TICKET_UPDATED.
  //     Rationale: prevents spurious "ticket_updated" activity entries;
  //     prevents double workspace_event_log writes; prevents double WorkflowEngine triggers.
  //
  //   Rule 2 - Status changed AND other fields changed in the same request:
  //     Emit BOTH TICKET_STATUS_CHANGED and TICKET_UPDATED.
  //     Both listener sets must fire; the full changes map preserves the complete diff.
  //
  //   Rule 3 - Other fields changed, status unchanged:
  //     Emit TICKET_UPDATED only.
  //
  //   Rule 4 - Nothing changed (empty diff):
  //     Emit nothing.
  if (req.workspaceId && ticket) {
    // Build normalized changes/previousValues maps from what actually changed.
    const changes: Record<string, unknown> = {};
    const previousValues: Record<string, unknown> = {};

    const newStatus = parsed.data.status;
    const statusChanged = newStatus !== undefined && newStatus !== oldTicket.status;

    if (statusChanged) {
      changes.status        = newStatus;
      previousValues.status = oldTicket.status;
    }
    if (parsed.data.assigneeUserId !== undefined && parsed.data.assigneeUserId !== oldTicket.assigneeUserId) {
      changes.assigneeId        = parsed.data.assigneeUserId ?? null;
      previousValues.assigneeId  = oldTicket.assigneeUserId ?? null;
    }
    if (parsed.data.title !== undefined && parsed.data.title !== oldTicket.title) {
      changes.title        = parsed.data.title;
      previousValues.title  = oldTicket.title;
    }
    if (parsed.data.priority !== undefined && parsed.data.priority !== oldTicket.priority) {
      changes.priority        = parsed.data.priority;
      previousValues.priority  = oldTicket.priority;
    }
    if (parsed.data.description !== undefined && parsed.data.description !== oldTicket.description) {
      changes.description        = parsed.data.description;
      previousValues.description  = oldTicket.description;
    }
    if (parsed.data.departmentId !== undefined && parsed.data.departmentId !== oldTicket.departmentId) {
      changes.departmentId        = parsed.data.departmentId ?? null;
      previousValues.departmentId  = oldTicket.departmentId ?? null;
    }

    // Rule 4: nothing changed - suppress all events.
    if (Object.keys(changes).length > 0) {
      const hasNonStatusChanges = Object.keys(changes).some(k => k !== "status");

      // Rules 1 & 2: emit TICKET_STATUS_CHANGED whenever status transitioned.
      // Payload includes title and createdByUserId so listeners avoid a DB query.
      if (statusChanged) {
        void appEventBus.emit({
          type:      EVENT_TYPES.TICKET_STATUS_CHANGED,
          module:    "tickets",
          workspace: { workspaceId: req.workspaceId },
          actor:     { userId: req.userId, role: req.userRole },
          metadata:  { idempotencyKey: `ticket-status-${ticket.id}-${newStatus}`, requestId: String(req.id) },
          data: {
            ticketId:        ticket.id,
            fromStatus:      oldTicket.status,
            toStatus:        newStatus!,
            changedByUserId: req.userId!,
            title:           ticket.title,
            createdByUserId: oldTicket.createdByUserId,
          },
        });
      }

      // Rules 2 & 3: emit TICKET_UPDATED only when non-status fields changed.
      // activity.ts and notifications-bus.ts handle assignee/field changes here.
      if (hasNonStatusChanges) {
        void appEventBus.emit({
          type:      EVENT_TYPES.TICKET_UPDATED,
          module:    "tickets",
          workspace: { workspaceId: req.workspaceId },
          actor:     { userId: req.userId, role: req.userRole },
          metadata:  { idempotencyKey: `ticket-updated-${ticket.id}`, requestId: String(req.id) },
          data: {
            ticketId:        ticket.id,
            changes,
            previousValues,
            updatedByUserId: req.userId!,
          },
        });
      }
    }
  }
});

router.delete("/tickets/:id", requireAuth, requirePermission("tickets.close"), async (req: AuthRequest, res): Promise<void> => {
  const params = DeleteTicketParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions = [eq(ticketsTable.id, params.data.id)];
  if (req.workspaceId) conditions.push(eq(ticketsTable.workspaceId, req.workspaceId));

  const [ticket] = await db.delete(ticketsTable).where(and(...conditions)).returning();
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/tickets/:id/cc", requireAuth, requirePermission("tickets.edit"), async (req: AuthRequest, res): Promise<void> => {
  const params = AddTicketCCParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AddTicketCCBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.insert(ticketCCTable).values({ ticketId: params.data.id, userId: parsed.data.userId }).onConflictDoNothing();
  if (req.userId) {
    await db.insert(activityLogsTable).values({ ticketId: params.data.id, userId: req.userId, action: "cc_added" });
  }

  res.sendStatus(201);
});

router.delete("/tickets/:id/cc", requireAuth, requirePermission("tickets.edit"), async (req: AuthRequest, res): Promise<void> => {
  const params = RemoveTicketCCParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = RemoveTicketCCBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.delete(ticketCCTable).where(and(eq(ticketCCTable.ticketId, params.data.id), eq(ticketCCTable.userId, parsed.data.userId)));
  if (req.userId) {
    await db.insert(activityLogsTable).values({ ticketId: params.data.id, userId: req.userId, action: "cc_removed" });
  }

  res.sendStatus(204);
});

export default router;
