/**
 * P21-C — Payroll calculation engine (decimal-safe, idempotent)
 */
import { db } from "@workspace/db";
import {
  payrollRunsTable,
  payrollRunEmployeesTable,
  payrollComponentValuesTable,
  employeesTable,
  type PayrollRun,
  type PayrollPeriod,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Money, sumMoney } from "./money";
import { payrollInputGatherer, type EmployeeCalcInputs } from "./payroll-input-gatherer";
import { payrollComponentCatalog } from "./payroll-component-catalog";
import { payrollPolicyService, type PayrollGeneralPolicy } from "./payroll-policy-service";
import { payrollRunWorkflow, type RunStatus } from "./payroll-run-workflow";
import { logPayrollAccess } from "./payroll-audit";

export type CalculationWarning = {
  code: string;
  message: string;
  employeeId?: number;
};

export type CalculateRunResult = {
  run: PayrollRun;
  warnings: CalculationWarning[];
  employeesProcessed: number;
};

type PostedLine = {
  componentCode: string;
  componentId: number;
  source: string;
  amount: Money;
  quantity: string;
  rate: string;
  referenceType?: string;
  referenceId?: number;
  metadata?: Record<string, unknown>;
};

export class PayrollCalculationEngine {
  async calculateRun(input: {
    workspaceId: number;
    runId: number;
    userId?: number;
    employeeIds?: number[];
  }): Promise<CalculateRunResult> {
    const run = await payrollRunWorkflow.getRun(input.workspaceId, input.runId);
    payrollRunWorkflow.assertCanCalculate(run);

    const period = await payrollRunWorkflow.getPeriodForRun(run);
    const policy = await payrollPolicyService.resolvePolicy<PayrollGeneralPolicy>(
      input.workspaceId,
      "payroll.general",
      period.periodEnd,
    );
    const roundingMode = policy.rounding?.mode ?? "half_up";
    const displayScale = policy.rounding?.scale ?? 2;

    await db
      .update(payrollRunsTable)
      .set({ status: "calculating", processedAt: new Date() })
      .where(eq(payrollRunsTable.id, run.id));

    const componentMap = await payrollComponentCatalog.resolveMap(input.workspaceId);
    const warnings: CalculationWarning[] = [];

    let employeeIds = input.employeeIds;
    if (!employeeIds?.length) {
      const rows = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(
          and(
            eq(employeesTable.workspaceId, input.workspaceId),
            eq(employeesTable.status, "active"),
          ),
        );
      employeeIds = rows.map((r) => r.id);
    }

    const priorRunEmployeeMap =
      run.correctsRunId != null
        ? await this.loadPriorRunTotals(input.workspaceId, run.correctsRunId)
        : new Map<number, { gross: Money; net: Money }>();

    let totalGross = Money.zero(run.currencyCode, displayScale);
    let totalNet = Money.zero(run.currencyCode, displayScale);
    let totalDeductions = Money.zero(run.currencyCode, displayScale);
    let included = 0;

    for (const employeeId of employeeIds) {
      const result = await this.calculateEmployee({
        workspaceId: input.workspaceId,
        run,
        period,
        employeeId,
        componentMap,
        priorTotals: priorRunEmployeeMap.get(employeeId),
        roundingMode,
        displayScale,
      });

      warnings.push(...result.warnings);

      if (result.status === "excluded") {
        await this.upsertRunEmployee({
          workspaceId: input.workspaceId,
          runId: run.id,
          employeeId,
          status: "excluded",
          warnings: result.warnings,
          errorMessage: result.errorMessage,
          inputSnapshot: result.inputSnapshot,
        });
        continue;
      }

      const runEmployeeId = await this.upsertRunEmployee({
        workspaceId: input.workspaceId,
        runId: run.id,
        employeeId,
        status: "included",
        warnings: result.warnings,
        inputSnapshot: result.inputSnapshot,
        compensationPackageId: result.compensationPackageId,
        scheduledDays: result.scheduledDays,
        paidDays: result.paidDays,
        unpaidAbsenceDays: result.unpaidAbsenceDays,
        grossAmount: result.gross,
        netAmount: result.net,
      });

      await this.clearComponentValues(runEmployeeId);
      for (const line of result.lines) {
        await db.insert(payrollComponentValuesTable).values({
          workspaceId: input.workspaceId,
          runEmployeeId,
          componentId: line.componentId,
          source: line.source,
          quantity: line.quantity,
          rate: line.rate,
          amount: line.amount.toStorageString(),
          currencyCode: run.currencyCode,
          referenceType: line.referenceType ?? null,
          referenceId: line.referenceId ?? null,
          metadataJson: line.metadata ? JSON.stringify(line.metadata) : null,
        });
      }

      totalGross = totalGross.add(result.gross);
      totalNet = totalNet.add(result.net);
      totalDeductions = totalDeductions.add(result.deductions);
      included += 1;
    }

    const nextStatus: RunStatus =
      run.runType === "preview" ? "review" : run.status === "draft" ? "review" : "review";

    const [updated] = await db
      .update(payrollRunsTable)
      .set({
        status: nextStatus,
        employeeCount: included,
        totalGross: totalGross.toStorageString(),
        totalNet: totalNet.toStorageString(),
        totalDeductions: totalDeductions.toStorageString(),
        processedAt: new Date(),
        reviewWarningsJson: warnings.length ? JSON.stringify(warnings) : null,
      })
      .where(eq(payrollRunsTable.id, run.id))
      .returning();

    logPayrollAccess({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "run_calculate",
      resourceType: "payroll_run",
      resourceId: run.id,
      metadata: { runType: run.runType, included, warningCount: warnings.length },
    });

    return { run: updated!, warnings, employeesProcessed: included };
  }

