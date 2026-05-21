import { db } from "@workspace/db";
import { exportJobsTable, generatedReportsTable, reportAccessLogsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { reportDefinitionRegistry, type ReportFormat } from "./report-definition-registry";
import { runReportGenerator, type ReportParams } from "./report-generators";
import { storeReportArtifact, hashParameters } from "./report-artifact-storage";
import { dispatchExportNotification } from "./export-notifications";
import { assertExportAuthorized, type ExportAuthContext } from "./export-authorization";
import { logger } from "../logger";

export type CreateExportJobInput = ExportAuthContext & {
  workspaceId: number;
  userId: number;
  reportDefinitionKey: string;
  format: string;
  parameters?: ReportParams;
  scheduleCron?: string;
  scheduleTimezone?: string;
  recipients?: Array<{ userId?: number; email?: string }>;
};

export class ExportJobService {
  async createReportJob(input: CreateExportJobInput) {
    await assertExportAuthorized(input, input.reportDefinitionKey);
    const def = reportDefinitionRegistry.get(input.reportDefinitionKey);
    if (!def) throw new Error(`Unknown report: ${input.reportDefinitionKey}`);
    const format = reportDefinitionRegistry.assertFormat(def, input.format);

    const expiresAt = new Date(Date.now() + def.defaultExpiryDays * 24 * 60 * 60 * 1000);
    const paramsJson = input.parameters ? JSON.stringify(input.parameters) : null;

    const [generatedReport] = await db
      .insert(generatedReportsTable)
      .values({
        workspaceId: input.workspaceId,
        reportDefinitionKey: input.reportDefinitionKey,
        format,
        status: "pending",
        requestedByUserId: input.userId,
        parametersJson: paramsJson,
        parametersHash: input.parameters ? hashParameters(input.parameters) : null,
        expiresAt,
        scheduleCron: input.scheduleCron ?? null,
        scheduleTimezone: input.scheduleTimezone ?? null,
        recipientJson: input.recipients ? JSON.stringify(input.recipients) : null,
      })
      .returning();

    const [job] = await db
      .insert(exportJobsTable)
      .values({
        workspaceId: input.workspaceId,
        exportType: input.reportDefinitionKey,
        reportDefinitionKey: input.reportDefinitionKey,
        format,
        status: "pending",
        filterParamsJson: paramsJson,
        createdByUserId: input.userId,
        generatedReportId: generatedReport!.id,
        expiresAt,
        scheduleCron: input.scheduleCron ?? null,
        scheduleTimezone: input.scheduleTimezone ?? null,
        recipientJson: input.recipients ? JSON.stringify(input.recipients) : null,
      })
      .returning();

    await db
      .update(generatedReportsTable)
      .set({ exportJobId: job!.id })
      .where(eq(generatedReportsTable.id, generatedReport!.id));

    return { job: job!, generatedReport: generatedReport! };
  }

  async getJob(jobId: number, workspaceId: number) {
    const [row] = await db
      .select()
      .from(exportJobsTable)
      .where(and(eq(exportJobsTable.id, jobId), eq(exportJobsTable.workspaceId, workspaceId)))
      .limit(1);
    return row ?? null;
  }

  async listJobs(workspaceId: number, limit = 100) {
    return db
      .select({
        id: exportJobsTable.id,
        reportDefinitionKey: exportJobsTable.reportDefinitionKey,
        format: exportJobsTable.format,
        status: exportJobsTable.status,
        progressPercent: exportJobsTable.progressPercent,
        lastError: exportJobsTable.lastError,
        generatedReportId: exportJobsTable.generatedReportId,
        createdAt: exportJobsTable.createdAt,
        completedAt: exportJobsTable.completedAt,
      })
      .from(exportJobsTable)
      .where(eq(exportJobsTable.workspaceId, workspaceId))
      .orderBy(desc(exportJobsTable.createdAt))
      .limit(limit);
  }

  async processJob(job: typeof exportJobsTable.$inferSelect): Promise<void> {
    await db
      .update(exportJobsTable)
      .set({ status: "processing", attempts: job.attempts + 1, progressPercent: 10 })
      .where(eq(exportJobsTable.id, job.id));

    if (!job.reportDefinitionKey || !job.format || !job.generatedReportId) {
      await this.failJob(job, "Missing report definition or generated report link");
      return;
    }

    try {
      const params: ReportParams = job.filterParamsJson ? JSON.parse(job.filterParamsJson) : {};

      await db
        .update(exportJobsTable)
        .set({ progressPercent: 40 })
        .where(eq(exportJobsTable.id, job.id));

      const artifact = await runReportGenerator(
        job.reportDefinitionKey,
        job.workspaceId,
        job.format as ReportFormat,
        params,
      );

      await db
        .update(exportJobsTable)
        .set({ progressPercent: 70 })
        .where(eq(exportJobsTable.id, job.id));

      const storageKey = await storeReportArtifact(
        job.workspaceId,
        job.generatedReportId,
        artifact.fileName,
        artifact.buffer,
      );

      await db
        .update(generatedReportsTable)
        .set({
          status: "completed",
          storageKey,
          fileName: artifact.fileName,
          completedAt: new Date(),
        })
        .where(eq(generatedReportsTable.id, job.generatedReportId));

      await db
        .update(exportJobsTable)
        .set({
          status: "completed",
          progressPercent: 100,
          outputStorageKey: storageKey,
          completedAt: new Date(),
          lastError: null,
        })
        .where(eq(exportJobsTable.id, job.id));

      await dispatchExportNotification({
        workspaceId: job.workspaceId,
        userId: job.createdByUserId ?? undefined,
        success: true,
        reportDefinitionKey: job.reportDefinitionKey,
        generatedReportId: job.generatedReportId,
        format: job.format,
        recipientJson: job.recipientJson,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.failJob(job, message);
    }
  }

  private async failJob(job: typeof exportJobsTable.$inferSelect, message: string): Promise<void> {
    const isDead = job.attempts + 1 >= job.maxAttempts;

    await db
      .update(exportJobsTable)
      .set({
        status: isDead ? "failed" : "pending",
        lastError: message,
        progressPercent: 0,
      })
      .where(eq(exportJobsTable.id, job.id));

    if (job.generatedReportId) {
      await db
        .update(generatedReportsTable)
        .set({ status: "failed" })
        .where(eq(generatedReportsTable.id, job.generatedReportId));
    }

    if (isDead) {
      await dispatchExportNotification({
        workspaceId: job.workspaceId,
        userId: job.createdByUserId ?? undefined,
        success: false,
        reportDefinitionKey: job.reportDefinitionKey ?? "export",
        generatedReportId: job.generatedReportId ?? 0,
        errorMessage: message,
        recipientJson: job.recipientJson,
      });
    }

    logger.warn({ jobId: job.id, err: message, isDead }, "[export-job] failed");
  }
}

export const exportJobService = new ExportJobService();

export async function logReportDownload(params: {
  workspaceId: number;
  generatedReportId: number;
  exportJobId?: number | null;
  userId: number;
  ipAddress?: string;
}): Promise<void> {
  await db.insert(reportAccessLogsTable).values({
    workspaceId: params.workspaceId,
    generatedReportId: params.generatedReportId,
    exportJobId: params.exportJobId ?? null,
    userId: params.userId,
    action: "download",
    ipAddress: params.ipAddress ?? null,
  });
  await db
    .update(generatedReportsTable)
    .set({ downloadCount: sql`${generatedReportsTable.downloadCount} + 1` })
    .where(eq(generatedReportsTable.id, params.generatedReportId));
}
