import { db } from "@workspace/db";
import { employeesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../../logger";
import { wouldCreateManagerCycle } from "./reporting-hierarchy-service";
import { isExecutiveExempt } from "./reporting-hierarchy-service";
import { getOrgRuntimeMode, type OrgRuntimeMode } from "./org-runtime-settings";
import { getOrgUnitById } from "./org-graph-service";

export type EmployeeOrgFields = {
  status?: string | null;
  orgUnitId?: number | null;
  directManagerId?: number | null;
};

export type OrgValidationResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; status: number; error: string; code: string };

export async function validateEmployeeOrgLinking(
  workspaceId: number,
  employeeId: number | null,
  fields: EmployeeOrgFields,
  modeOverride?: OrgRuntimeMode,
): Promise<OrgValidationResult> {
  const mode = modeOverride ?? (await getOrgRuntimeMode(workspaceId));
  const warnings: string[] = [];
  const status = fields.status ?? "active";
  const isActive = status === "active";

  if (fields.directManagerId != null && employeeId != null && fields.directManagerId === employeeId) {
    return { ok: false, status: 400, error: "Employee cannot be their own manager", code: "SELF_MANAGER" };
  }

  if (fields.orgUnitId != null) {
    const unit = await getOrgUnitById(workspaceId, fields.orgUnitId);
    if (!unit) {
      return { ok: false, status: 400, error: "orgUnitId must reference an org unit in this workspace", code: "INVALID_ORG_UNIT" };
    }
  }

  if (fields.directManagerId != null) {
    const [mgr] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(
        and(eq(employeesTable.id, fields.directManagerId), eq(employeesTable.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!mgr) {
      return {
        ok: false,
        status: 400,
        error: "directManagerId must reference an employee in this workspace",
        code: "INVALID_MANAGER",
      };
    }
  }

  if (employeeId != null && fields.directManagerId != null) {
    const allEmps = await db
      .select({ id: employeesTable.id, directManagerId: employeesTable.directManagerId })
      .from(employeesTable)
      .where(eq(employeesTable.workspaceId, workspaceId));
    if (wouldCreateManagerCycle(employeeId, fields.directManagerId, allEmps)) {
      return { ok: false, status: 400, error: "Manager assignment would create a reporting cycle", code: "MANAGER_CYCLE" };
    }
  }

  if (!isActive || mode === "legacy") {
    return { ok: true, warnings };
  }

  const exempt = employeeId != null && (await isExecutiveExempt(workspaceId, employeeId));

  if (!fields.orgUnitId && !exempt) {
    const msg = "Active employees require an org unit assignment";
    if (mode === "active") {
      return { ok: false, status: 400, error: msg, code: "MISSING_ORG_UNIT" };
    }
    warnings.push(msg);
    logger.warn({ workspaceId, employeeId, mode }, msg);
  }

  if (!fields.directManagerId && !exempt) {
    const msg = "Active employees require a direct manager (executive exemptions apply)";
    if (mode === "active") {
      return { ok: false, status: 400, error: msg, code: "MISSING_MANAGER" };
    }
    warnings.push(msg);
    logger.warn({ workspaceId, employeeId, mode }, msg);
  }

  return { ok: true, warnings: warnings.length ? warnings : undefined };
}
