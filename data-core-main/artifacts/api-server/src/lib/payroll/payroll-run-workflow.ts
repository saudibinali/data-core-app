/**
 * P21-C — Payroll run lifecycle (no auto-approve, no destructive reprocess)
 */
import { db } from "@workspace/db";
import {
  payrollRunsTable,
  payrollPeriodsTable,
  payrollRunEmployeesTable,
  type PayrollRun,
  type PayrollPeriod,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { payrollLockService } from "./payroll-lock-service";
import { payrollPeriodService } from "./payroll-period-service";
import { logPayrollAccess } from "./payroll-audit";

export type RunStatus =
  | "draft"
  | "calculating"
  | "review"
  | "approved"
  | "locked";

const CALCULABLE = new Set<RunStatus>(["draft", "calculating", "review"]);
const MUTABLE_PREVIEW = new Set<RunStatus>(["draft", "calculating", "review"]);
const APPROVABLE = new Set<RunStatus>(["review"]);

export class PayrollRunWorkflow {
  async getRun(workspaceId: number, runId: number): Promise<PayrollRun> {
    const [row] = await db
      .select()
      .from(payrollRunsTable)
      .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new Error("Payroll run not found");
    return row;
  }

  async getPeriodForRun(run: PayrollRun): Promise<PayrollPeriod> {
    return payrollPeriodService.getPeriod(run.workspaceId, run.periodId);
  }

  assertCanCalculate(run: PayrollRun): void {
    if (run.status === "locked" || run.status === "approved") {
      throw new Error(`Cannot recalculate run in status ${run.status}`);
    }
    if (run.runType === "final" && run.lockedAt) {
      throw new Error("Final run is locked");
    }
    if (!CALCULABLE.has(run.status as RunStatus) && run.status !== "calculating") {
      if (run.runType === "preview" && MUTABLE_PREVIEW.has(run.status as RunStatus)) return;
      if (run.status !== "review" && run.status !== "draft") {
        throw new Error(`Run status ${run.status} does not allow calculation`);
      }
    }
  }

  assertCanApprove(run: PayrollRun): void {
    if (!APPROVABLE.has(run.status as RunStatus)) {
      throw new Error(`Run must be in review status to approve (current: ${run.status})`);
    }
  }

  assertCanLock(run: PayrollRun): void {
    if (run.status !== "approved") {
      throw new Error("Run must be approved before lock");
    }
    if (run.runType === "preview") {
      throw new Error("Preview runs cannot be locked for payslip issue");
    }
  }

  async submitForReview(workspaceId: number, runId: number, userId?: number) {
    const run = await this.getRun(workspaceId, runId);
    if (!["draft", "calculating", "review"].includes(run.status)) {
      throw new Error(`Cannot submit run in status ${run.status}`);
    }
    const [updated] = await db
      .update(payrollRunsTable)
      .set({
        status: "review",
        submittedForReviewAt: new Date(),
        submittedForReviewByUserId: userId ?? null,
      })
      .where(eq(payrollRunsTable.id, runId))
      .returning();
    logPayrollAccess({
      workspaceId,
      userId,
      action: "run_submit_review",
      resourceType: "payroll_run",
      resourceId: runId,
    });
    return updated!;
  }

  async approveRun(workspaceId: number, runId: number, userId?: number) {
    const run = await this.getRun(workspaceId, runId);
    this.assertCanApprove(run);

    const excluded = await db
      .select({ id: payrollRunEmployeesTable.id })
      .from(payrollRunEmployeesTable)
      .where(
        and(
          eq(payrollRunEmployeesTable.runId, runId),
          eq(payrollRunEmployeesTable.status, "excluded"),
        ),
      );

    if (excluded.length > 0 && run.runType === "final") {
      throw new Error("Cannot approve final run with excluded employees");
    }

    const [updated] = await db
      .update(payrollRunsTable)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedByUserId: userId ?? null,
      })
      .where(eq(payrollRunsTable.id, runId))
      .returning();

    logPayrollAccess({
      workspaceId,
      userId,
      action: "run_approve",
      resourceType: "payroll_run",
      resourceId: runId,
    });

    return updated!;
  }

  async lockRun(workspaceId: number, runId: number, userId?: number) {
    const run = await this.getRun(workspaceId, runId);
    this.assertCanLock(run);

    const period = await this.getPeriodForRun(run);
    await payrollLockService.createLock({
      workspaceId,
      periodId: period.id,
      lockType: "payroll",
      userId,
      runId,
    });

    const [updated] = await db
      .update(payrollRunsTable)
      .set({ status: "locked", lockedAt: new Date() })
      .where(eq(payrollRunsTable.id, runId))
      .returning();

    logPayrollAccess({
      workspaceId,
      userId,
      action: "run_lock",
      resourceType: "payroll_run",
      resourceId: runId,
    });

    return updated!;
  }

  async getReviewSummary(workspaceId: number, runId: number) {
    const run = await this.getRun(workspaceId, runId);
    const employees = await db
      .select()
      .from(payrollRunEmployeesTable)
      .where(
        and(
          eq(payrollRunEmployeesTable.workspaceId, workspaceId),
          eq(payrollRunEmployeesTable.runId, runId),
        ),
      );

    const warnings = run.reviewWarningsJson ? JSON.parse(run.reviewWarningsJson) : [];

    return {
      run,
      employees,
      warnings,
      counts: {
        included: employees.filter((e) => e.status === "included").length,
        excluded: employees.filter((e) => e.status === "excluded").length,
        withWarnings: employees.filter((e) => e.reviewStatus === "warning").length,
      },
    };
  }
}

export const payrollRunWorkflow = new PayrollRunWorkflow();
