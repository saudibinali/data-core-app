/**
 * Phase 6 — Enterprise confirm resolution bridge (delegates to always-on import intelligence).
 */

import { isEnterpriseImportRuntimeActive } from "./enterprise-runtime-activation";
import { applyImportConfirmIntelligence, type ConfirmRow } from "../intelligence/import-intelligence-engine";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type { ConfirmRow };

export async function applyEnterpriseConfirmResolution(input: {
  workspaceId: number;
  rows: ConfirmRow[];
  approveEntityCreates?: boolean;
  userId?: number;
}): Promise<{ rows: ConfirmRow[]; created: number; queued: number; skipped: number; enterpriseActive: boolean }> {
  const enterpriseActive = await isEnterpriseImportRuntimeActive(input.workspaceId);
  const result = await applyImportConfirmIntelligence(input);
  incrementRuntimeMetric("import.phase6.confirm_resolution", result.created);
  return { ...result, enterpriseActive };
}

export async function getEnterpriseMasterDataCapabilities(workspaceId: number) {
  const active = await isEnterpriseImportRuntimeActive(workspaceId);
  return {
    bulkImportEnabled: active,
    exportPath: "/hr/import/export/master-data",
    uploadPath: "/hr/import/v2/upload",
    commitPath: "/hr/import/v2/commit",
    templatePath: "/hr/import/templates/v2",
    supportedEntities: active
      ? ["org_unit", "job_title", "job_grade", "position", "work_location", "employment_type", "employee_status"]
      : [],
    note: active
      ? "Use v2 upload + validate + commit with importType hr.foundation.session"
      : "Activate enterprise runtime for workspace-scoped bulk master data import",
  };
}
