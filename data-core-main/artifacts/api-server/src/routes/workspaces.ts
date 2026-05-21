import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { workspacesTable, usersTable, departmentsTable, ticketsTable } from "@workspace/db";
import { eq, sql, count } from "drizzle-orm";
import { generateEmployeeNumber } from "../lib/employeeNumber";
import { type AuthRequest, requireAuth, requireWorkspaceAdmin, requireSuperAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/workspaces", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const workspaces = await db
    .select({
      id: workspacesTable.id,
      name: workspacesTable.name,
      slug: workspacesTable.slug,
      status: workspacesTable.status,
      logoUrl: workspacesTable.logoUrl,
      primaryColor: workspacesTable.primaryColor,
      userCount: sql<number>`(select count(*)::int from users where workspace_id = ${workspacesTable.id})`,
      ticketCount: sql<number>`(select count(*)::int from tickets where workspace_id = ${workspacesTable.id})`,
      departmentCount: sql<number>`(select count(*)::int from departments where workspace_id = ${workspacesTable.id})`,
      createdAt: workspacesTable.createdAt,
      updatedAt: workspacesTable.updatedAt,
    })
    .from(workspacesTable)
    .orderBy(workspacesTable.name);

  res.json(workspaces);
});

router.post("/workspaces", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { name, slug, logoUrl, primaryColor, adminEmail, adminFullName, adminPassword, adminEmployeeNumber: providedEmpNum } = req.body;

  if (!name || !slug || !adminFullName || !adminPassword) {
    res.status(400).json({ error: "Missing required fields: name, slug, adminFullName, adminPassword" });
    return;
  }

  const slugConflict = await db.select().from(workspacesTable).where(eq(workspacesTable.slug, slug));
  if (slugConflict.length > 0) {
    res.status(409).json({ error: "Workspace slug already exists" });
    return;
  }

  if (String(adminPassword).length < 8) {
    res.status(400).json({ error: "Admin password must be at least 8 characters" });
    return;
  }

  const trimmedEmpNum = providedEmpNum ? String(providedEmpNum).trim() : null;
  if (trimmedEmpNum) {
    const [empConflict] = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.employeeNumber, trimmedEmpNum));
    if (empConflict) {
      res.status(409).json({ error: "Employee number is already in use", field: "adminEmployeeNumber" });
      return;
    }
  }

  const [workspace] = await db.insert(workspacesTable).values({
    name, slug,
    logoUrl: logoUrl ?? null,
    primaryColor: primaryColor ?? null,
    status: "active",
  }).returning();

  const firstName = adminFullName.split(" ")[0] ?? adminFullName;
  const lastName = adminFullName.split(" ").slice(1).join(" ") || null;
  const adminEmployeeNumber = trimmedEmpNum ?? await generateEmployeeNumber(workspace!.id);
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const [adminUser] = await db.insert(usersTable).values({
    workspaceId: workspace!.id,
    email: adminEmail ?? null,
    firstName,
    lastName,
    fullName: adminFullName,
    employeeNumber: adminEmployeeNumber,
    passwordHash,
    role: "admin",
    status: "active",
  }).returning();

  res.status(201).json({
    ...workspace,
    userCount: 1, ticketCount: 0, departmentCount: 0,
    adminUser: { id: adminUser!.id, email: adminEmail, fullName: adminFullName, employeeNumber: adminEmployeeNumber },
  });
});

router.get("/workspaces/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(404).json({ error: "No workspace assigned to this user" }); return; }

  const [workspace] = await db
    .select({
      id: workspacesTable.id,
      name: workspacesTable.name,
      slug: workspacesTable.slug,
      status: workspacesTable.status,
      logoUrl: workspacesTable.logoUrl,
      primaryColor: workspacesTable.primaryColor,
      userCount: sql<number>`(select count(*)::int from users where workspace_id = ${workspacesTable.id})`,
      ticketCount: sql<number>`(select count(*)::int from tickets where workspace_id = ${workspacesTable.id})`,
      departmentCount: sql<number>`(select count(*)::int from departments where workspace_id = ${workspacesTable.id})`,
      createdAt: workspacesTable.createdAt,
      updatedAt: workspacesTable.updatedAt,
    })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, req.workspaceId));

  if (!workspace) { res.status(404).json({ error: "Workspace not found" }); return; }
  res.json(workspace);
});

