/**
 * P20-F — Workforce Operations Center metrics & queries
 */
import { db } from "@workspace/db";
import {
  attendanceRawEventsTable,
  attendanceSyncJobsTable,
  attendanceSourcesTable,
  attendanceImportBatchesTable,
  attendanceImportRowsTable,
  employeesTable,
} from "@workspace/db";
import {
  attendanceIntegrationsTable,
  attendanceIntegrationEmployeeMapTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, sql, lt, or, isNull } from "drizzle-orm";
import { parseAndMaskPayloadJson } from "./payload-masking";
import { employeeMapService } from "../workforce-integration/employee-map-service";

const STALE_MULTIPLIER = 2;
const DUPLICATE_STORM_THRESHOLD = 50;
const REPLAY_WINDOW_HOURS = 24;

export type WorkforceAlert = {
  code: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  integrationId?: number;
  count?: number;
};

export class OperationsService {
  async getOverview(workspaceId: number) {
    const [
      rawHealth,
      syncMetrics,
      unresolvedCount,
      importIssues,
      integrationHealth,
      alerts,
    ] = await Promise.all([
      this.getRawEventHealth(workspaceId),
      this.getSyncMetrics(workspaceId),
      this.countUnresolvedMappings(workspaceId),
      this.getImportIssues(workspaceId, 5),
      this.getIntegrationHealthList(workspaceId),
      this.evaluateAlerts(workspaceId),
    ]);

    return {
      rawEventHealth: rawHealth,
      syncMetrics,
      unresolvedEmployeeMappings: unresolvedCount,
      importIssuesCount: importIssues.length,
      integrations: integrationHealth,
      alerts,
      capturedAt: new Date().toISOString(),
    };
  }

