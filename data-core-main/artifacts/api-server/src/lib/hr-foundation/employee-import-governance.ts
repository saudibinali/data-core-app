/**
 * H1/H5/H6 — Employee import governance (match-only, readiness gate, staging).
 */

import {
  db,
  hrWorkspaceSettingsTable,
  hrEmploymentTypesTable,
  hrEmployeeStatusesTable,
  hrOrgUnitsTable,
  hrJobGradesTable,
  hrJobTitlesTable,
  hrWorkLocationsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export type EmployeeImportGovernanceSettings = {
  matchOnly: boolean;
  stagingEnabled: boolean;
  readinessGateEnabled: boolean;
};

export type FoundationReadinessItem = {
  key: string;
  labelEn: string;
  labelAr: string;
  required: boolean;
  count: number;
  satisfied: boolean;
};

export type FoundationReadinessReport = {
  ready: boolean;
  requiredComplete: number;
  requiredTotal: number;
  items: FoundationReadinessItem[];
  missingRequired: string[];
};

export type MasterDataMismatch = {
  field: string;
  labelEn: string;
  labelAr: string;
  value: string;
  entityType: string;
  code?: string;
};

const REQUIRED_FOUNDATION: Array<{
  key: string;
  labelEn: string;
  labelAr: string;
  table: typeof hrEmploymentTypesTable | typeof hrEmployeeStatusesTable | typeof hrOrgUnitsTable | typeof hrJobGradesTable | typeof hrJobTitlesTable | typeof hrWorkLocationsTable;
}> = [
  { key: "employment_types", labelEn: "Employment types", labelAr: "أنواع التوظيف", table: hrEmploymentTypesTable },
  { key: "employee_statuses", labelEn: "Employee statuses", labelAr: "حالات الموظف", table: hrEmployeeStatusesTable },
  { key: "org_units", labelEn: "Org units", labelAr: "الوحدات التنظيمية", table: hrOrgUnitsTable },
  { key: "job_grades", labelEn: "Job grades", labelAr: "الدرجات الوظيفية", table: hrJobGradesTable },
  { key: "job_titles", labelEn: "Job titles", labelAr: "المسميات الوظيفية", table: hrJobTitlesTable },
  { key: "work_locations", labelEn: "Work locations", labelAr: "مواقع العمل", table: hrWorkLocationsTable },
];

export async function getEmployeeImportGovernanceSettings(
  workspaceId: number,
): Promise<EmployeeImportGovernanceSettings> {
  try {
    const [row] = await db
      .select({
        matchOnly: hrWorkspaceSettingsTable.employeeImportMatchOnly,
        stagingEnabled: hrWorkspaceSettingsTable.employeeImportStagingEnabled,
        readinessGateEnabled: hrWorkspaceSettingsTable.foundationReadinessGateEnabled,
      })
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId));

    return {
      matchOnly: row?.matchOnly ?? true,
      stagingEnabled: row?.stagingEnabled ?? true,
      readinessGateEnabled: row?.readinessGateEnabled ?? true,
    };
  } catch {
    return { matchOnly: true, stagingEnabled: true, readinessGateEnabled: true };
  }
}

export async function evaluateFoundationReadiness(workspaceId: number): Promise<FoundationReadinessReport> {
  const items: FoundationReadinessItem[] = [];

  for (const req of REQUIRED_FOUNDATION) {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(req.table)
      .where(and(eq(req.table.workspaceId, workspaceId), eq(req.table.isActive, true)));

    const count = result?.count ?? 0;
    items.push({
      key: req.key,
      labelEn: req.labelEn,
      labelAr: req.labelAr,
      required: true,
      count,
      satisfied: count >= 1,
    });
  }

  const missingRequired = items.filter((i) => i.required && !i.satisfied).map((i) => i.key);
  const requiredTotal = items.filter((i) => i.required).length;
  const requiredComplete = items.filter((i) => i.required && i.satisfied).length;

  return {
    ready: missingRequired.length === 0,
    requiredComplete,
    requiredTotal,
    items,
    missingRequired,
  };
}

export async function assertFoundationReadinessForImport(workspaceId: number): Promise<void> {
  const settings = await getEmployeeImportGovernanceSettings(workspaceId);
  if (!settings.readinessGateEnabled) return;

  const report = await evaluateFoundationReadiness(workspaceId);
  if (!report.ready) {
    const err = new Error("Foundation data is incomplete — complete HR Foundation before importing employees");
    (err as Error & { code: string; readiness: FoundationReadinessReport }).code = "FOUNDATION_NOT_READY";
    (err as Error & { code: string; readiness: FoundationReadinessReport }).readiness = report;
    throw err;
  }
}

export type MasterDataLookupMaps = {
  orgByName: Map<string, number>;
  orgByCode: Map<string, number>;
  jtByName: Map<string, number>;
  jtByCode: Map<string, number>;
  jgByName: Map<string, number>;
  jgByCode: Map<string, number>;
  posByName: Map<string, number>;
  posByCode: Map<string, number>;
  wlByName: Map<string, number>;
  wlByCode: Map<string, number>;
};

