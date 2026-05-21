import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { dispatchUserNotification } from "../notifications/dispatch";
import { issueReportDownloadToken } from "./report-download-token";
import { getWorkspaceBranding } from "./workspace-branding";
import { reportDefinitionRegistry } from "./report-definition-registry";
import type { ReportRecipient } from "./scheduled-report-service";

const TTL_SEC = Number(process.env.REPORT_DOWNLOAD_TTL_SEC ?? 900);

function appPublicBase(): string {
  return (process.env.APP_PUBLIC_URL ?? process.env.APP_URL ?? "http://localhost:5000").replace(/\/$/, "");
}

function buildDownloadUrl(token: string): string {
  return `${appPublicBase()}/api/reports/generated/download/stream?token=${encodeURIComponent(token)}`;
}

async function resolveRecipientUserId(
  workspaceId: number,
  recipient: ReportRecipient,
): Promise<{ userId: number; email?: string } | null> {
  if (recipient.userId) return { userId: recipient.userId, email: recipient.email };
  if (recipient.email) {
    const [u] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.email, recipient.email), eq(usersTable.workspaceId, workspaceId)))
      .limit(1);
    if (u) return { userId: u.id, email: recipient.email };
  }
  return null;
}

export async function dispatchExportNotification(params: {
  workspaceId: number;
  userId?: number;
  success: boolean;
  reportDefinitionKey: string;
  generatedReportId: number;
  format?: string | null;
  errorMessage?: string;
  recipientJson?: string | null;
}): Promise<void> {
  const def = reportDefinitionRegistry.get(params.reportDefinitionKey);
  const reportTitle = def?.title ?? params.reportDefinitionKey;

  const recipients: ReportRecipient[] = params.recipientJson
    ? JSON.parse(params.recipientJson)
    : [];

  const notifyUserIds = new Set<number>();
  if (params.userId) notifyUserIds.add(params.userId);
  for (const r of recipients) {
    const resolved = await resolveRecipientUserId(params.workspaceId, r);
    if (resolved) notifyUserIds.add(resolved.userId);
  }

  if (!params.success) {
    for (const userId of notifyUserIds) {
      await dispatchUserNotification({
        workspaceId: params.workspaceId,
        userId,
        type: "export_failed",
        title: "Export Failed",
        message: `Export failed: ${params.errorMessage ?? "Unknown error"}`,
        emailTemplateKey: "export.failed",
        templateVars: {
          title: "Export Failed",
          message: params.errorMessage ?? "Unknown error",
          reportKey: params.reportDefinitionKey,
        },
        enqueueEmail: Boolean(recipients.length),
      });
    }
    return;
  }

  const branding = await getWorkspaceBranding(params.workspaceId);
  const expiresMin = String(Math.ceil(TTL_SEC / 60));

  for (const userId of notifyUserIds) {
    const token = issueReportDownloadToken({
      generatedReportId: params.generatedReportId,
      workspaceId: params.workspaceId,
      userId,
    });
    const downloadUrl = buildDownloadUrl(token);

    await dispatchUserNotification({
      workspaceId: params.workspaceId,
      userId,
      type: "export_completed",
      title: "Report Ready",
      message: `Your report (${params.reportDefinitionKey}) is ready to download.`,
      emailTemplateKey: "report.ready",
      templateVars: {
        title: "Report Ready",
        message: `${reportTitle} is ready.`,
        reportKey: params.reportDefinitionKey,
        reportTitle,
        workspaceName: branding.displayName,
        downloadUrl,
        expiresInMinutes: expiresMin,
      },
      enqueueEmail: true,
    });
  }
}
