/**
 * Phase 6 — Import preview orchestration (enterprise buckets on legacy preview).
 */

import { masterDataCatalogService } from "../catalog/master-data-catalog";
import { isEnterpriseImportRuntimeActive, getEffectiveEntityPolicy } from "./enterprise-runtime-activation";
import { reconcileEntityLookup } from "./reconciliation-activator";
import type { CatalogEntityType } from "../catalog/master-data-catalog";

export type LegacyPreviewRow = {
  rowIndex: number;
  status: string;
  existingEmployeeId?: number;
  errors: string[];
  warnings: string[];
  data: Record<string, unknown>;
};

export type EnterprisePreviewBuckets = {
  matched: Array<{ rowIndex: number; entityType: string; name: string; entityId: number }>;
  proposeCreate: Array<{ rowIndex: number; entityType: string; name: string; approvalRequired: boolean }>;
  conflicts: Array<{ rowIndex: number; entityType: string; message: string }>;
  ambiguous: Array<{ rowIndex: number; entityType: string; suggestions: string[] }>;
  blocked: Array<{ rowIndex: number; entityType: string; reason: string }>;
  approvalRequired: Array<{ rowIndex: number; entityType: string; name: string }>;
};

const LOOKUP_FIELDS: Array<{
  entityType: CatalogEntityType;
  nameKeys: string[];
  idKey: string;
}> = [
  { entityType: "org_unit", nameKeys: ["org_unit_name"], idKey: "orgUnitId" },
  { entityType: "job_title", nameKeys: ["job_title_name"], idKey: "jobTitleId" },
  { entityType: "job_grade", nameKeys: ["job_grade_name"], idKey: "jobGradeId" },
  { entityType: "position", nameKeys: ["position_title"], idKey: "positionId" },
  { entityType: "work_location", nameKeys: ["work_location"], idKey: "workLocationId" },
];

function stripIgnoredWarning(warnings: string[], rawName: string): string[] {
  return warnings.filter((w) => !(w.includes(`"${rawName}"`) && w.includes("will be ignored")));
}

export async function buildEnterpriseImportPreview(input: {
  workspaceId: number;
  previewRows: LegacyPreviewRow[];
  rawRows: Record<string, string>[];
}): Promise<{ rows: LegacyPreviewRow[]; enterprise: EnterprisePreviewBuckets | null; enterpriseActive: boolean }> {
  const enterpriseActive = await isEnterpriseImportRuntimeActive(input.workspaceId);
  if (!enterpriseActive) {
    return { rows: input.previewRows, enterprise: null, enterpriseActive: false };
  }

  const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId, true);
  const buckets: EnterprisePreviewBuckets = {
    matched: [],
    proposeCreate: [],
    conflicts: [],
    ambiguous: [],
    blocked: [],
    approvalRequired: [],
  };

  const rows: LegacyPreviewRow[] = [];

  for (let i = 0; i < input.previewRows.length; i++) {
    const row = input.previewRows[i]!;
    const raw = input.rawRows[i] ?? {};
    let warnings = [...row.warnings];
    const data = { ...row.data };

    for (const field of LOOKUP_FIELDS) {
      const rawName = field.nameKeys.map((k) => raw[k]).find((v) => v?.trim())?.trim();
      if (!rawName) continue;

      if (field.entityType === "org_unit") data.orgUnitName = rawName;
      if (field.entityType === "job_title") data.jobTitleName = rawName;
      if (field.entityType === "job_grade") data.jobGradeName = rawName;
      if (field.entityType === "position") data.positionTitle = rawName;
      if (field.entityType === "work_location") data.workLocationName = rawName;

      const policy = await getEffectiveEntityPolicy(input.workspaceId, field.entityType);
      const match = reconcileEntityLookup(catalog, field.entityType, rawName);

      if (match.entityId && match.confidence >= 0.85) {
        data[field.idKey] = match.entityId;
        if (field.entityType === "work_location") data.location = match.matchedName ?? rawName;
        buckets.matched.push({ rowIndex: row.rowIndex, entityType: field.entityType, name: rawName, entityId: match.entityId });
        warnings = stripIgnoredWarning(warnings, rawName);
        if (match.matchType === "near") {
          buckets.ambiguous.push({ rowIndex: row.rowIndex, entityType: field.entityType, suggestions: match.suggestions });
          warnings.push(`${field.entityType} "${rawName}" reconciled to "${match.matchedName}" (${match.matchType})`);
        }
        continue;
      }

      if (!policy || policy.autoCreateMode === "disabled") {
        buckets.blocked.push({ rowIndex: row.rowIndex, entityType: field.entityType, reason: "POLICY_DISABLED" });
        continue;
      }

      warnings = stripIgnoredWarning(warnings, rawName);

      if (policy.approvalRequired) {
        buckets.approvalRequired.push({ rowIndex: row.rowIndex, entityType: field.entityType, name: rawName });
        buckets.proposeCreate.push({ rowIndex: row.rowIndex, entityType: field.entityType, name: rawName, approvalRequired: true });
        warnings.push(`${field.entityType} "${rawName}" will be created on confirm when approveEntityCreates=true`);
      } else {
        buckets.proposeCreate.push({ rowIndex: row.rowIndex, entityType: field.entityType, name: rawName, approvalRequired: false });
        warnings.push(`${field.entityType} "${rawName}" will be auto-created on confirm`);
      }
    }

    rows.push({ ...row, warnings, data });
  }

  return { rows, enterprise: buckets, enterpriseActive: true };
}
