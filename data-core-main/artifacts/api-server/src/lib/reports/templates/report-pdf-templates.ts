import type { WorkspaceBranding } from "../workspace-branding";
import type { ReportTableData } from "../report-data";

export type PdfTemplateContext = {
  branding: WorkspaceBranding;
  data: ReportTableData;
  generatedAt: Date;
  locale: "en" | "ar";
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function labels(locale: "en" | "ar") {
  return locale === "ar"
    ? { generated: "تاريخ الإنشاء", rows: "عدد الصفوف", confidential: "سري" }
    : { generated: "Generated", rows: "Rows", confidential: "Confidential" };
}

export function renderReportPdfHtml(ctx: PdfTemplateContext): string {
  const { branding, data, generatedAt, locale } = ctx;
  const dir = locale === "ar" ? "rtl" : "ltr";
  const L = labels(locale);
  const color = branding.primaryColor;
  const logo = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="" style="max-height:48px;max-width:160px" />`
    : "";

  const metaRows = Object.entries(data.metadata)
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td class="meta-k">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
    .join("");

  const headCells = data.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const bodyRows = data.rows
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");

  const watermark = branding.watermarkText
    ? `<div style="position:fixed;opacity:0.08;font-size:72px;transform:rotate(-30deg);top:40%;left:20%;pointer-events:none">${escapeHtml(branding.watermarkText)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 18mm 14mm 22mm 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; }
  .header { border-bottom: 3px solid ${color}; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
  .title { font-size: 18px; font-weight: bold; color: ${color}; }
  .sub { color: #555; font-size: 10px; margin-top: 4px; }
  table.data { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.data th { background: ${color}; color: #fff; padding: 6px 8px; text-align: ${dir === "rtl" ? "right" : "left"}; font-size: 10px; }
  table.data td { border-bottom: 1px solid #e5e7eb; padding: 5px 8px; }
  table.meta { font-size: 10px; margin-bottom: 12px; }
  .meta-k { color: #666; padding-right: 8px; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9px; color: #666; border-top: 1px solid #ddd; padding-top: 6px; text-align: center; }
</style>
</head>
<body>
${watermark}
<div class="header">
  <div>
    <div class="title">${escapeHtml(data.title)}</div>
    <div class="sub">${escapeHtml(branding.displayName)}</div>
    <div class="sub">${L.generated}: ${generatedAt.toISOString().slice(0, 19)}Z · ${L.rows}: ${data.rows.length}</div>
  </div>
  <div>${logo}</div>
</div>
<table class="meta">${metaRows}</table>
<table class="data"><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>
<div class="footer">${escapeHtml(branding.footerText ?? branding.displayName)} · ${L.confidential}</div>
</body>
</html>`;
}

export const PDF_TEMPLATE_KEYS = [
  "hr.employees.roster.pdf",
  "hr.attendance.period.pdf",
  "hr.leave.balances.pdf",
] as const;

export function pdfTemplateKeyForDefinition(definitionKey: string): string {
  return `${definitionKey}.pdf`;
}
