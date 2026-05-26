import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth } from "../middlewares/requireAuth";
import {
  requirePayrollPermission,
  canViewSalaryAmounts,
  maskPayrollListRow,
} from "../middlewares/requirePayrollPermission";
import { payrollOperationsService } from "../lib/payroll/payroll-operations-service";
import { payrollExceptionService } from "../lib/payroll/payroll-exception-service";
import { logPayrollAccess, payrollAuditQueryService } from "../lib/payroll/payroll-audit";
import { financialExportService } from "../lib/payroll/financial-export-service";
import { payrollPolicyOpsService } from "../lib/payroll/payroll-policy-ops-service";
import { payrollComponentCatalog } from "../lib/payroll/payroll-component-catalog";
import { payrollPayslipService } from "../lib/payroll/payroll-payslip-service";
import { exportJobService } from "../lib/reports/export-job-service";
import {
  issuePayrollExportDownloadToken,
  verifyPayrollExportDownloadToken,
} from "../lib/payroll/payroll-financial-export-token";

const router: IRouter = Router();

function requireWs(req: AuthRequest, res: import("express").Response): number | null {
  if (!req.workspaceId) {
    res.status(403).json({ error: "Workspace required" });
    return null;
  }
  return req.workspaceId;
}

// ── Overview & monitoring ─────────────────────────────────────────────────────

router.get(
  "/hr/payroll/ops/overview",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollOperationsService.getOverview(ws));
  },
);

router.get(
  "/hr/payroll/ops/metrics",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollOperationsService.getMetrics(ws));
  },
);

router.get(
  "/hr/payroll/ops/alerts",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json({ alerts: await payrollOperationsService.evaluateAlerts(ws) });
  },
);

router.get(
  "/hr/payroll/ops/runs",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const q = req.query as Record<string, string>;
    const rows = await payrollOperationsService.listRuns(ws, {
      status: q.status,
      runType: q.runType,
      periodId: q.periodId ? Number(q.periodId) : undefined,
      limit: q.limit ? Number(q.limit) : 50,
    });
    res.json(rows);
  },
);

router.get(
  "/hr/payroll/ops/locked-periods",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollOperationsService.getLockedPeriods(ws));
  },
);

router.get(
  "/hr/payroll/ops/correction-runs",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollOperationsService.listCorrectionRuns(ws, Number(req.query.limit) || 20));
  },
);

// ── Review operations ─────────────────────────────────────────────────────────

router.get(
  "/hr/payroll/ops/review-queue",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollOperationsService.getReviewQueue(ws, Number(req.query.limit) || 20));
  },
);

router.get(
  "/hr/payroll/ops/runs/:runId/review",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const detail = await payrollOperationsService.getReviewDetail(ws, Number(req.params.runId));
    const show = canViewSalaryAmounts(req);
    res.json({
      ...detail,
      employees: detail.employees.map((e) => ({
        ...e,
        row: maskPayrollListRow(e.row, show),
      })),
    });
  },
);

router.post(
  "/hr/payroll/ops/review/bulk",
  requireAuth,
  requirePayrollPermission("hr.payroll.approve"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const { runIds, action } = req.body as { runIds?: number[]; action?: "approve" | "reject" };
    if (!runIds?.length) {
      res.status(400).json({ error: "runIds required" });
      return;
    }
    const result = await payrollOperationsService.bulkApproveReview(
      ws,
      runIds,
      req.userId,
      action ?? "approve",
    );
    logPayrollAccess({
      workspaceId: ws,
      userId: req.userId,
      action: `ops_review_bulk_${action ?? "approve"}`,
      resourceType: "payroll_run",
      metadata: { runIds, count: runIds.length },
    });
    res.json(result);
  },
);

// ── Exceptions ────────────────────────────────────────────────────────────────

router.get(
  "/hr/payroll/ops/exceptions",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const q = req.query as Record<string, string>;
    res.json(
      await payrollExceptionService.listExceptions(ws, {
        runId: q.runId ? Number(q.runId) : undefined,
        status: q.status,
        severity: q.severity,
      }),
    );
  },
);

