import { getSmtpConfigDebugSnapshot, isEmailConfigured, sendTransactionalEmail } from "./email";
import { logger } from "./logger";

/** Server-only destination for contact form (never sent to clients). */
export function getContactInboxAddress(): string | null {
  const dedicated = process.env["CONTACT_INBOX_EMAIL"]?.trim();
  if (dedicated && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dedicated)) {
    return dedicated;
  }
  const fallback = process.env["SMTP_USER"]?.trim();
  if (fallback && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallback)) {
    return fallback;
  }
  return null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildContactInquiryHtml(payload: {
  fullName: string;
  companyName: string;
  email: string;
  subject: string;
  message: string;
  submittedAt: Date;
  clientIp?: string;
}): string {
  const { fullName, companyName, email, subject, message, submittedAt, clientIp } = payload;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8;padding:24px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
    <div style="background:linear-gradient(90deg,#001f3f,#007bff);padding:20px 24px;">
      <h1 style="margin:0;color:#fff;font-size:18px;">Data Core Center — Contact Inquiry</h1>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155;">
        <tr><td style="padding:8px 0;font-weight:600;width:140px;">Full name</td><td>${escapeHtml(fullName)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600;">Company</td><td>${escapeHtml(companyName)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600;">Email</td><td><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
        <tr><td style="padding:8px 0;font-weight:600;">Subject</td><td>${escapeHtml(subject)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600;vertical-align:top;">Submitted</td><td>${submittedAt.toISOString()}</td></tr>
        ${clientIp ? `<tr><td style="padding:8px 0;font-weight:600;">Client IP</td><td>${escapeHtml(clientIp)}</td></tr>` : ""}
      </table>
      <div style="margin-top:20px;padding:16px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
        <p style="margin:0 0 8px;font-weight:600;font-size:13px;color:#0f172a;">Message</p>
        <p style="margin:0;white-space:pre-wrap;font-size:14px;color:#475569;line-height:1.6;">${escapeHtml(message)}</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function isContactDeliveryReady(): boolean {
  return isEmailConfigured() && getContactInboxAddress() !== null;
}

export async function sendContactInquiryEmail(payload: {
  fullName: string;
  companyName: string;
  email: string;
  subject: string;
  message: string;
  clientIp?: string;
}): Promise<void> {
  const inbox = getContactInboxAddress();
  if (!inbox) {
    throw new Error("CONTACT_INBOX_NOT_CONFIGURED");
  }

  const submittedAt = new Date();
  const html = buildContactInquiryHtml({ ...payload, submittedAt });
  const mailSubject = `[DCC Contact] ${payload.subject} — ${payload.companyName}`;

  console.log("[contact-smtp-debug] contact send starting", {
    inbox,
    replyTo: payload.email,
    smtp: getSmtpConfigDebugSnapshot(),
  });

  try {
    await sendTransactionalEmail({
      to: inbox,
      subject: mailSubject,
      html,
      replyTo: payload.email,
    });
    console.log("[contact-smtp-debug] contact inquiry email delivered to inbox");
    logger.info({ companyName: payload.companyName }, "Contact inquiry email sent");
  } catch (error) {
    console.error("[contact-smtp-debug] contact inquiry email failed");
    console.error(error);
    logger.error({ err: error }, "Failed to send contact inquiry email");
    throw error;
  }
}
