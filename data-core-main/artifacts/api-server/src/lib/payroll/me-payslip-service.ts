/**
 * F6.3 — Self-service payslip bridge (legacy hr_payslips + canonical payroll_payslips).
 */
import { db } from "@workspace/db";
import {
  employeesTable,
  hrPayslipLinesTable,
  hrPayslipsTable,
  hrPayrollRunsTable,
  payrollComponentValuesTable,
  payrollComponentsTable,
  payrollPayslipsTable,
  payrollPeriodsTable,
  payrollRunEmployeesTable,
  payrollRunsTable,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { isPayrollCutoverEnabledForWorkspace } from "../payroll-cutover-flags";

export type MePayslipListItem = {
  id: number;
  source: "legacy" | "canonical";
  payrollRunId: number;
  runName: string;
  periodYear: number | null;
  periodMonth: number | null;
  periodLabel: string | null;
  basicSalary: string | null;
  totalAllowances: string | null;
  totalDeductions: string | null;
  grossSalary: string;
  netSalary: string;
  currencyCode: string;
  status: string;
  pdfAvailable: boolean;
  payslipNumber: string | null;
};

export type MePayslipDetail = MePayslipListItem & {
  lines: Array<Record<string, unknown>>;
  run: Record<string, unknown> | null;
};

async function resolveEmployee(workspaceId: number, userId: number) {
  const [emp] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)))
    .limit(1);
  return emp ?? null;
}

function parsePeriodLabel(label: string | null): { year: number | null; month: number | null } {
  if (!label) return { year: null, month: null };
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return { year: null, month: null };
  return { year: Number(m[1]), month: Number(m[2]) };
}

async function listLegacyMePayslips(workspaceId: number, employeeId: number): Promise<MePayslipListItem[]> {
  const rows = await db
    .select({
      id: hrPayslipsTable.id,
      payrollRunId: hrPayslipsTable.payrollRunId,
      runName: hrPayrollRunsTable.name,
      periodYear: hrPayrollRunsTable.periodYear,
      periodMonth: hrPayrollRunsTable.periodMonth,
      basicSalary: hrPayslipsTable.basicSalary,
      totalAllowances: hrPayslipsTable.totalAllowances,
      totalDeductions: hrPayslipsTable.totalDeductions,
      grossSalary: hrPayslipsTable.grossSalary,
      netSalary: hrPayslipsTable.netSalary,
      currencyCode: hrPayslipsTable.currencyCode,
      status: hrPayslipsTable.status,
    })
    .from(hrPayslipsTable)
    .innerJoin(hrPayrollRunsTable, eq(hrPayslipsTable.payrollRunId, hrPayrollRunsTable.id))
    .where(and(eq(hrPayslipsTable.workspaceId, workspaceId), eq(hrPayslipsTable.employeeId, employeeId)))
    .orderBy(desc(hrPayrollRunsTable.periodYear), desc(hrPayrollRunsTable.periodMonth));

  return rows.map((r) => ({
    id: r.id,
    source: "legacy" as const,
    payrollRunId: r.payrollRunId,
    runName: r.runName,
    periodYear: r.periodYear,
    periodMonth: r.periodMonth,
    periodLabel: r.periodYear && r.periodMonth ? `${r.periodYear}-${String(r.periodMonth).padStart(2, "0")}` : null,
    basicSalary: r.basicSalary,
    totalAllowances: r.totalAllowances,
    totalDeductions: r.totalDeductions,
    grossSalary: r.grossSalary,
    netSalary: r.netSalary,
    currencyCode: r.currencyCode,
    status: r.status,
    pdfAvailable: false,
    payslipNumber: null,
  }));
}

