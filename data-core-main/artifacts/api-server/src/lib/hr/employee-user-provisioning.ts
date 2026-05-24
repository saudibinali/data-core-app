/**
 * Enterprise user provisioning: link platform User accounts to HR Employee records.
 * HR employee is source of truth for identity; User holds login + permissions.
 */
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  employeesTable,
  usersTable,
  departmentsTable,
  workspaceInvitationsTable,
  userDepartmentsTable,
  hrOrgUnitsTable,
  hrJobTitlesTable,
  legacyDepartmentOrgMapTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { generateEmployeeNumber } from "../employeeNumber";
import { linkEmployeeToUser } from "../hr/employee-account-service";
import { syncLegacyUserFieldsFromEmployee } from "../workforce/manager-resolver";
import { resolveDirectManagerUserId } from "../workforce/manager-resolver";
import { appEventBus } from "../events/app-bus";
import { EVENT_TYPES } from "@workspace/core-events";

const TERMINAL_EMPLOYEE_STATUSES = new Set(["terminated", "resigned"]);

export type ProvisionError = { ok: false; status: number; error: string; field?: string };
export type ProvisionOk<T> = { ok: true; data: T };

export interface EmployeeProvisionPreview {
  employeeId: number;
  employeeNumber: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneNumber: string | null;
  status: string;
  orgUnitName: string | null;
  jobTitleName: string | null;
  position: string | null;
  managerName: string | null;
  alreadyLinked: boolean;
  linkedUserId: number | null;
  canProvision: boolean;
  blockReason: string | null;
}

export interface CreateFromEmployeeInput {
  workspaceId: number;
  actorUserId?: number | null;
  actorRole?: string | null;
  employeeId?: number;
  employeeNumber?: string;
  password: string;
  role?: string;
  customRoleId?: number | null;
  mustResetPassword?: boolean;
}

export interface CreateGeneralUserInput {
  workspaceId: number;
  actorUserId?: number | null;
  actorRole?: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  password: string;
  role?: string;
  customRoleId?: number | null;
  position?: string | null;
  departmentIds?: number[];
  mustResetPassword?: boolean;
}

const managerAlias = alias(employeesTable, "mgr");

function splitName(fullName: string, firstName?: string | null, lastName?: string | null): { firstName: string; lastName: string } {
  if (firstName?.trim() && lastName?.trim()) {
    return { firstName: firstName.trim(), lastName: lastName.trim() };
  }
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
  }
  return { firstName: fullName.trim() || "User", lastName: "-" };
}

async function resolveDepartmentIdsFromOrgUnit(
  workspaceId: number,
  orgUnitId: number | null | undefined,
): Promise<number[]> {
  if (!orgUnitId) return [];
  const [mapRow] = await db
    .select({ departmentId: legacyDepartmentOrgMapTable.departmentId })
    .from(legacyDepartmentOrgMapTable)
    .where(and(
      eq(legacyDepartmentOrgMapTable.workspaceId, workspaceId),
      eq(legacyDepartmentOrgMapTable.orgUnitId, orgUnitId),
    ))
    .limit(1);
  return mapRow?.departmentId ? [mapRow.departmentId] : [];
}

async function fetchEmployeeRow(workspaceId: number, employeeId: number) {
  const [row] = await db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      employeeNumber: employeesTable.employeeNumber,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      fullName: employeesTable.fullName,
      email: employeesTable.email,
      phoneNumber: employeesTable.phoneNumber,
      status: employeesTable.status,
      orgUnitId: employeesTable.orgUnitId,
      orgUnitName: hrOrgUnitsTable.name,
      jobTitleName: hrJobTitlesTable.name,
      position: employeesTable.position,
      managerName: managerAlias.fullName,
    })
    .from(employeesTable)
    .leftJoin(hrOrgUnitsTable, eq(employeesTable.orgUnitId, hrOrgUnitsTable.id))
    .leftJoin(hrJobTitlesTable, eq(employeesTable.jobTitleId, hrJobTitlesTable.id))
    .leftJoin(managerAlias, eq(employeesTable.directManagerId, managerAlias.id))
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)));
  return row ?? null;
}

function buildPreview(row: NonNullable<Awaited<ReturnType<typeof fetchEmployeeRow>>>): EmployeeProvisionPreview {
  let blockReason: string | null = null;
  if (!row.employeeNumber?.trim()) {
    blockReason = "Employee has no employee number assigned in HR";
  } else if (row.userId) {
    blockReason = "Employee already has a linked platform account";
  } else if (TERMINAL_EMPLOYEE_STATUSES.has(row.status)) {
    blockReason = `Cannot provision account for employee with status "${row.status}"`;
  }

  return {
    employeeId: row.id,
    employeeNumber: row.employeeNumber ?? "",
    fullName: row.fullName,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phoneNumber: row.phoneNumber,
    status: row.status,
    orgUnitName: row.orgUnitName,
    jobTitleName: row.jobTitleName,
    position: row.position,
    managerName: row.managerName,
    alreadyLinked: row.userId != null,
    linkedUserId: row.userId,
    canProvision: blockReason == null,
    blockReason,
  };
}