router.post(
  "/hr/payroll/ops/runs/:runId/exceptions/scan",
  requireAuth,
  requirePayrollPermission("hr.payroll.calculate"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const runId = Number(req.params.runId);
    const scan = await payrollExceptionService.scanRun(ws, runId, req.userId);
    logPayrollAccess({
      workspaceId: ws,
      userId: req.userId,
      action: "ops_exception_scan",
      resourceType: "payroll_run",
      resourceId: runId,
    });
    res.json(scan);
  },
);

router.post(
  "/hr/payroll/ops/exceptions/:id/acknowledge",
  requireAuth,
  requirePayrollPermission("hr.payroll.approve"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    try {
      const row = await payrollExceptionService.acknowledge(ws, Number(req.params.id), req.userId);
      logPayrollAccess({
        workspaceId: ws,
        userId: req.userId,
        action: "ops_exception_acknowledge",
        resourceType: "payroll_exception",
        resourceId: Number(req.params.id),
      });
      res.json(row);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/payroll/ops/exceptions/:id/resolve",
  requireAuth,
  requirePayrollPermission("hr.payroll.approve"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    try {
      const row = await payrollExceptionService.resolve(ws, Number(req.params.id), req.userId);
      logPayrollAccess({
        workspaceId: ws,
        userId: req.userId,
        action: "ops_exception_resolve",
        resourceType: "payroll_exception",
        resourceId: Number(req.params.id),
      });
      res.json(row);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── Audit ─────────────────────────────────────────────────────────────────────

router.get(
  "/hr/payroll/ops/audit/logs",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const q = req.query as Record<string, string>;
    res.json(
      await payrollAuditQueryService.listLogs(ws, {
        action: q.action,
        resourceType: q.resourceType,
        dateFrom: q.dateFrom,
        dateTo: q.dateTo,
        limit: q.limit ? Number(q.limit) : 200,
      }),
    );
  },
);

router.get(
  "/hr/payroll/ops/audit/break-glass",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollAuditQueryService.getBreakGlassHistory(ws));
  },
);

router.get(
  "/hr/payroll/ops/audit/corrections",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollAuditQueryService.getCorrectionHistory(ws));
  },
);

router.get(
  "/hr/payroll/ops/audit/exports",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollOperationsService.getExportHistory(ws));
  },
);

router.get(
  "/hr/payroll/ops/audit/payslips",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const rows = await payrollOperationsService.getPayslipOpsHistory(ws);
    const show = canViewSalaryAmounts(req);
    res.json(
      rows.map((r) => ({
        ...r,
        payslip: maskPayrollListRow(r.payslip, show),
      })),
    );
  },
);

// ── Financial export readiness ────────────────────────────────────────────────

router.get(
  "/hr/payroll/ops/export/readiness",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await financialExportService.getExportReadiness(ws));
  },
);

