/**
 * P21-B — Compensation packages (supersede pattern, no full payroll calc)
 */
import { db } from "@workspace/db";
import {
  compensationPackagesTable,
  hrEmployeeCompensationsTable,
  hrEmployeeCompensationItemsTable,
  hrSalaryComponentsTable,
} from "@workspace/db";
import { and, desc, eq, lte, or, isNull, gte } from "drizzle-orm";
import { Money } from "./money";
import { logPayrollAccess } from "./payroll-audit";

export type PackageSnapshot = {
  source: "canonical" | "legacy";
  packageId: number;
  employeeId: number;
  baseAmount: string;
  currencyCode: string;
  structureCode: string | null;
  components: Array<{
    code: string;
    name: string;
    componentType: string;
    amount: string;
  }>;
};

export class CompensationPackageService {
  async resolveActivePackage(
    workspaceId: number,
    employeeId: number,
    asOfDate: string,
  ) {
    const [canonical] = await db
      .select()
      .from(compensationPackagesTable)
      .where(
        and(
          eq(compensationPackagesTable.workspaceId, workspaceId),
          eq(compensationPackagesTable.employeeId, employeeId),
          eq(compensationPackagesTable.status, "active"),
          lte(compensationPackagesTable.effectiveFrom, asOfDate),
          or(
            isNull(compensationPackagesTable.effectiveTo),
            gte(compensationPackagesTable.effectiveTo, asOfDate),
          ),
        ),
      )
      .orderBy(desc(compensationPackagesTable.effectiveFrom))
      .limit(1);

    if (canonical) return { source: "canonical" as const, package: canonical };

    const [legacy] = await db
      .select()
      .from(hrEmployeeCompensationsTable)
      .where(
        and(
          eq(hrEmployeeCompensationsTable.workspaceId, workspaceId),
          eq(hrEmployeeCompensationsTable.employeeId, employeeId),
          eq(hrEmployeeCompensationsTable.status, "active"),
          lte(hrEmployeeCompensationsTable.effectiveDate, asOfDate),
        ),
      )
      .orderBy(desc(hrEmployeeCompensationsTable.effectiveDate))
      .limit(1);

    if (!legacy) return null;

    return { source: "legacy" as const, package: legacy };
  }

  async getPackageSnapshot(
    workspaceId: number,
    employeeId: number,
    asOfDate: string,
  ): Promise<PackageSnapshot | null> {
    const resolved = await this.resolveActivePackage(workspaceId, employeeId, asOfDate);
    if (!resolved) return null;

    if (resolved.source === "canonical") {
      const pkg = resolved.package as typeof compensationPackagesTable.$inferSelect;
      let components: PackageSnapshot["components"] = [];
      try {
        const parsed = JSON.parse(pkg.packageJson || "{}") as {
          components?: PackageSnapshot["components"];
        };
        components = parsed.components ?? [];
      } catch {
        components = [];
      }
      return {
        source: "canonical",
        packageId: pkg.id,
        employeeId,
        baseAmount: pkg.baseAmount,
        currencyCode: pkg.currencyCode,
        structureCode: pkg.structureCode,
        components,
      };
    }

    const leg = resolved.package as typeof hrEmployeeCompensationsTable.$inferSelect;
    const items = await db
      .select({
        code: hrSalaryComponentsTable.code,
        name: hrSalaryComponentsTable.name,
        componentType: hrSalaryComponentsTable.componentType,
        amount: hrEmployeeCompensationItemsTable.amount,
      })
      .from(hrEmployeeCompensationItemsTable)
      .innerJoin(
        hrSalaryComponentsTable,
        eq(hrEmployeeCompensationItemsTable.componentId, hrSalaryComponentsTable.id),
      )
      .where(eq(hrEmployeeCompensationItemsTable.compensationId, leg.id));

    return {
      source: "legacy",
      packageId: leg.id,
      employeeId,
      baseAmount: leg.basicSalary,
      currencyCode: leg.currencyCode,
      structureCode: null,
      components: items.map((i) => ({
        code: i.code,
        name: i.name,
        componentType: i.componentType,
        amount: i.amount ?? "0",
      })),
    };
  }

  async supersedePackage(input: {
    workspaceId: number;
    employeeId: number;
    baseAmount: string;
    currencyCode?: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    structureCode?: string | null;
    packageJson?: Record<string, unknown>;
    userId?: number;
    legacyCompensationId?: number;
  }) {
    const base = Money.fromString(input.baseAmount, input.currencyCode ?? "SAR");

    const active = await db
      .select({ id: compensationPackagesTable.id })
      .from(compensationPackagesTable)
      .where(
        and(
          eq(compensationPackagesTable.workspaceId, input.workspaceId),
          eq(compensationPackagesTable.employeeId, input.employeeId),
          eq(compensationPackagesTable.status, "active"),
        ),
      );

    for (const row of active) {
      await db
        .update(compensationPackagesTable)
        .set({ status: "superseded", effectiveTo: input.effectiveFrom })
        .where(eq(compensationPackagesTable.id, row.id));
    }

    const [inserted] = await db
      .insert(compensationPackagesTable)
      .values({
        workspaceId: input.workspaceId,
        employeeId: input.employeeId,
        baseAmount: base.toStorageString(),
        currencyCode: input.currencyCode ?? "SAR",
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        structureCode: input.structureCode ?? null,
        packageJson: JSON.stringify(input.packageJson ?? {}),
        status: "active",
        legacyCompensationId: input.legacyCompensationId ?? null,
        createdByUserId: input.userId ?? null,
      })
      .returning();

    logPayrollAccess({
      workspaceId: input.workspaceId,
      userId: input.userId,
      action: "package_supersede",
      resourceType: "compensation_package",
      resourceId: inserted!.id,
    });

    return inserted!;
  }

  async syncFromLegacyCompensation(workspaceId: number, employeeId: number, userId?: number) {
    const [leg] = await db
      .select()
      .from(hrEmployeeCompensationsTable)
      .where(
        and(
          eq(hrEmployeeCompensationsTable.workspaceId, workspaceId),
          eq(hrEmployeeCompensationsTable.employeeId, employeeId),
          eq(hrEmployeeCompensationsTable.status, "active"),
        ),
      )
      .orderBy(desc(hrEmployeeCompensationsTable.effectiveDate))
      .limit(1);

    if (!leg) return null;

    const snapshot = await this.getPackageSnapshot(
      workspaceId,
      employeeId,
      leg.effectiveDate,
    );

    return this.supersedePackage({
      workspaceId,
      employeeId,
      baseAmount: leg.basicSalary,
      currencyCode: leg.currencyCode,
      effectiveFrom: leg.effectiveDate,
      structureCode: null,
      packageJson: { components: snapshot?.components ?? [], legacyId: leg.id },
      userId,
      legacyCompensationId: leg.id,
    });
  }
}

export const compensationPackageService = new CompensationPackageService();
