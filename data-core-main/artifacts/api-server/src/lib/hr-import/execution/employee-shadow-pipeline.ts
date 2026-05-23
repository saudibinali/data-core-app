/**
 * Phase 3 — Employee import v2 shadow pipeline (simulation only, no commit).
 */

import { db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { HrImportValidator } from "../validation/hr-import-validator";
import { topologicalSortManagers } from "./dependency-ordering";

export type ShadowSimulationResult = {
  orderedEmployeeNumbers: string[];
  managerOrdering: ReturnType<typeof topologicalSortManagers>;
  validations: Awaited<ReturnType<typeof HrImportValidator.validateRows>>;
  simulation: {
    wouldInsert: number;
    wouldUpdate: number;
    wouldSkip: number;
  };
  rollbackPrepared: number;
  commitEnabled: false;
};

export async function runEmployeeShadowPipeline(input: {
  workspaceId: number;
  numberingMode: string;
  rows: Record<string, string>[];
}): Promise<ShadowSimulationResult> {
  const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId);
  const ctx = await HrImportValidator.createContext(input.workspaceId, catalog, input.numberingMode);
  const validations = HrImportValidator.validateRows(ctx, input.rows);

  const managerRows = input.rows
    .map((r) => ({
      employeeNumber: String(r.employee_number ?? r.employeeNumber ?? "").trim(),
      managerEmployeeNumber: String(r.direct_manager_num ?? r.managerEmployeeNumber ?? "").trim() || null,
    }))
    .filter((r) => r.employeeNumber);

  const managerOrdering = topologicalSortManagers(managerRows);

  const existing = await db
    .select({ id: employeesTable.id, employeeNumber: employeesTable.employeeNumber, email: employeesTable.email })
    .from(employeesTable)
    .where(eq(employeesTable.workspaceId, input.workspaceId));

  const byNum = new Map(existing.map((e) => [String(e.employeeNumber ?? "").toLowerCase(), e]));
  const byEmail = new Map(existing.filter((e) => e.email).map((e) => [String(e.email).toLowerCase(), e]));

  let wouldInsert = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;

  for (let i = 0; i < input.rows.length; i++) {
    const v = validations[i]!;
    if (v.errors.length) {
      wouldSkip++;
      continue;
    }
    const r = input.rows[i]!;
    const num = String(r.employee_number ?? "").toLowerCase();
    const email = String(r.email ?? "").toLowerCase();
    const exists = (num && byNum.has(num)) || (email && byEmail.has(email));
    if (exists) wouldUpdate++;
    else wouldInsert++;
  }

  return {
    orderedEmployeeNumbers: managerOrdering.ordered,
    managerOrdering,
    validations,
    simulation: { wouldInsert, wouldUpdate, wouldSkip },
    rollbackPrepared: 0,
    commitEnabled: false,
  };
}
