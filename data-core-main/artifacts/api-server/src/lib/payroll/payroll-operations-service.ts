/**
 * P21-D — Payroll Operations Center metrics & governance
 */
import { db } from "@workspace/db";
import {
  payrollRunsTable,
  payrollRunEmployeesTable,
  payrollPeriodsTable,
  payrollLocksTable,
  payrollPayslipsTable,
  payrollExceptionsTable,
  exportJobsTable,
  generatedReportsTable,
  employeesTable,
  hrOrgUnitsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, sql, isNotNull } from "drizzle-orm";
import { payrollExceptionService } from "./payroll-exception-service";
import { financialExportService } from "./financial-export-service";

export type PayrollOpsAlert = {
  code: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  runId?: number;
};

export class PayrollOperationsService {
  async getOverview(workspaceId: number) {
    const [
      runMetrics,
      reviewQueue,
      lockedPeriods,
      correctionRuns,
      exportReadiness,
      openExceptions,
      alerts,
    ] = await Promise.all([
      this.getRunMetrics(workspaceId),
      this.getReviewQueue(workspaceId),
      this.getLockedPeriods(workspaceId),
      this.listCorrectionRuns(workspaceId, 10),
      financialExportService.getExportReadiness(workspaceId),
      this.countOpenExceptions(workspaceId),
      this.evaluateAlerts(workspaceId),
    ]);

    return {
      runMetrics,
      reviewQueue,
      lockedPeriods,
      correctionRuns,
      exportReadiness,
      openExceptions,
      alerts,
      capturedAt: new Date().toISOString(),
    };
  }

  async getMetrics(workspaceId: number) {
    const [runs, corrections, locks, payslips, exports] = await Promise.all([
      this.getRunMetrics(workspaceId),
      db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(payrollRunsTable)
        .where(
          and(
            eq(payrollRunsTable.workspaceId, workspaceId),
            eq(payrollRunsTable.runType, "correction"),
          ),
        ),
      db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(payrollLocksTable)
        .where(eq(payrollLocksTable.workspaceId, workspaceId)),
      db
        .select({
          draft: sql<number>`count(*) filter (where status = 'draft')::int`,
          issued: sql<number>`count(*) filter (where status = 'issued')::int`,
        })
        .from(payrollPayslipsTable)
        .where(eq(payrollPayslipsTable.workspaceId, workspaceId)),
      db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(exportJobsTable)
        .where(
          and(
            eq(exportJobsTable.workspaceId, workspaceId),
            sql`${exportJobsTable.reportDefinitionKey} like 'hr.payroll.%'`,
          ),
        ),
    ]);

    return {
      runs,
      correctionCount: corrections[0]?.cnt ?? 0,
      lockCount: locks[0]?.cnt ?? 0,
      payslips: payslips[0] ?? { draft: 0, issued: 0 },
      payrollExportJobs: exports[0]?.cnt ?? 0,
    };
  }

  async getRunMetrics(workspaceId: number) {
    const rows = await db
      .select({
        status: payrollRunsTable.status,
        runType: payrollRunsTable.runType,
        count: sql<number>`count(*)::int`,
      })
      .from(payrollRunsTable)
      .where(eq(payrollRunsTable.workspaceId, workspaceId))
      .groupBy(payrollRunsTable.status, payrollRunsTable.runType);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + r.count;
      total += r.count;
    }

    const failedCalc = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(payrollRunEmployeesTable)
      .where(
        and(
          eq(payrollRunEmployeesTable.workspaceId, workspaceId),
          eq(payrollRunEmployeesTable.status, "excluded"),
        ),
      );

