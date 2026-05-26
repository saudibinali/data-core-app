/**
 * F6.3 — Background PDF generation for issued canonical payslips after run lock.
 */
import { db } from "@workspace/db";
import { payrollPayslipsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "../logger";
import { generatePayslipPdf } from "./payroll-pdf-generator";
import { isPayrollCutoverEnabledForWorkspace } from "../payroll-cutover-flags";

export function schedulePayslipPdfBatchForRun(
  workspaceId: number,
  runId: number,
  userId?: number,
): void {
  if (!isPayrollCutoverEnabledForWorkspace("payrollCanonicalWrite", workspaceId)) return;

  void (async () => {
    const slips = await db
      .select({ id: payrollPayslipsTable.id })
      .from(payrollPayslipsTable)
      .where(
        and(
          eq(payrollPayslipsTable.workspaceId, workspaceId),
          eq(payrollPayslipsTable.runId, runId),
          eq(payrollPayslipsTable.status, "issued"),
          isNull(payrollPayslipsTable.pdfStorageKey),
        ),
      );

    for (const slip of slips) {
      try {
        await generatePayslipPdf(workspaceId, slip.id);
      } catch (err) {
        logger.warn(
          { err, workspaceId, runId, payslipId: slip.id, userId },
          "[payroll] payslip PDF batch generation failed",
        );
      }
    }
  })();
}
