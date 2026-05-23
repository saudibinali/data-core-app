import { Router, type IRouter } from "express";
import {
  type AuthRequest,
  requireAuth,
  requirePermission,
  requireSuperAdmin,
} from "../middlewares/requireAuth";
import {
  handleHrImportRuntimeRouteError,
  sendHrImportRuntimeSchemaUnavailable,
  sendPlatformRuntimeSchemaUnavailable,
} from "../lib/hr-import/schema-guard";
import { isHrImportRuntimeSchemaAvailable } from "../lib/hr-import/hr-import-startup";
import { isPlatformRuntimeSchemaAvailable } from "../lib/hr-import/health/platform-runtime-startup";
import { activateWorkspaceRuntime } from "../lib/hr-import/platform/active-cutover-service";
import { rollbackWorkspaceRuntime } from "../lib/hr-import/platform/rollback-orchestration";
import { computeWorkspaceReadiness } from "../lib/hr-import/platform/readiness-service";
import { enforceParityThreshold } from "../lib/hr-import/platform/parity-enforcement";
import { listPlatformEntityRegistry } from "../lib/hr-import/platform/entity-registry";
import { getUniversalTemplateRegistry, getUniversalValidationRegistry } from "../lib/hr-import/platform/universal-expansion";
import {
  getPlatformRuntimeHealthDashboard,
  getPlatformParityDashboard,
  getPlatformRolloutStatusDashboard,
} from "../lib/hr-import/platform/runtime-health-dashboard";

const router: IRouter = Router();

function requireImportSchema(req: AuthRequest, res: import("express").Response): boolean {
  if (isHrImportRuntimeSchemaAvailable()) return true;
  sendHrImportRuntimeSchemaUnavailable(res, undefined, { route: req.path });
  return false;
}

function requirePlatformSchema(req: AuthRequest, res: import("express").Response): boolean {
  if (isPlatformRuntimeSchemaAvailable()) return true;
  sendPlatformRuntimeSchemaUnavailable(res, undefined, { route: req.path });
  return false;
}

function parseWorkspaceId(raw: unknown): number | null {
  const id = parseInt(String(raw ?? ""), 10);
  return Number.isNaN(id) ? null : id;
}

// GET /platform/runtime/health
router.get("/platform/runtime/health", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  try {
    if (!requireImportSchema(req, res)) return;
    if (!requirePlatformSchema(req, res)) return;
    const health = await getPlatformRuntimeHealthDashboard(req.workspaceId ?? undefined);
    res.json(health);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /platform/runtime/health" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Health check failed" });
  }
});

// GET /platform/runtime/parity
router.get("/platform/runtime/parity", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    if (!requireImportSchema(req, res)) return;
    if (!requirePlatformSchema(req, res)) return;
    const sessionId = parseWorkspaceId(req.query.sessionId);
    const dashboard = await getPlatformParityDashboard(req.workspaceId, sessionId ?? undefined);
    res.json(dashboard);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /platform/runtime/parity" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Parity check failed" });
  }
});

// GET /platform/runtime/rollout-status
router.get("/platform/runtime/rollout-status", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  try {
    if (!requirePlatformSchema(req, res)) return;
    const status = await getPlatformRolloutStatusDashboard();
    res.json(status);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /platform/runtime/rollout-status" })) return;
    throw e;
  }
});

// GET /platform/runtime/readiness/:workspaceId
router.get("/platform/runtime/readiness/:workspaceId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (!workspaceId) { res.status(400).json({ error: "Invalid workspaceId" }); return; }
  try {
    if (!requireImportSchema(req, res)) return;
    if (!requirePlatformSchema(req, res)) return;
    const readiness = await computeWorkspaceReadiness(workspaceId);
    res.json(readiness);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /platform/runtime/readiness/:workspaceId" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Readiness check failed" });
  }
});

// GET /platform/runtime/parity/:workspaceId
router.get("/platform/runtime/parity/:workspaceId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = parseWorkspaceId(req.params.workspaceId);
  if (!workspaceId) { res.status(400).json({ error: "Invalid workspaceId" }); return; }
  try {
    if (!requireImportSchema(req, res)) return;
    if (!requirePlatformSchema(req, res)) return;
    const sessionId = parseWorkspaceId(req.query.sessionId);
    const parity = await enforceParityThreshold(workspaceId, sessionId ?? undefined);
    res.json(parity);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /platform/runtime/parity/:workspaceId" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Parity check failed" });
  }
});

// GET /platform/runtime/entities
router.get("/platform/runtime/entities", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  try {
    if (!requirePlatformSchema(req, res)) return;
    const entities = await listPlatformEntityRegistry();
    res.json({
      entities,
      templates: getUniversalTemplateRegistry(),
      validation: getUniversalValidationRegistry(),
    });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /platform/runtime/entities" })) return;
    throw e;
  }
});

// POST /platform/runtime/activate
router.post("/platform/runtime/activate", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = parseWorkspaceId(req.body.workspaceId ?? req.workspaceId);
  if (!workspaceId) { res.status(400).json({ error: "workspaceId required" }); return; }
  try {
    if (!requireImportSchema(req, res)) return;
    if (!requirePlatformSchema(req, res)) return;
    const result = await activateWorkspaceRuntime({
      workspaceId,
      userId: req.userId,
      explicitConfirmation: req.body.explicitConfirmation === true,
      sessionId: parseWorkspaceId(req.body.sessionId) ?? undefined,
    });
    res.status(result.ok ? 200 : 403).json({ ...result, globalForcedActivation: false });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /platform/runtime/activate" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Activation failed" });
  }
});

// POST /platform/runtime/rollback
router.post("/platform/runtime/rollback", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const workspaceId = parseWorkspaceId(req.body.workspaceId ?? req.workspaceId);
  if (!workspaceId) { res.status(400).json({ error: "workspaceId required" }); return; }
  try {
    if (!requireImportSchema(req, res)) return;
    if (!requirePlatformSchema(req, res)) return;
    const result = await rollbackWorkspaceRuntime({
      workspaceId,
      userId: req.userId,
      targetMode: req.body.targetMode,
      explicitConfirmation: req.body.explicitConfirmation === true,
    });
    res.status(result.ok ? 200 : 403).json(result);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /platform/runtime/rollback" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Rollback failed" });
  }
});

export default router;
