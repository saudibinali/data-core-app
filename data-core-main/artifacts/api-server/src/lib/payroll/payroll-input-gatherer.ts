/**
 * P21-C — Payroll calculation inputs (read-only adapters)
 */
import { db } from "@workspace/db";
import {
  compensationAdjustmentsTable,
  hrOvertimeRecordsTable,
  leaveRequestsTable,
} from "@workspace/db";
import { and, eq, gte, lte, isNull } from "drizzle-orm";
import { payrollAttendanceAdapter, type EmployeePeriodAttendance } from "./payroll-attendance-adapter";
import { compensationPackageService, type PackageSnapshot } from "./compensation-package-service";

export type ApprovedOvertimeRow = {
  id: number;
  date: string;
  durationMinutes: number;
  calculatedAmount: string;
};

export type ApprovedLeaveRow = {
  id: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  businessDaysCount: number;
};

export type EmployeeCalcInputs = {
  employeeId: number;
  package: PackageSnapshot | null;
  attendance: EmployeePeriodAttendance;
  overtime: ApprovedOvertimeRow[];
  leave: ApprovedLeaveRow[];
  adjustments: Array<{
    id: number;
    adjustmentType: string;
    amount: string;
    effectiveDate: string;
    reason: string | null;
  }>;
};

export class PayrollInputGatherer {
  async gatherEmployee(
    workspaceId: number,
    employeeId: number,
    periodStart: string,
    periodEnd: string,
  ): Promise<EmployeeCalcInputs> {
    const [packageSnapshot, attendance, overtime, leave, adjustments] = await Promise.all([
      compensationPackageService.getPackageSnapshot(workspaceId, employeeId, periodEnd),
      payrollAttendanceAdapter.aggregateEmployeePeriod(workspaceId, employeeId, periodStart, periodEnd),
      this.loadApprovedOvertime(workspaceId, employeeId, periodStart, periodEnd),
      this.loadApprovedLeave(workspaceId, employeeId, periodStart, periodEnd),
      this.loadAdjustments(workspaceId, employeeId, periodStart, periodEnd),
    ]);

    return {
      employeeId,
      package: packageSnapshot,
      attendance,
      overtime,
      leave,
      adjustments,
    };
  }

  private async loadApprovedOvertime(
    workspaceId: number,
    employeeId: number,
    periodStart: string,
    periodEnd: string,
  ): Promise<ApprovedOvertimeRow[]> {
    return db
      .select({
        id: hrOvertimeRecordsTable.id,
        date: hrOvertimeRecordsTable.date,
        durationMinutes: hrOvertimeRecordsTable.durationMinutes,
        calculatedAmount: hrOvertimeRecordsTable.calculatedAmount,
      })
      .from(hrOvertimeRecordsTable)
      .where(
        and(
          eq(hrOvertimeRecordsTable.workspaceId, workspaceId),
          eq(hrOvertimeRecordsTable.employeeId, employeeId),
          eq(hrOvertimeRecordsTable.status, "approved"),
          gte(hrOvertimeRecordsTable.date, periodStart),
          lte(hrOvertimeRecordsTable.date, periodEnd),
          isNull(hrOvertimeRecordsTable.payrollRunId),
        ),
      );
  }

  private async loadApprovedLeave(
    workspaceId: number,
    employeeId: number,
    periodStart: string,
    periodEnd: string,
  ): Promise<ApprovedLeaveRow[]> {
    return db
      .select({
        id: leaveRequestsTable.id,
        leaveType: leaveRequestsTable.leaveType,
        startDate: leaveRequestsTable.startDate,
        endDate: leaveRequestsTable.endDate,
        businessDaysCount: leaveRequestsTable.businessDaysCount,
      })
      .from(leaveRequestsTable)
      .where(
        and(
          eq(leaveRequestsTable.workspaceId, workspaceId),
          eq(leaveRequestsTable.employeeId, employeeId),
          eq(leaveRequestsTable.status, "approved"),
          lte(leaveRequestsTable.startDate, periodEnd),
          gte(leaveRequestsTable.endDate, periodStart),
        ),
      );
  }

  private async loadAdjustments(
    workspaceId: number,
    employeeId: number,
    periodStart: string,
    periodEnd: string,
  ) {
    return db
      .select({
        id: compensationAdjustmentsTable.id,
        adjustmentType: compensationAdjustmentsTable.adjustmentType,
        amount: compensationAdjustmentsTable.amount,
        effectiveDate: compensationAdjustmentsTable.effectiveDate,
        reason: compensationAdjustmentsTable.reason,
      })
      .from(compensationAdjustmentsTable)
      .where(
        and(
          eq(compensationAdjustmentsTable.workspaceId, workspaceId),
          eq(compensationAdjustmentsTable.employeeId, employeeId),
          eq(compensationAdjustmentsTable.status, "approved"),
          gte(compensationAdjustmentsTable.effectiveDate, periodStart),
          lte(compensationAdjustmentsTable.effectiveDate, periodEnd),
        ),
      );
  }
}

export const payrollInputGatherer = new PayrollInputGatherer();