  async recalculateEmployee(input: {
    workspaceId: number;
    runId: number;
    employeeId: number;
    userId?: number;
  }) {
    return this.calculateRun({
      workspaceId: input.workspaceId,
      runId: input.runId,
      userId: input.userId,
      employeeIds: [input.employeeId],
    });
  }

  private async calculateEmployee(ctx: {
    workspaceId: number;
    run: PayrollRun;
    period: PayrollPeriod;
    employeeId: number;
    componentMap: Map<string, number>;
    priorTotals?: { gross: Money; net: Money };
    roundingMode: "half_up" | "down" | "up";
    displayScale: number;
  }) {
    const warnings: CalculationWarning[] = [];
    const inputs = await payrollInputGatherer.gatherEmployee(
      ctx.workspaceId,
      ctx.employeeId,
      period.periodStart,
      period.periodEnd,
    );

    if (!inputs.package) {
      return {
        status: "excluded" as const,
        warnings: [{ code: "MISSING_PACKAGE", message: "No active compensation package", employeeId: ctx.employeeId }],
        errorMessage: "No active compensation package",
        inputSnapshot: inputs,
        lines: [] as PostedLine[],
      };
    }

    if (inputs.attendance.scheduledDays === 0) {
      warnings.push({
        code: "NO_ATTENDANCE_SUMMARIES",
        message: "No attendance daily summaries in period",
        employeeId: ctx.employeeId,
      });
    }

    if (inputs.leave.some((l) => l.leaveType === "unpaid")) {
      warnings.push({
        code: "UNPAID_LEAVE",
        message: "Approved unpaid leave overlaps period",
        employeeId: ctx.employeeId,
      });
    }

    const currency = inputs.package.currencyCode;
    const base = Money.fromDb(inputs.package.baseAmount, currency);
    const scheduled = Math.max(inputs.attendance.scheduledDays, 1);
    const dailyRate = base.div(String(scheduled));
    const proratedBase = dailyRate
      .mul(String(inputs.attendance.paidDays))
      .round(ctx.roundingMode, ctx.displayScale);

    const lines: PostedLine[] = [];
    const compId = (code: string) => ctx.componentMap.get(code)!;

    const standardLines = await this.buildStandardLines(
      inputs,
      proratedBase,
      base,
      scheduled,
      ctx,
      compId,
    );

    if (ctx.run.runType === "correction" && ctx.priorTotals) {
      const earnings = standardLines.filter((l) =>
        ["BASIC", "ALLOWANCE", "OVERTIME", "ADJ_EARN"].includes(l.componentCode),
      );
      const deductions = standardLines.filter((l) =>
        ["UNPAID_ABS", "ADJ_DED"].includes(l.componentCode),
      );
      const gross = sumMoney(earnings.map((l) => l.amount), currency);
      const ded = sumMoney(deductions.map((l) => l.amount), currency);
      const net = gross.sub(ded).round(ctx.roundingMode, ctx.displayScale);
      const delta = net.sub(ctx.priorTotals.net).round(ctx.roundingMode, ctx.displayScale);
      if (!delta.isZero()) {
        lines.push({
          componentCode: "CORR_DELTA",
          componentId: compId("CORR_DELTA"),
          source: "correction",
          amount: delta,
          quantity: "1",
          rate: delta.toStorageString(),
          referenceType: "payroll_run",
          referenceId: ctx.run.correctsRunId ?? undefined,
          metadata: { priorNet: ctx.priorTotals.net.toStorageString(), recomputedNet: net.toStorageString() },
        });
      }
    } else {
      lines.push(...standardLines);
    }

    const earningCodes = new Set(["BASIC", "ALLOWANCE", "OVERTIME", "ADJ_EARN", "CORR_DELTA"]);
    const earnings = lines.filter((l) => earningCodes.has(l.componentCode));
    const deductions = lines.filter((l) => ["UNPAID_ABS", "ADJ_DED"].includes(l.componentCode));

    const gross = sumMoney(earnings.map((l) => l.amount), currency).round(ctx.roundingMode, ctx.displayScale);
    const dedTotal = sumMoney(deductions.map((l) => l.amount), currency).round(ctx.roundingMode, ctx.displayScale);
    const net = gross.sub(dedTotal).round(ctx.roundingMode, ctx.displayScale);

    return {
      status: "included" as const,
      warnings,
      errorMessage: null as string | null,
      inputSnapshot: inputs,
      lines,
      compensationPackageId:
        inputs.package.source === "canonical" ? inputs.package.packageId : null,
      scheduledDays: inputs.attendance.scheduledDays,
      paidDays: Math.ceil(inputs.attendance.paidDays),
      unpaidAbsenceDays: inputs.attendance.unpaidAbsenceDays,
      gross,
      net,
      deductions: dedTotal,
    };
  }

