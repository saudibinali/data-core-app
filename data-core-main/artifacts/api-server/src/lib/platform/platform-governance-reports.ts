/**
 * P23-A — Platform governance reports (JSON → generated_reports)
 */
import { db } from "@workspace/db";
import {
  workspaceLifecycleEventsTable,
  platformGovernanceAuditLogsTable,
  supportImpersonationSessionsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { ReportArtifact } from "../reports/artifact-builder";

export async function generatePlatformGovernanceReport(
  definitionKey: string,
  workspaceId: number,
  params: Record<string, string | number | boolean | undefined>,
): Promise<ReportArtifact> {
  const generatedAt = new Date().toISOString();
  const limit = params.limit ? Number(params.limit) : 500;
  const safeLimit = Math.min(Math.max(limit, 1), 5000);

  let body: Record<string, unknown>;

  switch (definitionKey) {
    case "platform.workspace.lifecycle": {
      const rows = await db
        .select()
        .from(workspaceLifecycleEventsTable)
        .where(eq(workspaceLifecycleEventsTable.workspaceId, workspaceId))
        .orderBy(desc(workspaceLifecycleEventsTable.createdAt))
        .limit(safeLimit);
      body = { reportKey: definitionKey, generatedAt, workspaceId, rows };
      break;
    }
    case "platform.module.governance": {
      const rows = await db
        .select()
        .from(platformGovernanceAuditLogsTable)
        .where(
          and(
            eq(platformGovernanceAuditLogsTable.workspaceId, workspaceId),
            eq(platformGovernanceAuditLogsTable.action, "module_governance_toggle"),
          ),
        )
        .orderBy(desc(platformGovernanceAuditLogsTable.createdAt))
        .limit(safeLimit);
      body = { reportKey: definitionKey, generatedAt, workspaceId, rows };
      break;
    }
    case "platform.support.audit": {
      const rows = await db
        .select()
        .from(platformGovernanceAuditLogsTable)
        .where(
          and(
            eq(platformGovernanceAuditLogsTable.workspaceId, workspaceId),
            inArray(platformGovernanceAuditLogsTable.action, [
              "support_impersonation_start",
              "support_impersonation_end",
            ]),
          ),
        )
        .orderBy(desc(platformGovernanceAuditLogsTable.createdAt))
        .limit(safeLimit);
      body = { reportKey: definitionKey, generatedAt, workspaceId, rows };
      break;
    }
    case "platform.impersonation.audit": {
      const rows = await db
        .select()
        .from(supportImpersonationSessionsTable)
        .where(eq(supportImpersonationSessionsTable.targetWorkspaceId, workspaceId))
        .orderBy(desc(supportImpersonationSessionsTable.startedAt))
        .limit(safeLimit);
      body = { reportKey: definitionKey, generatedAt, workspaceId, rows };
      break;
    }
    case "platform.governance.actions": {
      const rows = await db
        .select()
        .from(platformGovernanceAuditLogsTable)
        .where(eq(platformGovernanceAuditLogsTable.workspaceId, workspaceId))
        .orderBy(desc(platformGovernanceAuditLogsTable.createdAt))
        .limit(safeLimit);
      body = { reportKey: definitionKey, generatedAt, workspaceId, rows };
      break;
    }
    default:
      throw new Error(`Unknown platform report: ${definitionKey}`);
  }

  const json = JSON.stringify(body, null, 2);
  return {
    buffer: Buffer.from(json, "utf8"),
    contentType: "application/json",
    fileName: `${definitionKey.replace(/\./g, "_")}_${Date.now()}.json`,
    rowCount: Array.isArray(body.rows) ? body.rows.length : 0,
  };
}
