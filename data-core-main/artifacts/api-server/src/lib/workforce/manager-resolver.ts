import { db } from "@workspace/db";
import {
  employeesTable,
  legacyDepartmentOrgMapTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../logger";
import { getWorkforceWorkspaceSettings, shouldSyncEmployeeToUser } from "./settings";
import { getOrgRuntimeMode } from "./org/org-runtime-settings";
import { resolveManagerUserIdForEmployee } from "./org/reporting-hierarchy-service";
import type { ManagerResolution, ReportingChainEntry } from "./types";
import { shouldRunLegacyAdapter } from "./stabilization/cleanup-staging";
import { recordLegacyUsage } from "./stabilization/usage-telemetry";

export async function resolveEmployeeByUserId(
  workspaceId: number,
  userId: number,
) {
  const [row] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function resolveEmployeeById(workspaceId: number, employeeId: number) {
  const [row] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.workspaceId, workspaceId), eq(employeesTable.id, employeeId)))
    .limit(1);
  return row ?? null;
}

/** Canonical: employees.directManagerId → manager.userId (active manager only). */
export async function resolveDirectManagerUserId(
  workspaceId: number,
  employeeId: number,
): Promise<number | null> {
  const [emp] = await db
    .select({ directManagerId: employeesTable.directManagerId })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)))
    .limit(1);

  if (!emp?.directManagerId) return null;

  const [mgr] = await db
    .select({ userId: employeesTable.userId, status: employeesTable.status })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, emp.directManagerId), eq(employeesTable.workspaceId, workspaceId)))
    .limit(1);

  if (mgr?.userId && mgr.status === "active") return mgr.userId;
  return null;
}

/** Legacy adapter: users.lineManagerId for linked employee user account. */
export async function resolveLegacyLineManagerUserId(
  workspaceId: number,
  employeeId: number,
): Promise<number | null> {
  const [emp] = await db
    .select({ userId: employeesTable.userId })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)))
    .limit(1);

  if (!emp?.userId) return null;

  const [user] = await db
    .select({ lineManagerId: usersTable.lineManagerId, status: usersTable.status })
    .from(usersTable)
    .where(and(eq(usersTable.id, emp.userId), eq(usersTable.workspaceId, workspaceId)))
    .limit(1);

  if (user?.lineManagerId && user.status === "active") return user.lineManagerId;
  return null;
}

/** Workflow trigger path: userId → manager userId with mode-aware resolution. */
export async function resolveManagerUserIdForTrigger(
  workspaceId: number,
  triggerUserId: number,
): Promise<number | null> {
  const { workforceCanonicalMode } = await getWorkforceWorkspaceSettings(workspaceId);

  const employee = await resolveEmployeeByUserId(workspaceId, triggerUserId);
  let canonicalMgr: number | null = null;

  if (employee) {
    canonicalMgr = await resolveDirectManagerUserId(workspaceId, employee.id);
  }

  const [legacyUser] = await db
    .select({ lineManagerId: usersTable.lineManagerId })
    .from(usersTable)
    .where(and(eq(usersTable.id, triggerUserId), eq(usersTable.workspaceId, workspaceId)))
    .limit(1);
  const legacyMgr = legacyUser?.lineManagerId ?? null;

  if (workforceCanonicalMode === "shadow" && canonicalMgr !== legacyMgr) {
    logger.info(
      {
        workspaceId,
        triggerUserId,
        canonicalMgr,
        legacyMgr,
        employeeId: employee?.id ?? null,
      },
      "Workforce shadow mode: manager resolution mismatch",
    );
    void recordLegacyUsage({
      workspaceId,
      eventType: "shadow_mismatch",
      legacySurface: "users.lineManagerId",
      runtimeMode: workforceCanonicalMode,
      sourcePath: "manager-resolver:resolveManagerUserIdForTrigger",
      metadata: { canonicalMgr, legacyMgr, triggerUserId },
    }).catch(() => undefined);
  }

  if (workforceCanonicalMode === "active" && canonicalMgr) return canonicalMgr;
  if (legacyMgr) return legacyMgr;
  if (workforceCanonicalMode !== "legacy" && canonicalMgr) return canonicalMgr;
  return null;
}

export async function resolveReportingChain(
  workspaceId: number,
  employeeId: number,
  maxDepth = 20,
): Promise<ReportingChainEntry[]> {
  const chain: ReportingChainEntry[] = [];
  let currentId: number | null = employeeId;
  const seen = new Set<number>();

  for (let depth = 0; depth < maxDepth && currentId != null; depth++) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const [emp] = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        userId: employeesTable.userId,
        directManagerId: employeesTable.directManagerId,
      })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, currentId), eq(employeesTable.workspaceId, workspaceId)))
      .limit(1);

    if (!emp) break;

    chain.push({
      employeeId: emp.id,
      fullName: emp.fullName,
      userId: emp.userId,
      depth,
    });

    currentId = emp.directManagerId;
  }

  return chain;
}

