/**
 * @file   routes/platform-me.ts
 * @phase  P14-C - Platform Access Boundary & Route Guards
 *
 * GET /platform/me
 *
 * Returns the authenticated platform user's identity, effective role, and
 * derived permission list. Platform users only - workspace-scoped users receive 403.
 *
 * Safety:
 *   - No profile editing, password, email, SSO, or MFA.
 *   - No DB audit write - req.log.info only.
 *   - Legacy root (platformRoleCode IS NULL) → effectivePlatformRoleCode = root_platform_owner.
 */

import { Router, type Response } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type AuthRequest, requireAuth } from "../middlewares/requireAuth";
import { getPlatformUserRoleCode } from "../lib/platform-permissions";
import { resolvePlatformUserEffectivePermissions } from "../lib/platform-effective-permissions";
import { isProtectedPlatformAccount } from "../lib/root-platform-owner-policy";

const router = Router();

/**
 * GET /platform/me
 *
 * Returns:
 *   id, email, displayName, role, workspaceId,
 *   platformRoleCode, effectivePlatformRoleCode,
 *   isRootOwner, isProtected, permissions[]
 *
 * 401 - no valid token
 * 403 - caller is a workspace-scoped user, not a platform user
 * 404 - user row missing (should not happen)
 */
router.get(
  "/platform/me",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Platform users: role = super_admin AND no workspace
    if (req.userRole !== "super_admin" || req.workspaceId !== null) {
      res.status(403).json({
        error: "Forbidden",
        code: "NOT_PLATFORM_USER",
        message: "This endpoint is only accessible to platform administration users.",
      });
      return;
    }

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
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId));

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

    req.log.info(
      { userId: user.id, effectiveRoleCode, permissionCount: permissions.length },
      "GET /platform/me",
    );

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
    });
  },
);

export default router;