  private async buildStandardLines(
    inputs: EmployeeCalcInputs,
    proratedBase: Money,
    base: Money,
    scheduled: number,
    ctx: { run: PayrollRun; roundingMode: "half_up" | "down" | "up"; displayScale: number },
    compId: (code: string) => number,
  ): Promise<PostedLine[]> {
    const lines: PostedLine[] = [];
    const currency = inputs.package!.currencyCode;

    lines.push({
      componentCode: "BASIC",
      componentId: compId("BASIC"),
      source: "compensation",
      amount: proratedBase.round(ctx.roundingMode, ctx.displayScale),
      quantity: String(inputs.attendance.paidDays),
      rate: base.div(String(scheduled)).toStorageString(),
      metadata: { prorationFactor: inputs.attendance.paidDays / scheduled },
    });

    for (const c of inputs.package!.components) {
      const amt = Money.fromString(c.amount, currency).round(ctx.roundingMode, ctx.displayScale);
      if (amt.isZero()) continue;
      lines.push({
        componentCode: "ALLOWANCE",
        componentId: compId("ALLOWANCE"),
        source: "compensation",
        amount: amt,
        quantity: "1",
        rate: amt.toStorageString(),
        referenceType: "salary_component",
        metadata: { code: c.code, name: c.name },
      });
    }

    for (const ot of inputs.overtime) {
      const amt = Money.fromString(ot.calculatedAmount ?? "0", currency).round(
        ctx.roundingMode,
        ctx.displayScale,
      );
      if (amt.isZero()) continue;
      lines.push({
        componentCode: "OVERTIME",
        componentId: compId("OVERTIME"),
        source: "overtime",
        amount: amt,
        quantity: String(ot.durationMinutes),
        rate: amt.toStorageString(),
        referenceType: "hr_overtime_record",
        referenceId: ot.id,
      });
    }

    if (inputs.attendance.unpaidAbsenceDays > 0) {
      const daily = base.div(String(scheduled));
      const ded = daily
        .mul(String(inputs.attendance.unpaidAbsenceDays))
        .round(ctx.roundingMode, ctx.displayScale);
      lines.push({
        componentCode: "UNPAID_ABS",
        componentId: compId("UNPAID_ABS"),
        source: "attendance",
        amount: ded,
        quantity: String(inputs.attendance.unpaidAbsenceDays),
        rate: daily.toStorageString(),
      });
    }

    for (const adj of inputs.adjustments) {
      const raw = Money.fromString(adj.amount, currency);
      const isDeduction = adj.adjustmentType === "deduction" || raw.isNegative();
      const normalized = (raw.isNegative()
        ? Money.fromString(adj.amount.replace(/^-/, ""), currency)
        : raw
      ).round(ctx.roundingMode, ctx.displayScale);
      lines.push({
        componentCode: isDeduction ? "ADJ_DED" : "ADJ_EARN",
        componentId: compId(isDeduction ? "ADJ_DED" : "ADJ_EARN"),
        source: "adjustment",
        amount: normalized,
        quantity: "1",
        rate: normalized.toStorageString(),
        referenceType: "compensation_adjustment",
        referenceId: adj.id,
        metadata: { reason: adj.reason },
      });
    }

    return lines;
  }

