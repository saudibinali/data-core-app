import { db } from "@workspace/db";
import { payrollAuditLogsTable } from "@workspace/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { logger } from "../logger";

export type PayrollAccessLogInput = {
  workspaceId: number;
  userId?: number;
  action: string;
  resourceType: string;
  resourceId?: number;
  metadata?: Record<string, unknown>;
};

export function logPayrollAccess(input: PayrollAccessLogInput): void {
  logger.info(
    {
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
    },
    "[payroll] access",
  );

  void db
    .insert(payrollAuditLogsTable)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    })
    .catch((err) => logger.warn({ err }, "[payroll] audit log persist failed"));
}

export function maskAmount(amount: string | null | undefined): string {
  if (amount == null) return "****";
  return "****";
}

export class PayrollAuditQueryService {
  async listLogs(
    workspaceId: number,
    filters?: {
      action?: string;
      resourceType?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
    },
  ) {
    const conditions = [eq(payrollAuditLogsTable.workspaceId, workspaceId)];
    if (filters?.action) conditions.push(eq(payrollAuditLogsTable.action, filters.action));
    if (filters?.resourceType) {
      conditions.push(eq(payrollAuditLogsTable.resourceType, filters.resourceType));
    }
    if (filters?.dateFrom) {
      conditions.push(gte(payrollAuditLogsTable.createdAt, new Date(filters.dateFrom)));
    }
    if (filters?.dateTo) {
      conditions.push(lte(payrollAuditLogsTable.createdAt, new Date(filters.dateTo)));
    }

    return db
      .select()
      .from(payrollAuditLogsTable)
      .where(and(...conditions))
      .orderBy(desc(payrollAuditLogsTable.createdAt))
      .limit(filters?.limit ?? 200);
  }

  async getBreakGlassHistory(workspaceId: number, limit = 50) {
    return this.listLogs(workspaceId, {
      action: "break_glass_attendance",
      limit,
    });
  }

  async getCorrectionHistory(workspaceId: number, limit = 100) {
    return db
      .select()
      .from(payrollAuditLogsTable)
      .where(
        and(
          eq(payrollAuditLogsTable.workspaceId, workspaceId),
          eq(payrollAuditLogsTable.resourceType, "payroll_run"),
        ),
      )
      .orderBy(desc(payrollAuditLogsTable.createdAt))
      .limit(limit)
      .then((rows) =>
        rows.filter(
          (r) =>
            r.action.includes("correction") ||
            r.action.includes("correction") ||
            r.metadataJson?.includes("correction"),
        ),
      );
  }
}

export const payrollAuditQueryService = new PayrollAuditQueryService();
