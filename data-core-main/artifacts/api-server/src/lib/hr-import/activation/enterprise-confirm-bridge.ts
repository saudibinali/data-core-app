/**
 * Phase 6 — Enterprise confirm resolution bridge (legacy confirm hook).
 */

import { isEnterpriseImportRuntimeActive, getEffectiveEntityPolicy } from "./enterprise-runtime-activation";
import { resolveOrCreateEntity } from "./enterprise-entity-resolver";
import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { reconcileEntityLookup } from "./reconciliation-activator";
import type { CatalogEntityType } from "../catalog/master-data-catalog";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type ConfirmRow = {
  status: "new" | "update" | "skip";
  existingEmployeeId?: number;
  data: Record<string, unknown>;
};

const RESOLVE_FIELDS: Array<{ entityType: CatalogEntityType; idKey: string; nameKey: string }> = [
  { entityType: "org_unit", idKey: "orgUnitId", nameKey: "orgUnitName" },
  { entityType: "job_title", idKey: "jobTitleId", nameKey: "jobTitleName" },
  { entityType: "job_grade", idKey: "jobGradeId", nameKey: "jobGradeName" },
  { entityType: "position", idKey: "positionId", nameKey: "positionTitle" },
  { entityType: "work_location", idKey: "workLocationId", nameKey: "workLocationName" },
];

export async function applyEnterpriseConfirmResolution(input: {
  workspaceId: number;
  rows: ConfirmRow[];
  approveEntityCreates?: boolean;
  userId?: number;
}): Promise<{ rows: ConfirmRow[]; created: number; queued: number; skipped: number; enterpriseActive: boolean }> {
  const enterpriseActive = await isEnterpriseImportRuntimeActive(input.workspaceId);
  if (!enterpriseActive) {
    return { rows: input.rows, created: 0, queued: 0, skipped: 0, enterpriseActive: false };
  }

  const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId, true);
  let created = 0;
  let queued = 0;
  let skipped = 0;

  const resolvedRows: ConfirmRow[] = [];

  for (const row of input.rows) {
    if (row.status === "skip") {
      resolvedRows.push(row);
      continue;
    }

    const data = { ...row.data };

    for (const field of RESOLVE_FIELDS) {
      if (data[field.idKey]) continue;

      const nameHint = String(data[field.nameKey] ?? data.location ?? "").trim();
      if (!nameHint) continue;

      const policy = await getEffectiveEntityPolicy(input.workspaceId, field.entityType);
      const match = reconcileEntityLookup(catalog, field.entityType, nameHint);

      if (match.entityId && match.confidence >= 0.85) {
        data[field.idKey] = match.entityId;
        if (field.entityType === "work_location") {
          data.location = match.matchedName ?? nameHint;
        }
        continue;
      }

      const result = await resolveOrCreateEntity({
        workspaceId: input.workspaceId,
        entityType: field.entityType,
        name: nameHint,
        policy,
        approveCreates: input.approveEntityCreates,
        userId: input.userId,
      });

      if (!result) continue;
      if (result.action === "created" && result.entityId) {
        data[field.idKey] = result.entityId;
        if (field.entityType === "work_location") data.location = nameHint;
        created++;
      } else if (result.action === "queued_approval") {
        queued++;
      } else if (result.action === "skipped") {
        skipped++;
      }
    }

    resolvedRows.push({ ...row, data });
  }

  incrementRuntimeMetric("import.phase6.confirm_resolution", created);
  return { rows: resolvedRows, created, queued, skipped, enterpriseActive: true };
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
