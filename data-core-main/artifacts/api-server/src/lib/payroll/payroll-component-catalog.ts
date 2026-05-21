/**
 * P21-C — Workspace payroll component catalog (canonical codes)
 */
import { db } from "@workspace/db";
import { payrollComponentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const DEFAULT_COMPONENTS = [
  { code: "BASIC", name: "Basic Salary", nameAr: "الراتب الأساسي", componentClass: "earning", subType: "base" },
  { code: "ALLOWANCE", name: "Allowance", nameAr: "بدل", componentClass: "earning", subType: "allowance" },
  { code: "OVERTIME", name: "Overtime", nameAr: "عمل إضافي", componentClass: "earning", subType: "overtime" },
  { code: "UNPAID_ABS", name: "Unpaid Absence", nameAr: "غياب غير مدفوع", componentClass: "deduction", subType: "absence" },
  { code: "ADJ_EARN", name: "Adjustment (Earning)", nameAr: "تعديل استحقاق", componentClass: "earning", subType: "adjustment" },
  { code: "ADJ_DED", name: "Adjustment (Deduction)", nameAr: "تعديل استقطاع", componentClass: "deduction", subType: "adjustment" },
  { code: "CORR_DELTA", name: "Correction Delta", nameAr: "فرق تصحيح", componentClass: "earning", subType: "correction" },
] as const;

export type PayrollComponentCode = (typeof DEFAULT_COMPONENTS)[number]["code"];

export class PayrollComponentCatalog {
  async ensureDefaults(workspaceId: number): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    for (const def of DEFAULT_COMPONENTS) {
      const [existing] = await db
        .select({ id: payrollComponentsTable.id })
        .from(payrollComponentsTable)
        .where(
          and(
            eq(payrollComponentsTable.workspaceId, workspaceId),
            eq(payrollComponentsTable.code, def.code),
          ),
        )
        .limit(1);

      if (existing) {
        map.set(def.code, existing.id);
        continue;
      }

      const [inserted] = await db
        .insert(payrollComponentsTable)
        .values({
          workspaceId,
          code: def.code,
          name: def.name,
          nameAr: def.nameAr,
          componentClass: def.componentClass,
          subType: def.subType,
        })
        .returning({ id: payrollComponentsTable.id });
      map.set(def.code, inserted!.id);
    }
    return map;
  }

  async resolveMap(workspaceId: number): Promise<Map<string, number>> {
    const rows = await db
      .select({ id: payrollComponentsTable.id, code: payrollComponentsTable.code })
      .from(payrollComponentsTable)
      .where(eq(payrollComponentsTable.workspaceId, workspaceId));
    if (rows.length < DEFAULT_COMPONENTS.length) {
      return this.ensureDefaults(workspaceId);
    }
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  async listComponents(workspaceId: number) {
    await this.ensureDefaults(workspaceId);
    return db
      .select()
      .from(payrollComponentsTable)
      .where(eq(payrollComponentsTable.workspaceId, workspaceId))
      .orderBy(payrollComponentsTable.code);
  }

  async updateGlMapping(
    workspaceId: number,
    componentId: number,
    input: {
      debitAccountCode?: string | null;
      creditAccountCode?: string | null;
      costCenterCode?: string | null;
      exportCode?: string | null;
      glAccountCode?: string | null;
    },
    userId?: number,
  ) {
    const [row] = await db
      .update(payrollComponentsTable)
      .set({
        debitAccountCode: input.debitAccountCode,
        creditAccountCode: input.creditAccountCode,
        costCenterCode: input.costCenterCode,
        exportCode: input.exportCode,
        glAccountCode: input.glAccountCode,
      })
      .where(
        and(
          eq(payrollComponentsTable.id, componentId),
          eq(payrollComponentsTable.workspaceId, workspaceId),
        ),
      )
      .returning();
    if (!row) throw new Error("Component not found");
    const { logPayrollAccess } = await import("./payroll-audit");
    logPayrollAccess({
      workspaceId,
      userId,
      action: "component_gl_update",
      resourceType: "payroll_component",
      resourceId: componentId,
    });
    return row;
  }
}

export const payrollComponentCatalog = new PayrollComponentCatalog();
