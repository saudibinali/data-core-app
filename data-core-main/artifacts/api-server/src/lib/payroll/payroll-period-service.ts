/**
 * P21-B — Payroll periods & lock orchestration
 */
import { db } from "@workspace/db";
import {
  payrollCyclesTable,
  payrollPeriodsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { payrollLockService } from "./payroll-lock-service";
import { logPayrollAccess } from "./payroll-audit";

export class PayrollPeriodService {
  async ensureDefaultCycle(workspaceId: number, userId?: number) {
    const [existing] = await db
      .select()
      .from(payrollCyclesTable)
      .where(
        and(eq(payrollCyclesTable.workspaceId, workspaceId), eq(payrollCyclesTable.code, "monthly")),
      )
      .limit(1);
    if (existing) return existing;

    const [row] = await db
      .insert(payrollCyclesTable)
      .values({
        workspaceId,
        code: "monthly",
        name: "Monthly Payroll",
        frequency: "monthly",
        createdByUserId: userId ?? null,
      })
      .returning();
    return row!;
  }

  async createPeriod(input: {
    workspaceId: number;
    periodStart: string;
    periodEnd: string;
    periodLabel: string;
    cutoffAt?: Date;
    userId?: number;
  }) {
    const cycle = await this.ensureDefaultCycle(input.workspaceId, input.userId);

    const [row] = await db
      .insert(payrollPeriodsTable)
      .values({
        workspaceId: input.workspaceId,
        cycleId: cycle.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        periodLabel: input.periodLabel,
        status: "open",
        cutoffAt: input.cutoffAt ?? null,
      })
      .returning();

    logPayrollAccess({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "period_create",
      resourceType: "payroll_period",
      resourceId: row!.id,
    });

    return row!;
  }

  async listPeriods(workspaceId: number) {
    return db
      .select()
      .from(payrollPeriodsTable)
      .where(eq(payrollPeriodsTable.workspaceId, workspaceId))
      .orderBy(desc(payrollPeriodsTable.periodStart));
  }

  async getPeriod(workspaceId: number, periodId: number) {
    const [row] = await db
      .select()
      .from(payrollPeriodsTable)
      .where(
        and(
          eq(payrollPeriodsTable.id, periodId),
          eq(payrollPeriodsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Payroll period not found");
    return row;
  }

  async closePeriod(workspaceId: number, periodId: number, userId?: number) {
    const period = await this.getPeriod(workspaceId, periodId);
    if (period.status === "locked") {
      throw new Error("Period already locked");
    }

    const [row] = await db
      .update(payrollPeriodsTable)
      .set({
        status: "closed",
        closedAt: new Date(),
        closedByUserId: userId ?? null,
      })
      .where(eq(payrollPeriodsTable.id, periodId))
      .returning();

    logPayrollAccess({
      workspaceId,
      userId,
      action: "period_close",
      resourceType: "payroll_period",
      resourceId: periodId,
    });

    return row!;
  }

  async lockAttendancePeriod(workspaceId: number, periodId: number, userId?: number) {
    await this.getPeriod(workspaceId, periodId);
    const lock = await payrollLockService.createLock({
      workspaceId,
      periodId,
      lockType: "attendance",
      userId,
    });

    await db
      .update(payrollPeriodsTable)
      .set({ status: "locked" })
      .where(eq(payrollPeriodsTable.id, periodId));

    return lock;
  }

  async lockPayrollPeriod(
    workspaceId: number,
    periodId: number,
    userId?: number,
    runId?: number,
  ) {
    await this.lockAttendancePeriod(workspaceId, periodId, userId);
    return payrollLockService.createLock({
      workspaceId,
      periodId,
      lockType: "payroll",
      userId,
      runId,
    });
  }

  async unlockPeriod(
    workspaceId: number,
    periodId: number,
    lockType: "attendance" | "payroll" | "full",
    userId?: number,
    reason?: string,
  ) {
    await payrollLockService.removeLock(workspaceId, periodId, lockType, userId, reason);
    const locks = await payrollLockService.getActiveLocks(workspaceId);
    const stillLocked = locks.some((l) => l.periodId === periodId);
    if (!stillLocked) {
      await db
        .update(payrollPeriodsTable)
        .set({ status: "closed" })
        .where(eq(payrollPeriodsTable.id, periodId));
    }
  }
}

export const payrollPeriodService = new PayrollPeriodService();
