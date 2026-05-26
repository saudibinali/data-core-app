import { Router, type IRouter } from "express";
import {
  type AuthRequest,
  requireAuth,
  requirePermission,
} from "../middlewares/requireAuth";
import {
  handleHrImportRuntimeRouteError,
  sendHrImportRuntimeSchemaUnavailable,
} from "../lib/hr-import/schema-guard";
import { isHrImportRuntimeSchemaAvailable } from "../lib/hr-import/hr-import-startup";
import { parseHrImportUpload } from "../lib/parse-hr-import-upload";
import { importSessionEngine } from "../lib/hr-import/execution/import-session-engine";
import { importSessionService } from "../lib/hr-import/session/import-session-service";
import {
  buildSessionResults,
  buildSessionDiagnostics,
} from "../lib/hr-import/execution/import-results-service";
import { getImportRuntimeHealth } from "../lib/hr-import/health/import-runtime-health";
import { getCommitRuntimeHealth, buildCommitDiagnostics } from "../lib/hr-import/health/commit-health";
import { buildImportParityReport } from "../lib/hr-import/validation/parity-validation";
import { commitOrchestrator } from "../lib/hr-import/commit/commit-orchestrator";
import { executeSessionRollback } from "../lib/hr-import/rollback/rollback-foundation";
import { getImportRuntimeSettings, getCommitModeLabel } from "../lib/hr-import/runtime-settings";
import {
  sendHrImportAutoCreateSchemaUnavailable,
} from "../lib/hr-import/schema-guard";
import { isHrImportAutoCreateSchemaAvailable } from "../lib/hr-import/health/auto-create-startup";
import { runAutoCreatePreview, commitApprovedPendingItems } from "../lib/hr-import/auto-create/auto-create-runtime";
import {
  listPendingAutoCreates,
  approveAutoCreateItems,
  buildApprovalDiagnostics,
} from "../lib/hr-import/approval/auto-create-approval-service";
import { buildReconciliationReport } from "../lib/hr-import/reconciliation/master-data-reconciliation";
import { masterDataCatalogService } from "../lib/hr-import/catalog/master-data-catalog";
import { validateMasterDataImportDryRun } from "../lib/hr-import/execution/master-data-import-runtime";
import { listPilotWorkspaces, getPilotRolloutDiagnostics } from "../lib/hr-import/pilot/pilot-workspace-service";
import { getAutoCreateStartupHealth } from "../lib/hr-import/health/auto-create-startup";
import {
  activateEnterpriseImportRuntime,
  deactivateEnterpriseImportRuntime,
  getEnterpriseRuntimeStatus,
} from "../lib/hr-import/activation/enterprise-runtime-activation";
import { getEnterpriseMasterDataCapabilities } from "../lib/hr-import/activation/enterprise-confirm-bridge";
import { evaluateImportCutoverGates } from "../lib/workforce/stabilization/import-cutover-gates";

const router: IRouter = Router();

function requireSchema(req: AuthRequest, res: import("express").Response): boolean {
  if (isHrImportRuntimeSchemaAvailable()) return true;
  sendHrImportRuntimeSchemaUnavailable(res, undefined, { route: req.path });
  return false;
}

function requireAutoCreateSchema(req: AuthRequest, res: import("express").Response): boolean {
  if (isHrImportAutoCreateSchemaAvailable()) return true;
  sendHrImportAutoCreateSchemaUnavailable(res, undefined, { route: req.path });
  return false;
}

function parseSessionId(raw: string): number | null {
  const id = parseInt(String(raw), 10);
  return Number.isNaN(id) ? null : id;
}

// POST /hr/import/v2/upload
router.post(
  "/hr/import/v2/upload",
  requireAuth,
  requirePermission("hr.manage"),
  parseHrImportUpload,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
    if (!requireSchema(req, res)) return;
    const upload = req.hrImportUpload;
    if (!upload) { res.status(400).json({ error: "No file" }); return; }
    try {
      const result = await importSessionEngine.executeUpload({
        workspaceId: req.workspaceId,
        userId: req.userId,
        buffer: upload.buffer,
        fileName: upload.originalFileName,
        templateKey: upload.templateKey,
        importType: upload.importType,
      });
      res.status(201).json({ ...result, commitEnabled: false });
    } catch (e) {
      if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/v2/upload" })) return;
      res.status(400).json({ error: e instanceof Error ? e.message : "Upload failed" });
    }
  },
);

// POST /hr/import/v2/validate
router.post("/hr/import/v2/validate", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  const sessionId = parseSessionId(String(req.body.sessionId ?? ""));
  if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }
  try {
    const result = await importSessionEngine.executeValidate(req.workspaceId, sessionId);
    res.json(result);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/v2/validate" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Validate failed" });
  }
});

