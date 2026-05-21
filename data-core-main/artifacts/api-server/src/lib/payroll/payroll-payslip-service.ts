/**
 * P21-C — Canonical payslip lifecycle
 */
import { db } from "@workspace/db";
import {
  payrollPayslipsTable,
  payrollRunsTable,
  payrollRunEmployeesTable,
  payrollComponentValuesTable,
  payrollComponentsTable,
  payrollPeriodsTable,
  employeesTable,
  hrWorkspaceCountersTable,
} from "@workspace/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { EVENT_TYPES } from "@workspace/core-events";
import { Money } from "./money";
import { logPayrollAccess } from "./payroll-audit";
import { payrollRunWorkflow } from "./payroll-run-workflow";
import { emitPayrollEvent } from "./payroll-events";

export class PayrollPayslipService {
  async createDraftPayslipsForRun(workspaceId: number, runId: number, userId?: number) {
    const run = await payrollRunWorkflow.getRun(workspaceId, runId);
    if (!["final", "correction"].includes(run.runType)) {
      throw new Error("Payslips are created for final or correction runs only");
    }

    const employees = await db
      .select()
      .from(payrollRunEmployeesTable)
      .where(
        and(
          eq(payrollRunEmployeesTable.workspaceId, workspaceId),
          eq(payrollRunEmployeesTable.runId, runId),
          eq(payrollRunEmployeesTable.status, "included"),
        ),
      );

    const created = [];
    for (const emp of employees) {
      const lines = await this.loadComponentLines(emp.id);
      const snapshot = {
        runId,
        employeeId: emp.employeeId,
        gross: emp.grossAmount,
        net: emp.netAmount,
        lines,
        input: emp.inputSnapshotJson ? JSON.parse(emp.inputSnapshotJson) : null,
      };

      const [existing] = await db
        .select()
        .from(payrollPayslipsTable)
        .where(
          and(
            eq(payrollPayslipsTable.runId, runId),
            eq(payrollPayslipsTable.employeeId, emp.employeeId),
          ),
        )
        .limit(1);

      if (existing) {
        const [updated] = await db
          .update(payrollPayslipsTable)
          .set({
            grossAmount: emp.grossAmount,
            netAmount: emp.netAmount,
            totalDeductions: Money.fromDb(emp.grossAmount)
              .sub(Money.fromDb(emp.netAmount))
              .toStorageString(),
            snapshotJson: JSON.stringify(snapshot),
            ytdJson: JSON.stringify(await this.computeYtd(workspaceId, emp.employeeId, run.periodId)),
          })
          .where(eq(payrollPayslipsTable.id, existing.id))
          .returning();
        created.push(updated!);
        continue;
      }

      const [row] = await db
        .insert(payrollPayslipsTable)
        .values({
          workspaceId,
          runId,
          runEmployeeId: emp.id,
          employeeId: emp.employeeId,
          status: "draft",
          grossAmount: emp.grossAmount,
          netAmount: emp.netAmount,
          totalDeductions: Money.fromDb(emp.grossAmount)
            .sub(Money.fromDb(emp.netAmount))
            .toStorageString(),
          currencyCode: run.currencyCode,
          snapshotJson: JSON.stringify(snapshot),
          ytdJson: JSON.stringify(await this.computeYtd(workspaceId, emp.employeeId, run.periodId)),
        })
        .returning();
      created.push(row!);
    }

    logPayrollAccess({
      workspaceId,
      userId,
      action: "payslips_draft_create",
      resourceType: "payroll_run",
      resourceId: runId,
      metadata: { count: created.length },
    });

    return created;
  }

  async issuePayslips(workspaceId: number, runId: number, userId?: number) {
    const run = await payrollRunWorkflow.getRun(workspaceId, runId);
    if (run.status !== "locked" && run.status !== "approved") {
      throw new Error("Run must be approved or locked before issuing payslips");
    }

    const drafts = await db
      .select()
      .from(payrollPayslipsTable)
      .where(
        and(
          eq(payrollPayslipsTable.workspaceId, workspaceId),
          eq(payrollPayslipsTable.runId, runId),
          eq(payrollPayslipsTable.status, "draft"),
        ),
      );

    const issued = [];
    for (const slip of drafts) {
      const number = slip.payslipNumber ?? (await this.nextPayslipNumber(workspaceId));
      const [row] = await db
        .update(payrollPayslipsTable)
        .set({
          status: "issued",
          payslipNumber: number,
          issuedAt: new Date(),
          issuedByUserId: userId ?? null,
        })
        .where(eq(payrollPayslipsTable.id, slip.id))
        .returning();
      issued.push(row!);

      await emitPayrollEvent(EVENT_TYPES.PAYROLL_PAYSLIP_ISSUED, {
        workspaceId,
        userId,
        runId,
        payslipId: row!.id,
        employeeId: row!.employeeId,
      });
    }

    logPayrollAccess({
      workspaceId,
      userId,
      action: "payslips_issue",
      resourceType: "payroll_run",
      resourceId: runId,
      metadata: { count: issued.length },
    });

    return issued;
  }

