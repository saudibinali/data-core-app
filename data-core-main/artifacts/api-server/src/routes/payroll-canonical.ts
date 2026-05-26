import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth } from "../middlewares/requireAuth";
import {
  requirePayrollPermission,
  maskPayrollListRow,
  canViewSalaryAmounts,
} from "../middlewares/requirePayrollPermission";
import { payrollPeriodService } from "../lib/payroll/payroll-period-service";
import { payrollRunService } from "../lib/payroll/payroll-run-service";
import { payrollPayslipService } from "../lib/payroll/payroll-payslip-service";
import { generatePayslipPdf } from "../lib/payroll/payroll-pdf-generator";
import { issuePayslipDownloadToken, verifyPayslipDownloadToken } from "../lib/payroll/payroll-download-token";
import { readReportArtifact } from "../lib/reports/report-artifact-storage";
import { compensationPackageService } from "../lib/payroll/compensation-package-service";
import { payrollAttendanceAdapter } from "../lib/payroll/payroll-attendance-adapter";
import { payrollLockService } from "../lib/payroll/payroll-lock-service";
import { exportJobService } from "../lib/reports/export-job-service";
import { payrollCutoverStatusForWorkspace } from "../lib/payroll-cutover-flags";
import { logPayrollAccess } from "../lib/payroll/payroll-audit";

const router: IRouter = Router();

// GET /hr/payroll-cutover/status — F6.1 pilot + effective payroll canonical flags
router.get("/hr/payroll-cutover/status", requireAuth, async (req: AuthRequest, res) => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) {
    res.json(payrollCutoverStatusForWorkspace(null));
    return;
  }
  res.json(payrollCutoverStatusForWorkspace(workspaceId));
});

function requireWs(req: AuthRequest, res: import("express").Response): number | null {
  if (!req.workspaceId) {
    res.status(403).json({ error: "Workspace required" });
    return null;
  }
  return req.workspaceId;
}

router.get(
  "/hr/payroll/canonical/periods",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const periods = await payrollPeriodService.listPeriods(ws);
    res.json(periods);
  },
);

router.post(
  "/hr/payroll/canonical/periods",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const body = req.body as {
      periodStart?: string;
      periodEnd?: string;
      periodLabel?: string;
    };
    if (!body.periodStart || !body.periodEnd || !body.periodLabel) {
      res.status(400).json({ error: "periodStart, periodEnd, periodLabel required" });
      return;
    }
    const period = await payrollPeriodService.createPeriod({
      workspaceId: ws,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      periodLabel: body.periodLabel,
      userId: req.userId,
    });
    res.status(201).json(period);
  },
);

router.post(
  "/hr/payroll/canonical/periods/:id/close",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollPeriodService.closePeriod(ws, Number(req.params.id), req.userId));
  },
);

router.post(
  "/hr/payroll/canonical/periods/:id/lock-attendance",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const lock = await payrollPeriodService.lockAttendancePeriod(
      ws,
      Number(req.params.id),
      req.userId,
    );
    res.json(lock);
  },
);

router.post(
  "/hr/payroll/canonical/periods/:id/lock-payroll",
  requireAuth,
  requirePayrollPermission("hr.payroll.approve"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const lock = await payrollPeriodService.lockPayrollPeriod(
      ws,
      Number(req.params.id),
      req.userId,
    );
    res.json(lock);
  },
);

router.post(
  "/hr/payroll/canonical/periods/:id/unlock",
  requireAuth,
  requirePayrollPermission("hr.payroll.admin"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const body = req.body as { lockType?: string; reason?: string };
    if (!body.lockType || !body.reason) {
      res.status(400).json({ error: "lockType and reason required" });
      return;
    }
    await payrollPeriodService.unlockPeriod(
      ws,
      Number(req.params.id),
      body.lockType as "attendance" | "payroll" | "full",
      req.userId,
      body.reason,
    );
    res.json({ ok: true });
  },
);

router.get(
  "/hr/payroll/canonical/locks",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    res.json(await payrollLockService.getActiveLocks(ws));
  },
);

router.get(
  "/hr/payroll/canonical/runs",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const periodId = req.query.periodId ? Number(req.query.periodId) : undefined;
    const runs = await payrollRunService.listRuns(ws, periodId);
    const show = canViewSalaryAmounts(req);
    res.json(runs.map((r) => maskPayrollListRow(r, show)));
  },
);

