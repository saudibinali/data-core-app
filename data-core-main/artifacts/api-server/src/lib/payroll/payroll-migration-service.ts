/**
 * P-PAY-MIG — Legacy hr_payroll_runs → canonical payroll_runs (header + run employees).
 * No recalculation; no GL posting. Uses legacyPayrollRunId + idempotency payroll-mig:{id}.
 */
import { db } from "@workspace/db";
import {
  hrPayrollRunsTable,
  hrPayslipsTable,
  payrollPeriodsTable,
  payrollRunEmployeesTable,
  payrollRunsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { payrollPeriodService } from "./payroll-period-service";
import { legacyPayrollBridge } from "./legacy-payroll-bridge";

export type PayrollMigrationReport = {
  legacyTotal: number;
  canonicalTotal: number;
  alreadyMigrated: number;
  pendingMigration: number;
};

export type PayrollMigrationRunResult = {
  dryRun: boolean;
  processed: number;
  migrated: number;
  skipped: number;
  payslipsLinked: number;
  errors: Array<{ legacyRunId: number; reason: string }>;
  samples: Array<{ legacyRunId: number; canonicalRunId?: number; periodLabel?: string }>;
};

function periodBounds(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    periodStart: `${year}-${mm}-01`,
    periodEnd: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
    periodLabel: `${year}-${mm}`,
  };
}

function mapLegacyRunStatus(status: string): string {
  switch (status) {
    case "approved":
      return "approved";
    case "paid":
      return "locked";
    case "processing":
      return "calculating";
    case "cancelled":
      return "draft";
    default:
      return "draft";
  }
}

function mapRunType(status: string): string {
  if (status === "approved" || status === "paid") return "final";
  return "preview";
}

function migrationIdempotencyKey(legacyRunId: number): string {
  return `payroll-mig-${legacyRunId}`;
}

async function resolvePeriod(
  workspaceId: number,
  year: number,
  month: number,
  userId?: number,
) {
  const bounds = periodBounds(year, month);
  const [existing] = await db
    .select()
    .from(payrollPeriodsTable)
    .where(
      and(
        eq(payrollPeriodsTable.workspaceId, workspaceId),
        eq(payrollPeriodsTable.periodLabel, bounds.periodLabel),
      ),
    )
    .limit(1);
  if (existing) return existing;

  return payrollPeriodService.createPeriod({
    workspaceId,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    periodLabel: bounds.periodLabel,
    userId,
  });
}

export async function getPayrollMigrationReport(workspaceId: number): Promise<PayrollMigrationReport> {
  const [legacyRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hrPayrollRunsTable)
    .where(eq(hrPayrollRunsTable.workspaceId, workspaceId));

  const [canonicalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payrollRunsTable)
    .where(eq(payrollRunsTable.workspaceId, workspaceId));

  const [migratedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payrollRunsTable)
    .where(
      and(
        eq(payrollRunsTable.workspaceId, workspaceId),
        sql`${payrollRunsTable.legacyPayrollRunId} IS NOT NULL`,
      ),
    );

  const legacyTotal = legacyRow?.count ?? 0;
  const alreadyMigrated = migratedRow?.count ?? 0;

  return {
    legacyTotal,
    canonicalTotal: canonicalRow?.count ?? 0,
    alreadyMigrated,
    pendingMigration: Math.max(0, legacyTotal - alreadyMigrated),
  };
}

