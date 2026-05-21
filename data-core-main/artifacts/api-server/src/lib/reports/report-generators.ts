import { db } from "@workspace/db";
import {
  employeesTable,
  hrOrgUnitsTable,
  hrJobTitlesTable,
  hrJobGradesTable,
  hrCustomFieldDefsTable,
  hrCustomFieldValuesTable,
  hrAttendanceTable,
  hrShiftsTable,
  hrLeaveBalancesTable,
  hrLeavePoliciesTable,
  leaveRequestsTable,
} from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { buildSpreadsheetArtifact, type ReportArtifact } from "./artifact-builder";
import type { ReportFormat } from "./report-definition-registry";
import { generatePdfReport } from "./pdf-report-generator";
import { generateWorkforceOpsReport } from "../workforce-ops/operational-reports";
import { generatePayrollFoundationReport } from "../payroll/payroll-reports";
import { generatePayslipPdfReport } from "../payroll/payroll-pdf-generator";

export type ReportParams = Record<string, string | number | boolean | undefined>;

async function generateEmployeesRoster(
  workspaceId: number,
  format: ReportFormat,
  params: ReportParams,
): Promise<ReportArtifact> {
  const conditions = [eq(employeesTable.workspaceId, workspaceId)];
  if (params.orgUnitId) conditions.push(eq(employeesTable.orgUnitId, Number(params.orgUnitId)));
  if (params.status) conditions.push(eq(employeesTable.status, String(params.status)));
  if (params.employmentType) conditions.push(eq(employeesTable.employmentType, String(params.employmentType)));

  const managerAlias = alias(employeesTable, "mgr_export");

  const rows = await db
    .select({
      id: employeesTable.id,
      employeeNumber: employeesTable.employeeNumber,
      fullName: employeesTable.fullName,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      email: employeesTable.email,
      phoneNumber: employeesTable.phoneNumber,
      status: employeesTable.status,
      employmentType: employeesTable.employmentType,
      hireDate: employeesTable.hireDate,
      endDate: employeesTable.endDate,
      orgUnitName: hrOrgUnitsTable.name,
      jobTitleName: hrJobTitlesTable.name,
      jobGradeName: hrJobGradesTable.name,
      managerNumber: managerAlias.employeeNumber,
      createdAt: employeesTable.createdAt,
    })
    .from(employeesTable)
    .leftJoin(hrOrgUnitsTable, eq(employeesTable.orgUnitId, hrOrgUnitsTable.id))
    .leftJoin(hrJobTitlesTable, eq(employeesTable.jobTitleId, hrJobTitlesTable.id))
    .leftJoin(hrJobGradesTable, eq(employeesTable.jobGradeId, hrJobGradesTable.id))
    .leftJoin(managerAlias, eq(employeesTable.directManagerId, managerAlias.id))
    .where(and(...conditions))
    .orderBy(asc(employeesTable.fullName));

  const cfDefs = await db
    .select()
    .from(hrCustomFieldDefsTable)
    .where(and(eq(hrCustomFieldDefsTable.workspaceId, workspaceId), eq(hrCustomFieldDefsTable.isActive, true)));

  const cfValMap = new Map<string, string>();
  if (rows.length > 0) {
    const cfValues = await db
      .select()
      .from(hrCustomFieldValuesTable)
      .where(
        sql`employee_id = ANY(${sql`ARRAY[${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}]`})`,
      );
    for (const cv of cfValues) {
      cfValMap.set(`${cv.employeeId}__${cv.fieldDefId}`, String(cv.value ?? ""));
    }
  }

  const exportRows = rows.map((r) => {
    const base: Record<string, unknown> = {
      "Employee Number": r.employeeNumber ?? "",
      "Full Name": r.fullName,
      Email: r.email ?? "",
      Status: r.status ?? "",
      "Employment Type": r.employmentType ?? "",
      "Hire Date": r.hireDate ?? "",
      "Org Unit": r.orgUnitName ?? "",
      "Job Title": r.jobTitleName ?? "",
      "Job Grade": r.jobGradeName ?? "",
      "Manager #": r.managerNumber ?? "",
    };
    for (const cf of cfDefs) {
      base[`CF: ${cf.label}`] = cfValMap.get(`${r.id}__${cf.id}`) ?? "";
    }
    return base;
  });

  return buildSpreadsheetArtifact(exportRows, format, "employees_export", "Employees");
}

