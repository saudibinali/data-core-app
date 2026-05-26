/**
 * F6.2 — Admin list of canonical attendance_daily_summaries (HR attendance UI).
 */
import { db } from "@workspace/db";
import {
  attendanceDailySummariesTable,
  employeesTable,
  hrShiftsTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

export async function listAdminAttendanceSummaries(
  workspaceId: number,
  filters?: {
    employeeId?: number;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
  },
) {
  const conditions = [eq(attendanceDailySummariesTable.workspaceId, workspaceId)];
  if (filters?.employeeId) {
    conditions.push(eq(attendanceDailySummariesTable.employeeId, filters.employeeId));
  }
  if (filters?.dateFrom) {
    conditions.push(gte(attendanceDailySummariesTable.date, filters.dateFrom));
  }
  if (filters?.dateTo) {
    conditions.push(lte(attendanceDailySummariesTable.date, filters.dateTo));
  }
  if (filters?.status) {
    conditions.push(eq(attendanceDailySummariesTable.status, filters.status));
  }

  return db
    .select({
      id: attendanceDailySummariesTable.id,
      employeeId: attendanceDailySummariesTable.employeeId,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      date: attendanceDailySummariesTable.date,
      checkIn: attendanceDailySummariesTable.firstIn,
      checkOut: attendanceDailySummariesTable.lastOut,
      status: attendanceDailySummariesTable.status,
      sourceType: attendanceDailySummariesTable.dominantSourceCode,
      lateMinutes: attendanceDailySummariesTable.lateMinutes,
      earlyLeaveMinutes: attendanceDailySummariesTable.earlyLeaveMinutes,
      overtimeMinutes: attendanceDailySummariesTable.overtimeMinutes,
      workedMinutes: attendanceDailySummariesTable.workedMinutes,
      shiftName: hrShiftsTable.name,
      legacyAttendanceId: attendanceDailySummariesTable.legacyAttendanceId,
      canonical: sql<boolean>`true`,
    })
    .from(attendanceDailySummariesTable)
    .innerJoin(employeesTable, eq(attendanceDailySummariesTable.employeeId, employeesTable.id))
    .leftJoin(hrShiftsTable, eq(attendanceDailySummariesTable.shiftId, hrShiftsTable.id))
    .where(and(...conditions))
    .orderBy(desc(attendanceDailySummariesTable.date), asc(employeesTable.fullName));
}
