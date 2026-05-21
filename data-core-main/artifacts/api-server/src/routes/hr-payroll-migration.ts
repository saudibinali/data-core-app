import { Router } from "express";
import { requireAuth, requirePermission, requireWorkspaceAdmin, type AuthRequest } from "../middlewares/requireAuth";
import {
  getPayrollMigrationReport,
  runPayrollMigration,
} from "../lib/payroll/payroll-migration-service";

const router = Router();

router.get(
  "/hr/payroll-migration/report",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
    res.json(await getPayrollMigrationReport(workspaceId));
  },
);

router.post(
  "/hr/payroll-migration/run",
  requireAuth,
  requireWorkspaceAdmin,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const body = (req.body ?? {}) as { dryRun?: boolean; limit?: number };
    const result = await runPayrollMigration(workspaceId, {
      dryRun: body.dryRun !== false,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      userId: req.userId,
    });
    res.json(result);
  },
);

export default router;
