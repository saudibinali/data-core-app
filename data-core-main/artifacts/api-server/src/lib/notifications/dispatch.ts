import { db } from "@workspace/db";
import {
  notificationsTable,
  notificationJobsTable,
  notificationDeliveriesTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { emitToUser } from "../sse";
import { logger } from "../logger";

export type DispatchUserNotificationInput = {
  workspaceId: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  ticketId?: number | null;
  busEventId?: string | null;
  /** Enqueue async email when template key set and user has email */
  emailTemplateKey?: string;
  templateVars?: Record<string, string>;
  enqueueEmail?: boolean;
};

async function resolveUserEmail(userId: number): Promise<string | null> {
  const [u] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.email ?? null;
}

/**
 * Immediate in-app notification + optional email job enqueue.
 * Preserves SSE behavior; does not break existing notification rows.
 */
export async function dispatchUserNotification(
  input: DispatchUserNotificationInput,
): Promise<{ notificationId: number } | null> {
  const {
    workspaceId,
    userId,
    type,
    title,
    message,
    ticketId,
    busEventId,
    emailTemplateKey,
    templateVars,
    enqueueEmail = Boolean(emailTemplateKey),
  } = input;

  const [inserted] = await db
    .insert(notificationsTable)
    .values({
      userId,
      workspaceId,
      type,
      title,
      message,
      ticketId: ticketId ?? null,
      busEventId: busEventId ?? null,
    })
    .returning({ id: notificationsTable.id });

  if (!inserted) return null;

  await db.insert(notificationDeliveriesTable).values({
    workspaceId,
    notificationId: inserted.id,
    channel: "in_app",
    recipientUserId: userId,
    status: "sent",
    sentAt: new Date(),
  });

  emitToUser(userId, "notification");

  if (enqueueEmail && emailTemplateKey) {
    const email = await resolveUserEmail(userId);
    if (email) {
      const idempotencyKey = busEventId
        ? `${busEventId}:email:${userId}`
        : `manual:email:${inserted.id}`;

      try {
        const [job] = await db
          .insert(notificationJobsTable)
          .values({
            workspaceId,
            idempotencyKey,
            eventType: type,
            channel: "email",
            status: "pending",
            recipientUserId: userId,
            recipientEmail: email,
            templateKey: emailTemplateKey,
            payloadJson: JSON.stringify({
              title,
              message,
              ...(templateVars ?? {}),
            }),
            busEventId: busEventId ?? null,
            notificationId: inserted.id,
          })
          .onConflictDoNothing()
          .returning({ id: notificationJobsTable.id });

        if (job) {
          await db.insert(notificationDeliveriesTable).values({
            workspaceId,
            notificationJobId: job.id,
            notificationId: inserted.id,
            channel: "email",
            recipientUserId: userId,
            recipientEmail: email,
            status: "pending",
          });
          await db
            .update(notificationsTable)
            .set({ notificationJobId: job.id })
            .where(eq(notificationsTable.id, inserted.id));
        }
      } catch (err) {
        logger.warn({ err, userId, emailTemplateKey }, "[dispatch] email job enqueue failed");
      }
    }
  }

  return { notificationId: inserted.id };
}

/** Batch helper used by notifications-bus */
export async function dispatchUserNotifications(
  workspaceId: number,
  rows: Array<Omit<DispatchUserNotificationInput, "workspaceId">>,
): Promise<void> {
  for (const row of rows) {
    await dispatchUserNotification({ workspaceId, ...row });
  }
}
