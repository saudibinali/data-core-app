/**
 * P21-B/C — Payroll runs (preview / final / correction) + calculation orchestration
 */
import { createHash } from "crypto";
import { db } from "@workspace/db";
import { payrollRunsTable, payrollRunEmployeesTable, employeesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { EVENT_TYPES } from "@workspace/core-events";
import { payrollPeriodService } from "./payroll-period-service";
import { payrollCalculationEngine } from "./payroll-calculation-engine";
import { payrollRunWorkflow } from "./payroll-run-workflow";
import { payrollPayslipService } from "./payroll-payslip-service";
import { legacyPayrollBridge } from "./legacy-payroll-bridge";
import { logPayrollAccess } from "./payroll-audit";
import { emitPayrollEvent } from "./payroll-events";
import { schedulePayslipPdfBatchForRun } from "./payslip-pdf-batch";

export type RunType = "preview" | "final" | "correction";

export class PayrollRunService {
  buildIdempotencyKey(
    workspaceId: number,
    periodId: number,
    runType: string,
    version: number,
    correctsRunId?: number,
  ): string {
    const raw = `${workspaceId}:${periodId}:${runType}:v${version}:${correctsRunId ?? 0}`;
    return createHash("sha256").update(raw).digest("hex").slice(0, 48);
  }

  async createRun(input: {
    workspaceId: number;
    periodId: number;
    runType: RunType;
    userId?: number;
    notes?: string;
    correctsRunId?: number;
    calculationVersion?: number;
  }) {
    await payrollPeriodService.getPeriod(input.workspaceId, input.periodId);

    if (input.runType === "correction" && !input.correctsRunId) {
      throw new Error("correctsRunId required for correction runs");
    }

    const version = input.calculationVersion ?? 1;
    const idempotencyKey = this.buildIdempotencyKey(
      input.workspaceId,
      input.periodId,
      input.runType,
      version,
      input.correctsRunId,
    );

    const [existing] = await db
      .select()
      .from(payrollRunsTable)
      .where(
        and(
          eq(payrollRunsTable.workspaceId, input.workspaceId),
          eq(payrollRunsTable.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (existing) {
      return { run: existing, duplicate: true };
    }

    const [run] = await db
      .insert(payrollRunsTable)
      .values({
        workspaceId: input.workspaceId,
        periodId: input.periodId,
        runType: input.runType,
        status: "draft",
        idempotencyKey,
        calculationVersion: version,
        correctsRunId: input.correctsRunId ?? null,
        currencyCode: "SAR",
        createdByUserId: input.userId ?? null,
        notes: input.notes ?? null,
      })
      .returning();

    await emitPayrollEvent(EVENT_TYPES.PAYROLL_RUN_CREATED, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      runId: run!.id,
      runType: input.runType,
    });

    const calc = await payrollCalculationEngine.calculateRun({
      workspaceId: input.workspaceId,
      runId: run!.id,
      userId: input.userId,
    });

    if (input.runType !== "preview") {
      await legacyPayrollBridge.linkLegacyRunPlaceholder(run!.id);
    }

    logPayrollAccess({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: `${input.runType}_run_create`,
      resourceType: "payroll_run",
      resourceId: run!.id,
    });

    return { run: calc.run, duplicate: false, warnings: calc.warnings };
  }

  /** @deprecated Use createRun({ runType: 'preview' }) */
  async createPreviewRun(input: {
    workspaceId: number;
    periodId: number;
    userId?: number;
    notes?: string;
  }) {
    return this.createRun({ ...input, runType: "preview" });
  }

  async calculateRun(workspaceId: number, runId: number, userId?: number, employeeIds?: number[]) {
    const result = await payrollCalculationEngine.calculateRun({
      workspaceId,
      runId,
      userId,
      employeeIds,
    });
    const { payrollExceptionService } = await import("./payroll-exception-service");
    await payrollExceptionService.scanRun(workspaceId, runId, userId);
    return result;
  }

  async recalculateEmployee(
    workspaceId: number,
    runId: number,
    employeeId: number,
    userId?: number,
  ) {
    return payrollCalculationEngine.recalculateEmployee({
      workspaceId,
      runId,
      employeeId,
      userId,
    });
  }

  async submitForReview(workspaceId: number, runId: number, userId?: number) {
    const run = await payrollRunWorkflow.submitForReview(workspaceId, runId, userId);
    await emitPayrollEvent(EVENT_TYPES.PAYROLL_RUN_REVIEW, {
      workspaceId,
      userId,
      runId,
      runType: run.runType,
    });
    return run;
  }

  async approveRun(workspaceId: number, runId: number, userId?: number) {
    const run = await payrollRunWorkflow.approveRun(workspaceId, runId, userId);
    if (run.runType === "final" || run.runType === "correction") {
      await payrollPayslipService.createDraftPayslipsForRun(workspaceId, runId, userId);
    }
    await emitPayrollEvent(EVENT_TYPES.PAYROLL_RUN_APPROVED, {
      workspaceId,
      userId,
      runId,
      runType: run.runType,
    });
    return run;
  }

  async lockRun(workspaceId: number, runId: number, userId?: number, issuePayslips = true) {
    const run = await payrollRunWorkflow.lockRun(workspaceId, runId, userId);
    if (issuePayslips && (run.runType === "final" || run.runType === "correction")) {
      await payrollPayslipService.issuePayslips(workspaceId, runId, userId);
      schedulePayslipPdfBatchForRun(workspaceId, runId, userId);
    }
    return run;
  }

  async getReview(workspaceId: number, runId: number) {
    return payrollRunWorkflow.getReviewSummary(workspaceId, runId);
  }

  async listRuns(workspaceId: number, periodId?: number) {
    const conditions = [eq(payrollRunsTable.workspaceId, workspaceId)];
    if (periodId) conditions.push(eq(payrollRunsTable.periodId, periodId));

    return db
      .select()
      .from(payrollRunsTable)
      .where(and(...conditions))
      .orderBy(desc(payrollRunsTable.createdAt));
  }

  async getRun(workspaceId: number, runId: number) {
    return payrollRunWorkflow.getRun(workspaceId, runId);
  }

  async listRunEmployees(workspaceId: number, runId: number) {
    return db
      .select({
        row: payrollRunEmployeesTable,
        employeeName: employeesTable.fullName,
        employeeNumber: employeesTable.employeeNumber,
      })
      .from(payrollRunEmployeesTable)
      .innerJoin(employeesTable, eq(payrollRunEmployeesTable.employeeId, employeesTable.id))
      .where(
        and(eq(payrollRunEmployeesTable.workspaceId, workspaceId), eq(payrollRunEmployeesTable.runId, runId)),
      );
  }
}

export const payrollRunService = new PayrollRunService();
