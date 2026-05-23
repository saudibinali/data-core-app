/**
 * Final Phase — Strict governance enforcement (pilot_active & active only).
 */

import { validateEmployeeOrgLinking } from "../../workforce/org/employee-org-validation";
import { validateWorkforceGovernance } from "../../workforce/operations/governance-service";
import { buildManagerCommitPlan } from "../commit/hierarchy-commit";
import { detectRuntimeUniquenessViolations } from "../auto-create/duplicate-prevention";
import type { ImportRuntimeSettings } from "../runtime-settings";
import { isStrictGovernanceMode } from "../runtime-settings";
import type { MasterDataCatalogSnapshot } from "../catalog/master-data-catalog";
import type { HrImportRowValidation } from "../validation/hr-import-validator";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";
import { recordWorkforceAudit } from "../../workforce/operations/audit-service";

export type GovernanceEnforcementResult = {
  enforced: boolean;
  mode: string;
  orgValidation: Awaited<ReturnType<typeof validateEmployeeOrgLinking>> | null;
  governanceValidation: Awaited<ReturnType<typeof validateWorkforceGovernance>> | null;
  hierarchyIssues: string[];
  duplicateIssues: string[];
  blockingErrors: string[];
};

export async function enforceStrictGovernance(input: {
  workspaceId: number;
  settings: ImportRuntimeSettings;
  employeeId?: number | null;
  orgUnitId?: number | null;
  directManagerId?: number | null;
  catalog: MasterDataCatalogSnapshot;
  validations: HrImportRowValidation[];
  rawRows: Record<string, string>[];
}): Promise<GovernanceEnforcementResult> {
  const enforced = isStrictGovernanceMode(input.settings);
  const blockingErrors: string[] = [];
  const hierarchyIssues: string[] = [];
  const duplicateIssues: string[] = [];

  if (!enforced) {
    return {
      enforced: false,
      mode: input.settings.employeeImportRuntimeMode,
      orgValidation: null,
      governanceValidation: null,
      hierarchyIssues,
      duplicateIssues,
      blockingErrors,
    };
  }

  incrementRuntimeMetric("import.final.strict_governance");

  const orgValidation = await validateEmployeeOrgLinking(input.workspaceId, input.employeeId ?? null, {
    orgUnitId: input.orgUnitId ?? null,
    directManagerId: input.directManagerId ?? null,
  });

  if (!orgValidation.ok) {
    blockingErrors.push(`org:${orgValidation.error}`);
  }

  let governanceValidation: Awaited<ReturnType<typeof validateWorkforceGovernance>> | null = null;
  if (input.employeeId) {
    governanceValidation = await validateWorkforceGovernance(input.workspaceId, input.employeeId, {
      orgUnitId: input.orgUnitId ?? undefined,
      directManagerId: input.directManagerId ?? undefined,
    });
    if (!governanceValidation.ok) {
      blockingErrors.push(`governance:${governanceValidation.error}`);
    }
  }

  const hierarchy = buildManagerCommitPlan(
    input.rawRows.map((r, i) => ({ rowNumber: i + 1, raw: r })),
  );
  for (const u of hierarchy.unresolvedManagers) {
    hierarchyIssues.push(u.reason);
    blockingErrors.push(`manager:${u.reason}`);
  }
  for (const cycle of hierarchy.cycles) {
    hierarchyIssues.push(`cycle:${cycle.join("->")}`);
    blockingErrors.push(`cycle:${cycle.join("->")}`);
  }

  const dupRows = input.rawRows
    .map((r, i) => ({
      rowNumber: i + 1,
      entityType: "employee" as const,
      code: String(r.employee_number ?? ""),
      name: String(r.full_name ?? r.email ?? ""),
    }))
    .filter((r) => r.name);

  const dups = detectRuntimeUniquenessViolations(input.catalog, dupRows as never);
  for (const d of dups) {
    duplicateIssues.push(d.duplicateKey);
    blockingErrors.push(`duplicate:${d.duplicateKey}`);
  }

  if (blockingErrors.length) {
    void recordWorkforceAudit({
      workspaceId: input.workspaceId,
      entityType: "import_governance",
      entityId: input.employeeId ?? 0,
      action: "strict_governance.blocked",
      afterState: { blockingErrors, hierarchyIssues, duplicateIssues },
    });
  }

  return {
    enforced: true,
    mode: input.settings.employeeImportRuntimeMode,
    orgValidation,
    governanceValidation,
    hierarchyIssues,
    duplicateIssues,
    blockingErrors,
  };
}
