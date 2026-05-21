import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requirePermission, requirePlatformPermission } from "../middlewares/requireAuth";
import { reportService } from "../lib/reports/report-service";
import { exportJobService } from "../lib/reports/export-job-service";
import { reportDefinitionRegistry } from "../lib/reports/report-definition-registry";
import { assertExportAuthorized } from "../lib/reports/export-authorization";
import { scheduledReportService } from "../lib/reports/scheduled-report-service";
import { getWorkspaceBranding, upsertWorkspaceBranding } from "../lib/reports/workspace-branding";

const router: IRouter = Router();

router.get("/reports/definitions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  res.json(reportDefinitionRegistry.list());
});

router.post(
  "/reports/export-jobs",
  requireAuth,
  async (req: AuthRequest, res, next): Promise<void> => {
    const key = String((req.body as { reportDefinitionKey?: string })?.reportDefinitionKey ?? "");
    if (key.startsWith("platform.")) {
      await requirePlatformPermission("platform.governance.ops.read")(req, res, next);
      return;
    }
    requirePermission("hr.manage")(req, res, next);
  },
  async (req: AuthRequest, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const reportDefinitionKey = String(body.reportDefinitionKey ?? "");
  const format = String(body.format ?? "xlsx");
  const parameters = (body.parameters ?? body.filterParams) as Record<string, string> | undefined;

  try {
    await assertExportAuthorized(req, reportDefinitionKey);
    const result = await reportService.createReportJob(req, {
      reportDefinitionKey,
      format,
      parameters,
      mode: "async",
    });
    res.status(201).json({
      job: result.job,
      generatedReport: result.generatedReport,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create export job";
    const status = message === "Forbidden" ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

router.get("/reports/export-jobs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.json([]);
    return;
  }
  const rows = await exportJobService.listJobs(req.workspaceId);
  res.json(rows);
});

router.get("/reports/export-jobs/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const id = Number(req.params.id);
  const job = await exportJobService.getJob(id, req.workspaceId);
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(job);
});

router.get("/reports/generated", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.json([]);
    return;
  }
  const mineOnly = req.query.mine === "true";
  const rows = await reportService.listGeneratedReports(
    req.workspaceId,
    mineOnly ? req.userId : undefined,
  );
  res.json(rows);
});

router.get("/reports/generated/:id/download", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const issued = await reportService.issueDownload(req, id);
    res.json(issued);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download denied";
    res.status(message === "Forbidden" ? 403 : 404).json({ error: message });
  }
});

router.get("/reports/branding", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const branding = await getWorkspaceBranding(req.workspaceId);
  res.json(branding);
});

router.put("/reports/branding", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  await upsertWorkspaceBranding(req.workspaceId, {
    displayName: body.displayName != null ? String(body.displayName) : undefined,
    logoUrl: body.logoUrl != null ? String(body.logoUrl) : undefined,
    primaryColor: body.primaryColor != null ? String(body.primaryColor) : undefined,
    footerText: body.footerText != null ? String(body.footerText) : undefined,
    locale: body.locale === "ar" ? "ar" : body.locale === "en" ? "en" : undefined,
    watermarkText: body.watermarkText != null ? String(body.watermarkText) : undefined,
  });
  res.json(await getWorkspaceBranding(req.workspaceId));
});

router.get("/reports/schedules", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.json([]);
    return;
  }
  const rows = await scheduledReportService.listSchedules(req.workspaceId);
  res.json(rows);
});

router.post("/reports/schedules", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  try {
    const row = await scheduledReportService.createSchedule({
      workspaceId: req.workspaceId!,
      userId: req.userId!,
      userRole: req.userRole,
      userPermissions: req.userPermissions,
      reportDefinitionKey: String(body.reportDefinitionKey ?? ""),
      format: body.format != null ? String(body.format) : undefined,
      parameters: (body.parameters ?? {}) as Record<string, string>,
      scheduleCron: String(body.scheduleCron ?? "0 8 * * *"),
      scheduleTimezone: body.scheduleTimezone != null ? String(body.scheduleTimezone) : undefined,
      recipients: body.recipients as Array<{ userId?: number; email?: string }> | undefined,
    });
    res.status(201).json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create schedule";
    res.status(400).json({ error: message });
  }
});

router.patch("/reports/schedules/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const id = Number(req.params.id);
  const enabled = (req.body as { enabled?: boolean }).enabled;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled boolean required" });
    return;
  }
  const row = await scheduledReportService.setEnabled(id, req.workspaceId, enabled);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.get("/reports/generated/download/stream", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const token = String(req.query.token ?? "");
  try {
    const file = await reportService.streamDownload(req, token);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(file.buffer);
  } catch (err) {
    res.status(403).json({ error: err instanceof Error ? err.message : "Download failed" });
  }
});

export default router;
