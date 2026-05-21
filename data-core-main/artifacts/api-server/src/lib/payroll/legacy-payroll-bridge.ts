/**
 * P21-B — Coexistence: canonical payroll_runs ↔ legacy hr_payroll_runs
 */
import { db } from "@workspace/db";
import {
  payrollRunsTable,
  payrollPeriodsTable,
  hrPayrollRunsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Money } from "./money";

export class LegacyPayrollBridge {
  /** Create or link legacy run row for compatibility (no process/calculation). */
  async linkLegacyRunPlaceholder(canonicalRunId: number): Promise<number | null> {
    const [run] = await db
      .select({
        run: payrollRunsTable,
        period: payrollPeriodsTable,
      })
      .from(payrollRunsTable)
      .innerJoin(payrollPeriodsTable, eq(payrollRunsTable.periodId, payrollPeriodsTable.id))
      .where(eq(payrollRunsTable.id, canonicalRunId))
      .limit(1);

    if (!run) return null;
    if (run.run.legacyPayrollRunId) return run.run.legacyPayrollRunId;

    const start = run.period.periodStart;
    const year = Number(start.slice(0, 4));
    const month = Number(start.slice(5, 7));

    const [existingLegacy] = await db
      .select({ id: hrPayrollRunsTable.id })
      .from(hrPayrollRunsTable)
      .where(
        and(
          eq(hrPayrollRunsTable.workspaceId, run.run.workspaceId),
          eq(hrPayrollRunsTable.periodYear, year),
          eq(hrPayrollRunsTable.periodMonth, month),
        ),
      )
      .limit(1);

    let legacyId = existingLegacy?.id;
    if (!legacyId) {
      const code = `CAN-${canonicalRunId}`;
      const [legacy] = await db
        .insert(hrPayrollRunsTable)
        .values({
          workspaceId: run.run.workspaceId,
          code,
          name: run.period.periodLabel,
          periodYear: year,
          periodMonth: month,
          currencyCode: run.run.currencyCode,
          status: "draft",
          notes: `Canonical preview run #${canonicalRunId}`,
          createdBy: run.run.createdByUserId,
        })
        .returning({ id: hrPayrollRunsTable.id });
      legacyId = legacy?.id;
    }

    if (legacyId) {
      await db
        .update(payrollRunsTable)
        .set({ legacyPayrollRunId: legacyId })
        .where(eq(payrollRunsTable.id, canonicalRunId));
    }

    return legacyId ?? null;
  }

  mapLegacyTotalsToCanonical(
    basic: string,
    allowances: string,
    deductions: string,
    bonus: string,
    overtime: string,
  ) {
    const gross = Money.fromDb(basic)
      .add(Money.fromDb(allowances))
      .add(Money.fromDb(bonus))
      .add(Money.fromDb(overtime));
    const net = gross.sub(Money.fromDb(deductions));
    return {
      totalGross: gross.toStorageString(),
      totalNet: net.toStorageString(),
      totalDeductions: Money.fromDb(deductions).toStorageString(),
    };
  }
}

export const legacyPayrollBridge = new LegacyPayrollBridge();
