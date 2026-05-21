/**
 * P23-A — Platform governance & control plane routes
 */
import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requirePlatformPermission, requireAnyPlatformPermission } from "../middlewares/requireAuth";
import { platformGovernanceOpsService } from "../lib/platform/platform-governance-ops-service";
import { workspaceConfigurationService } from "../lib/platform/workspace-configuration-service";
import { moduleGovernanceService } from "../lib/platform/module-governance-service";
import { supportGovernanceService } from "../lib/platform/support-governance-service";

const router: IRouter = Router();

router.get(
  "/platform/governance/ops/overview",
  requireAuth,
  requirePlatformPermission("platform.governance.ops.read"),
  async (_req: AuthRequest, res): Promise<void> => {
    const overview = await platformGovernanceOpsService.getOverview();
    res.json(overview);
  },
);

router.get(
  "/platform/governance/workspaces/:workspaceId/configuration",
  requireAuth,
  requirePlatformPermission("tenants.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = parseInt(String(req.params.workspaceId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid workspaceId" });
      return;
    }
    const snapshot = await workspaceConfigurationService.getGroupedSnapshot(workspaceId);
    res.json(snapshot);
  },
);

router.patch(
  "/platform/governance/workspaces/:workspaceId/modules/:moduleKey",
  requireAuth,
  requirePlatformPermission("platform.modules.govern"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = parseInt(String(req.params.workspaceId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid workspaceId" });
      return;
    }
    const moduleKey = String(req.params.moduleKey ?? "").trim();
    if (!moduleKey) {
      res.status(400).json({ error: "moduleKey required" });
      return;
    }
    const body = req.body as { enabled?: unknown };
    const enabled = body.enabled === true;
    try {
      const result = await moduleGovernanceService.setModuleEnabled(
        workspaceId,
        moduleKey,
        enabled,
        req.userId,
      );
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  },
);

router.post(
  "/platform/governance/support-sessions/start",
  requireAuth,
  requirePlatformPermission("platform.support.session.start"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = req.body as {
      targetWorkspaceId?: unknown;
      targetUserId?: unknown;
      scopes?: unknown;
      breakGlass?: unknown;
      consentReference?: unknown;
    };
    const targetWorkspaceId = Number(body.targetWorkspaceId);
    const targetUserId = Number(body.targetUserId);
    const scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
    if (!req.userId || isNaN(targetWorkspaceId) || isNaN(targetUserId)) {
      res.status(400).json({ error: "targetWorkspaceId and targetUserId required" });
      return;
    }
    try {
      const session = await supportGovernanceService.startSession({
        actorUserId: req.userId,
        targetWorkspaceId,
        targetUserId,
        scopes,
        breakGlass: body.breakGlass === true,
        consentReference: body.consentReference ? String(body.consentReference) : undefined,
      });
      res.status(201).json({ session });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  },
);

router.post(
  "/platform/governance/support-sessions/:sessionId/end",
  requireAuth,
  requirePlatformPermission("platform.support.session.end"),
  async (req: AuthRequest, res): Promise<void> => {
    const sessionId = parseInt(String(req.params.sessionId ?? ""), 10);
    if (!req.userId || isNaN(sessionId)) {
      res.status(400).json({ error: "Invalid session" });
      return;
    }
    try {
      const row = await supportGovernanceService.endSession(sessionId, req.userId);
      res.json({ session: row });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  },
);

router.get(
  "/platform/governance/support-sessions/active",
  requireAuth,
  requireAnyPlatformPermission(["platform.support.session.start", "platform.support.session.end"]),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rows = await supportGovernanceService.listActiveForActor(req.userId);
    res.json({ sessions: rows });
  },
);

export default router;