router.post(
  "/hr/payroll/canonical/runs/preview",
  requireAuth,
  requirePayrollPermission("hr.payroll.calculate"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const { periodId } = req.body as { periodId?: number };
    if (!periodId) {
      res.status(400).json({ error: "periodId required" });
      return;
    }
    const result = await payrollRunService.createRun({
      workspaceId: ws,
      periodId,
      runType: "preview",
      userId: req.userId,
    });
    const show = canViewSalaryAmounts(req);
    res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      run: maskPayrollListRow(result.run, show),
      warnings: result.warnings,
    });
  },
);

router.post(
  "/hr/payroll/canonical/runs/final",
  requireAuth,
  requirePayrollPermission("hr.payroll.calculate"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const { periodId, notes } = req.body as { periodId?: number; notes?: string };
    if (!periodId) {
      res.status(400).json({ error: "periodId required" });
      return;
    }
    const result = await payrollRunService.createRun({
      workspaceId: ws,
      periodId,
      runType: "final",
      userId: req.userId,
      notes,
    });
    const show = canViewSalaryAmounts(req);
    res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      run: maskPayrollListRow(result.run, show),
      warnings: result.warnings,
    });
  },
);

router.post(
  "/hr/payroll/canonical/runs/correction",
  requireAuth,
  requirePayrollPermission("hr.payroll.calculate"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const { periodId, correctsRunId, notes } = req.body as {
      periodId?: number;
      correctsRunId?: number;
      notes?: string;
    };
    if (!periodId || !correctsRunId) {
      res.status(400).json({ error: "periodId and correctsRunId required" });
      return;
    }
    const result = await payrollRunService.createRun({
      workspaceId: ws,
      periodId,
      runType: "correction",
      correctsRunId,
      userId: req.userId,
      notes,
    });
    const show = canViewSalaryAmounts(req);
    res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      run: maskPayrollListRow(result.run, show),
      warnings: result.warnings,
    });
  },
);

router.get(
  "/hr/payroll/canonical/runs/:id",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const run = await payrollRunService.getRun(ws, Number(req.params.id));
    const show = canViewSalaryAmounts(req);
    res.json(maskPayrollListRow(run, show));
  },
);

router.get(
  "/hr/payroll/canonical/runs/:id/review",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const review = await payrollRunService.getReview(ws, Number(req.params.id));
    const show = canViewSalaryAmounts(req);
    res.json({
      ...review,
      run: maskPayrollListRow(review.run, show),
      employees: review.employees.map((e) =>
        show ? e : { ...e, grossAmount: "****", netAmount: "****" },
      ),
    });
  },
);

