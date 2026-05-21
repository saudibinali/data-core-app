/**
 * P20-F — Operational reports (JSON → generated_reports)
 */
import { db } from "@workspace/db";
import {
  attendanceIntegrationsTable,
  attendanceIntegrationEmployeeMapTable,
  attendanceSyncJobsTable,
  attendanceRawEventsTable,
} from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { operationsService } from "./operations-service";
import type { ReportArtifact } from "../reports/artifact-builder";

export async function generateWorkforceOpsReport(
  definitionKey: string,
  workspaceId: number,
): Promise<ReportArtifact> {
  const body = await buildReportBody(definitionKey, workspaceId);
  const json = JSON.stringify(body, null, 2);
  return {
    buffer: Buffer.from(json, "utf8"),
    contentType: "application/json",
    fileName: `${definitionKey.replace(/\./g, "_")}_${Date.now()}.json`,
    rowCount: Array.isArray((body as { rows?: unknown[] }).rows)
      ? (body as { rows: unknown[] }).rows.length
      : 1,
  };
}

async function buildReportBody(definitionKey: string, workspaceId: number) {
  const generatedAt = new Date().toISOString();

  switch (definitionKey) {
    case "hr.workforce.integration.activity": {
      const integrations = await db
        .select()
        .from(attendanceIntegrationsTable)
        .where(eq(attendanceIntegrationsTable.workspaceId, workspaceId));
      const health = await operationsService.getIntegrationHealthList(workspaceId);
      return {
        reportKey: definitionKey,
        generatedAt,
        rows: health,
        integrations: integrations.map((i) => ({
          id: i.id,
          name: i.name,
          connectorKey: i.connectorKey,
          isEnabled: i.isEnabled,
          lastSyncAt: i.lastSyncAt,
        })),
      };
    }
    case "hr.workforce.sync.failures": {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const jobs = await db
        .select()
        .from(attendanceSyncJobsTable)
        .where(
          and(
            eq(attendanceSyncJobsTable.workspaceId, workspaceId),
            gte(attendanceSyncJobsTable.createdAt, since),
            sql`status in ('dead_letter', 'retry', 'cancelled') or last_error is not null`,
          ),
        );
      return { reportKey: definitionKey, generatedAt, rows: jobs };
    }
    case "hr.workforce.unresolved.mappings": {
      const rows = await operationsService.listUnresolvedMappings(workspaceId);
      return {
        reportKey: definitionKey,
        generatedAt,
        rows: rows.map((r) => ({
          id: r.map.id,
          integrationId: r.map.integrationId,
          integrationName: r.integrationName,
          externalEmployeeId: r.map.externalEmployeeId,
          confidence: r.map.confidence,
          updatedAt: r.map.updatedAt,
        })),
      };
    }
    case "hr.workforce.attendance.warnings": {
      const trends = await operationsService.getWarningTrends(workspaceId, 30);
      const alerts = await operationsService.evaluateAlerts(workspaceId);
      return { reportKey: definitionKey, generatedAt, trends, alerts };
    }
    default:
      throw new Error(`Unknown workforce ops report: ${definitionKey}`);
  }
}
