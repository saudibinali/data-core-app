import { logger } from "../../logger";
import { validateEmployeeOrgLinking } from "../org/employee-org-validation";
import {
  getWorkforceActivationRequires,
  getWorkforceGovernanceMode,
  type WorkforceGovernanceMode,
} from "./settings";

export type GovernanceFields = {
  status?: string | null;
  orgUnitId?: number | null;
  directManagerId?: number | null;
  employmentType?: string | null;
  jobTitleId?: number | null;
};

export type GovernanceResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; status: number; error: string; code: string };

export async function validateWorkforceGovernance(
  workspaceId: number,
  employeeId: number | null,
  fields: GovernanceFields,
  modeOverride?: WorkforceGovernanceMode,
): Promise<GovernanceResult> {
  const mode = modeOverride ?? (await getWorkforceGovernanceMode(workspaceId));
  const warnings: string[] = [];

  const orgResult = await validateEmployeeOrgLinking(workspaceId, employeeId, {
    status: fields.status ?? "active",
    orgUnitId: fields.orgUnitId,
    directManagerId: fields.directManagerId,
  });

  if (!orgResult.ok) {
    if (mode === "active") return orgResult;
    warnings.push(orgResult.error);
    logger.warn({ workspaceId, employeeId, mode, code: orgResult.code }, orgResult.error);
  } else if (orgResult.warnings?.length) {
    warnings.push(...orgResult.warnings);
  }

  if (mode === "legacy") {
    return { ok: true, warnings: warnings.length ? warnings : undefined };
  }

  const activation = await getWorkforceActivationRequires(workspaceId);
  const isActive = (fields.status ?? "active") === "active";

  if (isActive && activation.employmentType && !fields.employmentType) {
    const msg = "Active employees require an employment type";
    if (mode === "active") {
      return { ok: false, status: 400, error: msg, code: "MISSING_EMPLOYMENT_TYPE" };
    }
    warnings.push(msg);
    logger.warn({ workspaceId, employeeId, mode }, msg);
  }

  if (isActive && activation.jobTitle && !fields.jobTitleId) {
    const msg = "Active employees require a job title";
    if (mode === "active") {
      return { ok: false, status: 400, error: msg, code: "MISSING_JOB_TITLE" };
    }
    warnings.push(msg);
    logger.warn({ workspaceId, employeeId, mode }, msg);
  }

  return { ok: true, warnings: warnings.length ? warnings : undefined };
}
