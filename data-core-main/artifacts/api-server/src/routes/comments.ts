import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { commentsTable, usersTable, activityLogsTable, notificationsTable, ticketsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateCommentBody, CreateCommentParams, UpdateCommentBody, UpdateCommentParams, DeleteCommentParams } from "@workspace/api-zod";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/tickets/:ticketId/comments", requireAuth, requirePermission("tickets.view"), async (req, res): Promise<void> => {
  const ticketId = parseInt(req.params.ticketId as string, 10);
  if (isNaN(ticketId)) {
    res.status(400).json({ error: "Invalid ticket ID" });
    return;
  }

  const comments = await db
    .select({
      id: commentsTable.id,
      ticketId: commentsTable.ticketId,
      authorId: commentsTable.authorId,
      authorName: usersTable.fullName,
      authorAvatarUrl: usersTable.avatarUrl,
      content: commentsTable.content,
      isInternal: commentsTable.isInternal,
      createdAt: commentsTable.createdAt,
      updatedAt: commentsTable.updatedAt,
    })
    .from(commentsTable)
    .leftJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
    .where(eq(commentsTable.ticketId, ticketId))
    .orderBy(commentsTable.createdAt);

  res.json(comments);
});

router.post("/tickets/:ticketId/comments", requireAuth, requirePermission("tickets.edit"), async (req: AuthRequest, res): Promise<void> => {
  const params = CreateCommentParams.safeParse({ ticketId: req.params.ticketId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!req.userId) {
    res.status(401).json({ error: "User profile not found" });
    return;
  }

  const [comment] = await db.insert(commentsTable).values({
    ticketId: params.data.ticketId,
    authorId: req.userId,
    content: parsed.data.content,
    isInternal: parsed.data.isInternal ?? false,
  }).returning();

  await db.insert(activityLogsTable).values({
    ticketId: params.data.ticketId,
    userId: req.userId,
    action: "comment_added",
  });

  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, params.data.ticketId));
  if (ticket && ticket.createdByUserId !== req.userId) {
    await db.insert(notificationsTable).values({
      userId: ticket.createdByUserId,
      type: "comment_added",
      title: "New Comment on Your Ticket",
      message: `A new comment was added to: ${ticket.title}`,
      ticketId: params.data.ticketId,
    });
  }

  const [full] = await db
    .select({
      id: commentsTable.id,
      ticketId: commentsTable.ticketId,
      authorId: commentsTable.authorId,
      authorName: usersTable.fullName,
      authorAvatarUrl: usersTable.avatarUrl,
      content: commentsTable.content,
      isInternal: commentsTable.isInternal,
      createdAt: commentsTable.createdAt,
      updatedAt: commentsTable.updatedAt,
    })
    .from(commentsTable)
    .leftJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
    .where(eq(commentsTable.id, comment!.id));

  res.status(201).json(full);
});

router.patch("/tickets/:ticketId/comments/:commentId", requireAuth, requirePermission("tickets.edit"), async (req: AuthRequest, res): Promise<void> => {
  const params = UpdateCommentParams.safeParse({ ticketId: req.params.ticketId, commentId: req.params.commentId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [comment] = await db
    .update(commentsTable)
    .set({ content: parsed.data.content })
    .where(and(eq(commentsTable.id, params.data.commentId), eq(commentsTable.ticketId, params.data.ticketId)))
    .returning();

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const [full] = await db
    .select({
      id: commentsTable.id,
      ticketId: commentsTable.ticketId,
      authorId: commentsTable.authorId,
      authorName: usersTable.fullName,
      authorAvatarUrl: usersTable.avatarUrl,
      content: commentsTable.content,
      isInternal: commentsTable.isInternal,
      createdAt: commentsTable.createdAt,
      updatedAt: commentsTable.updatedAt,
    })
    .from(commentsTable)
    .leftJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
    .where(eq(commentsTable.id, comment.id));

  res.json(full);
});

router.delete("/tickets/:ticketId/comments/:commentId", requireAuth, requirePermission("tickets.edit"), async (req, res): Promise<void> => {
  const params = DeleteCommentParams.safeParse({ ticketId: req.params.ticketId, commentId: req.params.commentId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [comment] = await db
    .delete(commentsTable)
    .where(and(eq(commentsTable.id, params.data.commentId), eq(commentsTable.ticketId, params.data.ticketId)))
    .returning();

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
