import nodemailer from "nodemailer";
import { logger } from "./logger.js";

// ── Config ────────────────────────────────────────────────────────────────────
// All settings come from env vars. If SMTP_HOST is missing, email is skipped.
const SMTP_HOST = process.env["SMTP_HOST"];
const SMTP_PORT = Number(process.env["SMTP_PORT"] ?? "587");
const SMTP_USER = process.env["SMTP_USER"] ?? "";
const SMTP_PASS = process.env["SMTP_PASS"] ?? "";
const SMTP_FROM = process.env["SMTP_FROM"] ?? "noreply@ops-platform.local";
const SMTP_SECURE = process.env["SMTP_SECURE"] === "true";

function isEmailConfigured(): boolean {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_SECURE,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// ── Status styling ────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  const map: Record<string, string> = {
    submitted:        "#3b82f6",
    draft:            "#f59e0b",
    pending_approval: "#f59e0b",
    approved:         "#10b981",
    rejected:         "#ef4444",
    cancelled:        "#6b7280",
    completed:        "#10b981",
  };
  return map[status] ?? "#6b7280";
}

function statusLabel(status: string, lang: "ar" | "en"): string {
  const mapEn: Record<string, string> = {
    submitted:        "Submitted",
    draft:            "Draft",
    pending_approval: "Pending Approval",
    approved:         "Approved",
    rejected:         "Rejected",
    cancelled:        "Cancelled",
    completed:        "Completed",
  };
  const mapAr: Record<string, string> = {
    submitted:        "مُقدَّم",
    draft:            "مسودة",
    pending_approval: "بانتظار الموافقة",
    approved:         "مقبول",
    rejected:         "مرفوض",
    cancelled:        "ملغى",
    completed:        "مكتمل",
  };
  return (lang === "ar" ? mapAr[status] : mapEn[status]) ?? status;
}

// ── HTML Email Template ───────────────────────────────────────────────────────

