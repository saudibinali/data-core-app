/**
 * P21-D — Financial export readiness (no bank posting / GL posting)
 */
import { db } from "@workspace/db";
import {
  payrollRunsTable,
  payrollRunEmployeesTable,
  payrollComponentValuesTable,
  payrollComponentsTable,
  payrollPeriodsTable,
  payrollPayslipsTable,
  employeesTable,
  hrOrgUnitsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Money } from "./money";
import { logPayrollAccess } from "./payroll-audit";
import type { ReportArtifact } from "../reports/artifact-builder";

export type GlJournalLine = {
  postingDate: string;
  periodLabel: string;
  runId: number;
  employeeId: number | null;
  employeeNumber: string | null;
  componentCode: string;
  debitAccount: string | null;
  creditAccount: string | null;
  costCenter: string | null;
  exportCode: string | null;
  debit: string;
  credit: string;
  amount: string;
  currency: string;
  description: string;
};

export type BankPaymentMetadata = {
  beneficiaryName: string;
  employeeId: number;
  employeeNumber: string | null;
  amount: string;
  currency: string;
  reference: string | null;
  valueDate: string;
  iban: string | null;
  bankReady: boolean;
};

export class FinancialExportService {
  async getExportReadiness(workspaceId: number) {
    const components = await db
      .select()
      .from(payrollComponentsTable)
      .where(eq(payrollComponentsTable.workspaceId, workspaceId));

    const missingGl = components.filter(
      (c) => c.isActive && !c.debitAccountCode && !c.glAccountCode,
    );

    const lockedRuns = await db
      .select({ id: payrollRunsTable.id })
      .from(payrollRunsTable)
      .where(
        and(eq(payrollRunsTable.workspaceId, workspaceId), eq(payrollRunsTable.status, "locked")),
      );

    return {
      glMappingComplete: missingGl.length === 0,
      componentsMissingGl: missingGl.length,
      lockedRunsReady: lockedRuns.length,
      bankExportReady: false,
      accountingPostReady: false,
      message: "Foundation exports only — no live bank or ERP posting",
    };
  }

