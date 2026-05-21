/**
 * @file   routes/tenant-subscription.ts
 * @phase  P16-G - Tenant Subscription Visibility (GET only)
 *
 * GET /tenant/subscription/summary
 * GET /tenant/subscription/entitlements
 * GET /tenant/subscription/quotas
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { TENANT_SUBSCRIPTION_PERMISSIONS } from "../lib/tenant-subscription-config";
import {
  buildTenantSubscriptionSummary,
  buildTenantSubscriptionEntitlements,
  buildTenantSubscriptionQuotas,
} from "../lib/tenant-subscription-visibility";

const router: IRouter = Router();

const PERM_READ = TENANT_SUBSCRIPTION_PERMISSIONS.READ;
const PERM_ENTITLEMENTS = TENANT_SUBSCRIPTION_PERMISSIONS.ENTITLEMENTS_READ;
const PERM_QUOTAS = TENANT_SUBSCRIPTION_PERMISSIONS.QUOTAS_READ;

function requireWorkspaceMember(req: AuthRequest, res: Response): number | null {
  if (req.userRole === "super_admin") {
    res.status(403).json({ error: "Tenant subscription visibility is not available for platform users" });
    return null;
  }
  const workspaceId = req.workspaceId;
  if (!workspaceId) {
    res.status(403).json({ error: "No workspace context" });
    return null;
  }
  return workspaceId;
}

function hasTenantPermission(req: AuthRequest, perm: string): boolean {
  if (req.userRole === "admin" || req.userRole === "manager") return true;
  const perms = req.userPermissions ?? [];
  return perms.includes(perm);
}

function requireAnyTenantPermission(...required: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    for (const perm of required) {
      if (hasTenantPermission(authReq, perm)) {
        next();
        return;
      }
    }
    res.status(403).json({
      error: "Permission denied",
      required: required.join(" or "),
    });
  };
}

router.get(
  "/tenant/subscription/summary",
  requireAuth,
  requirePermission(PERM_READ),
  async (req: AuthRequest, res) => {
    const workspaceId = requireWorkspaceMember(req, res);
    if (workspaceId === null) return;

    const summary = await buildTenantSubscriptionSummary(workspaceId);
    res.json({ summary });
  },
);

router.get(
  "/tenant/subscription/entitlements",
  requireAuth,
  requireAnyTenantPermission(PERM_ENTITLEMENTS, PERM_READ),
  async (req: AuthRequest, res) => {
    const workspaceId = requireWorkspaceMember(req, res);
    if (workspaceId === null) return;

    const entitlements = await buildTenantSubscriptionEntitlements(workspaceId);
    res.json(entitlements);
  },
);

router.get(
  "/tenant/subscription/quotas",
  requireAuth,
  requireAnyTenantPermission(PERM_QUOTAS, PERM_READ),
  async (req: AuthRequest, res) => {
    const workspaceId = requireWorkspaceMember(req, res);
    if (workspaceId === null) return;

    const quotas = await buildTenantSubscriptionQuotas(workspaceId);
    res.json(quotas);
  },
);

export default router;
