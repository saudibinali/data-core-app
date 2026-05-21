/**
 * P21-B — Payroll period lock enforcement
 */
import { db } from "@workspace/db";
import {
  payrollLocksTable,
  payrollPeriodsTable,
} from "@workspace/db";
import { and, eq, lte, gte, inArray } from "drizzle-orm";
import { logPayrollAccess } from "./payroll-audit";

export type LockAssertOptions = {
  breakGlass?: boolean;
  userId?: number;
  reason?: string;
  action?: string;
};

export class PayrollLockService {
  /** True if any attendance/full lock covers this calendar date (YYYY-MM-DD). */
  async isDateLocked(workspaceId: number, localDate: string): Promise<boolean> {
    const locks = await this.getActiveLocks(workspaceId);
    return locks.some((l) => localDate >= l.periodStart && localDate <= l.periodEnd);
  }

  async getActiveLocks(workspaceId: number) {
    const rows = await db
      .select({
        lockType: payrollLocksTable.lockType,
        periodStart: payrollPeriodsTable.periodStart,
        periodEnd: payrollPeriodsTable.periodEnd,
        periodId: payrollPeriodsTable.id,
      })
      .from(payrollLocksTable)
      .innerJoin(payrollPeriodsTable, eq(payrollLocksTable.periodId, payrollPeriodsTable.id))
      .where(
        and(
          eq(payrollLocksTable.workspaceId, workspaceId),
          inArray(payrollLocksTable.lockType, ["attendance", "full"]),
        ),
      );
    return rows;
  }

  async assertDateNotLocked(
    workspaceId: number,
    localDate: string,
    options?: LockAssertOptions,
  ): Promise<void> {
    const locked = await this.isDateLocked(workspaceId, localDate);
    if (!locked) return;

    if (options?.breakGlass && options.reason) {
      logPayrollAccess({
        workspaceId,
        userId: options.userId,
        action: "break_glass_attendance",
        resourceType: "payroll_lock",
        metadata: { localDate, reason: options.reason, attemptedAction: options.action },
      });
      return;
    }

    throw new Error(
      `Attendance period is locked for date ${localDate}. Retro edits require break-glass authorization.`,
    );
  }

  async assertOccurredAtNotLocked(
    workspaceId: number,
    occurredAt: Date,
    localDate: string,
    options?: LockAssertOptions,
  ): Promise<void> {
    await this.assertDateNotLocked(workspaceId, localDate, options);
  }

  async createLock(input: {
    workspaceId: number;
    periodId: number;
    lockType: "attendance" | "payroll" | "full";
    userId?: number;
    runId?: number;
    breakGlassReason?: string;
  }) {
    const [existing] = await db
      .select({ id: payrollLocksTable.id })
      .from(payrollLocksTable)
      .where(
        and(
          eq(payrollLocksTable.periodId, input.periodId),
          eq(payrollLocksTable.lockType, input.lockType),
        ),
      )
      .limit(1);

    if (existing) {
      return { id: existing.id, duplicate: true };
    }

    const [row] = await db
      .insert(payrollLocksTable)
      .values({
        workspaceId: input.workspaceId,
        periodId: input.periodId,
        lockType: input.lockType,
        lockedByUserId: input.userId ?? null,
        runId: input.runId ?? null,
        breakGlassReason: input.breakGlassReason ?? null,
      })
      .returning();

    logPayrollAccess({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: `lock_${input.lockType}`,
      resourceType: "payroll_lock",
      resourceId: row!.id,
    });

    return { id: row!.id, duplicate: false };
  }

  async removeLock(
    workspaceId: number,
    periodId: number,
    lockType: string,
    userId?: number,
    breakGlassReason?: string,
  ) {
    if (!breakGlassReason) {
      throw new Error("Break-glass reason required to remove lock");
    }
    await db
      .delete(payrollLocksTable)
      .where(
        and(
          eq(payrollLocksTable.workspaceId, workspaceId),
          eq(payrollLocksTable.periodId, periodId),
          eq(payrollLocksTable.lockType, lockType),
        ),
      );
    logPayrollAccess({
      workspaceId,
      userId,
      action: "unlock_break_glass",
      resourceType: "payroll_period",
      resourceId: periodId,
      metadata: { lockType, reason: breakGlassReason },
    });
  }

  async findPeriodForDate(workspaceId: number, localDate: string) {
    const [row] = await db
      .select()
      .from(payrollPeriodsTable)
      .where(
        and(
          eq(payrollPeriodsTable.workspaceId, workspaceId),
          lte(payrollPeriodsTable.periodStart, localDate),
          gte(payrollPeriodsTable.periodEnd, localDate),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

export const payrollLockService = new PayrollLockService();