router.get(
  "/hr/payroll/ops/runs/:runId/export/gl-journal",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    try {
      res.json({ lines: await financialExportService.buildGlJournal(ws, Number(req.params.runId)) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/hr/payroll/ops/runs/:runId/export/cost-centers",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    try {
      res.json({
        summary: await financialExportService.buildCostCenterSummary(ws, Number(req.params.runId)),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/hr/payroll/ops/runs/:runId/export/bank-metadata",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    try {
      const payments = await financialExportService.buildBankPaymentMetadata(ws, Number(req.params.runId));
      res.json({
        payments,
        bankReady: payments.length > 0,
        wpsCsvAvailable: payments.length > 0,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/payroll/ops/runs/:runId/export/signed-download",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null || !req.userId) return;
    const { exportType } = req.body as {
      exportType?: "gl_journal" | "cost_center" | "bank_metadata" | "bank_wps";
    };
    if (!exportType) {
      res.status(400).json({ error: "exportType required" });
      return;
    }
    const token = issuePayrollExportDownloadToken({
      workspaceId: ws,
      userId: req.userId,
      runId: Number(req.params.runId),
      exportType,
    });
    res.json({ downloadToken: token, expiresInSec: 900 });
  },
);

router.get(
  "/hr/payroll/ops/export/download",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }
    const payload = verifyPayrollExportDownloadToken(token);
    if (!payload || payload.userId !== req.userId) {
      res.status(403).json({ error: "Invalid or expired token" });
      return;
    }
    try {
      const artifact = await financialExportService.exportArtifact(
        payload.workspaceId,
        payload.exportType,
        payload.runId,
        req.userId,
      );
      res.setHeader("Content-Type", artifact.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
      res.send(artifact.buffer);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── GL component mapping ──────────────────────────────────────────────────────

router.get(
  "/hr/payroll/ops/components",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollComponentCatalog.listComponents(ws));
  },
);

router.patch(
  "/hr/payroll/ops/components/:id/gl",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    try {
      res.json(
        await payrollComponentCatalog.updateGlMapping(ws, Number(req.params.id), req.body, req.userId),
      );
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── Policy operations ─────────────────────────────────────────────────────────

router.get(
  "/hr/payroll/ops/policies",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollPolicyOpsService.listPolicies(ws, req.query.policyKey as string));
  },
);

router.get(
  "/hr/payroll/ops/policies/:policyKey/versions",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(
      await payrollPolicyOpsService.getVersionHistory(ws, String(req.params.policyKey)),
    );
  },
);

router.post(
  "/hr/payroll/ops/policies",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const body = req.body as {
      policyKey?: string;
      policyJson?: Record<string, unknown>;
      effectiveFrom?: string;
    };
    if (!body.policyKey || !body.policyJson || !body.effectiveFrom) {
      res.status(400).json({ error: "policyKey, policyJson, effectiveFrom required" });
      return;
    }
    res.status(201).json(
      await payrollPolicyOpsService.createPolicyVersion({
        workspaceId: ws,
        policyKey: body.policyKey,
        policyJson: body.policyJson,
        effectiveFrom: body.effectiveFrom,
        userId: req.userId,
      }),
    );
  },
);

// ── Payslip operations ────────────────────────────────────────────────────────

router.post(
  "/hr/payroll/ops/payslips/:id/void",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const body = req.body as { reason?: string };
    try {
      res.json(
        await payrollPayslipService.voidDraftPayslip(
          ws,
          Number(req.params.id),
          req.userId,
          body.reason,
        ),
      );
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/payroll/ops/payslips/:id/reissue-metadata",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const body = req.body as { note?: string };
    try {
      res.json(
        await payrollPayslipService.recordReissueMetadata(
          ws,
          Number(req.params.id),
          req.userId,
          body.note,
        ),
      );
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

// ── Operational reports ─────────────────────────────────────────────────────────

const OPS_REPORT_KEYS = new Set([
  "hr.payroll.variance",
  "hr.payroll.correction.activity",
  "hr.payroll.warnings",
  "hr.payroll.component.summary",
  "hr.payroll.locked.period.audit",
  "hr.payroll.exceptions",
]);

router.post(
  "/hr/payroll/ops/reports/generate",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null || !req.userId) return;
    const { reportDefinitionKey, payrollRunId } = req.body as {
      reportDefinitionKey?: string;
      payrollRunId?: number;
    };
    if (!reportDefinitionKey || !OPS_REPORT_KEYS.has(reportDefinitionKey)) {
      res.status(400).json({ error: "Invalid reportDefinitionKey" });
      return;
    }
    const { job, generatedReport } = await exportJobService.createReportJob({
      workspaceId: ws,
      userId: req.userId,
      userRole: req.userRole,
      userPermissions: req.userPermissions,
      reportDefinitionKey,
      format: "json",
      parameters: { payrollRunId },
    });
    res.status(202).json({ jobId: job.id, generatedReportId: generatedReport.id });
  },
);

export default router;
