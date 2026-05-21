/**
 * @file   routes/platform-me.ts
 *
 * Platform user identity + self-service account management.
 * Only the authenticated platform user may update their own profile/credentials.
 */

import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { type AuthRequest, requireAuth } from "../middlewares/requireAuth";
import { getPlatformUserRoleCode } from "../lib/platform-permissions";
import { resolvePlatformUserEffectivePermissions } from "../lib/platform-effective-permissions";
import {
  isProtectedPlatformAccount,
  canSelfChangePlatformUserPassword,
  canSelfChangePlatformUserEmail,
  canSelfUpdatePlatformUserProfile,
} from "../lib/root-platform-owner-policy";
import {
  validatePlatformSelfProfileUpdate,
  validatePlatformSelfEmailUpdate,
  normalizePlatformUserEmail,
} from "../lib/platform-user-lifecycle";
import {
  loadPlatformPasswordPolicy,
  validatePasswordAgainstPolicy,
  passwordPolicyErrorMessage,
} from "../lib/platform-password-policy";
import { canAccessPlatformSelfManagement } from "../lib/platform-scope";

const router = Router();

function platformSelfServiceGuard(req: AuthRequest, res: Response): boolean {
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return false;
  }
  if (
    !canAccessPlatformSelfManagement({
      role: req.userRole,
      workspaceId: req.workspaceId,
      isRootOwner: req.isRootOwner,
    })
  ) {
    res.status(403).json({
      error: "Forbidden",
      code: "NOT_PLATFORM_SELF_SERVICE",
      message: "My Account is only available to platform super administrators.",
    });
    return false;
  }
  return true;
}

function selfIdentity(req: AuthRequest) {
  return {
    id: req.userId,
    email: req.userEmail ?? null,
    role: req.userRole ?? "",
    workspaceId: req.workspaceId,
    platformRoleCode: req.platformRoleCode,
    isRootOwner: req.isRootOwner,
  };
}

router.get(
  "/platform/me",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!platformSelfServiceGuard(req, res)) return;

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        fullName: usersTable.fullName,
        role: usersTable.role,
        workspaceId: usersTable.workspaceId,
        platformRoleCode: usersTable.platformRoleCode,
        isRootOwner: usersTable.isRootOwner,
        status: usersTable.status,
        platformJobTitle: usersTable.platformJobTitle,
        platformDepartment: usersTable.platformDepartment,
        platformPhone: usersTable.platformPhone,
        employeeNumber: usersTable.employeeNumber,
        mustResetPassword: usersTable.mustResetPassword,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!));

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const identity = {
      role: user.role,
      platformRoleCode: user.platformRoleCode,
      isRootOwner: user.isRootOwner,
    };

    const effectiveRoleCode = getPlatformUserRoleCode(identity);
    const resolved = await resolvePlatformUserEffectivePermissions(user.id);
    const permissions = resolved?.effectivePermissions ?? [];

    const isProtected = isProtectedPlatformAccount({
      id: user.id,
      role: user.role,
      workspaceId: user.workspaceId,
      platformRoleCode: user.platformRoleCode,
      isRootOwner: user.isRootOwner,
    });

    res.json({
      id: user.id,
      email: user.email,
      displayName: user.fullName,
      role: user.role,
      workspaceId: user.workspaceId,
      platformRoleCode: user.platformRoleCode,
      effectivePlatformRoleCode: effectiveRoleCode,
      isRootOwner: user.isRootOwner,
      isProtected,
      permissions,
      jobTitle: user.platformJobTitle,
      department: user.platformDepartment,
      phone: user.platformPhone,
      employeeNumber: user.employeeNumber,
      mustResetPassword: user.mustResetPassword,
      canSelfManageAccount: true,
    });
  },
);

router.patch(
  "/platform/me/profile",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!platformSelfServiceGuard(req, res)) return;

    const actor = selfIdentity(req);
    const target = { ...actor };
    const profileCheck = canSelfUpdatePlatformUserProfile(actor, target);
    if (!profileCheck.allowed) {
      res.status(403).json({ error: "Forbidden", code: profileCheck.blockedReason });
      return;
    }

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
      platformUpdatedBy: req.userId,
      updatedAt: new Date(),
    };
    if (payload.displayName !== undefined) updates.fullName = payload.displayName.trim();
    if (payload.jobTitle !== undefined) updates.platformJobTitle = payload.jobTitle?.trim() || null;
    if (payload.department !== undefined) updates.platformDepartment = payload.department?.trim() || null;
    if (payload.phone !== undefined) updates.platformPhone = payload.phone?.trim() || null;

    await db.update(usersTable).set(updates).where(eq(usersTable.id, req.userId!));

    const [updated] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        fullName: usersTable.fullName,
        platformJobTitle: usersTable.platformJobTitle,
        platformDepartment: usersTable.platformDepartment,
        platformPhone: usersTable.platformPhone,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!));

    req.log.info({ userId: req.userId }, "PATCH /platform/me/profile");
    res.json({ success: true, profile: updated });
  },
);

router.patch(
  "/platform/me/email",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!platformSelfServiceGuard(req, res)) return;

    const actor = selfIdentity(req);
    const target = { ...actor };
    const emailCheck = canSelfChangePlatformUserEmail(actor, target);
    if (!emailCheck.allowed) {
      res.status(403).json({ error: "Forbidden", code: emailCheck.blockedReason });
      return;
    }

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
      .where(
        and(
          eq(usersTable.email, normalizedEmail),
          ne(usersTable.id, req.userId!),
        ),
      )
      .limit(1);

    if (duplicate) {
      res.status(409).json({ error: "A user with this email already exists", code: "DUPLICATE_EMAIL" });
      return;
    }

    await db
      .update(usersTable)
      .set({ email: normalizedEmail, updatedAt: new Date(), platformUpdatedBy: req.userId })
      .where(eq(usersTable.id, req.userId!));

    req.log.info({ userId: req.userId }, "PATCH /platform/me/email");
    res.json({ success: true, email: normalizedEmail });
  },
);

router.post(
  "/platform/me/change-password",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!platformSelfServiceGuard(req, res)) return;

    const actor = selfIdentity(req);
    const target = { ...actor };
    const pwCheck = canSelfChangePlatformUserPassword(actor, target);
    if (!pwCheck.allowed) {
      res.status(403).json({ error: "Forbidden", code: pwCheck.blockedReason });
      return;
    }

    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword and newPassword are required" });
      return;
    }

    if (String(currentPassword) === String(newPassword)) {
      res.status(400).json({ error: "New password must be different from the current password" });
      return;
    }

    const policy = await loadPlatformPasswordPolicy();
    const strength = validatePasswordAgainstPolicy(String(newPassword), policy);
    if (!strength.valid) {
      res.status(400).json({
        error: passwordPolicyErrorMessage(strength.errors, policy),
        codes: strength.errors,
      });
      return;
    }

    const [user] = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!));

    if (!user?.passwordHash) {
      res.status(400).json({ error: "No password set for this account" });
      return;
    }

    const validCurrent = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!validCurrent) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const hash = await bcrypt.hash(String(newPassword), 12);
    await db
      .update(usersTable)
      .set({
        passwordHash: hash,
        mustResetPassword: false,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, req.userId!));

    req.log.info({ userId: req.userId }, "POST /platform/me/change-password");
    res.json({ success: true, message: "Password updated successfully" });
  },
);

export default router;
