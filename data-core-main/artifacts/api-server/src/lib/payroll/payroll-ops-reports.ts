/**
 * P21-D — Payroll operational reports (JSON)
 */
import { db } from "@workspace/db";
import {
  payrollRunsTable,
  payrollRunEmployeesTable,
  payrollPeriodsTable,
  payrollLocksTable,
  payrollExceptionsTable,
  payrollComponentValuesTable,
  payrollComponentsTable,
  payrollAuditLogsTable,
} from "@workspace/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { ReportArtifact } from "../reports/artifact-builder";

export async function generatePayrollOpsReport(
  definitionKey: string,
  workspaceId: number,
  params: Record<string, string | number | boolean | undefined>,
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

async function buildBody(
  definitionKey: string,
  workspaceId: number,
  params: Record<string, string | number | boolean | undefined>,
) {
  const generatedAt = new Date().toISOString();
  const runId = params.payrollRunId ? Number(params.payrollRunId) : undefined;

  if (definitionKey === "hr.payroll.variance") {
    const corrections = await db
      .select({
        run: payrollRunsTable,
        periodLabel: payrollPeriodsTable.periodLabel,
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
      .limit(50);

    return { reportKey: definitionKey, generatedAt, rows: corrections };
  }

  if (definitionKey === "hr.payroll.correction.activity") {
    const logs = await db
      .select()
      .from(payrollAuditLogsTable)
      .where(
        and(
          eq(payrollAuditLogsTable.workspaceId, workspaceId),
          sql`${payrollAuditLogsTable.action} like '%correction%'`,
        ),
      )
      .orderBy(desc(payrollAuditLogsTable.createdAt))
      .limit(200);
    return { reportKey: definitionKey, generatedAt, rows: logs };
  }

  if (definitionKey === "hr.payroll.warnings") {
    const conditions = [
      eq(payrollRunEmployeesTable.workspaceId, workspaceId),
      ne(payrollRunEmployeesTable.reviewStatus, "ok"),
    ];
    if (runId) conditions.push(eq(payrollRunEmployeesTable.runId, runId));

    const rows = await db
      .select()
      .from(payrollRunEmployeesTable)
      .where(and(...conditions))
      .limit(500);

    return { reportKey: definitionKey, generatedAt, rows };
  }

  if (definitionKey === "hr.payroll.component.summary") {
    if (!runId) throw new Error("payrollRunId required");
    const rows = await db
      .select({
        code: payrollComponentsTable.code,
        name: payrollComponentsTable.name,
        componentClass: payrollComponentsTable.componentClass,
        total: sql<string>`sum(${payrollComponentValuesTable.amount})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(payrollComponentValuesTable)
      .innerJoin(
        payrollRunEmployeesTable,
        eq(payrollComponentValuesTable.runEmployeeId, payrollRunEmployeesTable.id),
      )
      .leftJoin(
        payrollComponentsTable,
        eq(payrollComponentValuesTable.componentId, payrollComponentsTable.id),
      )
      .where(
        and(
          eq(payrollComponentValuesTable.workspaceId, workspaceId),
          eq(payrollRunEmployeesTable.runId, runId),
        ),
      )
      .groupBy(
        payrollComponentsTable.code,
        payrollComponentsTable.name,
        payrollComponentsTable.componentClass,
      );

    return { reportKey: definitionKey, generatedAt, payrollRunId: runId, rows };
  }

  if (definitionKey === "hr.payroll.locked.period.audit") {
    const rows = await db
      .select({
        lock: payrollLocksTable,
        period: payrollPeriodsTable,
      })
      .from(payrollLocksTable)
      .innerJoin(payrollPeriodsTable, eq(payrollLocksTable.periodId, payrollPeriodsTable.id))
      .where(eq(payrollLocksTable.workspaceId, workspaceId))
      .orderBy(desc(payrollLocksTable.lockedAt));

    return { reportKey: definitionKey, generatedAt, rows };
  }

  if (definitionKey === "hr.payroll.exceptions") {
    const conditions = [eq(payrollExceptionsTable.workspaceId, workspaceId)];
    if (runId) conditions.push(eq(payrollExceptionsTable.runId, runId));
    const rows = await db
      .select()
      .from(payrollExceptionsTable)
      .where(and(...conditions))
      .orderBy(desc(payrollExceptionsTable.createdAt));
    return { reportKey: definitionKey, generatedAt, rows };
  }

  throw new Error(`Unknown payroll ops report: ${definitionKey}`);
}