router.post(
  "/hr/payroll/canonical/runs/:id/calculate",
  requireAuth,
  requirePayrollPermission("hr.payroll.calculate"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    try {
      const runId = Number(req.params.id);
      const result = await payrollRunService.calculateRun(ws, runId, req.userId);
      logPayrollAccess({
        workspaceId: ws,
        userId: req.userId,
        action: "canonical_run_calculate",
        resourceType: "payroll_run",
        resourceId: runId,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/payroll/canonical/runs/:id/submit-review",
  requireAuth,
  requirePayrollPermission("hr.payroll.calculate"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    try {
      res.json(await payrollRunService.submitForReview(ws, Number(req.params.id), req.userId));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/payroll/canonical/runs/:id/approve",
  requireAuth,
  requirePayrollPermission("hr.payroll.approve"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    try {
      res.json(await payrollRunService.approveRun(ws, Number(req.params.id), req.userId));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/hr/payroll/canonical/runs/:id/lock",
  requireAuth,
  requirePayrollPermission("hr.payroll.approve"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const body = (req.body ?? {}) as { issuePayslips?: boolean };
    try {
      const runId = Number(req.params.id);
      const locked = await payrollRunService.lockRun(
        ws,
        runId,
        req.userId,
        body.issuePayslips !== false,
      );
      logPayrollAccess({
        workspaceId: ws,
        userId: req.userId,
        action: "canonical_run_lock",
        resourceType: "payroll_run",
        resourceId: runId,
        metadata: { issuePayslips: body.issuePayslips !== false },
      });
      res.json(locked);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/hr/payroll/canonical/runs/:id/payslips",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const rows = await payrollPayslipService.listPayslipsForRun(ws, Number(req.params.id));
    const show = canViewSalaryAmounts(req);
    res.json(
      rows.map((r) => ({
        ...r.payslip,
        employeeName: r.employeeName,
        employeeNumber: r.employeeNumber,
        grossAmount: show ? r.payslip.grossAmount : "****",
        netAmount: show ? r.payslip.netAmount : "****",
      })),
    );
  },
);

router.post(
  "/hr/payroll/canonical/payslips/:id/pdf",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null || !req.userId) return;
    try {
      const artifact = await generatePayslipPdf(ws, Number(req.params.id));
      const token = issuePayslipDownloadToken({
        payslipId: Number(req.params.id),
        workspaceId: ws,
        userId: req.userId,
      });
      res.json({ fileName: artifact.fileName, downloadToken: token, expiresInSec: 900 });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/hr/payroll/canonical/payslips/download",
  requireAuth,
  async (req: AuthRequest, res) => {
    const token = req.query.token as string;
    if (!token) {
      res.status(400).json({ error: "token required" });
      return;
    }
    const payload = verifyPayslipDownloadToken(token);
    if (!payload || payload.userId !== req.userId) {
      res.status(403).json({ error: "Invalid or expired token" });
      return;
    }
    const payslip = await payrollPayslipService.getPayslip(payload.workspaceId, payload.payslipId);
    if (!payslip.pdfStorageKey) {
      res.status(404).json({ error: "PDF not generated" });
      return;
    }
    try {
      await payrollPayslipService.logPdfAccess(payload.workspaceId, payload.payslipId, req.userId);
      const buffer = await readReportArtifact(payslip.pdfStorageKey);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="payslip-${payslip.payslipNumber ?? payslip.id}.pdf"`,
      );
      res.send(buffer);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.get(
  "/hr/payroll/canonical/attendance-summary",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const q = req.query as Record<string, string>;
    if (!q.periodStart || !q.periodEnd || !q.employeeId) {
      res.status(400).json({ error: "periodStart, periodEnd, employeeId required" });
      return;
    }
    const summary = await payrollAttendanceAdapter.aggregateEmployeePeriod(
      ws,
      Number(q.employeeId),
      q.periodStart,
      q.periodEnd,
    );
    res.json(summary);
  },
);

router.get(
  "/hr/payroll/canonical/packages/:employeeId/active",
  requireAuth,
  requirePayrollPermission("hr.payroll.view"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null) return;
    const asOf = (req.query.asOf as string) ?? new Date().toISOString().slice(0, 10);
    const snapshot = await compensationPackageService.getPackageSnapshot(
      ws,
      Number(req.params.employeeId),
      asOf,
    );
    if (!snapshot) {
      res.status(404).json({ error: "No active package" });
      return;
    }
    if (!canViewSalaryAmounts(req)) {
      res.json({ ...snapshot, baseAmount: "****", components: [] });
      return;
    }
    res.json(snapshot);
  },
);

router.post(
  "/hr/payroll/canonical/reports/generate",
  requireAuth,
  requirePayrollPermission("hr.payroll.export"),
  async (req: AuthRequest, res) => {
    const ws = requireWs(req, res);
    if (ws == null || !req.userId) return;
    const { reportDefinitionKey, payrollRunId, payslipId, format: fmt } = req.body as {
      reportDefinitionKey?: string;
      payrollRunId?: number;
      payslipId?: number;
      format?: string;
    };
    const allowed = new Set([
      "hr.payroll.register",
      "hr.payroll.components",
      "hr.payroll.payslip.pdf",
      "hr.payroll.payslips.batch",
    ]);
    if (!reportDefinitionKey || !allowed.has(reportDefinitionKey)) {
      res.status(400).json({ error: "Invalid reportDefinitionKey" });
      return;
    }
    const { job, generatedReport } = await exportJobService.createReportJob({
      workspaceId: ws,
      userId: req.userId,
      userRole: req.userRole,
      userPermissions: req.userPermissions,
      reportDefinitionKey,
      format: fmt ?? (reportDefinitionKey === "hr.payroll.payslip.pdf" ? "pdf" : "json"),
      parameters: { payrollRunId, payslipId },
    });
    res.status(202).json({ jobId: job.id, generatedReportId: generatedReport.id });
  },
);

export default router;
