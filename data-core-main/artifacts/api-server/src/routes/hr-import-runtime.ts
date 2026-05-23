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
import { getImportRuntimeSettings, getEffectiveValidationMode } from "../lib/hr-import/runtime-settings";
import {
  masterDataCatalogService,
  getCatalogCacheStats,
  type CatalogEntityType,
} from "../lib/hr-import/catalog/master-data-catalog";
import { HrImportTemplateRegistry } from "../lib/hr-import/template/template-registry";
import { HrImportTemplateRegistryV2, HR_EMPLOYEE_V2 } from "../lib/hr-import/template/template-registry-v2";
import { generateEmployeeTemplateV2Xlsx } from "../lib/hr-import/template/template-generator-v2";
import { buildValidationSchema } from "../lib/hr-import/template/validation-schema";
import { detectStaleTemplate } from "../lib/hr-import/template/stale-template-detector";
import { recordTemplateCatalogTelemetry } from "../lib/hr-import/telemetry/template-catalog-telemetry";
import { importSessionService } from "../lib/hr-import/session/import-session-service";
import {
  buildSessionResults,
  buildSessionDiagnostics,
} from "../lib/hr-import/execution/import-results-service";
import { exportMasterDataJson, exportEmployeesJson } from "../lib/hr-import/export/export-foundation";
import { getRuntimeMetrics } from "../lib/workforce/stabilization/observability-metrics";
import { db, hrCustomFieldDefsTable, hrWorkspaceSettingsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import type { HrImportColumnDef } from "../lib/hr-import/template/template-registry";

const router: IRouter = Router();

function requireImportRuntimeSchema(req: AuthRequest, res: import("express").Response): boolean {
  if (isHrImportRuntimeSchemaAvailable()) return true;
  sendHrImportRuntimeSchemaUnavailable(res, undefined, { route: req.path });
  return false;
}

function parseEntityType(raw: string): CatalogEntityType | null {
  const allowed: CatalogEntityType[] = [
    "org_unit", "job_title", "job_grade", "position", "work_location",
    "employment_type", "employee_status", "contract_type", "document_type",
    "leave_policy", "probation_policy",
  ];
  return allowed.includes(raw as CatalogEntityType) ? (raw as CatalogEntityType) : null;
}

// GET /hr/import/runtime/health
router.get("/hr/import/runtime/health", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const settings = req.workspaceId ? await getImportRuntimeSettings(req.workspaceId) : null;
    res.json({
      status: "ok",
      schemaAvailable: true,
      phase: "2",
      settings,
      effectiveValidationMode: settings ? getEffectiveValidationMode(settings) : "warn",
      strictEnforcementEnabled: false,
      templatesV2: HrImportTemplateRegistryV2.list().map((t) => ({ key: t.key, version: t.version, status: t.status })),
      templatesV1: HrImportTemplateRegistry.list().map((t) => ({ key: t.key, version: t.version })),
      catalogCache: getCatalogCacheStats(),
    });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/runtime/health" })) return;
    throw e;
  }
});

router.get("/hr/import/runtime/settings", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const settings = await getImportRuntimeSettings(req.workspaceId);
    res.json({
      ...settings,
      effectiveValidationMode: getEffectiveValidationMode(settings),
      strictEnforcementEnabled: false,
    });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/runtime/settings" })) return;
    throw e;
  }
});

router.get("/hr/import/catalog", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const snapshot = await masterDataCatalogService.loadSnapshot(req.workspaceId);
    res.json(snapshot);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/catalog" })) return;
    throw e;
  }
});

router.get("/hr/import/catalog/:entity", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const entity = parseEntityType(String(req.params.entity));
  if (!entity) { res.status(400).json({ error: "Invalid entity type" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const slice = await masterDataCatalogService.getEntitySlice(req.workspaceId, entity);
    res.json(slice);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/catalog/:entity" })) return;
    throw e;
  }
});

router.get("/hr/import/templates", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    res.json({ templates: HrImportTemplateRegistry.list() });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/templates" })) return;
    throw e;
  }
});

router.get("/hr/import/templates/v2", requireAuth, requirePermission("hr.view"), async (_req: AuthRequest, res): Promise<void> => {
  try {
    if (!requireImportRuntimeSchema(_req, res)) return;
    res.json({
      templates: HrImportTemplateRegistryV2.list(),
      strictEnforcementEnabled: false,
    });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/templates/v2" })) return;
    throw e;
  }
});

