import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth, requirePermission } from "../middlewares/requireAuth";
import { db } from "@workspace/db";
import { employeesTable, hrShiftsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { parseAttendanceImportUpload } from "../lib/parse-attendance-import-upload";
import { ImportTemplateRegistry } from "../lib/workforce-attendance/import/import-template-registry";
import {
  generateAttendanceTemplateXlsx,
  getTemplateMetadata,
} from "../lib/workforce-attendance/import/import-template-generator";
import { attendanceImportService } from "../lib/workforce-attendance/import/attendance-import-service";
import { getReconciliationReport } from "../lib/workforce-attendance/import/import-reconciliation";
import { ATTENDANCE_PERIOD_DEFAULT_V1 } from "../lib/workforce-attendance/import/import-template-registry";

const router: IRouter = Router();
const DEFAULT_TEMPLATE = ATTENDANCE_PERIOD_DEFAULT_V1.key;

router.get(
  "/hr/workforce/imports/templates",
  requireAuth,
  requirePermission("hr.manage"),
  async (_req: AuthRequest, res): Promise<void> => {
    res.json({
      templates: ImportTemplateRegistry.list().map((t) => ({
        key: t.key,
        version: t.version,
        titleEn: t.titleEn,
        titleAr: t.titleAr,
        supportedFormats: t.supportedFormats,
      })),
    });
  },
);

router.get(
  "/hr/workforce/imports/templates/:key",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      res.json(getTemplateMetadata(req.params.key));
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Template not found" });
    }
  },
);

router.get(
  "/hr/workforce/imports/templates/:key/download",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    try {
      const template = ImportTemplateRegistry.require(req.params.key);
      const [emps, shifts] = await Promise.all([
        db
          .select({ number: employeesTable.employeeNumber })
          .from(employeesTable)
          .where(eq(employeesTable.workspaceId, req.workspaceId))
          .limit(500),
        db
          .select({ name: hrShiftsTable.name })
          .from(hrShiftsTable)
          .where(eq(hrShiftsTable.workspaceId, req.workspaceId)),
      ]);
      const buf = generateAttendanceTemplateXlsx(template, {
        employeeNumbers: emps.map((e) => e.number).filter(Boolean) as string[],
        shiftNames: shifts.map((s) => s.name),
      });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="attendance_template_${template.version}.xlsx"`,
      );
      res.send(buf);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : "Template not found" });
    }
  },
);

router.post(
  "/hr/workforce/imports/upload",
  requireAuth,
  requirePermission("hr.manage"),
  parseAttendanceImportUpload,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId || !req.userId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const upload = req.attendanceImportUpload;
    if (!upload) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const q = req.query as Record<string, string>;
    const dryRun = q.dryRun === "true" || q.dryRun === "1";
    const templateKey = q.templateKey || DEFAULT_TEMPLATE;

    try {
      const result = await attendanceImportService.startImport({
        workspaceId: req.workspaceId,
        userId: req.userId,
        templateKey,
        dryRun,
        fileBuffer: upload.buffer,
        mimeType: upload.mimeType,
        fileName: upload.originalFileName,
        documentId: q.documentId ? Number(q.documentId) : undefined,
      });
      res.status(dryRun ? 200 : 201).json({
        importJobId: result.importJobId,
        batchId: result.batchId,
        dryRun: result.dryRun,
        stats: result.validation.stats,
        rows: result.validation.rows,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Import failed" });
    }
  },
);

router.post(
  "/hr/workforce/imports/dry-run",
  requireAuth,
  requirePermission("hr.manage"),
  parseAttendanceImportUpload,
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId || !req.userId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const upload = req.attendanceImportUpload;
    if (!upload) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    try {
      const result = await attendanceImportService.startImport({
        workspaceId: req.workspaceId,
        userId: req.userId,
        templateKey: (req.query as Record<string, string>).templateKey || DEFAULT_TEMPLATE,
        dryRun: true,
        fileBuffer: upload.buffer,
        mimeType: upload.mimeType,
        fileName: upload.originalFileName,
      });
      res.json({
        importJobId: result.importJobId,
        batchId: result.batchId,
        dryRun: true,
        stats: result.validation.stats,
        rows: result.validation.rows,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Dry-run failed" });
    }
  },
);

router.post(
  "/hr/workforce/imports/:batchId/confirm",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId || !req.userId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const batchId = Number(req.params.batchId);
    if (!Number.isFinite(batchId)) {
      res.status(400).json({ error: "Invalid batch id" });
      return;
    }
    try {
      const result = await attendanceImportService.confirmImport({
        workspaceId: req.workspaceId,
        userId: req.userId,
        batchId,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Confirm failed" });
    }
  },
);

router.post(
  "/hr/workforce/imports/:batchId/revert",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId || !req.userId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const batchId = Number(req.params.batchId);
    const revertToken = req.body?.revertToken as string;
    if (!revertToken) {
      res.status(400).json({ error: "revertToken required" });
      return;
    }
    try {
      const result = await attendanceImportService.revertImport({
        workspaceId: req.workspaceId,
        userId: req.userId,
        batchId,
        revertToken,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Revert failed" });
    }
  },
);

router.get(
  "/hr/workforce/imports/history",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const history = await attendanceImportService.listImportHistory(req.workspaceId);
    res.json({ imports: history });
  },
);

router.get(
  "/hr/workforce/imports/:batchId",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const batchId = Number(req.params.batchId);
    const status = await attendanceImportService.getImportStatus(req.workspaceId, batchId);
    if (!status) {
      res.status(404).json({ error: "Import not found" });
      return;
    }
    res.json(status);
  },
);

router.get(
  "/hr/workforce/imports/:batchId/reconciliation",
  requireAuth,
  requirePermission("hr.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    if (!req.workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const batchId = Number(req.params.batchId);
    const status = await attendanceImportService.getImportStatus(req.workspaceId, batchId);
    if (!status?.batch.reconciliationReportId) {
      res.status(404).json({ error: "Reconciliation report not found" });
      return;
    }
    const report = await getReconciliationReport(
      status.batch.reconciliationReportId,
      req.workspaceId,
    );
    res.json(report ?? { error: "Report data unavailable" });
  },
);

export default router;
