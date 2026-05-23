/**
 * Export runtime foundation (Phase 1 — JSON export, no UI).
 */

import { db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { masterDataCatalogService, type MasterDataCatalogSnapshot } from "../catalog/master-data-catalog";

export type MasterDataExportOptions = {
  entities?: string[];
};

export type EmployeeExportRow = {
  id: number;
  employeeNumber: string | null;
  fullName: string;
  email: string | null;
  status: string | null;
  employmentType: string | null;
  orgUnitId: number | null;
  jobTitleId: number | null;
  jobGradeId: number | null;
  workLocationId: number | null;
  positionId: number | null;
  directManagerId: number | null;
};

export async function exportMasterDataJson(
  workspaceId: number,
  options: MasterDataExportOptions = {},
): Promise<MasterDataCatalogSnapshot & { exportVersion: string }> {
  const snapshot = await masterDataCatalogService.loadSnapshot(workspaceId, true);
  const wanted = new Set(options.entities ?? Object.keys(snapshot.entities));

  const filtered: MasterDataCatalogSnapshot["entities"] = {};
  for (const [k, v] of Object.entries(snapshot.entities)) {
    if (wanted.has(k) && v) filtered[k as keyof typeof filtered] = v;
  }

  return {
    ...snapshot,
    entities: filtered,
    exportVersion: "1.0.0-foundation",
  };
}

export async function exportEmployeesJson(
  workspaceId: number,
  limit = 5000,
): Promise<{ workspaceId: number; exportVersion: string; rows: EmployeeExportRow[] }> {
  const rows = await db
    .select({
      id: employeesTable.id,
      employeeNumber: employeesTable.employeeNumber,
      fullName: employeesTable.fullName,
      email: employeesTable.email,
      status: employeesTable.status,
      employmentType: employeesTable.employmentType,
      orgUnitId: employeesTable.orgUnitId,
      jobTitleId: employeesTable.jobTitleId,
      jobGradeId: employeesTable.jobGradeId,
      workLocationId: employeesTable.workLocationId,
      positionId: employeesTable.positionId,
      directManagerId: employeesTable.directManagerId,
    })
    .from(employeesTable)
    .where(eq(employeesTable.workspaceId, workspaceId))
    .limit(Math.min(limit, 10_000));

  return {
    workspaceId,
    exportVersion: "1.0.0-foundation",
    rows,
  };
}