export async function lookupEmployeeForProvisioning(
  workspaceId: number,
  employeeNumber: string,
): Promise<EmployeeProvisionPreview | null> {
  const num = employeeNumber.trim();
  if (!num) return null;

  const [found] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(
      eq(employeesTable.workspaceId, workspaceId),
      sql`lower(${employeesTable.employeeNumber}) = lower(${num})`,
    ))
    .limit(1);

  if (!found) return null;
  const row = await fetchEmployeeRow(workspaceId, found.id);
  if (!row) return null;
  return buildPreview(row);
}

export async function getEmployeeProvisionPreviewById(
  workspaceId: number,
  employeeId: number,
): Promise<EmployeeProvisionPreview | null> {
  const row = await fetchEmployeeRow(workspaceId, employeeId);
  if (!row) return null;
  return buildPreview(row);
}

async function syncUserDepartments(userId: number, departmentIds: number[]) {
  if (departmentIds.length === 0) return;
  await db.insert(userDepartmentsTable).values(
    departmentIds.map((deptId, i) => ({ userId, departmentId: deptId, isPrimary: i === 0 })),
  ).onConflictDoNothing();
  await db.update(usersTable)
    .set({ departmentId: departmentIds[0] ?? null })
    .where(eq(usersTable.id, userId));
}

async function selectUserResponse(userId: number) {
  const [full] = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    fullName: usersTable.fullName,
    employeeNumber: usersTable.employeeNumber,
    position: usersTable.position,
    avatarUrl: usersTable.avatarUrl,
    phoneNumber: usersTable.phoneNumber,
    extensionNumber: usersTable.extensionNumber,
    languagePreference: usersTable.languagePreference,
    timeZone: usersTable.timeZone,
    employmentStatus: usersTable.employmentStatus,
    signature: usersTable.signature,
    lineManagerId: usersTable.lineManagerId,
    workspaceId: usersTable.workspaceId,
    departmentId: usersTable.departmentId,
    departmentName: departmentsTable.name,
    role: usersTable.role,
    status: usersTable.status,
    mustResetPassword: usersTable.mustResetPassword,
    createdAt: usersTable.createdAt,
    updatedAt: usersTable.updatedAt,
  })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .where(eq(usersTable.id, userId));
  return full ? { ...full, departments: [] as unknown[] } : null;
}

async function emitEmployeeCreatedEvent(
  workspaceId: number,
  user: typeof usersTable.$inferSelect,
  actorUserId?: number | null,
  actorRole?: string | null,
  linkedEmployeeId?: number,
) {
  void appEventBus.emit({
    type: EVENT_TYPES.EMPLOYEE_CREATED,
    module: "users",
    workspace: { workspaceId },
    actor: { userId: actorUserId, role: actorRole },
    metadata: { idempotencyKey: `employee-created-${user.id}`, source: "user-provisioning" },
    data: {
      employeeUserId: user.id,
      employeeNumber: user.employeeNumber ?? null,
      fullName: user.fullName,
      role: user.role,
      departmentId: user.departmentId ?? null,
      email: user.email ?? null,
      position: user.position ?? null,
      isDirectCreate: true,
      hrEmployeeId: linkedEmployeeId ?? null,
    },
  });
}

