import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { messagesTable, messageRecipientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, and, or, desc, inArray, sql, ne } from "drizzle-orm";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { emitToUsers } from "../lib/sse";

const router: IRouter = Router();

function stripHtml(html: string): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

const senderFields = {
  id: messagesTable.id,
  workspaceId: messagesTable.workspaceId,
  senderId: messagesTable.senderId,
  senderName: usersTable.fullName,
  senderAvatar: usersTable.avatarUrl,
  subject: messagesTable.subject,
  body: messagesTable.body,
  status: messagesTable.status,
  isPinned: messagesTable.isPinned,
  isImportant: messagesTable.isImportant,
  attachments: messagesTable.attachments,
  parentId: messagesTable.parentId,
  relatedTicketId: messagesTable.relatedTicketId,
  replyCount: sql<number>`(SELECT count(*)::int FROM messages r WHERE r.parent_id = ${messagesTable.id})`,
  createdAt: messagesTable.createdAt,
  updatedAt: messagesTable.updatedAt,
};

async function buildSummary(msg: any, userId: number) {
  const [recipient] = await db
    .select({ isRead: messageRecipientsTable.isRead, isArchivedByRecipient: messageRecipientsTable.isArchivedByRecipient })
    .from(messageRecipientsTable)
    .where(and(eq(messageRecipientsTable.messageId, msg.id), eq(messageRecipientsTable.userId, userId)));

  // For sent/draft messages owned by the user, fetch recipient names
  let recipientPreview = "";
  if (msg.senderId === userId) {
    const toRecipients = await db
      .select({ fullName: usersTable.fullName })
      .from(messageRecipientsTable)
      .leftJoin(usersTable, eq(messageRecipientsTable.userId, usersTable.id))
      .where(and(
        eq(messageRecipientsTable.messageId, msg.id),
        eq(messageRecipientsTable.recipientType, "to")
      ));
    recipientPreview = toRecipients.map(r => r.fullName ?? "").filter(Boolean).join(", ");
  }

  return {
    ...msg,
    bodyPreview: stripHtml(String(msg.body ?? "")).slice(0, 200),
    recipientPreview,
    isRead: recipient?.isRead ?? (msg.senderId === userId),
    isArchivedByRecipient: recipient?.isArchivedByRecipient ?? false,
  };
}

async function buildDetail(msgId: number, userId: number) {
  const [msg] = await db
    .select(senderFields)
    .from(messagesTable)
    .leftJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(eq(messagesTable.id, msgId));

  if (!msg) return null;

  const recipients = await db
    .select({
      userId: messageRecipientsTable.userId,
      fullName: usersTable.fullName,
      avatarUrl: usersTable.avatarUrl,
      recipientType: messageRecipientsTable.recipientType,
      isRead: messageRecipientsTable.isRead,
    })
    .from(messageRecipientsTable)
    .leftJoin(usersTable, eq(messageRecipientsTable.userId, usersTable.id))
    .where(eq(messageRecipientsTable.messageId, msgId));

  const [recipient] = await db
    .select({ isRead: messageRecipientsTable.isRead, isArchivedByRecipient: messageRecipientsTable.isArchivedByRecipient })
    .from(messageRecipientsTable)
    .where(and(eq(messageRecipientsTable.messageId, msgId), eq(messageRecipientsTable.userId, userId)));

  const replyRows = await db
    .select(senderFields)
    .from(messagesTable)
    .leftJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(eq(messagesTable.parentId, msgId))
    .orderBy(messagesTable.createdAt);

  const replies = await Promise.all(replyRows.map(async (r) => {
    const [rRecipient] = await db.select({ isRead: messageRecipientsTable.isRead, isArchivedByRecipient: messageRecipientsTable.isArchivedByRecipient })
      .from(messageRecipientsTable)
      .where(and(eq(messageRecipientsTable.messageId, r.id), eq(messageRecipientsTable.userId, userId)));
    return {
      ...r,
      bodyPreview: String(r.body ?? "").slice(0, 200),
      isRead: rRecipient?.isRead ?? (r.senderId === userId),
      isArchivedByRecipient: rRecipient?.isArchivedByRecipient ?? false,
      recipients: [],
      replies: [],
    };
  }));

  return {
    ...msg,
    bodyPreview: stripHtml(String(msg.body ?? "")).slice(0, 200),
    isRead: recipient?.isRead ?? (msg.senderId === userId),
    isArchivedByRecipient: recipient?.isArchivedByRecipient ?? false,
    recipients,
    replies,
  };
}

