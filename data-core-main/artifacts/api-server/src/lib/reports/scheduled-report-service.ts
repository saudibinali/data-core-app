import { db } from "@workspace/db";
import { scheduledReportSchedulesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { reportDefinitionRegistry } from "./report-definition-registry";
import { assertExportAuthorized, type ExportAuthContext } from "./export-authorization";
import { computeNextRunAt } from "./cron-schedule";
import type { ReportParams } from "./report-generators";

export type ReportRecipient = { userId?: number; email?: string };

export type CreateScheduledReportInput = ExportAuthContext & {
  workspaceId: number;
  userId: number;
  reportDefinitionKey: string;
  format?: string;
  parameters?: ReportParams;
  scheduleCron: string;
  scheduleTimezone?: string;
  recipients?: ReportRecipient[];
};

export class ScheduledReportService {
  async createSchedule(input: CreateScheduledReportInput) {
    await assertExportAuthorized(input, input.reportDefinitionKey);
    const def = reportDefinitionRegistry.get(input.reportDefinitionKey);
    if (!def) throw new Error(`Unknown report: ${input.reportDefinitionKey}`);
    const format = reportDefinitionRegistry.assertFormat(def, input.format ?? "pdf");
    const tz = input.scheduleTimezone ?? "UTC";
    const nextRunAt = computeNextRunAt(input.scheduleCron, tz);

    const [row] = await db
      .insert(scheduledReportSchedulesTable)
      .values({
        workspaceId: input.workspaceId,
        reportDefinitionKey: input.reportDefinitionKey,
        format,
        parametersJson: input.parameters ? JSON.stringify(input.parameters) : null,
        scheduleCron: input.scheduleCron,
        scheduleTimezone: tz,
        recipientJson: input.recipients ? JSON.stringify(input.recipients) : null,
        enabled: true,
        nextRunAt,
        createdByUserId: input.userId,
      })
      .returning();

    return row!;
  }

  async listSchedules(workspaceId: number) {
    return db
      .select()
      .from(scheduledReportSchedulesTable)
      .where(eq(scheduledReportSchedulesTable.workspaceId, workspaceId));
  }

  async getSchedule(id: number, workspaceId: number) {
    const [row] = await db
      .select()
      .from(scheduledReportSchedulesTable)
      .where(
        and(eq(scheduledReportSchedulesTable.id, id), eq(scheduledReportSchedulesTable.workspaceId, workspaceId)),
      )
      .limit(1);
    return row ?? null;
  }

  async setEnabled(id: number, workspaceId: number, enabled: boolean) {
    const [row] = await db
      .update(scheduledReportSchedulesTable)
      .set({ enabled })
      .where(
        and(eq(scheduledReportSchedulesTable.id, id), eq(scheduledReportSchedulesTable.workspaceId, workspaceId)),
      )
      .returning();
    return row ?? null;
  }
}

export const scheduledReportService = new ScheduledReportService();
