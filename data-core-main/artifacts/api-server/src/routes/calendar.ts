import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  calendarEventsTable,
  calendarEventParticipantsTable,
  usersTable,
  notificationsTable,
  messagesTable,
  messageRecipientsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Build Event Detail ────────────────────────────────────────────────────────

async function buildEventDetail(eventId: number, currentUserId?: number) {
  const [event] = await db
    .select()
    .from(calendarEventsTable)
    .where(eq(calendarEventsTable.id, eventId));
  if (!event) return null;

  const participants = await db
    .select({
      id:              calendarEventParticipantsTable.id,
      userId:          calendarEventParticipantsTable.userId,
      participantType: calendarEventParticipantsTable.participantType,
      status:          calendarEventParticipantsTable.status,
      rsvpNote:        calendarEventParticipantsTable.rsvpNote,
      fullName:        usersTable.fullName,
      avatarUrl:       usersTable.avatarUrl,
    })
    .from(calendarEventParticipantsTable)
    .leftJoin(usersTable, eq(calendarEventParticipantsTable.userId, usersTable.id))
    .where(eq(calendarEventParticipantsTable.eventId, eventId));

  const [creator] = event.createdByUserId
    ? await db.select({ fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, event.createdByUserId))
    : [];

  const myParticipant = currentUserId
    ? participants.find(p => p.userId === currentUserId)
    : undefined;

  return {
    ...event,
    creatorName:        creator?.fullName ?? "",
    creatorAvatar:      creator?.avatarUrl ?? null,
    participants,
    currentUserStatus:  myParticipant?.status ?? null,
    currentUserNote:    myParticipant?.rsvpNote ?? null,
  };
}

// ─── Send Invitations (inbox message + notification) ──────────────────────────

async function sendInvitations(
  workspaceId: number,
  senderId: number,
  eventId: number,
  title: string,
  startAt: Date,
  invitationMessage: string | null | undefined,
  mainUserIds: number[],
  ccUserIds: number[],
  meetingLink?: string | null,
) {
  const safeMain = Array.isArray(mainUserIds) ? mainUserIds : [];
  const safeCc   = Array.isArray(ccUserIds)   ? ccUserIds   : [];
  const toNotify = [...safeMain, ...safeCc].filter(uid => uid !== senderId);
  if (toNotify.length === 0) return;

  const startStr = startAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  let defaultBody = `You have been invited to the following event:\n\n📅 ${title}\n🕐 ${startStr}`;
  if (meetingLink) {
    defaultBody += `\n\n🔗 Join the meeting: ${meetingLink}`;
  }
  defaultBody += `\n\n➡️ Open the Calendar to accept or decline this invitation.`;

  const body = (invitationMessage !== null && invitationMessage !== undefined && invitationMessage.trim() !== "")
    ? `${invitationMessage}\n\n---\n📅 ${title}\n🕐 ${startStr}${meetingLink ? `\n🔗 Join: ${meetingLink}` : ""}\n\n➡️ Open the Calendar to accept or decline.`
    : defaultBody;

  // Create a single internal message (inbox mail) for the invitation
  let msgId: number | null = null;
  try {
    const inserted = await db.insert(messagesTable).values({
      workspaceId,
      senderId,
      subject: `📅 Event Invitation: ${title}`,
      body,
      status:      "sent",
      isImportant: true,
      isPinned:    false,
      attachments: [],
    }).returning({ id: messagesTable.id });

    msgId = inserted[0]?.id ?? null;

    if (msgId !== null) {
      const recipientRows = [
        ...safeMain.filter(uid => uid !== senderId).map(uid => ({ messageId: msgId!, userId: uid, recipientType: "to"  as const })),
        ...safeCc.filter(  uid => uid !== senderId).map(uid => ({ messageId: msgId!, userId: uid, recipientType: "cc"  as const })),
      ];
      if (recipientRows.length > 0) {
        await db.insert(messageRecipientsTable).values(recipientRows).onConflictDoNothing();
      }
      logger.info({ eventId, msgId, recipients: recipientRows.length }, "sendInvitations: invitation message delivered to inbox");
    } else {
      logger.warn({ eventId, workspaceId }, "sendInvitations: insert returned no rows - message not created");
    }
  } catch (err) {
    logger.error({ err, eventId, workspaceId }, "sendInvitations: failed to create invitation message");
  }

  // In-app notifications (always sent, regardless of message creation outcome)
  try {
    await db.insert(notificationsTable).values(
      toNotify.map(uid => ({
        userId: uid,
        type:    "calendar",
        title:   "Calendar Invitation",
        message: `You have been invited to: ${title}`,
      }))
    );
  } catch (err) {
    logger.error({ err, eventId }, "sendInvitations: failed to create notifications");
  }
}

// ─── GET /calendar/events ─────────────────────────────────────────────────────

import { gte, lte } from "drizzle-orm";

