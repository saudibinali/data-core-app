import { db } from "@workspace/db";
import { employeesTable, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export type ProvisionEmployeeInput = {
  fullName: string;
  email?: string | null;
  phoneNumber?: string | null;
  userId?: number | null;
  employmentType?: string | null;
  hireDate?: string | null;
  orgUnitId?: number | null;
  jobTitleId?: number | null;
};

export type ProvisionEmployeeResult =
  | {
      ok: true;
      employee: typeof employeesTable.$inferSelect;
      linked: boolean;
      userId: number | null;
      linkSource: "explicit" | "email_match" | "none";
    }
  | { ok: false; status: number; error: string };

/**
 * Employee Central–style single-step provision: create profile + link user when possible.
 * Does not create new login users (invitation flow remains separate).
 */
export async function provisionEmployee(
  workspaceId: number,
  input: ProvisionEmployeeInput,
  generateEmployeeNumber: (wsId: number) => Promise<string>,
): Promise<ProvisionEmployeeResult> {
  const fullName = input.fullName?.trim();
  if (!fullName) return { ok: false, status: 400, error: "fullName is required" };

  let resolvedUserId: number | null = input.userId ?? null;
  let linkSource: "explicit" | "email_match" | "none" = resolvedUserId ? "explicit" : "none";

  if (!resolvedUserId && input.email?.trim()) {
    const email = input.email.trim().toLowerCase();
    const matches = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.workspaceId, workspaceId),
          sql`lower(${usersTable.email}) = ${email}`,
        ),
      );
    if (matches.length === 1) {
      resolvedUserId = matches[0]!.id;
      linkSource = "email_match";
    } else if (matches.length > 1) {
      return { ok: false, status: 409, error: "Multiple users match this email; pass userId explicitly" };
    }
  }

  if (resolvedUserId) {
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.id, resolvedUserId), eq(usersTable.workspaceId, workspaceId)));
    if (!user) return { ok: false, status: 404, error: "User not found in workspace" };

    const [existing] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, resolvedUserId));
    if (existing) return { ok: false, status: 409, error: "Employee profile already exists for this user" };
  }

  const employeeNumber = await generateEmployeeNumber(workspaceId);

  const [emp] = await db
    .insert(employeesTable)
    .values({
      workspaceId,
      userId: resolvedUserId,
      fullName,
      email: input.email?.trim() ?? null,
      phoneNumber: input.phoneNumber?.trim() ?? null,
      employeeNumber,
      employmentType: input.employmentType ?? "full_time",
      hireDate: input.hireDate ?? null,
      orgUnitId: input.orgUnitId ?? null,
      jobTitleId: input.jobTitleId ?? null,
      status: "active",
    })
    .returning();

  if (!emp) return { ok: false, status: 500, error: "Failed to create employee" };

  return {
    ok: true,
    employee: emp,
    linked: resolvedUserId != null,
    userId: resolvedUserId,
    linkSource,
  };
}
