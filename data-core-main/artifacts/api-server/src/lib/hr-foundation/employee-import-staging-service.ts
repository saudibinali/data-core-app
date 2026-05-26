/**
 * H6 — Employee import staging archive (unmatched master data rows).
 */

import {
  db,
  hrEmployeeImportStagingTable,
  employeesTable,
  hrCustomFieldDefsTable,
  hrCustomFieldValuesTable,
  hrOrgUnitsTable,
  hrJobTitlesTable,
  hrJobGradesTable,
  hrPositionsTable,
  hrWorkLocationsTable,
  type HrEmployeeImportStagingRow,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  assertFoundationReadinessForImport,
  buildMasterDataLookupMaps,
  detectMasterDataMismatches,
  getEmployeeImportGovernanceSettings,
  resolveMasterDataIds,
} from "./employee-import-governance";
import { generateEmployeeNumber } from "../employeeNumber";

export type StagingRowInput = {
  rowIndex: number;
  rawRow?: Record<string, string>;
  normalizedRow: Record<string, unknown>;
  mismatchFields: Array<Record<string, unknown>>;
  errors: string[];
  warnings: string[];
  existingEmployeeId?: number;
  intendedStatus: "new" | "update";
};

export async function insertStagingBatch(input: {
  workspaceId: number;
  batchId?: string;
  rows: StagingRowInput[];
  reviewedByUserId?: number;
}): Promise<{ batchId: string; inserted: number; ids: number[] }> {
  const batchId = input.batchId ?? randomUUID();
  if (!input.rows.length) return { batchId, inserted: 0, ids: [] };

  const inserted = await db
    .insert(hrEmployeeImportStagingTable)
    .values(
      input.rows.map((r) => ({
        workspaceId: input.workspaceId,
        batchId,
        rowIndex: r.rowIndex,
        status: "field_mismatch",
        rawRow: r.rawRow ?? null,
        normalizedRow: r.normalizedRow,
        mismatchFields: r.mismatchFields,
        errors: r.errors,
        warnings: r.warnings,
        existingEmployeeId: r.existingEmployeeId ?? null,
        reviewedByUserId: input.reviewedByUserId ?? null,
      })),
    )
    .returning({ id: hrEmployeeImportStagingTable.id });

  return { batchId, inserted: inserted.length, ids: inserted.map((r) => r.id) };
}

