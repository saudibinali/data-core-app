/**
 * Phase 3 — Master data import dry-run runtime (no live writes).
 */

import type { MasterDataCatalogSnapshot } from "../catalog/master-data-catalog";
import { normalizeName, normalizeRuntimeKey, canonicalSlug } from "../normalization";
import { topologicalSortOrgUnits, MASTER_DATA_IMPORT_ORDER } from "./dependency-ordering";
import {
  validateMasterDataRowCanonical,
  type CanonicalImportModes,
} from "../validation/canonical-import-gates";

export type MasterDataImportRow = {
  rowNumber: number;
  entityType: string;
  code?: string;
  name: string;
  nameAr?: string;
  parentCode?: string;
  raw: Record<string, string>;
};

export type MasterDataRowValidation = {
  rowNumber: number;
  entityType: string;
  status: "valid" | "warning" | "error";
  errors: string[];
  warnings: string[];
  wouldAction: "create" | "update" | "skip";
  canonicalKey?: string;
};

export type MasterDataDryRunResult = {
  rows: MasterDataRowValidation[];
  dependencyOrder: string[];
  orgOrdering?: ReturnType<typeof topologicalSortOrgUnits>;
  summary: {
    total: number;
    valid: number;
    warnings: number;
    errors: number;
    wouldCreate: number;
    wouldUpdate: number;
  };
};

const ENTITY_ALIASES: Record<string, string> = {
  org_unit: "org_unit",
  org: "org_unit",
  department: "org_unit",
  job_title: "job_title",
  title: "job_title",
  job_grade: "job_grade",
  grade: "job_grade",
  position: "position",
  work_location: "work_location",
  location: "work_location",
  employment_type: "employment_type",
  employee_status: "employee_status",
  status: "employee_status",
  contract_type: "contract_type",
  document_type: "document_type",
};

function normalizeEntityType(raw: string): string | null {
  const k = normalizeRuntimeKey(raw.replace(/\s+/g, "_"));
  return ENTITY_ALIASES[k] ?? (MASTER_DATA_IMPORT_ORDER.includes(k as never) ? k : null);
}

export function validateMasterDataImportDryRun(
  catalog: MasterDataCatalogSnapshot,
  rawRows: Record<string, string>[],
  canonicalModes?: CanonicalImportModes,
): MasterDataDryRunResult {
  const parsed: MasterDataImportRow[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i]!;
    const entityType = normalizeEntityType(r.entity_type ?? r.entityType ?? "");
    if (!entityType) continue;
    parsed.push({
      rowNumber: i + 1,
      entityType,
      code: r.code?.trim() || undefined,
      name: (r.name_en ?? r.name ?? r.nameEn ?? "").trim(),
      nameAr: r.name_ar?.trim(),
      parentCode: r.parent_code?.trim(),
      raw: r,
    });
  }

  const orgRows = parsed
    .filter((p) => p.entityType === "org_unit" && p.code)
    .map((p) => ({ code: p.code!, parentCode: p.parentCode ?? null }));

  const orgOrdering = orgRows.length ? topologicalSortOrgUnits(orgRows) : undefined;

  const results: MasterDataRowValidation[] = parsed.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!row.name && !row.code) errors.push("name or code required");

    if (canonicalModes) {
      const canon = validateMasterDataRowCanonical(row.entityType, canonicalModes);
      errors.push(...canon.errors);
      warnings.push(...canon.warnings);
    }

    const canonicalKey = row.code ?? canonicalSlug(row.name);
    const entityList = catalog.entities[row.entityType as keyof typeof catalog.entities];
    const existing = entityList?.find(
      (e) =>
        (row.code && e.code?.toLowerCase() === row.code.toLowerCase()) ||
        normalizeName(e.name) === normalizeName(row.name),
    );

    if (row.entityType === "org_unit" && row.parentCode) {
      const parentInBatch = orgRows.some((o) => o.code.toLowerCase() === row.parentCode!.toLowerCase());
      const parentInCatalog = catalog.entities.org_unit?.some(
        (o) => o.code?.toLowerCase() === row.parentCode!.toLowerCase(),
      );
      if (!parentInBatch && !parentInCatalog) {
        warnings.push(`parent_code "${row.parentCode}" unresolved (dry-run only)`);
      }
    }

    if (orgOrdering?.cycles.length && row.entityType === "org_unit" && row.code) {
      const inCycle = orgOrdering.cycles.some((c) => c.includes(row.code!.toLowerCase()));
      if (inCycle) errors.push("org unit participates in dependency cycle");
    }

    const wouldAction = existing ? "update" : "create";
    if (wouldAction === "create") {
      warnings.push("would create (simulated — auto-create disabled)");
    }

    return {
      rowNumber: row.rowNumber,
      entityType: row.entityType,
      status: errors.length ? "error" : warnings.length ? "warning" : "valid",
      errors,
      warnings,
      wouldAction: errors.length ? "skip" : wouldAction,
      canonicalKey,
    };
  });

  return {
    rows: results,
    dependencyOrder: [...MASTER_DATA_IMPORT_ORDER],
    orgOrdering,
    summary: {
      total: results.length,
      valid: results.filter((r) => r.status === "valid").length,
      warnings: results.filter((r) => r.status === "warning").length,
      errors: results.filter((r) => r.status === "error").length,
      wouldCreate: results.filter((r) => r.wouldAction === "create").length,
      wouldUpdate: results.filter((r) => r.wouldAction === "update").length,
    },
  };
}
