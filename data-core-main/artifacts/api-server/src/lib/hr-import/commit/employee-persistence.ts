/**
 * Phase 4 — Employee entity persistence (controlled commit).
 */

import {
  employeesTable,
  hrCustomFieldDefsTable,
  hrCustomFieldValuesTable,
  hrImportSessionEntitiesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { TxClient } from "./transaction-manager";
import { getFieldFromRow } from "../validation/import-validation-foundation";
import { generateEmployeeNumber } from "../../employeeNumber";
import type { HrImportRowValidation } from "../validation/hr-import-validator";
import type { Employee } from "@workspace/db";

export type EmployeeCommitPayload = {
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneNumber: string | null;
  employeeNumber: string;
  status: string;
  employmentType: string;
  hireDate: string | null;
  endDate: string | null;
  probationEndDate: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  nationality: string | null;
  maritalStatus: string | null;
  nationalId: string | null;
  passportNumber: string | null;
  address: string | null;
  company: string | null;
  branch: string | null;
  location: string | null;
  orgUnitId: number | null;
  jobTitleId: number | null;
  jobGradeId: number | null;
  positionId: number | null;
  workLocationId: number | null;
  position: string | null;
  directManagerId: number | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  notes: string | null;
  customValues: Record<string, string>;
};

export function buildEmployeeCommitPayload(
  raw: Record<string, string>,
  validation: HrImportRowValidation,
): EmployeeCommitPayload {
  const resolved = validation.resolved as Record<string, unknown>;
  const positionTitle = getFieldFromRow(raw, "position_title", "المنصب", "Position");
  const workLocationName = getFieldFromRow(raw, "work_location", "موقع العمل", "Work Location");

  return {
    fullName: getFieldFromRow(raw, "full_name", "الاسم الكامل", "Full Name"),
    firstName: getFieldFromRow(raw, "first_name", "الاسم الأول") || null,
    lastName: getFieldFromRow(raw, "last_name", "اسم العائلة") || null,
    email: getFieldFromRow(raw, "email", "البريد الإلكتروني") || null,
    phoneNumber: getFieldFromRow(raw, "phone_number", "رقم الهاتف") || null,
    employeeNumber: getFieldFromRow(raw, "employee_number", "رقم الموظف") || "",
    status: getFieldFromRow(raw, "status", "الحالة") || "active",
    employmentType: getFieldFromRow(raw, "employment_type", "نوع التوظيف") || "full_time",
    hireDate: getFieldFromRow(raw, "hire_date") || null,
    endDate: getFieldFromRow(raw, "end_date") || null,
    probationEndDate: getFieldFromRow(raw, "probation_end_date") || null,
    dateOfBirth: getFieldFromRow(raw, "date_of_birth") || null,
    gender: getFieldFromRow(raw, "gender", "الجنس") || null,
    nationality: getFieldFromRow(raw, "nationality", "الجنسية") || null,
    maritalStatus: getFieldFromRow(raw, "marital_status") || null,
    nationalId: getFieldFromRow(raw, "national_id") || null,
    passportNumber: getFieldFromRow(raw, "passport_number") || null,
    address: getFieldFromRow(raw, "address") || null,
    company: getFieldFromRow(raw, "company") || null,
    branch: getFieldFromRow(raw, "branch") || null,
    location: workLocationName || getFieldFromRow(raw, "location") || null,
    orgUnitId: (resolved.orgUnitId as number) ?? null,
    jobTitleId: (resolved.jobTitleId as number) ?? null,
    jobGradeId: (resolved.jobGradeId as number) ?? null,
    positionId: (resolved.positionId as number) ?? null,
    workLocationId: (resolved.workLocationId as number) ?? null,
    position: positionTitle || null,
    directManagerId: null,
    emergencyContactName: getFieldFromRow(raw, "emergency_contact_name") || null,
    emergencyContactPhone: getFieldFromRow(raw, "emergency_contact_phone") || null,
    emergencyContactRelation: getFieldFromRow(raw, "emergency_contact_relation") || null,
    notes: getFieldFromRow(raw, "notes") || null,
    customValues: extractCustomFieldValues(raw),
  };
}

function extractCustomFieldValues(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("cf_") && v?.trim()) out[k.slice(3)] = v.trim();
  }
  return out;
}

export type EmployeePersistResult = {
  action: "insert" | "update" | "skip";
  employeeId?: number;
  employeeNumber: string;
  before?: Partial<Employee>;
};

