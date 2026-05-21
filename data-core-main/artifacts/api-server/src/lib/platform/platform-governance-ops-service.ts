/**
 * P23-A — Platform Operations Center aggregates (read-only)
 */
import { db } from "@workspace/db";
import {
  workspacesTable,
  workspaceLifecycleEventsTable,
  workspaceModuleSettingsTable,
  supportImpersonationSessionsTable,
  platformGovernanceAuditLogsTable,
} from "@workspace/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";

export class PlatformGovernanceOpsService {
  async getOverview(input?: { recentEventLimit?: number }) {
    const limit = Math.min(Math.max(input?.recentEventLimit ?? 25, 1), 100);

    const [workspaceTotals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${workspacesTable.status} = 'active')::int`,
        suspended: sql<number>`count(*) filter (where ${workspacesTable.status} = 'suspended')::int`,
        locked: sql<number>`count(*) filter (where ${workspacesTable.status} = 'locked')::int`,
        archived: sql<number>`count(*) filter (where ${workspacesTable.status} = 'disabled')::int`,
        pending: sql<number>`count(*) filter (where ${workspacesTable.status} = 'pending_activation')::int`,
      })
      .from(workspacesTable);

    const [moduleRows] = await db
      .select({
        enabledCount: sql<number>`count(*) filter (where ${workspaceModuleSettingsTable.enabled} = true)::int`,
      })
      .from(workspaceModuleSettingsTable);

    const [activeSupport] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(supportImpersonationSessionsTable)
      .where(
        and(
          eq(supportImpersonationSessionsTable.status, "active"),
          gt(supportImpersonationSessionsTable.expiresAt, new Date()),
        ),
      );

    const recentLifecycle = await db
      .select({
        id: workspaceLifecycleEventsTable.id,
        workspaceId: workspaceLifecycleEventsTable.workspaceId,
        action: workspaceLifecycleEventsTable.action,
        previousStatus: workspaceLifecycleEventsTable.previousStatus,
        newStatus: workspaceLifecycleEventsTable.newStatus,
        reason: workspaceLifecycleEventsTable.reason,
        createdAt: workspaceLifecycleEventsTable.createdAt,
      })
      .from(workspaceLifecycleEventsTable)
      .orderBy(desc(workspaceLifecycleEventsTable.createdAt))
      .limit(limit);

    const recentGovernanceAlerts = await db
      .select({
        id: platformGovernanceAuditLogsTable.id,
        workspaceId: platformGovernanceAuditLogsTable.workspaceId,
        action: platformGovernanceAuditLogsTable.action,
        scope: platformGovernanceAuditLogsTable.scope,
        createdAt: platformGovernanceAuditLogsTable.createdAt,
      })
      .from(platformGovernanceAuditLogsTable)
      .where(
        sql`${platformGovernanceAuditLogsTable.action} in (
          'support_impersonation_start',
          'support_impersonation_end',
          'module_governance_toggle',
          'workspace_finance_init_hook_failed'
        )`,
      )
      .orderBy(desc(platformGovernanceAuditLogsTable.createdAt))
      .limit(limit);

    return {
      generatedAt: new Date().toISOString(),
      workspaces: {
        total: workspaceTotals?.total ?? 0,
        active: workspaceTotals?.active ?? 0,
        suspended: workspaceTotals?.suspended ?? 0,
        locked: workspaceTotals?.locked ?? 0,
        archived: workspaceTotals?.archived ?? 0,
        pendingActivation: workspaceTotals?.pending ?? 0,
      },
      moduleSettings: {
        enabledWorkspaceModuleRows: moduleRows?.enabledCount ?? 0,
      },
      support: {
        activeScopedSessions: activeSupport?.n ?? 0,
      },
      recentLifecycleEvents: recentLifecycle,
      governanceAlerts: recentGovernanceAlerts,
    };
  }
}

export const platformGovernanceOpsService = new PlatformGovernanceOpsService();
