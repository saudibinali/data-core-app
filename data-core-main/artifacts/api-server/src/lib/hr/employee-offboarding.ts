/**
 * F4.5 — Optional deactivate linked platform user when employee reaches terminal status.
 * Enabled with HR_OFFBOARD_DEACTIVATE_USER=true (does not delete HR record).
 */
import { db, employeesTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { buildRequestFingerprint, recordProvisionAudit } from "./hr-provision-audit";

const TERMINAL_EMPLOYEE_STATUSES = new Set(["terminated", "resigned"]);

export function isOffboardDeactivateEnabled(): boolean {
  return process.env.HR_OFFBOARD_DEACTIVATE_USER === "true";
}

export async function maybeDeactivateLinkedUserOnTermination(input: {
  workspaceId: number;
  employeeId: number;
  newStatus: string;
  previousStatus: string | null | undefined;
  actorUserId?: number | null;
}): Promise<void> {
  if (!isOffboardDeactivateEnabled()) return;
  if (!TERMINAL_EMPLOYEE_STATUSES.has(input.newStatus)) return;
  if (input.previousStatus && TERMINAL_EMPLOYEE_STATUSES.has(input.previousStatus)) return;

  const [emp] = await db
    .select({ userId: employeesTable.userId })
    .from(employeesTable)
    .where(and(
      eq(employeesTable.id, input.employeeId),
      eq(employeesTable.workspaceId, input.workspaceId),
    ))
    .limit(1);

  if (!emp?.userId) return;

  const [user] = await db
    .select({ id: usersTable.id, status: usersTable.status })
    .from(usersTable)
    .where(and(
      eq(usersTable.id, emp.userId),
      eq(usersTable.workspaceId, input.workspaceId),
    ))
    .limit(1);

  if (!user || user.status === "inactive") return;

  await db.update(usersTable)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  const fingerprint = buildRequestFingerprint({
    employeeId: input.employeeId,
    newStatus: input.newStatus,
    userId: user.id,
  });

  await recordProvisionAudit({
    workspaceId: input.workspaceId,
    operation: "employee_offboard_deactivate",
    employeeId: input.employeeId,
    userId: user.id,
    actorUserId: input.actorUserId ?? null,
    outcome: "success",
    httpStatus: 200,
    requestFingerprint: fingerprint,
    responseSnapshot: { userId: user.id, previousStatus: user.status, newStatus: "inactive" },
  });
}
