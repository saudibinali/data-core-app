/**
 * @phase P17-C - Read-only platform admin protection policy API
 */

import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requireAnyPlatformPermission } from "../middlewares/requireAuth";
import { getSafePolicySnapshot } from "../lib/platform-admin-protection-policy-config";
import {
  CRITICAL_PLATFORM_PERMISSIONS,
  PROTECTED_PERMISSION_PATTERNS,
} from "../lib/platform-admin-protection-policy-config";

const router: IRouter = Router();

router.get(
  "/platform/admin-protection-policy",
  requireAuth,
  requireAnyPlatformPermission(["platform.permissions.read", "platform.users.read"]),
  async (_req: AuthRequest, res): Promise<void> => {
    res.json({
      policy: getSafePolicySnapshot(),
      criticalPlatformPermissions: [...CRITICAL_PLATFORM_PERMISSIONS],
      protectedPermissionPatterns: [...PROTECTED_PERMISSION_PATTERNS],
    });
  },
);

export default router;
