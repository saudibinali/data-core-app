/**
 * F5.4 — Import / commit gating from cutover-readiness checklist.
 */

import { getLeaveRuntimeMode } from "../../hr/hcm-workspace-settings";
import { getOrgRuntimeMode } from "../org/org-runtime-settings";
import {
  getGovernanceCutoverReadiness,
  type CutoverReadinessCheck,
} from "./governance-finalization";

export type ImportCutoverGateStatus = {
  strictRowValidation: boolean;
  commitAllowed: boolean;
  commitBlockers: Array<{ id: string; label: string; detail: string }>;
  orgRuntimeMode: string;
  leaveRuntimeMode: string;
  readyForCanonicalEmployeeImport: boolean;
  readyForCanonicalMasterDataImport: boolean;
  failedChecks: CutoverReadinessCheck[];
};

function blockersFromChecks(
  checks: CutoverReadinessCheck[],
  ids: string[],
): Array<{ id: string; label: string; detail: string }> {
  return checks
    .filter((c) => ids.includes(c.id) && !c.passed)
    .map((c) => ({ id: c.id, label: c.label, detail: c.detail }));
}

export async function evaluateImportCutoverGates(
  workspaceId: number,
): Promise<ImportCutoverGateStatus> {
  const [orgRuntimeMode, leaveRuntimeMode, readiness] = await Promise.all([
    getOrgRuntimeMode(workspaceId),
    getLeaveRuntimeMode(workspaceId),
    getGovernanceCutoverReadiness(workspaceId),
  ]);

  const strictRowValidation =
    orgRuntimeMode === "active" || leaveRuntimeMode === "canonical";

  const commitCheckIds: string[] = [];
  if (orgRuntimeMode === "active") {
    commitCheckIds.push("departments_org_mapped", "org_active");
  }
  if (leaveRuntimeMode === "canonical") {
    commitCheckIds.push("legacy_leaves_migrated", "leave_runtime_canonical_or_transition");
  }
  if (orgRuntimeMode === "active" || leaveRuntimeMode === "canonical") {
    commitCheckIds.push("leave_runtime_canonical_or_transition");
  }

  const uniqueIds = [...new Set(commitCheckIds)];
  const commitBlockers = blockersFromChecks(readiness.checks, uniqueIds);

  const employeeImportCheckIds =
    orgRuntimeMode === "active"
      ? ["departments_org_mapped", "org_active"]
      : leaveRuntimeMode === "canonical"
        ? ["legacy_leaves_migrated"]
        : [];

  const masterDataCheckIds =
    orgRuntimeMode === "active" ? ["departments_org_mapped", "org_active"] : [];

  const employeeBlockers = blockersFromChecks(readiness.checks, employeeImportCheckIds);
  const masterBlockers = blockersFromChecks(readiness.checks, masterDataCheckIds);

  const failedChecks = readiness.checks.filter((c) => !c.passed);

  return {
    strictRowValidation,
    commitAllowed: strictRowValidation ? commitBlockers.length === 0 : true,
    commitBlockers,
    orgRuntimeMode,
    leaveRuntimeMode,
    readyForCanonicalEmployeeImport: employeeBlockers.length === 0,
    readyForCanonicalMasterDataImport: masterBlockers.length === 0,
    failedChecks,
  };
}
