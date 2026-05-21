import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, departmentsTable, workspaceInvitationsTable, userDepartmentsTable, workspaceCustomRolesTable, workspaceRolePermissionsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { GetUserParams, UpdateUserBody, UpdateUserParams, ListUsersQueryParams } from "@workspace/api-zod";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";

const router: IRouter = Router();
const lineManagerAlias = alias(usersTable, "line_manager");
const customRoleAlias = alias(workspaceCustomRolesTable, "custom_role");

const userWithDept = {
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
  lineManagerName: lineManagerAlias.fullName,
  workspaceId: usersTable.workspaceId,
  departmentId: usersTable.departmentId,
  departmentName: departmentsTable.name,
  departments: sql<{ id: number; name: string; isPrimary: boolean }[]>`
    COALESCE((
      SELECT json_agg(
        json_build_object('id', d.id, 'name', d.name, 'isPrimary', ud.is_primary)
        ORDER BY ud.is_primary DESC, d.name
      )
      FROM user_departments ud
      JOIN departments d ON d.id = ud.department_id
      WHERE ud.user_id = ${usersTable.id}
    ), '[]'::json)
  `,
  role: usersTable.role,
  customRoleId: usersTable.customRoleId,
  customRoleName: customRoleAlias.name,
  permissions: sql<string[]>`
    COALESCE((
      SELECT json_agg(wrp.permission)
      FROM workspace_role_permissions wrp
      WHERE wrp.custom_role_id = ${usersTable.customRoleId}
    ), '[]'::json)
  `,
  status: usersTable.status,
  mustResetPassword: usersTable.mustResetPassword,
  createdAt: usersTable.createdAt,
  updatedAt: usersTable.updatedAt,
};

function queryWithJoins() {
  return db
    .select(userWithDept)
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .leftJoin(lineManagerAlias, eq(usersTable.lineManagerId, lineManagerAlias.id))
    .leftJoin(customRoleAlias, eq(usersTable.customRoleId, customRoleAlias.id));
}

async function syncUserDepartments(userId: number, departmentIds: number[]) {
  await db.delete(userDepartmentsTable).where(eq(userDepartmentsTable.userId, userId));
  if (departmentIds.length > 0) {
    await db.insert(userDepartmentsTable).values(
      departmentIds.map((deptId, i) => ({ userId, departmentId: deptId, isPrimary: i === 0 }))
    ).onConflictDoNothing();
  }
  await db.update(usersTable)
    .set({ departmentId: departmentIds[0] ?? null })
    .where(eq(usersTable.id, userId));
}

// ── GET /users/lookup ─────────────────────────────────────────────────────────
router.get("/users/lookup", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

  const { employeeNumber } = req.query as Record<string, string | undefined>;
  if (!employeeNumber?.trim()) { res.status(400).json({ error: "employeeNumber is required" }); return; }

  const [user] = await db
    .select({
      employeeNumber: usersTable.employeeNumber,
      fullName:       usersTable.fullName,
      position:       usersTable.position,
      departmentName: departmentsTable.name,
      lineManagerName: lineManagerAlias.fullName,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .leftJoin(lineManagerAlias, eq(usersTable.lineManagerId, lineManagerAlias.id))
    .where(and(
      eq(usersTable.workspaceId, req.workspaceId),
      eq(usersTable.employeeNumber, employeeNumber.trim()),
    ));

  if (!user) { res.status(404).json({ error: "Employee not found" }); return; }
  res.json(user);
});

// ── GET /users ────────────────────────────────────────────────────────────────
router.get("/users", requireAuth, requirePermission("users.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.json([]); return; }

  const params = ListUsersQueryParams.safeParse(req.query);
  const departmentId = params.success ? params.data.departmentId : undefined;

  let query = queryWithJoins()
    .where(eq(usersTable.workspaceId, req.workspaceId))
    .$dynamic();

  if (departmentId) {
    query = query.where(and(eq(usersTable.workspaceId, req.workspaceId), eq(usersTable.departmentId, departmentId)));
  }

  const users = await query.orderBy(usersTable.fullName);
  res.json(users);
});

// ── GET /users/me ─────────────────────────────────────────────────────────────
router.get("/users/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) { res.status(404).json({ error: "User not found" }); return; }

  const [user] = await queryWithJoins().where(eq(usersTable.id, req.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(user);
});

// ── GET /users/:id ────────────────────────────────────────────────────────────
router.get("/users/:id", requireAuth, requirePermission("users.view"), async (req: AuthRequest, res): Promise<void> => {
  const params = GetUserParams.safeParse({ id: req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [user] = await queryWithJoins()
    .where(and(
      eq(usersTable.id, params.data.id),
      req.workspaceId ? eq(usersTable.workspaceId, req.workspaceId) : undefined!
    ));

  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(user);
});

// ── PATCH /users/:id ──────────────────────────────────────────────────────────
router.patch("/users/:id", requireAuth, requirePermission("users.edit"), async (req: AuthRequest, res): Promise<void> => {
  const params = UpdateUserParams.safeParse({ id: req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { departmentIds, ...userFields } = parsed.data;

  const [user] = await db
    .update(usersTable)
    .set(userFields)
    .where(and(
      eq(usersTable.id, params.data.id),
      req.workspaceId ? eq(usersTable.workspaceId, req.workspaceId) : undefined!
    ))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (departmentIds !== undefined) {
    await syncUserDepartments(user.id, departmentIds);
  }

  const [full] = await queryWithJoins().where(eq(usersTable.id, user.id));
  res.json(full);
});

// ── DELETE /users/:id ─────────────────────────────────────────────────────────
router.delete("/users/:id", requireAuth, requirePermission("users.edit"), async (req: AuthRequest, res): Promise<void> => {
  const params = GetUserParams.safeParse({ id: req.params.id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [user] = await db
    .select({ id: usersTable.id, workspaceId: usersTable.workspaceId })
    .from(usersTable)
    .where(and(
      eq(usersTable.id, params.data.id),
      req.workspaceId ? eq(usersTable.workspaceId, req.workspaceId) : undefined!
    ));

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  await db.delete(userDepartmentsTable).where(eq(userDepartmentsTable.userId, user.id));
  await db.delete(usersTable).where(eq(usersTable.id, user.id));

  res.status(204).end();
});

export default router;