  async buildGlJournal(
    workspaceId: number,
    runId: number,
    options?: { persistPreparedBatch?: boolean; userId?: number },
  ): Promise<GlJournalLine[]> {
    const [run] = await db
      .select({
        run: payrollRunsTable,
        periodLabel: payrollPeriodsTable.periodLabel,
        periodEnd: payrollPeriodsTable.periodEnd,
      })
      .from(payrollRunsTable)
      .innerJoin(payrollPeriodsTable, eq(payrollRunsTable.periodId, payrollPeriodsTable.id))
      .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.workspaceId, workspaceId)))
      .limit(1);

    if (!run) throw new Error("Payroll run not found");
    if (run.run.status !== "locked" && run.run.status !== "approved") {
      throw new Error("Run must be approved or locked for GL export");
    }

    const lines = await db
      .select({
        amount: payrollComponentValuesTable.amount,
        currency: payrollComponentValuesTable.currencyCode,
        code: payrollComponentsTable.code,
        name: payrollComponentsTable.name,
        componentClass: payrollComponentsTable.componentClass,
        debitAccount: payrollComponentsTable.debitAccountCode,
        creditAccount: payrollComponentsTable.creditAccountCode,
        glAccount: payrollComponentsTable.glAccountCode,
        costCenter: payrollComponentsTable.costCenterCode,
        exportCode: payrollComponentsTable.exportCode,
        employeeId: payrollRunEmployeesTable.employeeId,
        employeeNumber: employeesTable.employeeNumber,
        orgUnitName: hrOrgUnitsTable.name,
      })
      .from(payrollComponentValuesTable)
      .innerJoin(
        payrollRunEmployeesTable,
        eq(payrollComponentValuesTable.runEmployeeId, payrollRunEmployeesTable.id),
      )
      .innerJoin(employeesTable, eq(payrollRunEmployeesTable.employeeId, employeesTable.id))
      .leftJoin(hrOrgUnitsTable, eq(employeesTable.orgUnitId, hrOrgUnitsTable.id))
      .leftJoin(
        payrollComponentsTable,
        eq(payrollComponentValuesTable.componentId, payrollComponentsTable.id),
      )
      .where(
        and(
          eq(payrollComponentValuesTable.workspaceId, workspaceId),
          eq(payrollRunEmployeesTable.runId, runId),
        ),
      );

    const postingDate = run.run.approvedAt
      ? new Date(run.run.approvedAt).toISOString().slice(0, 10)
      : String(run.periodEnd);

    const glLines = lines.map((l) => {
      const amt = Money.fromDb(l.amount, l.currency);
      const isDeduction = l.componentClass === "deduction";
      const debitAcct = l.debitAccount ?? (isDeduction ? null : l.glAccount);
      const creditAcct = l.creditAccount ?? (isDeduction ? l.glAccount : null);
      const costCenter = l.costCenter ?? l.orgUnitName ?? null;

      return {
        postingDate,
        periodLabel: run.periodLabel,
        runId,
        employeeId: l.employeeId,
        employeeNumber: l.employeeNumber,
        componentCode: l.code ?? "UNKNOWN",
        debitAccount: debitAcct,
        creditAccount: creditAcct,
        costCenter,
        exportCode: l.exportCode,
        debit: isDeduction ? "0.0000" : amt.toStorageString(),
        credit: isDeduction ? amt.toStorageString() : "0.0000",
        amount: amt.toStorageString(),
        currency: l.currency,
        description: `${l.name ?? l.code} — ${run.periodLabel}`,
      };
    });

    return glLines;
  }

  async buildCostCenterSummary(workspaceId: number, runId: number) {
    const journal = await this.buildGlJournal(workspaceId, runId);
    const map = new Map<string, { costCenter: string; debit: Money; credit: Money }>();

    for (const line of journal) {
      const key = line.costCenter ?? "UNASSIGNED";
      const entry = map.get(key) ?? {
        costCenter: key,
        debit: Money.zero(line.currency),
        credit: Money.zero(line.currency),
      };
      entry.debit = entry.debit.add(Money.fromDb(line.debit, line.currency));
      entry.credit = entry.credit.add(Money.fromDb(line.credit, line.currency));
      map.set(key, entry);
    }

    return Array.from(map.values()).map((e) => ({
      costCenter: e.costCenter,
      totalDebit: e.debit.toStorageString(),
      totalCredit: e.credit.toStorageString(),
    }));
  }

  async buildBankPaymentMetadata(workspaceId: number, runId: number): Promise<BankPaymentMetadata[]> {
    const payslips = await db
      .select({
        payslip: payrollPayslipsTable,
        employeeName: employeesTable.fullName,
        employeeNumber: employeesTable.employeeNumber,
      })
      .from(payrollPayslipsTable)
      .innerJoin(employeesTable, eq(payrollPayslipsTable.employeeId, employeesTable.id))
      .where(
        and(
          eq(payrollPayslipsTable.workspaceId, workspaceId),
          eq(payrollPayslipsTable.runId, runId),
          eq(payrollPayslipsTable.status, "issued"),
        ),
      );

    const valueDate = new Date().toISOString().slice(0, 10);

    return payslips.map((p) => ({
      beneficiaryName: p.employeeName,
      employeeId: p.payslip.employeeId,
      employeeNumber: p.employeeNumber,
      amount: p.payslip.netAmount,
      currency: p.payslip.currencyCode,
      reference: p.payslip.payslipNumber,
      valueDate,
      iban: null,
      bankReady: false,
    }));
  }

  async exportArtifact(
    workspaceId: number,
    exportType: "gl_journal" | "cost_center" | "bank_metadata",
    runId: number,
    userId?: number,
  ): Promise<ReportArtifact> {
    let body: unknown;
    let fileName: string;

    if (exportType === "gl_journal") {
      body = { lines: await this.buildGlJournal(workspaceId, runId) };
      fileName = `gl_journal_run_${runId}.json`;
    } else if (exportType === "cost_center") {
      body = { summary: await this.buildCostCenterSummary(workspaceId, runId) };
      fileName = `cost_center_run_${runId}.json`;
    } else {
      body = { payments: await this.buildBankPaymentMetadata(workspaceId, runId) };
      fileName = `bank_metadata_run_${runId}.json`;
    }

    logPayrollAccess({
      workspaceId,
      userId,
      action: `financial_export_${exportType}`,
      resourceType: "payroll_run",
      resourceId: runId,
    });

    const json = JSON.stringify(body, null, 2);
    return {
      buffer: Buffer.from(json, "utf8"),
      contentType: "application/json",
      fileName,
      rowCount: Array.isArray((body as { lines?: unknown[] }).lines)
        ? (body as { lines: unknown[] }).lines.length
        : 1,
    };
  }
}

export const financialExportService = new FinancialExportService();
