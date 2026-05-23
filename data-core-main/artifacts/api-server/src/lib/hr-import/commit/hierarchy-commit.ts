/**
 * Phase 4 — Manager & org hierarchy commit ordering and safety.
 */

import { employeesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { topologicalSortManagers } from "../execution/dependency-ordering";
import { getFieldFromRow } from "../validation/import-validation-foundation";

export type HierarchyCommitPlan = {
  orderedRowNumbers: number[];
  managerByRow: Map<number, string | null>;
  unresolvedManagers: Array<{ rowNumber: number; employeeNumber: string; reason: string }>;
  cycles: string[][];
  selfManagerRows: number[];
};

export function buildManagerCommitPlan(
  rows: Array<{ rowNumber: number; raw: Record<string, string> }>,
): HierarchyCommitPlan {
  const managerRows = rows.map((r) => ({
    employeeNumber: getFieldFromRow(r.raw, "employee_number", "رقم الموظف").trim(),
    managerEmployeeNumber: getFieldFromRow(r.raw, "direct_manager_num", "المدير المباشر").trim() || null,
    rowNumber: r.rowNumber,
  })).filter((r) => r.employeeNumber);

  const selfManagerRows = managerRows
    .filter((r) => r.managerEmployeeNumber && r.managerEmployeeNumber.toLowerCase() === r.employeeNumber.toLowerCase())
    .map((r) => r.rowNumber);

  const ordering = topologicalSortManagers(
    managerRows.map((r) => ({
      employeeNumber: r.employeeNumber,
      managerEmployeeNumber: r.managerEmployeeNumber,
    })),
  );

  const rowByNum = new Map(managerRows.map((r) => [r.employeeNumber.toLowerCase(), r.rowNumber]));
  const orderedRowNumbers = ordering.ordered
    .map((num) => rowByNum.get(num.toLowerCase()))
    .filter((n): n is number => n != null);

  const managerByRow = new Map<number, string | null>();
  for (const r of managerRows) {
    managerByRow.set(r.rowNumber, r.managerEmployeeNumber);
  }

  const unresolvedManagers = ordering.unresolved.map((u) => {
    const rowNum = rowByNum.get(u.id.toLowerCase()) ?? 0;
    return { rowNumber: rowNum, employeeNumber: u.id, reason: u.reason };
  });

  return {
    orderedRowNumbers,
    managerByRow,
    unresolvedManagers,
    cycles: ordering.cycles,
    selfManagerRows,
  };
}

export function resolveManagerId(
  managerEmployeeNumber: string | null | undefined,
  empByNum: Map<string, number>,
  workspaceExisting: Map<string, number>,
): number | null {
  if (!managerEmployeeNumber?.trim()) return null;
  const key = managerEmployeeNumber.trim().toLowerCase();
  return empByNum.get(key) ?? workspaceExisting.get(key) ?? null;
}

export async function loadWorkspaceEmployeeNumberIndex(workspaceId: number): Promise<Map<string, number>> {
  const { db } = await import("@workspace/db");
  const rows = await db
    .select({ id: employeesTable.id, employeeNumber: employeesTable.employeeNumber })
    .from(employeesTable)
    .where(eq(employeesTable.workspaceId, workspaceId));

  return new Map(
    rows
      .filter((r) => r.employeeNumber)
      .map((r) => [String(r.employeeNumber).toLowerCase(), r.id]),
  );
}

export async function applyManagerPass(input: {
  workspaceId: number;
  updates: Array<{ employeeId: number; managerId: number | null; rowNumber: number }>;
}): Promise<{ applied: number; skipped: number }> {
  const { db } = await import("@workspace/db");
  let applied = 0;
  let skipped = 0;

  for (const u of input.updates) {
    if (u.managerId === u.employeeId) {
      skipped++;
      continue;
    }
    await db
      .update(employeesTable)
      .set({ directManagerId: u.managerId })
      .where(and(eq(employeesTable.id, u.employeeId), eq(employeesTable.workspaceId, input.workspaceId)));
    applied++;
  }

  return { applied, skipped };
}