// ─── GET /messages?folder=inbox|sent|drafts|important|archived ────────────────
router.get("/messages", requireAuth, requirePermission("messages.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId || !req.workspaceId) { res.json([]); return; }
  const folder = (req.query.folder as string) || "inbox";

  let rows: any[] = [];

  if (folder === "sent") {
    rows = await db
      .select(senderFields)
      .from(messagesTable)
      .leftJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
      .where(and(
        eq(messagesTable.workspaceId, req.workspaceId),
        eq(messagesTable.senderId, req.userId),
        eq(messagesTable.status, "sent"),
        sql`${messagesTable.parentId} IS NULL`
      ))
      .orderBy(desc(messagesTable.createdAt));
  } else if (folder === "drafts") {
    rows = await db
      .select(senderFields)
      .from(messagesTable)
      .leftJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
      .where(and(
        eq(messagesTable.workspaceId, req.workspaceId),
        eq(messagesTable.senderId, req.userId),
        eq(messagesTable.status, "draft")
      ))
      .orderBy(desc(messagesTable.updatedAt));
  } else {
    const recipientRows = await db
      .select({ messageId: messageRecipientsTable.messageId, isRead: messageRecipientsTable.isRead, isArchivedByRecipient: messageRecipientsTable.isArchivedByRecipient })
      .from(messageRecipientsTable)
      .where(eq(messageRecipientsTable.userId, req.userId));

    const relevantIds = recipientRows
      .filter(r => folder === "archived" ? r.isArchivedByRecipient : !r.isArchivedByRecipient)
      .filter(r => folder === "important" ? true : true)
      .map(r => r.messageId);

    if (relevantIds.length === 0) { res.json([]); return; }

    rows = await db
      .select(senderFields)
      .from(messagesTable)
      .leftJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
      .where(and(
        inArray(messagesTable.id, relevantIds),
        eq(messagesTable.status, "sent"),
        sql`${messagesTable.parentId} IS NULL`,
        folder === "important" ? eq(messagesTable.isImportant, true) : sql`1=1`
      ))
      .orderBy(desc(messagesTable.createdAt));

    const readMap = new Map(recipientRows.map(r => [r.messageId, { isRead: r.isRead, isArchivedByRecipient: r.isArchivedByRecipient }]));
    rows = rows.map(r => ({
      ...r,
      bodyPreview: stripHtml(String(r.body ?? "")).slice(0, 200),
      isRead: readMap.get(r.id)?.isRead ?? false,
      isArchivedByRecipient: readMap.get(r.id)?.isArchivedByRecipient ?? false,
    }));
    res.json(rows);
    return;
  }

  const summaries = await Promise.all(rows.map(r => buildSummary(r, req.userId!)));
  res.json(summaries);
});

// ─── GET /messages/unread-count ───────────────────────────────────────────────
router.get("/messages/unread-count", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) { res.json({ count: 0 }); return; }
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messageRecipientsTable)
    .leftJoin(messagesTable, eq(messageRecipientsTable.messageId, messagesTable.id))
    .where(and(
      eq(messageRecipientsTable.userId, req.userId),
      eq(messageRecipientsTable.isRead, false),
      eq(messageRecipientsTable.isArchivedByRecipient, false),
      eq(messagesTable.status, "sent"),
      sql`${messagesTable.parentId} IS NULL`
    ));
  res.json({ count: row?.count ?? 0 });
});

