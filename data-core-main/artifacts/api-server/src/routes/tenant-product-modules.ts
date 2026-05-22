/**
 * Canonical product access API (workspace_module_settings).
 */
import { Router, type IRouter } from "express";
import { workspacesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  type AuthRequest,
  requireAuth,
  requirePlatformPermission,
} from "../middlewares/requireAuth";
import { listTenantProductModules } from "../lib/platform/tenant-product-modules";
import { moduleGovernanceService } from "../lib/platform/module-governance-service";

const router: IRouter = Router();

router.get(
  "/platform/tenants/:tenantId/product-modules",
  requireAuth,
  requirePlatformPermission("tenants.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = parseInt(String(req.params.tenantId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }
    const [ws] = await db
      .select({ id: workspacesTable.id })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId))
      .limit(1);
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const modules = await listTenantProductModules(workspaceId);
    res.json({ modules });
  },
);

router.patch(
  "/platform/tenants/:tenantId/product-modules/:moduleKey",
  requireAuth,
  requirePlatformPermission("platform.modules.govern"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = parseInt(String(req.params.tenantId ?? ""), 10);
    const moduleKey = String(req.params.moduleKey ?? "").trim();
    if (isNaN(workspaceId) || workspaceId <= 0 || !moduleKey) {
      res.status(400).json({ error: "Invalid tenantId or moduleKey" });
      return;
    }
    const enabled = (req.body as { enabled?: unknown }).enabled === true;
    try {
      const result = await moduleGovernanceService.setModuleEnabled(
        workspaceId,
        moduleKey,
        enabled,
        req.userId,
      );
      const modules = await listTenantProductModules(workspaceId);
      res.json({ module: result, modules });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

export default router;