// POST /hr/import/v2/shadow-run
router.post("/hr/import/v2/shadow-run", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  const sessionId = parseSessionId(String(req.body.sessionId ?? ""));
  if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }
  try {
    const result = await importSessionEngine.executeShadowRun(req.workspaceId, sessionId);
    res.json(result);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/v2/shadow-run" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Shadow run failed" });
  }
});

// GET /hr/import/v2/sessions/:id
router.get("/hr/import/v2/sessions/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  const sessionId = parseSessionId(String(req.params.id));
  if (!sessionId) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const session = await importSessionService.getSession(req.workspaceId, sessionId);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    const rows = await importSessionService.getSessionRows(sessionId, req.workspaceId);
    res.json({ session, rows, commitEnabled: false });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/sessions/:id" })) return;
    throw e;
  }
});

// GET /hr/import/v2/sessions/:id/results
router.get("/hr/import/v2/sessions/:id/results", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  const sessionId = parseSessionId(String(req.params.id));
  if (!sessionId) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const session = await importSessionService.getSession(req.workspaceId, sessionId);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    const rows = await importSessionService.getSessionRows(sessionId, req.workspaceId);
    res.json(buildSessionResults(session, rows));
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/sessions/:id/results" })) return;
    throw e;
  }
});

// GET /hr/import/v2/sessions/:id/diagnostics
router.get("/hr/import/v2/sessions/:id/diagnostics", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  const sessionId = parseSessionId(String(req.params.id));
  if (!sessionId) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const session = await importSessionService.getSession(req.workspaceId, sessionId);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    res.json(buildSessionDiagnostics(session));
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/sessions/:id/diagnostics" })) return;
    throw e;
  }
});

// GET /hr/import/v2/runtime/health
router.get("/hr/import/v2/runtime/health", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  try {
    if (!requireSchema(req, res)) return;
    const health = await getImportRuntimeHealth();
    res.json(health);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/runtime/health" })) return;
    throw e;
  }
});

// GET /hr/import/v2/commit-health
router.get("/hr/import/v2/commit-health", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    if (!requireSchema(req, res)) return;
    const health = await getCommitRuntimeHealth(req.workspaceId);
    res.json(health);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/commit-health" })) return;
    throw e;
  }
});

// GET /hr/import/v2/parity/:sessionId
router.get("/hr/import/v2/parity/:sessionId", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  const sessionId = parseSessionId(String(req.params.sessionId));
  if (!sessionId) { res.status(400).json({ error: "Invalid sessionId" }); return; }
  try {
    const report = await buildImportParityReport(req.workspaceId, sessionId);
    if (!report) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...report, blockingEnforced: false });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/parity/:sessionId" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Parity check failed" });
  }
});

// POST /hr/import/v2/commit
router.post("/hr/import/v2/commit", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  const sessionId = parseSessionId(String(req.body.sessionId ?? ""));
  if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }
  try {
    const settings = await getImportRuntimeSettings(req.workspaceId);
    const gates = await evaluateImportCutoverGates(req.workspaceId);
    const result = await commitOrchestrator.executeCommit({
      workspaceId: req.workspaceId,
      sessionId,
      userId: req.userId,
    });
    const blockedByCutover = result.reason === "IMPORT_CUTOVER_NOT_READY";
    const statusCode = result.committed
      ? 200
      : blockedByCutover
        ? 409
        : result.mode === "shadow_simulation"
          ? 200
          : 403;
    res.status(statusCode).json({
      ...result,
      commitMode: getCommitModeLabel(settings),
      strictEnforcementEnabled: gates.strictRowValidation,
      importGates: gates,
      autoCreateEnabled: false,
    });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/v2/commit" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Commit failed" });
  }
});

// POST /hr/import/v2/rollback
router.post("/hr/import/v2/rollback", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  const sessionId = parseSessionId(String(req.body.sessionId ?? ""));
  const revertToken = String(req.body.revertToken ?? "");
  if (!sessionId || !revertToken) {
    res.status(400).json({ error: "sessionId and revertToken required" });
    return;
  }
  try {
    const result = await executeSessionRollback(req.workspaceId, sessionId, revertToken);
    if (!result.ok) {
      res.status(403).json(result);
      return;
    }
    const session = await importSessionService.getSession(req.workspaceId, sessionId);
    res.json({
      ...result,
      diagnostics: buildCommitDiagnostics((session?.summary as Record<string, unknown>) ?? {}),
    });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/v2/rollback" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Rollback failed" });
  }
});

// POST /hr/import/v2/auto-create/preview
router.post("/hr/import/v2/auto-create/preview", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  if (!requireAutoCreateSchema(req, res)) return;
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const sessionId = parseSessionId(String(req.body.sessionId ?? ""));
    const preview = await runAutoCreatePreview({
      workspaceId: req.workspaceId,
      sessionId: sessionId ?? undefined,
      rows,
    });
    res.json({ preview, autoCreateEnabled: preview.runtimeEnabled, strictEnforcementEnabled: false });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/v2/auto-create/preview" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Preview failed" });
  }
});