export async function listStagingRows(input: {
  workspaceId: number;
  status?: string;
  batchId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: HrEmployeeImportStagingRow[]; total: number }> {
  const limit = Math.min(input.limit ?? 50, 200);
  const offset = input.offset ?? 0;
  const conditions = [eq(hrEmployeeImportStagingTable.workspaceId, input.workspaceId)];
  if (input.status) conditions.push(eq(hrEmployeeImportStagingTable.status, input.status));
  if (input.batchId) conditions.push(eq(hrEmployeeImportStagingTable.batchId, input.batchId));

  const where = and(...conditions);

  const [rows, [countRow]] = await Promise.all([
    db
      .select()
      .from(hrEmployeeImportStagingTable)
      .where(where)
      .orderBy(desc(hrEmployeeImportStagingTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(hrEmployeeImportStagingTable)
      .where(where),
  ]);

  return { rows, total: countRow?.count ?? 0 };
}

export async function getStagingRow(
  workspaceId: number,
  id: number,
): Promise<HrEmployeeImportStagingRow | null> {
  const [row] = await db
    .select()
    .from(hrEmployeeImportStagingTable)
    .where(and(eq(hrEmployeeImportStagingTable.workspaceId, workspaceId), eq(hrEmployeeImportStagingTable.id, id)));
  return row ?? null;
}

async function loadLookupMaps(workspaceId: number) {
  const [ous, jts, jgs, pos, wls] = await Promise.all([
    db.select({ id: hrOrgUnitsTable.id, name: hrOrgUnitsTable.name, code: hrOrgUnitsTable.code })
      .from(hrOrgUnitsTable).where(eq(hrOrgUnitsTable.workspaceId, workspaceId)),
    db.select({ id: hrJobTitlesTable.id, name: hrJobTitlesTable.name, code: hrJobTitlesTable.code })
      .from(hrJobTitlesTable).where(eq(hrJobTitlesTable.workspaceId, workspaceId)),
    db.select({ id: hrJobGradesTable.id, name: hrJobGradesTable.name, code: hrJobGradesTable.code })
      .from(hrJobGradesTable).where(eq(hrJobGradesTable.workspaceId, workspaceId)),
    db.select({ id: hrPositionsTable.id, title: hrPositionsTable.title, code: hrPositionsTable.code })
      .from(hrPositionsTable).where(eq(hrPositionsTable.workspaceId, workspaceId)),
    db.select({ id: hrWorkLocationsTable.id, name: hrWorkLocationsTable.name, code: hrWorkLocationsTable.code })
      .from(hrWorkLocationsTable).where(eq(hrWorkLocationsTable.workspaceId, workspaceId)),
  ]);

  return buildMasterDataLookupMaps({
    orgUnits: ous,
    jobTitles: jts,
    jobGrades: jgs,
    positions: pos,
    workLocations: wls,
  });
}

export async function patchStagingRow(input: {
  workspaceId: number;
  id: number;
  normalizedRow?: Record<string, unknown>;
  userId?: number;
}): Promise<HrEmployeeImportStagingRow | null> {
  const existing = await getStagingRow(input.workspaceId, input.id);
  if (!existing || existing.status === "promoted") return null;

  const normalizedRow = { ...(existing.normalizedRow as Record<string, unknown>), ...(input.normalizedRow ?? {}) };
  const maps = await loadLookupMaps(input.workspaceId);
  const d = normalizedRow;

  const mismatches = detectMasterDataMismatches({
    orgName: String(d.orgUnitName ?? ""),
    orgCode: String(d.orgUnitCode ?? d.org_unit_code ?? ""),
    jtName: String(d.jobTitleName ?? ""),
    jtCode: String(d.jobTitleCode ?? d.job_title_code ?? ""),
    jgName: String(d.jobGradeName ?? ""),
    jgCode: String(d.jobGradeCode ?? d.job_grade_code ?? ""),
    posName: String(d.positionTitle ?? ""),
    posCode: String(d.positionCode ?? d.position_code ?? ""),
    wlName: String(d.workLocationName ?? d.location ?? ""),
    wlCode: String(d.workLocationCode ?? d.work_location_code ?? ""),
    maps,
  });

  const resolved = resolveMasterDataIds({
    orgName: String(d.orgUnitName ?? ""),
    orgCode: String(d.orgUnitCode ?? d.org_unit_code ?? ""),
    jtName: String(d.jobTitleName ?? ""),
    jtCode: String(d.jobTitleCode ?? d.job_title_code ?? ""),
    jgName: String(d.jobGradeName ?? ""),
    jgCode: String(d.jobGradeCode ?? d.job_grade_code ?? ""),
    posName: String(d.positionTitle ?? ""),
    posCode: String(d.positionCode ?? d.position_code ?? ""),
    wlName: String(d.workLocationName ?? d.location ?? ""),
    wlCode: String(d.workLocationCode ?? d.work_location_code ?? ""),
    maps,
  });

  normalizedRow.orgUnitId = resolved.orgUnitId ?? null;
  normalizedRow.jobTitleId = resolved.jobTitleId ?? null;
  normalizedRow.jobGradeId = resolved.jobGradeId ?? null;
  normalizedRow.positionId = resolved.positionId ?? null;
  normalizedRow.workLocationId = resolved.workLocationId ?? null;
  if (resolved.workLocationName) normalizedRow.location = resolved.workLocationName;

  const status = mismatches.length === 0 ? "ready_to_promote" : "field_mismatch";

  const [updated] = await db
    .update(hrEmployeeImportStagingTable)
    .set({
      normalizedRow,
      mismatchFields: mismatches,
      status,
      reviewedByUserId: input.userId ?? existing.reviewedByUserId,
      updatedAt: new Date(),
    })
    .where(and(eq(hrEmployeeImportStagingTable.workspaceId, input.workspaceId), eq(hrEmployeeImportStagingTable.id, input.id)))
    .returning();

  return updated ?? null;
}

async function persistEmployeeFromStaging(input: {
  workspaceId: number;
  numberingMode: string;
  row: HrEmployeeImportStagingRow;
}): Promise<number> {
  const d = input.row.normalizedRow as Record<string, unknown>;
  const isUpdate = Boolean(input.row.existingEmployeeId);

  let empNumber: string;
  if (isUpdate) {
    empNumber = String(d.employeeNumber ?? "").trim();
  } else if (input.numberingMode === "manual" || (input.numberingMode === "hybrid" && d.employeeNumber)) {
    empNumber = String(d.employeeNumber ?? "").trim();
    if (!empNumber) throw new Error("employeeNumber required");
  } else {
    empNumber = await generateEmployeeNumber(input.workspaceId);
  }

  const mgrNum = String(d.managerEmployeeNumber ?? d.deferredManagerEmployeeNumber ?? "").trim().toLowerCase();
  let directManagerId: number | null = null;
  if (mgrNum) {
    const [mgr] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.workspaceId, input.workspaceId), eq(sql`lower(${employeesTable.employeeNumber})`, mgrNum)));
    directManagerId = mgr?.id ?? null;
  }

  const payload = {
    fullName: String(d.fullName ?? "").trim(),
    firstName: d.firstName ? String(d.firstName) : null,
    lastName: d.lastName ? String(d.lastName) : null,
    email: d.email ? String(d.email) : null,
    phoneNumber: d.phoneNumber ? String(d.phoneNumber) : null,
    employeeNumber: empNumber,
    status: (d.status as string) ?? "active",
    employmentType: (d.employmentType as string) ?? "full_time",
    hireDate: d.hireDate ? String(d.hireDate) : null,
    endDate: d.endDate ? String(d.endDate) : null,
    probationEndDate: d.probationEndDate ? String(d.probationEndDate) : null,
    dateOfBirth: d.dateOfBirth ? String(d.dateOfBirth) : null,
    gender: d.gender ? String(d.gender) : null,
    nationality: d.nationality ? String(d.nationality) : null,
    maritalStatus: d.maritalStatus ? String(d.maritalStatus) : null,
    nationalId: d.nationalId ? String(d.nationalId) : null,
    passportNumber: d.passportNumber ? String(d.passportNumber) : null,
    address: d.address ? String(d.address) : null,
    company: d.company ? String(d.company) : null,
    branch: d.branch ? String(d.branch) : null,
    location: d.location ? String(d.location) : (d.workLocationName ? String(d.workLocationName) : null),
    orgUnitId: d.orgUnitId ? Number(d.orgUnitId) : null,
    jobTitleId: d.jobTitleId ? Number(d.jobTitleId) : null,
    jobGradeId: d.jobGradeId ? Number(d.jobGradeId) : null,
    positionId: d.positionId ? Number(d.positionId) : null,
    workLocationId: d.workLocationId ? Number(d.workLocationId) : null,
    position: d.positionTitle ? String(d.positionTitle) : null,
    directManagerId,
    emergencyContactName: d.emergencyContactName ? String(d.emergencyContactName) : null,
    emergencyContactPhone: d.emergencyContactPhone ? String(d.emergencyContactPhone) : null,
    emergencyContactRelation: d.emergencyContactRelation ? String(d.emergencyContactRelation) : null,
    notes: d.notes ? String(d.notes) : null,
  };

  let employeeId: number;

  if (isUpdate && input.row.existingEmployeeId) {
    await db
      .update(employeesTable)
      .set(payload)
      .where(and(eq(employeesTable.id, input.row.existingEmployeeId), eq(employeesTable.workspaceId, input.workspaceId)));
    employeeId = input.row.existingEmployeeId;
  } else {
    const [inserted] = await db
      .insert(employeesTable)
      .values({ workspaceId: input.workspaceId, ...payload })
      .returning({ id: employeesTable.id });
    if (!inserted) throw new Error("Failed to create employee");
    employeeId = inserted.id;
  }

  const cvs = d.customValues as Record<string, string> | undefined;
  if (cvs && Object.keys(cvs).length > 0) {
    const cfDefs = await db
      .select({ id: hrCustomFieldDefsTable.id, name: hrCustomFieldDefsTable.name })
      .from(hrCustomFieldDefsTable)
      .where(eq(hrCustomFieldDefsTable.workspaceId, input.workspaceId));
    for (const [cfName, cfVal] of Object.entries(cvs)) {
      const def = cfDefs.find((c) => c.name === cfName);
      if (def && cfVal) {
        await db
          .insert(hrCustomFieldValuesTable)
          .values({ employeeId, fieldDefId: def.id, value: String(cfVal) })
          .onConflictDoUpdate({
            target: [hrCustomFieldValuesTable.employeeId, hrCustomFieldValuesTable.fieldDefId],
            set: { value: String(cfVal) },
          });
      }
    }
  }

  return employeeId;
}