router.patch("/workspaces/me", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(404).json({ error: "No workspace assigned" }); return; }

  const { name, logoUrl, primaryColor } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (logoUrl !== undefined) updates.logoUrl = logoUrl;
  if (primaryColor !== undefined) updates.primaryColor = primaryColor;

  const [workspace] = await db.update(workspacesTable).set(updates).where(eq(workspacesTable.id, req.workspaceId)).returning();
  res.json({ ...workspace, userCount: 0, ticketCount: 0, departmentCount: 0 });
});

router.get("/workspaces/:id", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(workspaceId)) { res.status(400).json({ error: "Invalid workspace ID" }); return; }

  const [workspace] = await db
    .select({
      id: workspacesTable.id,
      name: workspacesTable.name,
      slug: workspacesTable.slug,
      status: workspacesTable.status,
      logoUrl: workspacesTable.logoUrl,
      primaryColor: workspacesTable.primaryColor,
      userCount: sql<number>`(select count(*)::int from users where workspace_id = ${workspacesTable.id})`,
      ticketCount: sql<number>`(select count(*)::int from tickets where workspace_id = ${workspacesTable.id})`,
      departmentCount: sql<number>`(select count(*)::int from departments where workspace_id = ${workspacesTable.id})`,
      createdAt: workspacesTable.createdAt,
      updatedAt: workspacesTable.updatedAt,
    })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, workspaceId));

  if (!workspace) { res.status(404).json({ error: "Workspace not found" }); return; }
  res.json(workspace);
});

router.patch("/workspaces/:id", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(workspaceId)) { res.status(400).json({ error: "Invalid workspace ID" }); return; }

  const { name, logoUrl, primaryColor, status } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (logoUrl !== undefined) updates.logoUrl = logoUrl;
  if (primaryColor !== undefined) updates.primaryColor = primaryColor;
  if (status !== undefined) {
    if (!["active", "suspended", "disabled"].includes(status)) {
      res.status(400).json({ error: "status must be one of: active, suspended, disabled" }); return;
    }
    updates.status = status;
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  const [workspace] = await db.update(workspacesTable).set(updates).where(eq(workspacesTable.id, workspaceId)).returning();
  if (!workspace) { res.status(404).json({ error: "Workspace not found" }); return; }
  res.json({ ...workspace, userCount: 0, ticketCount: 0, departmentCount: 0 });
});

router.delete("/workspaces/:id", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(workspaceId)) { res.status(400).json({ error: "Invalid workspace ID" }); return; }

  const [workspace] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, workspaceId));
  if (!workspace) { res.status(404).json({ error: "Workspace not found" }); return; }

  await db.delete(workspacesTable).where(eq(workspacesTable.id, workspaceId));
  res.status(204).send();
});

router.get("/workspaces/:id/stats", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(workspaceId)) { res.status(400).json({ error: "Invalid workspace ID" }); return; }

  const [[userRow], [ticketRow], [deptRow]] = await Promise.all([
    db.select({ total: count() }).from(usersTable).where(eq(usersTable.workspaceId, workspaceId)),
    db.select({ total: count() }).from(ticketsTable).where(eq(ticketsTable.workspaceId, workspaceId)),
    db.select({ total: count() }).from(departmentsTable).where(eq(departmentsTable.workspaceId, workspaceId)),
  ]);

  const openTickets = await db.select({ total: count() }).from(ticketsTable)
    .where(sql`${ticketsTable.workspaceId} = ${workspaceId} and ${ticketsTable.status} = 'open'`);

  res.json({
    workspaceId,
    userCount: userRow?.total ?? 0,
    ticketCount: ticketRow?.total ?? 0,
    departmentCount: deptRow?.total ?? 0,
    openTicketCount: openTickets[0]?.total ?? 0,
  });
});

router.get("/workspaces/:id/users", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(workspaceId)) { res.status(400).json({ error: "Invalid workspace ID" }); return; }

  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      status: usersTable.status,
      avatarUrl: usersTable.avatarUrl,
      position: usersTable.position,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.workspaceId, workspaceId))
    .orderBy(usersTable.fullName);

  res.json(users);
});

export default router;
