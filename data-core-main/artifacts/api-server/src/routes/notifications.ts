import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { ListNotificationsQueryParams, MarkNotificationReadParams } from "@workspace/api-zod";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/notifications", requireAuth, requirePermission("notifications.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) {
    res.json([]);
    return;
  }

  const params = ListNotificationsQueryParams.safeParse(req.query);
  const unreadOnly = params.success ? params.data.unreadOnly : undefined;

  const baseWhere = req.workspaceId
    ? and(
        eq(notificationsTable.userId, req.userId),
        eq(notificationsTable.workspaceId, req.workspaceId),
      )
    : eq(notificationsTable.userId, req.userId);

  let query = db.select().from(notificationsTable).where(baseWhere).$dynamic();

  if (unreadOnly) {
    query = query.where(and(baseWhere, eq(notificationsTable.isRead, false)));
  }

  // Newest first
  const notifications = await query.orderBy(desc(notificationsTable.createdAt));
  res.json(notifications);
});

router.get("/notifications/unread-count", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) {
    res.json({ count: 0 });
    return;
  }

  const unreadWhere = req.workspaceId
    ? and(
        eq(notificationsTable.userId, req.userId),
        eq(notificationsTable.workspaceId, req.workspaceId),
        eq(notificationsTable.isRead, false),
      )
    : and(eq(notificationsTable.userId, req.userId), eq(notificationsTable.isRead, false));

  const result = await db.select().from(notificationsTable).where(unreadWhere);

  res.json({ count: result.length });
});

router.patch("/notifications/read-all", requireAuth, requirePermission("notifications.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) {
    res.json({ success: true });
    return;
  }

  const readAllWhere = req.workspaceId
    ? and(
        eq(notificationsTable.userId, req.userId),
        eq(notificationsTable.workspaceId, req.workspaceId),
        eq(notificationsTable.isRead, false),
      )
    : and(eq(notificationsTable.userId, req.userId), eq(notificationsTable.isRead, false));

  await db.update(notificationsTable).set({ isRead: true }).where(readAllWhere);

  res.json({ success: true });
});

router.patch("/notifications/:id/read", requireAuth, requirePermission("notifications.view"), async (req: AuthRequest, res): Promise<void> => {
  const params = MarkNotificationReadParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const markWhere = req.workspaceId
    ? and(
        eq(notificationsTable.id, params.data.id),
        eq(notificationsTable.userId, req.userId!),
        eq(notificationsTable.workspaceId, req.workspaceId),
      )
    : and(eq(notificationsTable.id, params.data.id), eq(notificationsTable.userId, req.userId!));

  const [notification] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(markWhere)
    .returning();

  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  res.json(notification);
});

// Delete a single notification
router.delete("/notifications/:id", requireAuth, requirePermission("notifications.view"), async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const deleteWhere = req.workspaceId
    ? and(
        eq(notificationsTable.id, id),
        eq(notificationsTable.userId, req.userId!),
        eq(notificationsTable.workspaceId, req.workspaceId),
      )
    : and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.userId!));

  await db.delete(notificationsTable).where(deleteWhere);

  res.status(204).end();
});

// Delete multiple notifications by IDs
router.post("/notifications/delete-many", requireAuth, requirePermission("notifications.view"), async (req: AuthRequest, res): Promise<void> => {
  const { ids } = req.body as { ids?: unknown };

  if (!Array.isArray(ids) || ids.some(x => typeof x !== "number")) {
    res.status(400).json({ error: "ids must be an array of integers" });
    return;
  }

  const numIds = ids as number[];
  if (numIds.length === 0) {
    res.status(204).end();
    return;
  }

  const deleteManyWhere = req.workspaceId
    ? and(
        inArray(notificationsTable.id, numIds),
        eq(notificationsTable.userId, req.userId!),
        eq(notificationsTable.workspaceId, req.workspaceId),
      )
    : and(inArray(notificationsTable.id, numIds), eq(notificationsTable.userId, req.userId!));

  await db.delete(notificationsTable).where(deleteManyWhere);

  res.status(204).end();
});

export default router;
