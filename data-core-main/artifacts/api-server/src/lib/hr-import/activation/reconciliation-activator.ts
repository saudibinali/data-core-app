/**
 * Phase 6 — Reconciliation activation (canonical / normalized / alias matching).
 */

import type { MasterDataCatalogSnapshot, CatalogEntityType } from "../catalog/master-data-catalog";
import { normalizeName, normalizeRuntimeKey, canonicalSlug } from "../normalization";

export type ReconciliationMatch = {
  entityType: CatalogEntityType;
  inputValue: string;
  matchType: "exact" | "canonical" | "normalized" | "alias" | "near" | "none";
  entityId?: number;
  matchedName?: string;
  confidence: number;
  suggestions: string[];
};

function acronymOf(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toLowerCase();
}

function scoreNearMatch(input: string, candidate: string): number {
  const a = normalizeName(input);
  const b = normalizeName(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.replace(/[^a-z0-9]/g, "") === b.replace(/[^a-z0-9]/g, "")) return 0.95;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const acr = acronymOf(candidate);
  const compact = a.replace(/[^a-z0-9]/g, "");
  if (acr.length >= 2 && (compact === acr || acr === compact)) return 0.9;
  return 0;
}

export function reconcileEntityLookup(
  catalog: MasterDataCatalogSnapshot,
  entityType: CatalogEntityType,
  inputValue: string,
): ReconciliationMatch {
  const input = inputValue?.trim() ?? "";
  const suggestions: string[] = [];

  if (!input) {
    return { entityType, inputValue: input, matchType: "none", confidence: 0, suggestions };
  }

  const idx = catalog.indexes[entityType];
  const entries = catalog.entities[entityType] ?? [];

  if (idx) {
    const byName = idx.byName[normalizeName(input)];
    if (byName != null) {
      const e = entries.find((x) => x.id === byName);
      return {
        entityType,
        inputValue: input,
        matchType: "exact",
        entityId: byName,
        matchedName: e?.name,
        confidence: 1,
        suggestions: [],
      };
    }

    const byCode = idx.byCode[normalizeRuntimeKey(input)] ?? idx.byCode[input.toLowerCase()];
    if (byCode != null) {
      const e = entries.find((x) => x.id === byCode);
      return {
        entityType,
        inputValue: input,
        matchType: "canonical",
        entityId: byCode,
        matchedName: e?.name,
        confidence: 1,
        suggestions: [],
      };
    }

    const byAlias =
      idx.byAlias[normalizeRuntimeKey(input)]
      ?? idx.byAlias[normalizeName(input)];
    if (byAlias != null) {
      const e = entries.find((x) => x.id === byAlias);
      return {
        entityType,
        inputValue: input,
        matchType: "alias",
        entityId: byAlias,
        matchedName: e?.name,
        confidence: 0.95,
        suggestions: [],
      };
    }
  }

  let best: { id: number; name: string; score: number } | null = null;
  for (const e of entries) {
    const score = Math.max(
      scoreNearMatch(input, e.name),
      e.nameAr ? scoreNearMatch(input, e.nameAr) : 0,
      e.code ? scoreNearMatch(input, e.code) : 0,
    );
    if (score >= 0.85 && (!best || score > best.score)) {
      best = { id: e.id, name: e.name, score };
    }
    if (score >= 0.85) suggestions.push(e.name);
  }

  if (best) {
    return {
      entityType,
      inputValue: input,
      matchType: "near",
      entityId: best.id,
      matchedName: best.name,
      confidence: best.score,
      suggestions: [...new Set(suggestions)].slice(0, 5),
    };
  }

  return {
    entityType,
    inputValue: input,
    matchType: "none",
    confidence: 0,
    suggestions: [`Proposed create: ${canonicalSlug(input)}`],
  };
}