  async getRawEventHealth(workspaceId: number) {
    const rows = await db
      .select({
        status: attendanceRawEventsTable.processingStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(attendanceRawEventsTable)
      .where(eq(attendanceRawEventsTable.workspaceId, workspaceId))
      .groupBy(attendanceRawEventsTable.processingStatus);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = r.count;
      total += r.count;
    }
    return {
      total,
      failed: byStatus.failed ?? 0,
      received: byStatus.received ?? 0,
      normalized: byStatus.normalized ?? 0,
      duplicate: byStatus.duplicate ?? 0,
      ignored: byStatus.ignored ?? 0,
      byStatus,
    };
  }

  async listRawEvents(
    workspaceId: number,
    filters: {
      status?: string;
      dateFrom?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const conditions = [eq(attendanceRawEventsTable.workspaceId, workspaceId)];
    if (filters.status) {
      conditions.push(eq(attendanceRawEventsTable.processingStatus, filters.status));
    }
    if (filters.dateFrom) {
      conditions.push(gte(attendanceRawEventsTable.receivedAt, new Date(filters.dateFrom)));
    }

    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;

    const rows = await db
      .select({
        id: attendanceRawEventsTable.id,
        employeeId: attendanceRawEventsTable.employeeId,
        sourceId: attendanceRawEventsTable.sourceId,
        externalId: attendanceRawEventsTable.externalId,
        eventTypeHint: attendanceRawEventsTable.eventTypeHint,
        occurredAt: attendanceRawEventsTable.occurredAt,
        receivedAt: attendanceRawEventsTable.receivedAt,
        processingStatus: attendanceRawEventsTable.processingStatus,
        errorMessage: attendanceRawEventsTable.errorMessage,
        sourceCode: attendanceSourcesTable.code,
        employeeName: employeesTable.fullName,
      })
      .from(attendanceRawEventsTable)
      .leftJoin(
        attendanceSourcesTable,
        eq(attendanceRawEventsTable.sourceId, attendanceSourcesTable.id),
      )
      .leftJoin(employeesTable, eq(attendanceRawEventsTable.employeeId, employeesTable.id))
      .where(and(...conditions))
      .orderBy(desc(attendanceRawEventsTable.receivedAt))
      .limit(limit)
      .offset(offset);

    return rows;
  }

  async getRawEventDetail(workspaceId: number, rawEventId: number, mask = true) {
    const [row] = await db
      .select({
        raw: attendanceRawEventsTable,
        sourceCode: attendanceSourcesTable.code,
        employeeName: employeesTable.fullName,
      })
      .from(attendanceRawEventsTable)
      .leftJoin(
        attendanceSourcesTable,
        eq(attendanceRawEventsTable.sourceId, attendanceSourcesTable.id),
      )
      .leftJoin(employeesTable, eq(attendanceRawEventsTable.employeeId, employeesTable.id))
      .where(
        and(
          eq(attendanceRawEventsTable.id, rawEventId),
          eq(attendanceRawEventsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    if (!row) throw new Error("Raw event not found");

    const payload = mask
      ? parseAndMaskPayloadJson(row.raw.payloadJson)
      : JSON.parse(row.raw.payloadJson);

    return {
      ...row.raw,
      sourceCode: row.sourceCode,
      employeeName: row.employeeName,
      payload,
    };
  }

  async getSyncMetrics(workspaceId: number) {
    const statusRows = await db
      .select({
        status: attendanceSyncJobsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(attendanceSyncJobsTable)
      .where(eq(attendanceSyncJobsTable.workspaceId, workspaceId))
      .groupBy(attendanceSyncJobsTable.status);

    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r.status] = r.count;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = await db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where status = 'completed')::int`,
        failed: sql<number>`count(*) filter (where status in ('dead_letter', 'retry'))::int`,
      })
      .from(attendanceSyncJobsTable)
      .where(
        and(
          eq(attendanceSyncJobsTable.workspaceId, workspaceId),
          gte(attendanceSyncJobsTable.createdAt, since),
        ),
      );

    const r = recent[0];
    const total = r?.total ?? 0;
    const completed = r?.completed ?? 0;

    return {
      byStatus,
      last7Days: {
        total,
        completed,
        failed: r?.failed ?? 0,
        successRate: total > 0 ? Math.round((completed / total) * 100) : 100,
      },
      deadLetter: byStatus.dead_letter ?? 0,
      pending: (byStatus.pending ?? 0) + (byStatus.retry ?? 0),
    };
  }

  async listSyncJobs(
    workspaceId: number,
    filters: { status?: string; integrationId?: number; limit?: number },
  ) {
    const conditions = [eq(attendanceSyncJobsTable.workspaceId, workspaceId)];
    if (filters.status) conditions.push(eq(attendanceSyncJobsTable.status, filters.status));
    if (filters.integrationId) {
      conditions.push(eq(attendanceSyncJobsTable.integrationId, filters.integrationId));
    }

    return db
      .select({
        job: attendanceSyncJobsTable,
        integrationName: attendanceIntegrationsTable.name,
        connectorKey: attendanceIntegrationsTable.connectorKey,
      })
      .from(attendanceSyncJobsTable)
      .leftJoin(
        attendanceIntegrationsTable,
        eq(attendanceSyncJobsTable.integrationId, attendanceIntegrationsTable.id),
      )
      .where(and(...conditions))
      .orderBy(desc(attendanceSyncJobsTable.createdAt))
      .limit(Math.min(filters.limit ?? 50, 200));
  }

  async getIntegrationHealthList(workspaceId: number) {
    const integrations = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(eq(attendanceIntegrationsTable.workspaceId, workspaceId))
      .orderBy(desc(attendanceIntegrationsTable.id));

    const result = [];
    for (const int of integrations) {
      result.push(await this.getIntegrationHealth(workspaceId, int.id));
    }
    return result;
  }

  async getIntegrationHealth(workspaceId: number, integrationId: number) {
    const [int] = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(
        and(
          eq(attendanceIntegrationsTable.id, integrationId),
          eq(attendanceIntegrationsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!int) throw new Error("Integration not found");

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const jobStats = await db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where status = 'completed')::int`,
        failed: sql<number>`count(*) filter (where status = 'dead_letter')::int`,
        retry: sql<number>`count(*) filter (where status = 'retry')::int`,
      })
      .from(attendanceSyncJobsTable)
      .where(
        and(
          eq(attendanceSyncJobsTable.integrationId, integrationId),
          gte(attendanceSyncJobsTable.createdAt, since),
        ),
      );

    const unresolved = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(attendanceIntegrationEmployeeMapTable)
      .where(
        and(
          eq(attendanceIntegrationEmployeeMapTable.integrationId, integrationId),
          eq(attendanceIntegrationEmployeeMapTable.status, "unresolved"),
        ),
      );

    const js = jobStats[0];
    const total = js?.total ?? 0;
    const stale = this.isIntegrationStale(int);

    return {
      id: int.id,
      name: int.name,
      connectorKey: int.connectorKey,
      isEnabled: int.isEnabled,
      lastSyncAt: int.lastSyncAt,
      lastSyncStatus: int.lastSyncStatus,
      consecutiveFailures: int.consecutiveFailures,
      pollIntervalMinutes: int.pollIntervalMinutes,
      stale,
      syncSuccessRate7d: total > 0 ? Math.round(((js?.completed ?? 0) / total) * 100) : null,
      failedSyncCount7d: js?.failed ?? 0,
      retryCount7d: js?.retry ?? 0,
      unresolvedMappings: unresolved[0]?.count ?? 0,
      webhookCapable: ["generic_webhook", "direct_api"].includes(int.connectorKey),
      pollCapable: ["generic_rest_poll", "direct_api"].includes(int.connectorKey),
    };
  }

  isIntegrationStale(int: typeof attendanceIntegrationsTable.$inferSelect): boolean {
    if (!int.isEnabled) return false;
    const intervalMs = (int.pollIntervalMinutes ?? 15) * 60_000 * STALE_MULTIPLIER;
    if (!int.lastSyncAt) return true;
    return Date.now() - int.lastSyncAt.getTime() > intervalMs;
  }

  async countUnresolvedMappings(workspaceId: number) {
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(attendanceIntegrationEmployeeMapTable)
      .where(
        and(
          eq(attendanceIntegrationEmployeeMapTable.workspaceId, workspaceId),
          eq(attendanceIntegrationEmployeeMapTable.status, "unresolved"),
        ),
      );
    return r?.count ?? 0;
  }

  async listUnresolvedMappings(workspaceId: number, integrationId?: number) {
    const conditions = [
      eq(attendanceIntegrationEmployeeMapTable.workspaceId, workspaceId),
      eq(attendanceIntegrationEmployeeMapTable.status, "unresolved"),
    ];
    if (integrationId) {
      conditions.push(eq(attendanceIntegrationEmployeeMapTable.integrationId, integrationId));
    }
    return db
      .select({
        map: attendanceIntegrationEmployeeMapTable,
        integrationName: attendanceIntegrationsTable.name,
      })
      .from(attendanceIntegrationEmployeeMapTable)
      .innerJoin(
        attendanceIntegrationsTable,
        eq(attendanceIntegrationEmployeeMapTable.integrationId, attendanceIntegrationsTable.id),
      )
      .where(and(...conditions))
      .orderBy(desc(attendanceIntegrationEmployeeMapTable.updatedAt))
      .limit(200);
  }

  async bulkResolveMappings(
    workspaceId: number,
    items: Array<{ integrationId: number; externalEmployeeId: string; employeeId: number }>,
    userId?: number,
  ) {
    const results: Array<{ externalEmployeeId: string; id: number }> = [];
    for (const item of items) {
      await employeeMapService.assertIntegrationInWorkspace(workspaceId, item.integrationId);
      const id = await employeeMapService.upsertMapping({
        workspaceId,
        integrationId: item.integrationId,
        externalEmployeeId: item.externalEmployeeId,
        employeeId: item.employeeId,
        status: "mapped",
        confidence: 100,
      });
      results.push({ externalEmployeeId: item.externalEmployeeId, id });
    }
    return { resolved: results.length, results };
  }

  async ignoreMapping(workspaceId: number, mapId: number) {
    const [row] = await db
      .select()
      .from(attendanceIntegrationEmployeeMapTable)
      .where(
        and(
          eq(attendanceIntegrationEmployeeMapTable.id, mapId),
          eq(attendanceIntegrationEmployeeMapTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Mapping not found");
    await employeeMapService.upsertMapping({
      workspaceId,
      integrationId: row.integrationId,
      externalEmployeeId: row.externalEmployeeId,
      employeeId: null,
      status: "ignored",
      confidence: 0,
    });
    return { id: mapId, status: "ignored" };
  }

  async getImportIssues(workspaceId: number, limit = 20) {
    const batches = await db
      .select()
      .from(attendanceImportBatchesTable)
      .where(
        and(
          eq(attendanceImportBatchesTable.workspaceId, workspaceId),
          inArray(attendanceImportBatchesTable.status, ["failed", "completed_with_errors"]),
        ),
      )
      .orderBy(desc(attendanceImportBatchesTable.createdAt))
      .limit(limit);

    const issues = [];
    for (const b of batches) {
      const [errRows] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(attendanceImportRowsTable)
        .where(
          and(
            eq(attendanceImportRowsTable.batchId, b.id),
            or(
              eq(attendanceImportRowsTable.validationStatus, "error"),
              eq(attendanceImportRowsTable.outcome, "error"),
            ),
          ),
        );
      if ((errRows?.count ?? 0) > 0 || b.status === "failed") {
        issues.push({
          batchId: b.id,
          status: b.status,
          templateKey: b.templateKey,
          errorRowCount: errRows?.count ?? 0,
          createdAt: b.createdAt,
        });
      }
    }
    return issues;
  }

  async evaluateAlerts(workspaceId: number): Promise<WorkforceAlert[]> {
    const alerts: WorkforceAlert[] = [];
    const integrations = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(eq(attendanceIntegrationsTable.workspaceId, workspaceId));

    for (const int of integrations) {
      if (!int.isEnabled) {
        alerts.push({
          code: "integration_disabled",
          severity: "info",
          title: "Integration disabled",
          message: `"${int.name}" is disabled`,
          integrationId: int.id,
        });
        continue;
      }
      if (int.consecutiveFailures >= 3) {
        alerts.push({
          code: "sync_failures",
          severity: "critical",
          title: "Repeated sync failures",
          message: `"${int.name}" has ${int.consecutiveFailures} consecutive failures`,
          integrationId: int.id,
          count: int.consecutiveFailures,
        });
      }
      if (this.isIntegrationStale(int)) {
        alerts.push({
          code: "stale_integration",
          severity: "warning",
          title: "Stale integration",
          message: `"${int.name}" has not synced recently`,
          integrationId: int.id,
        });
      }
    }

    const since = new Date(Date.now() - REPLAY_WINDOW_HOURS * 60 * 60 * 1000);
    const [dup] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(attendanceRawEventsTable)
      .where(
        and(
          eq(attendanceRawEventsTable.workspaceId, workspaceId),
          eq(attendanceRawEventsTable.processingStatus, "duplicate"),
          gte(attendanceRawEventsTable.receivedAt, since),
        ),
      );
    if ((dup?.count ?? 0) >= DUPLICATE_STORM_THRESHOLD) {
      alerts.push({
        code: "duplicate_storm",
        severity: "warning",
        title: "Duplicate event storm",
        message: `${dup!.count} duplicate raw events in last ${REPLAY_WINDOW_HOURS}h`,
        count: dup!.count,
      });
    }

    const unresolved = await this.countUnresolvedMappings(workspaceId);
    if (unresolved > 0) {
      alerts.push({
        code: "unresolved_mappings",
        severity: unresolved > 10 ? "critical" : "warning",
        title: "Unresolved employee mappings",
        message: `${unresolved} external employees need mapping`,
        count: unresolved,
      });
    }

    const [failedRaw] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(attendanceRawEventsTable)
      .where(
        and(
          eq(attendanceRawEventsTable.workspaceId, workspaceId),
          eq(attendanceRawEventsTable.processingStatus, "failed"),
        ),
      );
    if ((failedRaw?.count ?? 0) > 0) {
      alerts.push({
        code: "failed_raw_events",
        severity: "warning",
        title: "Failed raw events",
        message: `${failedRaw!.count} events need replay or ignore`,
        count: failedRaw!.count,
      });
    }

    const [deadLetter] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(attendanceSyncJobsTable)
      .where(
        and(
          eq(attendanceSyncJobsTable.workspaceId, workspaceId),
          eq(attendanceSyncJobsTable.status, "dead_letter"),
        ),
      );
    if ((deadLetter?.count ?? 0) > 0) {
      alerts.push({
        code: "dead_letter_jobs",
        severity: "critical",
        title: "Dead letter sync jobs",
        message: `${deadLetter!.count} sync jobs require operator action`,
        count: deadLetter!.count,
      });
    }

    return alerts.sort((a, b) => {
      const sev = { critical: 0, warning: 1, info: 2 };
      return sev[a.severity] - sev[b.severity];
    });
  }

  async getWarningTrends(workspaceId: number, days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        day: sql<string>`date_trunc('day', received_at)::date::text`,
        failed: sql<number>`count(*) filter (where processing_status = 'failed')::int`,
        duplicate: sql<number>`count(*) filter (where processing_status = 'duplicate')::int`,
      })
      .from(attendanceRawEventsTable)
      .where(
        and(
          eq(attendanceRawEventsTable.workspaceId, workspaceId),
          gte(attendanceRawEventsTable.receivedAt, since),
        ),
      )
      .groupBy(sql`date_trunc('day', received_at)`)
      .orderBy(sql`date_trunc('day', received_at)`);

    return rows;
  }
}

export const operationsService = new OperationsService();