router.get("/calendar/events", requireAuth, requirePermission("calendar.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId || !req.workspaceId) { res.json([]); return; }

  const { start, end } = req.query as { start?: string; end?: string };

  let query = db
    .select()
    .from(calendarEventsTable)
    .where(eq(calendarEventsTable.workspaceId, req.workspaceId))
    .$dynamic();

  if (start) query = query.where(gte(calendarEventsTable.startAt, new Date(start)));
  if (end)   query = query.where(lte(calendarEventsTable.endAt,   new Date(end)));

  const events = await query.orderBy(calendarEventsTable.startAt);
  const withParticipants = await Promise.all(events.map(e => buildEventDetail(e.id, req.userId)));
  res.json(withParticipants.filter(Boolean));
});

// ─── POST /calendar/events ────────────────────────────────────────────────────

router.post("/calendar/events", requireAuth, requirePermission("calendar.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId || !req.workspaceId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const {
    title, description, invitationMessage, startAt, endAt, isAllDay,
    eventType, location, meetingLink,
    priority, status, notes, participantUserIds, ccUserIds, attachments,
  } = req.body;

  if (!title || !startAt || !endAt) {
    res.status(400).json({ error: "title, startAt, endAt are required" });
    return;
  }

  const eventStatus = status ?? "scheduled";

  const [event] = await db.insert(calendarEventsTable).values({
    workspaceId:       req.workspaceId,
    title,
    description:       description ?? null,
    invitationMessage: invitationMessage ?? null,
    startAt:           new Date(startAt),
    endAt:             new Date(endAt),
    isAllDay:          isAllDay ?? false,
    eventType:         eventType ?? "in_person",
    location:          location ?? null,
    meetingLink:       meetingLink ?? null,
    priority:          priority ?? "medium",
    status:            eventStatus,
    notes:             notes ?? null,
    attachments:       attachments ?? [],
    createdByUserId:   req.userId,
  }).returning();

  const mainIds: number[] = Array.from(new Set([req.userId, ...(Array.isArray(participantUserIds) ? participantUserIds : [])]));
  const ccIds:   number[] = Array.from(new Set(Array.isArray(ccUserIds) ? ccUserIds : []));

  const allRows = [
    ...mainIds.map(uid => ({ eventId: event.id, userId: uid, participantType: "main" as const, status: uid === req.userId ? "accepted" : "invited" })),
    ...ccIds.filter(uid => !mainIds.includes(uid)).map(uid => ({ eventId: event.id, userId: uid, participantType: "cc" as const, status: "invited" as const })),
  ];

  if (allRows.length > 0) {
    await db.insert(calendarEventParticipantsTable).values(allRows).onConflictDoNothing();
  }

  // Send invitations only when status = scheduled
  if (eventStatus === "scheduled") {
    await sendInvitations(
      req.workspaceId,
      req.userId,
      event.id,
      title,
      new Date(startAt),
      invitationMessage,
      mainIds,
      ccIds,
      meetingLink,
    );
  }

  const detail = await buildEventDetail(event.id, req.userId);
  res.status(201).json(detail);
});

// ─── GET /calendar/events/:id ─────────────────────────────────────────────────

router.get("/calendar/events/:id", requireAuth, requirePermission("calendar.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const detail = await buildEventDetail(id, req.userId);
  if (!detail) { res.status(404).json({ error: "Not found" }); return; }
  res.json(detail);
});

// ─── PATCH /calendar/events/:id ───────────────────────────────────────────────

