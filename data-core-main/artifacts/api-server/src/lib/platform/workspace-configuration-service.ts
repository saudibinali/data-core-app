/**
 * P23-A — Workspace configuration façade (domain-separated reads)
 */
import { db } from "@workspace/db";
import {
  hrWorkspaceSettingsTable,
  workspaceModuleSettingsTable,
  workspaceSmtpConfigsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

export class WorkspaceConfigurationService {
  async getGroupedSnapshot(workspaceId: number) {
    const [hr] = await db
      .select()
      .from(hrWorkspaceSettingsTable)
      .where(eq(hrWorkspaceSettingsTable.workspaceId, workspaceId))
      .limit(1);

    const modules = await db
      .select()
      .from(workspaceModuleSettingsTable)
      .where(eq(workspaceModuleSettingsTable.workspaceId, workspaceId));

    const [smtp] = await db
      .select()
      .from(workspaceSmtpConfigsTable)
      .where(eq(workspaceSmtpConfigsTable.workspaceId, workspaceId))
      .limit(1);

    return {
      workspaceId,
      domains: {
        finance: finance ?? null,
        hr: hr ?? null,
        modules,
        smtp: smtp
          ? {
              id: smtp.id,
              host: smtp.host,
              port: smtp.port,
              fromEmail: smtp.fromEmail,
              secure: smtp.secure,
              isVerified: smtp.isVerified,
              status: smtp.status,
              updatedAt: smtp.updatedAt,
            }
          : null,
      },
      note: "Super-admin must not mutate tenant HR settings directly — use workspace admin APIs or governed support sessions.",
    };
  }
}

export const workspaceConfigurationService = new WorkspaceConfigurationService();
