import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { departmentsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { CreateDepartmentBody, GetDepartmentParams, UpdateDepartmentBody, UpdateDepartmentParams, DeleteDepartmentParams } from "@workspace/api-zod";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";

const router: IRouter = Router();

const deptSelect = (workspaceId: number) => ({
  id: departmentsTable.id,
  name: departmentsTable.name,
  description: departmentsTable.description,
  managerId: departmentsTable.managerId,
  managerName: usersTable.fullName,
  memberCount: sql<number>`(select count(*)::int from users where department_id = ${departmentsTable.id} and workspace_id = ${workspaceId})`,
  createdAt: departmentsTable.createdAt,
  updatedAt: departmentsTable.updatedAt,
});

router.get("/departments", requireAuth, requirePermission("departments.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.json([]);
    return;
  }

  const departments = await db
    .select(deptSelect(req.workspaceId))
    .from(departmentsTable)
    .leftJoin(usersTable, eq(departmentsTable.managerId, usersTable.id))
    .where(eq(departmentsTable.workspaceId, req.workspaceId))
    .orderBy(departmentsTable.name);

  res.json(departments);
});

router.post("/departments", requireAuth, requirePermission("departments.create"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.status(400).json({ error: "No workspace assigned" });
    return;
  }

  const parsed = CreateDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [dept] = await db.insert(departmentsTable).values({
    ...parsed.data,
    workspaceId: req.workspaceId,
  }).returning();

  res.status(201).json({ ...dept, managerName: null, memberCount: 0 });
});

// GET /departments/:id - requires "departments.view" OR "departments.<id>.view"
router.get("/departments/:id", requireAuth, requirePermission(req => [
  "departments.view",
  `departments.${req.params["id"]}.view`,
]), async (req: AuthRequest, res): Promise<void> => {
  const params = GetDepartmentParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const wId = req.workspaceId ?? 0;
  const [dept] = await db
    .select(deptSelect(wId))
    .from(departmentsTable)
    .leftJoin(usersTable, eq(departmentsTable.managerId, usersTable.id))
    .where(and(
      eq(departmentsTable.id, params.data.id),
      req.workspaceId ? eq(departmentsTable.workspaceId, req.workspaceId) : undefined!
    ));

  if (!dept) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  res.json(dept);
});

// PATCH /departments/:id - requires "departments.edit" OR "departments.<id>.manage"
router.patch("/departments/:id", requireAuth, requirePermission(req => [
  "departments.edit",
  `departments.${req.params["id"]}.manage`,
]), async (req: AuthRequest, res): Promise<void> => {
  const params = UpdateDepartmentParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [dept] = await db
    .update(departmentsTable)
    .set(parsed.data)
    .where(and(
      eq(departmentsTable.id, params.data.id),
      req.workspaceId ? eq(departmentsTable.workspaceId, req.workspaceId) : undefined!
    ))
    .returning();

  if (!dept) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const wId = req.workspaceId ?? 0;
  const [full] = await db
    .select(deptSelect(wId))
    .from(departmentsTable)
    .leftJoin(usersTable, eq(departmentsTable.managerId, usersTable.id))
    .where(eq(departmentsTable.id, dept.id));

  res.json(full);
});

// DELETE /departments/:id - requires "departments.delete" OR "departments.<id>.manage"
router.delete("/departments/:id", requireAuth, requirePermission(req => [
  "departments.delete",
  `departments.${req.params["id"]}.manage`,
]), async (req: AuthRequest, res): Promise<void> => {
  const params = DeleteDepartmentParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [dept] = await db.delete(departmentsTable)
    .where(and(
      eq(departmentsTable.id, params.data.id),
      req.workspaceId ? eq(departmentsTable.workspaceId, req.workspaceId) : undefined!
    ))
    .returning();

  if (!dept) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
