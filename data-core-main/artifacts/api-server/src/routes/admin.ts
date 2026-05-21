/**
 * @file        routes/admin.ts
 * @purpose     Workspace-admin operations: direct user creation, password reset.
 *
 * ── Event emission (as of Ticket 07 - employee.created migration) ─────────────
 *   POST /admin/users now emits to appEventBus (canonical bus), replacing the
 *   previous direct eventDispatcher.dispatch() call.
 *
 *   Fanout from appEventBus.emit(EVENT_TYPES.EMPLOYEE_CREATED):
 *     1. activity.ts listener         → activity_logs ("employee_created")   ✅ ACTIVE
 *     2. notifications-bus.ts listener → "employee_created" notifs + SSE push ✅ ACTIVE
 *     3. bridge → eventDispatcher      → workspace_event_logs + WorkflowEngine ✅ ACTIVE
 *
 *   The legacy eventDispatcher.dispatch(EVENTS.EMPLOYEE_CREATED) call has been
 *   removed from this file in Ticket 07.  The bridge provides identical coverage
 *   of workspace_event_logs and the WorkflowEngine.
 *
 *   The legacy notifications.ts EMPLOYEE_CREATED listener (which ran on the old
 *   dispatcher path) has also been removed in Ticket 07 to prevent duplicate
 *   notifications.
 *
 * ── Coupling note ──────────────────────────────────────────────────────────────
 *   This route is tightly coupled to usersTable (direct insert, not via a service
 *   layer).  It also reaches into workspaceInvitationsTable to mark invitations
 *   accepted when the email matches.  These are known coupling points documented
 *   here for future service-extraction consideration - no refactor in scope here.
 *
 * ── Does NOT touch ─────────────────────────────────────────────────────────────
 *   comments.ts, forms.ts, HR leave flows, tickets, SSE architecture.
 */

import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, departmentsTable, workspaceInvitationsTable, userDepartmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateEmployeeNumber } from "../lib/employeeNumber";
import { type AuthRequest, requireAuth, requireWorkspaceAdmin } from "../middlewares/requireAuth";
import { appEventBus } from "../lib/events/app-bus";
import { EVENT_TYPES } from "@workspace/core-events";

const router: IRouter = Router();

async function syncUserDepartments(userId: number, departmentIds: number[]) {
  if (departmentIds.length === 0) return;
  await db.insert(userDepartmentsTable).values(
    departmentIds.map((deptId, i) => ({ userId, departmentId: deptId, isPrimary: i === 0 }))
  ).onConflictDoNothing();
  await db.update(usersTable)
    .set({ departmentId: departmentIds[0] ?? null })
    .where(eq(usersTable.id, userId));
}

router.post("/admin/users", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.status(400).json({ error: "No workspace assigned" }); return;
  }

  const { firstName, lastName, email, password, role = "member", departmentIds, position, mustResetPassword = false, customRoleId = null } = req.body;

  if (!firstName?.trim()) { res.status(400).json({ error: "First name is required", field: "firstName" }); return; }
  if (!lastName?.trim()) { res.status(400).json({ error: "Last name is required", field: "lastName" }); return; }
  if (!password || String(password).length < 8) { res.status(400).json({ error: "Password must be at least 8 characters", field: "password" }); return; }

  const trimmedEmail = email?.trim() || null;

  if (trimmedEmail) {
    const [emailConflict] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.email, trimmedEmail));
    if (emailConflict) { res.status(409).json({ error: "Email address is already in use", field: "email" }); return; }
  }

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const trimmedEmpNum = await generateEmployeeNumber(req.workspaceId!);
  const passwordHash = await bcrypt.hash(password, 12);
  const primaryDeptId = Array.isArray(departmentIds) && departmentIds.length > 0 ? departmentIds[0] : null;

  const [user] = await db.insert(usersTable).values({
    workspaceId: req.workspaceId,
    email: trimmedEmail,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    fullName,
    employeeNumber: trimmedEmpNum,
    passwordHash,
    position: position?.trim() ?? null,
    departmentId: primaryDeptId,
    role,
    customRoleId: customRoleId ? Number(customRoleId) : null,
    status: "active",
    mustResetPassword: Boolean(mustResetPassword),
  }).returning();

  if (Array.isArray(departmentIds) && departmentIds.length > 0) {
    await syncUserDepartments(user!.id, departmentIds);
  }

  if (trimmedEmail) {
    await db.update(workspaceInvitationsTable)
      .set({ status: "accepted" })
      .where(eq(workspaceInvitationsTable.email, trimmedEmail));
  }

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
  .where(eq(usersTable.id, user!.id));

  // Respond before event side-effects - bus listeners never block the HTTP response.
  res.status(201).json({ ...full, departments: [] });

  // ── Bus: employee.created (Ticket 07 - MIGRATED) ──────────────────────────────
  // Canonical event emission replacing the former eventDispatcher.dispatch() call.
  //
  // Fanout (handled automatically by listeners + bridge):
  //   activity.ts          → inserts activity_logs row (action = "employee_created")
  //   notifications-bus.ts → inserts "employee_created" notifications to workspace
  //                          admins + triggers SSE push via emitToUsers()
  //   bridge               → eventDispatcher.dispatch() → workspace_event_logs + WorkflowEngine
  //
  // Payload fields align with EmployeeCreatedPayload in @workspace/core-events.
  // `isDirectCreate: true` marks this as an admin-initiated creation (vs. invitation flow).
  if (req.workspaceId && user) {
    void appEventBus.emit({
      type:      EVENT_TYPES.EMPLOYEE_CREATED,
      module:    "users",
      workspace: { workspaceId: req.workspaceId },
      actor:     { userId: req.userId, role: req.userRole },
      metadata:  { idempotencyKey: `employee-created-${user.id}`, requestId: String(req.id) },
      data: {
        employeeUserId:  user.id,
        employeeNumber:  user.employeeNumber ?? trimmedEmpNum,
        fullName:        user.fullName,
        role:            user.role,
        departmentId:    user.departmentId ?? null,
        email:           user.email ?? null,
        position:        user.position ?? null,
        isDirectCreate:  true,
      },
    });
  }
});

router.post("/admin/users/:id/reset-password", requireAuth, requireWorkspaceAdmin, async (req: AuthRequest, res): Promise<void> => {
  const userId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const { password } = req.body;
  if (!password || String(password).length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const [user] = await db.select().from(usersTable).where(and(
    eq(usersTable.id, userId),
    req.workspaceId ? eq(usersTable.workspaceId, req.workspaceId) : undefined!
  ));
  if (!user) { res.status(404).json({ error: "User not found in this workspace" }); return; }

  const hash = await bcrypt.hash(password, 12);
  await db.update(usersTable).set({ passwordHash: hash, mustResetPassword: true }).where(eq(usersTable.id, userId));
  res.json({ success: true });
});

export default router;