async function listCanonicalMePayslips(workspaceId: number, employeeId: number): Promise<MePayslipListItem[]> {
  const rows = await db
    .select({
      id: payrollPayslipsTable.id,
      payrollRunId: payrollPayslipsTable.runId,
      periodLabel: payrollPeriodsTable.periodLabel,
      grossSalary: payrollPayslipsTable.grossAmount,
      netSalary: payrollPayslipsTable.netAmount,
      totalDeductions: payrollPayslipsTable.totalDeductions,
      currencyCode: payrollPayslipsTable.currencyCode,
      status: payrollPayslipsTable.status,
      pdfStorageKey: payrollPayslipsTable.pdfStorageKey,
      payslipNumber: payrollPayslipsTable.payslipNumber,
      runType: payrollRunsTable.runType,
    })
    .from(payrollPayslipsTable)
    .innerJoin(payrollRunsTable, eq(payrollPayslipsTable.runId, payrollRunsTable.id))
    .innerJoin(payrollPeriodsTable, eq(payrollRunsTable.periodId, payrollPeriodsTable.id))
    .where(
      and(
        eq(payrollPayslipsTable.workspaceId, workspaceId),
        eq(payrollPayslipsTable.employeeId, employeeId),
        eq(payrollPayslipsTable.status, "issued"),
      ),
    )
    .orderBy(desc(payrollPeriodsTable.periodEnd));

  return rows.map((r) => {
    const { year, month } = parsePeriodLabel(r.periodLabel);
    return {
      id: r.id,
      source: "canonical" as const,
      payrollRunId: r.payrollRunId,
      runName: r.periodLabel,
      periodYear: year,
      periodMonth: month,
      periodLabel: r.periodLabel,
      basicSalary: null,
      totalAllowances: null,
      totalDeductions: r.totalDeductions,
      grossSalary: r.grossSalary,
      netSalary: r.netSalary,
      currencyCode: r.currencyCode,
      status: r.status,
      pdfAvailable: Boolean(r.pdfStorageKey),
      payslipNumber: r.payslipNumber,
    };
  });
}

export async function listMePayslips(workspaceId: number, userId: number): Promise<MePayslipListItem[]> {
  const emp = await resolveEmployee(workspaceId, userId);
  if (!emp) return [];

  const useCanonical = isPayrollCutoverEnabledForWorkspace("payrollCanonicalWrite", workspaceId);
  if (useCanonical) {
    const canonical = await listCanonicalMePayslips(workspaceId, emp.id);
    if (canonical.length > 0) return canonical;
  }
  return listLegacyMePayslips(workspaceId, emp.id);
}