function buildSubmissionConfirmationHtml(opts: {
  requestNumber:  string;
  formName:       string;
  formNameAr?:    string | null;
  submitterName:  string;
  submittedAt:    Date;
  status:         string;
  workspaceName?: string;
  fields:         { label: string; labelAr?: string | null; value: string }[];
}): string {
  const {
    requestNumber, formName, formNameAr, submitterName,
    submittedAt, status, workspaceName, fields,
  } = opts;

  const color   = statusColor(status);
  const dateStr = submittedAt.toLocaleDateString("en-GB", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const fieldRowsEn = fields.map(f =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px;width:40%;vertical-align:top">${f.label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#111;vertical-align:top">${f.value || "-"}</td>
    </tr>`
  ).join("");

  const fieldRowsAr = fields.map(f =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px;width:40%;vertical-align:top;text-align:right">${f.labelAr ?? f.label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#111;vertical-align:top;text-align:right">${f.value || "-"}</td>
    </tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="ltr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request Confirmation</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%);padding:32px 32px 24px">
      <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">${workspaceName ?? "Operations Platform"}</div>
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Request Confirmation</h1>
      <div style="margin-top:4px;color:#94a3b8;font-size:13px;font-family:monospace">${requestNumber}</div>
    </div>

    <!-- Status Banner -->
    <div style="background:${color}15;border-left:4px solid ${color};padding:12px 32px;display:flex;align-items:center;gap:12px">
      <span style="display:inline-block;background:${color};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;letter-spacing:.5px;text-transform:uppercase">${statusLabel(status, "en")}</span>
      <span style="color:#64748b;font-size:13px">Your request has been received</span>
    </div>

    <!-- Body EN -->
    <div style="padding:28px 32px 0">
      <p style="margin:0 0 4px;font-size:13px;color:#64748b">Hi ${submitterName},</p>
      <p style="margin:0 0 20px;font-size:15px;color:#111;line-height:1.6">
        Your request <strong>${formName}</strong> has been submitted successfully.
        Our team will review it and get back to you shortly.
      </p>

      <!-- Request Summary Card -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px">
        <div style="padding:12px 16px;background:#e2e8f0;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px">Request Summary</div>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px;width:40%">Request #</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;font-family:monospace;font-weight:700;color:#1e293b">${requestNumber}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px">Form</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#111">${formName}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px">Submitted</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#111">${dateStr}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#666;font-size:13px">Status</td>
            <td style="padding:8px 12px;font-size:13px"><span style="background:${color}20;color:${color};padding:2px 8px;border-radius:4px;font-weight:600;font-size:12px">${statusLabel(status, "en")}</span></td>
          </tr>
        </table>
      </div>

      <!-- Field Values -->
      ${fields.length > 0 ? `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px">
        <div style="padding:12px 16px;background:#e2e8f0;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px">Request Details</div>
        <table style="width:100%;border-collapse:collapse">${fieldRowsEn}</table>
      </div>` : ""}
    </div>

    <!-- Divider -->
    <div style="margin:0 32px;border-top:2px dashed #e2e8f0"></div>

    <!-- Arabic Section -->
    <div style="padding:24px 32px 0;direction:rtl;text-align:right">
      <p style="margin:0 0 4px;font-size:13px;color:#64748b">مرحباً ${submitterName}،</p>
      <p style="margin:0 0 20px;font-size:15px;color:#111;line-height:1.6">
        تم تقديم طلبك <strong>${formNameAr ?? formName}</strong> بنجاح.
        سيقوم فريقنا بمراجعته والرد عليك في أقرب وقت ممكن.
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px">
        <div style="padding:12px 16px;background:#e2e8f0;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px">ملخص الطلب</div>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px;width:40%;text-align:right">رقم الطلب</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;font-family:monospace;font-weight:700;color:#1e293b;text-align:right">${requestNumber}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px;text-align:right">النموذج</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#111;text-align:right">${formNameAr ?? formName}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px;text-align:right">تاريخ التقديم</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#111;text-align:right">${dateStr}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#666;font-size:13px;text-align:right">الحالة</td>
            <td style="padding:8px 12px;text-align:right"><span style="background:${color}20;color:${color};padding:2px 8px;border-radius:4px;font-weight:600;font-size:12px">${statusLabel(status, "ar")}</span></td>
          </tr>
        </table>
      </div>

      ${fields.length > 0 ? `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px">
        <div style="padding:12px 16px;background:#e2e8f0;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px">تفاصيل الطلب</div>
        <table style="width:100%;border-collapse:collapse">${fieldRowsAr}</table>
      </div>` : ""}
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
      <p style="margin:0;font-size:12px;color:#94a3b8">
        This is an automated message from your Operations Platform.
        Please do not reply to this email.
      </p>
      <p style="margin:4px 0 0;font-size:11px;color:#cbd5e1;direction:rtl">
        هذه رسالة تلقائية من منصة العمليات. لا تقم بالرد على هذا البريد.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface SubmissionEmailOptions {
  toEmail:        string;
  submitterName:  string;
  requestNumber:  string;
  formName:       string;
  formNameAr?:    string | null;
  status:         string;
  submittedAt:    Date;
  workspaceName?: string;
  fields:         { label: string; labelAr?: string | null; value: string }[];
}

export async function sendSubmissionConfirmation(opts: SubmissionEmailOptions): Promise<void> {
  if (!isEmailConfigured()) {
    logger.info({
      requestNumber: opts.requestNumber,
      toEmail:       opts.toEmail,
    }, "Email not configured - skipping submission confirmation email");
    return;
  }

  const transporter = getTransporter();
  if (!transporter) return;

  const html = buildSubmissionConfirmationHtml(opts);
  const subject = `[${opts.requestNumber}] Request Confirmation - ${opts.formName} | تأكيد الطلب`;

  try {
    await transporter.sendMail({
      from:    SMTP_FROM,
      to:      opts.toEmail,
      subject,
      html,
    });
    logger.info({ requestNumber: opts.requestNumber, toEmail: opts.toEmail }, "Submission confirmation email sent");
  } catch (err) {
    logger.error({ err, requestNumber: opts.requestNumber }, "Failed to send submission confirmation email");
  }
}

/**
 * Generic sendEmail helper used by invitation routes.
 * No-op if SMTP is not configured.
 */
export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void> {
  if (!isEmailConfigured()) return;
  const transporter = getTransporter();
  if (!transporter) return;
  try {
    await transporter.sendMail({ from: SMTP_FROM, to, subject, html });
  } catch (err) {
    logger.warn({ err, to }, "sendEmail failed");
  }
}
