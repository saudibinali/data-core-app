/**
 * Phase 5 — Master data diff & reconciliation runtime (report only).
 */

import type { MasterDataCatalogSnapshot, CatalogEntityType } from "../catalog/master-data-catalog";
import { normalizeName, canonicalSlug } from "../normalization";
import { detectCatalogDuplicate } from "../auto-create/duplicate-prevention";
import type { MasterDataRowValidation } from "../execution/master-data-import-runtime";

export type ReconciliationItem = {
  rowNumber: number;
  entityType: string;
  inputName: string;
  inputCode?: string;
  canonicalKey: string;
  matchStatus: "existing" | "missing" | "conflict" | "duplicate" | "blocked";
  existingId?: number;
  suggestions: string[];
  autoMergeEnabled: false;
};

export type ReconciliationReport = {
  sessionId: number;
  items: ReconciliationItem[];
  summary: {
    total: number;
    existing: number;
    missing: number;
    conflicts: number;
    duplicates: number;
    blocked: number;
  };
  reconciliationMode: "report_only";
  automaticMerge: false;
};

const BLOCKED_TYPES = new Set(["org_unit", "employee_status", "employment_type", "contract_type"]);

export function buildReconciliationReport(input: {
  sessionId: number;
  catalog: MasterDataCatalogSnapshot;
  rows: MasterDataRowValidation[];
  rawRows: Record<string, string>[];
}): ReconciliationReport {
  const items: ReconciliationItem[] = [];

  for (const row of input.rows) {
    const raw = input.rawRows[row.rowNumber - 1] ?? {};
    const name = String(raw.name_en ?? raw.name ?? raw.nameEn ?? row.canonicalKey ?? "").trim();
    const code = String(raw.code ?? "").trim();
    const entityType = row.entityType;
    const canonicalKey = row.canonicalKey ?? (code || canonicalSlug(name));

    if (BLOCKED_TYPES.has(entityType)) {
      items.push({
        rowNumber: row.rowNumber,
        entityType,
        inputName: name,
        inputCode: code,
        canonicalKey,
        matchStatus: "blocked",
        suggestions: ["Entity type blocked from auto-create/reconciliation"],
        autoMergeEnabled: false,
      });
      continue;
    }

    if (entityType === "position") {
      items.push({
        rowNumber: row.rowNumber,
        entityType,
        inputName: name,
        inputCode: code,
        canonicalKey,
        matchStatus: "missing",
        suggestions: ["Position commit remains dry-run only in Phase 5"],
        autoMergeEnabled: false,
      });
      continue;
    }

    const dup = detectCatalogDuplicate(input.catalog, entityType as CatalogEntityType, code, name);
    const suggestions: string[] = [];

    if (dup.duplicate && dup.existingId) {
      const existing = input.catalog.entities[entityType as CatalogEntityType]?.find((e) => e.id === dup.existingId);
      if (existing && normalizeName(existing.name) !== normalizeName(name)) {
        items.push({
          rowNumber: row.rowNumber,
          entityType,
          inputName: name,
          inputCode: code,
          canonicalKey,
          matchStatus: "conflict",
          existingId: dup.existingId,
          suggestions: [`Canonical name mismatch vs existing "${existing.name}"`, "Review before update commit"],
          autoMergeEnabled: false,
        });
      } else {
        items.push({
          rowNumber: row.rowNumber,
          entityType,
          inputName: name,
          inputCode: code,
          canonicalKey,
          matchStatus: "existing",
          existingId: dup.existingId,
          suggestions: ["Use existing entity; no auto-create required"],
          autoMergeEnabled: false,
        });
      }
      continue;
    }

    if (row.wouldAction === "create") {
      suggestions.push("Missing entity — enable controlled auto-create with approval if policy allows");
    }

    items.push({
      rowNumber: row.rowNumber,
      entityType,
      inputName: name,
      inputCode: code,
      canonicalKey,
      matchStatus: row.wouldAction === "create" ? "missing" : "existing",
      suggestions,
      autoMergeEnabled: false,
    });
  }

  const summary = {
    total: items.length,
    existing: items.filter((i) => i.matchStatus === "existing").length,
    missing: items.filter((i) => i.matchStatus === "missing").length,
    conflicts: items.filter((i) => i.matchStatus === "conflict").length,
    duplicates: items.filter((i) => i.matchStatus === "duplicate").length,
    blocked: items.filter((i) => i.matchStatus === "blocked").length,
  };

  return {
    sessionId: input.sessionId,
    items,
    summary,
    reconciliationMode: "report_only",
    automaticMerge: false,
  };
}