export async function createUserFromEmployee(
  input: CreateFromEmployeeInput,
): Promise<ProvisionOk<Awaited<ReturnType<typeof selectUserResponse>>> | ProvisionError> {
  const {
    workspaceId, actorUserId, actorRole,
    employeeId, employeeNumber, password,
    role = "member", customRoleId = null, mustResetPassword = false,
  } = input;

  if (!password || String(password).length < 8) {
    return { ok: false, status: 400, error: "Password must be at least 8 characters", field: "password" };
  }

  let empRow: Awaited<ReturnType<typeof fetchEmployeeRow>> = null;
  if (employeeId) {
    empRow = await fetchEmployeeRow(workspaceId, employeeId);
  } else if (employeeNumber?.trim()) {
    const preview = await lookupEmployeeForProvisioning(workspaceId, employeeNumber);
    if (!preview) return { ok: false, status: 404, error: "No employee found with this employee number", field: "employeeNumber" };
    empRow = await fetchEmployeeRow(workspaceId, preview.employeeId);
  } else {
    return { ok: false, status: 400, error: "employeeId or employeeNumber is required" };
  }

  if (!empRow) return { ok: false, status: 404, error: "Employee not found" };

  const preview = buildPreview(empRow);
  if (!preview.canProvision) {
    return { ok: false, status: 409, error: preview.blockReason ?? "Cannot provision account for this employee" };
  }

  const trimmedEmail = empRow.email?.trim() || null;
  if (trimmedEmail) {
    const [emailConflict] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.email, trimmedEmail), eq(usersTable.workspaceId, workspaceId)));
    if (emailConflict) {
      return { ok: false, status: 409, error: "Email address is already in use by another user", field: "email" };
    }
  }

  const empNum = empRow.employeeNumber!.trim();
  const [numConflict] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.workspaceId, workspaceId),
      sql`lower(${usersTable.employeeNumber}) = lower(${empNum})`,
    ));
  if (numConflict) {
    return { ok: false, status: 409, error: "Employee number is already assigned to another user", field: "employeeNumber" };
  }

  const { firstName, lastName } = splitName(empRow.fullName, empRow.firstName, empRow.lastName);
  const fullName = `${firstName} ${lastName}`.trim();
  const departmentIds = await resolveDepartmentIdsFromOrgUnit(workspaceId, empRow.orgUnitId);
  const primaryDeptId = departmentIds[0] ?? null;
  const lineManagerId = await resolveDirectManagerUserId(workspaceId, empRow.id);
  const passwordHash = await bcrypt.hash(password, 12);
  const position = empRow.jobTitleName ?? empRow.position ?? null;

  const employmentStatus = empRow.status === "on_leave" ? "on_leave"
    : TERMINAL_EMPLOYEE_STATUSES.has(empRow.status) ? "terminated"
    : "active";

  const [user] = await db.insert(usersTable).values({
    workspaceId,
    email: trimmedEmail,
    firstName,
    lastName,
    fullName,
    employeeNumber: empNum,
    passwordHash,
    position,
    phoneNumber: empRow.phoneNumber ?? null,
    departmentId: primaryDeptId,
    lineManagerId,
    role,
    customRoleId: customRoleId ? Number(customRoleId) : null,
    employmentStatus,
    status: "active",
    mustResetPassword: Boolean(mustResetPassword),
  }).returning();

  if (!user) return { ok: false, status: 500, error: "Failed to create user" };

  if (departmentIds.length) await syncUserDepartments(user.id, departmentIds);

  const linkResult = await linkEmployeeToUser(workspaceId, empRow.id, user.id);
  if (!linkResult.ok) {
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    return { ok: false, status: linkResult.status, error: linkResult.error };
  }

  await syncLegacyUserFieldsFromEmployee(workspaceId, empRow.id).catch(() => undefined);

  if (trimmedEmail) {
    await db.update(workspaceInvitationsTable)
      .set({ status: "accepted" })
      .where(eq(workspaceInvitationsTable.email, trimmedEmail));
  }

  const response = await selectUserResponse(user.id);
  await emitEmployeeCreatedEvent(workspaceId, user, actorUserId, actorRole, empRow.id);

  return {
    ok: true,
    data: response ? { ...response, linkedEmployeeId: empRow.id } : null,
  };
}

export async function createGeneralUser(
  input: CreateGeneralUserInput,
): Promise<ProvisionOk<Awaited<ReturnType<typeof selectUserResponse>>> | ProvisionError> {
  const {
    workspaceId, actorUserId, actorRole,
    firstName, lastName, email, password,
    role = "member", customRoleId = null, position, departmentIds = [], mustResetPassword = false,
  } = input;

  if (!firstName?.trim()) return { ok: false, status: 400, error: "First name is required", field: "firstName" };
  if (!lastName?.trim()) return { ok: false, status: 400, error: "Last name is required", field: "lastName" };
  if (!password || String(password).length < 8) {
    return { ok: false, status: 400, error: "Password must be at least 8 characters", field: "password" };
  }

  const trimmedEmail = email?.trim() || null;
  if (trimmedEmail) {
    const [emailConflict] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.email, trimmedEmail));
    if (emailConflict) return { ok: false, status: 409, error: "Email address is already in use", field: "email" };
  }

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const generalEmpNum = `EXT-${await generateEmployeeNumber(workspaceId)}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const primaryDeptId = departmentIds.length > 0 ? departmentIds[0] : null;

  const [user] = await db.insert(usersTable).values({
    workspaceId,
    email: trimmedEmail,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    fullName,
    employeeNumber: generalEmpNum,
    passwordHash,
    position: position?.trim() ?? null,
    departmentId: primaryDeptId,
    role,
    customRoleId: customRoleId ? Number(customRoleId) : null,
    status: "active",
    mustResetPassword: Boolean(mustResetPassword),
  }).returning();

  if (!user) return { ok: false, status: 500, error: "Failed to create user" };

  if (departmentIds.length) await syncUserDepartments(user.id, departmentIds);

  if (trimmedEmail) {
    await db.update(workspaceInvitationsTable)
      .set({ status: "accepted" })
      .where(eq(workspaceInvitationsTable.email, trimmedEmail));
  }

  const response = await selectUserResponse(user.id);
  await emitEmployeeCreatedEvent(workspaceId, user, actorUserId, actorRole);

  return { ok: true, data: response };
}
