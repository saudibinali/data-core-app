/**
 * Mapping resolution foundation (read-only, Phase 1).
 */

import type { MasterDataCatalogSnapshot, CatalogEntityType } from "../catalog/master-data-catalog";
import { normalizeName } from "../normalization";

export type LookupResolution = {
  entityType: CatalogEntityType;
  inputValue: string;
  resolvedId?: number;
  resolved: boolean;
  strategy: "name" | "code" | "none";
};

export type MappingResolutionBatch = {
  resolutions: LookupResolution[];
  unresolvedCount: number;
  resolvedCount: number;
};

export function resolveCatalogLookup(
  snapshot: MasterDataCatalogSnapshot,
  entityType: CatalogEntityType,
  value: string,
): LookupResolution {
  const inputValue = value?.trim() ?? "";
  if (!inputValue) {
    return { entityType, inputValue, resolved: false, strategy: "none" };
  }

  const idx = snapshot.indexes[entityType];
  if (!idx) {
    return { entityType, inputValue, resolved: false, strategy: "none" };
  }

  const byName = normalizeName(inputValue);
  const byNameId = idx.byName[byName];
  if (byNameId != null) {
    return { entityType, inputValue, resolvedId: byNameId, resolved: true, strategy: "name" };
  }

  const byCodeId = idx.byCode[inputValue.toLowerCase()] ?? idx.byCode[inputValue];
  if (byCodeId != null) {
    return { entityType, inputValue, resolvedId: byCodeId, resolved: true, strategy: "code" };
  }

  return { entityType, inputValue, resolved: false, strategy: "none" };
}

export function resolveEmployeeImportLookups(
  snapshot: MasterDataCatalogSnapshot,
  fields: {
    orgUnitName?: string;
    jobTitleName?: string;
    jobGradeName?: string;
    positionTitle?: string;
    workLocationName?: string;
  },
): MappingResolutionBatch {
  const resolutions: LookupResolution[] = [
    resolveCatalogLookup(snapshot, "org_unit", fields.orgUnitName ?? ""),
    resolveCatalogLookup(snapshot, "job_title", fields.jobTitleName ?? ""),
    resolveCatalogLookup(snapshot, "job_grade", fields.jobGradeName ?? ""),
    resolveCatalogLookup(snapshot, "position", fields.positionTitle ?? ""),
    resolveCatalogLookup(snapshot, "work_location", fields.workLocationName ?? ""),
  ];

  const resolvedCount = resolutions.filter((r) => r.resolved).length;
  return {
    resolutions,
    resolvedCount,
    unresolvedCount: resolutions.filter((r) => r.inputValue && !r.resolved).length,
  };
}