// POST /hr/import/v2/auto-create/approve
router.post("/hr/import/v2/auto-create/approve", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  if (!requireAutoCreateSchema(req, res)) return;
  const pendingIds = Array.isArray(req.body.pendingIds)
    ? req.body.pendingIds.map((id: unknown) => parseInt(String(id), 10)).filter((n: number) => !Number.isNaN(n))
    : [];
  if (!pendingIds.length) { res.status(400).json({ error: "pendingIds required" }); return; }
  try {
    const approval = await approveAutoCreateItems({
      workspaceId: req.workspaceId,
      pendingIds,
      approvedByUserId: req.userId,
    });
    const commit = await commitApprovedPendingItems({
      workspaceId: req.workspaceId,
      pendingIds,
      userId: req.userId,
    });
    res.json({ approval, commit, globalAutoCreateDisabled: true });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/v2/auto-create/approve" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Approve failed" });
  }
});

// GET /hr/import/v2/auto-create/pending
router.get("/hr/import/v2/auto-create/pending", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  if (!requireAutoCreateSchema(req, res)) return;
  try {
    const pending = await listPendingAutoCreates(req.workspaceId);
    res.json({ pending, diagnostics: buildApprovalDiagnostics(pending) });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/auto-create/pending" })) return;
    throw e;
  }
});

// GET /hr/import/v2/reconciliation/:sessionId
router.get("/hr/import/v2/reconciliation/:sessionId", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  if (!requireAutoCreateSchema(req, res)) return;
  const sessionId = parseSessionId(String(req.params.sessionId));
  if (!sessionId) { res.status(400).json({ error: "Invalid sessionId" }); return; }
  try {
    const session = await importSessionService.getSession(req.workspaceId, sessionId);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    const rows = await importSessionService.getSessionRows(sessionId, req.workspaceId);
    const rawRows = rows.map((r) => (r.rawRow ?? {}) as Record<string, string>);
    const catalog = await masterDataCatalogService.loadSnapshot(req.workspaceId);
    const md = validateMasterDataImportDryRun(catalog, rawRows);
    const report = buildReconciliationReport({ sessionId, catalog, rows: md.rows, rawRows });
    res.json(report);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/reconciliation/:sessionId" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Reconciliation failed" });
  }
});

// GET /hr/import/v2/pilot-workspaces
router.get("/hr/import/v2/pilot-workspaces", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!requireSchema(req, res)) return;
  if (!requireAutoCreateSchema(req, res)) return;
  try {
    const pilots = await listPilotWorkspaces();
    const diagnostics = req.workspaceId
      ? await getPilotRolloutDiagnostics(req.workspaceId)
      : null;
    const startup = await getAutoCreateStartupHealth();
    res.json({ pilots, workspaceDiagnostics: diagnostics, startup, globalActiveCutover: false });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/pilot-workspaces" })) return;
    throw e;
  }
});

// POST /hr/import/v2/enterprise/activate
router.post("/hr/import/v2/enterprise/activate", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  try {
    const result = await activateEnterpriseImportRuntime({
      workspaceId: req.workspaceId,
      userId: req.userId,
      targetMode: req.body.targetMode === "pilot_active" ? "pilot_active" : "controlled_commit",
      explicitConfirmation: req.body.explicitConfirmation === true,
    });
    if (!result.ok) {
      res.status(403).json(result);
      return;
    }
    res.json(result);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/v2/enterprise/activate" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Activate failed" });
  }
});

// POST /hr/import/v2/enterprise/deactivate
router.post("/hr/import/v2/enterprise/deactivate", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  if (!requireSchema(req, res)) return;
  try {
    const result = await deactivateEnterpriseImportRuntime({
      workspaceId: req.workspaceId,
      userId: req.userId,
      explicitConfirmation: req.body.explicitConfirmation === true,
      targetMode: req.body.targetMode === "legacy" ? "legacy" : "shadow",
    });
    if (!result.ok) {
      res.status(403).json(result);
      return;
    }
    res.json({ ...result, status: await getEnterpriseRuntimeStatus(req.workspaceId) });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/v2/enterprise/deactivate" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Deactivate failed" });
  }
});

// GET /hr/import/v2/enterprise/status
router.get("/hr/import/v2/enterprise/status", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    res.json(await getEnterpriseRuntimeStatus(req.workspaceId));
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/enterprise/status" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Status failed" });
  }
});

// GET /hr/import/v2/enterprise/master-data
router.get("/hr/import/v2/enterprise/master-data", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    res.json(await getEnterpriseMasterDataCapabilities(req.workspaceId));
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/v2/enterprise/master-data" })) return;
    res.status(400).json({ error: e instanceof Error ? e.message : "Master data status failed" });
  }
});

export default router;
