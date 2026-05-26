/**
 * Enterprise HR import intelligence — preview + confirm enrichment (always-on, live-safe).
 */

import { masterDataCatalogService } from "../catalog/master-data-catalog";
import type { DynamicEnumLoadResult } from "../catalog/dynamic-enum-loader";
import { reconcileEntityLookup } from "../activation/reconciliation-activator";
import { resolveOrCreateEntity } from "../activation/enterprise-entity-resolver";
import {
  isEnterpriseImportRuntimeActive,
  getEffectiveEntityPolicy,
  type EnterprisePolicyProfile,
} from "../activation/enterprise-runtime-activation";
import { resolveImportEnum, defaultEnumValue, type EnumField } from "./enum-normalizer";
import type { CatalogEntityType } from "../catalog/master-data-catalog";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";
import { getEmployeeImportGovernanceSettings } from "../../hr-foundation/employee-import-governance";

export type PreviewRow = {
  rowIndex: number;
  status: string;
  existingEmployeeId?: number;
  errors: string[];
  warnings: string[];
  data: Record<string, unknown>;
  staged?: boolean;
  mismatchFields?: Array<Record<string, unknown>>;
};

export type ImportIntelligenceBuckets = {
  autoFixes: Array<{ rowIndex: number; field: string; from: string; to: string; matchType: string }>;
  normalizedEnums: Array<{ rowIndex: number; field: string; from: string; to: string }>;
  matchedEntities: Array<{ rowIndex: number; entityType: string; name: string; entityId: number; matchType: string }>;
  proposeCreate: Array<{ rowIndex: number; entityType: string; name: string; approvalRequired: boolean }>;
  deferredManagers: Array<{ rowIndex: number; managerEmployeeNumber: string }>;
  unrecognizedValues: Array<{ rowIndex: number; field: string; value: string }>;
};

const LOOKUP_FIELDS: Array<{ entityType: CatalogEntityType; rawKeys: string[]; nameKey: string; idKey: string }> = [
  { entityType: "org_unit", rawKeys: ["org_unit_name"], nameKey: "orgUnitName", idKey: "orgUnitId" },
  { entityType: "job_title", rawKeys: ["job_title_name"], nameKey: "jobTitleName", idKey: "jobTitleId" },
  { entityType: "job_grade", rawKeys: ["job_grade_name"], nameKey: "jobGradeName", idKey: "jobGradeId" },
  { entityType: "position", rawKeys: ["position_title"], nameKey: "positionTitle", idKey: "positionId" },
  { entityType: "work_location", rawKeys: ["work_location"], nameKey: "workLocationName", idKey: "workLocationId" },
];

/** H1 — disabled by default; match-only import never auto-creates Foundation entities. */
export const IMPORT_INTELLIGENCE_POLICIES: Record<string, EnterprisePolicyProfile> = {
  job_title: { autoCreateMode: "disabled", approvalRequired: false, reconciliationMode: "suggest" },
  job_grade: { autoCreateMode: "disabled", approvalRequired: false, reconciliationMode: "suggest" },
  work_location: { autoCreateMode: "disabled", approvalRequired: false, reconciliationMode: "suggest" },
  org_unit: { autoCreateMode: "disabled", approvalRequired: true, reconciliationMode: "suggest" },
  position: { autoCreateMode: "disabled", approvalRequired: true, reconciliationMode: "suggest" },
};

async function resolveEntityPolicy(workspaceId: number, entityType: string): Promise<EnterprisePolicyProfile | null> {
  const governance = await getEmployeeImportGovernanceSettings(workspaceId);
  if (governance.matchOnly) {
    return { autoCreateMode: "disabled", approvalRequired: false, reconciliationMode: "suggest" };
  }
  const enterprise = await isEnterpriseImportRuntimeActive(workspaceId);
  if (enterprise) {
    return getEffectiveEntityPolicy(workspaceId, entityType);
  }
  return IMPORT_INTELLIGENCE_POLICIES[entityType] ?? null;
}

function stripLegacyIgnoreWarnings(warnings: string[], name: string): string[] {
  return warnings.filter(
    (w) =>
      !(w.includes(`"${name}"`) && (w.includes("will be ignored") || w.includes("not found"))),
  );
}

function applyEnumField(
  row: PreviewRow,
  field: EnumField,
  rawValue: string,
  dataKey: keyof PreviewRow["data"] & string,
  catalog: DynamicEnumLoadResult | undefined,
  buckets: ImportIntelligenceBuckets,
  required = false,
): void {
  if (!rawValue?.trim()) return;

  const resolved = resolveImportEnum(field, rawValue, catalog);
  if (resolved.canonical) {
    (row.data as Record<string, unknown>)[dataKey] = resolved.canonical;
    if (resolved.autoFixed) {
      buckets.autoFixes.push({
        rowIndex: row.rowIndex,
        field,
        from: resolved.original,
        to: resolved.canonical,
        matchType: resolved.matchType,
      });
      buckets.normalizedEnums.push({
        rowIndex: row.rowIndex,
        field,
        from: resolved.original,
        to: resolved.canonical,
      });
      row.warnings.push(`${field} "${resolved.original}" normalized to "${resolved.canonical}"`);
    }
    row.errors = row.errors.filter((e) => !e.includes(field));
    return;
  }

  if (required) {
    buckets.unrecognizedValues.push({ rowIndex: row.rowIndex, field, value: rawValue });
    row.warnings.push(`${field} "${rawValue}" unrecognized — using default "${defaultEnumValue(field) || "skipped"}"`);
    const fallback = defaultEnumValue(field);
    if (fallback) (row.data as Record<string, unknown>)[dataKey] = fallback;
  } else {
    row.warnings.push(`${field} "${rawValue}" unrecognized — left blank`);
  }
}

