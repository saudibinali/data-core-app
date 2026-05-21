import type { Response } from "express";
import { db } from "@workspace/db";
import { generatedReportsTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AuthRequest } from "../../middlewares/requireAuth";
import { reportDefinitionRegistry } from "./report-definition-registry";
import { exportJobService } from "./export-job-service";
import { runReportGenerator, estimateReportRows, type ReportParams } from "./report-generators";
import { readReportArtifact } from "./report-artifact-storage";
import { assertExportAuthorized } from "./export-authorization";
import { logReportDownload } from "./export-job-service";
import { issueReportDownloadToken, verifyReportDownloadToken } from "./report-download-token";
import type { ReportArtifact } from "./artifact-builder";

export type ExportRequest = {
  reportDefinitionKey: string;
  format: string;
  parameters?: ReportParams;
  mode?: "sync" | "async" | "auto";
};

export class ReportService {
  async createReportJob(req: AuthRequest, input: ExportRequest) {
    await assertExportAuthorized(req, input.reportDefinitionKey);
    return exportJobService.createReportJob({
      workspaceId: req.workspaceId!,
      userId: req.userId!,
      userRole: req.userRole,
      userPermissions: req.userPermissions,
      platformRoleCode: req.platformRoleCode,
      isRootOwner: req.isRootOwner,
      reportDefinitionKey: input.reportDefinitionKey,
      format: input.format,
      parameters: input.parameters,
    });
  }

  async executeReport(
    workspaceId: number,
    reportDefinitionKey: string,
    format: string,
    parameters?: ReportParams,
  ): Promise<ReportArtifact> {
    const def = reportDefinitionRegistry.get(reportDefinitionKey);
    if (!def) throw new Error(`Unknown report: ${reportDefinitionKey}`);
    const fmt = reportDefinitionRegistry.assertFormat(def, format);
    return runReportGenerator(reportDefinitionKey, workspaceId, fmt, parameters ?? {});
  }

  async handleLegacyExport(req: AuthRequest, res: Response, request: ExportRequest): Promise<void> {
    await assertExportAuthorized(req, request.reportDefinitionKey);
    const workspaceId = req.workspaceId!;
    const mode = request.mode ?? "auto";

    let useAsync = mode === "async";
    if (mode === "auto") {
      const estimated = await estimateReportRows(
        request.reportDefinitionKey,
        workspaceId,
        request.parameters ?? {},
      );
      const def = reportDefinitionRegistry.get(request.reportDefinitionKey)!;
      useAsync = estimated > def.asyncThresholdRows;
    }

    if (useAsync) {
      const { job, generatedReport } = await this.createReportJob(req, request);
      res.status(202).json({
        async: true,
        jobId: job.id,
        generatedReportId: generatedReport.id,
        status: job.status,
        progressPercent: job.progressPercent,
      });
      return;
    }

    const artifact = await this.executeReport(
      workspaceId,
      request.reportDefinitionKey,
      request.format,
      request.parameters,
    );

    res.setHeader("Content-Type", artifact.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
    res.send(artifact.buffer);
  }

  async storeGeneratedReport(
    workspaceId: number,
    reportId: number,
    storageKey: string,
    fileName: string,
  ): Promise<void> {
    await db
      .update(generatedReportsTable)
      .set({ storageKey, fileName, status: "completed", completedAt: new Date() })
      .where(and(eq(generatedReportsTable.id, reportId), eq(generatedReportsTable.workspaceId, workspaceId)));
  }

  async listGeneratedReports(workspaceId: number, userId?: number) {
    const conditions = [eq(generatedReportsTable.workspaceId, workspaceId)];
    if (userId) {
      conditions.push(eq(generatedReportsTable.requestedByUserId, userId));
    }
    return db
      .select({
        id: generatedReportsTable.id,
        reportDefinitionKey: generatedReportsTable.reportDefinitionKey,
        format: generatedReportsTable.format,
        status: generatedReportsTable.status,
        fileName: generatedReportsTable.fileName,
        downloadCount: generatedReportsTable.downloadCount,
        expiresAt: generatedReportsTable.expiresAt,
        completedAt: generatedReportsTable.completedAt,
        createdAt: generatedReportsTable.createdAt,
        exportJobId: generatedReportsTable.exportJobId,
      })
      .from(generatedReportsTable)
      .where(and(...conditions))
      .orderBy(desc(generatedReportsTable.createdAt));
  }

  async issueDownload(req: AuthRequest, reportId: number): Promise<{
    token: string;
    expiresInSec: number;
    fileName: string;
    contentType: string;
  }> {
    const [report] = await db
      .select()
      .from(generatedReportsTable)
      .where(
        and(eq(generatedReportsTable.id, reportId), eq(generatedReportsTable.workspaceId, req.workspaceId!)),
      )
      .limit(1);

    if (!report || report.status !== "completed" || !report.storageKey) {
      throw new Error("Report not available");
    }
    if (report.expiresAt && report.expiresAt < new Date()) {
      throw new Error("Report expired");
    }

    const def = reportDefinitionRegistry.get(report.reportDefinitionKey);
    if (def) await assertExportAuthorized(req, report.reportDefinitionKey);

    const token = issueReportDownloadToken({
      generatedReportId: report.id,
      workspaceId: req.workspaceId!,
      userId: req.userId!,
    });

    await logReportDownload({
      workspaceId: req.workspaceId!,
      generatedReportId: report.id,
      exportJobId: report.exportJobId,
      userId: req.userId!,
      ipAddress: req.ip,
    });

    const contentType = contentTypeForFormat(report.format);

    return {
      token,
      expiresInSec: 900,
      fileName: report.fileName ?? `report_${report.id}.${report.format}`,
      contentType,
    };
  }

  async streamDownload(req: AuthRequest, token: string): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const payload = verifyReportDownloadToken(token);
    if (!payload || payload.userId !== req.userId || payload.workspaceId !== req.workspaceId) {
      throw new Error("Invalid download token");
    }

    const [report] = await db
      .select()
      .from(generatedReportsTable)
      .where(
        and(
          eq(generatedReportsTable.id, payload.generatedReportId),
          eq(generatedReportsTable.workspaceId, payload.workspaceId),
        ),
      )
      .limit(1);

    if (!report?.storageKey) throw new Error("Report not found");

    const buffer = await readReportArtifact(report.storageKey);
    const contentType = contentTypeForFormat(report.format);

    return {
      buffer,
      contentType,
      fileName: report.fileName ?? `report_${report.id}.${report.format}`,
    };
  }
}

function contentTypeForFormat(format: string | null): string {
  if (format === "csv") return "text/csv; charset=utf-8";
  if (format === "pdf") return "application/pdf";
  if (format === "json") return "application/json";
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

export const reportService = new ReportService();
