import type { ReportArtifact } from "./artifact-builder";
import type { ReportParams } from "./report-generators";
import { fetchReportTableData } from "./report-data";
import { getWorkspaceBranding } from "./workspace-branding";
import { renderReportPdfHtml } from "./templates/report-pdf-templates";
import { renderHtmlToPdf, renderTablePdfToBuffer } from "./pdf-renderer";

const BASE_NAMES: Record<string, string> = {
  "hr.employees.roster": "employees_roster",
  "hr.attendance.period": "attendance_period",
  "hr.leave.balances": "leave_balances",
};

export async function generatePdfReport(
  definitionKey: string,
  workspaceId: number,
  params: ReportParams,
): Promise<ReportArtifact> {
  const [data, branding] = await Promise.all([
    fetchReportTableData(definitionKey, workspaceId, params),
    getWorkspaceBranding(workspaceId),
  ]);

  const html = renderReportPdfHtml({
    branding,
    data,
    generatedAt: new Date(),
    locale: branding.locale,
  });

  const buffer =
    process.env.PDF_RENDERER === "puppeteer"
      ? await renderHtmlToPdf(html)
      : await renderTablePdfToBuffer(
          data.title,
          branding.displayName,
          data.columns,
          data.rows,
        );
  const base = BASE_NAMES[definitionKey] ?? "report";

  return {
    buffer,
    contentType: "application/pdf",
    fileName: `${base}.pdf`,
    rowCount: data.rows.length,
  };
}
