import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { connectorRegistry } from "../lib/workforce-integration/connector-registry";
import { registerWorkforceConnectors } from "../lib/workforce-integration/register-connectors";
import { integrationService } from "../lib/workforce-integration/integration-service";
import { employeeMapService } from "../lib/workforce-integration/employee-map-service";
import { deviceService } from "../lib/workforce-integration/device-service";
import { handleAttendanceWebhook } from "../lib/workforce-integration/webhook-ingestion";

registerWorkforceConnectors();

const router: IRouter = Router();

// ── Public webhook (signature + workspace via integration id) ─────────────────

const webhookBodyParser = express.raw({ type: "*/*", limit: "512kb" });

router.post(
  "/integrations/attendance/:integrationId/webhook",
  webhookBodyParser,
  async (req: Request, res: Response): Promise<void> => {
    const integrationId = Number(req.params.integrationId);
    if (!Number.isFinite(integrationId)) {
      res.status(400).json({ error: "Invalid integration id" });
      return;
    }

    const rawBody =
      typeof req.body === "string"
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString("utf8")
          : JSON.stringify(req.body ?? {});

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }

    try {
      const result = await handleAttendanceWebhook({
        integrationId,
        rawBody,
        headers: req.headers as Record<string, string | string[] | undefined>,
        parsedBody,
      });
      res.status(result.accepted ? 200 : 409).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.includes("signature") || message.includes("disabled")
          ? 401
          : message.includes("large")
            ? 413
            : 400;
      res.status(status).json({ error: message });
    }
  },
);

// ── Management APIs (authenticated) ───────────────────────────────────────────

router.get(
  "/hr/workforce/integrations/connectors",
  requireAuth,
  requirePermission("hr.manage"),
  (_req, res) => {
    res.json({ connectors: connectorRegistry.list() });
  },
);

router.get(
  "/hr/workforce/integrations",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    const rows = await integrationService.list(req.workspaceId);
    res.json(rows);
  },
);

router.post(
  "/hr/workforce/integrations",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    const body = req.body as {
      name?: string;
      connectorKey?: string;
      config?: Record<string, unknown>;
      credentials?: Record<string, string>;
      pollIntervalMinutes?: number;
    };
    if (!body.name || !body.connectorKey) {
      res.status(400).json({ error: "name and connectorKey required" });
      return;
    }
    try {
      const row = await integrationService.create({
        workspaceId: req.workspaceId,
        name: body.name,
        connectorKey: body.connectorKey,
        config: body.config,
        credentials: body.credentials,
        pollIntervalMinutes: body.pollIntervalMinutes,
        createdByUserId: req.userId,
      });
      const baseUrl =
        process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
        `${req.protocol}://${req.get("host")}`;
      const payload: Record<string, unknown> = { ...row };
      if (
        body.connectorKey === "generic_webhook" ||
        body.connectorKey === "direct_api"
      ) {
        payload.webhookUrl = `${baseUrl}/api/integrations/attendance/${row.id}/webhook`;
      }
      res.status(201).json(payload);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/hr/workforce/integrations/:id",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    try {
      const row = await integrationService.get(req.workspaceId, Number(req.params.id));
      res.json(row);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.patch(
  "/hr/workforce/integrations/:id",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    const integrationId = Number(req.params.id);
    const patch = req.body as Parameters<typeof integrationService.update>[2];
    try {
      const row = await integrationService.update(
        req.workspaceId,
        integrationId,
        patch,
        req.userId,
      );
      const baseUrl =
        process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
        `${req.protocol}://${req.get("host")}`;
      const payload: Record<string, unknown> = { ...row };
      if (patch.rotateWebhookSecret) {
        payload.webhookUrl = `${baseUrl}/api/integrations/attendance/${integrationId}/webhook`;
      }
      res.json(payload);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/workforce/integrations/:id/test",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    try {
      const result = await integrationService.testConnection(
        req.workspaceId,
        Number(req.params.id),
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/workforce/integrations/:id/sync",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    try {
      const result = await integrationService.syncNow(
        req.workspaceId,
        Number(req.params.id),
        req.userId,
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/hr/workforce/integrations/:id/status",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    try {
      const status = await integrationService.status(
        req.workspaceId,
        Number(req.params.id),
      );
      res.json(status);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/hr/workforce/integrations/:id/employee-mappings",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    const integrationId = Number(req.params.id);
    await employeeMapService.assertIntegrationInWorkspace(req.workspaceId, integrationId);
    const rows = await employeeMapService.listMappings(req.workspaceId, integrationId);
    res.json(rows);
  },
);

router.post(
  "/hr/workforce/integrations/:id/employee-mappings",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    const integrationId = Number(req.params.id);
    await employeeMapService.assertIntegrationInWorkspace(req.workspaceId, integrationId);
    const body = req.body as {
      externalEmployeeId?: string;
      employeeId?: number | null;
      confidence?: number;
      status?: string;
    };
    if (!body.externalEmployeeId) {
      res.status(400).json({ error: "externalEmployeeId required" });
      return;
    }
    const id = await employeeMapService.upsertMapping({
      workspaceId: req.workspaceId,
      integrationId,
      externalEmployeeId: body.externalEmployeeId,
      employeeId: body.employeeId ?? null,
      confidence: body.confidence,
      status: body.status,
    });
    res.status(201).json({ id });
  },
);

router.get(
  "/hr/workforce/integrations/:id/devices",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "Workspace required" });
      return;
    }
    const integrationId = Number(req.params.id);
    await employeeMapService.assertIntegrationInWorkspace(req.workspaceId, integrationId);
    const rows = await deviceService.listDevices(req.workspaceId, integrationId);
    res.json(rows);
  },
);

export default router;