async function generateAttendancePeriod(
  workspaceId: number,
  format: ReportFormat,
  params: ReportParams,
): Promise<ReportArtifact> {
  const conditions = [eq(hrAttendanceTable.workspaceId, workspaceId)];
  if (params.dateFrom) conditions.push(sql`${hrAttendanceTable.date} >= ${String(params.dateFrom)}`);
  if (params.dateTo) conditions.push(sql`${hrAttendanceTable.date} <= ${String(params.dateTo)}`);
  if (params.status) conditions.push(eq(hrAttendanceTable.status, String(params.status)));

  const rows = await db
    .select({
      employeeNumber: employeesTable.employeeNumber,
      employeeName: employeesTable.fullName,
      date: hrAttendanceTable.date,
      checkIn: hrAttendanceTable.checkIn,
      checkOut: hrAttendanceTable.checkOut,
      status: hrAttendanceTable.status,
      shiftName: hrShiftsTable.name,
      overtimeMinutes: hrAttendanceTable.overtimeMinutes,
      notes: hrAttendanceTable.notes,
    })
    .from(hrAttendanceTable)
    .innerJoin(employeesTable, eq(hrAttendanceTable.employeeId, employeesTable.id))
    .leftJoin(hrShiftsTable, eq(hrAttendanceTable.shiftId, hrShiftsTable.id))
    .where(and(...conditions))
    .orderBy(asc(hrAttendanceTable.date), asc(employeesTable.fullName));

  const exportRows = rows.map((r) => ({
    employee_number: r.employeeNumber ?? "",
    employee_name: r.employeeName ?? "",
    date: r.date,
    check_in: r.checkIn ?? "",
    check_out: r.checkOut ?? "",
    status: r.status,
    shift_name: r.shiftName ?? "",
    overtime_minutes: r.overtimeMinutes,
    notes: r.notes ?? "",
  }));

  return buildSpreadsheetArtifact(exportRows, format, "attendance_export", "Attendance");
}

async function generateLeaveBalances(
  workspaceId: number,
  format: ReportFormat,
  params: ReportParams,
): Promise<ReportArtifact> {
  const conditions = [eq(hrLeaveBalancesTable.workspaceId, workspaceId)];
  if (params.year) conditions.push(eq(hrLeaveBalancesTable.year, Number(params.year)));

  const rows = await db
    .select({
      employeeNumber: employeesTable.employeeNumber,
      employeeName: employeesTable.fullName,
      leaveType: hrLeaveBalancesTable.leaveType,
      year: hrLeaveBalancesTable.year,
      entitled: hrLeaveBalancesTable.entitled,
      used: hrLeaveBalancesTable.used,
      pending: hrLeaveBalancesTable.pending,
      policyName: hrLeavePoliciesTable.name,
    })
    .from(hrLeaveBalancesTable)
    .innerJoin(employeesTable, eq(hrLeaveBalancesTable.employeeId, employeesTable.id))
    .leftJoin(hrLeavePoliciesTable, eq(hrLeaveBalancesTable.leavePolicyId, hrLeavePoliciesTable.id))
    .where(and(...conditions))
    .orderBy(asc(employeesTable.fullName), asc(hrLeaveBalancesTable.leaveType));

  const exportRows = rows.map((r) => ({
    employee_number: r.employeeNumber ?? "",
    employee_name: r.employeeName ?? "",
    leave_type: r.leaveType,
    year: r.year,
    entitled: r.entitled,
    used: r.used,
    pending: r.pending,
    policy: r.policyName ?? "",
  }));

  return buildSpreadsheetArtifact(exportRows, format, "leave_balances_export", "Leave Balances");
}

