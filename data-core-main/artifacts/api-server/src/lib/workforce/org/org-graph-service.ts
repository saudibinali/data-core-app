import { db } from "@workspace/db";
import { employeesTable, hrOrgUnitsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  buildOrgTree,
  getOrgAncestors,
  getOrgDescendantIds,
  type FlatOrgUnit,
} from "../org-traversal";
import { getCachedOrgUnits, setCachedOrgUnits } from "../stabilization/org-cache";

export async function loadWorkspaceOrgUnits(workspaceId: number): Promise<FlatOrgUnit[]> {
  const cached = getCachedOrgUnits(workspaceId);
  if (cached) return cached;

  const rows = await db
    .select()
    .from(hrOrgUnitsTable)
    .where(eq(hrOrgUnitsTable.workspaceId, workspaceId));
  const mapped = rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    type: r.type,
    name: r.name,
    nameAr: r.nameAr,
    code: r.code,
    parentId: r.parentId,
    color: r.color,
    displayOrder: r.displayOrder,
    isActive: r.isActive,
  }));
  setCachedOrgUnits(workspaceId, mapped);
  return mapped;
}

export async function getOrgUnitById(workspaceId: number, orgUnitId: number) {
  const [row] = await db
    .select()
    .from(hrOrgUnitsTable)
    .where(and(eq(hrOrgUnitsTable.id, orgUnitId), eq(hrOrgUnitsTable.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function getOrgUnitAncestors(workspaceId: number, orgUnitId: number) {
  const units = await loadWorkspaceOrgUnits(workspaceId);
  return getOrgAncestors(orgUnitId, units);
}

export async function getOrgUnitDescendantIds(workspaceId: number, orgUnitId: number) {
  const units = await loadWorkspaceOrgUnits(workspaceId);
  return getOrgDescendantIds(orgUnitId, units);
}

export async function getOrgUnitTree(workspaceId: number, activeOnly = true) {
  const rows = await db
    .select()
    .from(hrOrgUnitsTable)
    .where(
      activeOnly
        ? and(eq(hrOrgUnitsTable.workspaceId, workspaceId), eq(hrOrgUnitsTable.isActive, true))
        : eq(hrOrgUnitsTable.workspaceId, workspaceId),
    );
  return buildOrgTree(rows);
}

export async function getEmployeesInOrgSubtree(workspaceId: number, orgUnitId: number) {
  const descendantIds = await getOrgUnitDescendantIds(workspaceId, orgUnitId);
  const allIds = [orgUnitId, ...descendantIds];
  if (!allIds.length) return [];

  return db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      orgUnitId: employeesTable.orgUnitId,
      directManagerId: employeesTable.directManagerId,
      status: employeesTable.status,
      userId: employeesTable.userId,
    })
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.workspaceId, workspaceId),
        inArray(employeesTable.orgUnitId, allIds),
      ),
    );
}

/** Org unit head employee id (canonical hr_org_units.manager_employee_id). */
export async function getOrgUnitHeadEmployeeId(
  workspaceId: number,
  orgUnitId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ managerEmployeeId: hrOrgUnitsTable.managerEmployeeId })
    .from(hrOrgUnitsTable)
    .where(and(eq(hrOrgUnitsTable.id, orgUnitId), eq(hrOrgUnitsTable.workspaceId, workspaceId)))
    .limit(1);
  return row?.managerEmployeeId ?? null;
}

/** Walk ancestors to find nearest org head. */
export async function resolveNearestOrgHeadEmployeeId(
  workspaceId: number,
  orgUnitId: number | null,
): Promise<{ employeeId: number; orgUnitId: number } | null> {
  if (!orgUnitId) return null;

  const ancestors = await getOrgUnitAncestors(workspaceId, orgUnitId);
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const unit = ancestors[i]!;
    const full = await getOrgUnitById(workspaceId, unit.id);
    if (full?.managerEmployeeId) {
      return { employeeId: full.managerEmployeeId, orgUnitId: full.id };
    }
  }
  return null;
}
