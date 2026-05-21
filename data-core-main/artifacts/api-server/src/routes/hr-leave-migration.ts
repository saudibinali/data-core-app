import { Router } from "express";
import { requireAuth, requireWorkspaceAdmin, type AuthRequest } from "../middlewares/requireAuth";
import {
  getLeaveMigrationReport,
  runLeaveMigration,
} from "../lib/hr/leave-migration-service";

const router = Router();

router.get(
  "/hr/leave-migration/report",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
    const report = await getLeaveMigrationReport(workspaceId);
    res.json(report);
  },
);

router.post(
  "/hr/leave-migration/run",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) { res.status(403).json({ error: "No workspace" }); return; }

    const body = (req.body ?? {}) as { dryRun?: boolean; limit?: number };
    const dryRun = body.dryRun !== false;
    const limit = typeof body.limit === "number" ? body.limit : undefined;

    const result = await runLeaveMigration(workspaceId, { dryRun, limit });
    res.json(result);
  },
);

export default router;