// ─── POST /messages ───────────────────────────────────────────────────────────
router.post("/messages", requireAuth, requirePermission("messages.send"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId || !req.workspaceId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { subject, body, toUserIds = [], ccUserIds = [], status = "sent", isImportant = false, relatedTicketId, attachments = [] } = req.body;
  if (!body && status === "sent") { res.status(400).json({ error: "Body is required" }); return; }

  const [msg] = await db.insert(messagesTable).values({
    workspaceId: req.workspaceId,
    senderId: req.userId,
    subject: subject || "(No subject)",
    body: body || "",
    status,
    isImportant: Boolean(isImportant),
    relatedTicketId: relatedTicketId ?? null,
    attachments: Array.isArray(attachments) ? attachments : [],
  }).returning();

  if (status === "sent") {
    const allRecipients = [
      ...toUserIds.map((uid: number) => ({ messageId: msg!.id, userId: uid, recipientType: "to" })),
      ...ccUserIds.map((uid: number) => ({ messageId: msg!.id, userId: uid, recipientType: "cc" })),
    ];
    if (allRecipients.length > 0) {
      await db.insert(messageRecipientsTable).values(allRecipients).onConflictDoNothing();
      await db.insert(notificationsTable).values(
        allRecipients.map((r) => ({
          userId: r.userId,
          type: "message",
          title: "New message",
          message: `New message: ${subject || "(No subject)"}`,
        }))
      );
      const recipientIds = allRecipients.map(r => r.userId);
      emitToUsers(recipientIds, "notification");
      emitToUsers(recipientIds, "message");
    }
  }

  const detail = await buildDetail(msg!.id, req.userId);
  res.status(201).json(detail);
});

// ─── GET /messages/:id ────────────────────────────────────────────────────────
router.get("/messages/:id", requireAuth, requirePermission("messages.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const detail = await buildDetail(id, req.userId);
  if (!detail) { res.status(404).json({ error: "Message not found" }); return; }

  // Auto-mark as read for recipients
  await db.update(messageRecipientsTable)
    .set({ isRead: true })
    .where(and(eq(messageRecipientsTable.messageId, id), eq(messageRecipientsTable.userId, req.userId)));

  res.json({ ...detail, isRead: true });
});

// ─── PATCH /messages/:id ──────────────────────────────────────────────────────
router.patch("/messages/:id", requireAuth, requirePermission("messages.send"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { isRead, isPinned, isImportant, isArchivedByRecipient, status, subject, body, toUserIds, ccUserIds, attachments } = req.body;

  // Handle draft → sent transition before updating the message
  if (status === "sent") {
    const [currentMsg] = await db.select().from(messagesTable).where(eq(messagesTable.id, id));
    if (currentMsg?.status === "draft") {
      // Replace or insert recipients
      if (Array.isArray(toUserIds) || Array.isArray(ccUserIds)) {
        await db.delete(messageRecipientsTable).where(eq(messageRecipientsTable.messageId, id));
        const allRecipients = [
          ...(toUserIds ?? []).map((uid: number) => ({ messageId: id, userId: uid, recipientType: "to" as const })),
          ...(ccUserIds ?? []).map((uid: number) => ({ messageId: id, userId: uid, recipientType: "cc" as const })),
        ];
        if (allRecipients.length > 0) {
          await db.insert(messageRecipientsTable).values(allRecipients).onConflictDoNothing();
        }
      }
      // Send notifications to all recipients
      const recipients = await db
        .select({ userId: messageRecipientsTable.userId })
        .from(messageRecipientsTable)
        .where(eq(messageRecipientsTable.messageId, id));
      if (recipients.length > 0) {
        const msgSubject = subject ?? currentMsg.subject;
        await db.insert(notificationsTable).values(
          recipients.map(r => ({
            userId: r.userId,
            type: "message",
            title: "New message",
            message: `New message: ${msgSubject}`,
          }))
        );
        const recipientIds = recipients.map(r => r.userId);
        emitToUsers(recipientIds, "notification");
        emitToUsers(recipientIds, "message");
      }
    }
  }

  if (isPinned !== undefined || isImportant !== undefined || status !== undefined || subject !== undefined || body !== undefined || attachments !== undefined) {
    const msgUpdates: any = {};
    if (isPinned !== undefined) msgUpdates.isPinned = isPinned;
    if (isImportant !== undefined) msgUpdates.isImportant = isImportant;
    if (status !== undefined) msgUpdates.status = status;
    if (subject !== undefined) msgUpdates.subject = subject;
    if (body !== undefined) msgUpdates.body = body;
    if (attachments !== undefined) msgUpdates.attachments = Array.isArray(attachments) ? attachments : [];
    if (Object.keys(msgUpdates).length > 0) {
      await db.update(messagesTable).set(msgUpdates).where(eq(messagesTable.id, id));
    }
  }

  if (isRead !== undefined || isArchivedByRecipient !== undefined) {
    const recipientUpdates: any = {};
    if (isRead !== undefined) recipientUpdates.isRead = isRead;
    if (isArchivedByRecipient !== undefined) recipientUpdates.isArchivedByRecipient = isArchivedByRecipient;
    await db.update(messageRecipientsTable)
      .set(recipientUpdates)
      .where(and(eq(messageRecipientsTable.messageId, id), eq(messageRecipientsTable.userId, req.userId)));
  }

  const detail = await buildDetail(id, req.userId);
  if (!detail) { res.status(404).json({ error: "Message not found" }); return; }
  res.json(detail);
});