export async function promoteStagingRow(input: {
  workspaceId: number;
  id: number;
  userId?: number;
  numberingMode: string;
}): Promise<{ ok: boolean; employeeId?: number; error?: string }> {
  const settings = await getEmployeeImportGovernanceSettings(input.workspaceId);
  if (settings.matchOnly) {
    try {
      await assertFoundationReadinessForImport(input.workspaceId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Foundation not ready" };
    }
  }

  const row = await getStagingRow(input.workspaceId, input.id);
  if (!row) return { ok: false, error: "Staging row not found" };
  if (row.status === "promoted") return { ok: false, error: "Already promoted" };

  const patched = await patchStagingRow({
    workspaceId: input.workspaceId,
    id: input.id,
    userId: input.userId,
  });
  if (!patched) return { ok: false, error: "Could not validate staging row" };
  if (patched.status !== "ready_to_promote") {
    return { ok: false, error: "Master data still mismatched — fix fields before promote" };
  }

  try {
    const employeeId = await persistEmployeeFromStaging({
      workspaceId: input.workspaceId,
      numberingMode: input.numberingMode,
      row: patched,
    });

    await db
      .update(hrEmployeeImportStagingTable)
      .set({
        status: "promoted",
        promotedEmployeeId: employeeId,
        promotedAt: new Date(),
        reviewedByUserId: input.userId ?? patched.reviewedByUserId,
      })
      .where(and(eq(hrEmployeeImportStagingTable.workspaceId, input.workspaceId), eq(hrEmployeeImportStagingTable.id, input.id)));

    return { ok: true, employeeId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Promote failed" };
  }
}

export async function bulkPromoteStaging(input: {
  workspaceId: number;
  ids: number[];
  userId?: number;
  numberingMode: string;
}): Promise<{ promoted: number; failed: Array<{ id: number; error: string }> }> {
  let promoted = 0;
  const failed: Array<{ id: number; error: string }> = [];

  for (const id of input.ids) {
    const result = await promoteStagingRow({
      workspaceId: input.workspaceId,
      id,
      userId: input.userId,
      numberingMode: input.numberingMode,
    });
    if (result.ok) promoted++;
    else failed.push({ id, error: result.error ?? "Unknown error" });
  }

  return { promoted, failed };
}

export async function countPendingStaging(workspaceId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hrEmployeeImportStagingTable)
    .where(
      and(
        eq(hrEmployeeImportStagingTable.workspaceId, workspaceId),
        inArray(hrEmployeeImportStagingTable.status, ["pending_review", "field_mismatch", "ready_to_promote"]),
      ),
    );
  return row?.count ?? 0;
}
