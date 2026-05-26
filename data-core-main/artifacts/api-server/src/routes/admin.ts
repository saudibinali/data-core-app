/**
 * @file        routes/admin.ts
 * @purpose     Workspace-admin operations: direct user creation, password reset.
 */

import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireWorkspaceAdmin } from "../middlewares/requireAuth";
import { requireAdminProvisionRateLimit } from "../lib/admin-provision-rate-limit";
import {
  AdminCreateGeneralUserBody,
  AdminCreateUserFromEmployeeBody,
  formatZodError,
} from "../lib/security-validation";
import {
  createGeneralUser,
  createUserFromEmployee,
  lookupEmployeeForProvisioning,
} from "../lib/hr/employee-user-provisioning";
import { readProvisionIdempotencyKey } from "../lib/hr/provision-http";

const router: IRouter = Router();

router.get("/admin/users/employee-provision/lookup", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace assigned" }); return; }

  const employeeNumber = String(req.query.employeeNumber ?? "").trim();
  if (!employeeNumber) { res.status(400).json({ error: "employeeNumber query parameter is required" }); return; }

  const preview = await lookupEmployeeForProvisioning(req.workspaceId, employeeNumber);
  if (!preview) { res.status(404).json({ error: "No employee found with this employee number" }); return; }

  res.json(preview);
});

router.post("/admin/users/from-employee", requireAuth, requireWorkspaceAdmin, requireAdminProvisionRateLimit, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace assigned" }); return; }

  const parsed = AdminCreateUserFromEmployeeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const { employeeNumber, employeeId, password, role, customRoleId, mustResetPassword } = parsed.data;

  const result = await createUserFromEmployee({
    workspaceId: req.workspaceId,
    actorUserId: req.userId,
    actorRole: req.userRole,
    employeeId: employeeId,
    employeeNumber: employeeNumber,
    password,
    role,
    customRoleId: customRoleId ?? null,
    mustResetPassword,
    idempotencyKey: readProvisionIdempotencyKey(req),
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error, field: result.field });
    return;
  }

  res.status(201).json(result.data);
});

router.post("/admin/users", requireAuth, requireWorkspaceAdmin, requireAdminProvisionRateLimit, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(400).json({ error: "No workspace assigned" }); return; }

  const parsed = AdminCreateGeneralUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  const {
    firstName, lastName, email, password, role,
    departmentIds, position, mustResetPassword, customRoleId,
    accountType,
  } = parsed.data;

  if (accountType === "employee") {
    res.status(400).json({
      error: "Use POST /admin/users/from-employee to create an account for an existing HR employee",
      field: "accountType",
    });
    return;
  }

  const result = await createGeneralUser({
    workspaceId: req.workspaceId,
    actorUserId: req.userId,
    actorRole: req.userRole,
    firstName,
    lastName,
    email: email && email !== "" ? email : null,
    password,
    role,
    customRoleId: customRoleId ?? null,
    position: position ?? null,
    departmentIds,
    mustResetPassword,
    idempotencyKey: readProvisionIdempotencyKey(req),
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error, field: result.field });
    return;
  }

  res.status(201).json(result.data);
});

router.post("/admin/users/:id/reset-password", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const userId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const { password } = req.body as { password?: string };
  if (!password || String(password).length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const [user] = await db.select().from(usersTable).where(and(
    eq(usersTable.id, userId),
    req.workspaceId ? eq(usersTable.workspaceId, req.workspaceId) : undefined!,
  ));
  if (!user) { res.status(404).json({ error: "User not found in this workspace" }); return; }

  const hash = await bcrypt.hash(password, 12);
  await db.update(usersTable).set({ passwordHash: hash, mustResetPassword: true }).where(eq(usersTable.id, userId));
  res.json({ success: true });
});

export default router;