export async function runPayrollMigration(
  workspaceId: number,
  options: { dryRun?: boolean; limit?: number; userId?: number } = {},
): Promise<PayrollMigrationRunResult> {
  const dryRun = options.dryRun !== false;
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);

  const legacyRows = await db
    .select()
    .from(hrPayrollRunsTable)
    .where(eq(hrPayrollRunsTable.workspaceId, workspaceId))
    .orderBy(hrPayrollRunsTable.periodYear, hrPayrollRunsTable.periodMonth)
    .limit(limit * 2);

  const result: PayrollMigrationRunResult = {
    dryRun,
    processed: 0,
    migrated: 0,
    skipped: 0,
    payslipsLinked: 0,
    errors: [],
    samples: [],
  };

  for (const legacy of legacyRows) {
    if (result.processed >= limit) break;

    const [already] = await db
      .select({ id: payrollRunsTable.id })
      .from(payrollRunsTable)
      .where(
        and(
          eq(payrollRunsTable.workspaceId, workspaceId),
          eq(payrollRunsTable.legacyPayrollRunId, legacy.id),
        ),
      )
      .limit(1);

    if (already) {
      result.skipped++;
      continue;
    }

    const [byKey] = await db
      .select({ id: payrollRunsTable.id })
      .from(payrollRunsTable)
      .where(
        and(
          eq(payrollRunsTable.workspaceId, workspaceId),
          eq(payrollRunsTable.idempotencyKey, migrationIdempotencyKey(legacy.id)),
        ),
      )
      .limit(1);

    if (byKey) {
      if (!dryRun && !byKey.id) {
        await db
          .update(payrollRunsTable)
          .set({ legacyPayrollRunId: legacy.id })
          .where(eq(payrollRunsTable.id, byKey.id));
      }
      result.skipped++;
      continue;
    }

    result.processed++;

    const periodLabel = periodBounds(legacy.periodYear, legacy.periodMonth).periodLabel;
    const canonicalStatus = mapLegacyRunStatus(legacy.status);
    const totals = legacyPayrollBridge.mapLegacyTotalsToCanonical(
      legacy.totalBasic,
      legacy.totalAllowances,
      legacy.totalDeductions,
      legacy.totalBonus,
      legacy.totalOvertime,
    );

    if (dryRun) {
      result.migrated++;
      if (result.samples.length < 10) {
        result.samples.push({ legacyRunId: legacy.id, periodLabel });
      }
      continue;
    }

    try {
      const period = await resolvePeriod(
        workspaceId,
        legacy.periodYear,
        legacy.periodMonth,
        options.userId,
      );

      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(payrollRunsTable)
          .values({
            workspaceId,
            periodId: period.id,
            runNumber: 1,
            runType: mapRunType(legacy.status),
            status: canonicalStatus,
            idempotencyKey: migrationIdempotencyKey(legacy.id),
            currencyCode: legacy.currencyCode,
            totalGross: legacy.totalGross !== "0" ? legacy.totalGross : totals.totalGross,
            totalNet: legacy.totalNet !== "0" ? legacy.totalNet : totals.totalNet,
            totalDeductions:
              legacy.totalDeductions !== "0" ? legacy.totalDeductions : totals.totalDeductions,
            employeeCount: legacy.employeeCount,
            legacyPayrollRunId: legacy.id,
            notes: legacy.notes ?? `P-PAY-MIG from legacy #${legacy.id}`,
            processedAt: legacy.processedAt,
            approvedAt: legacy.approvedAt,
            approvedByUserId: legacy.approvedBy,
            lockedAt: canonicalStatus === "locked" ? legacy.paidAt ?? legacy.approvedAt : null,
            createdByUserId: legacy.createdBy ?? options.userId ?? null,
            createdAt: legacy.createdAt,
            updatedAt: legacy.updatedAt,
          })
          .returning();

        if (!inserted) throw new Error("insert_failed");

        const payslips = await tx
          .select()
          .from(hrPayslipsTable)
          .where(eq(hrPayslipsTable.payrollRunId, legacy.id));

        for (const ps of payslips) {
          await tx
            .insert(payrollRunEmployeesTable)
            .values({
              workspaceId,
              runId: inserted.id,
              employeeId: ps.employeeId,
              status: "included",
              grossAmount: ps.grossSalary,
              netAmount: ps.netSalary,
              paidDays: ps.actualDays ?? ps.workingDays ?? 0,
              unpaidAbsenceDays: ps.absentDays ?? 0,
              inputSnapshotJson: JSON.stringify({ source: "hr_payslip", legacyPayslipId: ps.id }),
            })
            .onConflictDoNothing();
          result.payslipsLinked++;
        }

        if (result.samples.length < 10) {
          result.samples.push({
            legacyRunId: legacy.id,
            canonicalRunId: inserted.id,
            periodLabel,
          });
        }
      });
      result.migrated++;
    } catch (err: unknown) {
      result.skipped++;
      result.errors.push({
        legacyRunId: legacy.id,
        reason: err instanceof Error ? err.message : "migration_failed",
      });
    }
  }

  return result;
}