router.patch("/calendar/events/:id", requireAuth, requirePermission("calendar.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  // Fetch old event to detect draft→scheduled transition
  const [oldEvent] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!oldEvent) { res.status(404).json({ error: "Not found" }); return; }

  const {
    title, description, invitationMessage, startAt, endAt, isAllDay,
    eventType, location, meetingLink,
    priority, status, notes, participantUserIds, ccUserIds, attachments,
  } = req.body;

  const updates: any = {};
  if (title             !== undefined) updates.title             = title;
  if (description       !== undefined) updates.description       = description;
  if (invitationMessage !== undefined) updates.invitationMessage = invitationMessage;
  if (startAt           !== undefined) updates.startAt           = new Date(startAt);
  if (endAt             !== undefined) updates.endAt             = new Date(endAt);
  if (isAllDay          !== undefined) updates.isAllDay          = isAllDay;
  if (eventType         !== undefined) updates.eventType         = eventType;
  if (location          !== undefined) updates.location          = location;
  if (meetingLink       !== undefined) updates.meetingLink       = meetingLink;
  if (priority          !== undefined) updates.priority          = priority;
  if (status            !== undefined) updates.status            = status;
  if (notes             !== undefined) updates.notes             = notes;
  if (attachments       !== undefined) updates.attachments       = attachments;

  if (Object.keys(updates).length > 0) {
    await db.update(calendarEventsTable).set(updates).where(eq(calendarEventsTable.id, id));
  }

  // Replace participants if provided
  if (Array.isArray(participantUserIds) || Array.isArray(ccUserIds)) {
    await db.delete(calendarEventParticipantsTable).where(eq(calendarEventParticipantsTable.eventId, id));

    const mainIds: number[] = Array.from(new Set([req.userId, ...(Array.isArray(participantUserIds) ? participantUserIds : [])]));
    const ccIds:   number[] = Array.from(new Set(Array.isArray(ccUserIds) ? ccUserIds : []));

    const allRows = [
      ...mainIds.map(uid => ({ eventId: id, userId: uid, participantType: "main" as const, status: uid === req.userId ? "accepted" : "invited" })),
      ...ccIds.filter(uid => !mainIds.includes(uid)).map(uid => ({ eventId: id, userId: uid, participantType: "cc" as const, status: "invited" as const })),
    ];
    if (allRows.length > 0) {
      await db.insert(calendarEventParticipantsTable).values(allRows).onConflictDoNothing();
    }

    // If transitioning from draft → scheduled, send invitations now
    if (oldEvent.status === "draft" && updates.status === "scheduled") {
      const eventTitle   = updates.title ?? oldEvent.title;
      const eventStartAt = updates.startAt ?? oldEvent.startAt;
      const eventMsg     = updates.invitationMessage ?? oldEvent.invitationMessage;
      const eventLink    = updates.meetingLink ?? oldEvent.meetingLink;
      await sendInvitations(
        oldEvent.workspaceId,
        req.userId,
        id,
        eventTitle,
        eventStartAt,
        eventMsg,
        mainIds,
        ccIds,
        eventLink,
      );
    }
  } else if (oldEvent.status === "draft" && updates.status === "scheduled") {
    const existing = await db
      .select({ userId: calendarEventParticipantsTable.userId, participantType: calendarEventParticipantsTable.participantType })
      .from(calendarEventParticipantsTable)
      .where(eq(calendarEventParticipantsTable.eventId, id));

    const mainIds = existing.filter(p => p.participantType === "main").map(p => p.userId);
    const ccIds   = existing.filter(p => p.participantType === "cc").map(p => p.userId);
    const eventTitle   = updates.title ?? oldEvent.title;
    const eventStartAt = updates.startAt ?? oldEvent.startAt;
    const eventMsg     = updates.invitationMessage ?? oldEvent.invitationMessage;
    const eventLink    = updates.meetingLink ?? oldEvent.meetingLink;
    await sendInvitations(oldEvent.workspaceId, req.userId, id, eventTitle, eventStartAt, eventMsg, mainIds, ccIds, eventLink);
  }

  const detail = await buildEventDetail(id, req.userId);
  if (!detail) { res.status(404).json({ error: "Not found" }); return; }
  res.json(detail);
});

// ─── DELETE /calendar/events/:id ──────────────────────────────────────────────

router.delete("/calendar/events/:id", requireAuth, requirePermission("calendar.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  res.json({ ok: true });
});

// ─── POST /calendar/events/:id/rsvp ──────────────────────────────────────────

router.post("/calendar/events/:id/rsvp", requireAuth, requirePermission("calendar.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { status, note } = req.body as { status: "accepted" | "declined"; note?: string };

  if (status !== "accepted" && status !== "declined") {
    res.status(400).json({ error: "status must be accepted or declined" });
    return;
  }
  if (status === "declined" && (!note || note.trim() === "")) {
    res.status(400).json({ error: "A note is required when declining" });
    return;
  }

  // Find the participant row for this user
  const [participant] = await db
    .select()
    .from(calendarEventParticipantsTable)
    .where(and(
      eq(calendarEventParticipantsTable.eventId, id),
      eq(calendarEventParticipantsTable.userId, req.userId),
    ));

  if (!participant) {
    res.status(403).json({ error: "You are not a participant of this event" });
    return;
  }

  await db
    .update(calendarEventParticipantsTable)
    .set({ status, rsvpNote: note ?? null })
    .where(eq(calendarEventParticipantsTable.id, participant.id));

  // Notify the event organiser
  const [event] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (event && event.createdByUserId !== req.userId) {
    const [respondent] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, req.userId));
    const verb = status === "accepted" ? "accepted" : "declined";
    try {
      await db.insert(notificationsTable).values({
        userId:  event.createdByUserId!,
        type:    "calendar",
        title:   `RSVP: ${event.title}`,
        message: `${respondent?.fullName ?? "A participant"} has ${verb} the invitation${status === "declined" && note ? `: "${note}"` : "."}`,
      });
    } catch (err) {
      logger.error({ err, eventId: id }, "rsvp: failed to notify organiser");
    }
  }

  const detail = await buildEventDetail(id, req.userId);
  res.json(detail);
});

export default router;
