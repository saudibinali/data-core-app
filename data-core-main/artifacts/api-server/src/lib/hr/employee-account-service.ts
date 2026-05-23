import { db } from "@workspace/db";
import { employeesTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { syncLegacyUserFieldsFromEmployee } from "../workforce/manager-resolver";

export type EmployeeAccountStatus = {
  employeeId: number;
  userId: number | null;
  linked: boolean;
  userEmail: string | null;
  userName: string | null;
};

export async function getEmployeeAccountStatus(
  workspaceId: number,
  employeeId: number,
): Promise<EmployeeAccountStatus | null> {
  const [row] = await db
    .select({
      employeeId: employeesTable.id,
      userId: employeesTable.userId,
      userEmail: usersTable.email,
      userName: usersTable.fullName,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(employeesTable.userId, usersTable.id))
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)));

  if (!row) return null;

  return {
    employeeId: row.employeeId,
    userId: row.userId,
    linked: row.userId != null,
    userEmail: row.userEmail ?? null,
    userName: row.userName ?? null,
  };
}

export async function linkEmployeeToUser(
  workspaceId: number,
  employeeId: number,
  userId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)));
  if (!employee) return { ok: false, status: 404, error: "Employee not found" };

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.workspaceId, workspaceId)));
  if (!user) return { ok: false, status: 404, error: "User not found in workspace" };

  const [existing] = await db
    .select({ id: employeesTable.id, employeeId: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.userId, userId), eq(employeesTable.workspaceId, workspaceId)));
  if (existing && existing.id !== employeeId) {
    return { ok: false, status: 409, error: "Employee profile already exists for this user" };
  }

  await db
    .update(employeesTable)
    .set({ userId })
    .where(eq(employeesTable.id, employeeId));

  await syncLegacyUserFieldsFromEmployee(workspaceId, employeeId).catch(() => undefined);

  return { ok: true };
}

export async function unlinkEmployeeFromUser(
  workspaceId: number,
  employeeId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [employee] = await db
    .select({ userId: employeesTable.userId })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)));
  if (!employee) return { ok: false, status: 404, error: "Employee not found" };
  if (!employee.userId) return { ok: false, status: 400, error: "Employee is not linked to a user" };

  await db
    .update(employeesTable)
    .set({ userId: null })
    .where(eq(employeesTable.id, employeeId));

  return { ok: true };
}