export async function persistEmployeeRow(input: {
  tx: TxClient;
  workspaceId: number;
  sessionId: number;
  rowNumber: number;
  payload: EmployeeCommitPayload;
  existingId?: number;
  numberingMode: string;
  managerId?: number | null;
  empByNum: Map<string, number>;
}): Promise<EmployeePersistResult> {
  const { tx, workspaceId, sessionId, payload, existingId, numberingMode, managerId, empByNum } = input;

  let empNumber = payload.employeeNumber.trim();
  if (!existingId) {
    if (!empNumber || numberingMode === "auto" || (numberingMode === "hybrid" && !empNumber)) {
      empNumber = await generateEmployeeNumber(workspaceId);
    }
  } else {
    empNumber = empNumber || String(existingId);
  }

  const values = {
    workspaceId,
    fullName: payload.fullName,
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email,
    phoneNumber: payload.phoneNumber,
    employeeNumber: empNumber,
    status: payload.status,
    employmentType: payload.employmentType,
    hireDate: payload.hireDate,
    endDate: payload.endDate,
    probationEndDate: payload.probationEndDate,
    dateOfBirth: payload.dateOfBirth,
    gender: payload.gender,
    nationality: payload.nationality,
    maritalStatus: payload.maritalStatus,
    nationalId: payload.nationalId,
    passportNumber: payload.passportNumber,
    address: payload.address,
    company: payload.company,
    branch: payload.branch,
    location: payload.location,
    orgUnitId: payload.orgUnitId,
    jobTitleId: payload.jobTitleId,
    jobGradeId: payload.jobGradeId,
    positionId: payload.positionId,
    workLocationId: payload.workLocationId,
    position: payload.position,
    directManagerId: managerId ?? null,
    emergencyContactName: payload.emergencyContactName,
    emergencyContactPhone: payload.emergencyContactPhone,
    emergencyContactRelation: payload.emergencyContactRelation,
    notes: payload.notes,
  };

  if (existingId) {
    const [before] = await tx
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.id, existingId), eq(employeesTable.workspaceId, workspaceId)))
      .limit(1);

    await tx
      .update(employeesTable)
      .set(values)
      .where(and(eq(employeesTable.id, existingId), eq(employeesTable.workspaceId, workspaceId)));

    await tx.insert(hrImportSessionEntitiesTable).values({
      sessionId,
      workspaceId,
      entityType: "employee",
      entityId: existingId,
      canonicalKey: empNumber,
      action: "update",
      metadata: { rowNumber: input.rowNumber, phase: 4 },
    });

    await saveCustomFields(tx, workspaceId, existingId, payload.customValues);

    empByNum.set(empNumber.toLowerCase(), existingId);
    return { action: "update", employeeId: existingId, employeeNumber: empNumber, before: before ?? undefined };
  }

  const [inserted] = await tx.insert(employeesTable).values(values).returning();
  const employeeId = inserted!.id;

  await tx.insert(hrImportSessionEntitiesTable).values({
    sessionId,
    workspaceId,
    entityType: "employee",
    entityId: employeeId,
    canonicalKey: empNumber,
    action: "insert",
    metadata: { rowNumber: input.rowNumber, phase: 4 },
  });

  await saveCustomFields(tx, workspaceId, employeeId, payload.customValues);

  empByNum.set(empNumber.toLowerCase(), employeeId);
  return { action: "insert", employeeId, employeeNumber: empNumber };
}

async function saveCustomFields(
  tx: TxClient,
  workspaceId: number,
  employeeId: number,
  customValues: Record<string, string>,
): Promise<void> {
  if (!Object.keys(customValues).length) return;
  const cfDefs = await tx
    .select({ id: hrCustomFieldDefsTable.id, name: hrCustomFieldDefsTable.name })
    .from(hrCustomFieldDefsTable)
    .where(eq(hrCustomFieldDefsTable.workspaceId, workspaceId));

  for (const [cfName, cfVal] of Object.entries(customValues)) {
    const def = cfDefs.find((c) => c.name === cfName);
    if (def && cfVal) {
      await tx
        .insert(hrCustomFieldValuesTable)
        .values({ employeeId, fieldDefId: def.id, value: cfVal })
        .onConflictDoUpdate({
          target: [hrCustomFieldValuesTable.employeeId, hrCustomFieldValuesTable.fieldDefId],
          set: { value: cfVal },
        });
    }
  }
}
