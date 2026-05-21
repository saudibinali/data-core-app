/**
 * P19-B — Built-in notification templates (platform defaults, workspace_id NULL).
 */

export type TemplateDef = {
  templateKey: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
};

function wrapHtml(body: string): string {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:24px">${body}</body></html>`;
}

export const PLATFORM_EMAIL_TEMPLATES: TemplateDef[] = [
  {
    templateKey: "leave.requested",
    subject: "Leave approval required — {{leaveType}}",
    bodyHtml: wrapHtml(
      "<h2>Leave Request</h2><p>{{message}}</p><p>Dates: {{startDate}} → {{endDate}}</p>",
    ),
    bodyText: "Leave approval required: {{message}} ({{startDate}} → {{endDate}})",
  },
  {
    templateKey: "leave.approved",
    subject: "Leave approved — {{leaveType}}",
    bodyHtml: wrapHtml("<h2>Leave Approved</h2><p>{{message}}</p>"),
    bodyText: "Leave approved: {{message}}",
  },
  {
    templateKey: "leave.rejected",
    subject: "Leave rejected — {{leaveType}}",
    bodyHtml: wrapHtml("<h2>Leave Rejected</h2><p>{{message}}</p>"),
    bodyText: "Leave rejected: {{message}}",
  },
  {
    templateKey: "workflow.step.pending",
    subject: "Action required — {{title}}",
    bodyHtml: wrapHtml("<h2>Pending Step</h2><p>{{message}}</p>"),
    bodyText: "Action required: {{message}}",
  },
  {
    templateKey: "export.completed",
    subject: "Export ready — {{reportKey}}",
    bodyHtml: wrapHtml("<h2>Export Complete</h2><p>{{message}}</p>"),
    bodyText: "Export complete: {{message}}",
  },
  {
    templateKey: "export.failed",
    subject: "Export failed — {{reportKey}}",
    bodyHtml: wrapHtml("<h2>Export Failed</h2><p>{{message}}</p>"),
    bodyText: "Export failed: {{message}}",
  },
  {
    templateKey: "report.ready",
    subject: "Report ready — {{reportTitle}}",
    bodyHtml: wrapHtml(
      "<h2>{{workspaceName}}</h2><p>{{message}}</p><p><a href=\"{{downloadUrl}}\">Download report</a></p><p style=\"font-size:12px;color:#666\">Link expires in {{expiresInMinutes}} minutes.</p>",
    ),
    bodyText: "{{reportTitle}} ready: {{downloadUrl}} (expires in {{expiresInMinutes}} min)",
  },
];

export function renderTemplate(
  template: { subject: string; bodyHtml: string; bodyText?: string | null },
  vars: Record<string, string>,
): { subject: string; html: string; text: string } {
  const replace = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
  return {
    subject: replace(template.subject),
    html: replace(template.bodyHtml),
    text: replace(template.bodyText ?? template.bodyHtml.replace(/<[^>]+>/g, "")),
  };
}
