import { db } from "@workspace/db";
import { scheduledReportSchedulesTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { exportJobService } from "./export-job-service";
import { computeNextRunAt } from "./cron-schedule";
import { logger } from "../logger";
import type { ReportRecipient } from "./scheduled-report-service";

const BATCH = 10;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let processing = false;

export async function processScheduledReportBatch(): Promise<number> {
  if (processing) return 0;
  processing = true;
  try {
    const now = new Date();
    const due = await db
      .select()
      .from(scheduledReportSchedulesTable)
      .where(
        and(
          eq(scheduledReportSchedulesTable.enabled, true),
          lte(scheduledReportSchedulesTable.nextRunAt, now),
        ),
      )
      .limit(BATCH);

    let processed = 0;
    for (const schedule of due) {
      const claimed = await db
        .update(scheduledReportSchedulesTable)
        .set({
          lastRunAt: now,
          nextRunAt: computeNextRunAt(schedule.scheduleCron, schedule.scheduleTimezone, now),
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledReportSchedulesTable.id, schedule.id),
            eq(scheduledReportSchedulesTable.enabled, true),
            lte(scheduledReportSchedulesTable.nextRunAt, now),
          ),
        )
        .returning();

      if (!claimed.length) continue;

      const params = schedule.parametersJson ? JSON.parse(schedule.parametersJson) : {};
      const recipients: ReportRecipient[] = schedule.recipientJson
        ? JSON.parse(schedule.recipientJson)
        : [];

      if (!schedule.createdByUserId) {
        logger.warn({ scheduleId: schedule.id }, "[scheduled-report] missing createdByUserId, skip");
        continue;
      }

      const { job } = await exportJobService.createReportJob({
        workspaceId: schedule.workspaceId,
        userId: schedule.createdByUserId,
        userRole: "admin",
        userPermissions: ["hr.manage"],
        reportDefinitionKey: schedule.reportDefinitionKey,
        format: schedule.format,
        parameters: params,
        recipients,
        scheduleCron: schedule.scheduleCron,
        scheduleTimezone: schedule.scheduleTimezone,
      });

      await db
        .update(scheduledReportSchedulesTable)
        .set({ lastExportJobId: job.id })
        .where(eq(scheduledReportSchedulesTable.id, schedule.id));

      processed++;
    }
    return processed;
  } finally {
    processing = false;
  }
}

export function startScheduledReportScheduler(intervalMs = 60_000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    void processScheduledReportBatch().catch((err) => {
      logger.error({ err }, "[scheduled-report] batch error");
    });
  }, intervalMs);
  logger.info({ intervalMs }, "[scheduled-report] scheduler started");
}

export function stopScheduledReportScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
