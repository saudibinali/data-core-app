import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable, departmentsTable, workspaceCustomRolesTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type AuthRequest, requireAuth } from "../middlewares/requireAuth";
import { isProtectedPlatformAccount } from "../lib/root-platform-owner-policy";
import {
  loadPlatformPasswordPolicy,
  validatePasswordAgainstPolicy,
  passwordPolicyErrorMessage,
} from "../lib/platform-password-policy";
import {
  validatePlatformSelfProfileUpdate,
  validatePlatformSelfEmailUpdate,
  normalizePlatformUserEmail,
} from "../lib/platform-user-lifecycle";

const router: IRouter = Router();

export const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "24h";

const lineManagerAlias = alias(usersTable, "lm_auth");
const customRoleAlias = alias(workspaceCustomRolesTable, "cr_auth");

export function signToken(userId: number, workspaceId: number | null, role: string): string {
  return jwt.sign({ userId, workspaceId, role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as any,
  });
}

const meSelect = {
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
  role: usersTable.role,
  customRoleId: usersTable.customRoleId,
  customRoleName: customRoleAlias.name,
  status: usersTable.status,
  mustResetPassword: usersTable.mustResetPassword,
  platformRoleCode: usersTable.platformRoleCode,
  isRootOwner: usersTable.isRootOwner,
  platformJobTitle: usersTable.platformJobTitle,
  platformDepartment: usersTable.platformDepartment,
  platformPhone: usersTable.platformPhone,
  createdAt: usersTable.createdAt,
  updatedAt: usersTable.updatedAt,
};

/** Super Admin self-service (My Account) — only the signed-in super_admin. */
function requireSuperAdminSelf(req: AuthRequest, res: Response): boolean {
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return false;
  }
  if (req.userRole !== "super_admin") {
    res.status(403).json({
      error: "Forbidden",
      code: "SUPER_ADMIN_ONLY",
      message: "This action is only available to the platform super administrator account.",
    });
    return false;
  }
  return true;
}

function meQuery(userId: number) {
  return db
    .select(meSelect)
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .leftJoin(lineManagerAlias, eq(usersTable.lineManagerId, lineManagerAlias.id))
    .leftJoin(customRoleAlias, eq(usersTable.customRoleId, customRoleAlias.id))
    .where(eq(usersTable.id, userId));
}

/**
 * POST /auth/login
 * Public - employee number + password → JWT access token
 */
router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const { employeeNumber, password } = req.body as { employeeNumber?: string; password?: string };

  if (!employeeNumber || !password) {
    res.status(400).json({ error: "employeeNumber and password are required" });
    return;
  }

  const normalized = String(employeeNumber).trim();

  const [user] = await db
    .select({ id: usersTable.id, passwordHash: usersTable.passwordHash, status: usersTable.status, role: usersTable.role, workspaceId: usersTable.workspaceId })
    .from(usersTable)
    .where(eq(usersTable.employeeNumber, normalized))
    .limit(1);

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid employee number or password" });
    return;
  }

  if (user.status === "inactive") {
    res.status(401).json({ error: "Account is inactive. Contact your administrator." });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid employee number or password" });
    return;
  }

  const accessToken = signToken(user.id, user.workspaceId ?? null, user.role);
  const [full] = await meQuery(user.id);
  res.json({ accessToken, expiresIn: JWT_EXPIRES_IN, user: full });
});

/** POST /auth/logout - client should discard token */
router.post("/auth/logout", (_req: Request, res: Response): void => {
  res.json({ success: true });
});

/** GET /auth/me - validate stored token and return current user */
router.get("/auth/me", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [full] = await meQuery(req.userId);
  if (!full) { res.status(404).json({ error: "User not found" }); return; }
  res.json(full);
});

/** POST /auth/change-password - user changes their own password */
router.post("/auth/change-password", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  const policy = req.userRole === "super_admin"
    ? await loadPlatformPasswordPolicy()
    : { minLength: 8, requireUppercase: false, requireSpecial: false, requireNumber: false };

  const strength = validatePasswordAgainstPolicy(String(newPassword), policy);
  if (!strength.valid) {
    res.status(400).json({
      error: passwordPolicyErrorMessage(strength.errors, policy),
      codes: strength.errors,
    });
    return;
  }

  const [user] = await db.select({ passwordHash: usersTable.passwordHash }).from(usersTable).where(eq(usersTable.id, req.userId));
  if (!user?.passwordHash) { res.status(400).json({ error: "No password set for this account" }); return; }

  const validCurrent = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!validCurrent) { res.status(401).json({ error: "Current password is incorrect" }); return; }

  const hash = await bcrypt.hash(newPassword, 12);
  await db.update(usersTable).set({ passwordHash: hash, mustResetPassword: false }).where(eq(usersTable.id, req.userId));
  res.json({ success: true });
});