  private async loadPriorRunTotals(workspaceId: number, priorRunId: number) {
    const rows = await db
      .select({
        employeeId: payrollRunEmployeesTable.employeeId,
        gross: payrollRunEmployeesTable.grossAmount,
        net: payrollRunEmployeesTable.netAmount,
      })
      .from(payrollRunEmployeesTable)
      .where(
        and(
          eq(payrollRunEmployeesTable.workspaceId, workspaceId),
          eq(payrollRunEmployeesTable.runId, priorRunId),
          eq(payrollRunEmployeesTable.status, "included"),
        ),
      );

    const map = new Map<number, { gross: Money; net: Money }>();
    for (const r of rows) {
      map.set(r.employeeId, {
        gross: Money.fromDb(r.gross),
        net: Money.fromDb(r.net),
      });
    }
    return map;
  }

  private async clearComponentValues(runEmployeeId: number) {
    await db
      .delete(payrollComponentValuesTable)
      .where(eq(payrollComponentValuesTable.runEmployeeId, runEmployeeId));
  }

  private async upsertRunEmployee(input: {
    workspaceId: number;
    runId: number;
    employeeId: number;
    runEmployeeId?: number;
    status: string;
    warnings: CalculationWarning[];
    errorMessage?: string | null;
    inputSnapshot?: unknown;
    compensationPackageId?: number | null;
    scheduledDays?: number;
    paidDays?: number;
    unpaidAbsenceDays?: number;
    grossAmount?: Money;
    netAmount?: Money;
  }) {
    const reviewStatus = input.warnings.length ? "warning" : "ok";
    const values = {
      status: input.status,
      warningsJson: input.warnings.length ? JSON.stringify(input.warnings) : null,
      reviewStatus,
      errorMessage: input.errorMessage ?? null,
      inputSnapshotJson: input.inputSnapshot ? JSON.stringify(input.inputSnapshot) : null,
      compensationPackageId: input.compensationPackageId ?? null,
      scheduledDays: input.scheduledDays ?? 0,
      paidDays: input.paidDays ?? 0,
      unpaidAbsenceDays: input.unpaidAbsenceDays ?? 0,
      grossAmount: input.grossAmount?.toStorageString() ?? "0.0000",
      netAmount: input.netAmount?.toStorageString() ?? "0.0000",
    };

    if (input.runEmployeeId) {
      await db
        .update(payrollRunEmployeesTable)
        .set(values)
        .where(eq(payrollRunEmployeesTable.id, input.runEmployeeId));
      return input.runEmployeeId;
    }

    const [existing] = await db
      .select({ id: payrollRunEmployeesTable.id })
      .from(payrollRunEmployeesTable)
      .where(
        and(
          eq(payrollRunEmployeesTable.runId, input.runId),
          eq(payrollRunEmployeesTable.employeeId, input.employeeId),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(payrollRunEmployeesTable)
        .set(values)
        .where(eq(payrollRunEmployeesTable.id, existing.id));
      return existing.id;
    }

    const [row] = await db
      .insert(payrollRunEmployeesTable)
      .values({
        workspaceId: input.workspaceId,
        runId: input.runId,
        employeeId: input.employeeId,
        ...values,
      })
      .returning({ id: payrollRunEmployeesTable.id });
    return row!.id;
  }
}

export const payrollCalculationEngine = new PayrollCalculationEngine();