    return {
      total,
      byStatus,
      excludedEmployees: failedCalc[0]?.cnt ?? 0,
    };
  }

  async getReviewQueue(workspaceId: number, limit = 20) {
    const runs = await db
      .select({
        run: payrollRunsTable,
        periodLabel: payrollPeriodsTable.periodLabel,
      })
      .from(payrollRunsTable)
      .innerJoin(payrollPeriodsTable, eq(payrollRunsTable.periodId, payrollPeriodsTable.id))
      .where(
        and(
          eq(payrollRunsTable.workspaceId, workspaceId),
          inArray(payrollRunsTable.status, ["review", "calculating"]),
        ),
      )
      .orderBy(desc(payrollRunsTable.updatedAt))
      .limit(limit);

    if (runs.length === 0) return [];

    const runIds = runs.map((r) => r.run.id);
    const counts = await db
      .select({
        runId: payrollRunEmployeesTable.runId,
        warningCount: sql<number>`count(*) filter (where ${payrollRunEmployeesTable.reviewStatus} = 'warning')::int`,
        excludedCount: sql<number>`count(*) filter (where ${payrollRunEmployeesTable.status} = 'excluded')::int`,
      })
      .from(payrollRunEmployeesTable)
      .where(
        and(
          eq(payrollRunEmployeesTable.workspaceId, workspaceId),
          inArray(payrollRunEmployeesTable.runId, runIds),
        ),
      )
      .groupBy(payrollRunEmployeesTable.runId);

    const countMap = new Map(counts.map((c) => [c.runId, c]));

    return runs.map((r) => ({
      ...r,
      warningCount: countMap.get(r.run.id)?.warningCount ?? 0,
      excludedCount: countMap.get(r.run.id)?.excludedCount ?? 0,
    }));
  }

  async getReviewDetail(workspaceId: number, runId: number) {
    await payrollExceptionService.scanRun(workspaceId, runId);

    const employees = await db
      .select({
        row: payrollRunEmployeesTable,
        employeeName: employeesTable.fullName,
        employeeNumber: employeesTable.employeeNumber,
        orgUnit: hrOrgUnitsTable.name,
      })
      .from(payrollRunEmployeesTable)
      .innerJoin(employeesTable, eq(payrollRunEmployeesTable.employeeId, employeesTable.id))
      .leftJoin(hrOrgUnitsTable, eq(employeesTable.orgUnitId, hrOrgUnitsTable.id))
      .where(
        and(
          eq(payrollRunEmployeesTable.workspaceId, workspaceId),
          eq(payrollRunEmployeesTable.runId, runId),
        ),
      );

    const warnings = employees.filter(
      (e) => e.row.reviewStatus === "warning" || e.row.status === "excluded",
    );
    const exceptions = await payrollExceptionService.listExceptions(workspaceId, {
      runId,
      status: "open",
    });

    return { employees, warnings, exceptions };
  }

  async bulkApproveReview(
    workspaceId: number,
    runIds: number[],
    userId?: number,
    action: "approve" | "reject" = "approve",
  ) {
    const { payrollRunService } = await import("./payroll-run-service");
    const { payrollRunWorkflow } = await import("./payroll-run-workflow");
    const results = [];
    for (const runId of runIds) {
      if (action === "approve") {
        const run = await payrollRunWorkflow.getRun(workspaceId, runId);
        if (run.status === "draft" || run.status === "calculating") {
          await payrollRunService.submitForReview(workspaceId, runId, userId);
        }
        results.push(await payrollRunService.approveRun(workspaceId, runId, userId));
      } else {
        const [row] = await db
          .update(payrollRunsTable)
          .set({ status: "draft", notes: "Rejected from ops review" })
          .where(
            and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.workspaceId, workspaceId)),
          )
          .returning();
        results.push(row);
      }
    }
    return results;
  }

  async getLockedPeriods(workspaceId: number) {
    return db
      .select({
        lock: payrollLocksTable,
        period: payrollPeriodsTable,
      })
      .from(payrollLocksTable)
      .innerJoin(payrollPeriodsTable, eq(payrollLocksTable.periodId, payrollPeriodsTable.id))
      .where(eq(payrollLocksTable.workspaceId, workspaceId))
      .orderBy(desc(payrollLocksTable.lockedAt));
  }

  async listCorrectionRuns(workspaceId: number, limit = 20) {
    return db
      .select({
        run: payrollRunsTable,
        periodLabel: payrollPeriodsTable.periodLabel,
        correctsRunId: payrollRunsTable.correctsRunId,
      })
      .from(payrollRunsTable)
      .innerJoin(payrollPeriodsTable, eq(payrollRunsTable.periodId, payrollPeriodsTable.id))
      .where(
        and(
          eq(payrollRunsTable.workspaceId, workspaceId),
          eq(payrollRunsTable.runType, "correction"),
        ),
      )
      .orderBy(desc(payrollRunsTable.createdAt))
      .limit(limit);
  }

  async listRuns(
    workspaceId: number,
    filters?: { status?: string; runType?: string; periodId?: number; limit?: number },
  ) {
    const conditions = [eq(payrollRunsTable.workspaceId, workspaceId)];
    if (filters?.status) conditions.push(eq(payrollRunsTable.status, filters.status));
    if (filters?.runType) conditions.push(eq(payrollRunsTable.runType, filters.runType));
    if (filters?.periodId) conditions.push(eq(payrollRunsTable.periodId, filters.periodId));

    return db
      .select({
        run: payrollRunsTable,
        periodLabel: payrollPeriodsTable.periodLabel,
      })
      .from(payrollRunsTable)
      .innerJoin(payrollPeriodsTable, eq(payrollRunsTable.periodId, payrollPeriodsTable.id))
      .where(and(...conditions))
      .orderBy(desc(payrollRunsTable.createdAt))
      .limit(filters?.limit ?? 50);
  }

  async countOpenExceptions(workspaceId: number) {
    const [row] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(payrollExceptionsTable)
      .where(
        and(
          eq(payrollExceptionsTable.workspaceId, workspaceId),
          eq(payrollExceptionsTable.status, "open"),
        ),
      );
    return row?.cnt ?? 0;
  }

  async evaluateAlerts(workspaceId: number): Promise<PayrollOpsAlert[]> {
    const alerts: PayrollOpsAlert[] = [];
    const metrics = await this.getRunMetrics(workspaceId);

    if (metrics.byStatus.review && metrics.byStatus.review > 0) {
      alerts.push({
        code: "REVIEW_QUEUE",
        severity: "warning",
        title: "Runs awaiting review",
        message: `${metrics.byStatus.review} payroll run(s) in review`,
      });
    }

    if (metrics.excludedEmployees > 5) {
      alerts.push({
        code: "HIGH_EXCLUSIONS",
        severity: "critical",
        title: "High exclusion count",
        message: `${metrics.excludedEmployees} employees excluded across runs`,
      });
    }

    const openEx = await this.countOpenExceptions(workspaceId);
    if (openEx > 0) {
      alerts.push({
        code: "OPEN_EXCEPTIONS",
        severity: "warning",
        title: "Open payroll exceptions",
        message: `${openEx} unresolved exception(s)`,
      });
    }

    const readiness = await financialExportService.getExportReadiness(workspaceId);
    if (!readiness.glMappingComplete) {
      alerts.push({
        code: "GL_MAPPING_INCOMPLETE",
        severity: "info",
        title: "GL mapping incomplete",
        message: "Some payroll components lack debit/credit accounts",
      });
    }

    return alerts;
  }

  async getExportHistory(workspaceId: number, limit = 50) {
    return db
      .select({
        job: exportJobsTable,
        report: generatedReportsTable,
      })
      .from(exportJobsTable)
      .leftJoin(
        generatedReportsTable,
        eq(exportJobsTable.generatedReportId, generatedReportsTable.id),
      )
      .where(
        and(
          eq(exportJobsTable.workspaceId, workspaceId),
          sql`${exportJobsTable.reportDefinitionKey} like 'hr.payroll.%'`,
        ),
      )
      .orderBy(desc(exportJobsTable.createdAt))
      .limit(limit);
  }

  async getPayslipOpsHistory(workspaceId: number, limit = 50) {
    return db
      .select({
        payslip: payrollPayslipsTable,
        employeeName: employeesTable.fullName,
        runId: payrollPayslipsTable.runId,
      })
      .from(payrollPayslipsTable)
      .innerJoin(employeesTable, eq(payrollPayslipsTable.employeeId, employeesTable.id))
      .where(eq(payrollPayslipsTable.workspaceId, workspaceId))
      .orderBy(desc(payrollPayslipsTable.updatedAt))
      .limit(limit);
  }
}

export const payrollOperationsService = new PayrollOperationsService();