export async function resolveLeaveApprover(
  workspaceId: number,
  employeeId: number,
  requestedByUserId: number,
): Promise<ManagerResolution | null> {
  const orgMode = await getOrgRuntimeMode(workspaceId);
  const { workforceCanonicalMode } = await getWorkforceWorkspaceSettings(workspaceId);

  if (orgMode === "active" || orgMode === "shadow") {
    const resolved = await resolveManagerUserIdForEmployee(workspaceId, employeeId);
    if (resolved && resolved.userId !== requestedByUserId) {
      if (orgMode === "shadow") {
        const legacy = await resolveLegacyLineManagerUserId(workspaceId, employeeId);
        if (legacy !== resolved.userId) {
          logger.info(
            { workspaceId, employeeId, canonical: resolved, legacy },
            "Org runtime shadow: leave approver mismatch",
          );
        }
      }
      if (orgMode === "active" || resolved.source !== "legacy_line_manager") {
        return {
          approverUserId: resolved.userId,
          approverRole: "manager",
          source: resolved.source as ManagerResolution["source"],
        };
      }
    }
  }

  const direct = await resolveDirectManagerUserId(workspaceId, employeeId);
  if (direct) {
    return { approverUserId: direct, approverRole: "manager", source: "direct_manager" };
  }

  const legacy = await resolveLegacyLineManagerUserId(workspaceId, employeeId);
  if (legacy && legacy !== requestedByUserId) {
    if (workforceCanonicalMode === "shadow") {
      logger.info({ workspaceId, employeeId, legacy }, "Workforce shadow: using legacy line manager for leave");
    }
    return { approverUserId: legacy, approverRole: "manager", source: "legacy_line_manager" };
  }

  return null;
}

/** Maps legacy departmentId → orgUnitId via legacy_department_org_map. */
export async function resolveOrgUnitFromLegacyDepartment(
  workspaceId: number,
  departmentId: number,
): Promise<number | null> {
  try {
    const [row] = await db
      .select({ orgUnitId: legacyDepartmentOrgMapTable.orgUnitId })
      .from(legacyDepartmentOrgMapTable)
      .where(
        and(
          eq(legacyDepartmentOrgMapTable.workspaceId, workspaceId),
          eq(legacyDepartmentOrgMapTable.departmentId, departmentId),
        ),
      )
      .limit(1);
    return row?.orgUnitId ?? null;
  } catch {
    return null;
  }
}

/** Sync users.lineManagerId and users.departmentId from canonical employee fields (active mode). */
export async function syncLegacyUserFieldsFromEmployee(
  workspaceId: number,
  employeeId: number,
): Promise<void> {
  const settings = await getWorkforceWorkspaceSettings(workspaceId);
  if (settings.workforceCanonicalMode !== "active") return;
  if (!shouldSyncEmployeeToUser(settings.workforceSyncDirection)) return;

  const [emp] = await db
    .select({
      userId: employeesTable.userId,
      directManagerId: employeesTable.directManagerId,
      orgUnitId: employeesTable.orgUnitId,
    })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)))
    .limit(1);

  if (!emp?.userId) return;

  if (!(await shouldRunLegacyAdapter(workspaceId, "sync_user_fields"))) {
    void recordLegacyUsage({
      workspaceId,
      eventType: "adapter_skipped",
      legacySurface: "users.lineManagerId",
      sourcePath: "manager-resolver:syncLegacyUserFieldsFromEmployee",
      entityType: "employee",
      entityId: employeeId,
    }).catch(() => undefined);
    return;
  }

  const updates: { lineManagerId?: number | null; departmentId?: number | null } = {};

  if (emp.directManagerId) {
    const mgrUserId = await resolveDirectManagerUserId(workspaceId, employeeId);
    if (mgrUserId) updates.lineManagerId = mgrUserId;
  }

  if (emp.orgUnitId) {
    const [mapRow] = await db
      .select({ departmentId: legacyDepartmentOrgMapTable.departmentId })
      .from(legacyDepartmentOrgMapTable)
      .where(
        and(
          eq(legacyDepartmentOrgMapTable.workspaceId, workspaceId),
          eq(legacyDepartmentOrgMapTable.orgUnitId, emp.orgUnitId),
        ),
      )
      .limit(1);
    if (mapRow) updates.departmentId = mapRow.departmentId;
  }

  if (Object.keys(updates).length === 0) return;

  await db
    .update(usersTable)
    .set(updates)
    .where(and(eq(usersTable.id, emp.userId), eq(usersTable.workspaceId, workspaceId)));

  void recordLegacyUsage({
    workspaceId,
    eventType: "adapter_write",
    legacySurface: "users.lineManagerId",
    runtimeMode: settings.workforceCanonicalMode,
    sourcePath: "manager-resolver:syncLegacyUserFieldsFromEmployee",
    entityType: "employee",
    entityId: employeeId,
    metadata: { fields: Object.keys(updates) },
  }).catch(() => undefined);
}