async function getLegacyMePayslipDetail(
  workspaceId: number,
  employeeId: number,
  payslipId: number,
): Promise<MePayslipDetail | null> {
  const [payslip] = await db
    .select()
    .from(hrPayslipsTable)
    .where(
      and(
        eq(hrPayslipsTable.id, payslipId),
        eq(hrPayslipsTable.employeeId, employeeId),
        eq(hrPayslipsTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!payslip) return null;

  const lines = await db
    .select()
    .from(hrPayslipLinesTable)
    .where(eq(hrPayslipLinesTable.payslipId, payslipId))
    .orderBy(asc(hrPayslipLinesTable.displayOrder));
  const [run] = await db
    .select()
    .from(hrPayrollRunsTable)
    .where(eq(hrPayrollRunsTable.id, payslip.payrollRunId))
    .limit(1);

  return {
    id: payslip.id,
    source: "legacy",
    payrollRunId: payslip.payrollRunId,
    runName: run?.name ?? "",
    periodYear: run?.periodYear ?? null,
    periodMonth: run?.periodMonth ?? null,
    periodLabel: run ? `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}` : null,
    basicSalary: payslip.basicSalary,
    totalAllowances: payslip.totalAllowances,
    totalDeductions: payslip.totalDeductions,
    grossSalary: payslip.grossSalary,
    netSalary: payslip.netSalary,
    currencyCode: payslip.currencyCode,
    status: payslip.status,
    pdfAvailable: false,
    payslipNumber: null,
    lines: lines as unknown as Array<Record<string, unknown>>,
    run: (run as Record<string, unknown>) ?? null,
  };
}

async function getCanonicalMePayslipDetail(
  workspaceId: number,
  employeeId: number,
  payslipId: number,
): Promise<MePayslipDetail | null> {
  const [row] = await db
    .select({
      payslip: payrollPayslipsTable,
      periodLabel: payrollPeriodsTable.periodLabel,
      periodEnd: payrollPeriodsTable.periodEnd,
      run: payrollRunsTable,
    })
    .from(payrollPayslipsTable)
    .innerJoin(payrollRunsTable, eq(payrollPayslipsTable.runId, payrollRunsTable.id))
    .innerJoin(payrollPeriodsTable, eq(payrollRunsTable.periodId, payrollPeriodsTable.id))
    .where(
      and(
        eq(payrollPayslipsTable.id, payslipId),
        eq(payrollPayslipsTable.employeeId, employeeId),
        eq(payrollPayslipsTable.workspaceId, workspaceId),
        eq(payrollPayslipsTable.status, "issued"),
      ),
    )
    .limit(1);
  if (!row) return null;

  const componentLines = await db
    .select({
      code: payrollComponentsTable.code,
      name: payrollComponentsTable.name,
      nameAr: payrollComponentsTable.nameAr,
      componentClass: payrollComponentsTable.componentClass,
      amount: payrollComponentValuesTable.amount,
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
    .where(eq(payrollRunEmployeesTable.id, row.payslip.runEmployeeId));

  const lines = componentLines.map((l) => ({
    componentType: l.componentClass === "deduction" ? "deduction" : "allowance",
    componentName: l.name ?? l.code,
    componentNameAr: l.nameAr,
    amount: l.amount,
  }));

  const { year, month } = parsePeriodLabel(row.periodLabel);

  return {
    id: row.payslip.id,
    source: "canonical",
    payrollRunId: row.payslip.runId,
    runName: row.periodLabel,
    periodYear: year,
    periodMonth: month,
    periodLabel: row.periodLabel,
    basicSalary: null,
    totalAllowances: null,
    totalDeductions: row.payslip.totalDeductions,
    grossSalary: row.payslip.grossAmount,
    netSalary: row.payslip.netAmount,
    currencyCode: row.payslip.currencyCode,
    status: row.payslip.status,
    pdfAvailable: Boolean(row.payslip.pdfStorageKey),
    payslipNumber: row.payslip.payslipNumber,
    lines,
    run: {
      id: row.run.id,
      periodLabel: row.periodLabel,
      periodYear: year,
      periodMonth: month,
      status: row.run.status,
      runType: row.run.runType,
    },
  };
}

export async function getMePayslipDetail(
  workspaceId: number,
  userId: number,
  payslipId: number,
): Promise<MePayslipDetail | null> {
  const emp = await resolveEmployee(workspaceId, userId);
  if (!emp) return null;

  const useCanonical = isPayrollCutoverEnabledForWorkspace("payrollCanonicalWrite", workspaceId);
  if (useCanonical) {
    const canonical = await getCanonicalMePayslipDetail(workspaceId, emp.id, payslipId);
    if (canonical) return canonical;
  }
  return getLegacyMePayslipDetail(workspaceId, emp.id, payslipId);
}

export async function assertMePayslipOwnership(
  workspaceId: number,
  userId: number,
  payslipId: number,
  source?: "legacy" | "canonical",
): Promise<{ employeeId: number; source: "legacy" | "canonical" } | null> {
  const emp = await resolveEmployee(workspaceId, userId);
  if (!emp) return null;

  if (source !== "legacy") {
    const [canonical] = await db
      .select({ id: payrollPayslipsTable.id })
      .from(payrollPayslipsTable)
      .where(
        and(
          eq(payrollPayslipsTable.id, payslipId),
          eq(payrollPayslipsTable.employeeId, emp.id),
          eq(payrollPayslipsTable.workspaceId, workspaceId),
          eq(payrollPayslipsTable.status, "issued"),
        ),
      )
      .limit(1);
    if (canonical) return { employeeId: emp.id, source: "canonical" };
  }

  if (source !== "canonical") {
    const [legacy] = await db
      .select({ id: hrPayslipsTable.id })
      .from(hrPayslipsTable)
      .where(
        and(
          eq(hrPayslipsTable.id, payslipId),
          eq(hrPayslipsTable.employeeId, emp.id),
          eq(hrPayslipsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (legacy) return { employeeId: emp.id, source: "legacy" };
  }

  return null;
}