export function buildMasterDataLookupMaps(input: {
  orgUnits: Array<{ id: number; name: string; code?: string | null }>;
  jobTitles: Array<{ id: number; name: string; code?: string | null }>;
  jobGrades: Array<{ id: number; name: string; code?: string | null }>;
  positions: Array<{ id: number; title: string; code?: string | null }>;
  workLocations: Array<{ id: number; name: string; code?: string | null }>;
}): MasterDataLookupMaps {
  const norm = (v: string) => v.trim().toLowerCase();
  const byCode = <T extends { id: number; code?: string | null }>(rows: T[]) =>
    new Map(rows.filter((r) => r.code).map((r) => [norm(String(r.code)), r.id]));
  const byName = <T extends { id: number; name: string }>(rows: T[]) =>
    new Map(rows.map((r) => [norm(r.name), r.id]));
  const posByName = new Map(input.positions.map((p) => [norm(p.title), p.id]));

  return {
    orgByName: byName(input.orgUnits),
    orgByCode: byCode(input.orgUnits),
    jtByName: byName(input.jobTitles),
    jtByCode: byCode(input.jobTitles),
    jgByName: byName(input.jobGrades),
    jgByCode: byCode(input.jobGrades),
    posByName,
    posByCode: byCode(input.positions),
    wlByName: byName(input.workLocations),
    wlByCode: byCode(input.workLocations),
  };
}

export function detectMasterDataMismatches(input: {
  orgName?: string;
  orgCode?: string;
  jtName?: string;
  jtCode?: string;
  jgName?: string;
  jgCode?: string;
  posName?: string;
  posCode?: string;
  wlName?: string;
  wlCode?: string;
  maps: MasterDataLookupMaps;
}): MasterDataMismatch[] {
  const mismatches: MasterDataMismatch[] = [];
  const { maps } = input;
  const norm = (v: string) => v.trim().toLowerCase();

  const check = (
    entityType: string,
    field: string,
    labelEn: string,
    labelAr: string,
    code: string | undefined,
    name: string | undefined,
    byCode: Map<string, number>,
    byName: Map<string, number>,
  ) => {
    const codeVal = code?.trim();
    const nameVal = name?.trim();
    if (!codeVal && !nameVal) return;

    if (codeVal) {
      if (!byCode.has(norm(codeVal))) {
        mismatches.push({
          field,
          labelEn,
          labelAr,
          value: codeVal,
          entityType,
          code: codeVal,
        });
      }
      return;
    }

    if (nameVal && !byName.has(norm(nameVal))) {
      mismatches.push({
        field,
        labelEn,
        labelAr,
        value: nameVal,
        entityType,
      });
    }
  };

  check("org_unit", "org_unit_code", "Org unit", "الوحدة التنظيمية", input.orgCode, input.orgName, maps.orgByCode, maps.orgByName);
  check("job_title", "job_title_code", "Job title", "المسمى الوظيفي", input.jtCode, input.jtName, maps.jtByCode, maps.jtByName);
  check("job_grade", "job_grade_code", "Job grade", "الدرجة الوظيفية", input.jgCode, input.jgName, maps.jgByCode, maps.jgByName);
  check("position", "position_code", "Position", "المنصب", input.posCode, input.posName, maps.posByCode, maps.posByName);
  check("work_location", "work_location_code", "Work location", "موقع العمل", input.wlCode, input.wlName, maps.wlByCode, maps.wlByName);

  return mismatches;
}

export function resolveMasterDataIds(input: {
  orgName?: string;
  orgCode?: string;
  jtName?: string;
  jtCode?: string;
  jgName?: string;
  jgCode?: string;
  posName?: string;
  posCode?: string;
  wlName?: string;
  wlCode?: string;
  maps: MasterDataLookupMaps;
}): {
  orgUnitId?: number;
  jobTitleId?: number;
  jobGradeId?: number;
  positionId?: number;
  workLocationId?: number;
  workLocationName?: string;
} {
  const norm = (v: string) => v.trim().toLowerCase();
  const { maps } = input;

  const pick = (
    code: string | undefined,
    name: string | undefined,
    byCode: Map<string, number>,
    byName: Map<string, number>,
  ) => {
    const codeVal = code?.trim();
    const nameVal = name?.trim();
    if (codeVal && byCode.has(norm(codeVal))) return byCode.get(norm(codeVal));
    if (nameVal && byName.has(norm(nameVal))) return byName.get(norm(nameVal));
    return undefined;
  };

  const orgUnitId = pick(input.orgCode, input.orgName, maps.orgByCode, maps.orgByName);
  const jobTitleId = pick(input.jtCode, input.jtName, maps.jtByCode, maps.jtByName);
  const jobGradeId = pick(input.jgCode, input.jgName, maps.jgByCode, maps.jgByName);
  const positionId = pick(input.posCode, input.posName, maps.posByCode, maps.posByName);
  const workLocationId = pick(input.wlCode, input.wlName, maps.wlByCode, maps.wlByName);

  let workLocationName: string | undefined;
  if (input.wlName?.trim()) workLocationName = input.wlName.trim();
  else if (input.wlCode?.trim() && workLocationId) workLocationName = input.wlCode.trim();

  return { orgUnitId, jobTitleId, jobGradeId, positionId, workLocationId, workLocationName };
}
