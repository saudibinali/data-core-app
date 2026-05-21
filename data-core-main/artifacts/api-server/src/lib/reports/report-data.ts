/** Shared row fetchers for spreadsheet + PDF reports */
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
} from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ReportParams } from "./report-generators";

export type ReportTableData = {
  title: string;
  columns: string[];
  rows: string[][];
  metadata: Record<string, string>;
};

export async function fetchEmployeesRosterRows(
  workspaceId: number,
  params: ReportParams,
): Promise<ReportTableData> {
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
      email: employeesTable.email,
      status: employeesTable.status,
      employmentType: employeesTable.employmentType,
      hireDate: employeesTable.hireDate,
      orgUnitName: hrOrgUnitsTable.name,
      jobTitleName: hrJobTitlesTable.name,
      jobGradeName: hrJobGradesTable.name,
      managerNumber: managerAlias.employeeNumber,
    })
    .from(employeesTable)
    .leftJoin(hrOrgUnitsTable, eq(employeesTable.orgUnitId, hrOrgUnitsTable.id))
    .leftJoin(hrJobTitlesTable, eq(employeesTable.jobTitleId, hrJobTitlesTable.id))
    .leftJoin(hrJobGradesTable, eq(employeesTable.jobGradeId, hrJobGradesTable.id))
    .leftJoin(managerAlias, eq(employeesTable.directManagerId, managerAlias.id))
    .where(and(...conditions))
    .orderBy(asc(employeesTable.fullName));

  const columns = [
    "Employee Number",
    "Full Name",
    "Email",
    "Status",
    "Employment Type",
    "Hire Date",
    "Org Unit",
    "Job Title",
    "Job Grade",
    "Manager #",
  ];

  const tableRows = rows.map((r) => [
    String(r.employeeNumber ?? ""),
    String(r.fullName ?? ""),
    String(r.email ?? ""),
    String(r.status ?? ""),
    String(r.employmentType ?? ""),
    String(r.hireDate ?? ""),
    String(r.orgUnitName ?? ""),
    String(r.jobTitleName ?? ""),
    String(r.jobGradeName ?? ""),
    String(r.managerNumber ?? ""),
  ]);

  return {
    title: "Employee Roster",
    columns,
    rows: tableRows,
    metadata: {
      reportKey: "hr.employees.roster",
      filters: JSON.stringify(params),
    },
  };
}

export async function fetchAttendancePeriodRows(
  workspaceId: number,
  params: ReportParams,
): Promise<ReportTableData> {
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
      sourceType: hrAttendanceTable.sourceType,
    })
    .from(hrAttendanceTable)
    .innerJoin(employeesTable, eq(hrAttendanceTable.employeeId, employeesTable.id))
    .leftJoin(hrShiftsTable, eq(hrAttendanceTable.shiftId, hrShiftsTable.id))
    .where(and(...conditions))
    .orderBy(asc(hrAttendanceTable.date), asc(employeesTable.fullName));

  const columns = [
    "Employee #",
    "Name",
    "Date",
    "Check In",
    "Check Out",
    "Status",
    "Shift",
    "OT (min)",
    "Source",
    "Geofence Flag",
  ];
  const tableRows = rows.map((r) => [
    String(r.employeeNumber ?? ""),
    String(r.employeeName ?? ""),
    String(r.date ?? ""),
    String(r.checkIn ?? ""),
    String(r.checkOut ?? ""),
    String(r.status ?? ""),
    String(r.shiftName ?? ""),
    String(r.overtimeMinutes ?? ""),
    String(r.sourceType ?? ""),
    r.sourceType === "mobile" || r.sourceType === "web" ? "web/mobile" : "",
  ]);

  return {
    title: "Attendance Period",
    columns,
    rows: tableRows,
    metadata: {
      reportKey: "hr.attendance.period",
      dateFrom: String(params.dateFrom ?? ""),
      dateTo: String(params.dateTo ?? ""),
    },
  };
}

export async function fetchLeaveBalancesRows(
  workspaceId: number,
  params: ReportParams,
): Promise<ReportTableData> {
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

  const columns = ["Employee #", "Name", "Leave Type", "Year", "Entitled", "Used", "Pending", "Policy"];
  const tableRows = rows.map((r) => [
    String(r.employeeNumber ?? ""),
    String(r.employeeName ?? ""),
    String(r.leaveType ?? ""),
    String(r.year ?? ""),
    String(r.entitled ?? ""),
    String(r.used ?? ""),
    String(r.pending ?? ""),
    String(r.policyName ?? ""),
  ]);

  return {
    title: "Leave Balances",
    columns,
    rows: tableRows,
    metadata: {
      reportKey: "hr.leave.balances",
      year: String(params.year ?? ""),
    },
  };
}

export async function fetchReportTableData(
  definitionKey: string,
  workspaceId: number,
  params: ReportParams,
): Promise<ReportTableData> {
  switch (definitionKey) {
    case "hr.employees.roster":
      return fetchEmployeesRosterRows(workspaceId, params);
    case "hr.attendance.period":
      return fetchAttendancePeriodRows(workspaceId, params);
    case "hr.leave.balances":
      return fetchLeaveBalancesRows(workspaceId, params);
    default:
      throw new Error(`Unknown report definition: ${definitionKey}`);
  }
}
