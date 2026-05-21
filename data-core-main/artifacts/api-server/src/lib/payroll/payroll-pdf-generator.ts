/**
 * P21-C — hr.payroll.payslip.pdf generation
 */
import { db } from "@workspace/db";
import {
  payrollPayslipsTable,
  payrollRunsTable,
  payrollPeriodsTable,
  employeesTable,
  payrollComponentValuesTable,
  payrollComponentsTable,
  payrollRunEmployeesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { renderPayslipPdfHtml, type PayslipPdfLine } from "./templates/payslip-pdf-template";
import { renderHtmlToPdf } from "../reports/pdf-renderer";
import { getWorkspaceBranding } from "../reports/workspace-branding";
import { storeReportArtifact } from "../reports/report-artifact-storage";
import { payrollPayslipService } from "./payroll-payslip-service";
import type { ReportArtifact } from "../reports/artifact-builder";

export async function generatePayslipPdf(
  workspaceId: number,
  payslipId: number,
  options?: { watermark?: string; locale?: "en" | "ar" | "bilingual" },
): Promise<ReportArtifact> {
  const [row] = await db
    .select({
      payslip: payrollPayslipsTable,
      employeeName: employeesTable.fullName,
      employeeNumber: employeesTable.employeeNumber,
      periodLabel: payrollPeriodsTable.periodLabel,
    })
    .from(payrollPayslipsTable)
    .innerJoin(employeesTable, eq(payrollPayslipsTable.employeeId, employeesTable.id))
    .innerJoin(payrollRunsTable, eq(payrollPayslipsTable.runId, payrollRunsTable.id))
    .innerJoin(payrollPeriodsTable, eq(payrollRunsTable.periodId, payrollPeriodsTable.id))
    .where(
      and(eq(payrollPayslipsTable.id, payslipId), eq(payrollPayslipsTable.workspaceId, workspaceId)),
    )
    .limit(1);

  if (!row) throw new Error("Payslip not found");

  const lines = await db
    .select({
      code: payrollComponentsTable.code,
      name: payrollComponentsTable.name,
      nameAr: payrollComponentsTable.nameAr,
      componentClass: payrollComponentsTable.componentClass,
      amount: payrollComponentValuesTable.amount,
    })
    .from(payrollComponentValuesTable)
    .innerJoin(
      payrollRunEmployeesTable,
      eq(payrollComponentValuesTable.runEmployeeId, payrollRunEmployeesTable.id),
    )
    .leftJoin(
      payrollComponentsTable,
      eq(payrollComponentValuesTable.componentId, payrollComponentsTable.id),
    )
    .where(eq(payrollRunEmployeesTable.id, row.payslip.runEmployeeId));

  const earnings: PayslipPdfLine[] = [];
  const deductions: PayslipPdfLine[] = [];
  for (const l of lines) {
    const entry = {
      code: l.code ?? "",
      name: l.name ?? l.code ?? "",
      nameAr: l.nameAr,
      componentClass: l.componentClass ?? "earning",
      amount: l.amount,
    };
    if (l.componentClass === "deduction") deductions.push(entry);
    else earnings.push(entry);
  }

  const branding = await getWorkspaceBranding(workspaceId);
  const ytd = row.payslip.ytdJson ? JSON.parse(row.payslip.ytdJson) : {};

  const html = renderPayslipPdfHtml({
    locale: options?.locale ?? (branding.locale === "ar" ? "bilingual" : "en"),
    watermark: options?.watermark ?? (row.payslip.status === "draft" ? "DRAFT" : undefined),
    employerName: branding.displayName,
    employeeName: row.employeeName,
    employeeNumber: row.employeeNumber,
    periodLabel: row.periodLabel,
    payslipNumber: row.payslip.payslipNumber,
    currencyCode: row.payslip.currencyCode,
    earnings,
    deductions,
    gross: row.payslip.grossAmount,
    net: row.payslip.netAmount,
    totalDeductions: row.payslip.totalDeductions,
    ytdNet: ytd.netYtd,
    ytdGross: ytd.grossYtd,
  });

  const buffer = await renderHtmlToPdf(html);
  const fileName = `payslip_${row.payslip.payslipNumber ?? payslipId}.pdf`;
  const storageKey = await storeReportArtifact(workspaceId, payslipId, fileName, buffer);
  await payrollPayslipService.attachPdfStorageKey(payslipId, workspaceId, storageKey);

  return {
    buffer,
    contentType: "application/pdf",
    fileName,
    rowCount: 1,
    storageKey,
  };
}

export async function generatePayslipPdfReport(
  workspaceId: number,
  params: { payslipId?: number; payrollRunId?: number },
): Promise<ReportArtifact> {
  if (params.payslipId) {
    return generatePayslipPdf(workspaceId, Number(params.payslipId));
  }
  throw new Error("payslipId required for hr.payroll.payslip.pdf");
}
