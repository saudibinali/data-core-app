/**
 * P21-B — Payroll reads attendance_daily_summaries only (not hr_attendance)
 */
import { db } from "@workspace/db";
import { attendanceDailySummariesTable } from "@workspace/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";

const PAID_STATUSES = new Set(["present", "holiday", "on_leave", "remote", "half_day"]);
const UNPAID_STATUSES = new Set(["absent"]);

export type EmployeePeriodAttendance = {
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  scheduledDays: number;
  paidDays: number;
  unpaidAbsenceDays: number;
  halfDays: number;
  totalWorkedMinutes: number;
  totalLateMinutes: number;
  totalOvertimeMinutes: number;
  totalEarlyLeaveMinutes: number;
  holidayDays: number;
  daily: Array<{
    date: string;
    status: string;
    workedMinutes: number;
    lateMinutes: number;
    overtimeMinutes: number;
  }>;
};

export class PayrollAttendanceAdapter {
  async aggregateEmployeePeriod(
    workspaceId: number,
    employeeId: number,
    periodStart: string,
    periodEnd: string,
  ): Promise<EmployeePeriodAttendance> {
    const rows = await db
      .select()
      .from(attendanceDailySummariesTable)
      .where(
        and(
          eq(attendanceDailySummariesTable.workspaceId, workspaceId),
          eq(attendanceDailySummariesTable.employeeId, employeeId),
          gte(attendanceDailySummariesTable.date, periodStart),
          lte(attendanceDailySummariesTable.date, periodEnd),
        ),
      );

    let paidDays = 0;
    let unpaidAbsenceDays = 0;
    let halfDays = 0;
    let holidayDays = 0;
    let totalWorkedMinutes = 0;
    let totalLateMinutes = 0;
    let totalOvertimeMinutes = 0;
    let totalEarlyLeaveMinutes = 0;

    const daily = rows.map((r) => {
      const status = r.status ?? "present";
      if (status === "half_day") {
        halfDays += 1;
        paidDays += 0.5;
      } else if (PAID_STATUSES.has(status)) {
        if (status === "holiday") holidayDays += 1;
        paidDays += 1;
      } else if (UNPAID_STATUSES.has(status)) {
        unpaidAbsenceDays += 1;
      }
      totalWorkedMinutes += r.workedMinutes ?? 0;
      totalLateMinutes += r.lateMinutes ?? 0;
      totalOvertimeMinutes += r.overtimeMinutes ?? 0;
      totalEarlyLeaveMinutes += r.earlyLeaveMinutes ?? 0;

      return {
        date: String(r.date),
        status,
        workedMinutes: r.workedMinutes ?? 0,
        lateMinutes: r.lateMinutes ?? 0,
        overtimeMinutes: r.overtimeMinutes ?? 0,
      };
    });

    const scheduledDays = daily.length;

    return {
      employeeId,
      periodStart,
      periodEnd,
      scheduledDays,
      paidDays,
      unpaidAbsenceDays,
      halfDays,
      totalWorkedMinutes,
      totalLateMinutes,
      totalOvertimeMinutes,
      totalEarlyLeaveMinutes,
      holidayDays,
      daily,
    };
  }

  async aggregateWorkspacePeriod(
    workspaceId: number,
    periodStart: string,
    periodEnd: string,
    employeeIds: number[],
  ): Promise<EmployeePeriodAttendance[]> {
    const results: EmployeePeriodAttendance[] = [];
    for (const employeeId of employeeIds) {
      results.push(
        await this.aggregateEmployeePeriod(workspaceId, employeeId, periodStart, periodEnd),
      );
    }
    return results;
  }

  async workspaceSummary(workspaceId: number, periodStart: string, periodEnd: string) {
    const rows = await db
      .select({
        status: attendanceDailySummariesTable.status,
        count: sql<number>`count(*)::int`,
        overtimeMinutes: sql<number>`coalesce(sum(${attendanceDailySummariesTable.overtimeMinutes}), 0)::int`,
        lateMinutes: sql<number>`coalesce(sum(${attendanceDailySummariesTable.lateMinutes}), 0)::int`,
      })
      .from(attendanceDailySummariesTable)
      .where(
        and(
          eq(attendanceDailySummariesTable.workspaceId, workspaceId),
          gte(attendanceDailySummariesTable.date, periodStart),
          lte(attendanceDailySummariesTable.date, periodEnd),
        ),
      )
      .groupBy(attendanceDailySummariesTable.status);

    return rows;
  }
}

export const payrollAttendanceAdapter = new PayrollAttendanceAdapter();
