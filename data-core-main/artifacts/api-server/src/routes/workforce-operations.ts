import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { operationsService } from "../lib/workforce-ops/operations-service";
import { replayService } from "../lib/workforce-ops/replay-service";
import { exportJobService } from "../lib/reports/export-job-service";
import { logAttendanceAccess } from "../lib/workforce-attendance/access-log";
import { db, employeesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const router: IRouter = Router();

function requireWorkspace(req: AuthRequest, res: import("express").Response): number | null {
  if (!req.workspaceId) {
    res.status(403).json({ error: "Workspace required" });
    return null;
  }
  return req.workspaceId;
}

// ── Overview & monitoring ─────────────────────────────────────────────────────

router.get(
  "/hr/workforce/ops/overview",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    res.json(await operationsService.getOverview(ws));
  },
);

router.get(
  "/hr/workforce/ops/metrics",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    const [raw, sync, trends] = await Promise.all([
      operationsService.getRawEventHealth(ws),
      operationsService.getSyncMetrics(ws),
      operationsService.getWarningTrends(ws),
    ]);
    res.json({ rawEventHealth: raw, syncMetrics: sync, warningTrends: trends });
  },
);

router.get(
  "/hr/workforce/ops/warnings",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    res.json({ alerts: await operationsService.evaluateAlerts(ws) });
  },
);

router.get(
  "/hr/workforce/ops/integrations/health",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    res.json(await operationsService.getIntegrationHealthList(ws));
  },
);

router.get(
  "/hr/workforce/ops/integrations/:id/health",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    try {
      res.json(await operationsService.getIntegrationHealth(ws, Number(req.params.id)));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/hr/workforce/ops/stale-integrations",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    const all = await operationsService.getIntegrationHealthList(ws);
    res.json(all.filter((i) => i.stale));
  },
);

// ── Raw events ────────────────────────────────────────────────────────────────

router.get(
  "/hr/workforce/ops/raw-events",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    const q = req.query as Record<string, string>;
    const rows = await operationsService.listRawEvents(ws, {
      status: q.status,
      dateFrom: q.dateFrom,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
    res.json(rows);
  },
);

router.get(
  "/hr/workforce/ops/raw-events/:id",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    try {
      const mask = req.query.unmask !== "1";
      res.json(await operationsService.getRawEventDetail(ws, Number(req.params.id), mask));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/workforce/ops/raw-events/:id/replay",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    try {
      const body = (req.body ?? {}) as { breakGlass?: boolean; reason?: string };
      const result = await replayService.replayRawEvent(
        ws,
        Number(req.params.id),
        req.userId,
        body.breakGlass ? { breakGlass: true, breakGlassReason: body.reason } : undefined,
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/workforce/ops/raw-events/:id/retry-normalization",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    try {
      const body = (req.body ?? {}) as { breakGlass?: boolean; reason?: string };
      const result = await replayService.retryNormalization(
        ws,
        Number(req.params.id),
        req.userId,
        body.breakGlass ? { breakGlass: true, breakGlassReason: body.reason } : undefined,
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/workforce/ops/raw-events/:id/ignore",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    try {
      await replayService.markRawEventIgnored(ws, Number(req.params.id), req.userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── Sync jobs ─────────────────────────────────────────────────────────────────

router.get(
  "/hr/workforce/ops/sync-jobs",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    const q = req.query as Record<string, string>;
    const rows = await operationsService.listSyncJobs(ws, {
      status: q.status,
      integrationId: q.integrationId ? Number(q.integrationId) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    res.json(
      rows.map((r) => ({
        ...r.job,
        integrationName: r.integrationName,
        connectorKey: r.connectorKey,
        cursor: r.job.cursorJson ? JSON.parse(r.job.cursorJson) : null,
      })),
    );
  },
);

router.post(
  "/hr/workforce/ops/sync-jobs/:id/retry",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    try {
      res.json(await replayService.retrySyncJob(ws, Number(req.params.id), req.userId));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/workforce/ops/sync-jobs/:id/cancel",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    try {
      res.json(await replayService.cancelSyncJob(ws, Number(req.params.id), req.userId));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/workforce/ops/sync-jobs/:id/replay-dead-letter",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    try {
      res.json(await replayService.replayDeadLetterJob(ws, Number(req.params.id), req.userId));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── Employee mappings ─────────────────────────────────────────────────────────

router.get(
  "/hr/workforce/ops/employee-mappings/unresolved",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    const q = req.query as Record<string, string>;
    const rows = await operationsService.listUnresolvedMappings(
      ws,
      q.integrationId ? Number(q.integrationId) : undefined,
    );
    res.json(
      rows.map((r) => ({
        ...r.map,
        integrationName: r.integrationName,
      })),
    );
  },
);

router.post(
  "/hr/workforce/ops/employee-mappings/bulk-resolve",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    const body = req.body as {
      items?: Array<{ integrationId: number; externalEmployeeId: string; employeeId: number }>;
    };
    if (!body.items?.length) {
      res.status(400).json({ error: "items array required" });
      return;
    }
    for (const item of body.items) {
      const [emp] = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, item.employeeId), eq(employeesTable.workspaceId, ws)))
        .limit(1);
      if (!emp) {
        res.status(400).json({ error: `Employee ${item.employeeId} not in workspace` });
        return;
      }
    }
    logAttendanceAccess({
      workspaceId: ws,
      userId: req.userId,
      action: "bulk_resolve_mappings",
      resourceType: "attendance_integration_employee_map",
      metadata: { count: body.items.length },
    });
    res.json(await operationsService.bulkResolveMappings(ws, body.items, req.userId));
  },
);

router.post(
  "/hr/workforce/ops/employee-mappings/:id/ignore",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    try {
      res.json(await operationsService.ignoreMapping(ws, Number(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── Import issues ─────────────────────────────────────────────────────────────

router.get(
  "/hr/workforce/ops/import-issues",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null) return;
    res.json(await operationsService.getImportIssues(ws));
  },
);

// ── Operational reports ─────────────────────────────────────────────────────────

const OPS_REPORT_KEYS = new Set([
  "hr.workforce.integration.activity",
  "hr.workforce.sync.failures",
  "hr.workforce.unresolved.mappings",
  "hr.workforce.attendance.warnings",
]);

router.post(
  "/hr/workforce/ops/reports/generate",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res) => {
    const ws = requireWorkspace(req, res);
    if (ws == null || !req.userId) return;
    const { reportDefinitionKey } = req.body as { reportDefinitionKey?: string };
    if (!reportDefinitionKey || !OPS_REPORT_KEYS.has(reportDefinitionKey)) {
      res.status(400).json({ error: "Invalid reportDefinitionKey" });
      return;
    }
    try {
      const { job, generatedReport } = await exportJobService.createReportJob({
        workspaceId: ws,
        userId: req.userId,
        userRole: req.userRole,
        userPermissions: req.userPermissions,
        reportDefinitionKey,
        format: "json",
      });
      res.status(202).json({ jobId: job.id, generatedReportId: generatedReport.id });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

export default router;