export async function applyImportPreviewIntelligence(input: {
  workspaceId: number;
  previewRows: PreviewRow[];
  rawRows: Record<string, string>[];
  employmentTypes: DynamicEnumLoadResult;
  statuses: DynamicEnumLoadResult;
}): Promise<{ rows: PreviewRow[]; intelligence: ImportIntelligenceBuckets; proposalSummary: ProposalSummaryItem[] }> {
  const catalog = await masterDataCatalogService.loadSnapshot(input.workspaceId, true);
  const buckets: ImportIntelligenceBuckets = {
    autoFixes: [],
    normalizedEnums: [],
    matchedEntities: [],
    proposeCreate: [],
    deferredManagers: [],
    unrecognizedValues: [],
  };

  const rows: PreviewRow[] = [];

  for (let i = 0; i < input.previewRows.length; i++) {
    const row = { ...input.previewRows[i]!, warnings: [...input.previewRows[i]!.warnings], errors: [...input.previewRows[i]!.errors] };
    const raw = input.rawRows[i] ?? {};
    const data = { ...row.data };

    const empTypeRaw = String(raw.employment_type ?? data.employmentType ?? "").trim();
    const statusRaw = String(raw.status ?? data.status ?? "").trim();
    const genderRaw = String(raw.gender ?? data.gender ?? "").trim();
    const maritalRaw = String(raw.marital_status ?? data.maritalStatus ?? "").trim();

    row.data = data;
    applyEnumField(row, "employment_type", empTypeRaw, "employmentType", input.employmentTypes, buckets, true);
    applyEnumField(row, "employee_status", statusRaw, "status", input.statuses, buckets, true);
    applyEnumField(row, "gender", genderRaw, "gender", undefined, buckets, false);
    applyEnumField(row, "marital_status", maritalRaw, "maritalStatus", undefined, buckets, false);

    if (!data.employmentType) data.employmentType = "full_time";
    if (!data.status) data.status = "active";

    for (const field of LOOKUP_FIELDS) {
      const nameHint =
        field.rawKeys.map((k) => raw[k]?.trim()).find(Boolean)
        ?? String(data[field.nameKey] ?? "").trim();
      if (!nameHint) continue;

      data[field.nameKey] = nameHint;
      if (field.entityType === "work_location") data.workLocationName = nameHint;

      const match = reconcileEntityLookup(catalog, field.entityType, nameHint);
      if (match.entityId && match.confidence >= 0.85) {
        data[field.idKey] = match.entityId;
        if (field.entityType === "work_location") data.location = match.matchedName ?? nameHint;
        buckets.matchedEntities.push({
          rowIndex: row.rowIndex,
          entityType: field.entityType,
          name: nameHint,
          entityId: match.entityId,
          matchType: match.matchType,
        });
        row.warnings = stripLegacyIgnoreWarnings(row.warnings, nameHint);
        if (match.matchType === "near" || match.matchType === "alias") {
          row.warnings.push(`${field.entityType} "${nameHint}" matched to "${match.matchedName}" (${match.matchType})`);
        }
        continue;
      }

      const policy = await resolveEntityPolicy(input.workspaceId, field.entityType);
      row.warnings = stripLegacyIgnoreWarnings(row.warnings, nameHint);

      if (policy && policy.autoCreateMode !== "disabled") {
        buckets.proposeCreate.push({
          rowIndex: row.rowIndex,
          entityType: field.entityType,
          name: nameHint,
          approvalRequired: policy.approvalRequired,
        });
        row.warnings.push(
          policy.approvalRequired
            ? `${field.entityType} "${nameHint}" will be created on confirm if approveEntityCreates=true`
            : `${field.entityType} "${nameHint}" will be auto-created on confirm`,
        );
      } else if (nameHint) {
        const governance = await getEmployeeImportGovernanceSettings(input.workspaceId);
        if (governance.matchOnly) {
          row.errors.push(`MASTER_DATA_NOT_FOUND: ${field.entityType} "${nameHint}" is not in Foundation — row will be archived`);
          row.staged = true;
          row.mismatchFields = [
            ...(row.mismatchFields ?? []),
            { field: field.entityType, value: nameHint, entityType: field.entityType },
          ];
          row.status = "staged";
        } else {
          row.warnings.push(`${field.entityType} "${nameHint}" not matched — import continues without link`);
        }
      }
    }

    const mgrNum = String(data.managerEmployeeNumber ?? raw.direct_manager_num ?? "").trim();
    if (mgrNum) {
      data.managerEmployeeNumber = mgrNum;
      data.deferredManagerEmployeeNumber = mgrNum;
      row.warnings = row.warnings.filter((w) => !w.includes("manager employee_number"));
      row.warnings.push(`manager "${mgrNum}" will be linked on confirm if present (deferred resolution enabled)`);
      buckets.deferredManagers.push({ rowIndex: row.rowIndex, managerEmployeeNumber: mgrNum });
    }

    row.data = data;
    if (row.status === "error" && row.errors.length === 0) {
      row.status = row.existingEmployeeId ? "update" : "new";
    }
    rows.push(row);
  }

  incrementRuntimeMetric("import.intelligence.preview");
  return { rows, intelligence: buckets, proposalSummary: summarizeProposals(buckets) };
}

