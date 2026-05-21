/**
 * @file   routes/tenant-workspace-access.ts
 * @phase  P16-E - Tenant-facing workspace access mode (read-only for UI banner)
 *
 * GET /tenant/workspace-access
 */

import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth } from "../middlewares/requireAuth";
import { resolveWorkspaceAccessMode } from "../lib/workspace-access-resolver";

const router: IRouter = Router();

router.get("/tenant/workspace-access", requireAuth, async (req: AuthRequest, res) => {
  if (req.userRole === "super_admin") {
    res.json({
      access: {
        enforcementStatus: "normal",
        allowLogin: true,
        allowRead: true,
        allowCreate: true,
        allowUpdate: true,
        allowDelete: true,
        allowExport: true,
        allowAdminAccess: true,
        reason: null,
        isPlatformUser: true,
      },
    });
    return;
  }

  const workspaceId = req.workspaceId;
  if (!workspaceId) {
    res.status(403).json({ error: "No workspace context" });
    return;
  }

  const access = await resolveWorkspaceAccessMode(workspaceId);
  res.json({
    access: {
      enforcementStatus: access.enforcementStatus,
      allowLogin: access.allowLogin,
      allowRead: access.allowRead,
      allowCreate: access.allowCreate,
      allowUpdate: access.allowUpdate,
      allowDelete: access.allowDelete,
      allowExport: access.allowExport,
      allowAdminAccess: access.allowAdminAccess,
      reason: access.reason,
      subscriptionStatus: access.subscriptionStatus,
    },
  });
});

export default router;
