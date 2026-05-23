/**
 * Phase 5 — Duplicate detection & prevention runtime.
 */

import { canonicalSlug, normalizeName } from "../normalization";
import type { MasterDataCatalogSnapshot, CatalogEntityType } from "../catalog/master-data-catalog";

export type DuplicateHit = {
  entityType: string;
  inputValue: string;
  duplicateKey: string;
  matchType: "code" | "name" | "cross_file";
  existingId?: number;
  rowNumbers: number[];
};

export function buildDuplicateKey(entityType: string, code: string, name: string): string {
  return `${entityType}:${code || canonicalSlug(name)}`.toLowerCase();
}

export function detectCatalogDuplicate(
  catalog: MasterDataCatalogSnapshot,
  entityType: CatalogEntityType,
  code: string,
  name: string,
): { duplicate: boolean; existingId?: number; matchType?: "code" | "name" } {
  const idx = catalog.indexes[entityType];
  if (!idx) return { duplicate: false };

  if (code) {
    const byCode = idx.byCode[code.toLowerCase()] ?? idx.byCode[code];
    if (byCode != null) return { duplicate: true, existingId: byCode, matchType: "code" };
  }

  const byName = idx.byName[normalizeName(name)];
  if (byName != null) return { duplicate: true, existingId: byName, matchType: "name" };

  return { duplicate: false };
}

export function detectCrossFileDuplicates(
  rows: Array<{ rowNumber: number; entityType: string; code: string; name: string }>,
): DuplicateHit[] {
  const seen = new Map<string, DuplicateHit>();

  for (const row of rows) {
    const key = buildDuplicateKey(row.entityType, row.code, row.name);
    const existing = seen.get(key);
    if (existing) {
      existing.rowNumbers.push(row.rowNumber);
      existing.matchType = "cross_file";
    } else {
      seen.set(key, {
        entityType: row.entityType,
        inputValue: row.name,
        duplicateKey: key,
        matchType: "name",
        rowNumbers: [row.rowNumber],
      });
    }
  }

  return [...seen.values()].filter((h) => h.rowNumbers.length > 1);
}

export function detectRuntimeUniquenessViolations(
  catalog: MasterDataCatalogSnapshot,
  rows: Array<{ rowNumber: number; entityType: CatalogEntityType; code: string; name: string }>,
): DuplicateHit[] {
  const hits: DuplicateHit[] = [];

  for (const row of rows) {
    const dup = detectCatalogDuplicate(catalog, row.entityType, row.code, row.name);
    if (dup.duplicate) {
      hits.push({
        entityType: row.entityType,
        inputValue: row.name,
        duplicateKey: buildDuplicateKey(row.entityType, row.code, row.name),
        matchType: dup.matchType ?? "name",
        existingId: dup.existingId,
        rowNumbers: [row.rowNumber],
      });
    }
  }

  return hits;
}