export type ProposalSummaryItem = {
  entityType: string;
  name: string;
  approvalRequired: boolean;
  rowIndexes: number[];
};

export function summarizeProposals(intelligence: ImportIntelligenceBuckets): ProposalSummaryItem[] {
  const map = new Map<string, ProposalSummaryItem>();
  for (const p of intelligence.proposeCreate) {
    const key = `${p.entityType}::${p.name.trim().toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      if (!existing.rowIndexes.includes(p.rowIndex)) existing.rowIndexes.push(p.rowIndex);
    } else {
      map.set(key, {
        entityType: p.entityType,
        name: p.name,
        approvalRequired: p.approvalRequired,
        rowIndexes: [p.rowIndex],
      });
    }
  }
  return [...map.values()].sort((a, b) => a.entityType.localeCompare(b.entityType) || a.name.localeCompare(b.name));
}

export type ConfirmRow = {
  status: "new" | "update" | "skip";
  existingEmployeeId?: number;
  data: Record<string, unknown>;
};

export async function applyImportConfirmIntelligence(input: {
  workspaceId: number;
  rows: ConfirmRow[];
  approveEntityCreates?: boolean;
  userId?: number;
}): Promise<{ rows: ConfirmRow[]; created: number; queued: number; skipped: number }> {
  const governance = await getEmployeeImportGovernanceSettings(input.workspaceId);
  if (governance.matchOnly) {
    return { rows: input.rows, created: 0, queued: 0, skipped: 0 };
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

    for (const field of LOOKUP_FIELDS) {
      if (data[field.idKey]) continue;
      const nameHint = String(data[field.nameKey] ?? data.location ?? "").trim();
      if (!nameHint) continue;

      const policy = await resolveEntityPolicy(input.workspaceId, field.entityType);
      const match = reconcileEntityLookup(catalog, field.entityType, nameHint);

      if (match.entityId && match.confidence >= 0.85) {
        data[field.idKey] = match.entityId;
        if (field.entityType === "work_location") data.location = match.matchedName ?? nameHint;
        continue;
      }

      const result = await resolveOrCreateEntity({
        workspaceId: input.workspaceId,
        entityType: field.entityType,
        name: nameHint,
        policy,
        approveCreates: input.approveEntityCreates ?? !policy?.approvalRequired,
        userId: input.userId,
      });

      if (!result) continue;
      if (result.action === "created" && result.entityId) {
        data[field.idKey] = result.entityId;
        if (field.entityType === "work_location") data.location = nameHint;
        created++;
        masterDataCatalogService.invalidateCache(input.workspaceId);
      } else if (result.action === "queued_approval") {
        queued++;
      } else if (result.action === "skipped") {
        skipped++;
      }
    }

    resolvedRows.push({ ...row, data });
  }

  incrementRuntimeMetric("import.intelligence.confirm", created);
  return { rows: resolvedRows, created, queued, skipped };
}

export async function applyDeferredManagerLinks(input: {
  workspaceId: number;
  employeeIds: Array<{ employeeId: number; managerEmployeeNumber?: string | null }>;
}): Promise<{ linked: number; pending: number }> {
  if (!input.employeeIds.length) return { linked: 0, pending: 0 };

  const { db, employeesTable } = await import("@workspace/db");
  const { eq, and } = await import("drizzle-orm");

  const allEmps = await db
    .select({ id: employeesTable.id, employeeNumber: employeesTable.employeeNumber })
    .from(employeesTable)
    .where(eq(employeesTable.workspaceId, input.workspaceId));

  const empByNum = new Map(allEmps.map((e) => [String(e.employeeNumber ?? "").toLowerCase(), e.id]));
  let linked = 0;
  let pending = 0;

  for (const item of input.employeeIds) {
    const mgrNum = String(item.managerEmployeeNumber ?? "").trim().toLowerCase();
    if (!mgrNum) continue;
    const managerId = empByNum.get(mgrNum);
    if (!managerId) {
      pending++;
      continue;
    }
    await db
      .update(employeesTable)
      .set({ directManagerId: managerId })
      .where(and(eq(employeesTable.id, item.employeeId), eq(employeesTable.workspaceId, input.workspaceId)));
    linked++;
  }

  return { linked, pending };
}
