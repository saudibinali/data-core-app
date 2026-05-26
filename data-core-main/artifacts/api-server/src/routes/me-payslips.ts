/**
 * F6.3 — Self-service payslips (list, detail, PDF download).
 */
import { Router, type IRouter } from "express";
import { type AuthRequest, requireAuth } from "../middlewares/requireAuth";
import {
  assertMePayslipOwnership,
  getMePayslipDetail,
  listMePayslips,
} from "../lib/payroll/me-payslip-service";
import { generatePayslipPdf } from "../lib/payroll/payroll-pdf-generator";
import { payrollPayslipService } from "../lib/payroll/payroll-payslip-service";
import { issuePayslipDownloadToken, verifyPayslipDownloadToken } from "../lib/payroll/payroll-download-token";
import { readReportArtifact } from "../lib/reports/report-artifact-storage";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.get("/hr/me/payslips", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  res.json(await listMePayslips(workspaceId, userId));
});

router.get("/hr/me/payslips/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const detail = await getMePayslipDetail(workspaceId, userId, id);
  if (!detail) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(detail);
});

router.post("/hr/me/payslips/:id/pdf", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { workspaceId, userId } = req;
  if (!workspaceId || !userId) {
    res.status(403).json({ error: "No workspace" });
    return;
  }
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const ownership = await assertMePayslipOwnership(workspaceId, userId, id);
  if (!ownership) {
    res.status(404).json({ error: "Payslip not found" });
    return;
  }

  if (ownership.source === "legacy") {
    res.status(400).json({
      error: "PDF download is available for canonical payslips only",
      code: "LEGACY_PAYSLIP_NO_PDF",
    });
    return;
  }

  const payslip = await payrollPayslipService.getPayslip(workspaceId, id);
  if (payslip.status !== "issued") {
    res.status(400).json({ error: "Payslip not yet issued" });
    return;
  }

  if (!payslip.pdfStorageKey) {
    await generatePayslipPdf(workspaceId, id);
  }

  const token = issuePayslipDownloadToken({
    payslipId: id,
    workspaceId,
    userId,
  });

  res.json({
    downloadToken: token,
    expiresInSec: 900,
    fileName: `payslip-${payslip.payslipNumber ?? id}.pdf`,
  });
});

router.get("/hr/me/payslips/download", requireAuth, async (req: AuthRequest, res): Promise<void> => {
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

  const ownership = await assertMePayslipOwnership(
    payload.workspaceId,
    payload.userId,
    payload.payslipId,
    "canonical",
  );
  if (!ownership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const payslip = await payrollPayslipService.getPayslip(payload.workspaceId, payload.payslipId);
  if (!payslip.pdfStorageKey) {
    res.status(404).json({ error: "PDF not generated yet" });
    return;
  }

  await payrollPayslipService.logPdfAccess(payload.workspaceId, payload.payslipId, req.userId);
  const buffer = await readReportArtifact(payslip.pdfStorageKey);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="payslip-${payslip.payslipNumber ?? payslip.id}.pdf"`,
  );
  res.send(buffer);
});

export default router;
