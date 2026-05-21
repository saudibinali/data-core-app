/**
 * P21-B — Payroll foundation reports (JSON → generated_reports)
 */
import { db } from "@workspace/db";
import {
  payrollRunsTable,
  payrollRunEmployeesTable,
  payrollComponentValuesTable,
  payrollComponentsTable,
  payrollPayslipsTable,
  employeesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ReportArtifact } from "../reports/artifact-builder";
import type { ReportParams } from "../reports/report-generators";

export async function generatePayrollFoundationReport(
  definitionKey: string,
  workspaceId: number,
  params: ReportParams,
): Promise<ReportArtifact> {
  const body = await buildBody(definitionKey, workspaceId, params);
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

async function buildBody(definitionKey: string, workspaceId: number, params: ReportParams) {
  const generatedAt = new Date().toISOString();
  const runId = params.payrollRunId ? Number(params.payrollRunId) : undefined;

  if (definitionKey === "hr.payroll.register") {
    const runConditions = [eq(payrollRunsTable.workspaceId, workspaceId)];
    if (runId) runConditions.push(eq(payrollRunsTable.id, runId));

    const runs = await db.select().from(payrollRunsTable).where(and(...runConditions));

    const rows = [];
    for (const run of runs) {
      const employees = await db
        .select({
          employeeId: payrollRunEmployeesTable.employeeId,
          employeeNumber: employeesTable.employeeNumber,
          fullName: employeesTable.fullName,
          status: payrollRunEmployeesTable.status,
          paidDays: payrollRunEmployeesTable.paidDays,
          grossAmount: payrollRunEmployeesTable.grossAmount,
          netAmount: payrollRunEmployeesTable.netAmount,
        })
        .from(payrollRunEmployeesTable)
        .innerJoin(employeesTable, eq(payrollRunEmployeesTable.employeeId, employeesTable.id))
        .where(
          and(
            eq(payrollRunEmployeesTable.workspaceId, workspaceId),
            eq(payrollRunEmployeesTable.runId, run.id),
          ),
        );
      rows.push({
        runId: run.id,
        periodId: run.periodId,
        runType: run.runType,
        status: run.status,
        totalGross: run.totalGross,
        totalNet: run.totalNet,
        employeeCount: run.employeeCount,
        employees,
      });
    }

    return { reportKey: definitionKey, generatedAt, workspaceId, rows };
  }

  if (definitionKey === "hr.payroll.components") {
    const conditions = [eq(payrollComponentsTable.workspaceId, workspaceId)];
    const components = await db.select().from(payrollComponentsTable).where(and(...conditions));

    let values: Array<typeof payrollComponentValuesTable.$inferSelect> = [];
    if (runId) {
      values = await db
        .select({
          id: payrollComponentValuesTable.id,
          workspaceId: payrollComponentValuesTable.workspaceId,
          runEmployeeId: payrollComponentValuesTable.runEmployeeId,
          componentId: payrollComponentValuesTable.componentId,
          source: payrollComponentValuesTable.source,
          quantity: payrollComponentValuesTable.quantity,
          rate: payrollComponentValuesTable.rate,
          amount: payrollComponentValuesTable.amount,
          currencyCode: payrollComponentValuesTable.currencyCode,
        })
        .from(payrollComponentValuesTable)
        .innerJoin(
          payrollRunEmployeesTable,
          eq(payrollComponentValuesTable.runEmployeeId, payrollRunEmployeesTable.id),
        )
        .where(
          and(
            eq(payrollComponentValuesTable.workspaceId, workspaceId),
            eq(payrollRunEmployeesTable.runId, runId),
          ),
        );
    }

    return {
      reportKey: definitionKey,
      generatedAt,
      workspaceId,
      payrollRunId: runId ?? null,
      components,
      componentValues: values,
    };
  }

  if (definitionKey === "hr.payroll.payslips.batch") {
    if (!runId) throw new Error("payrollRunId required");
    const payslips = await db
      .select({
        id: payrollPayslipsTable.id,
        employeeId: payrollPayslipsTable.employeeId,
        payslipNumber: payrollPayslipsTable.payslipNumber,
        status: payrollPayslipsTable.status,
        grossAmount: payrollPayslipsTable.grossAmount,
        netAmount: payrollPayslipsTable.netAmount,
        issuedAt: payrollPayslipsTable.issuedAt,
        employeeName: employeesTable.fullName,
      })
      .from(payrollPayslipsTable)
      .innerJoin(employeesTable, eq(payrollPayslipsTable.employeeId, employeesTable.id))
      .where(
        and(eq(payrollPayslipsTable.workspaceId, workspaceId), eq(payrollPayslipsTable.runId, runId)),
      );
    return { reportKey: definitionKey, generatedAt, workspaceId, payrollRunId: runId, payslips };
  }

  throw new Error(`Unknown payroll report: ${definitionKey}`);
}
