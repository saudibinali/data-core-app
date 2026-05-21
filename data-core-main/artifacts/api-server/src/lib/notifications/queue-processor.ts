import { db } from "@workspace/db";
import {
  notificationJobsTable,
  notificationDeliveriesTable,
  notificationTemplatesTable,
} from "@workspace/db";
import { and, eq, lte, or } from "drizzle-orm";
import { workspaceMailer } from "../mail/workspace-mailer";
import { PLATFORM_EMAIL_TEMPLATES, renderTemplate } from "./templates";
import { logger } from "../logger";

const BATCH_SIZE = 20;
const RETRY_MINUTES = [1, 5, 15, 60, 240];

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let processing = false;

async function resolveTemplate(
  workspaceId: number,
  templateKey: string,
): Promise<{ subject: string; bodyHtml: string; bodyText?: string | null } | null> {
  const [wsTemplate] = await db
    .select()
    .from(notificationTemplatesTable)
    .where(
      and(
        eq(notificationTemplatesTable.workspaceId, workspaceId),
        eq(notificationTemplatesTable.templateKey, templateKey),
        eq(notificationTemplatesTable.channel, "email"),
        eq(notificationTemplatesTable.isActive, true),
      ),
    )
    .limit(1);
  if (wsTemplate) return wsTemplate;

  const platform = PLATFORM_EMAIL_TEMPLATES.find((t) => t.templateKey === templateKey);
  if (platform) return platform;

  return null;
}

async function processJob(job: typeof notificationJobsTable.$inferSelect): Promise<void> {
  await db
    .update(notificationJobsTable)
    .set({ status: "processing", attempts: job.attempts + 1 })
    .where(eq(notificationJobsTable.id, job.id));

  if (!job.recipientEmail || !job.templateKey) {
    await db
      .update(notificationJobsTable)
      .set({
        status: "failed",
        lastError: "Missing recipient email or template",
        processedAt: new Date(),
      })
      .where(eq(notificationJobsTable.id, job.id));
    return;
  }

  const template = await resolveTemplate(job.workspaceId, job.templateKey);
  if (!template) {
    await db
      .update(notificationJobsTable)
      .set({
        status: "failed",
        lastError: `Template not found: ${job.templateKey}`,
        processedAt: new Date(),
      })
      .where(eq(notificationJobsTable.id, job.id));
    return;
  }

  let vars: Record<string, string> = {};
  try {
    const payload = job.payloadJson ? JSON.parse(job.payloadJson) : {};
    vars = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, String(v)]),
    );
  } catch {
    vars = { message: job.payloadJson ?? "" };
  }

  const rendered = renderTemplate(template, vars);

  try {
    const result = await workspaceMailer.send(job.workspaceId, {
      to: job.recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (!result) {
      throw new Error("No SMTP transport available (workspace or platform)");
    }

    await db
      .update(notificationJobsTable)
      .set({ status: "sent", processedAt: new Date(), lastError: null })
      .where(eq(notificationJobsTable.id, job.id));

    await db
      .update(notificationDeliveriesTable)
      .set({
        status: "sent",
        sentAt: new Date(),
        providerMessageId: result.messageId ?? null,
      })
      .where(
        and(
          eq(notificationDeliveriesTable.notificationJobId, job.id),
          eq(notificationDeliveriesTable.channel, "email"),
        ),
      );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextAttempt = job.attempts + 1;
    const isDead = nextAttempt >= job.maxAttempts;
    const delayMin = RETRY_MINUTES[Math.min(nextAttempt - 1, RETRY_MINUTES.length - 1)] ?? 60;

    await db
      .update(notificationJobsTable)
      .set({
        status: isDead ? "dead_letter" : "failed",
        lastError: message,
        scheduledAt: isDead ? job.scheduledAt : new Date(Date.now() + delayMin * 60_000),
        processedAt: isDead ? new Date() : null,
      })
      .where(eq(notificationJobsTable.id, job.id));

    if (isDead) {
      await db
        .update(notificationDeliveriesTable)
        .set({ status: "failed", failedAt: new Date(), errorMessage: message })
        .where(
          and(
            eq(notificationDeliveriesTable.notificationJobId, job.id),
            eq(notificationDeliveriesTable.channel, "email"),
          ),
        );
    } else {
      await db
        .update(notificationJobsTable)
        .set({ status: "pending" })
        .where(eq(notificationJobsTable.id, job.id));
    }

    logger.warn({ jobId: job.id, err: message, isDead }, "[notification-queue] send failed");
  }
}

export async function processNotificationJobBatch(): Promise<number> {
  if (processing) return 0;
  processing = true;
  try {
    const now = new Date();
    const jobs = await db
      .select()
      .from(notificationJobsTable)
      .where(
        and(
          or(
            eq(notificationJobsTable.status, "pending"),
            eq(notificationJobsTable.status, "failed"),
          ),
          lte(notificationJobsTable.scheduledAt, now),
        ),
      )
      .orderBy(notificationJobsTable.scheduledAt)
      .limit(BATCH_SIZE);

    for (const job of jobs) {
      await processJob(job);
    }
    return jobs.length;
  } finally {
    processing = false;
  }
}

export function startNotificationQueueProcessor(intervalMs = 15_000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    void processNotificationJobBatch().catch((err) => {
      logger.error({ err }, "[notification-queue] batch error");
    });
  }, intervalMs);
  logger.info({ intervalMs }, "[notification-queue] processor started");
}

export function stopNotificationQueueProcessor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/** For tests */
export async function resetStuckProcessingJobs(): Promise<void> {
  await db
    .update(notificationJobsTable)
    .set({ status: "pending" })
    .where(eq(notificationJobsTable.status, "processing"));
}
