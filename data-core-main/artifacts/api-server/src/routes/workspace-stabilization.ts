import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { platformStabilizationService } from "../lib/platform/platform-stabilization-service";
import { workspaceGoLiveService } from "../lib/platform/workspace-go-live-service";

const router: IRouter = Router();

router.get(
  "/workspace/stabilization",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    if (!req.workspaceId) return res.status(403).json({ error: "Workspace required" });
    res.json(await platformStabilizationService.workspaceSnapshot(req.workspaceId));
  },
);

router.get(
  "/workspace/go-live",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    if (!req.workspaceId) return res.status(403).json({ error: "Workspace required" });
    res.json(await workspaceGoLiveService.evaluate(req.workspaceId));
  },
);

export default router;