async function generateLeaveRequests(
  workspaceId: number,
  format: ReportFormat,
  params: ReportParams,
): Promise<ReportArtifact> {
  const conditions = [eq(leaveRequestsTable.workspaceId, workspaceId)];
  if (params.status) conditions.push(eq(leaveRequestsTable.status, String(params.status)));
  if (params.dateFrom) conditions.push(sql`${leaveRequestsTable.startDate} >= ${String(params.dateFrom)}`);
  if (params.dateTo) conditions.push(sql`${leaveRequestsTable.endDate} <= ${String(params.dateTo)}`);

  const rows = await db
    .select({
      employeeNumber: employeesTable.employeeNumber,
      employeeName: employeesTable.fullName,
      leaveType: leaveRequestsTable.leaveType,
      startDate: leaveRequestsTable.startDate,
      endDate: leaveRequestsTable.endDate,
      daysRequested: leaveRequestsTable.daysRequested,
      status: leaveRequestsTable.status,
      submittedAt: leaveRequestsTable.createdAt,
    })
    .from(leaveRequestsTable)
    .innerJoin(employeesTable, eq(leaveRequestsTable.employeeId, employeesTable.id))
    .where(and(...conditions))
    .orderBy(asc(leaveRequestsTable.startDate), asc(employeesTable.fullName));

  const exportRows = rows.map((r) => ({
    employee_number: r.employeeNumber ?? "",
    employee_name: r.employeeName ?? "",
    leave_type: r.leaveType,
    start_date: r.startDate,
    end_date: r.endDate,
    days: r.daysRequested,
    status: r.status,
    submitted_at: r.submittedAt?.toISOString?.() ?? String(r.submittedAt ?? ""),
  }));

  return buildSpreadsheetArtifact(exportRows, format, "leave_requests_export", "Leave Requests");
}

export async function runReportGenerator(
  definitionKey: string,
  workspaceId: number,
  format: ReportFormat,
  params: ReportParams,
): Promise<ReportArtifact> {
  if (definitionKey.startsWith("hr.workforce.")) {
    return generateWorkforceOpsReport(definitionKey, workspaceId);
  }
  if (definitionKey === "hr.payroll.payslip.pdf") {
    return generatePayslipPdfReport(workspaceId, params);
  }
  if (
    [
      "hr.payroll.variance",
      "hr.payroll.correction.activity",
      "hr.payroll.warnings",
      "hr.payroll.component.summary",
      "hr.payroll.locked.period.audit",
      "hr.payroll.exceptions",
    ].includes(definitionKey)
  ) {
    const { generatePayrollOpsReport } = await import("../payroll/payroll-ops-reports");
    return generatePayrollOpsReport(definitionKey, workspaceId, params);
  }
  if (definitionKey.startsWith("platform.")) {
    const { generatePlatformGovernanceReport } = await import("../platform/platform-governance-reports");
    return generatePlatformGovernanceReport(definitionKey, workspaceId, params);
  }
  if (definitionKey.startsWith("hr.payroll.")) {
    return generatePayrollFoundationReport(definitionKey, workspaceId, params);
  }
  if (format === "pdf") {
    return generatePdfReport(definitionKey, workspaceId, params);
  }
  switch (definitionKey) {
    case "hr.employees.roster":
      return generateEmployeesRoster(workspaceId, format, params);
    case "hr.attendance.period":
      return generateAttendancePeriod(workspaceId, format, params);
    case "hr.leave.balances":
      return generateLeaveBalances(workspaceId, format, params);
    case "hr.leave.requests":
      return generateLeaveRequests(workspaceId, format, params);
    default:
      throw new Error(`Unknown report definition: ${definitionKey}`);
  }
}

/** Estimate row count for async threshold without full generation */
export async function estimateReportRows(
  definitionKey: string,
  workspaceId: number,
  params: ReportParams,
): Promise<number> {
  switch (definitionKey) {
    case "hr.employees.roster": {
      const conditions = [eq(employeesTable.workspaceId, workspaceId)];
      if (params.orgUnitId) conditions.push(eq(employeesTable.orgUnitId, Number(params.orgUnitId)));
      const r = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(employeesTable)
        .where(and(...conditions));
      return r[0]?.n ?? 0;
    }
    case "hr.attendance.period": {
      const conditions = [eq(hrAttendanceTable.workspaceId, workspaceId)];
      if (params.dateFrom) conditions.push(sql`${hrAttendanceTable.date} >= ${String(params.dateFrom)}`);
      const r = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(hrAttendanceTable)
        .where(and(...conditions));
      return r[0]?.n ?? 0;
    }
    case "hr.leave.balances": {
      const r = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(hrLeaveBalancesTable)
        .where(eq(hrLeaveBalancesTable.workspaceId, workspaceId));
      return r[0]?.n ?? 0;
    }
    default:
      return 0;
  }
}
