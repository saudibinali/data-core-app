import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { ticketsTable, approvalsTable, usersTable, departmentsTable, notificationsTable, activityLogsTable } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, requirePermission("dashboard.view"), async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId;
  const workspaceId = req.workspaceId;

  if (!workspaceId) {
    res.json({ openTickets: 0, inProgressTickets: 0, pendingApprovals: 0, resolvedThisWeek: 0, totalUsers: 0, totalDepartments: 0, unreadNotifications: 0 });
    return;
  }

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const [openTickets, inProgressTickets, pendingApprovals, resolvedThisWeek, totalUsers, totalDepartments, unreadNotifications] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(and(eq(ticketsTable.workspaceId, workspaceId), eq(ticketsTable.status, "open"))),
    db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(and(eq(ticketsTable.workspaceId, workspaceId), eq(ticketsTable.status, "in_progress"))),
    db.select({ count: sql<number>`count(*)::int` }).from(approvalsTable).where(eq(approvalsTable.status, "pending")),
    db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(and(eq(ticketsTable.workspaceId, workspaceId), eq(ticketsTable.status, "resolved"), gte(ticketsTable.updatedAt, oneWeekAgo))),
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.workspaceId, workspaceId)),
    db.select({ count: sql<number>`count(*)::int` }).from(departmentsTable).where(eq(departmentsTable.workspaceId, workspaceId)),
    userId
      ? db.select({ count: sql<number>`count(*)::int` }).from(notificationsTable).where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)))
      : Promise.resolve([{ count: 0 }]),
  ]);

  res.json({
    openTickets: openTickets[0]?.count ?? 0,
    inProgressTickets: inProgressTickets[0]?.count ?? 0,
    pendingApprovals: pendingApprovals[0]?.count ?? 0,
    resolvedThisWeek: resolvedThisWeek[0]?.count ?? 0,
    totalUsers: totalUsers[0]?.count ?? 0,
    totalDepartments: totalDepartments[0]?.count ?? 0,
    unreadNotifications: unreadNotifications[0]?.count ?? 0,
  });
});

router.get("/dashboard/recent-activity", requireAuth, requirePermission("dashboard.view"), async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = req.workspaceId;
  const limit = parseInt(req.query.limit as string) || 20;

  if (!workspaceId) {
    res.json([]);
    return;
  }

  const logs = await db
    .select({
      id: activityLogsTable.id,
      ticketId: activityLogsTable.ticketId,
      userId: activityLogsTable.userId,
      userName: usersTable.fullName,
      action: activityLogsTable.action,
      metadata: activityLogsTable.metadata,
      createdAt: activityLogsTable.createdAt,
    })
    .from(activityLogsTable)
    .leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id))
    .innerJoin(ticketsTable, and(eq(activityLogsTable.ticketId, ticketsTable.id), eq(ticketsTable.workspaceId, workspaceId)))
    .orderBy(desc(activityLogsTable.createdAt))
    .limit(limit);

  res.json(logs);
});

export default router;