/** PATCH /auth/me/profile - super_admin updates own profile */
router.patch("/auth/me/profile", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireSuperAdminSelf(req, res)) return;

  const payload = req.body as {
    displayName?: string;
    jobTitle?: string | null;
    department?: string | null;
    phone?: string | null;
  };

  const validation = validatePlatformSelfProfileUpdate(payload);
  if (!validation.valid) {
    res.status(400).json({ error: "Validation failed", codes: validation.errors });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {
    updatedAt: new Date(),
    platformUpdatedBy: req.userId,
  };
  if (payload.displayName !== undefined) updates.fullName = payload.displayName.trim();
  if (payload.jobTitle !== undefined) updates.platformJobTitle = payload.jobTitle?.trim() || null;
  if (payload.department !== undefined) updates.platformDepartment = payload.department?.trim() || null;
  if (payload.phone !== undefined) {
    const p = payload.phone?.trim() || null;
    updates.platformPhone = p;
    updates.phoneNumber = p;
  }

  await db.update(usersTable).set(updates).where(eq(usersTable.id, req.userId!));
  const [full] = await meQuery(req.userId!);
  res.json({ success: true, profile: full });
});

/** PATCH /auth/me/email - super_admin updates own email */
router.patch("/auth/me/email", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!requireSuperAdminSelf(req, res)) return;

  const payload = req.body as { email?: string; currentPassword?: string };
  const validation = validatePlatformSelfEmailUpdate(payload);
  if (!validation.valid) {
    res.status(400).json({ error: "Validation failed", codes: validation.errors });
    return;
  }

  const normalizedEmail = normalizePlatformUserEmail(payload.email!);

  const [user] = await db
    .select({ passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  if (!user?.passwordHash) {
    res.status(400).json({ error: "No password set for this account" });
    return;
  }

  const validCurrent = await bcrypt.compare(String(payload.currentPassword), user.passwordHash);
  if (!validCurrent) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const [duplicate] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.email, normalizedEmail), ne(usersTable.id, req.userId!)))
    .limit(1);

  if (duplicate) {
    res.status(409).json({ error: "A user with this email already exists", code: "DUPLICATE_EMAIL" });
    return;
  }

  await db
    .update(usersTable)
    .set({ email: normalizedEmail, updatedAt: new Date(), platformUpdatedBy: req.userId })
    .where(eq(usersTable.id, req.userId!));

  res.json({ success: true, email: normalizedEmail });
});

/** POST /auth/reset-password - admin resets another user's password */
router.post("/auth/reset-password", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!req.userRole || !["admin", "super_admin"].includes(req.userRole)) {
    res.status(403).json({ error: "Requires admin role" }); return;
  }

  const { userId, password } = req.body as { userId?: number; password?: string };
  if (!userId || !password) { res.status(400).json({ error: "userId and password are required" }); return; }
  if (String(password).length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const conditions: Parameters<typeof and>  = [eq(usersTable.id, Number(userId))];
  if (req.userRole !== "super_admin" && req.workspaceId) {
    conditions.push(eq(usersTable.workspaceId, req.workspaceId));
  }

  const [target] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
      isProtected: usersTable.isProtected,
    })
    .from(usersTable)
    .where(and(...conditions));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  if (
    req.userId !== Number(userId) &&
    isProtectedPlatformAccount({
      id: target.id,
      role: target.role,
      workspaceId: target.workspaceId,
      platformRoleCode: target.platformRoleCode,
      isRootOwner: target.isRootOwner,
      isProtected: target.isProtected,
    })
  ) {
    res.status(403).json({
      error: "Cannot reset password for a protected platform owner account",
      code: "ROOT_PASSWORD_RESET_BLOCKED",
    });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await db.update(usersTable).set({ passwordHash: hash, mustResetPassword: true }).where(eq(usersTable.id, Number(userId)));
  res.json({ success: true });
});

export default router;
