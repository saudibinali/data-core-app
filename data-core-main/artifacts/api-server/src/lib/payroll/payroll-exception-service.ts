/**
 * P21-D — Payroll exception detection & lifecycle
 */
import { db } from "@workspace/db";
import {
  payrollExceptionsTable,
  payrollRunsTable,
  payrollRunEmployeesTable,
  payrollPeriodsTable,
  compensationAdjustmentsTable,
  employeesTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Money } from "./money";
import { logPayrollAccess } from "./payroll-audit";
import { dispatchUserNotification } from "../notifications/dispatch";

export type PayrollExceptionCode =
  | "MISSING_PACKAGE"
  | "MISSING_ATTENDANCE"
  | "NEGATIVE_NET"
  | "DUPLICATE_ADJUSTMENT"
  | "MISSING_APPROVAL"
  | "POLICY_VIOLATION"
  | "CALCULATION_ERROR";

export type DetectedException = {
  code: PayrollExceptionCode;
  severity: "info" | "warning" | "critical";
  message: string;
  employeeId?: number;
  metadata?: Record<string, unknown>;
};

export class PayrollExceptionService {
  async scanRun(workspaceId: number, runId: number, userId?: number): Promise<DetectedException[]> {
    const findings: DetectedException[] = [];

    const employees = await db
      .select()
      .from(payrollRunEmployeesTable)
      .where(
        and(
          eq(payrollRunEmployeesTable.workspaceId, workspaceId),
          eq(payrollRunEmployeesTable.runId, runId),
        ),
      );

    for (const emp of employees) {
      if (emp.status === "excluded") {
        findings.push({
          code: "MISSING_PACKAGE",
          severity: "warning",
          message: emp.errorMessage ?? "Employee excluded from run",
          employeeId: emp.employeeId,
        });
        continue;
      }

      if (emp.reviewStatus === "warning") {
        const warnings = emp.warningsJson ? JSON.parse(emp.warningsJson) : [];
        for (const w of warnings) {
          findings.push({
            code: (w.code as PayrollExceptionCode) ?? "POLICY_VIOLATION",
            severity: "warning",
            message: w.message ?? "Review warning",
            employeeId: emp.employeeId,
            metadata: w,
          });
        }
      }

      if (emp.scheduledDays === 0) {
        findings.push({
          code: "MISSING_ATTENDANCE",
          severity: "warning",
          message: "No attendance summaries in period",
          employeeId: emp.employeeId,
        });
      }

      const net = Money.fromDb(emp.netAmount);
      if (net.isNegative()) {
        findings.push({
          code: "NEGATIVE_NET",
          severity: "critical",
          message: `Negative net pay: ${emp.netAmount}`,
          employeeId: emp.employeeId,
        });
      }

      if (emp.errorMessage) {
        findings.push({
          code: "CALCULATION_ERROR",
          severity: "critical",
          message: emp.errorMessage,
          employeeId: emp.employeeId,
        });
      }
    }

    const [runRow] = await db
      .select({ periodId: payrollRunsTable.periodId })
      .from(payrollRunsTable)
      .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.workspaceId, workspaceId)))
      .limit(1);

    let dupAdj: Array<{ employeeId: number; cnt: number }> = [];
    if (runRow) {
      const [period] = await db
        .select()
        .from(payrollPeriodsTable)
        .where(eq(payrollPeriodsTable.id, runRow.periodId))
        .limit(1);
      if (period) {
        dupAdj = await db
          .select({
            employeeId: compensationAdjustmentsTable.employeeId,
            cnt: sql<number>`count(*)::int`,
          })
          .from(compensationAdjustmentsTable)
          .where(
            and(
              eq(compensationAdjustmentsTable.workspaceId, workspaceId),
              eq(compensationAdjustmentsTable.status, "approved"),
              sql`${compensationAdjustmentsTable.effectiveDate} >= ${period.periodStart}`,
              sql`${compensationAdjustmentsTable.effectiveDate} <= ${period.periodEnd}`,
            ),
          )
          .groupBy(compensationAdjustmentsTable.employeeId)
          .having(sql`count(*) > 1`);
      }
    }

    for (const row of dupAdj) {
      findings.push({
        code: "DUPLICATE_ADJUSTMENT",
        severity: "warning",
        message: `Duplicate adjustments for employee ${row.employeeId}`,
        employeeId: row.employeeId,
        metadata: { count: row.cnt },
      });
    }

    const [run] = await db
      .select()
      .from(payrollRunsTable)
      .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.workspaceId, workspaceId)))
      .limit(1);

    if (run && run.status === "review" && run.runType === "final") {
      const excluded = employees.filter((e) => e.status === "excluded").length;
      if (excluded > 0) {
        findings.push({
          code: "MISSING_APPROVAL",
          severity: "warning",
          message: `${excluded} employees excluded — approval blocked until resolved`,
        });
      }
    }

    await this.persistFindings(workspaceId, runId, findings, userId);
    return findings;
  }

  async persistFindings(
    workspaceId: number,
    runId: number,
    findings: DetectedException[],
    userId?: number,
  ) {
    await db
      .delete(payrollExceptionsTable)
      .where(
        and(
          eq(payrollExceptionsTable.workspaceId, workspaceId),
          eq(payrollExceptionsTable.runId, runId),
          eq(payrollExceptionsTable.status, "open"),
        ),
      );

    for (const f of findings) {
      await db.insert(payrollExceptionsTable).values({
        workspaceId,
        runId,
        employeeId: f.employeeId ?? null,
        exceptionCode: f.code,
        severity: f.severity,
        message: f.message,
        status: "open",
        metadataJson: f.metadata ? JSON.stringify(f.metadata) : null,
      });
    }

    if (findings.some((f) => f.severity === "critical") && userId) {
      await this.notifyOps(workspaceId, runId, findings.length);
    }

    logPayrollAccess({
      workspaceId,
      userId,
      action: "exception_scan",
      resourceType: "payroll_run",
      resourceId: runId,
      metadata: { count: findings.length },
    });
  }

  async listExceptions(
    workspaceId: number,
    filters?: { runId?: number; status?: string; severity?: string },
  ) {
    const conditions = [eq(payrollExceptionsTable.workspaceId, workspaceId)];
    if (filters?.runId) conditions.push(eq(payrollExceptionsTable.runId, filters.runId));
    if (filters?.status) conditions.push(eq(payrollExceptionsTable.status, filters.status));
    if (filters?.severity) conditions.push(eq(payrollExceptionsTable.severity, filters.severity));

    return db
      .select({
        ex: payrollExceptionsTable,
        employeeName: employeesTable.fullName,
        employeeNumber: employeesTable.employeeNumber,
      })
      .from(payrollExceptionsTable)
      .leftJoin(employeesTable, eq(payrollExceptionsTable.employeeId, employeesTable.id))
      .where(and(...conditions))
      .orderBy(desc(payrollExceptionsTable.createdAt));
  }

  async acknowledge(workspaceId: number, exceptionId: number, userId?: number) {
    const [row] = await db
      .update(payrollExceptionsTable)
      .set({
        status: "acknowledged",
        acknowledgedByUserId: userId ?? null,
        acknowledgedAt: new Date(),
      })
      .where(
        and(
          eq(payrollExceptionsTable.id, exceptionId),
          eq(payrollExceptionsTable.workspaceId, workspaceId),
        ),
      )
      .returning();
    if (!row) throw new Error("Exception not found");
    return row;
  }

  async resolve(workspaceId: number, exceptionId: number, userId?: number) {
    const [row] = await db
      .update(payrollExceptionsTable)
      .set({
        status: "resolved",
        acknowledgedByUserId: userId ?? null,
        acknowledgedAt: new Date(),
      })
      .where(
        and(
          eq(payrollExceptionsTable.id, exceptionId),
          eq(payrollExceptionsTable.workspaceId, workspaceId),
        ),
      )
      .returning();
    if (!row) throw new Error("Exception not found");
    return row;
  }

  private async notifyOps(workspaceId: number, runId: number, count: number) {
    const admins = await db
      .select({ userId: employeesTable.userId })
      .from(employeesTable)
      .where(eq(employeesTable.workspaceId, workspaceId))
      .limit(5);

    for (const a of admins) {
      if (!a.userId) continue;
      await dispatchUserNotification({
        workspaceId,
        userId: a.userId,
        type: "payroll_exception",
        title: "Payroll exceptions detected",
        message: `${count} exception(s) on payroll run #${runId}`,
        enqueueEmail: false,
      });
    }
  }
}

export const payrollExceptionService = new PayrollExceptionService();