// ─── DELETE /messages/:id ─────────────────────────────────────────────────────
router.delete("/messages/:id", requireAuth, requirePermission("messages.send"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.update(messagesTable).set({ status: "deleted" })
    .where(and(eq(messagesTable.id, id), eq(messagesTable.senderId, req.userId)));
  res.status(204).send();
});

// ─── POST /messages/:id/replies ───────────────────────────────────────────────
router.post("/messages/:id/replies", requireAuth, requirePermission("messages.send"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId || !req.workspaceId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parentId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(parentId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { body, toUserIds, ccUserIds, attachments = [] } = req.body;
  if (!body) { res.status(400).json({ error: "Body is required" }); return; }

  const [parent] = await db.select().from(messagesTable).where(eq(messagesTable.id, parentId));
  if (!parent) { res.status(404).json({ error: "Parent message not found" }); return; }

  const [reply] = await db.insert(messagesTable).values({
    workspaceId: req.workspaceId,
    senderId: req.userId,
    subject: `Re: ${parent.subject}`,
    body,
    status: "sent",
    parentId,
    attachments: Array.isArray(attachments) ? attachments : [],
  }).returning();

  const existingRecipients = await db
    .select({ userId: messageRecipientsTable.userId, recipientType: messageRecipientsTable.recipientType })
    .from(messageRecipientsTable)
    .where(eq(messageRecipientsTable.messageId, parentId));

  const allRecipientIds = new Set<number>();
  const recipientMap = new Map<number, string>();
  existingRecipients.forEach(r => { allRecipientIds.add(r.userId); recipientMap.set(r.userId, r.recipientType); });
  if (parent.senderId != null) { allRecipientIds.add(parent.senderId); recipientMap.set(parent.senderId, "to"); }
  allRecipientIds.delete(req.userId);

  if (toUserIds?.length) toUserIds.forEach((id: number) => { allRecipientIds.add(id); recipientMap.set(id, "to"); });
  if (ccUserIds?.length) ccUserIds.forEach((id: number) => { allRecipientIds.add(id); recipientMap.set(id, "cc"); });

  const toInsert = [...allRecipientIds].map(uid => ({
    messageId: reply!.id,
    userId: uid,
    recipientType: recipientMap.get(uid) ?? "to",
  }));

  if (toInsert.length > 0) {
    // 1. Insert recipients for the reply itself
    await db.insert(messageRecipientsTable).values(toInsert).onConflictDoNothing();

    // 2. ── Core fix: mark the PARENT thread as unread for every participant ──
    //    The inbox query filters `parentId IS NULL`, so replies (which have
    //    parentId set) are never shown directly.  Instead, the parent thread
    //    must appear as unread so the recipient can open it and read the reply.
    //
    //    For each reply recipient:
    //    • If they are already a recipient of the parent (e.g. the original "to"
    //      user who got the first message) → flip isRead back to false.
    //    • If they are NOT yet a recipient of the parent (e.g. the original
    //      sender who only appears in "sent") → insert them so the parent thread
    //      surfaces in their inbox.
    await db
      .insert(messageRecipientsTable)
      .values(
        toInsert.map(r => ({
          messageId: parentId,
          userId: r.userId,
          recipientType: r.recipientType,
          isRead: false,
        }))
      )
      .onConflictDoUpdate({
        target: [messageRecipientsTable.messageId, messageRecipientsTable.userId],
        set: { isRead: false },
      });

    // 3. Send notifications + SSE push
    await db.insert(notificationsTable).values(
      toInsert.map(r => ({
        userId: r.userId,
        type: "message",
        title: "New reply",
        message: `Reply in: ${parent.subject}`,
      }))
    );
    const replyRecipientIds = toInsert.map(r => r.userId);
    emitToUsers(replyRecipientIds, "notification");
    emitToUsers(replyRecipientIds, "message");
  }

  // Also return the full parent thread so the frontend can refresh it
  const detail = await buildDetail(reply!.id, req.userId);
  res.status(201).json(detail);
});

export default router;
