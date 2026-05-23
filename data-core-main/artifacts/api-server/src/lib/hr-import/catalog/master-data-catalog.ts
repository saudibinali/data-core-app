/**
 * Phase 2 — Expanded read-only master data catalog.
 */

import { db } from "@workspace/db";
import {
  hrOrgUnitsTable,
  hrJobTitlesTable,
  hrJobGradesTable,
  hrPositionsTable,
  hrWorkLocationsTable,
  hrEmploymentTypesTable,
  hrEmployeeStatusesTable,
  hrContractTypesTable,
  hrDocumentTypesTable,
  hrLeavePoliciesTable,
  hrProbationPoliciesTable,
  hrMasterDataRegistryTable,
  hrCustomFieldDefsTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { normalizeName, normalizeRuntimeKey } from "../normalization";

export type CatalogEntityType =
  | "org_unit"
  | "job_title"
  | "job_grade"
  | "position"
  | "work_location"
  | "employment_type"
  | "employee_status"
  | "contract_type"
  | "document_type"
  | "leave_policy"
  | "probation_policy";

export type CatalogEntry = {
  id: number;
  code?: string | null;
  name: string;
  nameAr?: string | null;
  normalizedName: string;
  normalizedCode?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
};

export type CustomFieldDropdownCatalog = {
  fieldDefId: number;
  fieldName: string;
  label: string;
  labelAr?: string | null;
  options: Array<{ value: string; label: string; normalizedValue: string }>;
};

export type CatalogIndexes = {
  byName: Record<string, number>;
  byCode: Record<string, number>;
  byAlias: Record<string, number>;
};

export type MasterDataCatalogSnapshot = {
  workspaceId: number;
  generatedAt: string;
  cacheHit: boolean;
  entities: Partial<Record<CatalogEntityType, CatalogEntry[]>>;
  customFieldDropdowns: CustomFieldDropdownCatalog[];
  registry: Array<{
    entityType: string;
    autoCreatePolicy: string;
    isRuntimeSensitive: boolean;
  }>;
  indexes: Partial<Record<CatalogEntityType, CatalogIndexes>>;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<number, { at: number; snapshot: MasterDataCatalogSnapshot }>();
let catalogMissCount = 0;
let catalogHitCount = 0;

export function getCatalogCacheStats(): { hits: number; misses: number } {
  return { hits: catalogHitCount, misses: catalogMissCount };
}

function mapEntry(
  row: { id: number; name: string; nameAr?: string | null; code?: string | null; isActive?: boolean },
  extra?: Record<string, unknown>,
): CatalogEntry {
  return {
    id: row.id,
    code: row.code ?? null,
    name: row.name,
    nameAr: row.nameAr ?? null,
    normalizedName: normalizeName(row.name),
    normalizedCode: row.code ? normalizeRuntimeKey(row.code) : undefined,
    isActive: row.isActive,
    metadata: extra,
  };
}

function buildIndexes(entries: CatalogEntry[]): CatalogIndexes {
  const byName: Record<string, number> = {};
  const byCode: Record<string, number> = {};
  const byAlias: Record<string, number> = {};
  for (const e of entries) {
    if (e.normalizedName) byName[e.normalizedName] = e.id;
    if (e.nameAr) byAlias[normalizeName(e.nameAr)] = e.id;
    if (e.normalizedCode) byCode[e.normalizedCode] = e.id;
    if (e.code) {
      byCode[normalizeRuntimeKey(e.code)] = e.id;
      byCode[e.code] = e.id;
    }
  }
  return { byName, byCode, byAlias };
}

function parseCustomFieldOptions(
  field: { id: number; name: string; label: string; labelAr?: string | null; options: unknown },
): CustomFieldDropdownCatalog | null {
  const raw = field.options;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const options = raw
    .map((o) => {
      const item = o as { value?: string; label?: string };
      const value = String(item.value ?? item.label ?? "").trim();
      if (!value) return null;
      return {
        value,
        label: String(item.label ?? value),
        normalizedValue: normalizeRuntimeKey(value),
      };
    })
    .filter(Boolean) as CustomFieldDropdownCatalog["options"];
  if (!options.length) return null;
  return {
    fieldDefId: field.id,
    fieldName: field.name,
    label: field.label,
    labelAr: field.labelAr,
    options,
  };
}

export class MasterDataCatalogService {
  async loadSnapshot(workspaceId: number, bypassCache = false): Promise<MasterDataCatalogSnapshot> {
    const cached = cache.get(workspaceId);
    if (!bypassCache && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      catalogHitCount++;
      return { ...cached.snapshot, cacheHit: true };
    }
    catalogMissCount++;

    const [
      orgUnits,
      jobTitles,
      jobGrades,
      positions,
      workLocations,
      employmentTypes,
      statuses,
      contractTypes,
      documentTypes,
      leavePolicies,
      probationPolicies,
      registry,
      customFields,
    ] = await Promise.all([
      db.select().from(hrOrgUnitsTable).where(eq(hrOrgUnitsTable.workspaceId, workspaceId)).orderBy(asc(hrOrgUnitsTable.name)),
      db.select().from(hrJobTitlesTable).where(eq(hrJobTitlesTable.workspaceId, workspaceId)).orderBy(asc(hrJobTitlesTable.name)),
      db.select().from(hrJobGradesTable).where(eq(hrJobGradesTable.workspaceId, workspaceId)).orderBy(asc(hrJobGradesTable.name)),
      db.select().from(hrPositionsTable).where(eq(hrPositionsTable.workspaceId, workspaceId)).orderBy(asc(hrPositionsTable.title)),
      db.select().from(hrWorkLocationsTable).where(and(eq(hrWorkLocationsTable.workspaceId, workspaceId), eq(hrWorkLocationsTable.isActive, true))).orderBy(asc(hrWorkLocationsTable.name)),
      db.select().from(hrEmploymentTypesTable).where(and(eq(hrEmploymentTypesTable.workspaceId, workspaceId), eq(hrEmploymentTypesTable.isActive, true))),
      db.select().from(hrEmployeeStatusesTable).where(and(eq(hrEmployeeStatusesTable.workspaceId, workspaceId), eq(hrEmployeeStatusesTable.isActive, true))),
      db.select().from(hrContractTypesTable).where(and(eq(hrContractTypesTable.workspaceId, workspaceId), eq(hrContractTypesTable.isActive, true))),
      db.select().from(hrDocumentTypesTable).where(and(eq(hrDocumentTypesTable.workspaceId, workspaceId), eq(hrDocumentTypesTable.isActive, true))),
      db.select().from(hrLeavePoliciesTable).where(and(eq(hrLeavePoliciesTable.workspaceId, workspaceId), eq(hrLeavePoliciesTable.isActive, true))),
      db.select().from(hrProbationPoliciesTable).where(and(eq(hrProbationPoliciesTable.workspaceId, workspaceId), eq(hrProbationPoliciesTable.isActive, true))),
      db.select().from(hrMasterDataRegistryTable).where(eq(hrMasterDataRegistryTable.workspaceId, workspaceId)),
      db
        .select()
        .from(hrCustomFieldDefsTable)
        .where(and(eq(hrCustomFieldDefsTable.workspaceId, workspaceId), eq(hrCustomFieldDefsTable.isActive, true)))
        .orderBy(asc(hrCustomFieldDefsTable.displayOrder)),
    ]);

    const customFieldDropdowns = customFields
      .filter((f) => f.fieldType === "dropdown" || f.fieldType === "multi_select")
      .map(parseCustomFieldOptions)
      .filter((x): x is CustomFieldDropdownCatalog => x != null);

    const entities: MasterDataCatalogSnapshot["entities"] = {
      org_unit: orgUnits.filter((o) => o.isActive !== false).map((o) =>
        mapEntry({ id: o.id, name: o.name, nameAr: o.nameAr, code: o.code, isActive: o.isActive }, { type: o.type, parentId: o.parentId }),
      ),
      job_title: jobTitles.map((j) => mapEntry(j, { gradeId: j.gradeId })),
      job_grade: jobGrades.map((g) => mapEntry(g, { level: g.level })),
      position: positions.filter((p) => p.isActive !== false && p.status !== "archived").map((p) =>
        mapEntry({ id: p.id, name: p.title, nameAr: p.titleAr, code: p.code }, {
          orgUnitId: p.orgUnitId,
          jobTitleId: p.jobTitleId,
          status: p.status,
        }),
      ),
      work_location: workLocations.map((w) => mapEntry(w, { type: w.type })),
      employment_type: employmentTypes.map((e) => mapEntry(e)),
      employee_status: statuses.map((s) => mapEntry(s, { isFinal: s.isFinal })),
      contract_type: contractTypes.map((c) => mapEntry(c)),
      document_type: documentTypes.map((d) => mapEntry({ id: d.id, name: d.name, nameAr: d.nameAr, code: d.code, isActive: d.isActive })),
      leave_policy: leavePolicies.map((l) => mapEntry(l, { leaveType: l.leaveType })),
      probation_policy: probationPolicies.map((p) => mapEntry(p, { durationDays: p.durationDays })),
    };

    const indexes: MasterDataCatalogSnapshot["indexes"] = {};
    for (const [key, list] of Object.entries(entities) as [CatalogEntityType, CatalogEntry[]][]) {
      if (list?.length) indexes[key] = buildIndexes(list);
    }

    const snapshot: MasterDataCatalogSnapshot = {
      workspaceId,
      generatedAt: new Date().toISOString(),
      cacheHit: false,
      entities,
      customFieldDropdowns,
      registry: registry.map((r) => ({
        entityType: r.entityType,
        autoCreatePolicy: r.autoCreatePolicy,
        isRuntimeSensitive: r.isRuntimeSensitive,
      })),
      indexes,
    };

    cache.set(workspaceId, { at: Date.now(), snapshot });
    return snapshot;
  }

  async getEntitySlice(workspaceId: number, entityType: CatalogEntityType) {
    const snapshot = await this.loadSnapshot(workspaceId);
    return {
      entityType,
      generatedAt: snapshot.generatedAt,
      entries: snapshot.entities[entityType] ?? [],
      index: snapshot.indexes[entityType] ?? { byName: {}, byCode: {}, byAlias: {} },
    };
  }

  resolveByNameOrCode(
    snapshot: MasterDataCatalogSnapshot,
    entityType: CatalogEntityType,
    value: string,
  ): number | undefined {
    if (!value?.trim()) return undefined;
    const idx = snapshot.indexes[entityType];
    if (!idx) return undefined;
    const nName = normalizeName(value);
    const nCode = normalizeRuntimeKey(value);
    return idx.byName[nName] ?? idx.byCode[nCode] ?? idx.byCode[value] ?? idx.byAlias[nName];
  }

  invalidateCache(workspaceId: number): void {
    cache.delete(workspaceId);
  }
}

export function isValidCustomFieldDropdownValue(dropdown: CustomFieldDropdownCatalog, value: string): boolean {
  if (!value?.trim()) return true;
  const n = normalizeRuntimeKey(value);
  return dropdown.options.some(
    (o) => o.value === value || o.normalizedValue === n || normalizeName(o.label) === normalizeName(value),
  );
}

export const masterDataCatalogService = new MasterDataCatalogService();
