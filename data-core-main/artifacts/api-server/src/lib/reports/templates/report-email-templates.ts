import type { WorkspaceBranding } from "../workspace-branding";

export type ReportEmailVars = {
  reportTitle: string;
  reportKey: string;
  workspaceName: string;
  downloadUrl: string;
  expiresInMinutes: string;
  locale: "en" | "ar";
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderReportReadyEmail(
  branding: WorkspaceBranding,
  vars: ReportEmailVars,
): { subject: string; html: string; text: string } {
  const dir = vars.locale === "ar" ? "rtl" : "ltr";
  const color = branding.primaryColor;
  const isAr = vars.locale === "ar";
  const subject = isAr
    ? `تقرير جاهز — ${vars.reportTitle}`
    : `Report ready — ${vars.reportTitle}`;

  const cta = isAr ? "تحميل التقرير" : "Download report";
  const intro = isAr
    ? `تقرير <strong>${escapeHtml(vars.reportTitle)}</strong> جاهز للتحميل.`
    : `Your report <strong>${escapeHtml(vars.reportTitle)}</strong> is ready.`;

  const html = `<!DOCTYPE html><html dir="${dir}"><body style="font-family:Arial,sans-serif;padding:24px">
<div style="border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:16px">
  <h2 style="color:${color};margin:0">${escapeHtml(branding.displayName)}</h2>
</div>
<p>${intro}</p>
<p><a href="${escapeHtml(vars.downloadUrl)}" style="background:${color};color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">${cta}</a></p>
<p style="font-size:12px;color:#666">${isAr ? "ينتهي الرابط خلال" : "Link expires in"} ${escapeHtml(vars.expiresInMinutes)} ${isAr ? "دقيقة" : "minutes"}.</p>
<p style="font-size:11px;color:#999">${escapeHtml(branding.footerText ?? "")}</p>
</body></html>`;

  const text = isAr
    ? `${vars.reportTitle} جاهز: ${vars.downloadUrl} (ينتهي خلال ${vars.expiresInMinutes} دقيقة)`
    : `${vars.reportTitle} ready: ${vars.downloadUrl} (expires in ${vars.expiresInMinutes} min)`;

  return { subject, html, text };
}