router.get("/hr/import/templates/v2/:key", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const key = String(req.params.key);
  const template = HrImportTemplateRegistryV2.get(key);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;

    const format = String(req.query.format ?? "json");
    if (format === "xlsx" && key === HR_EMPLOYEE_V2.key) {
      const catalog = await masterDataCatalogService.loadSnapshot(req.workspaceId);
      const [settings, customFields] = await Promise.all([
        db.select().from(hrWorkspaceSettingsTable).where(eq(hrWorkspaceSettingsTable.workspaceId, req.workspaceId)),
        db.select().from(hrCustomFieldDefsTable).where(and(eq(hrCustomFieldDefsTable.workspaceId, req.workspaceId), eq(hrCustomFieldDefsTable.isActive, true))).orderBy(asc(hrCustomFieldDefsTable.displayOrder)),
      ]);
      const customCols: HrImportColumnDef[] = customFields.map((cf) => ({
        key: `cf_${cf.name}`,
        labelEn: cf.label,
        labelAr: cf.labelAr ?? cf.label,
        required: cf.required,
        validation: cf.fieldType === "dropdown" ? "enum" : "text",
        enumRef: cf.fieldType === "dropdown" ? `custom_field.${cf.name}` : undefined,
      }));
      const buf = generateEmployeeTemplateV2Xlsx(template, {
        workspaceId: req.workspaceId,
        catalog,
        customFieldColumns: customCols,
        customFieldDropdowns: catalog.customFieldDropdowns,
        numberingMode: settings[0]?.numberingMode ?? "auto",
      });
      void recordTemplateCatalogTelemetry({
        workspaceId: req.workspaceId,
        event: "template_download_v2",
        sourcePath: `GET /hr/import/templates/v2/${key}`,
        metadata: { templateVersion: template.version, format: "xlsx" },
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="employee_import_v2_${template.version}.xlsx"`);
      res.send(buf);
      return;
    }

    res.json({ template, strictEnforcementEnabled: false });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/templates/v2/:key" })) return;
    throw e;
  }
});

router.get("/hr/import/validation/schema", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const templateKey = String(req.query.templateKey ?? HR_EMPLOYEE_V2.key);
  const template = HrImportTemplateRegistryV2.get(templateKey);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const catalog = await masterDataCatalogService.loadSnapshot(req.workspaceId);
    const stale = detectStaleTemplate(templateKey, String(req.query.templateVersion ?? template.version), String(req.query.generatedAt ?? ""));
    if (stale.stale && req.query.templateVersion) {
      void recordTemplateCatalogTelemetry({
        workspaceId: req.workspaceId,
        event: "stale_template",
        sourcePath: "GET /hr/import/validation/schema",
        metadata: stale,
      });
    }
    const schema = buildValidationSchema(template, {
      employmentTypeCodes: catalog.entities.employment_type?.map((e) => e.code ?? e.name) ?? [],
      statusCodes: catalog.entities.employee_status?.map((e) => e.code ?? e.name) ?? [],
      customFieldDropdowns: catalog.customFieldDropdowns,
    });
    res.json({ schema, staleCheck: stale, strictEnforcementEnabled: false });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/validation/schema" })) return;
    throw e;
  }
});

router.post("/hr/import/sessions", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const settings = await getImportRuntimeSettings(req.workspaceId);
    const session = await importSessionService.createSession({
      workspaceId: req.workspaceId,
      importType: String(req.body.importType ?? "hr.foundation.session"),
      templateKey: req.body.templateKey,
      templateVersion: req.body.templateVersion,
      runtimeMode: settings.employeeImportRuntimeMode,
      dryRun: req.body.dryRun !== false,
      createdByUserId: req.userId,
      mappingJson: req.body.mappingJson,
      sourcePath: req.body.sourcePath ?? "api:/hr/import/sessions",
    });
    res.status(201).json(session);
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "POST /hr/import/sessions" })) return;
    throw e;
  }
});

router.get("/hr/import/sessions/:id", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const session = await importSessionService.getSession(req.workspaceId, id);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    const rows = await importSessionService.getSessionRows(id, req.workspaceId);
    res.json({ session, rows });
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/sessions/:id" })) return;
    throw e;
  }
});

router.get("/hr/import/sessions/:id/results", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const session = await importSessionService.getSession(req.workspaceId, id);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    const rows = await importSessionService.getSessionRows(id, req.workspaceId);
    res.json(buildSessionResults(session, rows));
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/sessions/:id/results" })) return;
    throw e;
  }
});

router.get("/hr/import/sessions/:id/diagnostics", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const session = await importSessionService.getSession(req.workspaceId, id);
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    res.json(buildSessionDiagnostics(session));
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/sessions/:id/diagnostics" })) return;
    throw e;
  }
});

router.get("/hr/import/export/master-data", requireAuth, requirePermission("hr.view"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    const entities = req.query.entities ? String(req.query.entities).split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    res.json(await exportMasterDataJson(req.workspaceId, { entities }));
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/export/master-data" })) return;
    throw e;
  }
});

router.get("/hr/import/export/employees", requireAuth, requirePermission("hr.manage"), async (req: AuthRequest, res): Promise<void> => {
  if (!req.workspaceId) { res.status(403).json({ error: "No workspace" }); return; }
  try {
    if (!requireImportRuntimeSchema(req, res)) return;
    res.json(await exportEmployeesJson(req.workspaceId, parseInt(String(req.query.limit ?? "5000"), 10)));
  } catch (e) {
    if (handleHrImportRuntimeRouteError(res, e, { route: "GET /hr/import/export/employees" })) return;
    throw e;
  }
});

router.get("/hr/import/runtime/metrics", requireAuth, requirePermission("hr.view"), async (_req: AuthRequest, res): Promise<void> => {
  res.json({
    metrics: getRuntimeMetrics(),
    catalogCache: getCatalogCacheStats(),
    phase: 2,
  });
});

export default router;
