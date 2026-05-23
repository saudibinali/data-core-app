import { Router, type IRouter } from "express";
import {
  type AuthRequest,
  requireAuth,
  requirePermission,
  requireSuperAdmin,
} from "../middlewares/requireAuth";
import { getLegacyAuditReport } from "../lib/workforce/stabilization/legacy-audit-inventory";
import { getWorkforceRuntimeHealth } from "../lib/workforce/stabilization/runtime-health-service";
import { getLegacyUsageSummary, getRecentLegacyUsageEvents } from "../lib/workforce/stabilization/usage-telemetry";
import { getGovernanceCutoverReadiness } from "../lib/workforce/stabilization/governance-finalization";
import { getRuntimeMetrics } from "../lib/workforce/stabilization/observability-metrics";
import { handleLegacyCompatRouteError } from "../lib/workforce/stabilization/schema-guard";

const router: IRouter = Router();

// GET /health/workforce — platform/runtime health (optional workspace scope via query)
router.get("/health/workforce", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const workspaceId = req.query.workspaceId
      ? parseInt(String(req.query.workspaceId), 10)
      : req.workspaceId ?? undefined;
    const health = await getWorkforceRuntimeHealth(
      workspaceId && !Number.isNaN(workspaceId) ? workspaceId : undefined,
    );
    res.json(health);
  } catch (e) {
    if (handleLegacyCompatRouteError(res, e, { route: "GET /health/workforce" })) return;
    throw e;
  }
});

// GET /health/workforce/schema — schema registry snapshot
router.get("/health/workforce/schema", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  try {
    const health = await getWorkforceRuntimeHealth();
    res.json({
      status: health.schema.allOk ? "ok" : "degraded",
      schema: health.schema,
      migrationTargets: health.migrationTargets,
      migrationHint: health.migrationHint,
    });
  } catch (e) {
    if (handleLegacyCompatRouteError(res, e, { route: "GET /health/workforce/schema" })) return;
    throw e;
  }
});

// GET /health/workforce/metrics — in-process runtime metrics
router.get("/health/workforce/metrics", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  res.json({ metrics: getRuntimeMetrics(), note: "In-process counters; reset on restart" });
});

// GET /hr/legacy-audit — static dependency inventory
router.get("/hr/legacy-audit", requireAuth, requirePermission("hr.view"), async (_req, res): Promise<void> => {
  res.json(getLegacyAuditReport());
});

// GET /hr/legacy-usage — workspace telemetry summary
router.get("/hr/legacy-usage", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    const days = Math.min(parseInt(String(req.query.days ?? "30"), 10) || 30, 90);
    const summary = await getLegacyUsageSummary(req.workspaceId, days);
    const recent = await getRecentLegacyUsageEvents(req.workspaceId, 25);
    res.json({ summary, recent, days });
  } catch (e) {
    if (handleLegacyCompatRouteError(res, e, { route: "GET /hr/legacy-usage" })) return;
    throw e;
  }
});

// GET /hr/settings/cutover-readiness — governance + cleanup gate checklist
router.get("/hr/settings/cutover-readiness", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    const readiness = await getGovernanceCutoverReadiness(req.workspaceId);
    res.json(readiness);
  } catch (e) {
    if (handleLegacyCompatRouteError(res, e, { route: "GET /hr/settings/cutover-readiness" })) return;
    throw e;
  }
});

export default router;