  async getPayslip(workspaceId: number, payslipId: number) {
    const [row] = await db
      .select()
      .from(payrollPayslipsTable)
      .where(
        and(eq(payrollPayslipsTable.id, payslipId), eq(payrollPayslipsTable.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!row) throw new Error("Payslip not found");
    return row;
  }

  async listPayslipsForRun(workspaceId: number, runId: number) {
    return db
      .select({
        payslip: payrollPayslipsTable,
        employeeName: employeesTable.fullName,
        employeeNumber: employeesTable.employeeNumber,
      })
      .from(payrollPayslipsTable)
      .innerJoin(employeesTable, eq(payrollPayslipsTable.employeeId, employeesTable.id))
      .where(
        and(eq(payrollPayslipsTable.workspaceId, workspaceId), eq(payrollPayslipsTable.runId, runId)),
      );
  }

  async attachPdfStorageKey(payslipId: number, workspaceId: number, storageKey: string) {
    await db
      .update(payrollPayslipsTable)
      .set({ pdfStorageKey: storageKey })
      .where(
        and(eq(payrollPayslipsTable.id, payslipId), eq(payrollPayslipsTable.workspaceId, workspaceId)),
      );
  }

  async voidDraftPayslip(workspaceId: number, payslipId: number, userId?: number, reason?: string) {
    const slip = await this.getPayslip(workspaceId, payslipId);
    if (slip.status !== "draft") {
      throw new Error("Only draft payslips can be voided");
    }
    const [row] = await db
      .update(payrollPayslipsTable)
      .set({
        status: "void",
        snapshotJson: JSON.stringify({
          ...(slip.snapshotJson ? JSON.parse(slip.snapshotJson) : {}),
          voidReason: reason ?? "Voided from ops",
          voidedAt: new Date().toISOString(),
        }),
      })
      .where(eq(payrollPayslipsTable.id, payslipId))
      .returning();
    logPayrollAccess({
      workspaceId,
      userId,
      action: "payslip_void_draft",
      resourceType: "payroll_payslip",
      resourceId: payslipId,
    });
    return row!;
  }

  async recordReissueMetadata(
    workspaceId: number,
    payslipId: number,
    userId?: number,
    note?: string,
  ) {
    const slip = await this.getPayslip(workspaceId, payslipId);
    if (slip.status !== "issued") {
      throw new Error("Reissue metadata applies to issued payslips only");
    }
    const meta = slip.snapshotJson ? JSON.parse(slip.snapshotJson) : {};
    meta.reissue = {
      requestedAt: new Date().toISOString(),
      requestedByUserId: userId ?? null,
      note: note ?? null,
      distribution: "none",
    };
    const [row] = await db
      .update(payrollPayslipsTable)
      .set({ snapshotJson: JSON.stringify(meta) })
      .where(eq(payrollPayslipsTable.id, payslipId))
      .returning();
    logPayrollAccess({
      workspaceId,
      userId,
      action: "payslip_reissue_metadata",
      resourceType: "payroll_payslip",
      resourceId: payslipId,
    });
    return row!;
  }

  async logPdfAccess(workspaceId: number, payslipId: number, userId?: number) {
    logPayrollAccess({
      workspaceId,
      userId,
      action: "payslip_pdf_access",
      resourceType: "payroll_payslip",
      resourceId: payslipId,
    });
  }

  private async loadComponentLines(runEmployeeId: number) {
    return db
      .select({
        code: payrollComponentsTable.code,
        name: payrollComponentsTable.name,
        componentClass: payrollComponentsTable.componentClass,
        amount: payrollComponentValuesTable.amount,
        source: payrollComponentValuesTable.source,
      })
      .from(payrollComponentValuesTable)
      .leftJoin(
        payrollComponentsTable,
        eq(payrollComponentValuesTable.componentId, payrollComponentsTable.id),
      )
      .where(eq(payrollComponentValuesTable.runEmployeeId, runEmployeeId));
  }

  private async computeYtd(workspaceId: number, employeeId: number, periodId: number) {
    const [period] = await db
      .select()
      .from(payrollPeriodsTable)
      .where(eq(payrollPeriodsTable.id, periodId))
      .limit(1);
    if (!period) return { grossYtd: "0", netYtd: "0" };

    const yearStart = String(period.periodStart).slice(0, 4) + "-01-01";
    const rows = await db
      .select({
        gross: payrollPayslipsTable.grossAmount,
        net: payrollPayslipsTable.netAmount,
      })
      .from(payrollPayslipsTable)
      .innerJoin(payrollRunsTable, eq(payrollPayslipsTable.runId, payrollRunsTable.id))
      .innerJoin(payrollPeriodsTable, eq(payrollRunsTable.periodId, payrollPeriodsTable.id))
      .where(
        and(
          eq(payrollPayslipsTable.workspaceId, workspaceId),
          eq(payrollPayslipsTable.employeeId, employeeId),
          eq(payrollPayslipsTable.status, "issued"),
          gte(payrollPeriodsTable.periodEnd, yearStart),
          lte(payrollPeriodsTable.periodEnd, period.periodEnd),
        ),
      );

    let gross = 0;
    let net = 0;
    for (const r of rows) {
      gross += Number(r.gross);
      net += Number(r.net);
    }
    return { grossYtd: gross.toFixed(4), netYtd: net.toFixed(4) };
  }

  private async nextPayslipNumber(workspaceId: number): Promise<string> {
    const counterName = "payslip_number";
    const [row] = await db
      .select()
      .from(hrWorkspaceCountersTable)
      .where(
        and(
          eq(hrWorkspaceCountersTable.workspaceId, workspaceId),
          eq(hrWorkspaceCountersTable.counterName, counterName),
        ),
      )
      .limit(1);

    let next = (row?.currentValue ?? 1000) + 1;
    if (row) {
      await db
        .update(hrWorkspaceCountersTable)
        .set({ currentValue: next })
        .where(
          and(
            eq(hrWorkspaceCountersTable.workspaceId, workspaceId),
            eq(hrWorkspaceCountersTable.counterName, counterName),
          ),
        );
    } else {
      await db.insert(hrWorkspaceCountersTable).values({
        workspaceId,
        counterName,
        currentValue: next,
      });
    }

    const year = new Date().getFullYear();
    return `PS-${year}-${String(next).padStart(6, "0")}`;
  }
}

export const payrollPayslipService = new PayrollPayslipService();
