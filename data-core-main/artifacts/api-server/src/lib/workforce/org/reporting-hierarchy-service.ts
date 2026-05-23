import { db } from "@workspace/db";
import { employeesTable, workforceExecutiveOverridesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../../logger";
import { resolveDirectManagerUserId } from "../manager-resolver";
import type { ReportingChainEntry, ReportingNode } from "../types";
import { getOrgRuntimeMode, type OrgRuntimeMode } from "./org-runtime-settings";
import {
  getOrgUnitHeadEmployeeId,
  resolveNearestOrgHeadEmployeeId,
} from "./org-graph-service";

export class ManagerCycleError extends Error {
  constructor(public readonly employeeId: number) {
    super(`MANAGER_CYCLE detected for employee ${employeeId}`);
    this.name = "ManagerCycleError";
  }
}

export async function getExecutiveOverrides(workspaceId: number) {
  try {
    const [row] = await db
      .select()
      .from(workforceExecutiveOverridesTable)
      .where(eq(workforceExecutiveOverridesTable.workspaceId, workspaceId));
    return row ?? null;
  } catch {
    return null;
  }
}

export async function isExecutiveExempt(
  workspaceId: number,
  employeeId: number,
): Promise<boolean> {
  const overrides = await getExecutiveOverrides(workspaceId);
  if (!overrides) return false;

  const exempt = overrides.executiveExemptEmployeeIds;
  if (Array.isArray(exempt) && exempt.includes(employeeId)) return true;
  if (overrides.ceoEmployeeId === employeeId) return true;
  if (overrides.hrDirectorEmployeeId === employeeId) return true;
  return false;
}

export function wouldCreateManagerCycle(
  employeeId: number,
  newManagerId: number | null,
  employees: Array<{ id: number; directManagerId: number | null }>,
): boolean {
  if (newManagerId == null) return false;
  if (newManagerId === employeeId) return true;

  const byId = new Map(employees.map((e) => [e.id, e]));
  let current: number | null = newManagerId;
  const seen = new Set<number>([employeeId]);

  while (current != null) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.directManagerId ?? null;
  }
  return false;
}

/**
 * Full reporting chain with source metadata (direct manager walk).
 * Throws ManagerCycleError on cycle.
 */
export async function getFullReportingChain(
  workspaceId: number,
  employeeId: number,
  maxDepth?: number,
): Promise<ReportingNode[]> {
  const overrides = await getExecutiveOverrides(workspaceId);
  const depthLimit = maxDepth ?? overrides?.maxReportingDepth ?? 10;

  const chain: ReportingNode[] = [];
  let currentId: number | null = employeeId;
  const seen = new Set<number>();

  for (let depth = 0; depth < depthLimit && currentId != null; depth++) {
    if (seen.has(currentId)) {
      throw new ManagerCycleError(employeeId);
    }
    seen.add(currentId);

    const [emp] = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        userId: employeesTable.userId,
        orgUnitId: employeesTable.orgUnitId,
        positionId: employeesTable.positionId,
        directManagerId: employeesTable.directManagerId,
        status: employeesTable.status,
      })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, currentId), eq(employeesTable.workspaceId, workspaceId)))
      .limit(1);

    if (!emp) break;

    chain.push({
      employeeId: emp.id,
      fullName: emp.fullName,
      userId: emp.userId,
      orgUnitId: emp.orgUnitId,
      positionId: emp.positionId,
      depth,
      source: depth === 0 ? "self" : "direct",
    });

    currentId = emp.directManagerId;
  }

  return chain;
}

/** Legacy-compatible flat chain (Phase 1 shape). */
export async function getReportingChainFlat(
  workspaceId: number,
  employeeId: number,
  maxDepth = 20,
): Promise<ReportingChainEntry[]> {
  const nodes = await getFullReportingChain(workspaceId, employeeId, maxDepth);
  return nodes.map((n) => ({
    employeeId: n.employeeId,
    fullName: n.fullName,
    userId: n.userId,
    depth: n.depth,
  }));
}

/**
 * Resolve approver user id with org-head and executive fallbacks.
 * Does not use legacy users.lineManagerId directly.
 */
export async function resolveManagerUserIdForEmployee(
  workspaceId: number,
  employeeId: number,
): Promise<{ userId: number; source: string } | null> {
  const direct = await resolveDirectManagerUserId(workspaceId, employeeId);
  if (direct) return { userId: direct, source: "direct_manager" };

  const [emp] = await db
    .select({ orgUnitId: employeesTable.orgUnitId })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)))
    .limit(1);

  if (emp?.orgUnitId) {
    const headOnUnit = await getOrgUnitHeadEmployeeId(workspaceId, emp.orgUnitId);
    if (headOnUnit && headOnUnit !== employeeId) {
      const [headEmp] = await db
        .select({ userId: employeesTable.userId, status: employeesTable.status })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, headOnUnit), eq(employeesTable.workspaceId, workspaceId)))
        .limit(1);
      if (headEmp?.userId && headEmp.status === "active") {
        return { userId: headEmp.userId, source: "org_unit_head" };
      }
    }

    const nearest = await resolveNearestOrgHeadEmployeeId(workspaceId, emp.orgUnitId);
    if (nearest && nearest.employeeId !== employeeId) {
      const [headEmp] = await db
        .select({ userId: employeesTable.userId, status: employeesTable.status })
        .from(employeesTable)
        .where(
          and(eq(employeesTable.id, nearest.employeeId), eq(employeesTable.workspaceId, workspaceId)),
        )
        .limit(1);
      if (headEmp?.userId && headEmp.status === "active") {
        return { userId: headEmp.userId, source: "parent_org_head" };
      }
    }
  }

  const overrides = await getExecutiveOverrides(workspaceId);
  if (overrides?.hrDirectorEmployeeId) {
    const [hrDir] = await db
      .select({ userId: employeesTable.userId, status: employeesTable.status })
      .from(employeesTable)
      .where(
        and(
          eq(employeesTable.id, overrides.hrDirectorEmployeeId),
          eq(employeesTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (hrDir?.userId && hrDir.status === "active") {
      return { userId: hrDir.userId, source: "executive_hr_director" };
    }
  }

  return null;
}

export async function shadowCompareReportingResolvers(
  workspaceId: number,
  employeeId: number,
  legacyUserId: number | null,
): Promise<void> {
  const mode = await getOrgRuntimeMode(workspaceId);
  if (mode !== "shadow") return;

  const canonical = await resolveManagerUserIdForEmployee(workspaceId, employeeId);
  if (canonical?.userId !== legacyUserId) {
    logger.info(
      { workspaceId, employeeId, canonical, legacyUserId },
      "Org runtime shadow: manager resolution mismatch",
    );
  }
}
